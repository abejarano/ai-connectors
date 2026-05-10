import {
  type GenerateVideosConfig,
  type GenerateVideosOperation,
  GoogleGenAI,
} from "@google/genai"
import { mkdirSync, statSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { resolveStatusCode, VideoTransportError } from "../errors"
import { toPlainObject } from "../helpers"
import type { AIProviderConfigEntry } from "../types"
import type { VideoGenerationRequest } from "../types/video-generation.request"

const DEFAULT_DURATION_SECONDS = 8
const MIN_DURATION_SECONDS = 4
const MID_DURATION_SECONDS = 6
const MAX_DURATION_SECONDS = 8

export type VideoAssetRef = {
  kind: "file"
  path: string
}

export type VideoGenerationResponse = {
  asset: VideoAssetRef
  mimeType: string
  sizeBytes: number
  durationSeconds: number
}

export class GeminiGenerateVideoClient {
  private ai: GoogleGenAI

  constructor(private readonly cfg: AIProviderConfigEntry) {
    this.ai = new GoogleGenAI({
      apiKey: this.cfg.apiKey,
    })
  }

  async execute(
    context: VideoGenerationRequest
  ): Promise<VideoGenerationResponse> {
    const prompt = context.prompt.trim()
    const outputPath = resolve(context.outputPath)

    mkdirSync(dirname(outputPath), { recursive: true })

    const resolution = this.inferResolution(context.width, context.height)
    const durationSeconds = this.normalizeDurationSeconds(
      context.durationSeconds,
      resolution
    )

    let operation: GenerateVideosOperation

    try {
      operation = await this.ai.models.generateVideos({
        model: this.cfg.model,
        prompt,
        config: this.buildVideoConfig(context, resolution, durationSeconds),
      })
    } catch (error) {
      const statusCode = resolveStatusCode(error)
      const message =
        error instanceof Error
          ? error.message
          : "Video generation request failed."

      throw new VideoTransportError(message, {
        statusCode,
        raw:
          error && typeof error === "object"
            ? toPlainObject(error)
            : { message },
      })
    }

    let resolvedOperation = operation

    try {
      const { maxAttempts, delayMs } = this.resolvePollingPolicy(context)

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        if (resolvedOperation.done === true) break

        await this.sleep(delayMs, context.signal)

        resolvedOperation = await this.ai.operations.getVideosOperation({
          operation: resolvedOperation,
        })
      }
    } catch (error) {
      const statusCode = resolveStatusCode(error)
      const message =
        error instanceof Error
          ? error.message
          : "Video operation polling failed."

      throw new VideoTransportError(message, {
        statusCode,
        raw:
          error && typeof error === "object"
            ? toPlainObject(error)
            : { message },
      })
    }

    if (resolvedOperation.done !== true) {
      throw new VideoTransportError(
        "Video generation operation timed out while polling.",
        { raw: toPlainObject(resolvedOperation) }
      )
    }

    if (resolvedOperation.error) {
      throw new VideoTransportError(
        this.resolveOperationErrorMessage(resolvedOperation.error),
        { raw: toPlainObject(resolvedOperation) }
      )
    }

    const generatedVideo =
      resolvedOperation.response?.generatedVideos?.[0]?.video

    if (!generatedVideo) {
      throw new VideoTransportError(
        "Video generation completed but provider returned no video payload.",
        { raw: toPlainObject(resolvedOperation) }
      )
    }

    try {
      await this.ai.files.download({
        file: generatedVideo,
        downloadPath: outputPath,
        config: {
          abortSignal: context.signal,
        },
      })
    } catch (error) {
      const statusCode = resolveStatusCode(error)
      const message =
        error instanceof Error
          ? error.message
          : "Generated video download failed."

      throw new VideoTransportError(message, {
        statusCode,
        raw:
          error && typeof error === "object"
            ? toPlainObject(error)
            : { message },
      })
    }

    const fileInfo = statSync(outputPath)

    const mimeType =
      typeof (generatedVideo as { mimeType?: unknown }).mimeType === "string"
        ? ((generatedVideo as { mimeType?: string }).mimeType as string)
        : "video/mp4"

    return {
      asset: {
        kind: "file",
        path: outputPath,
      },
      mimeType,
      sizeBytes: fileInfo.size,
      durationSeconds,
    }
  }

  private buildVideoConfig(
    context: VideoGenerationRequest,
    resolution: "720p" | "1080p",
    durationSeconds: number
  ): GenerateVideosConfig {
    const config: GenerateVideosConfig = {
      abortSignal: context.signal,
      numberOfVideos: 1,
      durationSeconds,
      aspectRatio: this.inferAspectRatio(context.width, context.height),
      resolution,
    }

    if (context.negativePrompt?.trim()) {
      config.negativePrompt = context.negativePrompt.trim()
    }

    return config
  }

  private resolvePollingPolicy(context: VideoGenerationRequest): {
    maxAttempts: number
    delayMs: number
  } {
    const maxAttempts = context.pollingPolicy?.maxAttempts ?? 40
    const delayMs = context.pollingPolicy?.delayMs ?? 10_000

    return {
      maxAttempts: Math.max(1, maxAttempts),
      delayMs: Math.max(1_000, delayMs),
    }
  }

  private inferAspectRatio(width?: number, height?: number): "16:9" | "9:16" {
    if (!width || !height) return "9:16"
    return width >= height ? "16:9" : "9:16"
  }

  private inferResolution(width?: number, height?: number): "720p" | "1080p" {
    const maxDimension = Math.max(width ?? 0, height ?? 0)
    return maxDimension >= 1080 ? "1080p" : "720p"
  }

  private normalizeDurationSeconds(
    value: number | undefined,
    resolution: "720p" | "1080p"
  ): number {
    if (resolution === "1080p") return 8

    if (!Number.isFinite(value)) return DEFAULT_DURATION_SECONDS
    if ((value as number) <= MIN_DURATION_SECONDS) return MIN_DURATION_SECONDS
    if ((value as number) <= MID_DURATION_SECONDS) return MID_DURATION_SECONDS

    return MAX_DURATION_SECONDS
  }

  private resolveOperationErrorMessage(value: unknown): string {
    if (!value || typeof value !== "object") {
      return "Video generation operation failed."
    }

    const source = value as Record<string, unknown>
    const directMessage = source.message
    if (typeof directMessage === "string" && directMessage.trim()) {
      return directMessage.trim()
    }

    const status = source.status
    if (typeof status === "string" && status.trim()) {
      return status.trim()
    }

    return "Video generation operation failed."
  }

  private async sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (!signal) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
      return
    }

    if (signal.aborted) {
      throw new VideoTransportError("Video generation request aborted.")
    }

    await new Promise<void>((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", onAbort)
        resolvePromise()
      }, ms)

      const onAbort = () => {
        clearTimeout(timer)
        signal.removeEventListener("abort", onAbort)
        rejectPromise(
          new VideoTransportError("Video generation request aborted.")
        )
      }

      signal.addEventListener("abort", onAbort)
    })
  }
}
