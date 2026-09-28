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

/**
 * Brand shared by every transport error.
 *
 * `Symbol.for` is global, so the brand survives the case where two copies of
 * this package live in different `node_modules` trees and therefore do not share
 * class identity.
 */
const TRANSPORT_ERROR_BRAND = Symbol.for(
  "@abejarano/ai-connectors/transport-error"
)

type BrandedTransportError = { [TRANSPORT_ERROR_BRAND]?: unknown }

/**
 * Base class of every provider transport failure (text, image and video).
 *
 * It exists so callers can answer "did the provider fail?" structurally, with
 * no error codes, class names or message matching.
 */
export class TransportError extends ProviderError {
  constructor(
    message: string,
    code: string,
    details?: Record<string, unknown>
  ) {
    super(message, code, details)
    ;(this as BrandedTransportError)[TRANSPORT_ERROR_BRAND] = true
  }
}

/**
 * `true` only for transport failures: connection, timeout, HTTP status, auth,
 * rate limit or an aborted request. Capability and provider-configuration
 * errors are not transport errors.
 */
export const isTransportError = (error: unknown): error is TransportError => {
  if (error instanceof TransportError) {
    return true
  }

  return (
    typeof error === "object" &&
    error !== null &&
    (error as BrandedTransportError)[TRANSPORT_ERROR_BRAND] === true
  )
}

export class TextTransportError extends TransportError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "text_transport_error", details)
  }
}

export class UnsupportedTextGenerationCapabilityError extends ProviderError {
  constructor(capability: string, provider: string) {
    super(
      `Provider '${provider}' does not support text generation capability '${capability}'.`,
      "text_generation_capability_unsupported",
      { capability, provider }
    )
  }
}

export class UnsupportedGenerationProviderError extends ProviderError {
  constructor(
    capability: "text" | "image" | "video" | "multimodal",
    provider: string
  ) {
    super(
      `Provider '${provider}' is not supported for ${capability} generation.`,
      "generation_provider_unsupported",
      { capability, provider }
    )
  }
}

export class ImageTransportError extends TransportError {
  readonly statusCode?: number
  readonly raw?: unknown

  constructor(
    message: string,
    input: { statusCode?: number; raw?: unknown } = {}
  ) {
    super(message, "image_transport_error", {
      statusCode: input.statusCode,
      raw: input.raw,
    })
    this.statusCode = input.statusCode
    this.raw = input.raw
  }
}

export class VideoTransportError extends TransportError {
  readonly statusCode?: number
  readonly raw?: unknown

  constructor(
    message: string,
    input: { statusCode?: number; raw?: unknown } = {}
  ) {
    super(message, "video_transport_error", {
      statusCode: input.statusCode,
      raw: input.raw,
    })
    this.statusCode = input.statusCode
    this.raw = input.raw
  }
}
