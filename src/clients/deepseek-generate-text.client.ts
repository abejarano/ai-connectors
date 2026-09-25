import type { TextTransportError } from "../errors"
import {
  createTextTransportError,
  resolveStatusCode,
  UnsupportedTextGenerationCapabilityError,
} from "../errors"
import { normalizeTokenUsage, toPlainObject } from "../helpers"
import type { AIProviderConfigEntry } from "../types"
import type {
  TextGenerationCapabilities,
  TextGenerationClient,
  TextGenerationRequest,
  TextGenerationResponse,
  TextToolCall,
} from "../types/text-generation.request"

const DEFAULT_BASE_URL = "https://api.deepseek.com"

export type DeepSeekGenerateTextClientConfig = AIProviderConfigEntry & {
  baseUrl?: string
}

type DeepSeekUsage = {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  prompt_tokens_details?: { cached_tokens?: number }
}

type DeepSeekToolCall = {
  index?: number
  id?: string
  function?: {
    name?: string
    arguments?: string
  }
}

type DeepSeekCompletion = {
  choices?: Array<{
    message?: {
      content?: string | null
      tool_calls?: DeepSeekToolCall[]
    }
    delta?: {
      content?: string | null
      tool_calls?: DeepSeekToolCall[]
    }
  }>
  usage?: DeepSeekUsage
}

type FetchImplementation = (
  input: string,
  init?: RequestInit
) => Promise<Response>

class DeepSeekHttpError extends Error {
  constructor(
    readonly status: number,
    readonly response: unknown
  ) {
    super(`DeepSeek request failed with status ${status}.`)
    this.name = DeepSeekHttpError.name
  }
}

export class DeepSeekGenerateTextClient implements TextGenerationClient {
  readonly capabilities: TextGenerationCapabilities = {
    streaming: true,
    functionTools: true,
    structuredOutput: {
      jsonObject: true,
      jsonSchema: "best_effort",
    },
  }

  private readonly baseUrl: string

  constructor(
    private readonly cfg: DeepSeekGenerateTextClientConfig,
    private readonly fetchImpl: FetchImplementation = fetch
  ) {
    this.baseUrl = (cfg.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "")
  }

  get model(): string {
    return this.cfg.model
  }

  async execute(
    context: TextGenerationRequest
  ): Promise<TextGenerationResponse> {
    if (
      context.responseFormat?.type === "json_schema" &&
      context.responseFormat.strict
    ) {
      throw new UnsupportedTextGenerationCapabilityError(
        "strict_json_schema",
        "deepseek"
      )
    }

    const maxRetries = normalizeNonNegativeInteger(
      context.retryPolicy?.maxRetries
    )
    const retryDelayMs = normalizeNonNegativeInteger(
      context.retryPolicy?.retryDelayMs
    )
    let lastError: TextTransportError | undefined
    let emittedTextChunk = false

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const requestSignal = this.createRequestSignal(context)

      try {
        return await this.executeOnce(context, requestSignal.signal, () => {
          emittedTextChunk = true
        })
      } catch (error) {
        const transportError = this.toTransportError(
          requestSignal.didTimeout()
            ? createTimeoutError(context.timeoutMs!)
            : error
        )
        lastError = transportError

        if (
          context.signal?.aborted ||
          (context.stream && emittedTextChunk) ||
          transportError.details?.retryable !== true ||
          attempt === maxRetries
        ) {
          throw transportError
        }

        if (retryDelayMs > 0) {
          await waitForRetry(retryDelayMs, context.signal)
          if (context.signal?.aborted) throw transportError
        }
      } finally {
        requestSignal.dispose()
      }
    }

    throw (
      lastError ??
      new Error("DeepSeek text generation failed without a transport error.")
    )
  }

  private async executeOnce(
    context: TextGenerationRequest,
    signal: AbortSignal,
    onTextChunkEmitted: () => void
  ): Promise<TextGenerationResponse> {
    const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.cfg.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(this.buildRequest(context)),
      signal,
    })

    if (!response.ok) {
      throw new DeepSeekHttpError(
        response.status,
        await readResponseBody(response)
      )
    }

    if (context.stream) {
      return this.readStream(response, context, onTextChunkEmitted)
    }

    const completion = (await response.json()) as DeepSeekCompletion
    const message = completion.choices?.[0]?.message

    return {
      text: message?.content?.trim() ?? "",
      usage: normalizeTokenUsage(completion.usage),
      toolCalls: this.normalizeToolCalls(message?.tool_calls),
    }
  }

  private buildRequest(
    context: TextGenerationRequest
  ): Record<string, unknown> {
    const systemPrompt = this.buildSystemPrompt(context)
    const request: Record<string, unknown> = {
      model: this.cfg.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: context.userPrompt.trim() },
      ],
      stream: context.stream === true,
    }

    if (typeof context.maxOutputTokens === "number") {
      request.max_tokens = context.maxOutputTokens
    }

    if (context.reasoning?.effort) {
      request.reasoning_effort = this.toReasoningEffort(
        context.reasoning.effort
      )
    }

    if (context.responseFormat) {
      request.response_format = { type: "json_object" }
    }

    if (context.tools?.length) {
      request.tools = context.tools
    }

    if (context.toolChoice) {
      request.tool_choice = context.toolChoice
    }

    if (context.stream) {
      request.stream_options = { include_usage: true }
    }

    return request
  }

  private buildSystemPrompt(context: TextGenerationRequest): string {
    const prompt = context.systemPrompt.trim()
    const responseFormat = context.responseFormat
    if (!responseFormat) return prompt

    if (responseFormat.type === "json_object") {
      return [prompt, "Return only a JSON object."].join("\n\n")
    }

    return [
      prompt,
      "Return only a JSON object.",
      `Target schema '${responseFormat.name}' (guidance only):`,
      JSON.stringify(responseFormat.schema),
    ].join("\n\n")
  }

  private toReasoningEffort(
    effort: NonNullable<
      NonNullable<TextGenerationRequest["reasoning"]>["effort"]
    >
  ): "none" | "low" | "high" | "max" {
    if (effort === "none" || effort === "low" || effort === "max") {
      return effort
    }
    return "high"
  }

  private async readStream(
    response: Response,
    context: TextGenerationRequest,
    onTextChunkEmitted: () => void
  ): Promise<TextGenerationResponse> {
    if (!response.body) {
      throw new Error("DeepSeek streaming response has no body.")
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    let text = ""
    let usage: DeepSeekUsage | undefined
    const toolCalls: DeepSeekToolCall[] = []

    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      buffer += decoder.decode(chunk.value, { stream: true })

      const events = buffer.split(/\r?\n\r?\n/)
      buffer = events.pop() ?? ""

      for (const event of events) {
        const done = await this.consumeStreamEvent(
          event,
          context,
          onTextChunkEmitted,
          (part) => {
            text += part
          },
          (nextUsage) => {
            usage = nextUsage
          },
          toolCalls
        )
        if (done) {
          return {
            text: text.trim(),
            usage: normalizeTokenUsage(usage),
            toolCalls: this.normalizeToolCalls(toolCalls),
          }
        }
      }
    }

    if (buffer.trim()) {
      await this.consumeStreamEvent(
        buffer,
        context,
        onTextChunkEmitted,
        (part) => {
          text += part
        },
        (nextUsage) => {
          usage = nextUsage
        },
        toolCalls
      )
    }

    return {
      text: text.trim(),
      usage: normalizeTokenUsage(usage),
      toolCalls: this.normalizeToolCalls(toolCalls),
    }
  }

  private async consumeStreamEvent(
    event: string,
    context: TextGenerationRequest,
    onTextChunkEmitted: () => void,
    appendText: (part: string) => void,
    setUsage: (usage: DeepSeekUsage) => void,
    toolCalls: DeepSeekToolCall[]
  ): Promise<boolean> {
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
      throw new Error("DeepSeek streaming response contains invalid SSE JSON.")
    }

    if (payload.usage) setUsage(payload.usage)
    const delta = payload.choices?.[0]?.delta
    if (delta?.tool_calls) {
      this.mergeStreamToolCalls(toolCalls, delta.tool_calls)
    }

    const textChunk = delta?.content
    if (!textChunk) return false

    appendText(textChunk)
    if (context.onTextChunk) {
      onTextChunkEmitted()
      await context.onTextChunk(textChunk)
    }
    return false
  }

  private normalizeToolCalls(
    calls: DeepSeekToolCall[] | undefined
  ): TextToolCall[] | undefined {
    if (!calls?.length) return undefined

    const normalized = calls.flatMap((call): TextToolCall[] => {
      const name = call.function?.name
      if (!name) return []
      return [
        {
          id: call.id ?? name,
          name,
          arguments: call.function?.arguments ?? "{}",
        },
      ]
    })

    return normalized.length > 0 ? normalized : undefined
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

  private toTransportError(error: unknown): TextTransportError {
    const statusCode = resolveStatusCode(error)
    const message =
      error instanceof Error
        ? error.message
        : "Unexpected DeepSeek text transport error."

    return createTextTransportError({
      model: this.cfg.model,
      message,
      statusCode,
      raw:
        error instanceof DeepSeekHttpError
          ? { status: error.status, response: error.response }
          : error && typeof error === "object"
            ? toPlainObject(error)
            : { message },
      cause: error,
    })
  }

  private createRequestSignal(context: TextGenerationRequest): {
    signal: AbortSignal
    didTimeout: () => boolean
    dispose: () => void
  } {
    const controller = new AbortController()
    let timedOut = false
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const abortFromSource = () => controller.abort(context.signal?.reason)

    if (context.signal) {
      if (context.signal.aborted) {
        abortFromSource()
      } else {
        context.signal.addEventListener("abort", abortFromSource, {
          once: true,
        })
      }
    }

    if (typeof context.timeoutMs === "number" && context.timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        timedOut = true
        controller.abort()
      }, context.timeoutMs)
    }

    return {
      signal: controller.signal,
      didTimeout: () => timedOut,
      dispose: () => {
        if (timeoutId) clearTimeout(timeoutId)
        context.signal?.removeEventListener("abort", abortFromSource)
      },
    }
  }
}

const readResponseBody = async (response: Response): Promise<unknown> => {
  const contentType = response.headers.get("content-type") ?? ""
  if (contentType.includes("application/json")) {
    return response.json()
  }
  return response.text()
}

const normalizeNonNegativeInteger = (value: number | undefined): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return 0
  }
  return Math.floor(value)
}

const createTimeoutError = (timeoutMs: number): Error => {
  const error = new Error(`Text generation timed out after ${timeoutMs}ms.`)
  error.name = "TimeoutError"
  return error
}

const waitForRetry = async (
  retryDelayMs: number,
  signal?: AbortSignal
): Promise<void> => {
  if (signal?.aborted) return

  await new Promise<void>((resolve) => {
    const timeoutId = setTimeout(done, retryDelayMs)

    function done() {
      clearTimeout(timeoutId)
      signal?.removeEventListener("abort", done)
      resolve()
    }

    signal?.addEventListener("abort", done, { once: true })
  })
}
