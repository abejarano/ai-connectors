import { expect, mock, test } from "bun:test"
import { DeepSeekGenerateMultimodalClient } from "./deepseek-generate-multimodal.client"

test("maps image bytes to DeepSeek vision content", async () => {
  const fetchImpl = mock(
    async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"plan":true}' } }],
        }),
        { status: 200 }
      )
  )
  const client = new DeepSeekGenerateMultimodalClient(
    { apiKey: "test-key", model: "deepseek-vl" },
    fetchImpl
  )

  await expect(
    client.execute({
      systemPrompt: "system",
      userPrompt: "user",
      images: [{ bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png" }],
      responseFormat: {
        type: "json_schema",
        name: "composition",
        schema: { type: "object" },
      },
    })
  ).resolves.toEqual({ text: '{"plan":true}' })

  expect(fetchImpl).toHaveBeenCalledWith(
    "https://api.deepseek.com/chat/completions",
    expect.objectContaining({
      body: JSON.stringify({
        model: "deepseek-vl",
        messages: [
          { role: "system", content: "system" },
          {
            role: "user",
            content: [
              { type: "text", text: "user" },
              {
                type: "image_url",
                image_url: { url: "data:image/png;base64,AQID" },
              },
            ],
          },
        ],
        response_format: { type: "json_object" },
      }),
    })
  )
})

test("requests a JSON object without forcing a schema", async () => {
  const fetchImpl = mock(
    async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"plan":true}' } }],
        }),
        { status: 200 }
      )
  )
  const client = new DeepSeekGenerateMultimodalClient(
    { apiKey: "test-key", model: "deepseek-vl" },
    fetchImpl
  )

  await client.execute({
    systemPrompt: "system",
    userPrompt: "user",
    images: [{ bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png" }],
    responseFormat: { type: "json_object" },
  })

  const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
  expect(JSON.parse(String(init.body))).toMatchObject({
    response_format: { type: "json_object" },
  })
})

test("does not call DeepSeek for strict JSON Schema", async () => {
  const fetchImpl = mock(
    async () => new Response(JSON.stringify({}), { status: 200 })
  )
  const client = new DeepSeekGenerateMultimodalClient(
    { apiKey: "test-key", model: "deepseek-vl" },
    fetchImpl
  )

  await expect(
    client.execute({
      systemPrompt: "system",
      userPrompt: "user",
      images: [{ bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png" }],
      responseFormat: {
        type: "json_schema",
        name: "composition",
        schema: { type: "object" },
        strict: true,
      },
    })
  ).rejects.toMatchObject({
    code: "text_generation_capability_unsupported",
  })
  expect(fetchImpl).not.toHaveBeenCalled()
})
