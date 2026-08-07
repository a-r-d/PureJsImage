import { describe, expect, it } from 'vitest'
import { PNG } from 'pngjs'

import { allCodecs } from '../src/codec-entries/all.ts'
import { avifCodec } from '../src/codec-entries/avif.ts'
import { heifCodec } from '../src/codec-entries/heif.ts'
import { jpegCodec } from '../src/codec-entries/jpeg.ts'
import { pngCodec } from '../src/codec-entries/png.ts'
import { CodecRegistry, createImageLibrary, MemorySource, type ImageSource } from '../src/index.ts'
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

  it('rejects input whose decoder was not registered', async () => {
    const images = createImageLibrary([pngCodec])

    await expect(images.open(jpegFixture(32, 24))).rejects.toMatchObject({
      code: 'UNSUPPORTED_FORMAT',
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

    expect(formats).toEqual(['jpeg', 'png', 'gif', 'webp', 'avif', 'heif', 'bmp', 'tiff'])
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
