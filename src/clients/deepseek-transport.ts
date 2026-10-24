import {
  createTextTransportError,
  resolveStatusCode,
  TextTransportError,
} from "../errors"
import { normalizeTokenUsage, toPlainObject } from "../helpers"
import type { AIProviderConfigEntry } from "../types"
import type {
  StructuredOutputFormat,
  TextGenerationResponse,
  TextToolCall,
} from "../types/text-generation.request"

export const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com"
export type DeepSeekConfig = AIProviderConfigEntry & { baseUrl?: string }
export type FetchImplementation = (
  input: string,
  init?: RequestInit
) => Promise<Response>

export type DeepSeekToolCall = {
  index?: number
  id?: string
  function?: { name?: string; arguments?: string }
}

export type DeepSeekCompletion = {
  choices?: Array<{
    finish_reason?: string | null
    message?: {
      content?: string | null
      reasoning_content?: string | null
      tool_calls?: DeepSeekToolCall[]
    }
    delta?: {
      content?: string | null
      reasoning_content?: string | null
      tool_calls?: DeepSeekToolCall[]
    }
  }>
  usage?: unknown
}

class DeepSeekHttpError extends Error {
  constructor(
    readonly status: number,
    readonly response: unknown
  ) {
    const diagnostic =
      response && typeof response === "object"
        ? (response as { error?: { message?: unknown } }).error?.message
        : undefined
    super(
      `DeepSeek request failed with status ${status}.${typeof diagnostic === "string" ? ` ${diagnostic}` : ""}`
    )
    this.name = "DeepSeekHttpError"
  }
}

export class DeepSeekInterruptedError extends Error {
  constructor(
    message: string,
    readonly finishReason?: string
  ) {
    super(message)
    this.name = "DeepSeekInterruptedError"
  }
}

export const checkDeepSeekFinishReason = (
  reason: string | null | undefined
): void => {
  if (reason === "aborted" || reason === "insufficient_system_resource") {
    throw new DeepSeekInterruptedError(
      `DeepSeek generation interrupted: ${reason}.`,
      reason
    )
  }
}

export const isOfficialDeepSeekEndpoint = (baseUrl: string): boolean =>
  new URL(baseUrl).hostname === "api.deepseek.com"

export const fetchDeepSeekCompletion = async (
  config: DeepSeekConfig,
  baseUrl: string,
  fetchImpl: FetchImplementation,
  body: Record<string, unknown>,
  signal: AbortSignal
): Promise<Response> => {
  const response = await fetchImpl(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  })
  if (!response.ok) {
    const text = await response.text()
    let payload: unknown = text
    try {
      payload = JSON.parse(text)
    } catch {
      /* Preserve non-JSON proxy responses. */
    }
    throw new DeepSeekHttpError(response.status, payload)
  }
  return response
}

export const toDeepSeekTransportError = (
  model: string,
  error: unknown
): TextTransportError => {
  if (error instanceof TextTransportError) return error
  const message =
    error instanceof Error
      ? error.message
      : "Unexpected DeepSeek transport error."
  return createTextTransportError({
    model,
    message,
    statusCode: resolveStatusCode(error),
    retryable: error instanceof DeepSeekInterruptedError ? true : undefined,
    raw:
      error instanceof DeepSeekHttpError
        ? { status: error.status, response: error.response }
        : error && typeof error === "object"
          ? toPlainObject(error)
          : { message },
    cause: error,
  })
}

export const normalizeDeepSeekToolCalls = (
  calls?: DeepSeekToolCall[]
): TextToolCall[] | undefined => {
  const normalized = calls?.flatMap((call): TextToolCall[] =>
    call.function?.name
      ? [
          {
            id: call.id ?? call.function.name,
            name: call.function.name,
            arguments: call.function.arguments ?? "{}",
          },
        ]
      : []
  )
  return normalized?.length ? normalized : undefined
}

export const normalizeDeepSeekCompletion = (
  completion: DeepSeekCompletion
): TextGenerationResponse => {
  const choice = completion.choices?.[0]
  if (!choice?.message)
    throw new Error("DeepSeek response contains no completion message.")
  checkDeepSeekFinishReason(choice.finish_reason)
  return {
    text: choice.message.content?.trim() ?? "",
    usage: normalizeTokenUsage(completion.usage),
    toolCalls: normalizeDeepSeekToolCalls(choice.message.tool_calls),
    reasoningContent: choice.message.reasoning_content ?? undefined,
    finishReason: choice.finish_reason ?? undefined,
  }
}

export const buildDeepSeekSystemPrompt = (context: {
  systemPrompt: string
  responseFormat?: StructuredOutputFormat
}): string => {
  const prompt = context.systemPrompt.trim()
  const format = context.responseFormat
  if (!format) return prompt
  if (format.type === "json_object")
    return [prompt, "Return only a JSON object."].join("\n\n")
  return [
    prompt,
    "Return only a JSON object.",
    `Target schema '${format.name}' (guidance only):`,
    JSON.stringify(format.schema),
  ].join("\n\n")
}
