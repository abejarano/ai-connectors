import type { TextRetryPolicy } from "./text-generation.request"
import type { ImageUsage } from "./usage"

export type ImageAssetRef = {
  kind: "file"
  path: string
}

export type ImageGenerationResponse = {
  asset: ImageAssetRef
  mimeType: string
  sizeBytes: number
  width: number
  height: number
  usage?: ImageUsage
}

export type ImageGenerationCapabilities = {
  provider: "gemini"
  negativePrompt: boolean
  aspectRatio: boolean
}

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

export interface ImageGenerationClient {
  readonly capabilities: ImageGenerationCapabilities
  readonly model: string

  execute(context: ImageGenerationRequest): Promise<ImageGenerationResponse>
}
