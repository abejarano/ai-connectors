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
    const fetchImpl = mock(
      async (_url: string, _init?: RequestInit): Promise<Response> =>
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

  test("guides JSON object output without a schema", async () => {
    const fetchImpl = mock(
      async (_url: string, _init?: RequestInit): Promise<Response> =>
        jsonResponse({
          choices: [{ message: { content: '{"title":"DeepSeek"}' } }],
        })
    )
    const client = createClient(fetchImpl)

    await client.execute({
      systemPrompt: "Return concise output.",
      userPrompt: "Create a title.",
      responseFormat: { type: "json_object" },
    })

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toMatchObject({
      messages: [
        {
          role: "system",
          content: "Return concise output.\n\nReturn only a JSON object.",
        },
        { role: "user", content: "Create a title." },
      ],
      response_format: { type: "json_object" },
    })
  })

  test("returns DeepSeek function tool calls in the neutral response", async () => {
    const fetchImpl = mock(
      async (_url: string, _init?: RequestInit): Promise<Response> =>
        jsonResponse({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  {
                    id: "call-1",
                    function: {
                      name: "get_weather",
                      arguments: '{"city":"SP"}',
                    },
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
    const fetchImpl = mock(
      async (_url: string, _init?: RequestInit): Promise<Response> =>
        new Response(stream)
    )
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
    const retryingFetch = mock(
      async (_url: string, _init?: RequestInit): Promise<Response> => {
        if (retryingFetch.mock.calls.length === 1) {
          return jsonResponse({ error: { message: "busy" } }, 429)
        }
        return jsonResponse({
          choices: [{ message: { content: "Recovered" } }],
        })
      }
    )
    const client = createClient(retryingFetch)

    await expect(
      client.execute({
        systemPrompt: "System",
        userPrompt: "User",
        retryPolicy: { maxRetries: 1 },
      })
    ).resolves.toMatchObject({ text: "Recovered" })
    expect(retryingFetch).toHaveBeenCalledTimes(2)

    const failingFetch = mock(
      async (_url: string, _init?: RequestInit): Promise<Response> =>
        jsonResponse({ error: "bad" }, 400)
    )
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
    const fetchImpl = mock(
      async (_url: string, _init?: RequestInit): Promise<Response> =>
        jsonResponse({})
    )

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
    const unavailableFetch = mock(
      async (_url: string, _init?: RequestInit): Promise<Response> =>
        jsonResponse({}, 503)
    )
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

describe("DeepSeek API compatibility", () => {
  const prompt = { systemPrompt: "system", userPrompt: "user" }
  const tool = {
    type: "function" as const,
    function: { name: "lookup", parameters: { type: "object" } },
  }

  test("round-trips a thinking tool turn without losing continuation data", async () => {
    const fetchImpl = mock(
      async (_url: string, _init?: RequestInit): Promise<Response> =>
        jsonResponse({
          choices: [
            {
              finish_reason:
                fetchImpl.mock.calls.length === 1 ? "tool_calls" : "stop",
              message:
                fetchImpl.mock.calls.length === 1
                  ? {
                      content: null,
                      reasoning_content: "  continuation data\n",
                      tool_calls: [
                        {
                          id: "call-123",
                          type: "function",
                          function: { name: "lookup", arguments: '{"id":7}' },
                        },
                      ],
                    }
                  : {
                      content: "Found it",
                      reasoning_content: "final reasoning",
                    },
            },
          ],
        })
    )
    const client = createClient(fetchImpl)
    const first = await client.execute({ ...prompt, tools: [tool] })
    const messages = Object.freeze([
      { role: "user" as const, content: "user" },
      {
        role: "assistant" as const,
        content: first.text,
        reasoningContent: first.reasoningContent,
        toolCalls: first.toolCalls,
      },
      {
        role: "tool" as const,
        toolCallId: "call-123",
        content: '{"found":true}',
      },
    ])
    const result = await client.execute({
      systemPrompt: "system",
      messages,
      tools: [tool],
    })

    expect(client.capabilities.conversationHistory).toBe(true)
    expect(first.finishReason).toBe("tool_calls")
    expect(result).toMatchObject({
      text: "Found it",
      finishReason: "stop",
      reasoningContent: "final reasoning",
    })
    const body = JSON.parse(String(fetchImpl.mock.calls[1]![1]?.body))
    expect(body.messages).toEqual([
      { role: "system", content: "system" },
      { role: "user", content: "user" },
      {
        role: "assistant",
        content: "",
        reasoning_content: "  continuation data\n",
        tool_calls: [
          {
            id: "call-123",
            type: "function",
            function: { name: "lookup", arguments: '{"id":7}' },
          },
        ],
      },
      { role: "tool", tool_call_id: "call-123", content: '{"found":true}' },
    ])
  })

  test("rejects ambiguous and empty inputs before any request", async () => {
    const fetchImpl = mock(
      async (_url: string, _init?: RequestInit): Promise<Response> =>
        jsonResponse({})
    )
    await expect(
      // @ts-expect-error The two input modes are mutually exclusive.
      createClient(fetchImpl).execute({
        ...prompt,
        messages: [{ role: "user", content: "duplicate" }],
      })
    ).rejects.toThrow("exclusively")
    await expect(
      createClient(fetchImpl).execute({ systemPrompt: "system", messages: [] })
    ).rejects.toThrow("non-empty")
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  test.each([
    "required",
    { type: "function", function: { name: "lookup" } },
  ] as const)(
    "validates forced tool choice %j against thinking mode",
    async (toolChoice) => {
      const fetchImpl = mock(
        async (_url: string, _init?: RequestInit): Promise<Response> =>
          jsonResponse({ choices: [{ message: { content: "ok" } }] })
      )
      const client = createClient(fetchImpl)
      for (const reasoning of [
        undefined,
        { effort: "high" as const },
        { effort: "max" as const },
      ]) {
        await expect(
          client.execute({ ...prompt, tools: [tool], toolChoice, reasoning })
        ).rejects.toMatchObject({
          code: "text_generation_capability_unsupported",
        })
      }
      expect(fetchImpl).not.toHaveBeenCalled()
      await client.execute({
        ...prompt,
        tools: [tool],
        toolChoice,
        reasoning: { effort: "none" },
      })
      expect(
        JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body))
      ).toMatchObject({ reasoning_effort: "none", tool_choice: toolChoice })
    }
  )

  test("allows automatic and disabled tool selection with default thinking", async () => {
    const fetchImpl = mock(
      async (_url: string, _init?: RequestInit): Promise<Response> =>
        jsonResponse({ choices: [{ message: { content: "ok" } }] })
    )
    for (const toolChoice of ["auto", "none"] as const) {
      await createClient(fetchImpl).execute({
        ...prompt,
        tools: [tool],
        toolChoice,
      })
    }
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  test("requires the official beta endpoint and uniformly strict functions", async () => {
    const fetchImpl = mock(
      async (_url: string, _init?: RequestInit): Promise<Response> =>
        jsonResponse({ choices: [{ message: { content: "ok" } }] })
    )
    const strictTool = { ...tool, function: { ...tool.function, strict: true } }
    await expect(
      createClient(fetchImpl).execute({ ...prompt, tools: [strictTool] })
    ).rejects.toMatchObject({
      details: { capability: "strict_function_tools_without_beta" },
    })
    const beta = new DeepSeekGenerateTextClient(
      { ...config, baseUrl: "https://api.deepseek.com/beta/" },
      fetchImpl
    )
    await expect(
      beta.execute({ ...prompt, tools: [strictTool, tool] })
    ).rejects.toMatchObject({
      details: { capability: "mixed_strict_function_tools" },
    })
    expect(fetchImpl).not.toHaveBeenCalled()
    await beta.execute({ ...prompt, tools: [strictTool] })
    expect(fetchImpl.mock.calls[0]![0]).toBe(
      "https://api.deepseek.com/beta/chat/completions"
    )
    const proxy = new DeepSeekGenerateTextClient(
      { ...config, baseUrl: "https://proxy.example/v1" },
      fetchImpl
    )
    await proxy.execute({ ...prompt, tools: [strictTool] })
    expect(fetchImpl.mock.calls[1]![0]).toBe(
      "https://proxy.example/v1/chat/completions"
    )
  })

  test.each(["stop", "length", "content_filter", "tool_calls"])(
    "preserves finish reason %s and partial JSON",
    async (finishReason) => {
      const fetchImpl = mock(
        async (_url: string, _init?: RequestInit): Promise<Response> =>
          jsonResponse({
            choices: [
              {
                finish_reason: finishReason,
                message: { content: '{"partial":' },
              },
            ],
          })
      )
      const result = await createClient(fetchImpl).execute({
        ...prompt,
        responseFormat: { type: "json_object" },
        retryPolicy: { maxRetries: 2 },
      })
      expect(result).toMatchObject({ text: '{"partial":', finishReason })
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    }
  )

  test.each(["aborted", "insufficient_system_resource"])(
    "retries server interruption %s before returning a result",
    async (reason) => {
      const fetchImpl = mock(
        async (_url: string, _init?: RequestInit): Promise<Response> =>
          jsonResponse({
            choices: [
              {
                finish_reason:
                  fetchImpl.mock.calls.length === 1 ? reason : "stop",
                message: { content: "result" },
              },
            ],
          })
      )
      await expect(
        createClient(fetchImpl).execute({
          ...prompt,
          retryPolicy: { maxRetries: 1 },
        })
      ).resolves.toMatchObject({ text: "result", finishReason: "stop" })
      expect(fetchImpl).toHaveBeenCalledTimes(2)
      const interrupted = mock(
        async (_url: string, _init?: RequestInit): Promise<Response> =>
          jsonResponse({
            choices: [
              { finish_reason: reason, message: { content: "partial" } },
            ],
          })
      )
      await expect(
        createClient(interrupted).execute(prompt)
      ).rejects.toMatchObject({
        details: { retryable: true, raw: { finishReason: reason } },
      })
    }
  )

  test("assembles byte-fragmented SSE, reasoning, multiple tools and final usage", async () => {
    const events = [
      ": keep-alive",
      'data: {"choices":[{"delta":{"reasoning_content":"  análisis 🌎"}}]}',
      'data: {"choices":[{"delta":{"reasoning_content":"\\n"}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-a","function":{"name":"lookup","arguments":"{\\"id\\":"}},{"index":1,"id":"call-b","function":{"name":"clock","arguments":"{"}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"7}"}},{"index":1,"function":{"arguments":"}"}}]}}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":4,"completion_tokens":3,"total_tokens":7}}',
      "data: [DONE]",
    ].join("\r\n\r\n")
    const bytes = new TextEncoder().encode(events)
    let cancelled = false
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (const byte of bytes) controller.enqueue(new Uint8Array([byte]))
          controller.close()
        },
        cancel() {
          cancelled = true
        },
      })
    )
    const result = await createClient(
      mock(
        async (_url: string, _init?: RequestInit): Promise<Response> => response
      )
    ).execute({ ...prompt, stream: true })
    expect(result.reasoningContent).toBe("  análisis 🌎\n")
    expect(result.finishReason).toBe("tool_calls")
    expect(result.usage?.totalTokens).toBe(7)
    expect(result.toolCalls).toEqual([
      { id: "call-a", name: "lookup", arguments: '{"id":7}' },
      { id: "call-b", name: "clock", arguments: "{}" },
    ])
    expect(response.body?.locked).toBe(false)
    // A fully consumed stream needs no underlying cancellation.
    expect(cancelled).toBe(false)
  })

  test("cancels a still-open stream and releases the reader after DONE", async () => {
    let cancelled = false
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
            )
          )
        },
        cancel() {
          cancelled = true
        },
      })
    )
    await expect(
      createClient(
        mock(
          async (_url: string, _init?: RequestInit): Promise<Response> =>
            response
        )
      ).execute({ ...prompt, stream: true })
    ).resolves.toMatchObject({ text: "ok", finishReason: "stop" })
    expect(cancelled).toBe(true)
    expect(response.body?.locked).toBe(false)
  })

  test.each(["length", "content_filter"])(
    "reports streamed partial output with reason %s",
    async (reason) => {
      const fetchImpl = mock(
        async (_url: string, _init?: RequestInit): Promise<Response> =>
          new Response(
            `data: ${JSON.stringify({ choices: [{ delta: { content: "partial" }, finish_reason: reason }] })}\n\ndata: [DONE]\n\n`
          )
      )
      await expect(
        createClient(fetchImpl).execute({ ...prompt, stream: true })
      ).resolves.toMatchObject({ text: "partial", finishReason: reason })
    }
  )

  test("retries premature EOF only before delivering text to the consumer", async () => {
    const incomplete = 'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'
    const fetchImpl = mock(
      async (_url: string, _init?: RequestInit): Promise<Response> =>
        new Response(
          fetchImpl.mock.calls.length === 1
            ? incomplete
            : 'data: {"choices":[{"delta":{"content":"complete"}}]}\n\ndata: [DONE]\n\n'
        )
    )
    await expect(
      createClient(fetchImpl).execute({
        ...prompt,
        stream: true,
        retryPolicy: { maxRetries: 1 },
      })
    ).resolves.toMatchObject({ text: "complete" })
    expect(fetchImpl).toHaveBeenCalledTimes(2)

    const visibleFetch = mock(
      async (_url: string, _init?: RequestInit): Promise<Response> =>
        new Response(incomplete)
    )
    const chunks: string[] = []
    await expect(
      createClient(visibleFetch).execute({
        ...prompt,
        stream: true,
        onTextChunk: (chunk) => {
          chunks.push(chunk)
        },
        retryPolicy: { maxRetries: 1 },
      })
    ).rejects.toThrow("closed before [DONE]")
    expect(chunks).toEqual(["partial"])
    expect(visibleFetch).toHaveBeenCalledTimes(1)
  })

  test.each(["aborted", "insufficient_system_resource"])(
    "does not retry streamed %s after visible output",
    async (reason) => {
      const fetchImpl = mock(
        async (_url: string, _init?: RequestInit): Promise<Response> =>
          new Response(
            'data: {"choices":[{"delta":{"content":"visible"}}]}\n\n' +
              `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: reason }] })}\n\ndata: [DONE]\n\n`
          )
      )
      const chunks: string[] = []
      await expect(
        createClient(fetchImpl).execute({
          ...prompt,
          stream: true,
          onTextChunk: (chunk) => {
            chunks.push(chunk)
          },
          retryPolicy: { maxRetries: 1 },
        })
      ).rejects.toThrow(reason)
      expect(chunks).toEqual(["visible"])
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    }
  )

  test("rejects malformed SSE without retrying and releases its reader", async () => {
    const response = new Response("data: invalid-json\n\n")
    const fetchImpl = mock(
      async (_url: string, _init?: RequestInit): Promise<Response> => response
    )
    await expect(
      createClient(fetchImpl).execute({
        ...prompt,
        stream: true,
        retryPolicy: { maxRetries: 1 },
      })
    ).rejects.toThrow("invalid SSE JSON")
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(response.body?.locked).toBe(false)
  })
})
