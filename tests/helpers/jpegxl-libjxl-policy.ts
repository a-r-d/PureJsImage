import type { ImageCodec } from '../../src/codec.ts'
import { jpegxlCodec } from '../../src/codecs/jpegxl.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { Uint8ArraySink } from '../../src/sink.ts'
import { MemorySource } from '../../src/source.ts'

export const policyWidth = 200
export const policyHeight = 136

/** Opaque photo-like RGBA: smooth light, oriented texture and grain, well over 2,048 colors. */
export const createPolicyPhoto = (): Uint8Array => {
  const pixels = new Uint8Array(policyWidth * policyHeight * 4)
  let state = 0x2468ace1
  for (let y = 0; y < policyHeight; y++)
    for (let x = 0; x < policyWidth; x++) {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
      const grain = ((state >>> 24) - 128) / 16
      const light = 90 + 70 * Math.sin(x / 37) * Math.cos(y / 29)
      const texture = 30 * Math.sin((x + 2 * y) / 3.1) * Math.sin(y / 11)
      const at = (y * policyWidth + x) * 4
      pixels[at] = Math.max(0, Math.min(255, Math.round(light + texture + grain + 25)))
      pixels[at + 1] = Math.max(0, Math.min(255, Math.round(light + 0.6 * texture + grain)))
      pixels[at + 2] = Math.max(0, Math.min(255, Math.round(light - 0.4 * texture + grain - 20)))
      pixels[at + 3] = 255
    }
  return pixels
}

/** Opaque flat artwork with eight colors. */
export const createPolicyArtwork = (): Uint8Array => {
  const pixels = new Uint8Array(policyWidth * policyHeight * 4)
  for (let y = 0; y < policyHeight; y++)
    for (let x = 0; x < policyWidth; x++) {
      const index = (Math.floor(x / 25) + Math.floor(y / 17)) & 7
      const at = (y * policyWidth + x) * 4
      pixels[at] = index & 1 ? 230 : 20
      pixels[at + 1] = index & 2 ? 200 : 40
      pixels[at + 2] = index & 4 ? 180 : 60
      pixels[at + 3] = 255
    }
  return pixels
}

const checksum = (bytes: Uint8Array): number => {
  let hash = 0x811c9dc5
  for (const value of bytes) hash = Math.imul(hash ^ value, 0x01000193) >>> 0
  return hash
}

export interface PolicyEncodeResult {
  readonly bytes: number
  readonly encodedChecksum: number
  readonly decodedChecksum: number
  readonly meanColorError: number
  readonly maxColorError: number
  readonly alphaError: number
  readonly managedLiveBytes: number
}

/** Encode RGBA8 sRGB input at effort 7, decode it with PureJsImage and measure color error. */
export const encodePolicyImage = async (
  pixels: Uint8Array,
  distance: number,
  codec: ImageCodec = jpegxlCodec,
  maxWorkingBytes?: number,
): Promise<PolicyEncodeResult> => {
  const sink = new Uint8ArraySink()
  const encoder = await codec.createEncoder?.(sink, {
    width: policyWidth,
    height: policyHeight,
    pixelFormat: 'rgba8',
    limits: defaultImageLimits,
    options: {
      mode: 'lossy',
      effort: 7,
      distance,
      ...(maxWorkingBytes === undefined ? {} : { maxWorkingBytes }),
    },
    colorSemantics: {
      family: 'rgb',
      primaries: 'srgb',
      transfer: { kind: 'srgb' },
      matrix: 'identity',
      range: 'full',
      alpha: 'straight',
      provenance: 'container-signaled',
      renderingIntent: 'relative',
    },
  })
  if (!encoder) throw new Error('JPEG XL encoder is unavailable')
  await encoder.write({
    x: 0,
    y: 0,
    width: policyWidth,
    height: policyHeight,
    stride: policyWidth * 4,
    format: 'rgba8',
    data: pixels,
  })
  await encoder.finish()
  const managedLiveBytes =
    'managedLiveBytes' in encoder && typeof encoder.managedLiveBytes === 'number'
      ? encoder.managedLiveBytes
      : -1
  const encoded = sink.toUint8Array()
  const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(encoded), defaultImageLimits)
  if (
    decoder?.pixelFormat !== 'rgba8' ||
    decoder.width !== policyWidth ||
    decoder.height !== policyHeight
  )
    throw new Error('JPEG XL RGBA decoder is unavailable')
  const decoded = new Uint8Array(pixels.length)
  for await (const block of decoder.decode()) {
    try {
      if (block.format !== 'rgba8') throw new Error('Unexpected decoded block format')
      for (let y = 0; y < block.height; y++)
        decoded.set(
          block.data.subarray(y * block.stride, y * block.stride + block.width * 4),
          ((block.y + y) * policyWidth + block.x) * 4,
        )
    } finally {
      block.release?.()
    }
  }
  let total = 0,
    maxColorError = 0,
    alphaError = 0
  for (let at = 0; at < pixels.length; at++) {
    const error = Math.abs((decoded[at] ?? 0) - (pixels[at] ?? 0))
    if ((at & 3) === 3) alphaError = Math.max(alphaError, error)
    else {
      total += error
      maxColorError = Math.max(maxColorError, error)
    }
  }
  return {
    bytes: encoded.length,
    encodedChecksum: checksum(encoded),
    decodedChecksum: checksum(decoded),
    meanColorError: total / (policyWidth * policyHeight * 3),
    maxColorError,
    alphaError,
    managedLiveBytes,
  }
}

/** Browser entry: the photo encoded by the public encoder at a distance. */
export const verifyPolicyPhoto = (distance: number): Promise<PolicyEncodeResult> =>
  encodePolicyImage(createPolicyPhoto(), distance)
