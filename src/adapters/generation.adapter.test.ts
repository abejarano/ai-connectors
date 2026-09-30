import { describe, expect, test } from "bun:test"
import { UnsupportedGenerationProviderError } from "../errors"
import { ImageGenerationAdapter } from "./image-generation.adapter"
import { MultimodalGenerationAdapter } from "./multimodal-generation.adapter"
import { TextGenerationAdapter } from "./text-generation.adapter"
import { VideoGenerationAdapter } from "./video-generation.adapter"

describe("generation adapters", () => {
  test("selects the declared text provider and delegates execution", async () => {
    const adapter = new TextGenerationAdapter({
      provider: "deepseek",
      apiKey: "test-key",
      model: "deepseek-flash",
    })
    const request = {
      systemPrompt: "Answer briefly.",
      userPrompt: "Hello",
    }
    const response = { text: "Hello" }
    const client = (
      adapter as unknown as {
        client: { execute: (value: typeof request) => Promise<typeof response> }
      }
    ).client
    client.execute = async (value) => {
      expect(value).toBe(request)
      return response
    }

    expect(adapter.capabilities.structuredOutput.jsonSchema).toBe("best_effort")
    await expect(adapter.execute(request)).resolves.toBe(response)
  })

  test("selects Gemini capabilities for text", () => {
    const adapter = new TextGenerationAdapter({
      provider: "gemini",
      apiKey: "test-key",
      model: "gemini-2.5-flash",
    })

    expect(adapter.capabilities.structuredOutput.jsonSchema).toBe("enforced")
  })

  test("selects provider-specific multimodal capabilities", () => {
    const gemini = new MultimodalGenerationAdapter({
      provider: "gemini",
      apiKey: "test-key",
      model: "gemini-2.5-flash",
    })

    const deepseek = new MultimodalGenerationAdapter({
      provider: "deepseek",
      apiKey: "test-key",
      model: "deepseek-vl",
    })

    expect(gemini.capabilities).toEqual({
      provider: "gemini",
      imageInput: true,
      structuredOutput: { jsonObject: true, jsonSchema: "enforced" },
    })
    expect(deepseek.capabilities).toEqual({
      provider: "deepseek",
      imageInput: true,
      structuredOutput: { jsonObject: true, jsonSchema: "best_effort" },
    })
  })

  test("delegates image and video generation to the selected client", async () => {
    const image = new ImageGenerationAdapter({
      provider: "gemini",
      apiKey: "test-key",
      model: "gemini-3-pro-image",
    })
    const video = new VideoGenerationAdapter({
      provider: "gemini",
      apiKey: "test-key",
      model: "gemini-video",
    })
    const imageRequest = {
      prompt: "Generate an image.",
      outputPath: "/tmp/image.png",
      width: 1024,
      height: 1024,
    }
    const imageEditRequest = {
      image: { bytes: new Uint8Array([1, 2, 3]), mimeType: "image/jpeg" },
      prompt: "Edit the image.",
      outputPath: "/tmp/edited.png",
    }
    const videoRequest = {
      prompt: "Generate a video.",
      outputPath: "/tmp/video.mp4",
      width: 1080,
      height: 1920,
    }
    const imageResponse = {
      asset: { kind: "file" as const, path: "/tmp/image.png" },
      mimeType: "image/png",
      sizeBytes: 1,
      width: 1024,
      height: 1024,
    }
    const imageEditResponse = {
      asset: { kind: "file" as const, path: "/tmp/edited.png" },
      mimeType: "image/png",
      sizeBytes: 1,
      width: 1024,
      height: 1024,
    }
    const videoResponse = {
      asset: { kind: "file" as const, path: "/tmp/video.mp4" },
      mimeType: "video/mp4",
      sizeBytes: 1,
      durationSeconds: 8,
    }
    const imageClient = (
      image as unknown as {
        client: {
          execute: (value: typeof imageRequest) => Promise<typeof imageResponse>
          edit: (
            value: typeof imageEditRequest
          ) => Promise<typeof imageEditResponse>
        }
      }
    ).client
    const videoClient = (
      video as unknown as {
        client: {
          execute: (value: typeof videoRequest) => Promise<typeof videoResponse>
        }
      }
    ).client
    imageClient.execute = async (value) => {
      expect(value).toBe(imageRequest)
      return imageResponse
    }
    imageClient.edit = async (value) => {
      expect(value).toBe(imageEditRequest)
      return imageEditResponse
    }
    videoClient.execute = async (value) => {
      expect(value).toBe(videoRequest)
      return videoResponse
    }

    expect(image.capabilities).toEqual({
      provider: "gemini",
      negativePrompt: true,
      aspectRatio: true,
      imageEdit: true,
    })
    expect(video.capabilities).toEqual({
      provider: "gemini",
      negativePrompt: true,
      polling: true,
    })
    await expect(image.execute(imageRequest)).resolves.toBe(imageResponse)
    await expect(image.edit(imageEditRequest)).resolves.toBe(imageEditResponse)
    await expect(video.execute(videoRequest)).resolves.toBe(videoResponse)
  })

  test("reports imageEdit per model instead of per provider", () => {
    const editing = new ImageGenerationAdapter({
      provider: "gemini",
      apiKey: "test-key",
      model: "gemini-3-pro-image",
    })
    const legacy = new ImageGenerationAdapter({
      provider: "gemini",
      apiKey: "test-key",
      model: "imagen-3.0-generate-002",
    })

    expect(editing.capabilities.imageEdit).toBe(true)
    expect(legacy.capabilities.imageEdit).toBe(false)
  })

  test("rejects a provider unsupported by each generation capability", () => {
    expect(() => {
      new TextGenerationAdapter({
        provider: "unknown",
        apiKey: "test-key",
        model: "test-model",
      } as never)
    }).toThrow(UnsupportedGenerationProviderError)

    expect(() => {
      new ImageGenerationAdapter({
        provider: "deepseek",
        apiKey: "test-key",
        model: "test-model",
      } as never)
    }).toThrow(UnsupportedGenerationProviderError)

    expect(() => {
      new VideoGenerationAdapter({
        provider: "deepseek",
        apiKey: "test-key",
        model: "test-model",
      } as never)
    }).toThrow(UnsupportedGenerationProviderError)
  })
})
