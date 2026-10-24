import { Buffer } from "node:buffer"
import { UnsupportedTextGenerationCapabilityError } from "../errors"
import type {
  MultimodalGenerationCapabilities,
  MultimodalGenerationClient,
  MultimodalGenerationRequest,
} from "../types/multimodal-generation.request"
import type { TextGenerationResponse } from "../types/text-generation.request"
import {
  buildDeepSeekSystemPrompt,
  DEFAULT_DEEPSEEK_BASE_URL,
  fetchDeepSeekCompletion,
  isOfficialDeepSeekEndpoint,
  normalizeDeepSeekCompletion,
  toDeepSeekTransportError,
  type DeepSeekCompletion,
  type DeepSeekConfig,
  type FetchImplementation,
} from "./deepseek-transport"
import { executeTextTransport } from "./text-generation-transport"

export type DeepSeekGenerateMultimodalClientConfig = DeepSeekConfig

const VISION_MODELS = new Set([
  "deepseek-flash",
  "deepseek-v4-flash",
  "deepseek-v4-flash-vision-exp",
])

export class DeepSeekGenerateMultimodalClient implements MultimodalGenerationClient {
  readonly capabilities: MultimodalGenerationCapabilities
  private readonly baseUrl: string

  constructor(
    private readonly cfg: DeepSeekGenerateMultimodalClientConfig,
    private readonly fetchImpl: FetchImplementation = fetch
  ) {
    this.baseUrl = (cfg.baseUrl ?? DEFAULT_DEEPSEEK_BASE_URL).replace(
      /\/+$/,
      ""
    )
    this.capabilities = {
      provider: "deepseek",
      imageInput:
        !isOfficialDeepSeekEndpoint(this.baseUrl) ||
        VISION_MODELS.has(cfg.model),
      structuredOutput: { jsonObject: true, jsonSchema: "best_effort" },
    }
  }

  get model(): string {
    return this.cfg.model
  }

  async execute(
    context: MultimodalGenerationRequest
  ): Promise<TextGenerationResponse> {
    if (
      context.responseFormat?.type === "json_schema" &&
      context.responseFormat.strict
    ) {
      throw new UnsupportedTextGenerationCapabilityError(
        "strict_json_schema",
        "deepseek"
      )
    }
    if (context.images.length && !this.capabilities.imageInput) {
      throw new UnsupportedTextGenerationCapabilityError(
        "image_input",
        "deepseek"
      )
    }
    const body = {
      model: this.model,
      messages: [
        { role: "system", content: buildDeepSeekSystemPrompt(context) },
        {
          role: "user",
          content: [
            { type: "text", text: context.userPrompt.trim() },
            ...context.images.map((image) => ({
              type: "image_url",
              image_url: {
                url: `data:${image.mimeType};base64,${Buffer.from(image.bytes).toString("base64")}`,
              },
            })),
          ],
        },
      ],
      max_tokens: context.maxOutputTokens,
      response_format: context.responseFormat
        ? { type: "json_object" }
        : undefined,
    }
    return executeTextTransport(
      this.model,
      context,
      async (signal) => {
        const response = await fetchDeepSeekCompletion(
          this.cfg,
          this.baseUrl,
          this.fetchImpl,
          body,
          signal
        )
        return normalizeDeepSeekCompletion(
          (await response.json()) as DeepSeekCompletion
        )
      },
      undefined,
      (error) => toDeepSeekTransportError(this.model, error)
    )
  }
}
