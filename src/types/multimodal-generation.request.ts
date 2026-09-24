import type {
  StructuredOutputFormat,
  TextGenerationResponse,
} from "./text-generation.request"

export type MultimodalInputImage = {
  bytes: Uint8Array
  mimeType: string
}

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
  execute(context: MultimodalGenerationRequest): Promise<TextGenerationResponse>
}
