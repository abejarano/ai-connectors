import type { TextRetryPolicy } from "./text-generation.request"

export type ImageGenerationRequest = {
  prompt: string
  outputPath: string
  width: number
  height: number

  negativePrompt?: string
  signal?: AbortSignal
  timeoutMs?: number
  retryPolicy?: TextRetryPolicy
}
