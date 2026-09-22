import { describe, expect, it } from 'vitest'
import {
  convertJpegXlFloatLayerToRgba16,
  encodeJpegXlNative,
  jpegXlNativeUnsignedPlanes,
  openJpegXlSequence,
  type JpegXlNativeLayer,
} from '../src/jpegxl.ts'

const firstLayer = async (bytes: Uint8Array): Promise<JpegXlNativeLayer> => {
  const sequence = await openJpegXlSequence(bytes)
  try {
    for await (const layer of sequence.layers()) return layer
  } finally {
    await sequence.close()
  }
  throw new Error('Missing native layer')
}

describe('JPEG XL explicit float display conversion', () => {
  it('straightens binary16 gray and binary16 alpha before a nonzero-black display map', async () => {
    const color = Uint16Array.of(0x3600, 0x0001, 0x8000, 0x3c00)
    const alpha = Uint16Array.of(0x3800, 0x3c00, 0x0000, 0x3c00)
    const layer = await firstLayer(
      await encodeJpegXlNative({
        width: 4,
        height: 1,
        color: [{ data: color, bitDepth: 16, sampleFormat: 'binary16' }],
        extraChannels: [
          { type: 0, data: alpha, bitDepth: 16, sampleFormat: 'binary16', associatedAlpha: true },
        ],
      }),
    )
    expect(Array.from(jpegXlNativeUnsignedPlanes(layer)[0] ?? [])).toEqual(Array.from(color))
    expect(Array.from(jpegXlNativeUnsignedPlanes(layer)[1] ?? [])).toEqual(Array.from(alpha))
    const display = convertJpegXlFloatLayerToRgba16(layer, { black: 0.25, white: 1.25 })
    expect(display.colorSemantics).toMatchObject({
      family: 'rgb',
      alpha: 'straight',
      provenance: 'decoder-converted',
    })
    expect(display.sourceColorSemantics.alpha).toBe('premultiplied')
    expect(Array.from(display.data)).toEqual([
      32768, 32768, 32768, 32768, 0, 0, 0, 65535, 0, 0, 0, 0, 49151, 49151, 49151, 65535,
    ])
  })

  it('handles mixed binary32 RGB and shifted integer alpha across group boundaries', async () => {
    const width = 1025
    const red = new Float32Array(width).fill(0.375)
    const green = new Float32Array(width).fill(0.5)
    const blue = new Float32Array(width).fill(0.75)
    const alpha = new Uint8Array(Math.ceil(width / 2)).fill(128)
    const layer = await firstLayer(
      await encodeJpegXlNative({
        width,
        height: 1,
        color: [
          { data: new Uint32Array(red.buffer), bitDepth: 32, sampleFormat: 'binary32' },
          { data: new Uint32Array(green.buffer), bitDepth: 32, sampleFormat: 'binary32' },
          { data: new Uint32Array(blue.buffer), bitDepth: 32, sampleFormat: 'binary32' },
        ],
        extraChannels: [{ type: 0, data: alpha, bitDepth: 8, dimShift: 1, associatedAlpha: true }],
      }),
    )
    expect(layer.header.extraChannels[0]).toMatchObject({ dimShift: 1, associatedAlpha: true })
    expect(jpegXlNativeUnsignedPlanes(layer)[1]?.length).toBe(width)
    expect(jpegXlNativeUnsignedPlanes(layer)[3]?.length).toBe(Math.ceil(width / 2))
    const display = convertJpegXlFloatLayerToRgba16(layer, { black: 0.25, white: 1.25 })
    expect(display.data[3]).toBe(32896)
    expect(display.data[1024 * 4 + 3]).toBe(32896)
    expect(display.data[0]).toBeGreaterThan(32000)
  })

  it.each([
    [
      'binary16 color and binary32 alpha',
      16,
      Uint16Array.of(0x3a00),
      32,
      new Uint32Array(Float32Array.of(0.5).buffer),
    ],
    [
      'binary32 color and binary16 alpha',
      32,
      new Uint32Array(Float32Array.of(0.75).buffer),
      16,
      Uint16Array.of(0x3800),
    ],
  ] as const)(
    'converts straight mixed %s without reducing alpha precision',
    async (_name, colorDepth, color, alphaDepth, alpha) => {
      const layer = await firstLayer(
        await encodeJpegXlNative({
          width: 1,
          height: 1,
          color: [
            {
              data: color,
              bitDepth: colorDepth,
              sampleFormat: colorDepth === 16 ? 'binary16' : 'binary32',
            },
          ],
          extraChannels: [
            {
              type: 0,
              data: alpha,
              bitDepth: alphaDepth,
              sampleFormat: alphaDepth === 16 ? 'binary16' : 'binary32',
            },
          ],
        }),
      )
      const display = convertJpegXlFloatLayerToRgba16(layer, { black: 0, white: 1 })
      expect(Array.from(display.data)).toEqual([49_151, 49_151, 49_151, 32_768])
      expect(display.sourceColorSemantics.alpha).toBe('straight')
      expect(Array.from(jpegXlNativeUnsignedPlanes(layer)[1] ?? [])).toEqual(Array.from(alpha))
    },
  )

  it('clips finite color outside the chosen display range', async () => {
    const values = Float32Array.of(-2, 2)
    const layer = await firstLayer(
      await encodeJpegXlNative({
        width: 2,
        height: 1,
        color: [{ data: new Uint32Array(values.buffer), bitDepth: 32, sampleFormat: 'binary32' }],
      }),
    )
    expect(Array.from(convertJpegXlFloatLayerToRgba16(layer, { black: 0, white: 1 }).data)).toEqual(
      [0, 0, 0, 65_535, 65_535, 65_535, 65_535, 65_535],
    )
  })

  it('rejects non-finite alpha while retaining native bit patterns', async () => {
    const color = Uint16Array.of(0x0000, 0x8000, 0x0001, 0x7c00)
    const alpha = Uint16Array.of(0x3c00, 0x3c00, 0x7e00, 0x3c00)
    const layer = await firstLayer(
      await encodeJpegXlNative({
        width: 4,
        height: 1,
        color: [{ data: color, bitDepth: 16, sampleFormat: 'binary16' }],
        extraChannels: [{ type: 0, data: alpha, bitDepth: 16, sampleFormat: 'binary16' }],
      }),
    )
    expect(Array.from(jpegXlNativeUnsignedPlanes(layer)[0] ?? [])).toEqual(Array.from(color))
    expect(Array.from(jpegXlNativeUnsignedPlanes(layer)[1] ?? [])).toEqual(Array.from(alpha))
    expect(() => convertJpegXlFloatLayerToRgba16(layer, { black: 0, white: 1 })).toThrow(
      'rejects NaN and infinity',
    )
  })
})
