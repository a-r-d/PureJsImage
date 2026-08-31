import jpeg from 'jpeg-js'
import { describe, expect, it } from 'vitest'
import { jpegCodec } from '../src/codecs/jpeg.ts'
import { inspectIccProfile, parseRgbIccTransform } from '../src/codecs/icc.ts'
import {
  assembleGainMapJpeg,
  inspectHdrJpeg,
  inspectGainMapImage,
  normalizeGainMapMetadata,
  openGainMapImage,
  type GainMapJpegMetadataMode,
  writeGainMapJpeg,
} from '../src/hdr/index.ts'
import { defaultImageLimits } from '../src/limits.ts'
import { MemorySource } from '../src/source.ts'
import {
  createPureJsImageSrgbIcc,
  PUREJSIMAGE_SRGB_ICC_PROFILE_ID,
  PUREJSIMAGE_SRGB_ICC_SHA256,
} from '../src/hdr/srgb-icc.ts'
import { createHash } from 'node:crypto'
import { channelSwappingRgbProfile } from './icc-fixtures.ts'

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
const gain = encoded(4, 2, (x, y) => [32 + x * 30, 96 + y * 40, 200 - x * 20, 255])
const addSegment = (input: Uint8Array, marker: number, payload: Uint8Array): Uint8Array => {
  const output = new Uint8Array(input.byteLength + payload.byteLength + 4)
  output.set(input.subarray(0, 2))
  output.set([0xff, marker, (payload.byteLength + 2) >>> 8, (payload.byteLength + 2) & 0xff], 2)
  output.set(payload, 6)
  output.set(input.subarray(2), payload.byteLength + 6)
  return output
}

const taggedGain = (): Uint8Array => {
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
  const iccPayload = new Uint8Array(icc.byteLength + 14)
  iccPayload.set(Uint8Array.from('ICC_PROFILE\0', (value) => value.charCodeAt(0)))
  iccPayload.set([1, 1], 12)
  iccPayload.set(icc, 14)
  return addSegment(addSegment(gain, 0xe1, exifPayload), 0xe2, iccPayload)
}
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

const hdrBaseIsoJpeg = async (): Promise<Uint8Array> => {
  const output = Uint8Array.from(
    await assembleGainMapJpeg(
      { baseJpeg: base, gainMapJpeg: gain, metadata },
      { metadataMode: 'iso' },
    ),
  )
  const marker = new TextEncoder().encode('urn:iso:std:iso:ts:21496:-1\0')
  let bodyOffset = -1
  for (let offset = 0; offset <= output.byteLength - marker.byteLength; offset += 1) {
    if (marker.every((value, index) => output[offset + index] === value)) {
      bodyOffset = offset + marker.byteLength
    }
  }
  if (bodyOffset < 0 || bodyOffset + 17 > output.byteLength) {
    throw new Error('ISO gain-map payload was not found')
  }
  const view = new DataView(output.buffer, output.byteOffset)
  output[bodyOffset + 4] = (output[bodyOffset + 4] ?? 0) | 0x04
  const baseHeadroom = view.getUint32(bodyOffset + 9, false)
  const alternateHeadroom = view.getUint32(bodyOffset + 13, false)
  view.setUint32(bodyOffset + 9, alternateHeadroom, false)
  view.setUint32(bodyOffset + 13, baseHeadroom, false)
  return output
}

describe('HDR JPEG assembly', () => {
  it('builds an aligned ICC v4.3 display profile with a valid profile ID', () => {
    const profile = createPureJsImageSrgbIcc()
    const view = new DataView(profile.buffer, profile.byteOffset, profile.byteLength)
    const signature = (offset: number): string =>
      String.fromCharCode(...profile.subarray(offset, offset + 4))
    expect(profile.byteLength % 4).toBe(0)
    expect(view.getUint32(0, false)).toBe(profile.byteLength)
    expect(view.getUint32(8, false)).toBe(0x0430_0000)
    expect(signature(12)).toBe('mntr')
    expect(signature(16)).toBe('RGB ')
    expect(signature(20)).toBe('XYZ ')
    expect(signature(36)).toBe('acsp')
    expect(profile.subarray(4, 8)).toEqual(new Uint8Array(4))
    expect(profile.subarray(40, 44)).toEqual(new Uint8Array(4))
    expect(profile.subarray(48, 64)).toEqual(new Uint8Array(16))
    expect(profile.subarray(80, 84)).toEqual(new Uint8Array(4))
    expect(profile.subarray(100, 128)).toEqual(new Uint8Array(28))

    const expectedTypes = new Map([
      ['desc', 'mluc'],
      ['cprt', 'mluc'],
      ['wtpt', 'XYZ '],
      ['chad', 'sf32'],
      ['rXYZ', 'XYZ '],
      ['gXYZ', 'XYZ '],
      ['bXYZ', 'XYZ '],
      ['rTRC', 'para'],
      ['gTRC', 'para'],
      ['bTRC', 'para'],
    ])
    expect(view.getUint32(128, false)).toBe(expectedTypes.size)
    const found = new Set<string>()
    for (let index = 0; index < expectedTypes.size; index += 1) {
      const entry = 132 + index * 12
      const tag = signature(entry)
      const offset = view.getUint32(entry + 4, false)
      const length = view.getUint32(entry + 8, false)
      found.add(tag)
      expect(offset % 4, `${tag} offset`).toBe(0)
      expect(length % 4, `${tag} length`).toBe(0)
      expect(offset + length).toBeLessThanOrEqual(profile.byteLength)
      expect(signature(offset)).toBe(expectedTypes.get(tag))
      expect(profile.subarray(offset + 4, offset + 8)).toEqual(new Uint8Array(4))
    }
    expect(found).toEqual(new Set(expectedTypes.keys()))

    const profileId = Buffer.from(profile.subarray(84, 100)).toString('hex')
    expect(profileId).toBe(PUREJSIMAGE_SRGB_ICC_PROFILE_ID)
    const idInput = profile.slice()
    idInput.fill(0, 44, 48)
    idInput.fill(0, 64, 68)
    idInput.fill(0, 84, 100)
    expect(createHash('md5').update(idInput).digest('hex')).toBe(profileId)
    expect(createHash('sha256').update(profile).digest('hex')).toBe(PUREJSIMAGE_SRGB_ICC_SHA256)
  })

  const markerOrder = (input: Uint8Array): readonly string[] => {
    const result: string[] = []
    let offset = 2
    while (offset + 4 <= input.byteLength) {
      const marker = input[offset + 1]
      if (input[offset] !== 0xff || marker === undefined || marker === 0xda || marker === 0xd9)
        break
      const length = (input[offset + 2] ?? 0) * 256 + (input[offset + 3] ?? 0)
      const payload = input.subarray(offset + 4, offset + 4 + Math.max(0, length - 2))
      const prefix = new TextDecoder('ascii').decode(payload.subarray(0, 32))
      result.push(
        marker === 0xe0 && prefix.startsWith('JFIF')
          ? 'JFIF'
          : marker === 0xe0 && prefix.startsWith('JFXX')
            ? 'JFXX'
            : marker === 0xe1 && prefix.startsWith('Exif')
              ? 'EXIF'
              : marker === 0xe2 && prefix.startsWith('ICC_PROFILE')
                ? 'ICC'
                : marker === 0xe1 || marker === 0xe2
                  ? 'HDR'
                  : `0x${marker.toString(16)}`,
      )
      offset += length + 2
    }
    return result
  }

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
      expect(inspection.metadataRanges).toHaveLength(mode === 'dual' ? 5 : mode === 'iso' ? 4 : 3)
      expect(inspection.metadataRanges).toEqual(
        [...inspection.metadataRanges].sort((left, right) => left.start - right.start),
      )
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

  it('keeps JFIF first and inserts HDR metadata after the child metadata preamble', async () => {
    const output = await assembleGainMapJpeg({ baseJpeg: base, gainMapJpeg: gain, metadata })
    const inspection = await inspectHdrJpeg(new MemorySource(output))
    const primary = output.subarray(inspection.primary.start, inspection.primary.end)
    const mapRange = inspection.gainMap
    if (!mapRange) throw new Error('Gain-map range is missing')
    const map = output.subarray(mapRange.start, mapRange.end)
    for (const child of [primary, map]) {
      const order = markerOrder(child)
      expect(order[0]).toBe('JFIF')
      expect(order.indexOf('HDR')).toBeGreaterThan(order.indexOf('JFIF'))
    }
  })

  it.each(['dual', 'iso', 'ultra-hdr'] as const)(
    'embeds the validated first-party sRGB profile only in a re-encoded %s primary',
    async (metadataMode) => {
      const opened = await openGainMapImage(
        await assembleGainMapJpeg({ baseJpeg: base, gainMapJpeg: gain, metadata }),
      )
      const output = await opened
        .resize({ width: 10, height: 5, kernel: 'bilinear' })
        .jpeg({ metadataMode })
      opened.close()
      const reopened = await openGainMapImage(output)
      const primary = await reopened.extractOriginalBase()
      const gainMap = await reopened.extractOriginalGainMap()
      reopened.close()
      if (!jpegCodec.preservedMetadata) throw new Error('JPEG metadata reader is unavailable')
      const primaryMetadata = await jpegCodec.preservedMetadata(
        new MemorySource(primary),
        defaultImageLimits,
        { exif: true, icc: true },
      )
      const gainMetadata = await jpegCodec.preservedMetadata(
        new MemorySource(gainMap),
        defaultImageLimits,
        { exif: true, icc: true },
      )
      expect(primaryMetadata.icc).toEqual(createPureJsImageSrgbIcc())
      expect(gainMetadata.icc).toBeUndefined()
      expect(gainMetadata.exif).toBeUndefined()
      expect(inspectIccProfile(primaryMetadata.icc ?? new Uint8Array())).toMatchObject({
        description: 'PureJsImage sRGB',
      })
      expect(() => parseRgbIccTransform(primaryMetadata.icc ?? new Uint8Array())).not.toThrow()
      expect(
        createHash('sha256')
          .update(primaryMetadata.icc ?? new Uint8Array())
          .digest('hex'),
      ).toBe(PUREJSIMAGE_SRGB_ICC_SHA256)
    },
  )

  it('ignores gain-map ICC conversion and EXIF orientation while retaining ordinary JPEG behavior', async () => {
    const profiledGain = taggedGain()
    expect(await decode(profiledGain)).not.toEqual(await decode(gain))
    const [plainCompound, profiledCompound] = await Promise.all([
      assembleGainMapJpeg({ baseJpeg: base, gainMapJpeg: gain, metadata }),
      assembleGainMapJpeg({ baseJpeg: base, gainMapJpeg: profiledGain, metadata }),
    ])
    const render = async (input: Uint8Array): Promise<Float32Array> => {
      const opened = await openGainMapImage(input)
      const values: number[] = []
      try {
        for await (const block of opened.render({ displayBoost: 4 })) values.push(...block.data)
      } finally {
        opened.close()
      }
      return Float32Array.from(values)
    }
    expect(await render(profiledCompound)).toEqual(await render(plainCompound))

    const opened = await openGainMapImage(profiledCompound)
    const reencoded = await opened.resize({ width: 10, height: 5 }).jpeg()
    opened.close()
    const reopened = await openGainMapImage(reencoded)
    const reencodedGain = await reopened.extractOriginalGainMap()
    reopened.close()
    const preserved = await jpegCodec.preservedMetadata?.(
      new MemorySource(reencodedGain),
      defaultImageLimits,
      { exif: true, icc: true },
    )
    expect(preserved).toEqual({})
  })

  it('retains an original primary ICC byte-for-byte during bit-preserving repack', async () => {
    const icc = channelSwappingRgbProfile()
    const payload = new Uint8Array(icc.byteLength + 14)
    payload.set(Uint8Array.from('ICC_PROFILE\0', (value) => value.charCodeAt(0)))
    payload.set([1, 1], 12)
    payload.set(icc, 14)
    const taggedBase = addSegment(base, 0xe2, payload)
    const original = await assembleGainMapJpeg({
      baseJpeg: taggedBase,
      gainMapJpeg: gain,
      metadata,
    })
    const opened = await openGainMapImage(original)
    const originalBase = await opened.extractOriginalBase()
    const originalGain = await opened.extractOriginalGainMap()
    const repacked = await assembleGainMapJpeg({
      baseJpeg: originalBase,
      gainMapJpeg: originalGain,
      metadata: opened.inspection().metadata,
    })
    opened.close()
    const reopened = await openGainMapImage(repacked)
    expect(await reopened.extractOriginalBase()).toEqual(originalBase)
    const preserved = await jpegCodec.preservedMetadata?.(
      new MemorySource(await reopened.extractOriginalBase()),
      defaultImageLimits,
      { exif: true, icc: true },
    )
    reopened.close()
    expect(preserved?.icc).toEqual(icc)
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

  it('reports a structurally valid HDR-base JPEG relationship as unsupported', async () => {
    const output = await hdrBaseIsoJpeg()
    expect(await inspectHdrJpeg(new MemorySource(output))).toMatchObject({
      iso: { baseRendition: 'hdr' },
    })
    expect(await inspectGainMapImage(output)).toMatchObject({
      container: 'jpeg',
      status: 'unsupported',
      error: { code: 'UNSUPPORTED_OPERATION' },
    })
    await expect(openGainMapImage(output)).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' })
  })

  it.each(['dual', 'iso', 'ultra-hdr'] as const)(
    'rejects HDR-base %s JPEG assembly before writing output',
    async (metadataMode) => {
      const hdrMetadata = normalizeGainMapMetadata({ ...metadata, baseRendition: 'hdr' })
      await expect(
        assembleGainMapJpeg(
          { baseJpeg: base, gainMapJpeg: gain, metadata: hdrMetadata },
          { metadataMode },
        ),
      ).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' })
      let writes = 0
      let aborts = 0
      await expect(
        writeGainMapJpeg(
          { baseJpeg: base, gainMapJpeg: gain, metadata: hdrMetadata },
          {
            async write(): Promise<void> {
              writes += 1
            },
            async close(): Promise<void> {
              throw new Error('HDR-base JPEG sink must not close')
            },
            async abort(): Promise<void> {
              aborts += 1
            },
          },
          { metadataMode },
        ),
      ).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' })
      expect(writes).toBe(0)
      expect(aborts).toBe(1)
    },
  )
})
