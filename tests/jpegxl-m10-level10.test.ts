import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { jpegxlCodec } from '../src/codecs/jpegxl.ts'
import {
  convertJpegXlCmykLayerToRgba8,
  convertJpegXlFloat32LayerToRgba16,
  encodeJpegXlNative,
  inspectJpegXl,
  type JpegXlNativeLayer,
  jpegXlNativeFloat32ColorPlanes,
  jpegXlNativeUnsignedPlanes,
  openJpegXlSequence,
} from '../src/jpegxl.ts'
import { defaultImageLimits } from '../src/limits.ts'
import { MemorySource } from '../src/source.ts'

const base = new URL('./fixtures/jpegxl/m10-level10/', import.meta.url)

const firstLayer = async (bytes: Uint8Array): Promise<JpegXlNativeLayer> => {
  const sequence = await openJpegXlSequence(bytes)
  try {
    for await (const layer of sequence.layers()) return layer
  } finally {
    await sequence.close()
  }
  throw new Error('Missing JPEG XL native layer')
}

const nativeDigest = (planes: readonly Uint32Array[]): string => {
  const digest = createHash('sha256')
  const sample = new Uint8Array(4)
  const view = new DataView(sample.buffer)
  for (const plane of planes)
    for (const value of plane) {
      view.setUint32(0, value, false)
      digest.update(sample)
    }
  return digest.digest('hex')
}

describe('JPEG XL M10 Level 10 native workflows', () => {
  it('decodes the official lossless binary32 fixture bit exactly', async () => {
    const bytes = new Uint8Array(await readFile(new URL('lossless-pfm.jxl', base)))
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      '61ae52b5851ab2e156aec1d22502e8e1ec0cdf6bc0d6a3956ac6d7d6d2969d5e',
    )
    const layer = await firstLayer(bytes)
    expect(layer.header).toMatchObject({
      bitDepth: 32,
      exponentBits: 8,
      sampleFormat: 'floating-point',
    })
    const unsigned = jpegXlNativeUnsignedPlanes(layer)
    expect(unsigned.map((plane) => plane.length)).toEqual([250_000, 250_000, 250_000])
    expect(nativeDigest(unsigned)).toBe(
      'b79a3696b462f6dfad2685f9201cb27abb375af3ca4efcdf145a35d361de3093',
    )
    const numeric = jpegXlNativeFloat32ColorPlanes(layer)
    expect(numeric[0]?.[0]).toBeCloseTo(0.8416790962)
    expect(numeric[1]?.[0]).toBeCloseTo(1.4113879204)
    expect(numeric[2]?.[0]).toBeCloseTo(1.992000103)
    const display = convertJpegXlFloat32LayerToRgba16(layer, { black: -2, white: 2 })
    expect(display).toMatchObject({ width: 500, height: 500, format: 'rgba16' })
  })

  it('preserves binary32 and 31-bit integer samples through Level 10 container output', async () => {
    const bits = Uint32Array.of(0, 0x8000_0000, 1, 0x3f80_0000, 0xbf80_0000, 0x7f7f_ffff)
    const encoded = await encodeJpegXlNative({
      width: bits.length,
      height: 1,
      color: [{ data: bits, bitDepth: 32, sampleFormat: 'binary32' }],
    })
    await expect(inspectJpegXl(encoded)).resolves.toMatchObject({
      kind: 'container',
      organization: 'jxlc',
      level: 10,
      bitDepth: 32,
      exponentBits: 8,
    })
    const layer = await firstLayer(encoded)
    expect(Array.from(jpegXlNativeUnsignedPlanes(layer)[0] ?? [])).toEqual(Array.from(bits))
    const floats = jpegXlNativeFloat32ColorPlanes(layer)[0]
    expect(Object.is(floats?.[0], 0)).toBe(true)
    expect(Object.is(floats?.[1], -0)).toBe(true)
    expect(floats?.[2]).toBe(2 ** -149)
    expect(floats?.[4]).toBe(-1)

    const integers = Uint32Array.of(0, 1, 0x4000_0000, 0x7fff_ffff)
    const integerEncoded = await encodeJpegXlNative({
      width: integers.length,
      height: 1,
      color: [{ data: integers, bitDepth: 31 }],
    })
    const integerLayer = await firstLayer(integerEncoded)
    expect(Array.from(jpegXlNativeUnsignedPlanes(integerLayer)[0] ?? [])).toEqual(
      Array.from(integers),
    )
    await expect(
      jpegxlCodec.createDecoder?.(new MemorySource(integerEncoded), defaultImageLimits),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' })
  })

  it('preserves integer and floating alpha during display conversion', async () => {
    const colors = new Float32Array([0.25, 0.5, 0.75])
    const floatLayer = await firstLayer(
      await encodeJpegXlNative({
        width: 3,
        height: 1,
        color: [{ data: new Uint32Array(colors.buffer), bitDepth: 32, sampleFormat: 'binary32' }],
        extraChannels: [{ type: 0, data: Uint8Array.of(0, 128, 255), bitDepth: 8 }],
      }),
    )
    const floatDisplay = convertJpegXlFloat32LayerToRgba16(floatLayer, { black: 0, white: 1 })
    expect([floatDisplay.data[3], floatDisplay.data[7], floatDisplay.data[11]]).toEqual([
      0, 32_896, 65_535,
    ])

    const associatedLayer = await firstLayer(
      await encodeJpegXlNative({
        width: 1,
        height: 1,
        color: [
          {
            data: new Uint32Array(Float32Array.of(0.25).buffer),
            bitDepth: 32,
            sampleFormat: 'binary32',
          },
        ],
        extraChannels: [{ type: 0, data: Uint8Array.of(128), bitDepth: 8, associatedAlpha: true }],
      }),
    )
    const associatedDisplay = convertJpegXlFloat32LayerToRgba16(associatedLayer, {
      black: 0.1,
      white: 0.6,
    })
    expect(associatedDisplay.colorSemantics.alpha).toBe('straight')
    expect(associatedDisplay.sourceColorSemantics.alpha).toBe('premultiplied')
    expect(associatedDisplay.data[0]).toBeGreaterThan(50_000)

    const fixture = await firstLayer(
      new Uint8Array(await readFile(new URL('cmyk-layers.jxl', base))),
    )
    const profile = fixture.header.iccProfile
    if (!profile) throw new Error('Missing CMYK fixture profile')
    const alpha = new Float32Array([0, 0.5, 1])
    const cmykLayer = await firstLayer(
      await encodeJpegXlNative({
        width: 3,
        height: 1,
        color: [
          { data: Uint8Array.of(255, 255, 255), bitDepth: 8 },
          { data: Uint8Array.of(255, 255, 255), bitDepth: 8 },
          { data: Uint8Array.of(255, 255, 255), bitDepth: 8 },
        ],
        extraChannels: [
          { type: 4, data: Uint8Array.of(255, 255, 255), bitDepth: 8 },
          {
            type: 0,
            data: new Uint32Array(alpha.buffer),
            bitDepth: 32,
            sampleFormat: 'binary32',
          },
        ],
        iccProfile: profile,
      }),
    )
    const cmykDisplay = convertJpegXlCmykLayerToRgba8(cmykLayer)
    expect([cmykDisplay.data[3], cmykDisplay.data[7], cmykDisplay.data[11]]).toEqual([0, 128, 255])
  })

  it('preserves Level 10 native samples across multiple Modular groups', async () => {
    const width = 1_025
    const bits = new Uint32Array(width * 2)
    for (let index = 0; index < bits.length; index++)
      bits[index] = index % 5 === 0 ? 0x8000_0000 : (index * 2_654_435_761) >>> 0
    const encoded = await encodeJpegXlNative({
      width,
      height: 2,
      color: [{ data: bits, bitDepth: 32, sampleFormat: 'binary32' }],
    })
    await expect(inspectJpegXl(encoded)).resolves.toMatchObject({
      kind: 'container',
      level: 10,
      width,
      height: 2,
    })
    const layer = await firstLayer(encoded)
    expect(Array.from(jpegXlNativeUnsignedPlanes(layer)[0] ?? [])).toEqual(Array.from(bits))

    const integers = Uint16Array.from({ length: width }, (_, index) => index & 4095)
    const levelFive = await encodeJpegXlNative({
      width,
      height: 1,
      color: [{ data: integers, bitDepth: 12 }],
    })
    await expect(inspectJpegXl(levelFive)).resolves.toMatchObject({ kind: 'raw-codestream' })
    const integerLayer = await firstLayer(levelFive)
    expect(Array.from(jpegXlNativeUnsignedPlanes(integerLayer)[0] ?? [])).toEqual(
      Array.from(integers),
    )
    const shifted = Uint8Array.from({ length: Math.ceil(width / 2) }, (_, index) => index & 255)
    const shiftedEncoded = await encodeJpegXlNative({
      width,
      height: 1,
      color: [{ data: integers, bitDepth: 12 }],
      extraChannels: [{ type: 1, dimShift: 1, name: 'coverage', data: shifted, bitDepth: 8 }],
    })
    const shiftedLayer = await firstLayer(shiftedEncoded)
    expect(shiftedLayer.header.extraChannels[0]).toMatchObject({
      type: 1,
      dimShift: 1,
      name: 'coverage',
    })
    expect(Array.from(jpegXlNativeUnsignedPlanes(shiftedLayer)[1] ?? [])).toEqual(
      Array.from(shifted),
    )
    await expect(
      encodeJpegXlNative({
        width,
        height: 2,
        color: [{ data: bits, bitDepth: 32, sampleFormat: 'binary32' }],
        maxOutputBytes: 64,
      }),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
  })

  it('writes differently shifted native grids across both odd group boundaries', async () => {
    const width = 1_025
    const height = 1_027
    const pixels = width * height
    const gray = Uint8Array.from({ length: pixels }, (_, index) => index & 255)
    const grid = (shift: number): number =>
      Math.ceil(width / 2 ** shift) * Math.ceil(height / 2 ** shift)
    const alpha = Uint16Array.from({ length: grid(1) }, (_, index) => (index * 37) & 1023)
    const black = Uint8Array.from({ length: grid(2) }, (_, index) => (index * 19) & 255)
    const depth = Uint16Array.from({ length: grid(3) }, (_, index) =>
      index % 3 === 0 ? 0x8000 : index % 3 === 1 ? 0x0001 : 0x3c00,
    )
    const source = await firstLayer(
      new Uint8Array(await readFile(new URL('cmyk-layers.jxl', base))),
    )
    const profile = source.header.iccProfile
    if (!profile) throw new Error('Missing CMYK profile')
    const encoded = await encodeJpegXlNative({
      width,
      height,
      color: [
        { data: gray, bitDepth: 8 },
        { data: gray, bitDepth: 8 },
        { data: gray, bitDepth: 8 },
      ],
      iccProfile: profile,
      extraChannels: [
        {
          type: 0,
          name: 'coverage',
          data: alpha,
          bitDepth: 10,
          dimShift: 1,
          associatedAlpha: true,
        },
        { type: 4, name: 'black', data: black, bitDepth: 8, dimShift: 2 },
        {
          type: 1,
          name: 'depth',
          data: depth,
          bitDepth: 16,
          sampleFormat: 'binary16',
          dimShift: 3,
        },
      ],
    })
    await expect(inspectJpegXl(encoded)).resolves.toMatchObject({ level: 10, width, height })
    await expect(
      encodeJpegXlNative({
        width,
        height,
        color: [
          { data: gray, bitDepth: 8 },
          { data: gray, bitDepth: 8 },
          { data: gray, bitDepth: 8 },
        ],
        iccProfile: profile,
        extraChannels: [
          { type: 0, data: alpha, bitDepth: 10, dimShift: 1 },
          { type: 4, data: black, bitDepth: 8, dimShift: 2 },
          { type: 1, data: depth, bitDepth: 16, sampleFormat: 'binary16', dimShift: 3 },
        ],
        maxOutputBytes: 1024,
      }),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
    const layer = await firstLayer(encoded)
    expect(layer.header.extraChannels).toMatchObject([
      { name: 'coverage', dimShift: 1, associatedAlpha: true, bitDepth: { bits: 10 } },
      { name: 'black', dimShift: 2, bitDepth: { bits: 8 } },
      { name: 'depth', dimShift: 3, bitDepth: { bits: 16, sampleFormat: 'floating-point' } },
    ])
    const planes = jpegXlNativeUnsignedPlanes(layer)
    for (const [index, expected] of [gray, gray, gray, alpha, black, depth].entries()) {
      const actual = planes[index]
      expect(actual?.length).toBe(expected.length)
      for (let sample = 0; sample < expected.length; sample++)
        if (actual?.[sample] !== expected[sample])
          throw new Error(`Native plane ${index} differs at sample ${sample}`)
    }
  }, 15_000)

  it('selects the minimum level at the 12/13-bit boundary and rejects conflicts', async () => {
    const levelFive = await encodeJpegXlNative({
      width: 1,
      height: 1,
      color: [{ data: Uint16Array.of(4095), bitDepth: 12 }],
    })
    await expect(inspectJpegXl(levelFive)).resolves.toMatchObject({
      kind: 'raw-codestream',
      level: undefined,
    })
    const levelTen = await encodeJpegXlNative({
      width: 1,
      height: 1,
      color: [{ data: Uint16Array.of(8191), bitDepth: 13 }],
    })
    await expect(inspectJpegXl(levelTen)).resolves.toMatchObject({ kind: 'container', level: 10 })
    await expect(
      encodeJpegXlNative({
        width: 1,
        height: 1,
        color: [{ data: Uint16Array.of(8191), bitDepth: 13 }],
        codestreamLevel: 5,
      }),
    ).rejects.toThrow('requires codestream Level 10')
    await expect(
      encodeJpegXlNative({
        width: 1,
        height: 1,
        color: [{ data: Uint32Array.of(0), bitDepth: 31 }],
        container: 'raw',
      }),
    ).rejects.toThrow('requires container signaling')
    await expect(
      encodeJpegXlNative({
        width: 1,
        height: 1,
        color: [{ data: Uint32Array.of(0), bitDepth: 32 }],
      }),
    ).rejects.toThrow('storage and depth do not agree')
  })

  it('selects Level 10 when dimensions exceed Level 5', async () => {
    const width = 262_145
    const encoded = await encodeJpegXlNative({
      width,
      height: 1,
      color: [{ data: new Uint8Array(width), bitDepth: 8 }],
      limits: { maxWidth: width, maxPixels: width, maxDecodedBytes: 64 * 1024 * 1024 },
    })
    await expect(
      inspectJpegXl(encoded, { limits: { maxWidth: width, maxPixels: width } }),
    ).resolves.toMatchObject({
      kind: 'container',
      level: 10,
      width,
    })
  })

  it('selects Level 10 when the ICC profile exceeds the Level 5 limit', async () => {
    const sourceProfile = new Uint8Array(
      await readFile(new URL('./fixtures/jpegxl/m4-color/oriented-icc.icc', import.meta.url)),
    )
    const profile = new Uint8Array(4_194_305)
    profile.set(sourceProfile)
    new DataView(profile.buffer).setUint32(0, profile.length, false)
    const limits = {
      maxDecodedBytes: 64 * 1024 * 1024,
      maxHeaderBytes: 16 * 1024 * 1024,
      maxIccBytes: 8 * 1024 * 1024,
      maxIccCompressedBytes: 8 * 1024 * 1024,
    }
    const encoded = await encodeJpegXlNative({
      width: 1,
      height: 1,
      color: [
        { data: Uint8Array.of(0), bitDepth: 8 },
        { data: Uint8Array.of(0), bitDepth: 8 },
        { data: Uint8Array.of(0), bitDepth: 8 },
      ],
      iccProfile: profile,
      limits,
    })
    await expect(inspectJpegXl(encoded, { limits })).resolves.toMatchObject({
      kind: 'container',
      level: 10,
    })
  })

  it('selects Level 10 for five independently described extra channels', async () => {
    const encoded = await encodeJpegXlNative({
      width: 2,
      height: 1,
      color: [{ data: Uint8Array.of(3, 7), bitDepth: 3 }],
      extraChannels: [
        { type: 1, name: 'depth', data: Uint16Array.of(1, 1023), bitDepth: 10 },
        { type: 3, name: 'selection', data: Uint8Array.of(0, 1), bitDepth: 1 },
        { type: 5, name: 'cfa', cfaChannel: 2, data: Uint8Array.of(1, 2), bitDepth: 2 },
        { type: 6, name: 'thermal', data: Uint16Array.of(0, 4095), bitDepth: 12 },
        { type: 16, name: 'reserved', data: Uint8Array.of(1, 0), bitDepth: 1 },
      ],
    })
    await expect(inspectJpegXl(encoded)).resolves.toMatchObject({
      kind: 'container',
      level: 10,
      extraChannels: 5,
    })
    const layer = await firstLayer(encoded)
    expect(layer.header.extraChannels.map((channel) => channel.bitDepth.bits)).toEqual([
      10, 1, 2, 12, 1,
    ])
    expect(Array.from(layer.planes[1] ?? [])).toEqual([1, 1023])
  })

  it('extracts official CMYK and black planes and applies the embedded profile explicitly', async () => {
    const bytes = new Uint8Array(await readFile(new URL('cmyk-layers.jxl', base)))
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      'd732c8836bf1abeadf310d2e07387a32813ed4690d32650c1c25e541b80eed4a',
    )
    const layer = await firstLayer(bytes)
    expect(layer.header.extraChannels.map((channel) => channel.type)).toEqual([4, 0])
    expect(layer.planes).toHaveLength(5)
    const converted = convertJpegXlCmykLayerToRgba8(layer)
    expect(converted).toMatchObject({ width: 512, height: 512, format: 'rgba8' })
    expect(Array.from(converted.data.subarray(0, 4))).toEqual([255, 255, 255, 255])

    const profile = layer.header.iccProfile
    if (!profile) throw new Error('Missing CMYK fixture profile')
    const encoded = await encodeJpegXlNative({
      width: 2,
      height: 1,
      color: [
        { data: Uint8Array.of(255, 0), bitDepth: 8 },
        { data: Uint8Array.of(255, 0), bitDepth: 8 },
        { data: Uint8Array.of(255, 0), bitDepth: 8 },
      ],
      extraChannels: [{ type: 4, data: Uint8Array.of(255, 0), bitDepth: 8 }],
      iccProfile: profile,
    })
    await expect(inspectJpegXl(encoded)).resolves.toMatchObject({ level: 10, extraChannels: 1 })
    const roundTrip = await firstLayer(encoded)
    expect(roundTrip.header.extraChannels[0]?.type).toBe(4)
    expect(Array.from(roundTrip.planes[3] ?? [])).toEqual([255, 0])

    const grouped = Uint8Array.from({ length: 1_025 }, (_, index) => index & 255)
    const groupedLayer = await firstLayer(
      await encodeJpegXlNative({
        width: grouped.length,
        height: 1,
        color: [
          { data: grouped, bitDepth: 8 },
          { data: grouped.slice().reverse(), bitDepth: 8 },
          { data: grouped.slice(), bitDepth: 8 },
        ],
        extraChannels: [{ type: 4, data: grouped.slice().reverse(), bitDepth: 8 }],
        iccProfile: profile,
      }),
    )
    expect(groupedLayer.planes.map((plane) => plane.length)).toEqual([
      grouped.length,
      grouped.length,
      grouped.length,
      grouped.length,
    ])
  })

  it('applies the embedded CMYK profile to a shifted black plane', async () => {
    const fixture = await firstLayer(
      new Uint8Array(await readFile(new URL('cmyk-layers.jxl', base))),
    )
    const profile = fixture.header.iccProfile
    if (!profile) throw new Error('Missing CMYK fixture profile')
    const color = Array.from({ length: 16 }, (_, index) => (index * 13) & 255)
    const full = await firstLayer(
      await encodeJpegXlNative({
        width: 4,
        height: 4,
        color: [
          { data: Uint8Array.from(color), bitDepth: 8 },
          { data: Uint8Array.from(color), bitDepth: 8 },
          { data: Uint8Array.from(color), bitDepth: 8 },
        ],
        extraChannels: [{ type: 4, data: new Uint8Array(16).fill(97), bitDepth: 8 }],
        iccProfile: profile,
      }),
    )
    const shifted = await firstLayer(
      await encodeJpegXlNative({
        width: 4,
        height: 4,
        color: [
          { data: Uint8Array.from(color), bitDepth: 8 },
          { data: Uint8Array.from(color), bitDepth: 8 },
          { data: Uint8Array.from(color), bitDepth: 8 },
        ],
        extraChannels: [{ type: 4, dimShift: 1, data: new Uint8Array(4).fill(97), bitDepth: 8 }],
        iccProfile: profile,
      }),
    )
    expect(convertJpegXlCmykLayerToRgba8(shifted).data).toEqual(
      convertJpegXlCmykLayerToRgba8(full).data,
    )
  })

  it('rejects NaN and infinity in explicit integer display conversion', async () => {
    const values = new Float32Array([Number.NaN, Number.POSITIVE_INFINITY])
    const encoded = await encodeJpegXlNative({
      width: 2,
      height: 1,
      color: [{ data: new Uint32Array(values.buffer), bitDepth: 32, sampleFormat: 'binary32' }],
    })
    const layer = await firstLayer(encoded)
    expect(() => convertJpegXlFloat32LayerToRgba16(layer, { black: 0, white: 1 })).toThrow(
      'rejects NaN and infinity',
    )
  })
})
