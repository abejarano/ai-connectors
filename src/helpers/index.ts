import type { TokenUsage } from "../types"

export const toPlainObject = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object") return {}
  try {
    const serialized = JSON.parse(JSON.stringify(value)) as unknown
    if (
      !serialized ||
      typeof serialized !== "object" ||
      Array.isArray(serialized)
    ) {
      return {}
    }
    return serialized as Record<string, unknown>
  } catch {
    return {}
  }
}

export const normalizeTokenUsage = (usage: unknown): TokenUsage | undefined => {
  if (!usage || typeof usage !== "object") return undefined
  const value = usage as Record<string, unknown>

  // Formas genéricas (OpenAI/DeepSeek/Responses): el razonamiento ya viene
  // incluido dentro del recuento de salida.
  const genericInput = readNumber(
    value.input_tokens,
    value.prompt_tokens,
    value.inputTokenCount
  )
  const genericOutput = readNumber(value.output_tokens, value.completion_tokens)

  // Formas Gemini: `candidatesTokenCount` deja fuera los thoughts y
  // `promptTokenCount` deja fuera los resultados de herramientas, pero el
  // proveedor factura y suma ambos. Cada campo se resuelve por su propia clave
  // para no sumar dos veces si un payload mezcla ambas convenciones.
  const geminiPrompt = readNumber(value.promptTokenCount)
  const geminiCandidates = readNumber(value.candidatesTokenCount)
  const geminiReasoning = readNumber(value.thoughtsTokenCount)

  const reasoningTokens = readNumber(
    readNestedNumber(value, "completion_tokens_details", "reasoning_tokens"),
    readNestedNumber(value, "output_tokens_details", "reasoning_tokens"),
    geminiReasoning
  )

  const promptTokens = genericInput ?? geminiPrompt
  const toolUsePromptTokens =
    genericInput === undefined
      ? readNumber(value.toolUsePromptTokenCount)
      : undefined

  const inputTokens =
    promptTokens === undefined && toolUsePromptTokens === undefined
      ? undefined
      : (promptTokens ?? 0) + (toolUsePromptTokens ?? 0)

  const completionTokens = genericOutput ?? geminiCandidates
  const reasoningAsOutput =
    genericOutput === undefined ? geminiReasoning : undefined

  const outputTokens =
    completionTokens === undefined && reasoningAsOutput === undefined
      ? undefined
      : (completionTokens ?? 0) + (reasoningAsOutput ?? 0)

  const cachedInputTokens = readNumber(
    readNestedNumber(value, "input_tokens_details", "cached_tokens"),
    readNestedNumber(value, "prompt_tokens_details", "cached_tokens"),
    value.prompt_cache_hit_tokens,
    value.cachedContentTokenCount
  )

  const declaredTotal = readNumber(value.total_tokens, value.totalTokenCount)
  const totalTokens =
    declaredTotal ??
    (inputTokens !== undefined && outputTokens !== undefined
      ? inputTokens + outputTokens
      : undefined)

  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    totalTokens === undefined &&
    cachedInputTokens === undefined &&
    reasoningTokens === undefined
  ) {
    return { raw: usage }
  }

  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningTokens,
    totalTokens,
    raw: usage,
  }
}

const readNumber = (...values: unknown[]): number | undefined => {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value
  }

  return undefined
}

const readNestedNumber = (
  source: Record<string, unknown>,
  container: string,
  key: string
): number | undefined => {
  const nested = source[container]
  if (!nested || typeof nested !== "object") return undefined

  return readNumber((nested as Record<string, unknown>)[key])
}
