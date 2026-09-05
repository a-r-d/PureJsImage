import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { createImageLibrary } from '../src/index.ts'
import { jpegxlCodec } from '../src/codecs/jpegxl.ts'
import { pngCodec } from '../src/codecs/png.ts'
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
  it('requests an explicit 8-bit PNG display conversion', async () => {
    const display = await images.open(await fixture('pq-alpha-12-16'), {
      colorOutput: 'srgb',
      hdrOutput: 'tone-map-srgb',
      alphaOutput: 'straight',
    })
    const png = await display.convertPixelFormat({ format: 'rgba8' }).png().toUint8Array()
    const metadata = await pngCodec.metadata(new MemorySource(png), defaultImageLimits)
    expect(metadata.bitDepth).toBe(8)
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
