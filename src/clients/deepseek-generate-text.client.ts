import { UnsupportedTextGenerationCapabilityError } from "../errors"
import { normalizeTokenUsage } from "../helpers"
import type {
  TextGenerationCapabilities,
  TextGenerationClient,
  TextGenerationRequest,
  TextGenerationResponse,
} from "../types/text-generation.request"
import {
  buildDeepSeekSystemPrompt,
  checkDeepSeekFinishReason,
  DEFAULT_DEEPSEEK_BASE_URL,
  DeepSeekInterruptedError,
  fetchDeepSeekCompletion,
  isOfficialDeepSeekEndpoint,
  normalizeDeepSeekCompletion,
  normalizeDeepSeekToolCalls,
  toDeepSeekTransportError,
  type DeepSeekCompletion,
  type DeepSeekConfig,
  type DeepSeekToolCall,
  type FetchImplementation,
} from "./deepseek-transport"
import { executeTextTransport } from "./text-generation-transport"

export type DeepSeekGenerateTextClientConfig = DeepSeekConfig

export class DeepSeekGenerateTextClient implements TextGenerationClient {
  readonly capabilities: TextGenerationCapabilities = {
    streaming: true,
    functionTools: true,
    conversationHistory: true,
    structuredOutput: { jsonObject: true, jsonSchema: "best_effort" },
  }

  private readonly baseUrl: string

  constructor(
    private readonly cfg: DeepSeekGenerateTextClientConfig,
    private readonly fetchImpl: FetchImplementation = fetch
  ) {
    this.baseUrl = (cfg.baseUrl ?? DEFAULT_DEEPSEEK_BASE_URL).replace(
      /\/+$/,
      ""
    )
  }

  get model(): string {
    return this.cfg.model
  }

  async execute(
    context: TextGenerationRequest
  ): Promise<TextGenerationResponse> {
    this.validateRequest(context)
    const body = this.buildRequest(context)
    let emittedTextChunk = false
    return executeTextTransport(
      this.model,
      context,
      async (signal) => {
        const response = await fetchDeepSeekCompletion(
          this.cfg,
          this.baseUrl,
          this.fetchImpl,
          body,
          signal
        )
        if (context.stream) {
          return this.readStream(response, context, () => {
            emittedTextChunk = true
          })
        }
        return normalizeDeepSeekCompletion(
          (await response.json()) as DeepSeekCompletion
        )
      },
      () => !emittedTextChunk,
      (error) => toDeepSeekTransportError(this.model, error)
    )
  }

  private validateRequest(context: TextGenerationRequest): void {
    const hasPrompt = typeof context.userPrompt === "string"
    const hasMessages = Array.isArray(context.messages)
    if (
      hasPrompt === hasMessages ||
      (hasMessages && context.messages!.length === 0)
    ) {
      throw new TypeError(
        "Provide either userPrompt or a non-empty messages array, exclusively."
      )
    }
    if (
      context.responseFormat?.type === "json_schema" &&
      context.responseFormat.strict
    ) {
      throw new UnsupportedTextGenerationCapabilityError(
        "strict_json_schema",
        "deepseek"
      )
    }
    const forcedTool =
      context.toolChoice === "required" ||
      typeof context.toolChoice === "object"
    if (forcedTool && context.reasoning?.effort !== "none") {
      throw new UnsupportedTextGenerationCapabilityError(
        "forced_tool_choice_with_reasoning",
        "deepseek"
      )
    }
    if (
      isOfficialDeepSeekEndpoint(this.baseUrl) &&
      context.tools?.some((tool) => tool.function.strict === true)
    ) {
      if (
        !new URL(this.baseUrl).pathname.replace(/\/+$/, "").endsWith("/beta")
      ) {
        throw new UnsupportedTextGenerationCapabilityError(
          "strict_function_tools_without_beta",
          "deepseek"
        )
      }
      if (!context.tools.every((tool) => tool.function.strict === true)) {
        throw new UnsupportedTextGenerationCapabilityError(
          "mixed_strict_function_tools",
          "deepseek"
        )
      }
    }
  }

  private buildRequest(
    context: TextGenerationRequest
  ): Record<string, unknown> {
    const messages = context.messages
      ? context.messages.map((message) => {
          if (message.role === "assistant") {
            return {
              role: "assistant",
              content: message.content,
              reasoning_content: message.reasoningContent,
              tool_calls: message.toolCalls?.map((call) => ({
                id: call.id,
                type: "function",
                function: { name: call.name, arguments: call.arguments },
              })),
            }
          }
          if (message.role === "tool") {
            return {
              role: "tool",
              content: message.content,
              tool_call_id: message.toolCallId,
            }
          }
          return { role: "user", content: message.content }
        })
      : [{ role: "user", content: context.userPrompt!.trim() }]

    const request: Record<string, unknown> = {
      model: this.model,
      messages: [
        { role: "system", content: buildDeepSeekSystemPrompt(context) },
        ...messages,
      ],
      stream: context.stream === true,
    }
    if (typeof context.maxOutputTokens === "number")
      request.max_tokens = context.maxOutputTokens
    if (context.reasoning?.effort)
      request.reasoning_effort =
        context.reasoning.effort === "medium"
          ? "high"
          : context.reasoning.effort
    if (context.responseFormat)
      request.response_format = { type: "json_object" }
    if (context.tools?.length) request.tools = context.tools
    if (context.toolChoice) request.tool_choice = context.toolChoice
    if (context.stream) request.stream_options = { include_usage: true }
    return request
  }

  private async readStream(
    response: Response,
    context: TextGenerationRequest,
    onTextChunkEmitted: () => void
  ): Promise<TextGenerationResponse> {
    if (!response.body)
      throw new DeepSeekInterruptedError(
        "DeepSeek streaming response has no body."
      )
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    let text = ""
    let reasoningContent: string | undefined
    let finishReason: string | undefined
    let usage: unknown
    const toolCalls: DeepSeekToolCall[] = []
    const result = (): TextGenerationResponse => ({
      text: text.trim(),
      reasoningContent,
      finishReason,
      usage: normalizeTokenUsage(usage),
      toolCalls: normalizeDeepSeekToolCalls(toolCalls),
    })

    const consumeEvent = async (event: string): Promise<boolean> => {
      const data = event
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n")
      if (!data) return false
      if (data === "[DONE]") return true
      let payload: DeepSeekCompletion
      try {
        payload = JSON.parse(data) as DeepSeekCompletion
      } catch {
        throw new Error(
          "DeepSeek streaming response contains invalid SSE JSON."
        )
      }
      if (payload.usage) usage = payload.usage
      const choice = payload.choices?.[0]
      checkDeepSeekFinishReason(choice?.finish_reason)
      if (choice?.finish_reason) finishReason = choice.finish_reason
      const delta = choice?.delta
      if (typeof delta?.reasoning_content === "string")
        reasoningContent = (reasoningContent ?? "") + delta.reasoning_content
      if (delta?.tool_calls)
        this.mergeStreamToolCalls(toolCalls, delta.tool_calls)
      if (delta?.content) {
        text += delta.content
        if (context.onTextChunk) {
          onTextChunkEmitted()
          await context.onTextChunk(delta.content)
        }
      }
      return false
    }

    try {
      while (true) {
        const chunk = await reader.read()
        buffer += chunk.done
          ? decoder.decode()
          : decoder.decode(chunk.value, { stream: true })
        const events = buffer.split(/\r?\n\r?\n/)
        buffer = events.pop() ?? ""
        for (const event of events) {
          if (await consumeEvent(event)) return result()
        }
        if (chunk.done) {
          if (buffer.trim() && (await consumeEvent(buffer))) return result()
          throw new DeepSeekInterruptedError(
            "DeepSeek stream closed before [DONE]."
          )
        }
      }
    } finally {
      try {
        await reader.cancel()
      } catch {
        /* A failed stream may already be errored. */
      }
      reader.releaseLock()
    }
  }

  private mergeStreamToolCalls(
    current: DeepSeekToolCall[],
    incoming: DeepSeekToolCall[]
  ): void {
    for (const call of incoming) {
      const index = call.index ?? current.length
      const previous = current[index]
      if (!previous) {
        current[index] = {
          ...call,
          function: call.function ? { ...call.function } : undefined,
        }
        continue
      }
      current[index] = {
        index,
        id: call.id ?? previous.id,
        function: {
          name: call.function?.name ?? previous.function?.name,
          arguments: `${previous.function?.arguments ?? ""}${call.function?.arguments ?? ""}`,
        },
      }
    }
  }
}
