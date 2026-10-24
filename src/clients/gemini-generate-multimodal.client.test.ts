import { expect, mock, test } from "bun:test"
import { GeminiGenerateMultimodalClient } from "./gemini-generate-multimodal.client"

test("honors multimodal retries and per-attempt timeouts", async () => {
  const client = new GeminiGenerateMultimodalClient({
    apiKey: "test-key",
    model: "gemini-test",
  })
  const request = { systemPrompt: "system", userPrompt: "user", images: [] }
  const generateContent = mock(async (): Promise<{ text: string }> => {
    if (generateContent.mock.calls.length === 1)
      throw Object.assign(new Error("busy"), { status: 503 })
    return { text: "recovered" }
  })
  ;(client as unknown as { ai: { models: unknown } }).ai = {
    models: { generateContent },
  }
  await expect(
    client.execute({ ...request, retryPolicy: { maxRetries: 1 } })
  ).resolves.toMatchObject({ text: "recovered" })
  expect(generateContent).toHaveBeenCalledTimes(2)

  const hanging = mock(
    async (input: { config: { abortSignal: AbortSignal } }) =>
      new Promise((_resolve, reject) => {
        input.config.abortSignal.addEventListener(
          "abort",
          () => reject(new DOMException("aborted", "AbortError")),
          { once: true }
        )
      })
  )
  ;(client as unknown as { ai: { models: unknown } }).ai = {
    models: { generateContent: hanging },
  }
  await expect(
    client.execute({ ...request, timeoutMs: 5, retryPolicy: { maxRetries: 1 } })
  ).rejects.toThrow("timed out after 5ms")
  expect(hanging).toHaveBeenCalledTimes(2)
})

test("does not retry Gemini multimodal requests after caller cancellation", async () => {
  const client = new GeminiGenerateMultimodalClient({
    apiKey: "test-key",
    model: "gemini-test",
  })
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
  ;(client as unknown as { ai: { models: unknown } }).ai = {
    models: { generateContent },
  }
  const controller = new AbortController()
  const execution = client.execute({
    systemPrompt: "system",
    userPrompt: "user",
    images: [],
    signal: controller.signal,
    retryPolicy: { maxRetries: 2 },
  })
  controller.abort()
  await expect(execution).rejects.toThrow("aborted")
  expect(generateContent).toHaveBeenCalledTimes(1)
})

test("sends image bytes alongside the prompt with the structured-output schema", async () => {
  const generateContent = mock(async () => ({ text: '{"elements":[]}' }))
  const client = new GeminiGenerateMultimodalClient({
    apiKey: "test-key",
    model: "gemini-test",
  })
  ;(client as unknown as { ai: { models: unknown } }).ai = {
    models: { generateContent },
  }

  const result = await client.execute({
    systemPrompt: "system",
    userPrompt: "user",
    images: [{ bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png" }],
    responseFormat: {
      type: "json_schema",
      name: "composition",
      schema: { type: "object" },
    },
  })

  expect(result).toEqual({ text: '{"elements":[]}' })
  expect(generateContent).toHaveBeenCalledWith({
    model: "gemini-test",
    contents: [
      {
        role: "user",
        parts: [
          { text: "user" },
          { inlineData: { data: "AQID", mimeType: "image/png" } },
        ],
      },
    ],
    config: {
      abortSignal: expect.any(AbortSignal),
      systemInstruction: "system",
      maxOutputTokens: undefined,
      responseMimeType: "application/json",
      responseJsonSchema: { type: "object" },
    },
  })
})

test("requests a JSON object without a schema", async () => {
  const generateContent = mock(async () => ({ text: '{"elements":[]}' }))
  const client = new GeminiGenerateMultimodalClient({
    apiKey: "test-key",
    model: "gemini-test",
  })
  ;(client as unknown as { ai: { models: unknown } }).ai = {
    models: { generateContent },
  }

  const result = await client.execute({
    systemPrompt: "system",
    userPrompt: "user",
    images: [{ bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png" }],
    responseFormat: { type: "json_object" },
  })

  expect(result).toEqual({ text: '{"elements":[]}' })
  expect(generateContent).toHaveBeenCalledWith({
    model: "gemini-test",
    contents: [
      {
        role: "user",
        parts: [
          { text: "user" },
          { inlineData: { data: "AQID", mimeType: "image/png" } },
        ],
      },
    ],
    config: {
      abortSignal: expect.any(AbortSignal),
      systemInstruction: "system",
      maxOutputTokens: undefined,
      responseMimeType: "application/json",
    },
  })
  const [request] = generateContent.mock.calls[0] as unknown as [
    { config: Record<string, unknown> },
  ]
  expect(request.config).not.toHaveProperty("responseJsonSchema")
})

test("returns the normalized token usage reported by Gemini", async () => {
  const generateContent = mock(async () => ({
    text: "descripción",
    usageMetadata: {
      promptTokenCount: 120,
      cachedContentTokenCount: 20,
      candidatesTokenCount: 15,
      thoughtsTokenCount: 5,
      totalTokenCount: 140,
    },
  }))
  const client = new GeminiGenerateMultimodalClient({
    apiKey: "test-key",
    model: "gemini-test",
  })
  ;(client as unknown as { ai: { models: unknown } }).ai = {
    models: { generateContent },
  }

  const result = await client.execute({
    systemPrompt: "system",
    userPrompt: "user",
    images: [{ bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png" }],
  })

  expect(result.text).toBe("descripción")
  expect(result.usage?.inputTokens).toBe(120)
  expect(result.usage?.cachedInputTokens).toBe(20)
  expect(result.usage?.outputTokens).toBe(20)
  expect(result.usage?.reasoningTokens).toBe(5)
  expect(result.usage?.totalTokens).toBe(140)
  expect(result.usage?.raw).toBeDefined()
  expect(result.usage!.inputTokens! + result.usage!.outputTokens!).toBe(
    result.usage!.totalTokens!
  )
})
