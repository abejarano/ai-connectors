import type { TextUsage } from "../types"

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

export const normalizeTokenUsage = (usage: unknown): TextUsage | undefined => {
  if (!usage || typeof usage !== "object") return undefined
  const value = usage as Record<string, unknown>

  const directInput =
    typeof value.input_tokens === "number"
      ? value.input_tokens
      : typeof value.prompt_tokens === "number"
        ? value.prompt_tokens
        : typeof value.inputTokenCount === "number"
          ? value.inputTokenCount
          : typeof value.promptTokenCount === "number"
            ? value.promptTokenCount
            : undefined

  const directOutput =
    typeof value.output_tokens === "number"
      ? value.output_tokens
      : typeof value.completion_tokens === "number"
        ? value.completion_tokens
        : typeof value.candidatesTokenCount === "number"
          ? value.candidatesTokenCount
          : undefined

  const directTotal =
    typeof value.total_tokens === "number"
      ? value.total_tokens
      : typeof value.totalTokenCount === "number"
        ? value.totalTokenCount
        : undefined

  const cachedInputTokens =
    value.input_tokens_details &&
    typeof value.input_tokens_details === "object" &&
    typeof (value.input_tokens_details as Record<string, unknown>)
      .cached_tokens === "number"
      ? ((value.input_tokens_details as Record<string, unknown>)
          .cached_tokens as number)
      : typeof value.cachedContentTokenCount === "number"
        ? value.cachedContentTokenCount
        : undefined

  const inputTokens =
    directInput !== undefined ? directInput : cachedInputTokens

  const totalTokens =
    directTotal !== undefined
      ? directTotal
      : typeof inputTokens === "number" && typeof directOutput === "number"
        ? inputTokens + directOutput
        : undefined

  if (
    inputTokens === undefined &&
    directOutput === undefined &&
    totalTokens === undefined &&
    cachedInputTokens === undefined
  ) {
    return { raw: usage }
  }

  return {
    inputTokens,
    outputTokens: directOutput,
    totalTokens,
    cachedInputTokens,
    raw: usage,
  }
}
