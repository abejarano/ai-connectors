import { describe, expect, test } from "bun:test"
import { DeepSeekGenerateMultimodalClient } from "./deepseek-generate-multimodal.client"
import { DeepSeekGenerateTextClient } from "./deepseek-generate-text.client"

const baseUrl = process.env.DEEPSEEK_SIMULATION_URL
const prompt = () => ({
  systemPrompt: "system",
  userPrompt: `test-${crypto.randomUUID()}`,
})
const config = (scenario: string) => {
  if (
    !["127.0.0.1", "localhost", "[::1]"].includes(new URL(baseUrl!).hostname)
  ) {
    throw new Error(
      "DEEPSEEK_SIMULATION_URL must point to a loopback simulation server."
    )
  }
  return {
    apiKey: "simulation-key",
    model: "deepseek-flash",
    baseUrl: `${baseUrl}/${scenario}`,
  }
}

describe.skipIf(!baseUrl)(
  "DeepSeek over real HTTP against local contract fixtures",
  () => {
    test("completes a thinking tool round trip through the HTTP server", async () => {
      const client = new DeepSeekGenerateTextClient(config("tools"))
      const initial = prompt()
      const tools = [
        {
          type: "function" as const,
          function: { name: "lookup", parameters: { type: "object" } },
        },
      ]
      const first = await client.execute({ ...initial, tools })
      expect(first.finishReason).toBe("tool_calls")
      const result = await client.execute({
        systemPrompt: "system",
        tools,
        messages: [
          { role: "user", content: initial.userPrompt },
          {
            role: "assistant",
            content: first.text,
            reasoningContent: first.reasoningContent,
            toolCalls: first.toolCalls,
          },
          {
            role: "tool",
            toolCallId: first.toolCalls![0]!.id,
            content: '{"found":true}',
          },
        ],
      })
      expect(result).toMatchObject({
        text: "Tool result received.",
        finishReason: "stop",
      })
    })

    test("retries HTTP 429 through native fetch", async () => {
      const result = await new DeepSeekGenerateTextClient(
        config("retry")
      ).execute({
        ...prompt(),
        retryPolicy: { maxRetries: 1, retryDelayMs: 5 },
      })
      expect(result).toMatchObject({
        text: "Complete.",
        finishReason: "stop",
        usage: { totalTokens: 12 },
      })
    })

    test("recovers from a server completion interrupted before a result was emitted", async () => {
      await expect(
        new DeepSeekGenerateTextClient(config("interrupted")).execute({
          ...prompt(),
          retryPolicy: { maxRetries: 1 },
        })
      ).resolves.toMatchObject({ text: "Complete.", finishReason: "stop" })
    })

    test("returns streamed partial JSON with its finish reason", async () => {
      const result = await new DeepSeekGenerateTextClient(
        config("length")
      ).execute({
        ...prompt(),
        stream: true,
        responseFormat: { type: "json_object" },
      })
      expect(result).toMatchObject({
        text: '{"partial":',
        finishReason: "length",
        reasoningContent: "continuation state",
        usage: { totalTokens: 12 },
      })
    })

    test("rejects premature stream EOF without replaying visible output", async () => {
      const chunks: string[] = []
      await expect(
        new DeepSeekGenerateTextClient(config("disconnect")).execute({
          ...prompt(),
          stream: true,
          onTextChunk: (chunk) => {
            chunks.push(chunk)
          },
          retryPolicy: { maxRetries: 2 },
        })
      ).rejects.toThrow("closed before [DONE]")
      expect(chunks).toEqual(["Hello 🌎"])
    })

    test("preserves JSON and proxy HTML errors over HTTP", async () => {
      const request = { ...prompt(), images: [] }
      await expect(
        new DeepSeekGenerateMultimodalClient(config("json-error")).execute(
          request
        )
      ).rejects.toMatchObject({
        details: {
          statusCode: 400,
          raw: { response: { error: { message: "Invalid image." } } },
        },
      })
      await expect(
        new DeepSeekGenerateMultimodalClient(config("html-error")).execute(
          request
        )
      ).rejects.toMatchObject({
        details: {
          statusCode: 503,
          raw: { response: "<html>upstream unavailable</html>" },
        },
      })
    })

    test("aborts a delayed multimodal HTTP response on timeout and on caller cancellation", async () => {
      const client = new DeepSeekGenerateMultimodalClient(config("slow"))
      const request = { ...prompt(), images: [] }
      await expect(
        client.execute({
          ...request,
          timeoutMs: 30,
          retryPolicy: { maxRetries: 1 },
        })
      ).rejects.toThrow("timed out after 30ms")
      const controller = new AbortController()
      const execution = client.execute({
        ...prompt(),
        images: [],
        signal: controller.signal,
        retryPolicy: { maxRetries: 1 },
      })
      controller.abort()
      await expect(execution).rejects.toMatchObject({
        code: "text_transport_error",
      })
    })

    test("sends inline image bytes over HTTP", async () => {
      const result = await new DeepSeekGenerateMultimodalClient(
        config("vision")
      ).execute({
        ...prompt(),
        images: [
          {
            bytes: Buffer.from(
              "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a27sAAAAASUVORK5CYII=",
              "base64"
            ),
            mimeType: "image/png",
          },
        ],
      })
      expect(result).toMatchObject({ text: "Complete.", finishReason: "stop" })
    })
  }
)
