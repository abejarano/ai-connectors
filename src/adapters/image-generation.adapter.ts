import { GeminiGenerateImageClient } from "../clients/gemini-generate-image.client"
import { UnsupportedGenerationProviderError } from "../errors"
import type {
  ImageGenerationClient,
  ImageGenerationCapabilities,
  ImageGenerationRequest,
  ImageGenerationResponse,
} from "../types/image-generation.request"

export type ImageGenerationAdapterConfig = {
  provider: "gemini"
  apiKey: string
  model: string
}

export class ImageGenerationAdapter implements ImageGenerationClient {
  private readonly client: ImageGenerationClient

  constructor(config: ImageGenerationAdapterConfig) {
    if (config.provider !== "gemini") {
      throw new UnsupportedGenerationProviderError("image", config.provider)
    }
    this.client = new GeminiGenerateImageClient(config)
  }

  get capabilities(): ImageGenerationCapabilities {
    return this.client.capabilities
  }

  execute(context: ImageGenerationRequest): Promise<ImageGenerationResponse> {
    return this.client.execute(context)
  }
}
