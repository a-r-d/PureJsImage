import { createHash } from 'node:crypto'

import type { ImageCodec } from '../../src/codec.ts'
import { nodeRuntime } from '../../src/node-runtime.ts'

export type PngBenchmarkFormat = 'rgb8' | 'rgba8'
export type PngBenchmarkPattern = 'smooth' | 'high-entropy'

export const PNG_BENCHMARK_SEED = 0x5a17c9e3
export const PNG_BENCHMARK_BLOCK_ROWS = 32
export const PNG_BENCHMARK_COMPRESSION_LEVEL = 6

export const channelsForFormat = (format: PngBenchmarkFormat): number => (format === 'rgb8' ? 3 : 4)

export const createBenchmarkPixels = (
  width: number,
  height: number,
  format: PngBenchmarkFormat,
  pattern: PngBenchmarkPattern,
): Uint8Array => {
  const channels = channelsForFormat(format)
  const pixels = new Uint8Array(width * height * channels)
  let random = (PNG_BENCHMARK_SEED ^ width ^ (height << 12) ^ channels) >>> 0
  const horizontalDivisor = Math.max(1, width - 1)
  const verticalDivisor = Math.max(1, height - 1)
  const diagonalDivisor = Math.max(1, width + height - 2)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * channels
      if (pattern === 'smooth') {
        pixels[offset] = Math.floor((x * 255) / horizontalDivisor)
        pixels[offset + 1] = Math.floor((y * 255) / verticalDivisor)
        pixels[offset + 2] = Math.floor(((x + y) * 255) / diagonalDivisor)
        if (channels === 4) {
          pixels[offset + 3] = 64 + Math.floor(((x + y) * 191) / diagonalDivisor)
        }
        continue
      }
      for (let channel = 0; channel < channels; channel += 1) {
        random ^= random << 13
        random ^= random >>> 17
        random ^= random << 5
        pixels[offset + channel] = random >>> 24
      }
    }
  }
  return pixels
}

export const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')

export const encodeBenchmarkPng = async (
  codec: ImageCodec,
  pixels: Uint8Array,
  width: number,
  height: number,
  format: PngBenchmarkFormat,
): Promise<Uint8Array> => {
  const chunks: Uint8Array[] = []
  let outputBytes = 0
  const sink = {
    async write(chunk: Uint8Array): Promise<void> {
      const owned = Uint8Array.from(chunk)
      chunks.push(owned)
      outputBytes += owned.byteLength
    },
    async close(): Promise<void> {},
    async abort(): Promise<void> {},
  }
  const encoder = await codec.createEncoder?.(sink, {
    width,
    height,
    pixelFormat: format,
    options: { compressionLevel: PNG_BENCHMARK_COMPRESSION_LEVEL },
    runtime: nodeRuntime,
  })
  if (!encoder) throw new Error('PNG benchmark encoder is unavailable')
  const rowBytes = width * channelsForFormat(format)
  for (let y = 0; y < height; y += PNG_BENCHMARK_BLOCK_ROWS) {
    const blockHeight = Math.min(PNG_BENCHMARK_BLOCK_ROWS, height - y)
    const offset = y * rowBytes
    await encoder.write({
      data: pixels.subarray(offset, offset + blockHeight * rowBytes),
      format,
      height: blockHeight,
      stride: rowBytes,
      width,
      x: 0,
      y,
    })
  }
  await encoder.finish()
  const output = new Uint8Array(outputBytes)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}
