import { describe, expect, mock, test } from "bun:test"
import {
  DeepSeekGenerateTextClient,
  type DeepSeekGenerateTextClientConfig,
} from "./deepseek-generate-text.client"

const config: DeepSeekGenerateTextClientConfig = {
  apiKey: "deepseek-key",
  model: "deepseek-flash",
}

describe("DeepSeekGenerateTextClient", () => {
  test("maps a text completion, JSON-object guidance and usage", async () => {
    const fetchImpl = mock(async () =>
      jsonResponse({
        choices: [{ message: { content: '{"title":"DeepSeek"}' } }],
        usage: {
          prompt_tokens: 4,
          completion_tokens: 3,
          total_tokens: 7,
          prompt_tokens_details: { cached_tokens: 1 },
        },
      })
    )
    const client = createClient(fetchImpl)

    const result = await client.execute({
      systemPrompt: "Return concise output.",
      userPrompt: "Create a title.",
      maxOutputTokens: 12,
      reasoning: { effort: "medium" },
      responseFormat: {
        type: "json_schema",
        name: "title",
        schema: { type: "object", properties: { title: { type: "string" } } },
      },
    })

    expect(result).toEqual({
      text: '{"title":"DeepSeek"}',
      usage: {
        inputTokens: 4,
        outputTokens: 3,
        totalTokens: 7,
        cachedInputTokens: 1,
        raw: {
          prompt_tokens: 4,
          completion_tokens: 3,
          total_tokens: 7,
          prompt_tokens_details: { cached_tokens: 1 },
        },
      },
      toolCalls: undefined,
    })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]
    expect(url).toBe("https://api.deepseek.com/chat/completions")
    expect(JSON.parse(String(init.body))).toEqual({
      model: "deepseek-flash",
      messages: [
        {
          role: "system",
          content:
            'Return concise output.\n\nReturn only a JSON object.\n\nTarget schema \'title\' (guidance only):\n\n{"type":"object","properties":{"title":{"type":"string"}}}',
        },
        { role: "user", content: "Create a title." },
      ],
      stream: false,
      max_tokens: 12,
      reasoning_effort: "high",
      response_format: { type: "json_object" },
    })
  })

  test("returns DeepSeek function tool calls in the neutral response", async () => {
    const fetchImpl = mock(async () =>
      jsonResponse({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: "call-1",
                  function: { name: "get_weather", arguments: '{"city":"SP"}' },
                },
              ],
            },
          },
        ],
      })
    )
    const client = createClient(fetchImpl)

    const result = await client.execute({
      systemPrompt: "Use tools when needed.",
      userPrompt: "Weather in São Paulo?",
      tools: [
        {
          type: "function",
          function: {
            name: "get_weather",
            parameters: { type: "object" },
          },
        },
      ],
    })

    expect(result).toEqual({
      text: "",
      usage: undefined,
      toolCalls: [
        { id: "call-1", name: "get_weather", arguments: '{"city":"SP"}' },
      ],
    })
  })

  test("streams text chunks and preserves final usage", async () => {
    const fetchImpl = mock(
      async () =>
        new Response(
          [
            'data: {"choices":[{"delta":{"content":"Hello "}}]}',
            "",
            'data: {"choices":[{"delta":{"content":"world"}}]}',
            "",
            'data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":2,"completion_tokens":2,"total_tokens":4}}',
            "",
            "data: [DONE]",
            "",
          ].join("\n")
        )
    )
    const client = createClient(fetchImpl)
    const chunks: string[] = []

    const result = await client.execute({
      systemPrompt: "System",
      userPrompt: "User",
      stream: true,
      onTextChunk: (chunk) => {
        chunks.push(chunk)
      },
    })

    expect(chunks).toEqual(["Hello ", "world"])
    expect(result.text).toBe("Hello world")
    expect(result.usage?.totalTokens).toBe(4)
  })

  test("does not retry a stream after yielding text", async () => {
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n'
          )
        )
        setTimeout(() => {
          const error = new Error("temporarily unavailable")
          Object.assign(error, { status: 503 })
          controller.error(error)
        }, 0)
      },
    })
    const fetchImpl = mock(async () => new Response(stream))
    const chunks: string[] = []

    await expect(
      createClient(fetchImpl).execute({
        systemPrompt: "System",
        userPrompt: "User",
        stream: true,
        onTextChunk: (chunk) => {
          chunks.push(chunk)
        },
        retryPolicy: { maxRetries: 1 },
      })
    ).rejects.toThrow("temporarily unavailable")

    expect(chunks).toEqual(["Hello"])
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  test("retries transient HTTP failures but not client failures", async () => {
    const retryingFetch = mock(async () => {
      if (retryingFetch.mock.calls.length === 1) {
        return jsonResponse({ error: { message: "busy" } }, 429)
      }
      return jsonResponse({ choices: [{ message: { content: "Recovered" } }] })
    })
    const client = createClient(retryingFetch)

    await expect(
      client.execute({
        systemPrompt: "System",
        userPrompt: "User",
        retryPolicy: { maxRetries: 1 },
      })
    ).resolves.toMatchObject({ text: "Recovered" })
    expect(retryingFetch).toHaveBeenCalledTimes(2)

    const failingFetch = mock(async () => jsonResponse({ error: "bad" }, 400))
    await expect(
      createClient(failingFetch).execute({
        systemPrompt: "System",
        userPrompt: "User",
        retryPolicy: { maxRetries: 1 },
      })
    ).rejects.toThrow("DeepSeek request failed with status 400.")
    expect(failingFetch).toHaveBeenCalledTimes(1)
  })

  test("does not call DeepSeek for strict JSON Schema", async () => {
    const fetchImpl = mock(async () => jsonResponse({}))

    await expect(
      createClient(fetchImpl).execute({
        systemPrompt: "System",
        userPrompt: "User",
        responseFormat: {
          type: "json_schema",
          name: "result",
          schema: { type: "object" },
          strict: true,
        },
      })
    ).rejects.toMatchObject({
      code: "text_generation_capability_unsupported",
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  test("retries timeouts and stops retrying when the caller aborts", async () => {
    const timeoutFetch = mock(
      async (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          ;(init?.signal as AbortSignal).addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true }
          )
        })
    )

    await expect(
      createClient(timeoutFetch).execute({
        systemPrompt: "System",
        userPrompt: "User",
        timeoutMs: 5,
        retryPolicy: { maxRetries: 1 },
      })
    ).rejects.toThrow("Text generation timed out after 5ms.")
    expect(timeoutFetch).toHaveBeenCalledTimes(2)

    const controller = new AbortController()
    const unavailableFetch = mock(async () => jsonResponse({}, 503))
    const execution = createClient(unavailableFetch).execute({
      systemPrompt: "System",
      userPrompt: "User",
      signal: controller.signal,
      retryPolicy: { maxRetries: 1, retryDelayMs: 10_000 },
    })
    await waitFor(0)
    controller.abort()

    await expect(execution).rejects.toThrow(
      "DeepSeek request failed with status 503."
    )
    expect(unavailableFetch).toHaveBeenCalledTimes(1)
  })
})

const createClient = (
  fetchImpl: (input: string, init?: RequestInit) => Promise<Response>
) => new DeepSeekGenerateTextClient(config, fetchImpl)

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })

const waitFor = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))
