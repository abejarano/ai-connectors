import { type GenerateContentConfig, GoogleGenAI } from "@google/genai"
import { normalizeTokenUsage } from "../helpers"
import type { AIProviderConfigEntry } from "../types"
import type {
  MultimodalGenerationCapabilities,
  MultimodalGenerationClient,
  MultimodalGenerationRequest,
} from "../types/multimodal-generation.request"
import type { TextGenerationResponse } from "../types/text-generation.request"
import { Buffer } from "node:buffer"
import { executeTextTransport } from "./text-generation-transport"

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

  get model(): string {
    return this.cfg.model
  }

  async execute(
    context: MultimodalGenerationRequest
  ): Promise<TextGenerationResponse> {
    return executeTextTransport(this.model, context, async (signal) => {
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
        config: this.buildRequestConfig(context, signal),
      })

      return {
        text: response.text?.trim() || "",
        usage: normalizeTokenUsage(response.usageMetadata),
      }
    })
  }

  private buildRequestConfig(
    context: MultimodalGenerationRequest,
    signal: AbortSignal
  ): GenerateContentConfig {
    const config: GenerateContentConfig = {
      abortSignal: signal,
      systemInstruction: context.systemPrompt.trim(),
      maxOutputTokens: context.maxOutputTokens,
    }

    if (context.responseFormat) {
      config.responseMimeType = "application/json"

      if (context.responseFormat.type === "json_schema") {
        config.responseJsonSchema = context.responseFormat.schema
      }
    }

    return config
  }
}
