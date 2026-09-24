import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
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

const oracleRoot = new URL('./fixtures/jpegxl/practical-float/', import.meta.url)
const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const record = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const oracleRows = async (): Promise<
  readonly Readonly<{
    name: string
    jxlSha256: string
    colorPfmSha256: string
    alphaPfmSha256: string
    color: readonly number[]
    alpha: readonly number[]
    rgba16: readonly number[]
  }>[]
> => {
  const value: unknown = JSON.parse(await readFile(new URL('manifest.json', oracleRoot), 'utf8'))
  if (!record(value) || value.libjxl !== '0.12.0' || !Array.isArray(value.manifest))
    throw new Error('Invalid pinned libjxl float reference manifest')
  return value.manifest.map((row: unknown) => {
    if (
      !record(row) ||
      typeof row.name !== 'string' ||
      typeof row.jxlSha256 !== 'string' ||
      typeof row.colorPfmSha256 !== 'string' ||
      typeof row.alphaPfmSha256 !== 'string' ||
      !Array.isArray(row.color) ||
      !Array.isArray(row.alpha) ||
      !Array.isArray(row.rgba16) ||
      row.color.some((sample: unknown) => typeof sample !== 'number') ||
      row.alpha.some((sample: unknown) => typeof sample !== 'number') ||
      row.rgba16.some((sample: unknown) => typeof sample !== 'number')
    )
      throw new Error('Invalid pinned libjxl float reference row')
    return {
      name: row.name,
      jxlSha256: row.jxlSha256,
      colorPfmSha256: row.colorPfmSha256,
      alphaPfmSha256: row.alphaPfmSha256,
      color: row.color,
      alpha: row.alpha,
      rgba16: row.rgba16,
    }
  })
}
const pfmSamples = (bytes: Uint8Array, channels: 1 | 3): readonly number[] => {
  let offset = 0
  const line = (): string => {
    const end = bytes.indexOf(10, offset)
    if (end < 0) throw new Error('Truncated PFM reference')
    const value = new TextDecoder().decode(bytes.subarray(offset, end))
    offset = end + 1
    return value
  }
  expect(line()).toBe(channels === 1 ? 'Pf' : 'PF')
  expect(line()).toBe('4 1')
  expect(line()).toBe('1.0')
  expect(bytes.byteLength - offset).toBe(4 * channels * 4)
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, bytes.byteLength - offset)
  return Array.from({ length: 4 * channels }, (_, index) => view.getFloat32(index * 4, false))
}

describe('JPEG XL explicit float display conversion', () => {
  it('matches pinned libjxl native float planes and independent RGBA16 mapping for mixed precision', async () => {
    const rows = await oracleRows()
    expect(rows).toHaveLength(17)
    for (const row of rows) {
      const bytes = new Uint8Array(await readFile(new URL(`${row.name}.jxl`, oracleRoot)))
      expect(hash(bytes)).toBe(row.jxlSha256)
      const colorPfm = new Uint8Array(await readFile(new URL(`${row.name}.pfm`, oracleRoot)))
      const alphaPfm = new Uint8Array(
        await readFile(new URL(`${row.name}.pfm-ec1.pfm`, oracleRoot)),
      )
      expect(hash(colorPfm)).toBe(row.colorPfmSha256)
      expect(hash(alphaPfm)).toBe(row.alphaPfmSha256)
      expect(pfmSamples(colorPfm, row.name.startsWith('gray') ? 1 : 3)).toEqual(row.color)
      expect(pfmSamples(alphaPfm, 1)).toEqual(row.alpha)
      const layer = await firstLayer(bytes)
      const display = convertJpegXlFloatLayerToRgba16(layer, { black: 0.25, white: 1.25 })
      expect(display.colorSemantics.alpha).toBe('straight')
      expect(display.sourceColorSemantics.alpha).toBe(
        row.name.endsWith('associated') ? 'premultiplied' : 'straight',
      )
      expect(display.data.length).toBe(row.rgba16.length)
      const tolerance = row.name.includes('-alpha8-') ? 1 : 0
      for (let index = 0; index < display.data.length; index++)
        expect(Math.abs((display.data[index] ?? 0) - (row.rgba16[index] ?? 0))).toBeLessThanOrEqual(
          tolerance,
        )
    }
  })

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
