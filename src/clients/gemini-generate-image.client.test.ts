import { expect, mock, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Buffer } from "node:buffer"
import {
  InvalidImageInputError,
  UnsupportedImageEditCapabilityError,
  isTransportError,
} from "../errors"
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

const EDITING_MODEL = "gemini-3-pro-image"

const createClient = (
  generateContent: ReturnType<typeof mock>,
  config: { model?: string; allowUnverifiedImageEdit?: boolean } = {}
) => {
  const client = new GeminiGenerateImageClient({
    apiKey: "test-key",
    model: config.model ?? EDITING_MODEL,
    allowUnverifiedImageEdit: config.allowUnverifiedImageEdit,
  })
  ;(client as unknown as { ai: { models: unknown } }).ai = {
    models: { generateContent },
  }

  return client
}

const createGenerateContent = (png: Buffer) =>
  mock(async () => ({
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

const withTempDir = async (run: (dir: string) => Promise<void>) => {
  const dir = mkdtempSync(join(tmpdir(), "ai-connectors-image-"))
  try {
    await run(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// Contrato compartido: `execute` y `edit` deben devolver la misma forma de
// resultado y persistir el asset igual.
const assertImageResponseContract = (
  result: Awaited<ReturnType<GeminiGenerateImageClient["execute"]>>,
  outputPath: string,
  png: Buffer
) => {
  expect(result.asset).toEqual({ kind: "file", path: outputPath })
  expect(result.mimeType).toBe("image/png")
  expect(result.width).toBe(640)
  expect(result.height).toBe(480)
  expect(result.sizeBytes).toBe(png.length)
  expect(readFileSync(outputPath).equals(png)).toBe(true)
  expect(result.usage?.imageCount).toBe(1)
  expect(result.usage?.tokens?.totalTokens).toBe(1300)
}

const editInput = { bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png" }

test("execute (text-to-image) satisfies the image response contract", async () => {
  const png = createPng(640, 480)
  const client = createClient(createGenerateContent(png))

  await withTempDir(async (dir) => {
    const outputPath = join(dir, "generated.png")
    const result = await client.execute({
      prompt: "Una interfaz editorial.",
      outputPath,
      width: 1024,
      height: 1024,
    })

    assertImageResponseContract(result, outputPath, png)
  })
})

test("edit (image-to-image) satisfies the same image response contract", async () => {
  const png = createPng(640, 480)
  const client = createClient(createGenerateContent(png))

  await withTempDir(async (dir) => {
    const outputPath = join(dir, "edited.png")
    const result = await client.edit({
      image: { bytes: new Uint8Array([1, 2, 3]), mimeType: "image/jpeg" },
      prompt: "Transforma esta fotografía en un key visual industrial.",
      outputPath,
    })

    assertImageResponseContract(result, outputPath, png)
  })
})

test("edit sends the input bytes and MIME type untouched alongside the instruction", async () => {
  const png = createPng(640, 480)
  const generateContent = createGenerateContent(png)
  const client = createClient(generateContent)
  // Bytes deliberadamente no triviales, con un MIME distinto al de salida.
  const inputBytes = new Uint8Array([0, 1, 2, 253, 254, 255])
  const prompt =
    "Preserva al técnico, la bomba, el manómetro y la escena. " +
    "Transforma esta fotografía en un key visual de campaña industrial."

  await withTempDir(async (dir) => {
    await client.edit({
      image: { bytes: inputBytes, mimeType: "image/jpeg" },
      prompt,
      outputPath: join(dir, "edited.png"),
    })
  })

  const [request] = generateContent.mock.calls[0] as unknown as [
    {
      contents: Array<{ role: string; parts: unknown[] }>
      config: Record<string, unknown>
    },
  ]

  // MIME verbatim y bytes sólo codificados en base64, sin recodificar.
  expect(request.contents[0].parts[1]).toEqual({
    inlineData: {
      data: Buffer.from(inputBytes).toString("base64"),
      mimeType: "image/jpeg",
    },
  })
  expect(request.contents[0].parts[0]).toEqual({ text: prompt })
  expect(request.config.responseModalities).toEqual(["IMAGE"])
  // Sin imageConfig: se deja que el modelo decida el encuadre desde la entrada.
  expect(request.config).not.toHaveProperty("imageConfig")
})

test("edit rejects an empty image instead of calling the provider", async () => {
  const generateContent = createGenerateContent(createPng(640, 480))
  const client = createClient(generateContent)

  await withTempDir(async (dir) => {
    const execution = client.edit({
      image: { bytes: new Uint8Array(), mimeType: "image/png" },
      prompt: "Edita.",
      outputPath: join(dir, "edited.png"),
    })

    await expect(execution).rejects.toBeInstanceOf(InvalidImageInputError)
    await expect(
      client.edit({
        image: { bytes: new Uint8Array(), mimeType: "image/png" },
        prompt: "Edita.",
        outputPath: join(dir, "edited.png"),
      })
    ).rejects.toMatchObject({ code: "image_input_invalid" })
  })

  expect(generateContent).not.toHaveBeenCalled()
})

test("edit rejects a blank MIME type", async () => {
  const client = createClient(createGenerateContent(createPng(640, 480)))

  await expect(
    client.edit({
      image: { bytes: new Uint8Array([1, 2, 3]), mimeType: "   " },
      prompt: "Edita.",
      outputPath: "/tmp/never-written.png",
    })
  ).rejects.toBeInstanceOf(InvalidImageInputError)
})

test("declares imageEdit for a verified editing model", () => {
  const client = createClient(createGenerateContent(createPng(1, 1)))

  expect(client.capabilities).toEqual({
    provider: "gemini",
    negativePrompt: true,
    aspectRatio: true,
    imageEdit: true,
  })
})

test("does not claim imageEdit for an unknown model", () => {
  const client = createClient(createGenerateContent(createPng(1, 1)), {
    model: "imagen-3.0-generate-002",
  })

  expect(client.capabilities.imageEdit).toBe(false)
})

test("edit fails loudly instead of falling back to text-to-image", async () => {
  const generateContent = createGenerateContent(createPng(640, 480))
  const client = createClient(generateContent, {
    model: "imagen-3.0-generate-002",
  })

  const error = await client
    .edit({
      image: editInput,
      prompt: "Edita.",
      outputPath: "/tmp/never-written.png",
    })
    .catch((thrown: unknown) => thrown)

  expect(error).toBeInstanceOf(UnsupportedImageEditCapabilityError)
  expect(error).toMatchObject({
    code: "image_edit_unsupported",
    details: {
      capability: "imageEdit",
      provider: "gemini",
      model: "imagen-3.0-generate-002",
    },
  })
  // Es un error de capacidad, no de transporte: no se reintenta.
  expect(isTransportError(error)).toBe(false)
  expect(generateContent).not.toHaveBeenCalled()
})

test("edit allows opting in to an unverified model", async () => {
  const png = createPng(640, 480)
  const generateContent = createGenerateContent(png)
  const client = createClient(generateContent, {
    model: "gemini-future-image",
    allowUnverifiedImageEdit: true,
  })

  expect(client.capabilities.imageEdit).toBe(true)

  await withTempDir(async (dir) => {
    const outputPath = join(dir, "edited.png")
    const result = await client.edit({
      image: editInput,
      prompt: "Edita.",
      outputPath,
    })

    assertImageResponseContract(result, outputPath, png)
  })
})
