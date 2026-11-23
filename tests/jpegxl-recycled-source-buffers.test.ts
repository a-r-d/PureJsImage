import { readFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { jpegxlCodec } from '../src/codecs/jpegxl.ts'
import { defaultImageLimits } from '../src/limits.ts'
import { Uint8ArraySink } from '../src/sink.ts'
import { HostileSource } from './hostile-source.ts'
import { Image } from './image-library.ts'

const fixtures = new URL('./fixtures/jpegxl/global-modular/', import.meta.url)

const noise = (length: number): Uint8Array => {
  const samples = new Uint8Array(length)
  let state = 0x2545f491
  for (let index = 0; index < length; index++) {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    samples[index] = state & 255
  }
  return samples
}

const encodeLossless = async (
  pixels: Uint8Array,
  width: number,
  height: number,
): Promise<Uint8Array> => {
  const sink = new Uint8ArraySink()
  const encoder = await jpegxlCodec.createEncoder?.(sink, {
    width,
    height,
    pixelFormat: 'rgb8',
    limits: defaultImageLimits,
    colorSemantics: {
      family: 'rgb',
      primaries: 'srgb',
      transfer: { kind: 'srgb' },
      matrix: 'identity',
      range: 'full',
      alpha: 'none',
      provenance: 'container-signaled',
    },
    options: { effort: 3 },
  })
  if (!encoder) throw new Error('Missing JPEG XL encoder')
  await encoder.write({
    x: 0,
    y: 0,
    width,
    height,
    stride: width * 3,
    format: 'rgb8',
    data: pixels,
  })
  await encoder.finish()
  return sink.toUint8Array()
}

const decodeRgb8 = async (bytes: Uint8Array): Promise<Uint8Array> => {
  const decoder = await jpegxlCodec.createDecoder?.(new HostileSource(bytes), defaultImageLimits)
  if (decoder?.pixelFormat !== 'rgb8') throw new Error('Missing RGB8 JPEG XL decoder')
  const pixels = new Uint8Array(decoder.width * decoder.height * 3)
  for await (const block of decoder.decode()) {
    try {
      for (let y = 0; y < block.height; y++) {
        const start = y * block.stride
        pixels.set(
          block.data.subarray(start, start + block.width * 3),
          ((block.y + y) * decoder.width + block.x) * 3,
        )
      }
    } finally {
      block.release?.()
    }
  }
  return pixels
}

describe('JPEG XL Modular decoding with recycled source buffers', () => {
  it('decodes our lossless groups that share a band through the hostile image library', async () => {
    // The encoder uses 1024-pixel groups, so 1025 columns put two groups in one
    // band. 1024 x 96 RGB noise cannot compress below 288 KiB, so the first
    // group skips the 256 KiB read-ahead buffer and comes straight from the
    // recycling source.
    const width = 1025
    const height = 96
    const pixels = noise(width * height * 3)
    const encoded = await encodeLossless(pixels, width, height)
    const output = new Uint8Array(await (await Image.open(encoded)).ppm().toBuffer())
    const header = new TextEncoder().encode(`P6\n${width} ${height}\n255\n`)
    expect(output.subarray(0, header.length)).toEqual(header)
    expect(output.subarray(header.length)).toEqual(pixels)
  })

  for (const id of ['palette-8', 'squeeze-8'] as const) {
    it(`decodes the libjxl ${id} multi-group file when every read recycles the last buffer`, async () => {
      const bytes = new Uint8Array(await readFile(new URL(`${id}.jxl`, fixtures)))
      const reference = new Uint8Array(
        gunzipSync(await readFile(new URL(`${id}.rgb.gz`, fixtures))),
      )
      expect(await decodeRgb8(bytes)).toEqual(reference)
    })
  }

  it('returns every requested metadata box when later box reads recycle the buffer', async () => {
    const exif = Uint8Array.of(0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 0, 0, 0, 0, 0)
    const xmp = new TextEncoder().encode('<x:xmpmeta xmlns:x="adobe:ns:meta/"/>')
    const sink = new Uint8ArraySink()
    const encoder = await jpegxlCodec.createEncoder?.(sink, {
      width: 1,
      height: 1,
      pixelFormat: 'rgb8',
      limits: defaultImageLimits,
      metadata: { exif, xmp },
      options: { container: true },
    })
    if (!encoder) throw new Error('Missing JPEG XL encoder')
    await encoder.write({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      stride: 3,
      format: 'rgb8',
      data: Uint8Array.of(1, 2, 3),
    })
    await encoder.finish()
    const kept = await jpegxlCodec.preservedMetadata?.(
      new HostileSource(sink.toUint8Array()),
      defaultImageLimits,
      { exif: true, icc: false, xmp: true },
    )
    expect(kept).toMatchObject({ exif, xmp })
  })
})
