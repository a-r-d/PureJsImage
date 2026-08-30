import type { PixelTransferFunction } from '../color.ts'
import { invalidInput } from '../errors.ts'
import { gainMapHeadroomWeight } from '../gain-map-math.ts'
import type { GainMapMetadata, GainMapTriplet } from './model.ts'

export { gainMapHeadroomWeight } from '../gain-map-math.ts'

export interface GainMapRenderOptions {
  readonly displayBoost: number
}

export const gainMapDisplayWeight = (metadata: GainMapMetadata, displayBoost: number): number => {
  return metadata.baseRendition === 'hdr'
    ? gainMapHeadroomWeight(metadata.capacityMaximum, metadata.capacityMinimum, displayBoost)
    : gainMapHeadroomWeight(metadata.capacityMinimum, metadata.capacityMaximum, displayBoost)
}

const srgbToLinear = (value: number): number =>
  value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4

const pqToLinear = (value: number): number => {
  const m1 = 2610 / 16_384
  const m2 = 2523 / 32
  const c1 = 3424 / 4096
  const c2 = 2413 / 128
  const c3 = 2392 / 128
  const signal = Math.max(value, 0) ** (1 / m2)
  const numerator = Math.max(signal - c1, 0)
  const denominator = c2 - c3 * signal
  return denominator <= 0 ? 10_000 / 203 : ((numerator / denominator) ** (1 / m1) * 10_000) / 203
}

const hlgToLinear = (value: number): number =>
  value <= 0.5
    ? (value * value) / 3
    : (Math.exp((value - 0.559_910_73) / 0.178_832_77) + 0.284_668_92) / 12

export const decodeTransfer = (value: number, transfer: PixelTransferFunction): number => {
  if (!Number.isFinite(value)) throw invalidInput('Encoded base sample must be finite')
  if (transfer.kind === 'linear') return value
  if (transfer.kind === 'srgb') return srgbToLinear(value)
  if (transfer.kind === 'pq') return pqToLinear(value)
  if (transfer.kind === 'hlg') return hlgToLinear(value)
  if (transfer.kind === 'gamma') return Math.max(0, value) ** transfer.exponent
  throw invalidInput('Gain-map rendering requires a known base transfer function')
}

interface ResolvedGainMapMath {
  readonly weight: number
  readonly gammaInverse: GainMapTriplet
  readonly baseOffset: GainMapTriplet
  readonly alternateOffset: GainMapTriplet
}

const resolveMath = (metadata: GainMapMetadata, displayBoost: number): ResolvedGainMapMath => {
  const gammaInverse: GainMapTriplet = Object.freeze([
    1 / metadata.gamma[0],
    1 / metadata.gamma[1],
    1 / metadata.gamma[2],
  ])
  return Object.freeze({
    weight: gainMapDisplayWeight(metadata, displayBoost),
    gammaInverse,
    baseOffset: metadata.baseRendition === 'hdr' ? metadata.offsetHdr : metadata.offsetSdr,
    alternateOffset: metadata.baseRendition === 'hdr' ? metadata.offsetSdr : metadata.offsetHdr,
  })
}

const composeChannel = (
  baseLinear: number,
  encodedGain: number,
  channel: number,
  metadata: GainMapMetadata,
  math: ResolvedGainMapMath,
): number => {
  const recovery = encodedGain / 255
  const logRecovery = recovery ** (math.gammaInverse[channel] ?? 1)
  const minimum = metadata.minimum[channel] ?? 0
  const logBoost =
    minimum * (1 - logRecovery) + (metadata.maximum[channel] ?? minimum) * logRecovery
  const output =
    (baseLinear + (math.baseOffset[channel] ?? 0)) * 2 ** (logBoost * math.weight) -
    (math.alternateOffset[channel] ?? 0)
  if (!Number.isFinite(output)) throw invalidInput('Gain-map rendering produced a non-finite value')
  return Math.max(0, output)
}

const validateBuffers = (
  baseLinear: Float32Array,
  gain: Uint8Array,
  output: Float32Array,
  baseChannels: 3 | 4,
  gainChannels: 1 | 3,
): number => {
  if (baseLinear.length % baseChannels !== 0) {
    throw invalidInput('Base linear pixels do not contain complete pixels')
  }
  const pixels = baseLinear.length / baseChannels
  if (gain.length !== pixels * gainChannels) {
    throw invalidInput('Gain-map samples do not align with base pixels')
  }
  if (output.length !== baseLinear.length) {
    throw invalidInput('Gain-map output does not align with base pixels')
  }
  return pixels
}

const composeScalar = (
  baseLinear: Float32Array,
  gain: Uint8Array,
  output: Float32Array,
  metadata: GainMapMetadata,
  math: ResolvedGainMapMath,
  baseChannels: 3 | 4,
): void => {
  const pixels = validateBuffers(baseLinear, gain, output, baseChannels, 1)
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const baseOffset = pixel * baseChannels
    const encodedGain = gain[pixel] ?? 0
    output[baseOffset] = composeChannel(baseLinear[baseOffset] ?? 0, encodedGain, 0, metadata, math)
    output[baseOffset + 1] = composeChannel(
      baseLinear[baseOffset + 1] ?? 0,
      encodedGain,
      1,
      metadata,
      math,
    )
    output[baseOffset + 2] = composeChannel(
      baseLinear[baseOffset + 2] ?? 0,
      encodedGain,
      2,
      metadata,
      math,
    )
    if (baseChannels === 4) output[baseOffset + 3] = baseLinear[baseOffset + 3] ?? 0
  }
}

const composeRgb = (
  baseLinear: Float32Array,
  gain: Uint8Array,
  output: Float32Array,
  metadata: GainMapMetadata,
  math: ResolvedGainMapMath,
  baseChannels: 3 | 4,
): void => {
  const pixels = validateBuffers(baseLinear, gain, output, baseChannels, 3)
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const baseOffset = pixel * baseChannels
    const gainOffset = pixel * 3
    output[baseOffset] = composeChannel(
      baseLinear[baseOffset] ?? 0,
      gain[gainOffset] ?? 0,
      0,
      metadata,
      math,
    )
    output[baseOffset + 1] = composeChannel(
      baseLinear[baseOffset + 1] ?? 0,
      gain[gainOffset + 1] ?? 0,
      1,
      metadata,
      math,
    )
    output[baseOffset + 2] = composeChannel(
      baseLinear[baseOffset + 2] ?? 0,
      gain[gainOffset + 2] ?? 0,
      2,
      metadata,
      math,
    )
    if (baseChannels === 4) output[baseOffset + 3] = baseLinear[baseOffset + 3] ?? 0
  }
}

export const composeGainMapLinearF32 = (
  baseLinear: Float32Array,
  gain: Uint8Array,
  metadata: GainMapMetadata,
  options: Readonly<GainMapRenderOptions>,
  baseChannels: 3 | 4 = 3,
  output = new Float32Array(baseLinear.length),
): Float32Array => {
  if (metadata.channelCount !== 1 && metadata.channelCount !== 3) {
    throw invalidInput('Gain-map rendering supports one or three channels')
  }
  const math = resolveMath(metadata, options.displayBoost)
  if (metadata.channelCount === 1) {
    composeScalar(baseLinear, gain, output, metadata, math, baseChannels)
  } else {
    composeRgb(baseLinear, gain, output, metadata, math, baseChannels)
  }
  return output
}

export const decodeBaseRgb8ToLinearF32 = (
  base: Uint8Array,
  metadata: GainMapMetadata,
  channels: 3 | 4 = 3,
): Float32Array => {
  if (base.length % channels !== 0) throw invalidInput('Base pixels do not contain complete pixels')
  const output = new Float32Array(base.length)
  const transfer = metadata.baseColor.transfer
  for (let offset = 0; offset < base.length; offset += channels) {
    output[offset] = decodeTransfer((base[offset] ?? 0) / 255, transfer)
    output[offset + 1] = decodeTransfer((base[offset + 1] ?? 0) / 255, transfer)
    output[offset + 2] = decodeTransfer((base[offset + 2] ?? 0) / 255, transfer)
    if (channels === 4) output[offset + 3] = (base[offset + 3] ?? 0) / 255
  }
  return output
}

export const gainMapLinearF32ToRgba16 = (
  input: Float32Array,
  channels: 3 | 4,
  linearMaximum: number,
): Uint8Array => {
  if (input.length % channels !== 0) throw invalidInput('Float HDR pixels are incomplete')
  if (!Number.isFinite(linearMaximum) || linearMaximum <= 0) {
    throw invalidInput('16-bit HDR linear maximum must be finite and positive')
  }
  const pixels = input.length / channels
  const output = new Uint8Array(pixels * 8)
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const inputOffset = pixel * channels
    const outputOffset = pixel * 8
    for (let channel = 0; channel < 3; channel += 1) {
      const value = Math.max(
        0,
        Math.min(
          65_535,
          Math.round(((input[inputOffset + channel] ?? 0) / linearMaximum) * 65_535),
        ),
      )
      output[outputOffset + channel * 2] = value >>> 8
      output[outputOffset + channel * 2 + 1] = value & 255
    }
    const alpha =
      channels === 4
        ? Math.max(0, Math.min(65_535, Math.round((input[inputOffset + 3] ?? 0) * 65_535)))
        : 65_535
    output[outputOffset + 6] = alpha >>> 8
    output[outputOffset + 7] = alpha & 255
  }
  return output
}
