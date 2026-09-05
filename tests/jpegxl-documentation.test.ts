import { readFile } from 'node:fs/promises'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { hdrRgbaToPng, hdrRgbToPng, sdrRgbaToPng, sdrRgbToPng } from '../examples/jpegxl-display.ts'
import { jpegxlCodec } from '../src/codecs/jpegxl.ts'
import { pngCodec } from '../src/codecs/png.ts'
import { createImageLibrary } from '../src/index.ts'
import {
  inspectJpegReconstructionEligibility,
  inspectJpegXl,
  reconstructJpegFromJpegXl,
  transcodeJpegToJpegXl,
} from '../src/jpegxl.ts'
import { defaultImageLimits } from '../src/limits.ts'
import { MemorySource } from '../src/source.ts'

const images = createImageLibrary([jpegxlCodec, pngCodec])
const fixture = (id: string) => readFile(`tests/fixtures/jpegxl/remediation/${id}.jxl`)

describe('JPEG XL guide examples', () => {
  it('preserves native high-depth JXL', async () => {
    const native = await images.open(await fixture('hlg-12'))
    const encoded = await native.jpegxl({ effort: 7 }).toUint8Array()
    expect(await inspectJpegXl(encoded)).toMatchObject({
      bitDepth: 12,
      toneMapping: { intensityTarget: 2000 },
    })
  })
  it('prints the exact package-consumer functions exercised here', async () => {
    const source = await readFile('examples/jpegxl-display.ts', 'utf8')
    const guide = await readFile('docs/jpeg-xl.md', 'utf8')
    expect(guide).toContain(source.split('\n\nexport async function')[0])
    const recipes = [...source.matchAll(/export async function [\s\S]*?^}/gm)]
    expect(recipes).toHaveLength(4)
    for (const [recipe] of recipes) expect(guide).toContain(recipe)
  })
  for (const entry of [
    { id: 'srgb-8', depth: 8, alpha: 0 },
    { id: 'srgb-10', depth: 10, alpha: 0 },
    { id: 'srgb-12', depth: 12, alpha: 0 },
    { id: 'srgb-straight-8-8', depth: 8, alpha: 8 },
    { id: 'srgb-straight-12-16', depth: 12, alpha: 16 },
    { id: 'srgb-premultiplied-12-8', depth: 12, alpha: 8 },
  ]) {
    it(`exports display-oriented SDR PNG for ${entry.id}`, async () => {
      const input = await readFile(`tests/fixtures/jpegxl/m4-color/${entry.id}.jxl`)
      const reference = await readFile(`tests/fixtures/jpegxl/m4-color/${entry.id}.bin`)
      const alpha = entry.alpha > 0
      const png = await (alpha ? sdrRgbaToPng : sdrRgbToPng)(input)
      const actual = await checkDisplayPng(png, alpha ? 5 : 7, alpha ? 1 : 5, alpha)
      const channels = alpha ? 4 : 3
      const wide = Math.max(entry.depth, entry.alpha) > 8
      for (let i = 0; i < actual.length; i++) {
        const isAlpha = alpha && i % channels === 3
        const sample = wide ? reference.readUInt16BE(i * 2) : (reference[i] ?? 0)
        let normalized = sample / (2 ** (isAlpha ? entry.alpha : entry.depth) - 1)
        if (!isAlpha && entry.id.includes('premultiplied')) {
          const a = reference.readUInt16BE((Math.floor(i / 4) * 4 + 3) * 2) / (2 ** entry.alpha - 1)
          normalized = a === 0 ? 0 : Math.min(1, normalized / a)
        }
        expect(Math.abs((actual[i] ?? 0) - Math.round(normalized * 255))).toBeLessThanOrEqual(
          isAlpha ? 0 : 1,
        )
      }
    })
  }
  for (const id of ['hlg-12', 'pq-12', 'hlg-alpha-12-8', 'pq-alpha-12-16']) {
    it(`exports SDR PNG for ${id} using independent normalized samples`, async () => {
      const input = await fixture(id)
      const reference = await readFile(`tests/fixtures/jpegxl/remediation/${id}.bin`)
      expect(await inspectJpegXl(input)).toMatchObject({ toneMapping: { intensityTarget: 2000 } })
      const alpha = id.includes('alpha')
      const actual = await checkDisplayPng(
        await (alpha ? hdrRgbaToPng : hdrRgbToPng)(input),
        5,
        3,
        alpha,
      )
      const channels = alpha ? 4 : 3
      for (let pixel = 0; pixel < 15; pixel++) {
        const offset = pixel * channels
        const rgb = [0, 1, 2].map((c) => reference.readFloatBE((offset + c) * 4))
        const expected = referenceHdrDisplay(rgb, id.startsWith('hlg'))
        for (let c = 0; c < 3; c++)
          expect(Math.abs((actual[offset + c] ?? 0) - (expected[c] ?? 0))).toBeLessThanOrEqual(1)
        if (alpha)
          expect(actual[offset + 3]).toBe(Math.round(reference.readFloatBE((offset + 3) * 4) * 255))
      }
    })
  }
  it('applies orientation and supported source-profile conversion for display', async () => {
    const input = await readFile('tests/fixtures/jpegxl/m4-color/oriented-icc.jxl')
    expect(await inspectJpegXl(input)).toMatchObject({ orientation: 5 })
    const actual = await checkDisplayPng(await sdrRgbToPng(input), 606, 500, false)
    // Raw PNG samples from pinned libjxl 0.12.0 (oracle-tools.json),
    // djxl --color_space=RGB_D65_SRG_Rel_SRG; do not apply the source ICC again.
    for (const [x, y, rgb] of [
      [0, 0, [110, 110, 89]],
      [200, 50, [74, 77, 55]],
      [500, 100, [123, 122, 134]],
      [300, 250, [209, 55, 51]],
      [50, 400, [125, 136, 142]],
      [605, 499, [87, 77, 75]],
    ] as const) {
      for (let c = 0; c < 3; c++)
        expect(Math.abs((actual[(y * 606 + x) * 3 + c] ?? 0) - (rgb[c] ?? 0))).toBeLessThanOrEqual(
          1,
        )
    }
  })
  for (const id of ['srgb-8', 'srgb-straight-8-8']) {
    it(`continues to reject HDR tone mapping for ${id} during execution`, async () => {
      const input = await readFile(`tests/fixtures/jpegxl/m4-color/${id}.jxl`)
      const image = await images.open(input, {
        colorOutput: 'srgb',
        hdrOutput: 'tone-map-srgb',
        alphaOutput: 'straight',
      })
      await expect(
        image.convertPixelFormat({ format: 'rgba8' }).png().toUint8Array(),
      ).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' })
    })
  }
  it('continues to require explicit alpha when adding a channel to opaque HDR', async () => {
    const image = await images.open(await fixture('hlg-12'), {
      colorOutput: 'srgb',
      hdrOutput: 'tone-map-srgb',
    })
    await expect(
      image.convertPixelFormat({ format: 'rgba8' }).png().toUint8Array(),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    const actual = await checkDisplayPng(
      await image.convertPixelFormat({ format: 'rgba8', alpha: 1 }).png().toUint8Array(),
      5,
      3,
      true,
    )
    for (let i = 3; i < actual.length; i += 4) expect(actual[i]).toBe(255)
  })
  it('preserves HLG luminance fields through full-range integer storage', async () => {
    const hlg = await images.open(await fixture('hlg-12'))
    const encoded = await hlg.convertPixelFormat({ format: 'rgb16' }).jpegxl().toUint8Array()
    expect(await inspectJpegXl(encoded)).toMatchObject({
      bitDepth: 16,
      toneMapping: {
        intensityTarget: 2000,
        minNits: 0.125,
        relativeToMaxDisplay: true,
        linearBelow: 0.25,
      },
    })
  })
  it('re-encodes gray plus alpha with RGB emitted semantics', async () => {
    const grayAlpha = await images.open(await fixture('gray-alpha-12-8'))
    const encoded = await grayAlpha.jpegxl().toUint8Array()
    expect(await inspectJpegXl(encoded)).toMatchObject({
      colorChannels: 3,
      bitDepth: 12,
      extraChannels: 1,
    })
  })
  it('straightens associated alpha before PNG output', async () => {
    const straight = await images.open(await fixture('gray-associated-12-8'), {
      alphaOutput: 'straight',
    })
    const png = await straight.convertPixelFormat({ format: 'rgba16' }).png().toUint8Array()
    const decoder = await pngCodec.createDecoder?.(new MemorySource(png), defaultImageLimits)
    expect(decoder?.colorSemantics?.alpha).toBe('straight')
    expect(decoder?.pixelFormat).toBe('rgba16')
  })
  it('preserves a compatible source ICC profile in PNG', async () => {
    const profiledJxl = await readFile('tests/fixtures/jpegxl/m4-color/oriented-icc.jxl')
    const profiled = await images.open(profiledJxl, { colorOutput: 'preserve' })
    const png = await profiled.autoOrient().keepIcc().png().toUint8Array()
    const metadata = await pngCodec.preservedMetadata?.(new MemorySource(png), defaultImageLimits, {
      icc: true,
      exif: false,
    })
    expect(metadata?.icc).toEqual(
      new Uint8Array(await readFile('tests/fixtures/jpegxl/m4-color/oriented-icc.icc')),
    )
  })
  it('requires exact bytes and rejects expansion when onlyIfSmaller is set', async () => {
    const jpegBytes = await sharp({
      create: { width: 2, height: 2, channels: 3, background: { r: 200, g: 60, b: 30 } },
    })
      .jpeg()
      .toBuffer()
    const eligibility = await inspectJpegReconstructionEligibility(jpegBytes)
    expect(eligibility.eligible).toBe(true)
    const full = await transcodeJpegToJpegXl(jpegBytes, { reconstruction: 'required' })
    const originalJpeg = await reconstructJpegFromJpegXl(full.data)
    expect(originalJpeg).toEqual(new Uint8Array(jpegBytes))
    await expect(
      transcodeJpegToJpegXl(jpegBytes, { reconstruction: 'required', onlyIfSmaller: true }),
    ).rejects.toThrow(/not smaller/)
  })
})

async function checkDisplayPng(
  png: Uint8Array,
  width: number,
  height: number,
  alpha: boolean,
): Promise<Uint8Array> {
  expect(Array.from(png.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  expect(png[24]).toBe(8)
  expect(png[25]).toBe(alpha ? 6 : 2)
  const decoder = await pngCodec.createDecoder?.(new MemorySource(png), defaultImageLimits)
  expect(decoder).toMatchObject({
    width,
    height,
    pixelFormat: alpha ? 'rgba8' : 'rgb8',
    colorSemantics: {
      family: 'rgb',
      primaries: 'srgb',
      transfer: { kind: 'srgb' },
      alpha: alpha ? 'straight' : 'none',
    },
  })
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
  expect(info).toMatchObject({ width, height, channels: alpha ? 4 : 3, depth: 'uchar' })
  return data
}

// Scalar reference equations applied to independent libjxl float fixtures. BT.2100
// HLG / ST 2084 PQ, BT.2020-to-sRGB primaries, and the documented normalized
// Reinhard display operator. No production conversion or lookup tables are used.
function referenceHdrDisplay(rgb: readonly number[], hlg: boolean): number[] {
  let linear = rgb.map((value) => {
    if (hlg)
      return value <= 0.5
        ? value ** 2 / 3
        : (Math.exp((value - 0.55991073) / 0.17883277) + 0.28466892) / 12
    const p = value ** (32 / 2523)
    return (
      ((Math.max(0, p - 3424 / 4096) / (2413 / 128 - (2392 / 128) * p)) ** (16384 / 2610) * 10000) /
      203
    )
  })
  const peak = (hlg ? 2000 : 10000) / 203
  if (hlg) {
    const y = (linear[0] ?? 0) * 0.2627 + (linear[1] ?? 0) * 0.678 + (linear[2] ?? 0) * 0.0593
    linear = linear.map((value) => value * y ** (1.2 * 1.111 - 1) * peak)
  }
  const scale = (peak + 1) / peak / (Math.max(...linear) + 1)
  return [
    [1.660491, -0.587641, -0.07285],
    [-0.12455, 1.1329, -0.008349],
    [-0.018151, -0.100579, 1.11873],
  ].map((row) => {
    const value =
      row.reduce((sum, coefficient, index) => sum + coefficient * (linear[index] ?? 0), 0) * scale
    const encoded = value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055
    return Math.round(Math.max(0, Math.min(1, encoded)) * 255)
  })
}
