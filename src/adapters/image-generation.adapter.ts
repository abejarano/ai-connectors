import { GeminiGenerateImageClient } from "../clients/gemini-generate-image.client"
import { UnsupportedGenerationProviderError } from "../errors"
import type {
  ImageEditRequest,
  ImageGenerationCapabilities,
  ImageGenerationClient,
  ImageGenerationRequest,
  ImageGenerationResponse,
} from "../types/image-generation.request"

export type ImageGenerationAdapterConfig = {
  provider: "gemini"
  apiKey: string
  model: string
  /**
   * Habilita `edit()` con modelos de imagen no verificados. Se propaga al
   * cliente del proveedor.
   */
  allowUnverifiedImageEdit?: boolean
}

export class ImageGenerationAdapter implements ImageGenerationClient {
  private readonly client: ImageGenerationClient

  constructor(config: ImageGenerationAdapterConfig) {
    if (config.provider !== "gemini") {
      throw new UnsupportedGenerationProviderError("image", config.provider)
    }
    this.client = new GeminiGenerateImageClient(config)
  }

  get model(): string {
    return this.client.model
  }

  get capabilities(): ImageGenerationCapabilities {
    return this.client.capabilities
  }

  execute(context: ImageGenerationRequest): Promise<ImageGenerationResponse> {
    return this.client.execute(context)
  }

  edit(context: ImageEditRequest): Promise<ImageGenerationResponse> {
    return this.client.edit(context)
  }
}
