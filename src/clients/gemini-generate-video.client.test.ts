import { expect, mock, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Buffer } from "node:buffer"
import { GeminiGenerateVideoClient } from "./gemini-generate-video.client"

const createClient = (options: {
  generateVideos: ReturnType<typeof mock>
  download: ReturnType<typeof mock>
}) => {
  const client = new GeminiGenerateVideoClient({
    apiKey: "test-key",
    model: "gemini-video",
  })
  ;(client as unknown as { ai: unknown }).ai = {
    models: { generateVideos: options.generateVideos },
    operations: {
      getVideosOperation: mock(async () => {
        throw new Error(
          "the operation was already done, polling is not expected"
        )
      }),
    },
    files: { download: options.download },
  }

  return client
}

const createDownload = (bytes: number) =>
  mock(async ({ downloadPath }: { downloadPath: string }) => {
    writeFileSync(downloadPath, Buffer.alloc(bytes))
  })

const createGenerateVideos = () =>
  mock(async () => ({
    done: true,
    response: {
      generatedVideos: [{ video: { mimeType: "video/mp4" } }],
    },
  }))

const withTempDir = async (run: (dir: string) => Promise<void>) => {
  const dir = mkdtempSync(join(tmpdir(), "ai-connectors-video-"))
  try {
    await run(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test("reports the billable video units for a 1080p generation", async () => {
  const download = createDownload(2048)
  const client = createClient({
    generateVideos: createGenerateVideos(),
    download,
  })

  await withTempDir(async (dir) => {
    const outputPath = join(dir, "video.mp4")
    const result = await client.execute({
      prompt: "Un plano cinematográfico.",
      outputPath,
      width: 1080,
      height: 1920,
    })

    expect(result.durationSeconds).toBe(8)
    expect(result.sizeBytes).toBe(2048)
    expect(result.usage).toEqual({
      videoCount: 1,
      durationSeconds: 8,
      resolution: "1080p",
    })
    expect(download).toHaveBeenCalledTimes(1)
  })
})

test("reports the billable video units for a 720p request", async () => {
  const client = createClient({
    generateVideos: createGenerateVideos(),
    download: createDownload(512),
  })

  await withTempDir(async (dir) => {
    const result = await client.execute({
      prompt: "Un plano corto.",
      outputPath: join(dir, "short.mp4"),
      width: 640,
      height: 480,
      durationSeconds: 4,
    })

    expect(result.usage).toEqual({
      videoCount: 1,
      durationSeconds: 4,
      resolution: "720p",
    })
  })
})
