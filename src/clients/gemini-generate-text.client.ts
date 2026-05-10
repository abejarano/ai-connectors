import { type GenerateContentConfig, GoogleGenAI } from "@google/genai"
import { createTextTransportError, resolveStatusCode } from "../errors"
import { normalizeTokenUsage, toPlainObject } from "../helpers"
import type { AIProviderConfigEntry, TextUsage } from "../types"
import type { TextGenerationRequest } from "../types/text-generation.request"

export type TextGenerationResponse = {
  text: string
  usage?: TextUsage
}

export class GeminiGenerateTextClient {
  private ai: GoogleGenAI

  constructor(private readonly cfg: AIProviderConfigEntry) {
    this.ai = new GoogleGenAI({
      apiKey: this.cfg.apiKey,
    })
  }

  async execute(
    context: TextGenerationRequest
  ): Promise<TextGenerationResponse> {
    const config = this.buildRequestConfig(context)
    const rawInput = context.userPrompt.trim()

    try {
      if (context.stream) {
        const stream = await this.ai.models.generateContentStream({
          model: this.cfg.model,
          contents: rawInput,
          config,
        })

        let fullText = ""
        let lastChunk: unknown = undefined

        for await (const chunk of stream) {
          lastChunk = chunk
          const textChunk =
            chunk && typeof chunk === "object"
              ? ((chunk as { text?: unknown }).text as string | undefined)
              : undefined

          if (!textChunk) continue
          fullText += textChunk
          if (context.onTextChunk) {
            await context.onTextChunk(textChunk)
          }
        }

        const usageSource =
          lastChunk && typeof lastChunk === "object"
            ? (lastChunk as { usageMetadata?: unknown }).usageMetadata
            : undefined
        const fallbackText =
          lastChunk && typeof lastChunk === "object"
            ? (lastChunk as { text?: unknown }).text
            : undefined

        return {
          text:
            fullText.trim() ||
            (typeof fallbackText === "string" ? fallbackText.trim() : ""),

          usage: normalizeTokenUsage(usageSource),
        }
      }

      const response = await this.ai.models.generateContent({
        model: this.cfg.model,
        contents: rawInput,
        config,
      })

      return {
        text: response.text?.trim() || "",
        usage: normalizeTokenUsage(response.usageMetadata),
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unexpected Google GenAI text transport error."
      const statusCode = resolveStatusCode(error)

      throw createTextTransportError({
        model: this.cfg.model,
        message,
        statusCode,
        raw:
          error && typeof error === "object"
            ? toPlainObject(error)
            : { message },
        cause: error,
      })
    }
  }

  private buildRequestConfig(
    context: TextGenerationRequest
  ): GenerateContentConfig {
    const config: GenerateContentConfig = {
      abortSignal: context.signal,
    }

    config.systemInstruction = context.systemPrompt.trim()

    if (typeof context.maxOutputTokens === "number") {
      config.maxOutputTokens = context.maxOutputTokens
    }

    if (context.responseFormat) {
      config.responseMimeType = "application/json"
      config.responseJsonSchema = context.responseFormat.schema
    }

    if (context.tools) {
      config.tools = context.tools
    }

    return config
  }
}
