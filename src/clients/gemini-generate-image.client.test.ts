import { expect, mock, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Buffer } from "node:buffer"
import { GeminiGenerateImageClient } from "./gemini-generate-image.client"

// PNG mínimo válido: firma + chunk IHDR con ancho y alto en los offsets 16/20.
const createPng = (width: number, height: number): Buffer => {
  const bytes = Buffer.alloc(24)
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes, 0)
  bytes.write("IHDR", 12, "ascii")
  bytes.writeUInt32BE(width, 16)
  bytes.writeUInt32BE(height, 20)
  return bytes
}

const createClient = (generateContent: ReturnType<typeof mock>) => {
  const client = new GeminiGenerateImageClient({
    apiKey: "test-key",
    model: "gemini-image",
  })
  ;(client as unknown as { ai: { models: unknown } }).ai = {
    models: { generateContent },
  }

  return client
}

const withTempDir = async (run: (dir: string) => Promise<void>) => {
  const dir = mkdtempSync(join(tmpdir(), "ai-connectors-image-"))
  try {
    await run(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test("reports token usage and the number of generated images", async () => {
  const png = createPng(1024, 1024)
  const generateContent = mock(async () => ({
    candidates: [
      {
        content: {
          parts: [
            {
              inlineData: {
                data: png.toString("base64"),
                mimeType: "image/png",
              },
            },
          ],
        },
      },
    ],
    usageMetadata: {
      promptTokenCount: 10,
      candidatesTokenCount: 1290,
      totalTokenCount: 1300,
    },
  }))
  const client = createClient(generateContent)

  await withTempDir(async (dir) => {
    const outputPath = join(dir, "image.png")
    const result = await client.execute({
      prompt: "Una interfaz editorial.",
      outputPath,
      width: 1024,
      height: 1024,
    })

    expect(result.usage?.imageCount).toBe(1)
    expect(result.usage?.tokens?.inputTokens).toBe(10)
    expect(result.usage?.tokens?.outputTokens).toBe(1290)
    expect(result.usage?.tokens?.totalTokens).toBe(1300)
    expect(readFileSync(outputPath).equals(png)).toBe(true)
  })
})

test("keeps the usage slot when Gemini omits usageMetadata", async () => {
  const png = createPng(512, 512)
  const generateContent = mock(async () => ({
    candidates: [
      {
        content: {
          parts: [
            {
              inlineData: {
                data: png.toString("base64"),
                mimeType: "image/png",
              },
            },
          ],
        },
      },
    ],
  }))
  const client = createClient(generateContent)

  await withTempDir(async (dir) => {
    const result = await client.execute({
      prompt: "Un icono minimalista.",
      outputPath: join(dir, "icon.png"),
      width: 512,
      height: 512,
    })

    expect(result.usage?.imageCount).toBe(1)
    expect(result.usage?.tokens).toBeUndefined()
  })
})
