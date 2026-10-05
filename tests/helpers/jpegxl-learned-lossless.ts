import { jpegxlCodec } from '../../src/codecs/jpegxl.ts'
import { createJpegXlModularEncoder } from '../../src/codecs/jpegxl-modular-encode.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { Uint8ArraySink } from '../../src/sink.ts'
import { MemorySource } from '../../src/source.ts'

export const learnedLosslessFixture = (depth: 8 | 16, width: 1024 | 1025) => {
  const height = 257,
    sampleBytes = depth / 8,
    maximum = 2 ** depth - 1,
    format: 'rgba8' | 'rgba16' = depth === 8 ? 'rgba8' : 'rgba16'
  const pixels = new Uint8Array(width * height * 4 * sampleBytes)
  let state = 0x2136fc79
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let channel = 0; channel < 4; channel++) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0
        const noise = ((state >>> 24) - 128) / (((x >>> 6) + (y >>> 4)) & 1 ? 4 : 128)
        const tone = 127 + 80 * Math.sin(x / 9 + y / 13) + 20 * Math.cos(y / 5) + channel * 8
        const value =
          channel === 3
            ? (x + y) % 3 === 0
              ? 0
              : (x + y) % 3 === 1
                ? 2 ** (depth - 1)
                : maximum
            : Math.max(
                0,
                Math.min(
                  maximum,
                  Math.round(
                    (tone + noise) * (depth === 8 ? 1 : 211) +
                      (depth === 8 ? 0 : (x * 37 + y * 139 + channel * 211) % 257),
                  ),
                ),
              )
        const offset = ((y * width + x) * 4 + channel) * sampleBytes
        if (sampleBytes === 2) pixels[offset] = value >>> 8
        pixels[offset + sampleBytes - 1] = value
      }
    }
  }
  return { depth, width, height, format, pixels }
}

export const paletteLosslessFixture = (): ReturnType<typeof learnedLosslessFixture> => {
  const width = 1024,
    height = 385
  const pixels = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const tone =
        y === 0
          ? (x * 73) % 251
          : Math.max(
              0,
              Math.min(
                250,
                Math.round(120 + 96 * Math.sin(x / 31 + y / 19) + 25 * Math.cos((x - y) / 17)),
              ),
            )
      const offset = (y * width + x) * 4
      pixels[offset] = tone
      pixels[offset + 1] = tone
      pixels[offset + 2] = tone
      pixels[offset + 3] = tone % 3 === 0 ? 0 : tone % 3 === 1 ? 128 : 255
    }
  }
  return { depth: 8, width, height, format: 'rgba8', pixels }
}

export const reversibleColorFixture = (
  depth: 8 | 16,
  primary: 0 | 1 | 2,
): ReturnType<typeof learnedLosslessFixture> => {
  const width = 1024,
    height = 65,
    sampleBytes = depth / 8,
    maximum = 2 ** depth - 1,
    format = depth === 8 ? 'rgba8' : 'rgba16'
  const pixels = new Uint8Array(width * height * 4 * sampleBytes)
  let state = 0x458bae91
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0
      const base = 80 + ((state >>> 24) & 63)
      for (let channel = 0; channel < 4; channel++) {
        const tone =
          channel === primary
            ? base
            : base + Math.round(24 * Math.sin(x / (9 + channel) + y / 7 + channel * 2))
        const sample =
          channel === 3
            ? (x + y) % 3 === 0
              ? 0
              : (x + y) % 3 === 1
                ? 2 ** (depth - 1)
                : maximum
            : tone * (depth === 8 ? 1 : 257) + (depth === 8 ? 0 : (x + y + channel) % 3)
        const offset = ((y * width + x) * 4 + channel) * sampleBytes
        if (sampleBytes === 2) pixels[offset] = sample >>> 8
        pixels[offset + sampleBytes - 1] = sample
      }
    }
  }
  return { depth, width, height, format, pixels }
}

export const encodeLearnedLosslessFixture = async (
  fixture: ReturnType<typeof learnedLosslessFixture>,
  effort: 5 | 7 = 7,
  maxWorkingBytes?: number,
) => {
  const sink = new Uint8ArraySink()
  const encoder = await createJpegXlModularEncoder(sink, {
    width: fixture.width,
    height: fixture.height,
    pixelFormat: fixture.format,
    colorSemantics: {
      family: 'rgb',
      primaries: 'srgb',
      transfer: { kind: 'srgb' },
      matrix: 'identity',
      range: 'full',
      alpha: 'straight',
      provenance: 'assumed-default',
      renderingIntent: 'relative',
    },
    options: {
      mode: 'lossless',
      effort,
      ...(maxWorkingBytes === undefined ? {} : { maxWorkingBytes }),
    },
  })
  await encoder.write({
    x: 0,
    y: 0,
    width: fixture.width,
    height: fixture.height,
    stride: fixture.width * 4 * (fixture.depth / 8),
    format: fixture.format,
    data: fixture.pixels,
  })
  await encoder.finish()
  if (
    !('groupSearchEvidence' in encoder) ||
    !Array.isArray(encoder.groupSearchEvidence) ||
    !('managedPeakBytes' in encoder) ||
    typeof encoder.managedPeakBytes !== 'number' ||
    !('managedLiveBytes' in encoder) ||
    typeof encoder.managedLiveBytes !== 'number'
  )
    throw new Error('Missing learned encoder diagnostics')
  const groups: readonly unknown[] = encoder.groupSearchEvidence
  const models: string[] = []
  for (const group of groups) {
    if (
      typeof group !== 'object' ||
      group === null ||
      !('contextModel' in group) ||
      typeof group.contextModel !== 'string'
    )
      throw new Error('Invalid learned group diagnostics')
    models.push(group.contextModel)
  }
  return {
    encoded: sink.toUint8Array(),
    groups,
    models,
    ownedPeak: encoder.managedPeakBytes,
    ownedLive: encoder.managedLiveBytes,
  }
}

export const verifyLearnedLosslessSamples = async (
  fixture: ReturnType<typeof learnedLosslessFixture>,
  encoded: Uint8Array,
) => {
  const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(encoded), defaultImageLimits)
  if (!decoder) throw new Error('Missing JPEG XL decoder')
  const rowBytes = fixture.width * 4 * (fixture.depth / 8)
  let rows = 0
  for await (const block of decoder.decode()) {
    try {
      if (block.format !== fixture.format) throw new Error('Learned sample format changed')
      for (let y = 0; y < block.height; y++) {
        for (let byte = 0; byte < rowBytes; byte++)
          if (
            block.data[y * block.stride + byte] !== fixture.pixels[(block.y + y) * rowBytes + byte]
          )
            throw new Error(`Learned sample changed at row ${block.y + y}, byte ${byte}`)
        rows++
      }
    } finally {
      block.release?.()
    }
  }
  if (rows !== fixture.height) throw new Error('Learned output rows are incomplete')
}

export const verifyReversibleLosslessColor = async (depth: 8 | 16, primary: 0 | 1 | 2) => {
  const fixture = reversibleColorFixture(depth, primary)
  const original = Uint8Array.from(fixture.pixels)
  const result = await encodeLearnedLosslessFixture(fixture)
  const reference = await encodeLearnedLosslessFixture(fixture, 5)
  if (result.encoded.length >= reference.encoded.length)
    throw new Error('Reversible color search did not improve correlated channels')
  if (result.ownedLive !== 0) throw new Error('Reversible color storage did not unwind')
  await verifyLearnedLosslessSamples(fixture, result.encoded)
  for (let byte = 0; byte < original.length; byte++)
    if (original[byte] !== fixture.pixels[byte]) throw new Error('Encoder modified color input')
  let checksum = 0x811c9dc5
  for (const byte of result.encoded) checksum = Math.imul(checksum ^ byte, 0x01000193) >>> 0
  return {
    depth,
    primary,
    bytes: result.encoded.length,
    referenceBytes: reference.encoded.length,
    checksum,
    samples: fixture.pixels.length,
    ownedLive: result.ownedLive,
  }
}

export const verifyLearnedLosslessFixture = async (depth: 8 | 16, width: 1024 | 1025) => {
  const fixture = learnedLosslessFixture(depth, width)
  const result = await encodeLearnedLosslessFixture(fixture)
  const reference = await encodeLearnedLosslessFixture(fixture, 5)
  if (result.encoded.length >= reference.encoded.length)
    throw new Error('Learned prediction did not improve this mixed-texture fixture')
  if (width === 1025 && !result.models.includes('learned'))
    throw new Error('Mixed-texture fixture did not exercise learned contexts')
  if (result.ownedLive !== 0) throw new Error('Learned encoder storage did not unwind')
  await verifyLearnedLosslessSamples(fixture, result.encoded)
  let checksum = 0x811c9dc5
  for (const byte of result.encoded) checksum = Math.imul(checksum ^ byte, 0x01000193) >>> 0
  return {
    depth,
    width,
    bytes: result.encoded.length,
    referenceBytes: reference.encoded.length,
    checksum,
    samples: fixture.pixels.length,
    ownedLive: result.ownedLive,
  }
}
