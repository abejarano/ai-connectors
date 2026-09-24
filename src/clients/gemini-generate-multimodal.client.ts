import { type GenerateContentConfig, GoogleGenAI } from "@google/genai"
import { createTextTransportError, resolveStatusCode } from "../errors"
import { toPlainObject } from "../helpers"
import type { AIProviderConfigEntry } from "../types"
import type {
  MultimodalGenerationClient,
  MultimodalGenerationCapabilities,
  MultimodalGenerationRequest,
} from "../types/multimodal-generation.request"
import type { TextGenerationResponse } from "../types/text-generation.request"

export class GeminiGenerateMultimodalClient implements MultimodalGenerationClient {
  readonly capabilities: MultimodalGenerationCapabilities = {
    provider: "gemini",
    imageInput: true,
    structuredOutput: {
      jsonObject: true,
      jsonSchema: "enforced",
    },
  }

  private ai: GoogleGenAI

  constructor(private readonly cfg: AIProviderConfigEntry) {
    this.ai = new GoogleGenAI({ apiKey: cfg.apiKey })
  }

  async execute(
    context: MultimodalGenerationRequest
  ): Promise<TextGenerationResponse> {
    try {
      const response = await this.ai.models.generateContent({
        model: this.cfg.model,
        contents: [
          {
            role: "user",
            parts: [
              { text: context.userPrompt.trim() },
              ...context.images.map((image) => ({
                inlineData: {
                  data: Buffer.from(image.bytes).toString("base64"),
                  mimeType: image.mimeType,
                },
              })),
            ],
          },
        ],
        config: this.buildRequestConfig(context),
      })

      return { text: response.text?.trim() || "" }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Gemini multimodal generation request failed."

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

  private buildRequestConfig(
    context: MultimodalGenerationRequest
  ): GenerateContentConfig {
    return {
      abortSignal: context.signal,
      systemInstruction: context.systemPrompt.trim(),
      maxOutputTokens: context.maxOutputTokens,
      responseMimeType: context.responseFormat ? "application/json" : undefined,
      responseJsonSchema: context.responseFormat?.schema,
    }
  }
}
