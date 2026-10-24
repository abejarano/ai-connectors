import {
  createTextTransportError,
  resolveStatusCode,
  TextTransportError,
} from "../errors"
import { toPlainObject } from "../helpers"
import type { TextRetryPolicy } from "../types/text-generation.request"

type TransportOptions = {
  signal?: AbortSignal
  timeoutMs?: number
  retryPolicy?: TextRetryPolicy
}

export const executeTextTransport = async <T>(
  model: string,
  options: TransportOptions,
  execute: (signal: AbortSignal) => Promise<T>,
  canRetry: () => boolean = () => true,
  normalizeError: (error: unknown) => TextTransportError = (error) =>
    normalizeTransportError(model, error)
): Promise<T> => {
  const maxRetries = normalizeInteger(options.retryPolicy?.maxRetries)
  const retryDelayMs = normalizeInteger(options.retryPolicy?.retryDelayMs)

  for (let attempt = 0; ; attempt += 1) {
    const request = createRequestSignal(options)
    let failure: TextTransportError
    try {
      request.signal.throwIfAborted()
      return await execute(request.signal)
    } catch (error) {
      failure = normalizeError(
        request.didTimeout() ? createTimeoutError(options.timeoutMs!) : error
      )
    } finally {
      request.dispose()
    }

    if (
      options.signal?.aborted ||
      !canRetry() ||
      failure.details?.retryable !== true ||
      attempt >= maxRetries
    ) {
      throw failure
    }

    if (retryDelayMs > 0) await waitForRetry(retryDelayMs, options.signal)
    if (options.signal?.aborted) throw failure
  }
}

const normalizeTransportError = (
  model: string,
  error: unknown
): TextTransportError => {
  if (error instanceof TextTransportError) return error
  const message =
    error instanceof Error ? error.message : "Unexpected text transport error."
  return createTextTransportError({
    model,
    message,
    statusCode: resolveStatusCode(error),
    raw:
      error && typeof error === "object" ? toPlainObject(error) : { message },
    cause: error,
  })
}

const createRequestSignal = (options: TransportOptions) => {
  const controller = new AbortController()
  let timedOut = false
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const abortFromSource = () => controller.abort(options.signal?.reason)

  if (options.signal?.aborted) abortFromSource()
  else
    options.signal?.addEventListener("abort", abortFromSource, { once: true })

  if (typeof options.timeoutMs === "number" && options.timeoutMs > 0) {
    timeoutId = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, options.timeoutMs)
  }

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    dispose: () => {
      if (timeoutId !== undefined) clearTimeout(timeoutId)
      options.signal?.removeEventListener("abort", abortFromSource)
    },
  }
}

const normalizeInteger = (value: number | undefined): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0

const createTimeoutError = (timeoutMs: number): Error => {
  const error = new Error(`Text generation timed out after ${timeoutMs}ms.`)
  error.name = "TimeoutError"
  return error
}

const waitForRetry = async (
  delayMs: number,
  signal?: AbortSignal
): Promise<void> => {
  if (signal?.aborted) return
  await new Promise<void>((resolve) => {
    const timeoutId = setTimeout(done, delayMs)
    function done() {
      clearTimeout(timeoutId)
      signal?.removeEventListener("abort", done)
      resolve()
    }
    signal?.addEventListener("abort", done, { once: true })
  })
}
