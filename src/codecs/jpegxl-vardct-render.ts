import { invalidInput, limitExceeded, unsupportedOperation } from '../errors.ts'
import type { ImageLimits } from '../limits.ts'
import { linearToSrgb } from './icc.ts'
import type { JpegXlFrameStructure } from './jpegxl-decode.ts'
import {
  decodeJpegXlJpegAcGroup,
  decodeJpegXlJpegDcGroup,
  decodeJpegXlJpegHfGlobal,
  decodeJpegXlJpegLfGlobal,
  type JpegXlJpegColorCorrelation,
} from './jpegxl-vardct-jpeg.ts'

export interface JpegXlVarDctPixels {
  readonly width: number
  readonly height: number
  readonly format: 'gray8' | 'rgb8'
  readonly data: Uint8Array
}

const defaultDistanceBands = Object.freeze([
  Object.freeze([3150, 0, -0.4, -0.4, -0.4, -2]),
  Object.freeze([560, 0, -0.3, -0.3, -0.3, -0.3]),
  Object.freeze([512, -2, -1, 0, -1, -2]),
])

const defaultQuantBiases = Object.freeze([
  0.945349926692846,
  0.9299455010825141,
  0.9500648966626563,
])

const inverseOpsinMatrix = Object.freeze([
  11.031566901960783,
  -9.866943921568629,
  -0.16462299647058826,
  -3.254147380392157,
  4.418770392156863,
  -0.16462299647058826,
  -3.6588512862745097,
  2.7129230470588235,
  1.9459282392156863,
])

const opsinBias = 0.0037930732552754493
const opsinBiasCubeRoot = Math.cbrt(opsinBias)

const makeDefaultDct8Dequantization = (): readonly Float64Array[] =>
  Object.freeze(
    defaultDistanceBands.map((parameters) => {
      const bands = [parameters[0] ?? 1]
      for (let index = 1; index < parameters.length; index += 1) {
        const value = parameters[index] ?? 0
        const multiplier = value > 0 ? 1 + value : 1 / (1 - value)
        bands.push((bands[index - 1] ?? 1) * multiplier)
      }
      const output = new Float64Array(64)
      const scale = 5 / (Math.SQRT2 + 1e-6)
      for (let y = 0; y < 8; y += 1) {
        for (let x = 0; x < 8; x += 1) {
          const distance = Math.hypot((x * scale) / 7, (y * scale) / 7)
          const low = Math.min(4, Math.floor(distance))
          const fraction = Math.min(1, distance - low)
          const first = bands[low] ?? 1
          const second = bands[low + 1] ?? first
          output[y * 8 + x] = 1 / (first * (second / first) ** fraction)
        }
      }
      return output
    }),
  )

const defaultDct8Dequantization = makeDefaultDct8Dequantization()

const dctBasis = Float64Array.from({ length: 64 }, (_, index) => {
  const frequency = Math.floor(index / 8)
  const position = index & 7
  return (
    0.5 *
    (frequency === 0 ? Math.SQRT1_2 : 1) *
    Math.cos(((2 * position + 1) * frequency * Math.PI) / 16)
  )
})

const adjustQuantizationBias = (value: number, channel: number): number => {
  const absolute = Math.abs(value)
  if (absolute === 0) return 0
  if (absolute === 1) {
    return Math.sign(value) * (defaultQuantBiases[channel] ?? 1)
  }
  return value - 0.145 / value
}

const correlationRatio = (
  correlation: Readonly<JpegXlJpegColorCorrelation>,
  channel: 0 | 2,
  local: number,
): number =>
  (channel === 0 ? correlation.baseCorrelationX : correlation.baseCorrelationB) +
  local / correlation.colorFactor

const dcCorrelationRatio = (
  correlation: Readonly<JpegXlJpegColorCorrelation>,
  channel: 0 | 2,
): number =>
  correlationRatio(
    correlation,
    channel,
    channel === 0 ? correlation.yToXDc : correlation.yToBDc,
  )

const inverseDct8 = (
  coefficients: Float64Array,
  destination: Float32Array,
  destinationWidth: number,
  destinationX: number,
  destinationY: number,
): void => {
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      let sample = 0
      for (let vertical = 0; vertical < 8; vertical += 1) {
        const verticalBasis = dctBasis[vertical * 8 + y] ?? 0
        for (let horizontal = 0; horizontal < 8; horizontal += 1) {
          sample +=
            (coefficients[vertical * 8 + horizontal] ?? 0) *
            (dctBasis[horizontal * 8 + x] ?? 0) *
            verticalBasis
        }
      }
      // JPEG XL's scaled DCT convention makes a DC coefficient the block's sample value.
      destination[(destinationY + y) * destinationWidth + destinationX + x] = sample * 8
    }
  }
}

const byteFromLinear = (value: number): number =>
  Math.max(0, Math.min(255, Math.round(linearToSrgb(value) * 255)))

const writeRgb = (
  output: Uint8Array,
  offset: number,
  opsinX: number,
  opsinY: number,
  opsinB: number,
): void => {
  const gammaRed = opsinY + opsinX + opsinBiasCubeRoot
  const gammaGreen = opsinY - opsinX + opsinBiasCubeRoot
  const gammaBlue = opsinB + opsinBiasCubeRoot
  const mixedRed = gammaRed * gammaRed * gammaRed - opsinBias
  const mixedGreen = gammaGreen * gammaGreen * gammaGreen - opsinBias
  const mixedBlue = gammaBlue * gammaBlue * gammaBlue - opsinBias
  output[offset] = byteFromLinear(
    (inverseOpsinMatrix[0] ?? 0) * mixedRed +
      (inverseOpsinMatrix[1] ?? 0) * mixedGreen +
      (inverseOpsinMatrix[2] ?? 0) * mixedBlue,
  )
  output[offset + 1] = byteFromLinear(
    (inverseOpsinMatrix[3] ?? 0) * mixedRed +
      (inverseOpsinMatrix[4] ?? 0) * mixedGreen +
      (inverseOpsinMatrix[5] ?? 0) * mixedBlue,
  )
  output[offset + 2] = byteFromLinear(
    (inverseOpsinMatrix[6] ?? 0) * mixedRed +
      (inverseOpsinMatrix[7] ?? 0) * mixedGreen +
      (inverseOpsinMatrix[8] ?? 0) * mixedBlue,
  )
}

export const decodeJpegXlDct8Section = (
  section: Uint8Array,
  frame: Readonly<JpegXlFrameStructure>,
  limits: Readonly<ImageLimits>,
): JpegXlVarDctPixels => {
  if (
    frame.encoding !== 'vardct' ||
    frame.colorTransform !== 'xyb' ||
    frame.bitDepth !== 8 ||
    frame.alphaBitDepth !== undefined ||
    frame.passCount !== 1 ||
    frame.groupsAcross !== 1 ||
    frame.groupsDown !== 1 ||
    frame.dcGroupCount !== 1 ||
    frame.sections.length !== 1
  ) {
    throw unsupportedOperation(
      'Common VarDCT decode currently requires one single-pass 8-bit XYB group without alpha',
    )
  }
  if (frame.gaborish || frame.epfIterations > 1) {
    throw unsupportedOperation(
      'Common VarDCT decode currently supports streams without Gaborish and with at most one EPF iteration',
    )
  }
  const blockWidth = Math.ceil(frame.width / 8)
  const blockHeight = Math.ceil(frame.height / 8)
  const paddedWidth = blockWidth * 8
  const paddedHeight = blockHeight * 8
  const planeBytes = BigInt(paddedWidth) * BigInt(paddedHeight) * 3n * 4n
  const outputChannels = frame.colorChannels === 1 ? 1 : 3
  const outputBytes = BigInt(frame.width) * BigInt(frame.height) * BigInt(outputChannels)
  if (planeBytes + outputBytes > BigInt(limits.maxDecodedBytes)) {
    throw limitExceeded(
      `JPEG XL VarDCT working data requires ${planeBytes + outputBytes} bytes; maxDecodedBytes is ${limits.maxDecodedBytes}`,
    )
  }

  const lfGlobal = decodeJpegXlJpegLfGlobal(section, 0, false)
  const dcGroup = decodeJpegXlJpegDcGroup(
    section,
    {
      blockWidth,
      blockHeight,
      chromaSubsampling: frame.chromaSubsampling,
      groupId: 0,
      dcGroupCount: 1,
    },
    lfGlobal.globalModularCode,
    lfGlobal.endingBitPosition,
    false,
  )
  const hfGlobal = decodeJpegXlJpegHfGlobal(
    section,
    { dcGroupCount: 1, groupCount: 1, passCount: 1 },
    lfGlobal,
    dcGroup.endingBitPosition,
    false,
  )
  if (hfGlobal.dct8Quantization !== undefined) {
    throw unsupportedOperation('Common VarDCT custom quantization tables are not supported yet')
  }
  const pass = hfGlobal.passes[0]
  if (!pass) throw invalidInput('JPEG XL VarDCT pass is missing')
  const acGroup = decodeJpegXlJpegAcGroup(
    section,
    {
      blockX: 0,
      blockY: 0,
      blockWidth,
      blockHeight,
      chromaSubsampling: frame.chromaSubsampling,
      histogramCount: hfGlobal.histogramCount,
      colorTransform: 'none',
    },
    lfGlobal,
    pass,
    dcGroup,
    hfGlobal.endingBitPosition,
  )

  const planes = [
    new Float32Array(paddedWidth * paddedHeight),
    new Float32Array(paddedWidth * paddedHeight),
    new Float32Array(paddedWidth * paddedHeight),
  ] as const
  const blockCoefficients = [new Float64Array(64), new Float64Array(64), new Float64Array(64)] as const
  const inverseGlobalScale = 65_536 / lfGlobal.globalScale
  const channelMultipliers = [
    (1 / 1.25) ** (frame.xQuantizationScale - 2),
    1,
    (1 / 1.25) ** (frame.bQuantizationScale - 2),
  ] as const
  const dcPlanes = [
    dcGroup.dcCoefficients[1],
    dcGroup.dcCoefficients[0],
    dcGroup.dcCoefficients[2],
  ] as const

  for (let blockY = 0; blockY < blockHeight; blockY += 1) {
    for (let blockX = 0; blockX < blockWidth; blockX += 1) {
      const blockIndex = blockY * blockWidth + blockX
      const coefficientBase = blockIndex * 64
      const quantization = dcGroup.quantization[blockIndex]
      if (quantization === undefined || quantization < 1) {
        throw invalidInput('JPEG XL VarDCT block quantization is invalid')
      }
      for (let channel = 0; channel < 3; channel += 1) {
        // The shared coefficient parser also exposes JPEG's row-major orientation.
        // The JPEG XL entropy layout is transposed relative to this scalar IDCT.
        const coefficients = acGroup.componentCoefficients[channel]
        const dc = dcPlanes[channel]
        const dequantization = defaultDct8Dequantization[channel]
        const values = blockCoefficients[channel]
        if (!coefficients || !dc || !dequantization || !values) {
          throw invalidInput('JPEG XL VarDCT channel data is missing')
        }
        const rawDc = dc[blockIndex]
        if (rawDc === undefined) throw invalidInput('JPEG XL VarDCT DC coefficient is missing')
        values[0] =
          rawDc *
          inverseGlobalScale *
          (lfGlobal.dcQuantization[channel] ?? 1) /
          lfGlobal.quantDc
        for (let position = 1; position < 64; position += 1) {
          values[position] =
            adjustQuantizationBias(coefficients[coefficientBase + position] ?? 0, channel) *
            inverseGlobalScale *
            (channelMultipliers[channel] ?? 1) *
            (dequantization[position] ?? 1) /
            quantization
        }
      }

      const colorTileWidth = Math.ceil(blockWidth / 8)
      const colorTileIndex = Math.floor(blockY / 8) * colorTileWidth + Math.floor(blockX / 8)
      const yValues = blockCoefficients[1]
      for (const channel of [0, 2] as const) {
        const values = blockCoefficients[channel]
        const localMap =
          channel === 0 ? dcGroup.colorCorrelationX[colorTileIndex] : dcGroup.colorCorrelationB[colorTileIndex]
        if (localMap === undefined) {
          throw invalidInput('JPEG XL VarDCT color-correlation tile is missing')
        }
        values[0] =
          (values[0] ?? 0) +
          (yValues[0] ?? 0) * dcCorrelationRatio(lfGlobal.colorCorrelation, channel)
        const ratio = correlationRatio(lfGlobal.colorCorrelation, channel, localMap)
        for (let position = 1; position < 64; position += 1) {
          values[position] = (values[position] ?? 0) + (yValues[position] ?? 0) * ratio
        }
      }
      for (let channel = 0; channel < 3; channel += 1) {
        const values = blockCoefficients[channel]
        const plane = planes[channel]
        if (!values || !plane) throw invalidInput('JPEG XL VarDCT render plane is missing')
        inverseDct8(values, plane, paddedWidth, blockX * 8, blockY * 8)
      }
    }
  }

  const format = frame.colorChannels === 1 ? 'gray8' : 'rgb8'
  const output = new Uint8Array(frame.width * frame.height * outputChannels)
  const rgb = new Uint8Array(3)
  for (let y = 0; y < frame.height; y += 1) {
    for (let x = 0; x < frame.width; x += 1) {
      const planeIndex = y * paddedWidth + x
      writeRgb(
        rgb,
        0,
        planes[0][planeIndex] ?? 0,
        planes[1][planeIndex] ?? 0,
        planes[2][planeIndex] ?? 0,
      )
      const outputIndex = (y * frame.width + x) * outputChannels
      if (format === 'gray8') output[outputIndex] = rgb[0] ?? 0
      else output.set(rgb, outputIndex)
    }
  }
  return Object.freeze({ width: frame.width, height: frame.height, format, data: output })
}
