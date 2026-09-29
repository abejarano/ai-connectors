export type {
  ImageUsage,
  TokenUsage,
  VideoResolution,
  VideoUsage,
} from "./usage"

/** @deprecated usa `TokenUsage`. */
export type { TokenUsage as TextUsage } from "./usage"

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
