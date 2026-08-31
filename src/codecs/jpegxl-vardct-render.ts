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
  0.945349926692846, 0.9299455010825141, 0.9500648966626563,
])

const inverseOpsinMatrix = Object.freeze([
  11.031566901960783, -9.866943921568629, -0.16462299647058826, -3.254147380392157,
  4.418770392156863, -0.16462299647058826, -3.6588512862745097, 2.7129230470588235,
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

const distanceWeights = (
  rows: number,
  columns: number,
  parameters: readonly number[],
): Float64Array => {
  const bands = [parameters[0] ?? 1]
  for (let index = 1; index < parameters.length; index += 1) {
    const value = parameters[index] ?? 0
    bands.push((bands[index - 1] ?? 1) * (value > 0 ? 1 + value : 1 / (1 - value)))
  }
  const output = new Float64Array(rows * columns)
  const scale = (parameters.length - 1) / (Math.SQRT2 + 1e-6)
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      const distance = Math.hypot(
        columns === 1 ? 0 : (x * scale) / (columns - 1),
        rows === 1 ? 0 : (y * scale) / (rows - 1),
      )
      const low = Math.min(parameters.length - 2, Math.floor(distance))
      const fraction = Math.min(1, distance - low)
      const first = bands[low] ?? 1
      const second = bands[low + 1] ?? first
      output[y * columns + x] = first * (second / first) ** fraction
    }
  }
  return output
}

const dct2Weights = Object.freeze([
  Object.freeze([3840, 2560, 1280, 640, 480, 300]),
  Object.freeze([960, 640, 320, 180, 140, 120]),
  Object.freeze([640, 320, 128, 64, 32, 16]),
])

const dct4x8Bands = Object.freeze([
  Object.freeze([
    2198.0505560163806, -0.9626962302074469, -0.7619425302666678, -0.6551140670773546,
  ]),
  Object.freeze([764.3655248643529, -0.9263020088836694, -0.9675229603596517, -0.2784529086916812]),
  Object.freeze([527.1075735875422, -1.4594385811273853, -1.4500820940978716, -1.5843722511996203]),
])

const dct4x4Bands = Object.freeze([
  Object.freeze([2200, 0, 0, 0]),
  Object.freeze([392, 0, 0, 0]),
  Object.freeze([112, -0.25, -0.25, -0.5]),
])

const dct32Bands = Object.freeze([
  Object.freeze([
    15718.408309825189, -1.025, -0.98, -0.9012, -0.4, -0.48819395464, -0.421064, -0.27,
  ]),
  Object.freeze([
    7305.763681069598, -0.8041958212306402, -0.7633036457487539, -0.5566037999011146,
    -0.49785304658857626, -0.43699592683512467, -0.4018086652624211, -0.27321683125358037,
  ]),
  Object.freeze([
    3803.5317372121503, -3.060733579805728, -2.0413270132490346, -2.023565015972742,
    -0.5495389509954993, -0.4, -0.4, -0.3,
  ]),
])

const dct8x16Bands = Object.freeze([
  Object.freeze([7240.7734393502, -0.7, -0.7, -0.2, -0.2, -0.2, -0.5]),
  Object.freeze([1448.15468787004, -0.5, -0.5, -0.5, -0.2, -0.2, -0.2]),
  Object.freeze([506.854140754517, -1.4, -0.2, -0.5, -0.5, -1.5, -3.6]),
])

const afvSpecialWeights = Object.freeze([
  Object.freeze([3072, 3072, 256, 256, 256, 414, 0, 0, 0]),
  Object.freeze([1024, 1024, 50, 50, 50, 58, 0, 0, 0]),
  Object.freeze([384, 384, 12, 12, 12, 22, -0.25, -0.25, -0.25]),
])

const afvFrequencies = Object.freeze([
  0, 0, 0.8517778890324296, 5.37778436506804, 0, 0, 4.734747904497923, 5.449245381693219,
  1.6598270267479331, 4, 7.275749096817861, 10.423227632456525, 2.662932286148962,
  7.630657783650829, 8.962388608184032, 12.97166202570235,
])

const afvBasis = Float64Array.from([
  0.25,
  0.25,
  0.25,
  0.25,
  0.25,
  0.25,
  0.25,
  0.25,
  0.25,
  0.25,
  0.25,
  0.25,
  0.25,
  0.25,
  0.25,
  0.25,
  0.876902929799142,
  0.2206518106944235,
  -0.10140050393753763,
  -0.1014005039375375,
  0.2206518106944236,
  -0.10140050393753777,
  -0.10140050393753772,
  -0.10140050393753763,
  -0.10140050393753758,
  -0.10140050393753769,
  -0.1014005039375375,
  -0.10140050393753768,
  -0.10140050393753768,
  -0.10140050393753759,
  -0.10140050393753763,
  -0.10140050393753741,
  0,
  0,
  0.40670075830260755,
  0.44444816619734445,
  0,
  0,
  0.19574399372042936,
  0.2929100136981264,
  -0.40670075830260716,
  -0.19574399372042872,
  0,
  0.11379074460448091,
  -0.44444816619734384,
  -0.29291001369812636,
  -0.1137907446044814,
  0,
  0,
  0,
  -0.21255748058288748,
  0.3085497062849767,
  0,
  0.4706702258572536,
  -0.1621205195722993,
  0,
  -0.21255748058287047,
  -0.16212051957228327,
  -0.47067022585725277,
  -0.1464291867126764,
  0.3085497062849487,
  0,
  -0.14642918671266536,
  0.4251149611657548,
  0,
  -0.7071067811865474,
  0,
  0,
  Math.SQRT1_2,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  -0.4105377591765233,
  0.6235485373547691,
  -0.06435071657946274,
  -0.06435071657946266,
  0.6235485373547694,
  -0.06435071657946284,
  -0.0643507165794628,
  -0.06435071657946274,
  -0.06435071657946272,
  -0.06435071657946279,
  -0.06435071657946266,
  -0.06435071657946277,
  -0.06435071657946277,
  -0.06435071657946273,
  -0.06435071657946274,
  -0.0643507165794626,
  0,
  0,
  -0.4517556589999482,
  0.15854503551840063,
  0,
  -0.04038515160822202,
  0.0074182263792423875,
  0.39351034269210167,
  -0.45175565899994635,
  0.007418226379244351,
  0.1107416575309343,
  0.08298163094882051,
  0.15854503551839705,
  0.3935103426921022,
  0.0829816309488214,
  -0.45175565899994796,
  0,
  0,
  -0.304684750724869,
  0.5112616136591823,
  0,
  0,
  -0.290480129728998,
  -0.06578701549142804,
  0.304684750724884,
  0.2904801297290076,
  0,
  -0.23889773523344604,
  -0.5112616136592012,
  0.06578701549142545,
  0.23889773523345467,
  0,
  0,
  0,
  0.3017929516615495,
  0.25792362796341184,
  0,
  0.16272340142866204,
  0.09520022653475037,
  0,
  0.3017929516615503,
  0.09520022653475055,
  -0.16272340142866173,
  -0.35312385449816297,
  0.25792362796341295,
  0,
  -0.3531238544981624,
  -0.6035859033230976,
  0,
  0,
  0.40824829046386274,
  0,
  0,
  0,
  0,
  -0.4082482904638628,
  -0.4082482904638635,
  0,
  0,
  -0.40824829046386296,
  0,
  0.4082482904638634,
  0.408248290463863,
  0,
  0,
  0,
  0.1747866975480809,
  0.0812611176717539,
  0,
  0,
  -0.3675398009862027,
  -0.307882213957909,
  -0.17478669754808135,
  0.3675398009862011,
  0,
  0.4826689115059883,
  -0.08126111767175039,
  0.30788221395790305,
  -0.48266891150598584,
  0,
  0,
  0,
  -0.21105601049335784,
  0.18567180916109802,
  0,
  0,
  0.49215859013738733,
  -0.38525013709251915,
  0.21105601049335806,
  -0.49215859013738905,
  0,
  0.17419412659916217,
  -0.18567180916109904,
  0.3852501370925211,
  -0.1741941265991621,
  0,
  0,
  0,
  -0.14266084808807264,
  -0.3416446842253372,
  0,
  0.7367497537172237,
  0.24627107722075148,
  -0.08574019035519306,
  -0.14266084808807344,
  0.24627107722075137,
  0.14883399227113567,
  -0.04768680350229251,
  -0.3416446842253373,
  -0.08574019035519267,
  -0.047686803502292804,
  -0.14266084808807242,
  0,
  0,
  -0.13813540350758585,
  0.3302282550303788,
  0,
  0.08755115000587084,
  -0.07946706605909573,
  -0.4613374887461511,
  -0.13813540350758294,
  -0.07946706605910261,
  0.49724647109535086,
  0.12538059448563663,
  0.3302282550303805,
  -0.4613374887461554,
  0.12538059448564315,
  -0.13813540350758452,
  0,
  0,
  -0.17437602599651067,
  0.0702790691196284,
  0,
  -0.2921026642334881,
  0.3623817333531167,
  0,
  -0.1743760259965108,
  0.36238173335311646,
  0.29210266423348785,
  -0.4326608024727445,
  0.07027906911962818,
  0,
  -0.4326608024727457,
  0.34875205199302267,
  0,
  0,
  0.11354987314994337,
  -0.07417504595810355,
  0,
  0.19402893032594343,
  -0.435190496523228,
  0.21918684838857466,
  0.11354987314994257,
  -0.4351904965232251,
  0.5550443808910661,
  -0.25468277124066463,
  -0.07417504595810233,
  0.2191868483885728,
  -0.25468277124066413,
  0.1135498731499429,
])

const interpolateBands = (position: number, maximum: number, bands: readonly number[]): number => {
  const scaled = (position * (bands.length - 1)) / maximum
  const low = Math.min(bands.length - 2, Math.floor(scaled))
  const first = bands[low] ?? 1
  const second = bands[low + 1] ?? first
  return first * (second / first) ** (scaled - low)
}

const makeStrategyDequantization = (): ReadonlyMap<number, readonly Float64Array[]> => {
  const output = new Map<number, readonly Float64Array[]>()
  output.set(0, defaultDct8Dequantization)
  const dct2 = dct2Weights.map((weights) => {
    const table = new Float64Array(64)
    table[0] = 1
    table[1] = table[8] = 1 / (weights[0] ?? 1)
    table[9] = 1 / (weights[1] ?? 1)
    for (let y = 0; y < 2; y += 1) {
      for (let x = 0; x < 2; x += 1) {
        table[y * 8 + x + 2] = 1 / (weights[2] ?? 1)
        table[(y + 2) * 8 + x] = 1 / (weights[2] ?? 1)
        table[(y + 2) * 8 + x + 2] = 1 / (weights[3] ?? 1)
      }
    }
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 4; x += 1) {
        table[y * 8 + x + 4] = 1 / (weights[4] ?? 1)
        table[(y + 4) * 8 + x] = 1 / (weights[4] ?? 1)
        table[(y + 4) * 8 + x + 4] = 1 / (weights[5] ?? 1)
      }
    }
    return table
  })
  output.set(2, Object.freeze(dct2))

  output.set(
    5,
    Object.freeze(
      dct32Bands.map((bands) =>
        Float64Array.from(distanceWeights(32, 32, bands), (weight) => 1 / weight),
      ),
    ),
  )
  const dct8x16 = Object.freeze(
    dct8x16Bands.map((bands) =>
      Float64Array.from(distanceWeights(8, 16, bands), (weight) => 1 / weight),
    ),
  )
  output.set(6, dct8x16)
  output.set(7, dct8x16)

  const dct4x8Weights = dct4x8Bands.map((bands) => distanceWeights(4, 8, bands))
  const dct4x8 = dct4x8Weights.map((weights) => {
    const table = new Float64Array(64)
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1)
        table[y * 8 + x] = 1 / (weights[Math.floor(y / 2) * 8 + x] ?? 1)
    }
    return table
  })
  output.set(13, Object.freeze(dct4x8))

  const dct4x4Weights = dct4x4Bands.map((bands) => distanceWeights(4, 4, bands))
  const afv = afvSpecialWeights.map((special, channel) => {
    const weights = new Float64Array(64)
    weights[0] = 1
    weights[8] = special[0] ?? 1
    weights[1] = special[1] ?? 1
    weights[16] = special[2] ?? 1
    weights[2] = special[3] ?? 1
    weights[18] = special[4] ?? 1
    const bands = [special[5] ?? 1]
    for (let index = 6; index < 9; index += 1) {
      const value = special[index] ?? 0
      bands.push((bands[index - 6] ?? 1) * (value > 0 ? 1 + value : 1 / (1 - value)))
    }
    const lowFrequency = afvFrequencies[2] ?? 0
    const span = (afvFrequencies[15] ?? 1) - lowFrequency + 1e-6
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 4; x += 1) {
        if (x < 2 && y < 2) continue
        weights[2 * y * 8 + 2 * x] = interpolateBands(
          (afvFrequencies[y * 4 + x] ?? 0) - lowFrequency,
          span,
          bands,
        )
      }
    }
    const weights4x8 = dct4x8Weights[channel]
    const weights4x4 = dct4x4Weights[channel]
    if (!weights4x8 || !weights4x4)
      throw invalidInput('JPEG XL AFV quantization channel is missing')
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        if (x !== 0 || y !== 0) weights[(2 * y + 1) * 8 + x] = weights4x8[y * 8 + x] ?? 1
      }
      for (let x = 0; x < 4; x += 1) {
        if (x !== 0 || y !== 0) weights[2 * y * 8 + 2 * x + 1] = weights4x4[y * 4 + x] ?? 1
      }
    }
    return Float64Array.from(weights, (weight) => 1 / weight)
  })
  const frozenAfv = Object.freeze(afv)
  for (const strategy of [14, 15, 16, 17]) output.set(strategy, frozenAfv)
  return output
}

const strategyDequantization = makeStrategyDequantization()

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
  correlationRatio(correlation, channel, channel === 0 ? correlation.yToXDc : correlation.yToBDc)

const applyAdaptiveDcSmoothing = (
  planes: readonly [Float64Array, Float64Array, Float64Array],
  width: number,
  height: number,
  dcFactors: readonly [number, number, number],
): void => {
  if (width <= 2 || height <= 2) return
  const sideWeight = 0.20345139757231578
  const cornerWeight = 0.0334829185968739
  const centerWeight = 1 - 4 * (sideWeight + cornerWeight)
  const smoothed = [planes[0].slice(), planes[1].slice(), planes[2].slice()] as const
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x
      const channelCenters = [0, 0, 0]
      const channelSmoothed = [0, 0, 0]
      let gap = 0.5
      for (let channel = 0; channel < 3; channel += 1) {
        const plane = planes[channel]
        const dcFactor = dcFactors[channel]
        if (!plane || dcFactor === undefined || dcFactor === 0) {
          throw invalidInput('JPEG XL adaptive DC smoothing metadata is invalid')
        }
        const center = plane[index] ?? 0
        const sides =
          (plane[index - 1] ?? 0) +
          (plane[index + 1] ?? 0) +
          (plane[index - width] ?? 0) +
          (plane[index + width] ?? 0)
        const corners =
          (plane[index - width - 1] ?? 0) +
          (plane[index - width + 1] ?? 0) +
          (plane[index + width - 1] ?? 0) +
          (plane[index + width + 1] ?? 0)
        const smooth = center * centerWeight + sides * sideWeight + corners * cornerWeight
        channelCenters[channel] = center
        channelSmoothed[channel] = smooth
        gap = Math.max(gap, Math.abs((center - smooth) / dcFactor))
      }
      const factor = Math.max(0, 3 - 4 * gap)
      for (let channel = 0; channel < 3; channel += 1) {
        const output = smoothed[channel]
        if (!output) throw invalidInput('JPEG XL adaptive DC smoothing plane is missing')
        const center = channelCenters[channel] ?? 0
        output[index] = center + ((channelSmoothed[channel] ?? 0) - center) * factor
      }
    }
  }
  for (let channel = 0; channel < 3; channel += 1) {
    const plane = planes[channel]
    const output = smoothed[channel]
    if (!plane || !output) throw invalidInput('JPEG XL adaptive DC smoothing plane is missing')
    plane.set(output)
  }
}

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

const inverseDct8Native = (
  coefficients: Float64Array,
  destination: Float32Array,
  destinationWidth: number,
  destinationX: number,
  destinationY: number,
): void => {
  const rowMajor = new Float64Array(64)
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) rowMajor[y * 8 + x] = coefficients[x * 8 + y] ?? 0
  }
  inverseDct8(rowMajor, destination, destinationWidth, destinationX, destinationY)
}

const inverseDctRectangle = (
  coefficients: Float64Array,
  outputWidth: number,
  outputHeight: number,
  destination: Float32Array,
  destinationWidth: number,
  destinationX: number,
  destinationY: number,
): void => {
  const scale = Math.sqrt(outputWidth * outputHeight)
  for (let y = 0; y < outputHeight; y += 1) {
    for (let x = 0; x < outputWidth; x += 1) {
      let sample = 0
      for (let vertical = 0; vertical < outputHeight; vertical += 1) {
        const verticalScale = vertical === 0 ? Math.SQRT1_2 : 1
        const verticalBasis =
          Math.sqrt(2 / outputHeight) *
          verticalScale *
          Math.cos(((2 * y + 1) * vertical * Math.PI) / (2 * outputHeight))
        for (let horizontal = 0; horizontal < outputWidth; horizontal += 1) {
          const horizontalScale = horizontal === 0 ? Math.SQRT1_2 : 1
          const horizontalBasis =
            Math.sqrt(2 / outputWidth) *
            horizontalScale *
            Math.cos(((2 * x + 1) * horizontal * Math.PI) / (2 * outputWidth))
          const coefficientIndex =
            outputHeight >= outputWidth
              ? horizontal * outputHeight + vertical
              : vertical * outputWidth + horizontal
          sample += (coefficients[coefficientIndex] ?? 0) * horizontalBasis * verticalBasis
        }
      }
      destination[(destinationY + y) * destinationWidth + destinationX + x] = sample * scale
    }
  }
}

const lowFrequencyResampleScales = Object.freeze({
  1: Object.freeze([1]),
  2: Object.freeze([1, 1.1089373535927318]),
  4: Object.freeze([1, 1.025760096781116, 1.1089373535927318, 1.2705593687654873]),
})

const forwardScaledDct = (samples: Float64Array, width: number, height: number): Float64Array => {
  const coefficients = new Float64Array(width * height)
  const areaScale = Math.sqrt(width * height)
  for (let vertical = 0; vertical < height; vertical += 1) {
    const verticalScale = vertical === 0 ? Math.SQRT1_2 : 1
    for (let horizontal = 0; horizontal < width; horizontal += 1) {
      const horizontalScale = horizontal === 0 ? Math.SQRT1_2 : 1
      let coefficient = 0
      for (let y = 0; y < height; y += 1) {
        const verticalBasis =
          Math.sqrt(2 / height) *
          verticalScale *
          Math.cos(((2 * y + 1) * vertical * Math.PI) / (2 * height))
        for (let x = 0; x < width; x += 1) {
          const horizontalBasis =
            Math.sqrt(2 / width) *
            horizontalScale *
            Math.cos(((2 * x + 1) * horizontal * Math.PI) / (2 * width))
          coefficient += (samples[y * width + x] ?? 0) * horizontalBasis * verticalBasis
        }
      }
      coefficients[vertical * width + horizontal] = coefficient / areaScale
    }
  }
  return coefficients
}

const populateLowestFrequencies = (
  values: Float64Array,
  dcSamples: Float64Array,
  blockWidth: number,
  blockHeight: number,
): void => {
  const lowFrequencies = forwardScaledDct(dcSamples, blockWidth, blockHeight)
  const horizontalScales =
    lowFrequencyResampleScales[blockWidth as keyof typeof lowFrequencyResampleScales]
  const verticalScales =
    lowFrequencyResampleScales[blockHeight as keyof typeof lowFrequencyResampleScales]
  if (!horizontalScales || !verticalScales) {
    throw unsupportedOperation('Common VarDCT low-frequency transform size is not supported yet')
  }
  const outputWidth = blockWidth * 8
  const outputHeight = blockHeight * 8
  for (let vertical = 0; vertical < blockHeight; vertical += 1) {
    for (let horizontal = 0; horizontal < blockWidth; horizontal += 1) {
      const nativeIndex =
        outputHeight >= outputWidth
          ? horizontal * outputHeight + vertical
          : vertical * outputWidth + horizontal
      values[nativeIndex] =
        (lowFrequencies[vertical * blockWidth + horizontal] ?? 0) *
        (horizontalScales[horizontal] ?? 1) *
        (verticalScales[vertical] ?? 1)
    }
  }
}

const inverseDct2TopBlock = (
  coefficients: Float64Array,
  destination: Float32Array,
  destinationWidth: number,
  destinationX: number,
  destinationY: number,
): void => {
  const values = coefficients.slice()
  for (const size of [2, 4, 8]) {
    const half = size / 2
    const output = values.slice()
    for (let y = 0; y < half; y += 1) {
      for (let x = 0; x < half; x += 1) {
        const c00 = values[y * 8 + x] ?? 0
        const c01 = values[y * 8 + half + x] ?? 0
        const c10 = values[(y + half) * 8 + x] ?? 0
        const c11 = values[(y + half) * 8 + half + x] ?? 0
        output[y * 2 * 8 + x * 2] = c00 + c01 + c10 + c11
        output[y * 2 * 8 + x * 2 + 1] = c00 + c01 - c10 - c11
        output[(y * 2 + 1) * 8 + x * 2] = c00 - c01 + c10 - c11
        output[(y * 2 + 1) * 8 + x * 2 + 1] = c00 - c01 - c10 + c11
      }
    }
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) values[y * 8 + x] = output[y * 8 + x] ?? 0
    }
  }
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      destination[(destinationY + y) * destinationWidth + destinationX + x] = values[y * 8 + x] ?? 0
    }
  }
}

const inverseDct8x4 = (
  coefficients: Float64Array,
  destination: Float32Array,
  destinationWidth: number,
  destinationX: number,
  destinationY: number,
): void => {
  const dc0 = coefficients[0] ?? 0
  const dc1 = coefficients[8] ?? 0
  for (let half = 0; half < 2; half += 1) {
    const block = new Float64Array(32)
    block[0] = half === 0 ? dc0 + dc1 : dc0 - dc1
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        if (x !== 0 || y !== 0) block[y * 8 + x] = coefficients[(half + y * 2) * 8 + x] ?? 0
      }
    }
    inverseDctRectangle(
      block,
      4,
      8,
      destination,
      destinationWidth,
      destinationX + half * 4,
      destinationY,
    )
  }
}

const inverseAfv = (
  coefficients: Float64Array,
  kind: number,
  destination: Float32Array,
  destinationWidth: number,
  destinationX: number,
  destinationY: number,
): void => {
  const afvX = kind & 1
  const afvY = kind >>> 1
  const block00 = coefficients[0] ?? 0
  const block01 = coefficients[1] ?? 0
  const block10 = coefficients[8] ?? 0
  const dc0 = (block00 + block10 + block01) * 4
  const dc1 = block00 + block10 - block01
  const dc2 = block00 - block10

  const afvCoefficients = new Float64Array(16)
  afvCoefficients[0] = dc0
  for (let y = 0; y < 4; y += 1) {
    for (let x = 0; x < 4; x += 1) {
      if (x !== 0 || y !== 0) afvCoefficients[y * 4 + x] = coefficients[y * 16 + x * 2] ?? 0
    }
  }
  const afvPixels = new Float64Array(16)
  for (let pixel = 0; pixel < 16; pixel += 1) {
    let value = 0
    for (let coefficient = 0; coefficient < 16; coefficient += 1) {
      value += (afvCoefficients[coefficient] ?? 0) * (afvBasis[coefficient * 16 + pixel] ?? 0)
    }
    afvPixels[pixel] = value
  }
  for (let y = 0; y < 4; y += 1) {
    for (let x = 0; x < 4; x += 1) {
      const sourceY = afvY === 1 ? 3 - y : y
      const sourceX = afvX === 1 ? 3 - x : x
      destination[(destinationY + afvY * 4 + y) * destinationWidth + destinationX + afvX * 4 + x] =
        afvPixels[sourceY * 4 + sourceX] ?? 0
    }
  }

  const dct4 = new Float64Array(16)
  dct4[0] = dc1
  for (let y = 0; y < 4; y += 1) {
    for (let x = 0; x < 4; x += 1) {
      if (x !== 0 || y !== 0) dct4[y * 4 + x] = coefficients[y * 16 + x * 2 + 1] ?? 0
    }
  }
  inverseDctRectangle(
    dct4,
    4,
    4,
    destination,
    destinationWidth,
    destinationX + (afvX === 1 ? 0 : 4),
    destinationY + afvY * 4,
  )

  const dct4x8 = new Float64Array(32)
  dct4x8[0] = dc2
  for (let y = 0; y < 4; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      if (x !== 0 || y !== 0) dct4x8[y * 8 + x] = coefficients[(y * 2 + 1) * 8 + x] ?? 0
    }
  }
  inverseDctRectangle(
    dct4x8,
    8,
    4,
    destination,
    destinationWidth,
    destinationX,
    destinationY + (afvY === 1 ? 0 : 4),
  )
}

const applyDefaultGaborish = (
  planes: readonly Float32Array[],
  stride: number,
  width: number,
  height: number,
): void => {
  const adjacent = 1.1 * 0.104699568
  const diagonal = 1.1 * 0.055680538
  const normalization = 1 / (1 + 4 * (adjacent + diagonal))
  const centerWeight = normalization
  const adjacentWeight = adjacent * normalization
  const diagonalWeight = diagonal * normalization
  const scratch = new Float32Array(width * height)
  for (const plane of planes) {
    for (let y = 0; y < height; y += 1) {
      const top = y === 0 ? 0 : y - 1
      const bottom = y === height - 1 ? height - 1 : y + 1
      for (let x = 0; x < width; x += 1) {
        const left = x === 0 ? 0 : x - 1
        const right = x === width - 1 ? width - 1 : x + 1
        scratch[y * width + x] =
          (plane[y * stride + x] ?? 0) * centerWeight +
          ((plane[y * stride + left] ?? 0) +
            (plane[y * stride + right] ?? 0) +
            (plane[top * stride + x] ?? 0) +
            (plane[bottom * stride + x] ?? 0)) *
            adjacentWeight +
          ((plane[top * stride + left] ?? 0) +
            (plane[top * stride + right] ?? 0) +
            (plane[bottom * stride + left] ?? 0) +
            (plane[bottom * stride + right] ?? 0)) *
            diagonalWeight
      }
    }
    for (let y = 0; y < height; y += 1) {
      plane.set(scratch.subarray(y * width, (y + 1) * width), y * stride)
    }
  }
}

const mirroredIndex = (index: number, size: number): number => {
  if (size === 1) return 0
  let mirrored = index
  while (mirrored < 0 || mirrored >= size) {
    if (mirrored < 0) mirrored = -mirrored - 1
    else mirrored = 2 * size - mirrored - 1
  }
  return mirrored
}

const epfSample = (
  plane: Float32Array,
  stride: number,
  width: number,
  height: number,
  x: number,
  y: number,
): number => plane[mirroredIndex(y, height) * stride + mirroredIndex(x, width)] ?? 0

const epfCandidateOffsets = Object.freeze({
  0: Object.freeze([
    Object.freeze([-2, 0]),
    Object.freeze([-1, -1]),
    Object.freeze([-1, 0]),
    Object.freeze([-1, 1]),
    Object.freeze([0, -2]),
    Object.freeze([0, -1]),
    Object.freeze([0, 1]),
    Object.freeze([0, 2]),
    Object.freeze([1, -1]),
    Object.freeze([1, 0]),
    Object.freeze([1, 1]),
    Object.freeze([2, 0]),
  ]),
  1: Object.freeze([
    Object.freeze([-1, 0]),
    Object.freeze([0, -1]),
    Object.freeze([0, 1]),
    Object.freeze([1, 0]),
  ]),
  2: Object.freeze([
    Object.freeze([-1, 0]),
    Object.freeze([0, -1]),
    Object.freeze([0, 1]),
    Object.freeze([1, 0]),
  ]),
})

const epfPatchOffsets = Object.freeze([
  Object.freeze([0, 0]),
  Object.freeze([-1, 0]),
  Object.freeze([0, -1]),
  Object.freeze([1, 0]),
  Object.freeze([0, 1]),
])

const applyDefaultEpfStage = (
  planes: readonly [Float32Array, Float32Array, Float32Array],
  stride: number,
  width: number,
  height: number,
  blockWidth: number,
  quantization: Int32Array<ArrayBufferLike>,
  sharpness: Int32Array<ArrayBufferLike>,
  globalScale: number,
  stage: 0 | 1 | 2,
): void => {
  const offsets = epfCandidateOffsets[stage]
  const channelScales = [40, 5, 3.5] as const
  const stageScale = (stage === 0 ? 0.9 : stage === 1 ? 1 : 6.5) * 1.65
  const output = [
    new Float32Array(width * height),
    new Float32Array(width * height),
    new Float32Array(width * height),
  ] as const
  const quantScale = globalScale / 65_536
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const blockIndex = Math.floor(y / 8) * blockWidth + Math.floor(x / 8)
      const quant = quantization[blockIndex]
      const sharp = sharpness[blockIndex]
      if (quant === undefined || sharp === undefined || quant < 1 || sharp < 0 || sharp > 7) {
        throw invalidInput('JPEG XL EPF block metadata is invalid')
      }
      const sigma = Math.min(-1e-4, (0.46 / (quantScale * quant * -1.17157287525381)) * (sharp / 7))
      const inverseSigma = 1 / sigma
      const outputIndex = y * width + x
      if (inverseSigma < -3.9052429175127) {
        for (let channel = 0; channel < 3; channel += 1) {
          const filtered = output[channel]
          if (!filtered) throw invalidInput('JPEG XL EPF output plane is missing')
          filtered[outputIndex] = epfSample(
            planes[channel] ?? new Float32Array(),
            stride,
            width,
            height,
            x,
            y,
          )
        }
        continue
      }
      const blockBorder = (x & 7) === 0 || (x & 7) === 7 || (y & 7) === 0 || (y & 7) === 7
      const scaledInverseSigma = inverseSigma * stageScale * (blockBorder ? 2 / 3 : 1)
      const sums = [
        epfSample(planes[0], stride, width, height, x, y),
        epfSample(planes[1], stride, width, height, x, y),
        epfSample(planes[2], stride, width, height, x, y),
      ]
      let totalWeight = 1
      for (const offset of offsets) {
        const offsetY = offset[0] ?? 0
        const offsetX = offset[1] ?? 0
        let sad = 0
        for (let channel = 0; channel < 3; channel += 1) {
          const plane = planes[channel]
          if (!plane) throw invalidInput('JPEG XL EPF plane is missing')
          if (stage === 2) {
            sad +=
              Math.abs(
                epfSample(plane, stride, width, height, x + offsetX, y + offsetY) -
                  epfSample(plane, stride, width, height, x, y),
              ) * (channelScales[channel] ?? 1)
          } else {
            let channelSad = 0
            for (const patchOffset of epfPatchOffsets) {
              const patchY = patchOffset[0] ?? 0
              const patchX = patchOffset[1] ?? 0
              channelSad += Math.abs(
                epfSample(plane, stride, width, height, x + patchX, y + patchY) -
                  epfSample(
                    plane,
                    stride,
                    width,
                    height,
                    x + offsetX + patchX,
                    y + offsetY + patchY,
                  ),
              )
            }
            sad += channelSad * (channelScales[channel] ?? 1)
          }
        }
        const weight = Math.max(0, 1 + sad * scaledInverseSigma)
        if (weight === 0) continue
        totalWeight += weight
        for (let channel = 0; channel < 3; channel += 1) {
          const plane = planes[channel]
          if (!plane) throw invalidInput('JPEG XL EPF plane is missing')
          sums[channel] =
            (sums[channel] ?? 0) +
            weight * epfSample(plane, stride, width, height, x + offsetX, y + offsetY)
        }
      }
      for (let channel = 0; channel < 3; channel += 1) {
        const filtered = output[channel]
        if (!filtered) throw invalidInput('JPEG XL EPF output plane is missing')
        filtered[outputIndex] = (sums[channel] ?? 0) / totalWeight
      }
    }
  }
  for (let channel = 0; channel < 3; channel += 1) {
    const plane = planes[channel]
    const filtered = output[channel]
    if (!plane || !filtered) throw invalidInput('JPEG XL EPF output plane is missing')
    for (let y = 0; y < height; y += 1) {
      plane.set(filtered.subarray(y * width, (y + 1) * width), y * stride)
    }
  }
}

const uint64Mask = (1n << 64n) - 1n

const splitMix64 = (value: bigint): bigint => {
  let mixed = value & uint64Mask
  mixed = ((mixed ^ (mixed >> 30n)) * 0xbf58476d1ce4e5b9n) & uint64Mask
  mixed = ((mixed ^ (mixed >> 27n)) * 0x94d049bb133111ebn) & uint64Mask
  return (mixed ^ (mixed >> 31n)) & uint64Mask
}

class JpegXlNoiseRandom {
  readonly #state0 = new Array<bigint>(8)
  readonly #state1 = new Array<bigint>(8)

  constructor(seed1: number, seed2: number, seed3: number, seed4: number) {
    const firstSeed = (BigInt(seed1 >>> 0) << 32n) + BigInt(seed2 >>> 0)
    const secondSeed = (BigInt(seed3 >>> 0) << 32n) + BigInt(seed4 >>> 0)
    this.#state0[0] = splitMix64(firstSeed + 0x9e3779b97f4a7c15n)
    this.#state1[0] = splitMix64(secondSeed + 0x9e3779b97f4a7c15n)
    for (let index = 1; index < 8; index += 1) {
      this.#state0[index] = splitMix64(this.#state0[index - 1] ?? 0n)
      this.#state1[index] = splitMix64(this.#state1[index - 1] ?? 0n)
    }
  }

  fillFloats(output: Float32Array): void {
    for (let index = 0; index < 8; index += 1) {
      let state1 = this.#state0[index] ?? 0n
      const state0 = this.#state1[index] ?? 0n
      const bits = (state1 + state0) & uint64Mask
      this.#state0[index] = state0
      state1 = (state1 ^ ((state1 << 23n) & uint64Mask)) & uint64Mask
      state1 = (state1 ^ state0 ^ (state1 >> 18n) ^ (state0 >> 5n)) & uint64Mask
      this.#state1[index] = state1
      const low = Number(bits & 0xffff_ffffn) >>> 0
      const high = Number(bits >> 32n) >>> 0
      output[index * 2] = 1 + (low >>> 9) / 8_388_608
      output[index * 2 + 1] = 1 + (high >>> 9) / 8_388_608
    }
  }
}

const makeNoisePlane = (random: JpegXlNoiseRandom, width: number, height: number): Float32Array => {
  const output = new Float32Array(width * height)
  const batch = new Float32Array(16)
  for (let y = 0; y < height; y += 1) {
    let x = 0
    for (; x + 16 < width; x += 16) {
      random.fillFloats(batch)
      output.set(batch, y * width + x)
    }
    random.fillFloats(batch)
    output.set(batch.subarray(0, width - x), y * width + x)
  }
  return output
}

const convolveNoisePlane = (plane: Float32Array, width: number, height: number): void => {
  const output = new Float32Array(width * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let others = 0
      for (let offsetY = -2; offsetY <= 2; offsetY += 1) {
        const sourceY = mirroredIndex(y + offsetY, height)
        for (let offsetX = -2; offsetX <= 2; offsetX += 1) {
          if (offsetX === 0 && offsetY === 0) continue
          const sourceX = mirroredIndex(x + offsetX, width)
          others = Math.fround(others + (plane[sourceY * width + sourceX] ?? 0))
        }
      }
      output[y * width + x] = Math.fround(
        Math.fround(others * 0.16) + Math.fround((plane[y * width + x] ?? 0) * -3.84),
      )
    }
  }
  plane.set(output)
}

const noiseStrength = (lut: readonly number[], value: number): number => {
  const scaled = Math.max(0, Math.fround(value * 6))
  const lowIndex = scaled >= 7 ? 6 : Math.floor(scaled)
  const fraction = scaled >= 7 ? 1 : Math.fround(scaled - lowIndex)
  const low = lut[lowIndex] ?? 0
  const high = lut[lowIndex + 1] ?? low
  return Math.max(0, Math.min(1, Math.fround(Math.fround(high - low) * fraction + low)))
}

const applyNoise = (
  planes: readonly [Float32Array, Float32Array, Float32Array],
  stride: number,
  width: number,
  height: number,
  lut: readonly number[],
  correlation: Readonly<JpegXlJpegColorCorrelation>,
): void => {
  if (lut.length !== 8 || !lut.some((value) => value !== 0)) return
  // The first visible frame advances the decoder's visible-frame counter from zero to one.
  const random = new JpegXlNoiseRandom(1, 0, 0, 0)
  const noise = [
    makeNoisePlane(random, width, height),
    makeNoisePlane(random, width, height),
    makeNoisePlane(random, width, height),
  ] as const
  for (const plane of noise) convolveNoisePlane(plane, width, height)
  const yToX = correlation.baseCorrelationX
  const yToB = correlation.baseCorrelationB
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const planeIndex = y * stride + x
      const noiseIndex = y * width + x
      const opsinX = planes[0][planeIndex] ?? 0
      const opsinY = planes[1][planeIndex] ?? 0
      const greenStrength = noiseStrength(lut, Math.fround((opsinY - opsinX) * 0.5))
      const redStrength = noiseStrength(lut, Math.fround((opsinY + opsinX) * 0.5))
      const randomRed = Math.fround((noise[0][noiseIndex] ?? 0) * 0.22)
      const randomGreen = Math.fround((noise[1][noiseIndex] ?? 0) * 0.22)
      const randomCorrelated = Math.fround((noise[2][noiseIndex] ?? 0) * 0.22)
      const redNoise = Math.fround(
        redStrength * Math.fround(randomRed * 0.0078125 + randomCorrelated * 0.9921875),
      )
      const greenNoise = Math.fround(
        greenStrength * Math.fround(randomGreen * 0.0078125 + randomCorrelated * 0.9921875),
      )
      const combined = Math.fround(redNoise + greenNoise)
      planes[0][planeIndex] = Math.fround(
        opsinX + Math.fround(yToX * combined + redNoise - greenNoise),
      )
      planes[1][planeIndex] = Math.fround(opsinY + combined)
      planes[2][planeIndex] = Math.fround(
        (planes[2][planeIndex] ?? 0) + Math.fround(yToB * combined),
      )
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

  const lfGlobal = decodeJpegXlJpegLfGlobal(section, 0, false, frame.frameFlags)
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
    true,
    false,
  )

  const planes = [
    new Float32Array(paddedWidth * paddedHeight),
    new Float32Array(paddedWidth * paddedHeight),
    new Float32Array(paddedWidth * paddedHeight),
  ] as const
  const blockCoefficients = [
    new Float64Array(1_024),
    new Float64Array(1_024),
    new Float64Array(1_024),
  ] as const
  const dcSamples = [new Float64Array(16), new Float64Array(16), new Float64Array(16)] as const
  const inverseGlobalScale = 65_536 / lfGlobal.globalScale
  const channelMultipliers = [
    (1 / 1.25) ** (frame.xQuantizationScale - 2),
    1,
    (1 / 1.25) ** (frame.bQuantizationScale - 2),
  ] as const
  const dcFactors = [
    (inverseGlobalScale * (lfGlobal.dcQuantization[0] ?? 1)) / lfGlobal.quantDc,
    (inverseGlobalScale * (lfGlobal.dcQuantization[1] ?? 1)) / lfGlobal.quantDc,
    (inverseGlobalScale * (lfGlobal.dcQuantization[2] ?? 1)) / lfGlobal.quantDc,
  ] as const
  const rawDcPlanes = [
    dcGroup.dcCoefficients[1],
    dcGroup.dcCoefficients[0],
    dcGroup.dcCoefficients[2],
  ] as const
  const dcPlanes = [
    new Float64Array(blockWidth * blockHeight),
    new Float64Array(blockWidth * blockHeight),
    new Float64Array(blockWidth * blockHeight),
  ] as const
  for (let channel = 0; channel < 3; channel += 1) {
    const source = rawDcPlanes[channel]
    const destination = dcPlanes[channel]
    const factor = dcFactors[channel]
    if (!source || !destination || factor === undefined) {
      throw invalidInput('JPEG XL VarDCT DC coefficient plane is missing')
    }
    for (let index = 0; index < destination.length; index += 1) {
      destination[index] = (source[index] ?? 0) * factor
    }
  }
  const yDcPlane = dcPlanes[1]
  for (const channel of [0, 2] as const) {
    const destination = dcPlanes[channel]
    const ratio = dcCorrelationRatio(lfGlobal.colorCorrelation, channel)
    for (let index = 0; index < destination.length; index += 1) {
      destination[index] = (destination[index] ?? 0) + (yDcPlane[index] ?? 0) * ratio
    }
  }
  if ((frame.frameFlags & 128) === 0) {
    applyAdaptiveDcSmoothing(dcPlanes, blockWidth, blockHeight, dcFactors)
  }

  for (let blockY = 0; blockY < blockHeight; blockY += 1) {
    for (let blockX = 0; blockX < blockWidth; blockX += 1) {
      const blockIndex = blockY * blockWidth + blockX
      const strategy = dcGroup.strategies[blockIndex]
      const firstBlock = dcGroup.strategyFirstBlocks[blockIndex]
      const quantization = dcGroup.quantization[blockIndex]
      const dequantizationForStrategy =
        strategy === undefined ? undefined : strategyDequantization.get(strategy)
      if (
        strategy === undefined ||
        firstBlock === undefined ||
        quantization === undefined ||
        quantization < 1
      ) {
        throw invalidInput('JPEG XL VarDCT block quantization is invalid')
      }
      if (firstBlock === 0) continue
      if (!dequantizationForStrategy) {
        throw unsupportedOperation(
          `Common VarDCT transform strategy ${strategy} is not supported yet`,
        )
      }
      const block = acGroup.vardctBlocks[blockIndex]
      if (!block || block.strategy !== strategy) {
        throw invalidInput('JPEG XL VarDCT coefficient block is missing')
      }
      const coveredBlocks = block.blockWidth * block.blockHeight
      const coefficientCount = coveredBlocks * 64
      for (let channel = 0; channel < 3; channel += 1) {
        const coefficients = block.coefficients[channel]
        const dc = dcPlanes[channel]
        const dequantization = dequantizationForStrategy[channel]
        const values = blockCoefficients[channel]
        const channelDc = dcSamples[channel]
        if (!coefficients || !dc || !dequantization || !values || !channelDc) {
          throw invalidInput('JPEG XL VarDCT channel data is missing')
        }
        values.fill(0, 0, coefficientCount)
        for (let localY = 0; localY < block.blockHeight; localY += 1) {
          for (let localX = 0; localX < block.blockWidth; localX += 1) {
            const value = dc[(blockY + localY) * blockWidth + blockX + localX]
            if (value === undefined) throw invalidInput('JPEG XL VarDCT DC coefficient is missing')
            channelDc[localY * block.blockWidth + localX] = value
          }
        }
        for (let position = 0; position < coefficientCount; position += 1) {
          values[position] =
            (adjustQuantizationBias(coefficients[position] ?? 0, channel) *
              inverseGlobalScale *
              (channelMultipliers[channel] ?? 1) *
              (dequantization[position] ?? 1)) /
            quantization
        }
      }

      const colorTileWidth = Math.ceil(blockWidth / 8)
      const colorTileIndex = Math.floor(blockY / 8) * colorTileWidth + Math.floor(blockX / 8)
      const yValues = blockCoefficients[1]
      for (const channel of [0, 2] as const) {
        const values = blockCoefficients[channel]
        const localMap =
          channel === 0
            ? dcGroup.colorCorrelationX[colorTileIndex]
            : dcGroup.colorCorrelationB[colorTileIndex]
        if (localMap === undefined) {
          throw invalidInput('JPEG XL VarDCT color-correlation tile is missing')
        }
        const ratio = correlationRatio(lfGlobal.colorCorrelation, channel, localMap)
        for (let position = 0; position < coefficientCount; position += 1) {
          values[position] = (values[position] ?? 0) + (yValues[position] ?? 0) * ratio
        }
      }
      for (let channel = 0; channel < 3; channel += 1) {
        const values = blockCoefficients[channel]
        const channelDc = dcSamples[channel]
        const plane = planes[channel]
        if (!values || !channelDc || !plane) {
          throw invalidInput('JPEG XL VarDCT render plane is missing')
        }
        populateLowestFrequencies(values, channelDc, block.blockWidth, block.blockHeight)
        if (strategy === 0) {
          inverseDct8Native(values, plane, paddedWidth, blockX * 8, blockY * 8)
        } else if (strategy === 2) {
          inverseDct2TopBlock(values, plane, paddedWidth, blockX * 8, blockY * 8)
        } else if (strategy === 5 || strategy === 6 || strategy === 7) {
          inverseDctRectangle(
            values,
            block.blockWidth * 8,
            block.blockHeight * 8,
            plane,
            paddedWidth,
            blockX * 8,
            blockY * 8,
          )
        } else if (strategy === 13) {
          inverseDct8x4(values, plane, paddedWidth, blockX * 8, blockY * 8)
        } else if (strategy === 15 || strategy === 17) {
          inverseAfv(values, strategy - 14, plane, paddedWidth, blockX * 8, blockY * 8)
        } else {
          throw unsupportedOperation(
            `Common VarDCT transform strategy ${strategy} is not supported yet`,
          )
        }
      }
    }
  }

  if (frame.gaborish) {
    applyDefaultGaborish(planes, paddedWidth, frame.width, frame.height)
  }
  if (frame.epfIterations >= 3) {
    applyDefaultEpfStage(
      planes,
      paddedWidth,
      frame.width,
      frame.height,
      blockWidth,
      dcGroup.quantization,
      dcGroup.sharpness,
      lfGlobal.globalScale,
      0,
    )
  }
  if (frame.epfIterations >= 1) {
    applyDefaultEpfStage(
      planes,
      paddedWidth,
      frame.width,
      frame.height,
      blockWidth,
      dcGroup.quantization,
      dcGroup.sharpness,
      lfGlobal.globalScale,
      1,
    )
  }
  if (frame.epfIterations >= 2) {
    applyDefaultEpfStage(
      planes,
      paddedWidth,
      frame.width,
      frame.height,
      blockWidth,
      dcGroup.quantization,
      dcGroup.sharpness,
      lfGlobal.globalScale,
      2,
    )
  }
  if (lfGlobal.noiseLut) {
    applyNoise(
      planes,
      paddedWidth,
      frame.width,
      frame.height,
      lfGlobal.noiseLut,
      lfGlobal.colorCorrelation,
    )
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
