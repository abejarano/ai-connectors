import type { ToolListUnion } from "@google/genai"

export type StructuredOutputFormat = {
  type: "json_schema"
  name: string
  schema: Record<string, unknown>
  strict?: boolean
}

export type TextRetryPolicy = {
  maxRetries?: number
  retryDelayMs?: number
}

export type TextGenerationRequest = {
  systemPrompt: string
  userPrompt: string
  maxOutputTokens?: number
  responseFormat?: StructuredOutputFormat
  signal?: AbortSignal
  reasoning?: {
    effort?: "low" | "medium" | "high"
  }
  stream?: boolean
  onTextChunk?: (chunk: string) => void | Promise<void>
  timeoutMs?: number
  retryPolicy?: TextRetryPolicy
  tools?: ToolListUnion
}
