import { describe, expect, test } from "bun:test"
import {
  ImageTransportError,
  ProviderError,
  TextTransportError,
  TransportError,
  UnsupportedGenerationProviderError,
  UnsupportedTextGenerationCapabilityError,
  VideoTransportError,
  createTextTransportError,
  isTransportError,
} from "./index"

describe("isTransportError", () => {
  test("accepts every transport error of the package", () => {
    expect(isTransportError(new TextTransportError("boom"))).toBe(true)
    expect(isTransportError(new ImageTransportError("boom"))).toBe(true)
    expect(isTransportError(new VideoTransportError("boom"))).toBe(true)
    expect(
      isTransportError(
        createTextTransportError({ model: "deepseek-flash", message: "boom" })
      )
    ).toBe(true)
  })

  test("rejects capability and provider configuration errors", () => {
    expect(
      isTransportError(
        new UnsupportedTextGenerationCapabilityError("jsonSchema", "deepseek")
      )
    ).toBe(false)
    expect(
      isTransportError(new UnsupportedGenerationProviderError("text", "x"))
    ).toBe(false)
    expect(isTransportError(new ProviderError("boom", "some_code"))).toBe(false)
  })

  test("rejects anything that is not a transport failure", () => {
    expect(isTransportError(new Error("connect ECONNREFUSED"))).toBe(false)
    expect(isTransportError(new TypeError("fetch failed"))).toBe(false)
    expect(isTransportError("text_transport_error")).toBe(false)
    expect(isTransportError(null)).toBe(false)
    expect(isTransportError(undefined)).toBe(false)
    expect(isTransportError({})).toBe(false)
  })

  test("does not match on codes, names or messages", () => {
    // A lookalike with the exact former fingerprint is still not a transport error.
    expect(
      isTransportError({
        name: "TextTransportError",
        code: "text_transport_error",
        message: "Timeout",
        statusCode: 429,
      })
    ).toBe(false)
  })

  test("survives a second copy of the package", () => {
    // Two installs do not share class identity; the global brand does.
    const foreignCopyError = {
      name: "TextTransportError",
      message: "boom",
      [Symbol.for("@abejarano/ai-connectors/transport-error")]: true,
    }

    expect(isTransportError(foreignCopyError)).toBe(true)
  })
})

describe("transport error shape", () => {
  test("keeps code, name, status and details", () => {
    const textError = createTextTransportError({
      model: "deepseek-flash",
      message: "DeepSeek request failed with status 401.",
      statusCode: 401,
    })

    expect(textError).toBeInstanceOf(TransportError)
    expect(textError).toBeInstanceOf(ProviderError)
    expect(textError).toBeInstanceOf(TextTransportError)
    expect(textError.name).toBe("TextTransportError")
    expect(textError.code).toBe("text_transport_error")
    expect(textError.message).toContain("401")
    expect(textError.details).toMatchObject({
      statusCode: 401,
      model: "deepseek-flash",
    })
  })

  test("image and video errors keep their public fields", () => {
    const imageError = new ImageTransportError("image boom", {
      statusCode: 500,
      raw: { detail: "x" },
    })
    const videoError = new VideoTransportError("video boom", {
      statusCode: 503,
    })

    expect(imageError.name).toBe("ImageTransportError")
    expect(imageError.code).toBe("image_transport_error")
    expect(imageError.statusCode).toBe(500)
    expect(imageError.raw).toEqual({ detail: "x" })
    expect(videoError.name).toBe("VideoTransportError")
    expect(videoError.code).toBe("video_transport_error")
    expect(videoError.statusCode).toBe(503)
    // They now share the provider base, so callers can treat all of them alike.
    expect(imageError).toBeInstanceOf(ProviderError)
    expect(videoError).toBeInstanceOf(ProviderError)
  })
})
