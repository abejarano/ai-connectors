export const resolveStatusCode = (error: unknown): number | undefined => {
  if (!error || typeof error !== "object") return undefined
  const status = (error as { status?: unknown }).status
  if (typeof status === "number" && Number.isFinite(status)) return status

  const statusCode = (error as { statusCode?: unknown }).statusCode
  if (typeof statusCode === "number" && Number.isFinite(statusCode)) {
    return statusCode
  }

  return undefined
}
export type TextRuntimeErrorDescriptor = {
  code: string
  message: string
  model: string
  retryable: boolean
  statusCode?: number
  raw?: unknown
  cause?: string
}

export const createTextTransportError = (input: {
  model: string
  message: string
  statusCode?: number
  raw?: unknown
  cause?: unknown
}): TextTransportError => {
  const details: TextRuntimeErrorDescriptor = {
    code: "text_transport_error",
    message: input.message,
    model: input.model,
    retryable:
      isRetryableStatusCode(input.statusCode) ||
      (input.statusCode === undefined && isRetryableCause(input.cause)),
    statusCode: input.statusCode,
    raw: input.raw,
    cause:
      input.cause instanceof Error
        ? input.cause.message
        : typeof input.cause === "string"
          ? input.cause
          : undefined,
  }

  return new TextTransportError(input.message, details)
}

const isRetryableStatusCode = (statusCode?: number): boolean => {
  if (typeof statusCode !== "number") return false
  return (
    statusCode === 408 ||
    statusCode === 409 ||
    statusCode === 425 ||
    statusCode === 429 ||
    statusCode >= 500
  )
}

const isRetryableCause = (cause: unknown): boolean => {
  if (!(cause instanceof Error)) return false

  if (cause.name === "TypeError" || cause.name === "AbortError") {
    return true
  }

  const message = `${cause.message || ""}`.toLowerCase()
  return (
    message.includes("network") ||
    message.includes("failed to fetch") ||
    message.includes("econnreset") ||
    message.includes("econnrefused") ||
    message.includes("etimedout") ||
    message.includes("timed out") ||
    message.includes("socket hang up") ||
    message.includes("temporarily unavailable")
  )
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly details?: Record<string, unknown>
  ) {
    super(message)
    this.name = new.target.name
  }
}

export class TextTransportError extends ProviderError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "text_transport_error", details)
  }
}

export class ImageTransportError extends Error {
  readonly code = "image_transport_error"
  readonly statusCode?: number
  readonly raw?: unknown

  constructor(
    message: string,
    input: { statusCode?: number; raw?: unknown } = {}
  ) {
    super(message)
    this.name = "ImageTransportError"
    this.statusCode = input.statusCode
    this.raw = input.raw
  }
}

export class VideoTransportError extends Error {
  readonly code = "video_transport_error"
  readonly statusCode?: number
  readonly raw?: unknown

  constructor(
    message: string,
    input: { statusCode?: number; raw?: unknown } = {}
  ) {
    super(message)
    this.name = "VideoTransportError"
    this.statusCode = input.statusCode
    this.raw = input.raw
  }
}
