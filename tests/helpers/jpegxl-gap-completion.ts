import { createImageLibrary } from '../../src/browser.ts'
import type { DecoderOptions } from '../../src/codec.ts'
import { jpegxlCodec } from '../../src/codecs/jpegxl.ts'
import type { PixelColorSemantics } from '../../src/color.ts'
import {
  convertJpegXlFloatLayerToRgba16,
  encodeJpegXlAnimation,
  encodeJpegXlNative,
  openJpegXlSequence,
  inspectJpegXl,
} from '../../src/jpegxl.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { MemorySource } from '../../src/source.ts'
import { rgbLegacyLutProfile } from '../icc-fixtures.ts'
import { collectJpegXlProfileRows } from './jpegxl-profile-pipeline.ts'

export const gapSemantics: PixelColorSemantics = {
  family: 'rgb',
  primaries: 'srgb',
  transfer: { kind: 'srgb' },
  matrix: 'identity',
  range: 'full',
  alpha: 'none',
  provenance: 'container-signaled',
  renderingIntent: 'relative',
}
const Image = createImageLibrary({ codecs: [jpegxlCodec] })
export const gapDecoder = async (data: Uint8Array, options: DecoderOptions = {}) => {
  const decoder = await jpegxlCodec.createDecoder?.(
    new MemorySource(data),
    defaultImageLimits,
    options,
  )
  if (!decoder) throw new Error('JPEG XL decoder unavailable')
  return decoder
}
export const verifyJpegXlVarDctFloatAlpha = async (
  input: Uint8Array,
  reference: Uint8Array,
): Promise<{ maximumColor: number; maximumAlpha: number }> => {
  const decoder = await gapDecoder(input)
  if (decoder.pixelFormat !== 'rgbaf32')
    throw new Error('Floating VarDCT alpha lost Float32 output')
  const output = await collectJpegXlProfileRows(decoder)
  if (output.length !== reference.length) throw new Error('Floating VarDCT output size differs')
  const own = new DataView(output.buffer),
    expected = new DataView(reference.buffer)
  let maximumColor = 0,
    maximumAlpha = 0
  for (let offset = 0; offset < output.length; offset += 4) {
    const difference = Math.abs(own.getFloat32(offset, false) - expected.getFloat32(offset, false))
    if (!Number.isFinite(difference)) throw new Error('Nonfinite floating VarDCT output')
    if (offset % 16 === 12) maximumAlpha = Math.max(maximumAlpha, difference)
    else maximumColor = Math.max(maximumColor, difference)
  }
  return { maximumColor, maximumAlpha }
}
const assert = (ok: boolean, message: string): void => {
  if (!ok) throw new Error(message)
}
export type JpegXlGapProbe = (
  id: string,
  encoded: Uint8Array,
  output: Uint8Array,
  decoder: Awaited<ReturnType<typeof gapDecoder>>,
) => Promise<void>
export const verifyJpegXlSampleGaps = async (probe?: JpegXlGapProbe): Promise<number> => {
  let cases = 0
  for (const bits of [8, 16, 24, 31]) {
    const maximum = 2 ** bits - 1
    const data = Uint32Array.of(0, 1, maximum - 1, maximum)
    for (const gray of [true, false]) {
      const plane = { data, bitDepth: bits }
      const encoded = await encodeJpegXlNative({
        width: 4,
        height: 1,
        color: gray ? [plane] : [plane, plane, plane],
      })
      if (bits > 16) {
        const decoder = await gapDecoder(encoded)
        assert(decoder.pixelFormat === (gray ? 'gray32' : 'rgb32'), 'Wide integer format changed')
        const output = new DataView((await collectJpegXlProfileRows(decoder)).buffer)
        for (let pixel = 0; pixel < 4; pixel++)
          assert(
            output.getUint32(pixel * (gray ? 4 : 12), false) === data[pixel],
            'Wide integer sample changed',
          )
        const again = await (await Image.open(encoded)).jpegxl().toUint8Array()
        assert(
          (await gapDecoder(again)).execution?.sourceSampleBitDepths[0] === bits,
          'Wide integer depth changed',
        )
        if (probe)
          await probe(
            `${gray ? 'gray' : 'rgb'}${bits}`,
            encoded,
            new Uint8Array(output.buffer),
            decoder,
          )
        cases++
      }
      for (const associated of [false, true]) {
        const input = await encodeJpegXlNative({
          width: 4,
          height: 1,
          color: gray ? [plane] : [plane, plane, plane],
          extraChannels: [
            {
              type: 0,
              data: new Uint32Array(Float32Array.of(0, 0.25, 0.5, 1).buffer),
              bitDepth: 32,
              sampleFormat: 'binary32',
              associatedAlpha: associated,
            },
          ],
        })
        const decoder = await gapDecoder(input)
        assert(decoder.pixelFormat === 'rgbaf32', 'Mixed float alpha format changed')
        const output = new DataView((await collectJpegXlProfileRows(decoder)).buffer)
        for (let pixel = 0; pixel < 4; pixel++) {
          assert(
            output.getFloat32(pixel * 16, false) === Math.fround((data[pixel] ?? 0) / maximum),
            'Mixed color sample changed',
          )
          assert(
            output.getFloat32(pixel * 16 + 12, false) === [0, 0.25, 0.5, 1][pixel],
            'Mixed alpha sample changed',
          )
        }
        const straight = new DataView(
          (await collectJpegXlProfileRows(await gapDecoder(input, { alphaOutput: 'straight' })))
            .buffer,
        )
        if (associated)
          assert(straight.getFloat32(0, false) === 0, 'Zero alpha straightening failed')
        if (probe)
          await probe(
            `${gray ? 'gray' : 'rgb'}${bits}-alpha32-${associated ? 'associated' : 'straight'}`,
            input,
            new Uint8Array(output.buffer),
            decoder,
          )
        cases++
      }
    }
  }
  for (const bits of [24, 31])
    for (const gray of [true, false]) {
      const values = Float32Array.of(-0.25, 0, 0.5, 2)
      const plane = {
        data: new Uint32Array(values.buffer),
        bitDepth: 32,
        sampleFormat: 'binary32' as const,
      }
      const maximum = 2 ** bits - 1
      const alpha = Uint32Array.of(0, 1, maximum - 1, maximum)
      const input = await encodeJpegXlNative({
        width: 4,
        height: 1,
        color: gray ? [plane] : [plane, plane, plane],
        extraChannels: [{ type: 0, data: alpha, bitDepth: bits }],
      })
      const decoder = await gapDecoder(input)
      const output = await collectJpegXlProfileRows(decoder)
      const view = new DataView(output.buffer)
      for (let pixel = 0; pixel < 4; pixel++) {
        assert(
          view.getFloat32(pixel * 16, false) === values[pixel],
          'Float color with wide alpha changed',
        )
        assert(
          view.getFloat32(pixel * 16 + 12, false) === Math.fround((alpha[pixel] ?? 0) / maximum),
          'Wide alpha normalization changed',
        )
      }
      if (probe) await probe(`${gray ? 'gray' : 'rgb'}32-alpha${bits}`, input, output, decoder)
      cases++
    }
  return cases
}

export const verifyJpegXlExtendedColorGaps = async (): Promise<number> => {
  let cases = 0
  for (const [bits, exponent, one, sign] of [
    [24, 8, 0x3f8000, 0x800000],
    [16, 4, 0x3800, 0x8000],
  ] as const) {
    const input = await encodeJpegXlNative({
      width: 4,
      height: 1,
      color: [
        {
          data: Uint32Array.of(sign, 0, one, one + sign),
          bitDepth: bits,
          exponentBits: exponent,
          sampleFormat: 'floating-point',
        },
      ],
    })
    const raw = new DataView((await collectJpegXlProfileRows(await gapDecoder(input))).buffer)
    assert(
      Object.is(raw.getFloat32(0, false), -0) &&
        raw.getFloat32(8, false) === 1 &&
        raw.getFloat32(12, false) === -1,
      'Custom floating layout changed',
    )
    const sequence = await openJpegXlSequence(input)
    try {
      for await (const layer of sequence.layers()) {
        const display = convertJpegXlFloatLayerToRgba16(layer, { black: -1, white: 1 })
        assert(
          display.data[8] === 65535 && display.data[12] === 0,
          'Custom float native display changed',
        )
      }
    } finally {
      await sequence.close()
    }
    cases++
  }
  for (const precision of [1, 2] as const) {
    const plane = {
      data: new Uint32Array(Float32Array.of(0, 0.25, 0.5, 1).buffer),
      bitDepth: 32,
      sampleFormat: 'binary32' as const,
    }
    const input = await encodeJpegXlNative({
      width: 4,
      height: 1,
      color: [plane, plane, plane],
      iccProfile: rgbLegacyLutProfile(precision),
    })
    const converted = new DataView(
      (await collectJpegXlProfileRows(await gapDecoder(input, { colorOutput: 'srgb' }))).buffer,
    )
    assert(
      converted.getUint16(0, false) === 0 && converted.getUint16(18, false) > 65000,
      'Legacy LUT ICC conversion changed',
    )
    const preserved = await (await Image.open(input, { colorOutput: 'preserve' }))
      .keepIcc()
      .jpegxl()
      .toUint8Array()
    assert(
      (await gapDecoder(preserved, { colorOutput: 'preserve' })).pixelFormat === 'rgbf32',
      'Legacy LUT source preservation changed',
    )
    cases++
  }
  return cases
}

export const encodeGapAnimation = async (
  data: Uint8Array,
  pixelFormat: 'rgb16' | 'rgbf32',
  semantics: PixelColorSemantics,
  lossy = false,
): Promise<Uint8Array> => {
  const parts: Uint8Array[] = []
  async function* frames() {
    for (let i = 0; i < 2; i++) yield { data, width: 8, height: 8, durationTicks: i + 1 }
  }
  for await (const part of encodeJpegXlAnimation(frames(), {
    width: 8,
    height: 8,
    pixelFormat,
    colorSemantics: semantics,
    animation: {
      ticksPerSecondNumerator: 1000,
      ticksPerSecondDenominator: 1,
      loops: 0,
      haveTimecodes: false,
    },
    encoding: lossy ? { mode: 'lossy', distance: 1, effort: 1 } : {},
  }))
    parts.push(part)
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.length
  }
  return output
}

export const verifyJpegXlAnimationGaps = async (): Promise<number> => {
  const samples = new Uint8Array(8 * 8 * 3 * 4),
    view = new DataView(samples.buffer)
  for (let i = 0; i < samples.length / 4; i++) view.setFloat32(i * 4, ((i % 31) - 8) / 8, false)
  const encoded = await encodeGapAnimation(samples, 'rgbf32', {
    ...gapSemantics,
    transfer: { kind: 'linear' },
  })
  for (const frame of [0, 1]) {
    const decoder = await gapDecoder(encoded, { frame })
    assert(decoder.pixelFormat === 'rgbf32', 'Float animation storage changed')
    assert(
      (await collectJpegXlProfileRows(decoder)).every((value, index) => value === samples[index]),
      'Float animation samples changed',
    )
  }
  const integer = new Uint8Array(8 * 8 * 3 * 2),
    codes = new DataView(integer.buffer)
  for (let i = 0; i < integer.length / 2; i++) codes.setUint16(i * 2, 12000 + i * 100, false)
  const pq = await encodeGapAnimation(
    integer,
    'rgb16',
    { ...gapSemantics, primaries: 'rec2020', transfer: { kind: 'pq' } },
    true,
  )
  for (const frame of [0, 1])
    for (const hdrOutput of ['linear-float', 'tone-map-srgb'] as const) {
      const decoder = await gapDecoder(pq, { frame, hdrOutput })
      assert(
        decoder.pixelFormat === (hdrOutput === 'linear-float' ? 'rgbf32' : 'rgb8'),
        'HDR animation output changed',
      )
      const raw = await collectJpegXlProfileRows(decoder)
      if (hdrOutput === 'linear-float') {
        const output = await (await Image.open(pq, { frame, hdrOutput })).jpegxl().toUint8Array()
        assert(
          (await inspectJpegXl(output)).toneMapping.intensityTarget === 10000,
          'HDR VarDCT luminance metadata changed on float re-encode',
        )
      }
      assert(
        raw.length === 8 * 8 * 3 * (hdrOutput === 'linear-float' ? 4 : 1),
        'HDR animation geometry changed',
      )
    }
  return 6
}
