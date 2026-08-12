import jpeg from 'jpeg-js'
import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'

import { avifCodec } from '../src/codecs/avif.ts'
import { jpegCodec } from '../src/codecs/jpeg.ts'
import { pngCodec } from '../src/codecs/png.ts'
import { tiffCodec } from '../src/codecs/tiff.ts'
import { webpCodec } from '../src/codecs/webp.ts'
import { defaultImageLimits } from '../src/limits.ts'
import { MemorySource } from '../src/source.ts'
import { channelSwappingRgbProfile } from './icc-fixtures.ts'
import { Image } from './image-library.ts'

const addSegment = (input: Uint8Array, marker: number, payload: Uint8Array): Uint8Array => {
  const segment = new Uint8Array(payload.byteLength + 4)
  segment.set([0xff, marker, (payload.byteLength + 2) >>> 8, (payload.byteLength + 2) & 0xff])
  segment.set(payload, 4)
  const output = new Uint8Array(input.byteLength + segment.byteLength)
  output.set(input.subarray(0, 2))
  output.set(segment, 2)
  output.set(input.subarray(2), segment.byteLength + 2)
  return output
}

const taggedJpeg = (): {
  readonly data: Uint8Array
  readonly exif: Uint8Array
  readonly icc: Uint8Array
} => {
  const pixels = Uint8Array.of(
    200,
    30,
    10,
    255,
    180,
    40,
    20,
    255,
    160,
    50,
    30,
    255,
    20,
    80,
    190,
    255,
    30,
    90,
    170,
    255,
    40,
    100,
    150,
    255,
  )
  const encoded = jpeg.encode({ width: 3, height: 2, data: pixels }, 100).data
  const exif = Uint8Array.of(
    0x49,
    0x49,
    0x2a,
    0,
    8,
    0,
    0,
    0,
    1,
    0,
    0x12,
    0x01,
    3,
    0,
    1,
    0,
    0,
    0,
    6,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
  )
  const exifPayload = new Uint8Array(exif.byteLength + 6)
  exifPayload.set(Uint8Array.of(0x45, 0x78, 0x69, 0x66, 0, 0))
  exifPayload.set(exif, 6)
  const icc = channelSwappingRgbProfile()
  const iccPayload = new Uint8Array(14 + icc.byteLength)
  iccPayload.set(Uint8Array.from('ICC_PROFILE\0', (value) => value.charCodeAt(0)))
  iccPayload.set([1, 1], 12)
  iccPayload.set(icc, 14)
  return { data: addSegment(addSegment(encoded, 0xe1, exifPayload), 0xe2, iccPayload), exif, icc }
}

const orientation = (exif: Uint8Array | undefined): number | undefined => exif?.[18]

describe('metadata preservation', () => {
  it('strips EXIF and ICC by default and preserves each only when requested', async () => {
    const input = taggedJpeg()
    const stripped = await (await Image.open(input.data)).jpeg({ quality: 100 }).toBuffer()
    const strippedMetadata = await jpegCodec.preservedMetadata?.(
      new MemorySource(stripped),
      defaultImageLimits,
    )
    expect(strippedMetadata).toEqual({})

    const kept = await (await Image.open(input.data))
      .keepExif()
      .keepIcc()
      .jpeg({ quality: 100, chromaSubsampling: '444', progressive: true })
      .toBuffer()
    const keptMetadata = await jpegCodec.preservedMetadata?.(
      new MemorySource(kept),
      defaultImageLimits,
    )
    expect(keptMetadata?.exif).toEqual(input.exif)
    expect(keptMetadata?.icc).toEqual(input.icc)
    expect(kept.some((value, index) => value === 0xff && kept[index + 1] === 0xc2)).toBe(true)
  })

  it('keeps ICC-tagged samples unconverted until the preserved profile is decoded again', async () => {
    const input = taggedJpeg()
    const directlyManaged = PNG.sync.read(await (await Image.open(input.data)).png().toBuffer())
    const preserved = await (await Image.open(input.data)).keepIcc().png().toBuffer()
    const preservedMetadata = await pngCodec.preservedMetadata?.(
      new MemorySource(preserved),
      defaultImageLimits,
    )
    expect(preservedMetadata?.icc).toEqual(input.icc)

    const managedAfterReopen = PNG.sync.read(await (await Image.open(preserved)).png().toBuffer())
    expect(managedAfterReopen.data).toEqual(directlyManaged.data)
  })

  it('strips AVIF metadata by default and preserves EXIF and compatible RGB ICC on request', async () => {
    const input = taggedJpeg()
    const stripped = await (await Image.open(input.data)).avif().toBuffer()
    const strippedMetadata = await avifCodec.preservedMetadata?.(
      new MemorySource(stripped),
      defaultImageLimits,
    )
    expect(strippedMetadata).toEqual({})

    const output = await (await Image.open(input.data)).keepExif().keepIcc().avif().toBuffer()
    const preservedMetadata = await avifCodec.preservedMetadata?.(
      new MemorySource(output),
      defaultImageLimits,
    )
    expect(preservedMetadata?.exif).toEqual(input.exif)
    expect(preservedMetadata?.icc).toEqual(input.icc)
    await expect((await Image.open(output)).metadata()).resolves.toMatchObject({
      format: 'avif',
      colorProfile: { kind: 'icc' },
    })
    await expect((await Image.open(output)).png().toBuffer()).resolves.not.toHaveLength(0)
  })

  it('normalizes retained EXIF orientation after a pixel reorientation', async () => {
    const input = taggedJpeg()
    const retained = await (await Image.open(input.data)).keepExif().png().toBuffer()
    const retainedMetadata = await pngCodec.preservedMetadata?.(
      new MemorySource(retained),
      defaultImageLimits,
    )
    expect(orientation(retainedMetadata?.exif)).toBe(6)

    const oriented = await (await Image.open(input.data)).keepExif().autoOrient().png().toBuffer()
    const orientedMetadata = await pngCodec.preservedMetadata?.(
      new MemorySource(oriented),
      defaultImageLimits,
    )
    expect(orientation(orientedMetadata?.exif)).toBe(1)
  })

  it.each([true, false])('preserves EXIF and ICC in lossless=%s WebP', async (lossless) => {
    const input = taggedJpeg()
    const output = await (await Image.open(input.data))
      .keepExif()
      .keepIcc()
      .webp(lossless ? { lossless: true } : { quality: 90 })
      .toBuffer()
    const metadata = await webpCodec.preservedMetadata?.(
      new MemorySource(output),
      defaultImageLimits,
    )
    expect(metadata?.exif).toEqual(input.exif)
    expect(metadata?.icc).toEqual(input.icc)
    await expect((await Image.open(output)).metadata()).resolves.toMatchObject({
      format: 'webp',
      width: 3,
      height: 2,
    })
  })

  it('preserves compatible ICC in TIFF and rejects unsupported TIFF EXIF output', async () => {
    const input = taggedJpeg()
    const output = await (await Image.open(input.data)).keepIcc().tiff().toBuffer()
    const metadata = await tiffCodec.preservedMetadata?.(
      new MemorySource(output),
      defaultImageLimits,
    )
    expect(metadata?.icc).toEqual(input.icc)

    await expect((await Image.open(output)).keepExif().png().toBuffer()).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
      message: 'Preserving EXIF from TIFF input is not implemented',
    })

    await expect((await Image.open(input.data)).keepExif().tiff().toBuffer()).rejects.toMatchObject(
      {
        code: 'UNSUPPORTED_OPERATION',
        message: 'Preserving EXIF into TIFF output is not implemented',
      },
    )
  })
})
