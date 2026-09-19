import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
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
    const integerLayer = await firstLayer(
      await encodeJpegXlNative({
        width: integers.length,
        height: 1,
        color: [{ data: integers, bitDepth: 31 }],
      }),
    )
    expect(Array.from(jpegXlNativeUnsignedPlanes(integerLayer)[0] ?? [])).toEqual(
      Array.from(integers),
    )
  })

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
