import { DeepSeekGenerateTextClient } from "../clients/deepseek-generate-text.client"
import { GeminiGenerateTextClient } from "../clients/gemini-generate-text.client"
import { UnsupportedGenerationProviderError } from "../errors"
import type {
  TextGenerationCapabilities,
  TextGenerationClient,
  TextGenerationRequest,
  TextGenerationResponse,
} from "../types/text-generation.request"

type TextGenerationAdapterConfig = {
  provider: "deepseek" | "gemini"
  apiKey: string
  model: string
  baseUrl?: string
}

export class TextGenerationAdapter implements TextGenerationClient {
  private readonly client: TextGenerationClient

  constructor(config: TextGenerationAdapterConfig) {
    switch (config.provider) {
      case "gemini":
        this.client = new GeminiGenerateTextClient(config)
        break
      case "deepseek":
        this.client = new DeepSeekGenerateTextClient(config)
        break
      default:
        throw new UnsupportedGenerationProviderError(
          "text",
          String((config as { provider?: unknown }).provider)
        )
    }
  }

  get capabilities(): TextGenerationCapabilities {
    return this.client.capabilities
  }

  execute(context: TextGenerationRequest): Promise<TextGenerationResponse> {
    return this.client.execute(context)
  }
}
