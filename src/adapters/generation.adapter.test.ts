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
      model: "gemini-image",
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
    videoClient.execute = async (value) => {
      expect(value).toBe(videoRequest)
      return videoResponse
    }

    expect(image.capabilities).toEqual({
      provider: "gemini",
      negativePrompt: true,
      aspectRatio: true,
    })
    expect(video.capabilities).toEqual({
      provider: "gemini",
      negativePrompt: true,
      polling: true,
    })
    await expect(image.execute(imageRequest)).resolves.toBe(imageResponse)
    await expect(video.execute(videoRequest)).resolves.toBe(videoResponse)
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
