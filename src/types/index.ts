export type TextUsage = {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  cachedInputTokens?: number
  estimatedCostUsd?: number
  raw?: unknown
}

export type AIExecutionMeta = {
  model?: string
  remainingRequests?: number
  remainingTokens?: number
  resetAtUnixMs?: number
}

export type AIExecutionResult<T> = {
  data: T
  meta?: AIExecutionMeta
}

export type AIProviderConfigEntry = {
  apiKey: string
  model: string
  reasoning?: {
    effort?: "low" | "medium" | "high"
  }
}
