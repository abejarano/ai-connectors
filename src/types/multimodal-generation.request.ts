import type { ImageInput } from "./image-input"
import type {
  StructuredOutputFormat,
  TextGenerationResponse,
} from "./text-generation.request"

/** @deprecated usa `ImageInput`. */
export type MultimodalInputImage = ImageInput

export type MultimodalGenerationRequest = {
  systemPrompt: string
  userPrompt: string
  images: readonly MultimodalInputImage[]
  maxOutputTokens?: number
  responseFormat?: StructuredOutputFormat
  signal?: AbortSignal
}

export type MultimodalGenerationCapabilities = {
  provider: "deepseek" | "gemini"
  imageInput: boolean
  structuredOutput: {
    jsonObject: boolean
    jsonSchema: "enforced" | "best_effort" | "unsupported"
  }
}

export interface MultimodalGenerationClient {
  readonly capabilities: MultimodalGenerationCapabilities
  readonly model: string

  execute(context: MultimodalGenerationRequest): Promise<TextGenerationResponse>
}
