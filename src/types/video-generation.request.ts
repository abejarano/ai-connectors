import type { TextRetryPolicy } from "./text-generation.request"

export type VideoAssetRef = {
  kind: "file"
  path: string
}

export type VideoGenerationResponse = {
  asset: VideoAssetRef
  mimeType: string
  sizeBytes: number
  durationSeconds: number
}

export type VideoGenerationCapabilities = {
  provider: "gemini"
  negativePrompt: boolean
  polling: boolean
}

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

export interface VideoGenerationClient {
  readonly capabilities: VideoGenerationCapabilities
  execute(context: VideoGenerationRequest): Promise<VideoGenerationResponse>
}
