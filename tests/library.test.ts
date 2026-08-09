import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'

import { allCodecs } from '../src/codec-entries/all.ts'
import { avifCodec } from '../src/codec-entries/avif.ts'
import { heifCodec } from '../src/codec-entries/heif.ts'
import { jpegCodec } from '../src/codec-entries/jpeg.ts'
import { pngCodec } from '../src/codec-entries/png.ts'
import {
  CodecRegistry,
  createImageLibrary,
  type ImageCodecAccelerator,
  type ImageSource,
  MemorySource,
} from '../src/index.ts'
import { jpegFixture } from './fixtures.ts'

const pngFixture = (): Uint8Array => PNG.sync.write(new PNG({ width: 4, height: 3 }))

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
  it('decodes and encodes only through explicitly registered codecs', async () => {
    const images = createImageLibrary([pngCodec, jpegCodec])
    const output = await (await images.open(pngFixture())).jpeg().toBuffer()

    expect(images.formats()).toEqual(['png', 'jpeg'])
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
    ['JPEG XL codestream', Uint8Array.of(0xff, 0x0a, 0, 0)],
    [
      'JPEG XL container',
      Uint8Array.of(0, 0, 0, 12, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a),
    ],
  ] as const)('names recognized but unimplemented %s input', async (name, input) => {
    await expect(createImageLibrary(allCodecs).open(input)).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
      message: `${name} input was recognized, but decoding is not implemented`,
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

  it('provides one opt-in helper containing every codec exactly once', () => {
    const formats = createImageLibrary(allCodecs).formats()

    expect(formats).toEqual([
      'jpeg',
      'jp2',
      'png',
      'gif',
      'webp',
      'avif',
      'heif',
      'bmp',
      'ico',
      'tiff',
    ])
    expect(new Set(formats).size).toBe(formats.length)
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
    const registry = new CodecRegistry([avifCodec, heifCodec])
    const lateAvif = ftyp('mif1', ['iso8', 'miaf', 'MA1B', 'dash', 'avif'])
    const lateHeic = ftyp('sams', ['iso8', 'vend', 's001', 's002', 'heic'])

    await expect(registry.detect(new MemorySource(lateAvif))).resolves.toBe(avifCodec)
    await expect(registry.detect(new MemorySource(lateHeic))).resolves.toBe(heifCodec)
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
