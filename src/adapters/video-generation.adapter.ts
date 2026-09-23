import { GeminiGenerateVideoClient } from "../clients/gemini-generate-video.client"
import { UnsupportedGenerationProviderError } from "../errors"
import type {
  VideoGenerationClient,
  VideoGenerationCapabilities,
  VideoGenerationRequest,
  VideoGenerationResponse,
} from "../types/video-generation.request"

export type VideoGenerationAdapterConfig = {
  provider: "gemini"
  apiKey: string
  model: string
}

export class VideoGenerationAdapter implements VideoGenerationClient {
  private readonly client: VideoGenerationClient

  constructor(config: VideoGenerationAdapterConfig) {
    if (config.provider !== "gemini") {
      throw new UnsupportedGenerationProviderError("video", config.provider)
    }
    this.client = new GeminiGenerateVideoClient(config)
  }

  get capabilities(): VideoGenerationCapabilities {
    return this.client.capabilities
  }

  execute(context: VideoGenerationRequest): Promise<VideoGenerationResponse> {
    return this.client.execute(context)
  }
}
