import type { TextRetryPolicy } from "./text-generation.request"

export type VideoGenerationRequest = {
  prompt: string
  outputPath: string
  width: number
  height: number
  durationSeconds?: number

  negativePrompt?: string
  timeoutMs?: number
  signal?: AbortSignal

  pollingPolicy?: {
    maxAttempts: number
    delayMs: number
  }
}
