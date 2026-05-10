import { GoogleGenAI, type GenerateContentConfig } from "@google/genai"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, extname, resolve } from "node:path"
import { ImageTransportError, resolveStatusCode } from "../errors"
import { toPlainObject } from "../helpers"
import { inspectImageAsset } from "../helpers/image-asset"
import type { AIProviderConfigEntry } from "../types"
import type { ImageGenerationRequest } from "../types/image-generation.request"

export type ImageAssetRef = {
  kind: "file"
  path: string
}

export type ImageGenerationResponse = {
  asset: ImageAssetRef
  mimeType: string
  sizeBytes: number
  width: number
  height: number
}

export class GeminiGenerateImageClient {
  private ai: GoogleGenAI

  constructor(private readonly cfg: AIProviderConfigEntry) {
    this.ai = new GoogleGenAI({
      apiKey: this.cfg.apiKey,
    })
  }

  async execute(context: ImageGenerationRequest) {
    let response: unknown

    try {
      response = await this.ai.models.generateContent({
        model: this.cfg.model,
        contents: this.buildPrompt(context),
        config: this.buildGeminiImageConfig(context),
      })
    } catch (error) {
      const statusCode = resolveStatusCode(error)
      const message =
        error instanceof Error
          ? error.message
          : "Gemini image generation request failed."

      throw new ImageTransportError(message, {
        statusCode,
        raw:
          error && typeof error === "object"
            ? toPlainObject(error)
            : { message },
      })
    }

    const outputPath = resolve(context.outputPath)
    mkdirSync(dirname(outputPath), { recursive: true })

    const generated = this.resolveGeneratedImageFromContent(response)
    writeFileSync(outputPath, Buffer.from(generated.bytesBase64, "base64"))

    const mimeType = generated.mimeType || this.detectMimeFromPath(outputPath)
    const assetInfo = inspectImageAsset(outputPath)

    return {
      asset: {
        kind: "file",
        path: outputPath,
      },
      mimeType,
      sizeBytes: assetInfo.sizeBytes,
      width: assetInfo.width,
      height: assetInfo.height,
    }
  }

  private detectMimeFromPath(path: string): string {
    const ext = extname(path).toLowerCase()
    if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg"
    if (ext === ".webp") return "image/webp"
    return "image/png"
  }

  private buildPrompt(context: ImageGenerationRequest): string {
    const prompt = context.prompt.trim()

    if (!context.negativePrompt?.trim()) {
      return prompt
    }

    return [
      prompt,
      "",
      "Avoid the following visual problems:",
      context.negativePrompt.trim(),
    ].join("\n")
  }

  private buildGeminiImageConfig(
    context: ImageGenerationRequest
  ): GenerateContentConfig {
    const aspectRatio = this.aspectRatioFromSize(context.width, context.height)

    return {
      abortSignal: context.signal,
      responseModalities: ["IMAGE"],
      imageConfig: aspectRatio
        ? {
            aspectRatio,
            imageSize: "1K",
          }
        : undefined,
    }
  }

  private resolveGeneratedImageFromContent(response: unknown): {
    bytesBase64: string
    mimeType?: string
  } {
    if (!response || typeof response !== "object") {
      throw new ImageTransportError(
        "Image generation returned an invalid response payload."
      )
    }

    const responseData = response as {
      candidates?: Array<{
        content?: {
          parts?: Array<{
            inlineData?: {
              data?: string
              mimeType?: string
            }
          }>
        }
      }>
    }

    const imagePart = responseData.candidates?.[0]?.content?.parts?.find(
      (part) =>
        typeof part.inlineData?.data === "string" && part.inlineData.data.trim()
    )

    const bytesBase64 = imagePart?.inlineData?.data

    if (!bytesBase64?.trim()) {
      throw new ImageTransportError(
        "Gemini image generation completed but returned no inline image bytes.",
        { raw: response }
      )
    }

    return {
      bytesBase64,
      mimeType: imagePart?.inlineData?.mimeType,
    }
  }

  private aspectRatioFromSize(
    width?: number,
    height?: number
  ): string | undefined {
    if (!width || !height) return undefined

    if (width === height) return "1:1"

    // Instagram portrait 1080x1350 no tiene 4:5 oficial en Gemini.
    // Se usa 3:4 y luego puedes recortar/redimensionar.
    if (width === 1080 && height === 1350) return "3:4"

    if (width === 1080 && height === 1920) return "9:16"
    if (width === 1920 && height === 1080) return "16:9"

    return undefined
  }
}
