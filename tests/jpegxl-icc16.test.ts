import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { rgbLutOnlyProfile } from './icc-fixtures.ts'
import {
  convertJpegXlIccLayerToRgba16,
  encodeJpegXlNative,
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
  throw new Error('Missing JPEG XL layer')
}

const profile = async (path: string, digest: string): Promise<Uint8Array> => {
  const bytes = new Uint8Array(await readFile(new URL(path, import.meta.url)))
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(digest)
  return bytes
}

const expectNear = (actual: Uint16Array, expected: readonly number[], tolerance: number): void => {
  expect(actual.length).toBe(expected.length)
  for (let index = 0; index < expected.length; index++)
    expect(Math.abs((actual[index] ?? 0) - (expected[index] ?? 0))).toBeLessThanOrEqual(tolerance)
}

describe('JPEG XL explicit 16-bit ICC display conversion', () => {
  it('converts gray10 plus shifted 8-bit alpha across an AC group boundary', async () => {
    const gray = await profile(
      './fixtures/jpegxl/m8-native/gray.icc',
      '3f62598dfd40d6642ca5fd962559bb6615af15448a57a3972a4089c109e62fbd',
    )
    const color = new Uint16Array(1_025)
    color[0] = 256
    color[1] = 512
    color[1_024] = 1_023
    const alpha = new Uint8Array(513).fill(255)
    alpha[0] = 128
    alpha[512] = 0
    const layer = await firstLayer(
      await encodeJpegXlNative({
        width: 1_025,
        height: 1,
        color: [{ data: color, bitDepth: 10 }],
        extraChannels: [{ type: 0, data: alpha, bitDepth: 8, dimShift: 1 }],
        iccProfile: gray,
      }),
    )
    const display = convertJpegXlIccLayerToRgba16(layer)
    // LittleCMS 2.16, perceptual intent, gray source profile to sRGB, 16-bit I/O.
    expectNear(
      display.data.subarray(0, 8),
      [28_632, 28_632, 28_632, 32_896, 43_619, 43_619, 43_619, 39_381],
      1,
    )
    expect(Array.from(display.data.subarray(1_024 * 4, 1_025 * 4))).toEqual([
      65_535, 65_535, 65_535, 13_020,
    ])
    expect(display.colorSemantics).toMatchObject({
      family: 'rgb',
      primaries: 'srgb',
      alpha: 'straight',
    })
    expect(display.sourceColorSemantics).toMatchObject({ family: 'gray' })
  })

  it('straightens associated gray12 plus 12-bit alpha before profile conversion', async () => {
    const gray = await readFile(new URL('./fixtures/jpegxl/m8-native/gray.icc', import.meta.url))
    const layer = await firstLayer(
      await encodeJpegXlNative({
        width: 3,
        height: 1,
        color: [{ data: Uint16Array.of(1_024, 0, 4_095), bitDepth: 12 }],
        extraChannels: [
          { type: 0, data: Uint16Array.of(2_048, 0, 4_095), bitDepth: 12, associatedAlpha: true },
        ],
        iccProfile: gray,
      }),
    )
    const display = convertJpegXlIccLayerToRgba16(layer)
    expectNear(
      display.data,
      [43_594, 43_594, 43_594, 32_776, 0, 0, 0, 0, 65_535, 65_535, 65_535, 65_535],
      1,
    )
    expect(display.sourceColorSemantics.alpha).toBe('premultiplied')
  })

  it('keeps adjacent gray16 values distinct with binary32 alpha', async () => {
    const gray = await readFile(new URL('./fixtures/jpegxl/m8-native/gray.icc', import.meta.url))
    const alpha = Float32Array.of(0.5, 1)
    const layer = await firstLayer(
      await encodeJpegXlNative({
        width: 2,
        height: 1,
        color: [{ data: Uint16Array.of(16_400, 16_402), bitDepth: 16 }],
        extraChannels: [
          { type: 0, data: new Uint32Array(alpha.buffer), bitDepth: 32, sampleFormat: 'binary32' },
        ],
        iccProfile: gray,
      }),
    )
    const display = convertJpegXlIccLayerToRgba16(layer)
    expect(Array.from(display.data)).toEqual([
      28_632, 28_632, 28_632, 32_768, 28_634, 28_634, 28_634, 65_535,
    ])
  })

  it('converts RGB16 directly and retains changes smaller than one 8-bit code', async () => {
    const rgb = await profile(
      './fixtures/jpegxl/m4-color/oriented-icc.icc',
      '6603ae12a4ac1ac742cacd887e9b35552a12c354ff25a00cae069ad4b932e6cc',
    )
    const layer = await firstLayer(
      await encodeJpegXlNative({
        width: 4,
        height: 1,
        color: [
          { data: Uint16Array.of(0, 16_384, 32_768, 65_535), bitDepth: 16 },
          { data: Uint16Array.of(65_535, 32_768, 16_384, 0), bitDepth: 16 },
          { data: Uint16Array.of(0, 8_192, 32_768, 65_535), bitDepth: 16 },
        ],
        extraChannels: [{ type: 0, data: Uint8Array.of(255, 128, 0, 255), bitDepth: 8 }],
        iccProfile: rgb,
      }),
    )
    const display = convertJpegXlIccLayerToRgba16(layer)
    // LittleCMS 2.16 perceptual, RGB16 to sRGB16. Color remains defined at zero alpha.
    expectNear(
      display.data,
      [
        65_534, 11, 0, 65_535, 32_768, 8_196, 16_386, 32_896, 16_387, 32_768, 32_768, 0, 31, 65_535,
        65_535, 65_535,
      ],
      180,
    )
    const adjacent = await firstLayer(
      await encodeJpegXlNative({
        width: 2,
        height: 1,
        color: [
          { data: Uint16Array.of(16_384, 16_385), bitDepth: 16 },
          { data: Uint16Array.of(16_384, 16_384), bitDepth: 16 },
          { data: Uint16Array.of(16_384, 16_384), bitDepth: 16 },
        ],
        iccProfile: rgb,
      }),
    )
    const values = convertJpegXlIccLayerToRgba16(adjacent).data
    expect(Array.from(values.subarray(0, 3))).not.toEqual(Array.from(values.subarray(4, 7)))
  })

  it('evaluates the supported RGB mAB profile family at 16-bit input precision', async () => {
    const layer = await firstLayer(
      await encodeJpegXlNative({
        width: 4,
        height: 1,
        color: [
          { data: Uint16Array.of(0, 16_384, 32_768, 65_535), bitDepth: 16 },
          { data: Uint16Array.of(0, 32_768, 16_384, 65_535), bitDepth: 16 },
          { data: Uint16Array.of(0, 8_192, 32_768, 65_535), bitDepth: 16 },
        ],
        iccProfile: rgbLutOnlyProfile(),
      }),
    )
    // LittleCMS 2.16, perceptual intent, generated mAB profile to sRGB16.
    // The source profile uses a two-point CLUT; the first-party trilinear
    // interpolation differs from LittleCMS tetrahedral interpolation.
    expectNear(
      convertJpegXlIccLayerToRgba16(layer).data,
      [
        0, 0, 0, 65_535, 15_818, 32_577, 6_921, 65_535, 32_571, 15_834, 32_581, 65_535, 65_535,
        65_535, 65_535, 65_535,
      ],
      1_300,
    )
  })

  it('converts CMYK16 using the profile perceptual A2B0 intent', async () => {
    const fixture = await firstLayer(
      new Uint8Array(
        await readFile(new URL('./fixtures/jpegxl/m10-level10/cmyk-layers.jxl', import.meta.url)),
      ),
    )
    const cmyk = fixture.header.iccProfile
    if (!cmyk) throw new Error('Missing CMYK profile')
    expect(createHash('sha256').update(cmyk).digest('hex')).toBe(
      '4855b8fabb96bdc6495d45d089bb8c8efb1ae18389e0dc9e75a5f701a9c0b662',
    )
    const layer = await firstLayer(
      await encodeJpegXlNative({
        width: 4,
        height: 1,
        color: [
          { data: Uint16Array.of(65_535, 32_768, 16_384, 0), bitDepth: 16 },
          { data: Uint16Array.of(65_535, 8_192, 32_768, 0), bitDepth: 16 },
          { data: Uint16Array.of(65_535, 32_768, 4_096, 0), bitDepth: 16 },
        ],
        extraChannels: [
          { type: 4, data: Uint16Array.of(65_535, 32_768, 16_384, 0), bitDepth: 16 },
          { type: 0, data: Uint8Array.of(255, 128, 0, 255), bitDepth: 8 },
        ],
        iccProfile: cmyk,
      }),
    )
    const display = convertJpegXlIccLayerToRgba16(layer)
    // LittleCMS 2.16, perceptual A2B0 source, sRGB16 target, 16-bit I/O.
    expectNear(
      display.data,
      [
        65_535, 65_535, 65_535, 65_535, 21_989, 8_570, 14_697, 32_896, 5_158, 10_462, 2_810, 0, 0,
        0, 0, 65_535,
      ],
      350,
    )
    expect(display.colorSemantics).toMatchObject({ family: 'rgb', primaries: 'srgb' })
  })
})
