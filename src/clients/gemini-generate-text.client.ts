import { type GenerateContentConfig, GoogleGenAI } from "@google/genai"
import { createTextTransportError, resolveStatusCode } from "../errors"
import type { TextTransportError } from "../errors"
import { normalizeTokenUsage, toPlainObject } from "../helpers"
import type { AIProviderConfigEntry } from "../types"
import type {
  TextGenerationCapabilities,
  TextGenerationClient,
  TextGenerationRequest,
  TextGenerationResponse,
  TextToolCall,
} from "../types/text-generation.request"

export class GeminiGenerateTextClient implements TextGenerationClient {
  readonly capabilities: TextGenerationCapabilities = {
    streaming: true,
    functionTools: true,
    structuredOutput: {
      jsonObject: true,
      jsonSchema: "enforced",
    },
  }

  private ai: GoogleGenAI

  constructor(private readonly cfg: AIProviderConfigEntry) {
    this.ai = new GoogleGenAI({
      apiKey: this.cfg.apiKey,
    })
  }

  async execute(
    context: TextGenerationRequest
  ): Promise<TextGenerationResponse> {
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
      new Error("Text generation failed without a transport error.")
    )
  }

  private async executeOnce(
    context: TextGenerationRequest,
    signal: AbortSignal,
    onTextChunkEmitted: () => void
  ): Promise<TextGenerationResponse> {
    const config = this.buildRequestConfig(context, signal)
    const rawInput = context.userPrompt.trim()

    if (context.stream) {
      const stream = await this.ai.models.generateContentStream({
        model: this.cfg.model,
        contents: rawInput,
        config,
      })

      let fullText = ""
      let lastChunk: unknown = undefined

      for await (const chunk of stream) {
        lastChunk = chunk
        const textChunk =
          chunk && typeof chunk === "object"
            ? ((chunk as { text?: unknown }).text as string | undefined)
            : undefined

        if (!textChunk) continue
        fullText += textChunk
        if (context.onTextChunk) {
          onTextChunkEmitted()
          await context.onTextChunk(textChunk)
        }
      }

      const usageSource =
        lastChunk && typeof lastChunk === "object"
          ? (lastChunk as { usageMetadata?: unknown }).usageMetadata
          : undefined
      const fallbackText =
        lastChunk && typeof lastChunk === "object"
          ? (lastChunk as { text?: unknown }).text
          : undefined

      return {
        text:
          fullText.trim() ||
          (typeof fallbackText === "string" ? fallbackText.trim() : ""),

        usage: normalizeTokenUsage(usageSource),
        toolCalls: this.resolveToolCalls(lastChunk),
      }
    }

    const response = await this.ai.models.generateContent({
      model: this.cfg.model,
      contents: rawInput,
      config,
    })

    return {
      text: response.text?.trim() || "",
      usage: normalizeTokenUsage(response.usageMetadata),
      toolCalls: this.resolveToolCalls(response),
    }
  }

  private toTransportError(error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "Unexpected Google GenAI text transport error."
    const statusCode = resolveStatusCode(error)

    return createTextTransportError({
      model: this.cfg.model,
      message,
      statusCode,
      raw:
        error && typeof error === "object" ? toPlainObject(error) : { message },
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

  private buildRequestConfig(
    context: TextGenerationRequest,
    signal: AbortSignal
  ): GenerateContentConfig {
    const config: GenerateContentConfig = {
      abortSignal: signal,
    }

    config.systemInstruction = context.systemPrompt.trim()

    if (typeof context.maxOutputTokens === "number") {
      config.maxOutputTokens = context.maxOutputTokens
    }

    if (context.responseFormat) {
      config.responseMimeType = "application/json"
      config.responseJsonSchema = context.responseFormat.schema
    }

    if (context.tools?.length) {
      config.tools = [
        {
          functionDeclarations: context.tools.map((tool) => tool.function),
        },
      ]
    }

    return config
  }

  private resolveToolCalls(response: unknown): TextToolCall[] | undefined {
    if (!response || typeof response !== "object") return undefined

    const functionCalls = (response as { functionCalls?: unknown })
      .functionCalls
    if (!Array.isArray(functionCalls) || functionCalls.length === 0) {
      return undefined
    }

    const toolCalls = functionCalls.flatMap((call): TextToolCall[] => {
      if (!call || typeof call !== "object") return []
      const value = call as Record<string, unknown>
      if (typeof value.name !== "string" || !value.name) return []

      return [
        {
          id: typeof value.id === "string" ? value.id : value.name,
          name: value.name,
          arguments: JSON.stringify(value.args ?? {}),
        },
      ]
    })

    return toolCalls.length > 0 ? toolCalls : undefined
  }
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
