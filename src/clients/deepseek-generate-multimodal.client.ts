import {
  createTextTransportError,
  resolveStatusCode,
  UnsupportedTextGenerationCapabilityError,
} from "../errors"
import { toPlainObject } from "../helpers"
import type { AIProviderConfigEntry } from "../types"
import type {
  MultimodalGenerationCapabilities,
  MultimodalGenerationClient,
  MultimodalGenerationRequest,
} from "../types/multimodal-generation.request"
import type { TextGenerationResponse } from "../types/text-generation.request"

const DEFAULT_BASE_URL = "https://api.deepseek.com"

export type DeepSeekGenerateMultimodalClientConfig = AIProviderConfigEntry & {
  baseUrl?: string
}

type FetchImplementation = (
  input: string,
  init?: RequestInit
) => Promise<Response>

export class DeepSeekGenerateMultimodalClient implements MultimodalGenerationClient {
  readonly capabilities: MultimodalGenerationCapabilities = {
    provider: "deepseek",
    imageInput: true,
    structuredOutput: {
      jsonObject: true,
      jsonSchema: "best_effort",
    },
  }

  private readonly baseUrl: string

  constructor(
    private readonly cfg: DeepSeekGenerateMultimodalClientConfig,
    private readonly fetchImpl: FetchImplementation = fetch
  ) {
    this.baseUrl = (cfg.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "")
  }

  async execute(
    context: MultimodalGenerationRequest
  ): Promise<TextGenerationResponse> {
    if (context.responseFormat?.strict) {
      throw new UnsupportedTextGenerationCapabilityError(
        "strict_json_schema",
        "deepseek"
      )
    }

    try {
      const response = await this.fetchImpl(
        `${this.baseUrl}/chat/completions`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.cfg.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: this.cfg.model,
            messages: [
              { role: "system", content: context.systemPrompt.trim() },
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
          }),
          signal: context.signal,
        }
      )

      if (!response.ok) {
        const error = new Error(
          `DeepSeek multimodal request failed with status ${response.status}.`
        )
        Object.assign(error, { status: response.status })
        throw error
      }

      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string | null } }>
      }
      return { text: payload.choices?.[0]?.message?.content?.trim() ?? "" }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "DeepSeek multimodal generation request failed."

      throw createTextTransportError({
        model: this.cfg.model,
        message,
        statusCode: resolveStatusCode(error),
        raw:
          error && typeof error === "object"
            ? toPlainObject(error)
            : { message },
        cause: error,
      })
    }
  }
}
