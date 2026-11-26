import { GifReader } from 'omggif'
import { describe, expect, it } from 'vitest'

import {
  createGifLzwDecodeScratch,
  decodeGifLzw,
  GifByteWriter,
  GifLzwEncoder,
  gifMinimumCodeSize,
} from '../src/codecs/gif-lzw.ts'

// Deterministic generator so failures reproduce.
const random = (seed: number): (() => number) => {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x1_0000_0000
  }
}

const indexStream = (length: number, colors: number, runChance: number, seed: number) => {
  const next = random(seed)
  const output = new Uint8Array(length)
  let value = 0
  for (let index = 0; index < length; index += 1) {
    if (next() > runChance) value = Math.floor(next() * colors)
    output[index] = value
  }
  return output
}

// A minimal single-frame GIF around the encoded image data, for the independent decoder.
const wrapGif = (width: number, height: number, colors: number, imageData: Uint8Array) => {
  const tableBits = Math.max(1, Math.ceil(Math.log2(Math.max(2, colors))))
  const tableEntries = 1 << tableBits
  const writer = new GifByteWriter()
  writer.bytes(Uint8Array.from('GIF89a', (character) => character.charCodeAt(0)))
  writer.uint16(width)
  writer.uint16(height)
  writer.byte(0x80 | (tableBits - 1))
  writer.byte(0)
  writer.byte(0)
  for (let entry = 0; entry < tableEntries; entry += 1) {
    writer.byte(entry & 0xff)
    writer.byte((entry * 7) & 0xff)
    writer.byte((entry * 13) & 0xff)
  }
  writer.byte(0x2c)
  writer.uint16(0)
  writer.uint16(0)
  writer.uint16(width)
  writer.uint16(height)
  writer.byte(0)
  writer.bytes(imageData)
  writer.byte(0x3b)
  return writer.view().slice()
}

describe('GIF LZW', () => {
  const cases = [
    { width: 1, height: 1, colors: 2, runChance: 0 },
    { width: 7, height: 3, colors: 4, runChance: 0.2 },
    { width: 64, height: 64, colors: 16, runChance: 0.9 },
    { width: 320, height: 200, colors: 256, runChance: 0 },
    { width: 500, height: 400, colors: 256, runChance: 0.6 },
    { width: 999, height: 37, colors: 3, runChance: 0.99 },
    { width: 1200, height: 900, colors: 200, runChance: 0.3 },
  ] as const

  for (const [caseIndex, testCase] of cases.entries()) {
    it(`round-trips ${testCase.width}x${testCase.height} with ${testCase.colors} colors`, () => {
      const length = testCase.width * testCase.height
      const indices = indexStream(length, testCase.colors, testCase.runChance, caseIndex + 1)
      const minimumCodeSize = gifMinimumCodeSize(testCase.colors)
      const writer = new GifByteWriter(16)
      new GifLzwEncoder().encode(indices, 0, length, minimumCodeSize, writer)
      const encoded = writer.view().slice()

      const decoded = new Uint8Array(length)
      const next = decodeGifLzw(encoded, 1, minimumCodeSize, decoded, createGifLzwDecodeScratch())
      expect(next).toBe(encoded.byteLength)
      expect(Buffer.from(decoded).equals(Buffer.from(indices))).toBe(true)

      const reader = new GifReader(
        wrapGif(testCase.width, testCase.height, testCase.colors, encoded),
      )
      const pixels = new Uint8Array(length * 4)
      reader.decodeAndBlitFrameRGBA(0, pixels)
      const expected = new Uint8Array(length * 4)
      for (let index = 0; index < length; index += 1) {
        const value = indices[index] ?? 0
        expected[index * 4] = value & 0xff
        expected[index * 4 + 1] = (value * 7) & 0xff
        expected[index * 4 + 2] = (value * 13) & 0xff
        expected[index * 4 + 3] = 255
      }
      expect(Buffer.from(pixels).equals(Buffer.from(expected))).toBe(true)
    })
  }

  it('reuses one encoder across frames without leaking dictionary entries', () => {
    const encoder = new GifLzwEncoder()
    const scratch = createGifLzwDecodeScratch()
    for (let frame = 0; frame < 4; frame += 1) {
      const indices = indexStream(150_000, 256, 0.5, 100 + frame)
      const writer = new GifByteWriter()
      encoder.encode(indices, 0, indices.byteLength, 8, writer)
      const decoded = new Uint8Array(indices.byteLength)
      decodeGifLzw(writer.view(), 1, 8, decoded, scratch)
      expect(Buffer.from(decoded).equals(Buffer.from(indices))).toBe(true)
    }
  })

  it('rejects truncated data and codes beyond the dictionary', () => {
    const indices = indexStream(5000, 16, 0.5, 9)
    const writer = new GifByteWriter()
    new GifLzwEncoder().encode(indices, 0, indices.byteLength, 4, writer)
    const encoded = writer.view().slice()
    expect(() =>
      decodeGifLzw(
        encoded.subarray(0, 40),
        1,
        4,
        new Uint8Array(5000),
        createGifLzwDecodeScratch(),
      ),
    ).toThrow(/truncated/)
    // A clear code followed by a code past the next free entry.
    const bad = Uint8Array.of(2, 2, 0x44, 0x0f, 0)
    expect(() => decodeGifLzw(bad, 1, 2, new Uint8Array(4), createGifLzwDecodeScratch())).toThrow()
  })
})
