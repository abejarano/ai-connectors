import { readFileSync, statSync } from "node:fs"

const readPngDimensions = (
  buffer: Buffer
): { width: number; height: number } | undefined => {
  if (buffer.length < 24) return undefined
  const signature = buffer.subarray(0, 8)
  if (!signature.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return undefined
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  }
}

const readJpegDimensions = (
  buffer: Buffer
): { width: number; height: number } | undefined => {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8)
    return undefined
  let offset = 2
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1
      continue
    }
    const marker = buffer[offset + 1]
    if (marker === 0xd9 || marker === 0xda) break
    const length = buffer.readUInt16BE(offset + 2)
    const isSof = [
      0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce,
      0xcf,
    ].includes(marker)
    if (isSof && offset + 9 < buffer.length) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
      }
    }
    offset += 2 + length
  }
  return undefined
}

const readWebpDimensions = (
  buffer: Buffer
): { width: number; height: number } | undefined => {
  if (buffer.length < 30) return undefined
  if (buffer.toString("ascii", 0, 4) !== "RIFF") return undefined
  if (buffer.toString("ascii", 8, 12) !== "WEBP") return undefined
  const chunkHeader = buffer.toString("ascii", 12, 16)
  if (chunkHeader === "VP8X") {
    const width = 1 + buffer.readUIntLE(24, 3)
    const height = 1 + buffer.readUIntLE(27, 3)
    return { width, height }
  }
  return undefined
}

export const inspectImageAsset = (
  path: string
): { sizeBytes: number; width: number; height: number } => {
  const stats = statSync(path)
  const buffer = readFileSync(path)
  const dimensions =
    readPngDimensions(buffer) ??
    readJpegDimensions(buffer) ??
    readWebpDimensions(buffer)

  if (!dimensions) {
    throw new Error(`Could not determine dimensions for image asset '${path}'.`)
  }

  return {
    sizeBytes: stats.size,
    width: dimensions.width,
    height: dimensions.height,
  }
}
