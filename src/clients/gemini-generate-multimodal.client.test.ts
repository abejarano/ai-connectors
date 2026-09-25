import { expect, mock, test } from "bun:test"
import { GeminiGenerateMultimodalClient } from "./gemini-generate-multimodal.client"

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
      abortSignal: undefined,
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
      abortSignal: undefined,
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
