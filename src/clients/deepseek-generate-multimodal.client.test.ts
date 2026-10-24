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

test("returns the token usage reported for the vision request", async () => {
  const fetchImpl = mock(async () =>
    jsonResponse({
      choices: [{ message: { content: '{"plan":true}' } }],
      usage: {
        prompt_tokens: 900,
        completion_tokens: 40,
        total_tokens: 940,
        prompt_tokens_details: { cached_tokens: 128 },
      },
    })
  )
  const client = createClient(fetchImpl)

  const result = await client.execute({
    systemPrompt: "system",
    userPrompt: "user",
    images: [image],
  })

  expect(result.usage).toEqual({
    inputTokens: 900,
    cachedInputTokens: 128,
    outputTokens: 40,
    totalTokens: 940,
    raw: {
      prompt_tokens: 900,
      completion_tokens: 40,
      total_tokens: 940,
      prompt_tokens_details: { cached_tokens: 128 },
    },
  })
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
    { apiKey: "test-key", model: "deepseek-flash" },
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

test.each([
  "deepseek-flash",
  "deepseek-v4-flash",
  "deepseek-v4-flash-vision-exp",
])("accepts documented vision model %s", async (model) => {
  const fetchImpl = mock(async () =>
    jsonResponse({ choices: [{ message: { content: "image" } }] })
  )
  const client = new DeepSeekGenerateMultimodalClient(
    { apiKey: "key", model },
    fetchImpl
  )
  expect(client.capabilities.imageInput).toBe(true)
  await client.execute({
    systemPrompt: "system",
    userPrompt: "user",
    images: [image],
  })
  expect(fetchImpl).toHaveBeenCalledTimes(1)
})

test.each(["deepseek-v4-pro", "unknown-model"])(
  "rejects unsupported official vision model %s before HTTP",
  async (model) => {
    const fetchImpl = mock(async () => jsonResponse({}))
    const client = new DeepSeekGenerateMultimodalClient(
      { apiKey: "key", model, baseUrl: "https://api.deepseek.com/v1/" },
      fetchImpl
    )
    expect(client.capabilities.imageInput).toBe(false)
    await expect(
      client.execute({
        systemPrompt: "system",
        userPrompt: "user",
        images: [image],
        retryPolicy: { maxRetries: 2 },
      })
    ).rejects.toMatchObject({
      code: "text_generation_capability_unsupported",
      details: { capability: "image_input" },
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  }
)

test("allows custom models on custom endpoints and preserves completion metadata", async () => {
  const fetchImpl = mock(async (_url: string, _init?: RequestInit) =>
    jsonResponse({
      choices: [
        {
          finish_reason: "length",
          message: { content: "partial", reasoning_content: " opaque " },
        },
      ],
    })
  )
  const client = new DeepSeekGenerateMultimodalClient(
    {
      apiKey: "key",
      model: "custom-vision",
      baseUrl: "https://vision.example/v1/",
    },
    fetchImpl
  )
  expect(client.capabilities.imageInput).toBe(true)
  await expect(
    client.execute({
      systemPrompt: "system",
      userPrompt: "user",
      images: [image],
    })
  ).resolves.toMatchObject({
    text: "partial",
    finishReason: "length",
    reasoningContent: " opaque ",
  })
  expect(fetchImpl.mock.calls[0]![0]).toBe(
    "https://vision.example/v1/chat/completions"
  )
})

test.each([
  {
    body: '{"error":{"message":"invalid image","type":"invalid_request_error"}}',
    expected: {
      error: { message: "invalid image", type: "invalid_request_error" },
    },
  },
  { body: "<html>proxy failed</html>", expected: "<html>proxy failed</html>" },
  { body: "{invalid JSON", expected: "{invalid JSON" },
])(
  "preserves HTTP errors including non-JSON bodies: %j",
  async ({ body, expected }) => {
    const fetchImpl = mock(
      async () =>
        new Response(body, {
          status: 400,
          headers: { "content-type": "application/json" },
        })
    )
    await expect(
      createClient(fetchImpl).execute({
        systemPrompt: "system",
        userPrompt: "user",
        images: [image],
        retryPolicy: { maxRetries: 1 },
      })
    ).rejects.toMatchObject({
      details: {
        statusCode: 400,
        retryable: false,
        raw: { status: 400, response: expected },
      },
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  }
)

test("retries transient multimodal failures without changing the image payload", async () => {
  const fetchImpl = mock(
    async (_url: string, _init?: RequestInit): Promise<Response> =>
      fetchImpl.mock.calls.length === 1
        ? jsonResponse({ error: { message: "busy" } }, 503)
        : jsonResponse({
            choices: [
              { finish_reason: "stop", message: { content: "recovered" } },
            ],
          })
  )
  await expect(
    createClient(fetchImpl).execute({
      systemPrompt: "system",
      userPrompt: "user",
      images: [image],
      retryPolicy: { maxRetries: 1 },
    })
  ).resolves.toMatchObject({ text: "recovered" })
  expect(fetchImpl).toHaveBeenCalledTimes(2)
  expect(fetchImpl.mock.calls[0]![1]?.body).toBe(
    fetchImpl.mock.calls[1]![1]?.body
  )
})

test("times out multimodal requests per attempt and stops on caller abort", async () => {
  const signals: AbortSignal[] = []
  const fetchImpl = mock(
    async (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init!.signal!
        signals.push(signal)
        signal.addEventListener(
          "abort",
          () => reject(new DOMException("aborted", "AbortError")),
          { once: true }
        )
      })
  )
  await expect(
    createClient(fetchImpl).execute({
      systemPrompt: "system",
      userPrompt: "user",
      images: [image],
      timeoutMs: 5,
      retryPolicy: { maxRetries: 1 },
    })
  ).rejects.toThrow("timed out after 5ms")
  expect(fetchImpl).toHaveBeenCalledTimes(2)
  expect(signals[0]).not.toBe(signals[1])

  const controller = new AbortController()
  const execution = createClient(fetchImpl).execute({
    systemPrompt: "system",
    userPrompt: "user",
    images: [image],
    signal: controller.signal,
    retryPolicy: { maxRetries: 2 },
  })
  controller.abort()
  await expect(execution).rejects.toThrow("aborted")
  expect(fetchImpl).toHaveBeenCalledTimes(3)
})

test("does not send pre-aborted requests or retry after cancellation during backoff", async () => {
  const controller = new AbortController()
  controller.abort()
  const fetchImpl = mock(async () => jsonResponse({}, 503))
  await expect(
    createClient(fetchImpl).execute({
      systemPrompt: "system",
      userPrompt: "user",
      images: [image],
      signal: controller.signal,
    })
  ).rejects.toMatchObject({ code: "text_transport_error" })
  expect(fetchImpl).not.toHaveBeenCalled()

  const live = new AbortController()
  const execution = createClient(fetchImpl).execute({
    systemPrompt: "system",
    userPrompt: "user",
    images: [image],
    signal: live.signal,
    retryPolicy: { maxRetries: 1, retryDelayMs: 10_000 },
  })
  await new Promise((resolve) => setTimeout(resolve, 0))
  live.abort()
  await expect(execution).rejects.toThrow("status 503")
  expect(fetchImpl).toHaveBeenCalledTimes(1)
})
