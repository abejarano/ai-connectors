import { type GenerateContentConfig, GoogleGenAI } from "@google/genai"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, extname, resolve } from "node:path"
import {
  ImageTransportError,
  InvalidImageInputError,
  resolveStatusCode,
  UnsupportedImageEditCapabilityError,
} from "../errors"
import { normalizeTokenUsage, toPlainObject } from "../helpers"
import { inspectImageAsset } from "../helpers/image-asset"
import type { AIProviderConfigEntry } from "../types"
import type { ImageInput } from "../types/image-input"
import type {
  ImageEditRequest,
  ImageGenerationCapabilities,
  ImageGenerationClient,
  ImageGenerationRequest,
  ImageGenerationResponse,
} from "../types/image-generation.request"

/**
 * Modelos de Gemini verificados como capaces de editar una imagen existente.
 *
 * La lista es deliberadamente cerrada: ante un modelo desconocido la librería
 * falla en lugar de enviar la imagen y devolver silenciosamente una generación
 * nueva desde cero. Si has verificado otro modelo, actívalo con
 * `allowUnverifiedImageEdit`.
 */
const IMAGE_EDIT_MODEL_PREFIXES = [
  "gemini-3-pro-image",
  "gemini-3.1-flash-image",
  "gemini-3.1-flash-lite-image",
  "gemini-2.5-flash-image",
] as const

export type GeminiGenerateImageClientConfig = AIProviderConfigEntry & {
  /**
   * Permite `edit()` con un modelo fuera de `IMAGE_EDIT_MODEL_PREFIXES`.
   * Úsalo sólo si has comprobado que el modelo respeta la imagen de entrada.
   */
  allowUnverifiedImageEdit?: boolean
}

export class GeminiGenerateImageClient implements ImageGenerationClient {
  private ai: GoogleGenAI

  constructor(private readonly cfg: GeminiGenerateImageClientConfig) {
    this.ai = new GoogleGenAI({
      apiKey: this.cfg.apiKey,
    })
  }

  get model(): string {
    return this.cfg.model
  }

  get capabilities(): ImageGenerationCapabilities {
    return {
      provider: "gemini",
      negativePrompt: true,
      aspectRatio: true,
      imageEdit: this.supportsImageEdit(),
    }
  }

  async execute(
    context: ImageGenerationRequest
  ): Promise<ImageGenerationResponse> {
    let response: unknown

    try {
      response = await this.ai.models.generateContent({
        model: this.cfg.model,
        contents: this.buildPrompt(context),
        config: this.buildGeminiImageConfig(context),
      })
    } catch (error) {
      throw this.toTransportError(
        error,
        "Gemini image generation request failed."
      )
    }

    return this.persistGeneratedImage(response, context.outputPath)
  }

  /**
   * Genera una versión transformada de `context.image` según `context.prompt`.
   *
   * La imagen de entrada es la base de la edición, no una garantía de que el
   * sujeto o la geometría se preserven: eso depende del modelo.
   *
   * No envía `imageConfig`: deja que el modelo decida el encuadre a partir de la
   * imagen de entrada, en lugar de imponer un aspect ratio que compita con la
   * instrucción.
   */
  async edit(context: ImageEditRequest): Promise<ImageGenerationResponse> {
    this.assertImageEditSupported()
    const inlineData = this.toInlineData(context.image)

    let response: unknown

    try {
      response = await this.ai.models.generateContent({
        model: this.cfg.model,
        contents: [
          {
            role: "user",
            parts: [{ text: context.prompt.trim() }, { inlineData }],
          },
        ],
        config: {
          abortSignal: context.signal,
          responseModalities: ["IMAGE"],
        },
      })
    } catch (error) {
      throw this.toTransportError(error, "Gemini image edit request failed.")
    }

    return this.persistGeneratedImage(response, context.outputPath)
  }

  private supportsImageEdit(): boolean {
    if (this.cfg.allowUnverifiedImageEdit === true) return true

    const model = this.cfg.model.trim().toLowerCase()
    return IMAGE_EDIT_MODEL_PREFIXES.some((prefix) => model.startsWith(prefix))
  }

  private assertImageEditSupported(): void {
    if (this.supportsImageEdit()) return

    throw new UnsupportedImageEditCapabilityError({
      provider: "gemini",
      model: this.cfg.model,
      reason: `it is not one of the known image-editing models (${IMAGE_EDIT_MODEL_PREFIXES.join(", ")}); enable 'allowUnverifiedImageEdit' only after verifying it`,
    })
  }

  private toInlineData(image: ImageInput): {
    data: string
    mimeType: string
  } {
    if (!image || typeof image !== "object") {
      throw new InvalidImageInputError("the image object is missing")
    }

    if (!(image.bytes instanceof Uint8Array) || image.bytes.byteLength === 0) {
      throw new InvalidImageInputError("'bytes' must be a non-empty Uint8Array")
    }

    if (typeof image.mimeType !== "string" || !image.mimeType.trim()) {
      throw new InvalidImageInputError("'mimeType' must be a non-empty string")
    }

    return {
      // Los bytes se codifican para el transporte sin recodificar la imagen, y
      // el MIME declarado viaja tal cual.
      data: Buffer.from(image.bytes).toString("base64"),
      mimeType: image.mimeType,
    }
  }

  private toTransportError(error: unknown, fallbackMessage: string) {
    const message = error instanceof Error ? error.message : fallbackMessage

    return new ImageTransportError(message, {
      statusCode: resolveStatusCode(error),
      raw:
        error && typeof error === "object" ? toPlainObject(error) : { message },
    })
  }

  private persistGeneratedImage(
    response: unknown,
    requestedPath: string
  ): ImageGenerationResponse {
    const outputPath = resolve(requestedPath)
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
      usage: {
        imageCount: generated.imageCount,
        tokens: normalizeTokenUsage(this.readUsageMetadata(response)),
      },
    }
  }

  private readUsageMetadata(response: unknown): unknown {
    if (!response || typeof response !== "object") return undefined

    return (response as { usageMetadata?: unknown }).usageMetadata
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
    imageCount: number
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

    const imageParts =
      responseData.candidates?.[0]?.content?.parts?.filter(
        (part) =>
          typeof part.inlineData?.data === "string" &&
          Boolean(part.inlineData.data.trim())
      ) ?? []

    const imagePart = imageParts[0]
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
      imageCount: imageParts.length,
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
