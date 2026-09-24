import { DeepSeekGenerateMultimodalClient } from "../clients/deepseek-generate-multimodal.client"
import { GeminiGenerateMultimodalClient } from "../clients/gemini-generate-multimodal.client"
import { UnsupportedGenerationProviderError } from "../errors"
import type {
  MultimodalGenerationClient,
  MultimodalGenerationCapabilities,
  MultimodalGenerationRequest,
} from "../types/multimodal-generation.request"
import type { TextGenerationResponse } from "../types/text-generation.request"

export type MultimodalGenerationAdapterConfig = {
  provider: "deepseek" | "gemini"
  apiKey: string
  model: string
  baseUrl?: string
}

export class MultimodalGenerationAdapter implements MultimodalGenerationClient {
  private readonly client: MultimodalGenerationClient

  constructor(config: MultimodalGenerationAdapterConfig) {
    switch (config.provider) {
      case "gemini":
        this.client = new GeminiGenerateMultimodalClient(config)
        break
      case "deepseek":
        this.client = new DeepSeekGenerateMultimodalClient(config)
        break
      default:
        throw new UnsupportedGenerationProviderError(
          "multimodal",
          String((config as { provider?: unknown }).provider)
        )
    }
  }

  get capabilities(): MultimodalGenerationCapabilities {
    return this.client.capabilities
  }

  execute(
    context: MultimodalGenerationRequest
  ): Promise<TextGenerationResponse> {
    return this.client.execute(context)
  }
}
