export {
  ImageGenerationAdapter,
  type ImageGenerationAdapterConfig,
} from "./adapters/image-generation.adapter"
export {
  TextGenerationAdapter,
  type TextGenerationAdapterConfig,
} from "./adapters/text-generation.adapter"
export {
  VideoGenerationAdapter,
  type VideoGenerationAdapterConfig,
} from "./adapters/video-generation.adapter"

export type {
  ImageAssetRef,
  ImageGenerationCapabilities,
  ImageGenerationClient,
  ImageGenerationRequest,
  ImageGenerationResponse,
} from "./types/image-generation.request"
export type {
  StructuredOutputFormat,
  TextFunctionTool,
  TextGenerationCapabilities,
  TextGenerationClient,
  TextGenerationRequest,
  TextGenerationResponse,
  TextRetryPolicy,
  TextToolCall,
  TextToolChoice,
} from "./types/text-generation.request"

export {
  UnsupportedGenerationProviderError,
  UnsupportedTextGenerationCapabilityError,
} from "./errors"

export type {
  VideoAssetRef,
  VideoGenerationCapabilities,
  VideoGenerationClient,
  VideoGenerationRequest,
  VideoGenerationResponse,
} from "./types/video-generation.request"
