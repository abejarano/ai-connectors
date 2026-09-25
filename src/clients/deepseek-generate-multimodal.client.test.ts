import { expect, mock, test } from "bun:test"
import { DeepSeekGenerateMultimodalClient } from "./deepseek-generate-multimodal.client"

const image = { bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png" }

test("maps image bytes to DeepSeek vision content without a response format", async () => {
  const fetchImpl = mock(async () =>
    jsonResponse({ choices: [{ message: { content: '{"plan":true}' } }] })
  )
  const client = createClient(fetchImpl)

  await expect(
    client.execute({
      systemPrompt: "system",
      userPrompt: "user",
      images: [image],
    })
  ).resolves.toEqual({ text: '{"plan":true}' })

  const body = readBody(fetchImpl)
  expect(body.messages[0]).toEqual({ role: "system", content: "system" })
  expect(body.messages[1]).toEqual({
    role: "user",
    content: [
      { type: "text", text: "user" },
      { type: "image_url", image_url: { url: "data:image/png;base64,AQID" } },
    ],
  })
  expect(body).not.toHaveProperty("response_format")
})

test("guides JSON object output with json_object", async () => {
  const fetchImpl = mock(async () =>
    jsonResponse({ choices: [{ message: { content: '{"plan":true}' } }] })
  )
  const client = createClient(fetchImpl)

  await client.execute({
    systemPrompt: "system",
    userPrompt: "user",
    images: [image],
    responseFormat: { type: "json_object" },
  })

  const body = readBody(fetchImpl)
  expect(body.messages[0].content).toBe("system\n\nReturn only a JSON object.")
  expect(body.response_format).toEqual({ type: "json_object" })
})

test("adds schema guidance for non-strict json_schema", async () => {
  const fetchImpl = mock(async () =>
    jsonResponse({ choices: [{ message: { content: '{"plan":true}' } }] })
  )
  const client = createClient(fetchImpl)
  const schema = { type: "object", properties: { plan: { type: "boolean" } } }

  await client.execute({
    systemPrompt: "system",
    userPrompt: "user",
    images: [image],
    responseFormat: { type: "json_schema", name: "composition", schema },
  })

  const body = readBody(fetchImpl)
  expect(body.messages[0].content).toBe(
    [
      "system",
      "Return only a JSON object.",
      "Target schema 'composition' (guidance only):",
      JSON.stringify(schema),
    ].join("\n\n")
  )
  expect(body.response_format).toEqual({ type: "json_object" })
})

test("does not call DeepSeek for strict JSON Schema", async () => {
  const fetchImpl = mock(async () => jsonResponse({}))
  const client = createClient(fetchImpl)

  await expect(
    client.execute({
      systemPrompt: "system",
      userPrompt: "user",
      images: [image],
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

const createClient = (
  fetchImpl: (input: string, init?: RequestInit) => Promise<Response>
) =>
  new DeepSeekGenerateMultimodalClient(
    { apiKey: "test-key", model: "deepseek-vl" },
    fetchImpl
  )

const readBody = (
  fetchImpl: ReturnType<typeof mock>
): {
  messages: Array<{ role: string; content: unknown }>
  response_format?: unknown
} => {
  const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
  return JSON.parse(String(init.body))
}

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
