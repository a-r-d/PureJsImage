import jpeg from 'jpeg-js'
import { describe, expect, it } from 'vitest'
import { jpegCodec } from '../src/codecs/jpeg.ts'
import {
  assembleGainMapJpeg,
  inspectHdrJpeg,
  inspectGainMapImage,
  normalizeGainMapMetadata,
  openGainMapImage,
  type GainMapJpegMetadataMode,
} from '../src/hdr/index.ts'
import { defaultImageLimits } from '../src/limits.ts'
import { MemorySource } from '../src/source.ts'

const color = Object.freeze({
  family: 'rgb' as const,
  primaries: 'srgb' as const,
  transfer: Object.freeze({ kind: 'srgb' as const }),
  matrix: 'identity' as const,
  range: 'full' as const,
  alpha: 'none' as const,
  provenance: 'container-signaled' as const,
})

const encoded = (
  width: number,
  height: number,
  pixel: (x: number, y: number) => readonly [number, number, number, number],
): Uint8Array => {
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) data.set(pixel(x, y), (y * width + x) * 4)
  }
  return jpeg.encode({ width, height, data }, 96).data
}

const decode = async (input: Uint8Array): Promise<Uint8Array> => {
  if (!jpegCodec.createDecoder) throw new Error('JPEG decoder is unavailable')
  const decoder = await jpegCodec.createDecoder(new MemorySource(input), defaultImageLimits)
  const output = new Uint8Array(decoder.width * decoder.height * 3)
  for await (const block of decoder.decode()) {
    for (let row = 0; row < block.height; row += 1) {
      output.set(
        block.data.subarray(row * block.stride, row * block.stride + block.width * 3),
        (block.y + row) * decoder.width * 3,
      )
    }
    block.release?.()
  }
  return output
}

const base = encoded(12, 6, (x, y) => [32 + x * 12, 48 + y * 20, 80, 255])
const gain = encoded(4, 2, () => [255, 255, 255, 255])
const metadata = normalizeGainMapMetadata({
  baseRendition: 'sdr',
  channelCount: 3,
  baseDimensions: { width: 12, height: 6 },
  gainMapDimensions: { width: 4, height: 2 },
  minimum: 0,
  maximum: 2,
  gamma: 1,
  offsetSdr: 0,
  offsetHdr: 0,
  capacityMinimum: 0,
  capacityMaximum: 2,
  useBaseColorSpace: true,
  baseColor: color,
  alternateColor: { ...color, transfer: { kind: 'linear' } },
  gainMapColor: { ...color, transfer: { kind: 'linear' } },
  container: 'jpeg',
  representations: ['ultra-hdr-xmp'],
  selectedRepresentation: 'ultra-hdr-xmp',
  metadataRanges: [],
  orientation: 1,
  warnings: [],
})

describe('HDR JPEG assembly', () => {
  it.each([
    ['dual', ['iso-21496-1', 'ultra-hdr-xmp']],
    ['iso', ['iso-21496-1']],
    ['ultra-hdr', ['ultra-hdr-xmp']],
  ] as const)(
    'writes deterministic %s metadata with exact validated child ranges',
    async (mode, expected) => {
      const options = { metadataMode: mode as GainMapJpegMetadataMode }
      const first = await assembleGainMapJpeg(
        { baseJpeg: base, gainMapJpeg: gain, metadata },
        options,
      )
      const second = await assembleGainMapJpeg(
        { baseJpeg: base, gainMapJpeg: gain, metadata },
        options,
      )
      expect(second).toEqual(first)
      const inspection = await inspectHdrJpeg(new MemorySource(first))
      expect(inspection.representations).toEqual(expected)
      expect(inspection.primary.end).toBe(inspection.gainMap?.start)
      expect(inspection.gainMap?.end).toBe(first.length)
      expect(await decode(first)).toEqual(await decode(base))
      const opened = await openGainMapImage(first)
      const rendered = opened.render({ displayBoost: 4 })[Symbol.asyncIterator]()
      expect((await rendered.next()).value?.data[0]).toBeGreaterThan(0)
      await rendered.return?.()
      opened.close()
    },
  )

  it('rebuilds an existing compound file without decoding child pixels', async () => {
    const original = await assembleGainMapJpeg({ baseJpeg: base, gainMapJpeg: gain, metadata })
    const opened = await openGainMapImage(original)
    const rebuilt = await assembleGainMapJpeg({
      baseJpeg: await opened.extractBase(),
      gainMapJpeg: await opened.extractGainMap(),
      metadata: opened.inspection().metadata,
    })
    opened.close()
    expect(rebuilt).toEqual(original)
  })

  it('rejects output limits and dimension mismatches before returning bytes', async () => {
    await expect(
      assembleGainMapJpeg({ baseJpeg: base, gainMapJpeg: gain, metadata }, { maxOutputBytes: 10 }),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
    const wrong = normalizeGainMapMetadata({
      ...metadata,
      baseDimensions: { width: 10, height: 5 },
      gainMapDimensions: { width: 4, height: 2 },
    })
    await expect(
      assembleGainMapJpeg({ baseJpeg: base, gainMapJpeg: gain, metadata: wrong }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('reports valid, absent, and malformed HDR relationships without entropy decoding', async () => {
    expect(await inspectGainMapImage(base)).toEqual({ container: 'jpeg', status: 'not-present' })
    const output = await assembleGainMapJpeg({ baseJpeg: base, gainMapJpeg: gain, metadata })
    expect(await inspectGainMapImage(output)).toMatchObject({
      container: 'jpeg',
      status: 'valid',
      selectedRepresentation: 'iso-21496-1',
      baseDimensions: { width: 12, height: 6 },
      gainMapDimensions: { width: 4, height: 2 },
    })
    const malformed = Uint8Array.from(output)
    const text = new TextDecoder().decode(malformed)
    const maximum = text.indexOf('h:GainMapMax="2"')
    expect(maximum).toBeGreaterThan(0)
    malformed[maximum + 'h:GainMapMax="'.length] = '9'.charCodeAt(0)
    expect(await inspectGainMapImage(malformed)).toMatchObject({
      container: 'jpeg',
      status: 'invalid',
      error: { code: 'INVALID_INPUT' },
    })
  })
})
