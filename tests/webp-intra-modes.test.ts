import { PNG } from 'pngjs'
import sharp from 'sharp'
import { expect, it } from 'vitest'
import { createWasmWebpAccelerator } from '../src/accelerator-entries/wasm-webp-node.ts'
import { pngCodec } from '../src/codecs/png.ts'
import {
  coefficientUpdateProbabilities,
  keyframeBlockModeProbabilities,
} from '../src/codecs/vp8-tables.ts'
import { webpCodec } from '../src/codecs/webp.ts'
import { createNodeImageLibrary } from '../src/node-image.ts'
import { Image } from './image-library.ts'

// Read the actual RFC 6386 prediction records. Pixel comparisons alone can
// pass even if the encoder only ever selects one macroblock partition.
const predictionModes = (bytes: Uint8Array, width: number, height: number) => {
  expect(String.fromCharCode(...bytes.subarray(12, 16))).toBe('VP8 ')
  let position = 31 * 8
  let value = bytes[30] ?? 0
  let range = 255
  const bit = (probability = 128): number => {
    const split = 1 + (((range - 1) * probability) >> 8)
    const one = Number(value >= split)
    if (one) {
      value -= split
      range -= split
    } else range = split
    while (range < 128) {
      range *= 2
      value = value * 2 + (((bytes[position >> 3] ?? 0) >> (7 - (position & 7))) & 1)
      position++
    }
    return one
  }
  const uint = (n: number): number => {
    let result = 0
    for (let i = 0; i < n; i++) result = 2 * result + bit()
    return result
  }
  expect(uint(4)).toBe(0) // color, clamp, segmentation, filter type
  expect(uint(10)).toBe(0) // deblocking level, sharpness and deltas
  expect(uint(2)).toBe(0) // one token partition
  uint(7) // quantizer
  for (let i = 0; i < 5; i++) if (bit()) uint(5)
  bit()
  for (const p of coefficientUpdateProbabilities) if (bit(p)) uint(8)
  const skip = bit()
  const skipProb = skip ? uint(8) : 0
  const luma = new Set<number>()
  const chroma = new Set<number>()
  const sub = new Set<number>()
  const above = new Uint8Array(Math.ceil(width / 16) * 4)
  const left = new Uint8Array(4)
  for (let y = 0; y < height; y += 16) {
    left.fill(0)
    for (let x = 0; x < width; x += 16) {
      if (skip) bit(skipProb)
      const macro = bit(145) === 0 ? 4 : bit(156) === 0 ? bit(163) : 2 + bit(128)
      luma.add(macro)
      for (let b = 0; b < 16; b++) {
        const ax = (x >> 2) + (b & 3)
        const ly = b >> 2
        let mode = macro === 0 ? 0 : macro === 3 ? 1 : macro + 1
        if (macro === 4) {
          const offset = ((above[ax] ?? 0) * 10 + (left[ly] ?? 0)) * 9
          const read = (node: number) => bit(keyframeBlockModeProbabilities[offset + node])
          mode =
            read(0) === 0
              ? 0
              : read(1) === 0
                ? 1
                : read(2) === 0
                  ? 2
                  : read(3) === 0
                    ? read(4) === 0
                      ? 3
                      : 5 + read(5)
                    : read(6) === 0
                      ? 4
                      : read(7) === 0
                        ? 7
                        : 8 + read(8)
          sub.add(mode)
        }
        left[ly] = above[ax] = mode
      }
      chroma.add(bit(142) === 0 ? 0 : bit(114) === 0 ? 1 : 2 + bit(183))
    }
  }
  return { luma, chroma, sub }
}

const chart = (width: number, height: number, color: boolean): Buffer => {
  const png = new PNG({ width, height })
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const panel = ((x >> 5) + 3 * (y >> 5)) % 7
      const base =
        panel === 0
          ? 100
          : panel === 1
            ? x
            : panel === 2
              ? y
              : panel === 3
                ? x + y
                : panel === 4
                  ? 2 * y - x
                  : panel === 5
                    ? 2 * x + y
                    : (x * 17 + y * 31) ^ (y * x)
      const i = 4 * (y * width + x)
      png.data[i] = base & 255
      png.data[i + 1] = (base + (color ? (panel === 0 ? (y & ~31) >> 1 : y >> 1) : 0)) & 255
      png.data[i + 2] = (base + (color ? (panel === 0 ? (x & ~31) >> 1 : x >> 1) : 0)) & 255
      png.data[i + 3] = 255
    }
  return PNG.sync.write(png)
}

it('round-trips the four 16×16 luma modes and ten submodes on odd frame edges', async () => {
  const width = 257
  const height = 193
  const src = chart(width, height, false)
  const encoded = await (await Image.open(src)).webp({ quality: 75 }).toBuffer()
  const { luma, sub } = predictionModes(encoded, width, height)
  expect([...luma].sort()).toEqual([0, 1, 2, 3, 4])
  expect([...sub].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  const our = PNG.sync.read(await (await Image.open(encoded)).png().toBuffer())
  const oracle = await sharp(encoded).ensureAlpha().raw().toBuffer()
  let maxError = 0
  for (let i = 0; i < oracle.length; i++)
    maxError = Math.max(maxError, Math.abs((our.data[i] ?? 0) - (oracle[i] ?? 0)))
  // Neutral chroma removes differences from nearest versus fancy upsampling.
  expect(maxError).toBeLessThanOrEqual(1)
})

it('sends the same four chroma modes through the reference and accelerated encoders', async () => {
  const width = 257
  const height = 193
  const src = chart(width, height, true)
  const accelerated = createNodeImageLibrary([
    pngCodec,
    createWasmWebpAccelerator({ minimumEncodePixels: 1 }).accelerate(webpCodec),
  ])
  const encoded = await (await Image.open(src)).webp({ quality: 75 }).toBuffer()
  const wasm = await (await accelerated.open(src)).webp({ quality: 75 }).toBuffer()
  expect(Buffer.compare(encoded, wasm)).toBe(0)
  expect([...predictionModes(encoded, width, height).chroma].sort()).toEqual([0, 1, 2, 3])
  const ours = PNG.sync.read(await (await Image.open(encoded)).png().toBuffer())
  const oracle = await sharp(wasm).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  expect([ours.width, ours.height]).toEqual([oracle.info.width, oracle.info.height])
  // Each 32×32 flat patch has constant source chroma over its interior.
  for (let y = 16; y < height - 16; y += 32)
    for (let x = 16; x < width - 16; x += 32) {
      if (((x >> 5) + 3 * (y >> 5)) % 7 !== 0) continue
      const offset = 4 * (y * width + x)
      for (let c = 0; c < 3; c++)
        expect(
          Math.abs((ours.data[offset + c] ?? 0) - (oracle.data[offset + c] ?? 0)),
        ).toBeLessThanOrEqual(4)
    }
})

it('enforces the 14-bit VP8 dimension at the public encode boundary', async () => {
  const largest = await (await Image.open(chart(16383, 1, false))).webp().toBuffer()
  expect((await sharp(largest).metadata()).width).toBe(16383)
  await expect((await Image.open(chart(16384, 1, false))).webp().toBuffer()).rejects.toThrow(
    '14 bits',
  )
})
