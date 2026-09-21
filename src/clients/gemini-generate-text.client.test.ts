import { describe, expect, mock, test } from "bun:test"
import { GeminiGenerateTextClient } from "./gemini-generate-text.client"

describe("GeminiGenerateTextClient", () => {
  test("retries retryable provider failures according to retryPolicy", async () => {
    const generateContent = mock(async () => {
      if (generateContent.mock.calls.length === 1) {
        const error = new Error("rate limited")
        Object.assign(error, { status: 429 })
        throw error
      }

      return { text: "Recovered" }
    })
    const client = createClient(generateContent)

    const result = await client.execute({
      systemPrompt: "System",
      userPrompt: "User",
      retryPolicy: { maxRetries: 1 },
    })

    expect(generateContent).toHaveBeenCalledTimes(2)
    expect(result.text).toBe("Recovered")
  })

  test("aborts timed out requests and retries them", async () => {
    const generateContent = mock(
      async (input: { config: { abortSignal: AbortSignal } }) =>
        new Promise((_resolve, reject) => {
          input.config.abortSignal.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true }
          )
        })
    )
    const client = createClient(generateContent)

    await expect(
      client.execute({
        systemPrompt: "System",
        userPrompt: "User",
        timeoutMs: 5,
        retryPolicy: { maxRetries: 1 },
      })
    ).rejects.toThrow("Text generation timed out after 5ms.")

    expect(generateContent).toHaveBeenCalledTimes(2)
  })

  test("does not retry when the caller aborts during retry delay", async () => {
    const controller = new AbortController()
    const generateContent = mock(async () => {
      const error = new Error("temporarily unavailable")
      Object.assign(error, { status: 503 })
      throw error
    })
    const client = createClient(generateContent)
    const startedAt = Date.now()
    const execution = client.execute({
      systemPrompt: "System",
      userPrompt: "User",
      signal: controller.signal,
      retryPolicy: { maxRetries: 1, retryDelayMs: 10_000 },
    })

    await waitFor(0)
    controller.abort()

    await expect(execution).rejects.toThrow("temporarily unavailable")

    expect(generateContent).toHaveBeenCalledTimes(1)
    expect(Date.now() - startedAt).toBeLessThan(1_000)
  })

  test("does not retry after emitting a streaming chunk", async () => {
    const generateContent = mock(async () => undefined)
    const generateContentStream = mock(async () => {
      return (async function* () {
        yield { text: "First chunk" }
        const error = new Error("temporarily unavailable")
        Object.assign(error, { status: 503 })
        throw error
      })()
    })
    const client = createClient(generateContent)
    ;(client as unknown as { ai: { models: unknown } }).ai = {
      models: { generateContent, generateContentStream },
    }
    const chunks: string[] = []

    await expect(
      client.execute({
        systemPrompt: "System",
        userPrompt: "User",
        stream: true,
        onTextChunk: (chunk) => {
          chunks.push(chunk)
        },
        retryPolicy: { maxRetries: 1 },
      })
    ).rejects.toThrow("temporarily unavailable")

    expect(generateContentStream).toHaveBeenCalledTimes(1)
    expect(chunks).toEqual(["First chunk"])
  })
})

const createClient = (generateContent: ReturnType<typeof mock>) => {
  const client = new GeminiGenerateTextClient({
    apiKey: "gemini-key",
    model: "gemini-2.5-flash",
  })
  ;(client as unknown as { ai: { models: unknown } }).ai = {
    models: { generateContent },
  }
  return client
}

const waitFor = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))
