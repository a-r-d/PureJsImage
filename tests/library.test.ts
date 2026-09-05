import { PNG } from 'pngjs'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { allCodecs } from '../src/codec-entries/all.ts'
import { avifCodec } from '../src/codec-entries/avif.ts'
import { experimentalHeifCodec } from '../src/codec-entries/experimental/heic.ts'
import { jpegCodec } from '../src/codec-entries/jpeg.ts'
import { jpegxlCodec } from '../src/codec-entries/jpegxl.ts'
import { pngCodec } from '../src/codec-entries/png.ts'
import { crc32 } from '../src/codecs/crc32.ts'
import {
  CodecRegistry,
  createImageLibrary,
  type ImageCodecAccelerator,
  type ImageSource,
  MemorySource,
} from '../src/index.ts'
import { jpegFixture } from './fixtures.ts'
import { defaultImageLimits } from '../src/limits.ts'

const pngFixture = (): Uint8Array => {
  const encoded = PNG.sync.write(new PNG({ width: 4, height: 3 }))
  const type = ascii('sRGB')
  const payload = Uint8Array.of(1)
  const chunk = new Uint8Array(13)
  new DataView(chunk.buffer).setUint32(0, payload.byteLength)
  chunk.set(type, 4)
  chunk.set(payload, 8)
  new DataView(chunk.buffer).setUint32(9, crc32(type, payload))
  const output = new Uint8Array(encoded.byteLength + chunk.byteLength)
  output.set(encoded.subarray(0, 33))
  output.set(chunk, 33)
  output.set(encoded.subarray(33), 33 + chunk.byteLength)
  return output
}

const ascii = (value: string): Uint8Array =>
  Uint8Array.from(value, (character) => character.charCodeAt(0))

const ftyp = (
  majorBrand: string,
  compatibleBrands: readonly string[],
  minorVersion: Uint8Array = Uint8Array.of(0, 0, 0, 0),
): Uint8Array => {
  const size = 16 + compatibleBrands.length * 4
  const output = new Uint8Array(size)
  new DataView(output.buffer).setUint32(0, size)
  output.set(ascii('ftyp'), 4)
  output.set(ascii(majorBrand), 8)
  output.set(minorVersion, 12)
  for (let index = 0; index < compatibleBrands.length; index += 1) {
    output.set(ascii(compatibleBrands[index] ?? ''), 16 + index * 4)
  }
  return output
}

describe('configured image library', () => {
  it('passes explicit JPEG XL intrinsic size and tone mapping through the public pipeline', async () => {
    const images = createImageLibrary([pngCodec, jpegxlCodec])
    const encoded = await (await images.open(pngFixture()))
      .jpegxl({
        intrinsicSize: { width: 12, height: 9 },
        toneMapping: {
          intensityTarget: 1000,
          minNits: 0.5,
          relativeToMaxDisplay: false,
          linearBelow: 0,
        },
      })
      .toBuffer()
    expect(await (await images.open(encoded)).metadata()).toMatchObject({
      width: 4,
      height: 3,
      intrinsicWidth: 12,
      intrinsicHeight: 9,
    })
  })
  it('decodes and encodes only through explicitly registered codecs', async () => {
    const images = createImageLibrary([pngCodec, jpegCodec])
    const output = await (await images.open(pngFixture())).jpeg().toBuffer()

    expect(images.formats()).toEqual(['png', 'jpeg'])
    expect(Buffer.isBuffer(output)).toBe(true)
    expect([...output.subarray(0, 2)]).toEqual([0xff, 0xd8])
  })

  it('applies only explicitly registered codec accelerators', () => {
    let registrations = 0
    const accelerator: ImageCodecAccelerator = {
      format: 'jpeg',
      id: 'test-jpeg-accelerator',
      kind: 'wasm',
      accelerate(reference) {
        registrations += 1
        return reference
      },
    }
    const reference = createImageLibrary([jpegCodec])
    const accelerated = createImageLibrary({ codecs: [jpegCodec], accelerators: [accelerator] })

    expect(reference.formats()).toEqual(['jpeg'])
    expect(accelerated.formats()).toEqual(['jpeg'])
    expect(registrations).toBe(1)
    expect(() => createImageLibrary({ codecs: [pngCodec], accelerators: [accelerator] })).toThrow(
      'Accelerator test-jpeg-accelerator requires a registered jpeg codec',
    )
  })

  it('rejects input whose decoder was not registered', async () => {
    const images = createImageLibrary([pngCodec])

    await expect(images.open(jpegFixture(32, 24))).rejects.toMatchObject({
      code: 'UNSUPPORTED_FORMAT',
      message: 'JPEG input was recognized, but its codec is not registered',
    })
  })

  it.each([
    [
      'SVG',
      ascii('<?xml version="1.0"?>\n<!-- exported -->\n<svg xmlns="http://www.w3.org/2000/svg">'),
    ],
    ['PDF', ascii('%PDF-1.7\n')],
  ] as const)('names recognized but unimplemented %s input', async (name, input) => {
    await expect(createImageLibrary(allCodecs).open(input)).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
      message: `${name} input was recognized, but decoding is not implemented`,
    })
  })

  it('registers JPEG XL decode and rejects codestream features outside its subset', async () => {
    const input = Uint8Array.of(0xff, 0x0a, 1, 2)
    const images = createImageLibrary(allCodecs)
    const image = await images.open(input)

    expect(images.formats()).toContain('jpegxl')
    expect(jpegxlCodec.detect(input)).toBe(true)
    await expect(image.metadata()).rejects.toMatchObject({ code: 'TRUNCATED_INPUT' })
    await expect(image.png().toBuffer()).rejects.toMatchObject({ code: 'TRUNCATED_INPUT' })
  })

  it('encodes pixel-lossless JPEG XL through the normal pipeline', async () => {
    const images = createImageLibrary(allCodecs)
    const output = await (await images.open(pngFixture())).jpegxl({ effort: 1 }).toBuffer()
    expect([...output.subarray(0, 12)]).toEqual([...ascii('\0\0\0\fJXL \r\n\u0087\n')])

    const decoded = await images.open(output)
    await expect(decoded.metadata()).resolves.toMatchObject({
      width: 4,
      height: 3,
      format: 'jpegxl',
      hasAlpha: true,
      bitDepth: 8,
      lossless: true,
    })
  })

  it('does not silently relabel linear JPEG XL pixels or discard rendering intent', async () => {
    const input = new Uint8Array(
      readFileSync('benchmark/fixtures/jpegxl/generated-lossless-v0.12.0/rgb8-linear.jxl'),
    )
    const images = createImageLibrary(allCodecs)
    const image = await images.open(input)
    const reencoded = await image.jpegxl().toBuffer()
    const reopened = await images.open(reencoded)
    expect((await reopened.metadata()).colorSemantics).toEqual(
      (await image.metadata()).colorSemantics,
    )
    const decodedSamples: Uint8Array[] = []
    for (const bytes of [input, reencoded]) {
      const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(bytes), defaultImageLimits)
      if (!decoder) throw new Error('JPEG XL decoder is unavailable')
      const rows: Uint8Array[] = []
      for await (const block of decoder.decode()) {
        try {
          rows.push(block.data.slice())
        } finally {
          block.release?.()
        }
      }
      decodedSamples.push(Buffer.concat(rows))
    }
    expect(decodedSamples[1]).toEqual(decodedSamples[0])

    await expect(
      image.convertPixelFormat({ format: 'rgb16' }).png().toBuffer(),
    ).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
      message: expect.stringContaining('color semantics'),
    })
  })

  it.each([
    ['HTML with inline SVG', ascii('<!doctype html><html><body><svg></svg></body></html>')],
    ['JSON mentioning SVG', ascii('{"markup":"<svg viewBox=\\"0 0 1 1\\"></svg>"}')],
  ])('does not misidentify %s as an SVG document', async (_name, input) => {
    await expect(createImageLibrary(allCodecs).open(input)).rejects.toMatchObject({
      code: 'UNSUPPORTED_FORMAT',
      message: 'Input format is not recognized',
    })
  })

  it('distinguishes malformed recognizable input from an unknown format', async () => {
    const jpeg = jpegFixture(8, 8)
    const prefixed = new Uint8Array(jpeg.byteLength + 2)
    prefixed.set([0x12, 0x34])
    prefixed.set(jpeg, 2)
    const images = createImageLibrary(allCodecs)

    await expect(images.open(prefixed)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: 'JPEG SOI marker starts at byte 2; leading data is invalid',
    })
    await expect(images.open(Uint8Array.of(1, 2, 3, 4, 5))).rejects.toMatchObject({
      code: 'UNSUPPORTED_FORMAT',
      message: 'Input format is not recognized',
    })
  })

  it('rejects output whose encoder was not registered', async () => {
    const images = createImageLibrary([pngCodec])
    const image = await images.open(pngFixture())

    await expect(image.jpeg().toBuffer()).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
    })
  })

  it('provides one opt-in helper containing every default codec exactly once', () => {
    const formats = createImageLibrary(allCodecs).formats()

    expect(formats).toEqual([
      'jpeg',
      'jpegxl',
      'jp2',
      'png',
      'gif',
      'webp',
      'avif',
      'bmp',
      'hdr',
      'ico',
      'netpbm',
      'qoi',
      'tga',
      'tiff',
    ])
    expect(new Set(formats).size).toBe(formats.length)
  })

  it('does not activate recognizable HEIC input through the default codec set', async () => {
    const images = createImageLibrary(allCodecs)

    await expect(images.open(ftyp('heic', ['mif1']))).rejects.toMatchObject({
      code: 'UNSUPPORTED_FORMAT',
      message: 'HEIF/HEIC input was recognized, but its codec is not registered',
    })
  })

  it('uses a stable base probe independent of the registered codec minimums', async () => {
    const input = pngFixture()
    const reads: number[] = []
    const source: ImageSource = {
      size: input.byteLength,
      async read(offset, length) {
        reads.push(length)
        return input.subarray(offset, offset + length)
      },
    }

    await expect(new CodecRegistry([jpegCodec, pngCodec]).detect(source)).resolves.toBe(pngCodec)
    expect(reads).toEqual([32])
  })

  it('expands detection through the declared ftyp box for late AVIF and HEIC brands', async () => {
    const registry = new CodecRegistry([avifCodec, experimentalHeifCodec])
    const lateAvif = ftyp('mif1', ['iso8', 'miaf', 'MA1B', 'dash', 'avif'])
    const lateHeic = ftyp('sams', ['iso8', 'vend', 's001', 's002', 'heic'])

    await expect(registry.detect(new MemorySource(lateAvif))).resolves.toBe(avifCodec)
    await expect(registry.detect(new MemorySource(lateHeic))).resolves.toBe(experimentalHeifCodec)
  })

  it('does not treat the ftyp minor version or bytes beyond the declared box as brands', () => {
    const minorVersion = ftyp('zzzz', ['iso8'], ascii('avif'))
    const declared = ftyp('zzzz', ['iso8'])
    const trailing = new Uint8Array(declared.byteLength + 4)
    trailing.set(declared)
    trailing.set(ascii('avif'), declared.byteLength)

    expect(avifCodec.detect(minorVersion)).toBe(false)
    expect(avifCodec.detect(trailing)).toBe(false)
  })
})
