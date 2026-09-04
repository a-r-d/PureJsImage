import { invalidInput, limitExceeded, unsupportedOperation } from '../errors.ts'
import type { ImageLimits } from '../limits.ts'
import {
  decodeJpegXlStandaloneModular,
  readJpegXlStandaloneModularHeader,
  type JpegXlFrameStructure,
} from './jpegxl-decode.ts'
import {
  decodeJpegXlJpegAcGroup,
  decodeJpegXlJpegDcGroup,
  decodeJpegXlJpegHfGlobal,
  decodeJpegXlJpegLfGlobal,
  jpegXlVarDctStrategyBlockHeights,
  jpegXlVarDctStrategyBlockWidths,
  type JpegXlJpegAcGroup,
  type JpegXlJpegColorCorrelation,
  type JpegXlJpegDcGroup,
  type JpegXlJpegHfGlobal,
  type JpegXlJpegLfGlobal,
  type JpegXlSpline,
} from './jpegxl-vardct-jpeg.ts'
import {
  type JpegXlVarDctMemoryLease,
  type JpegXlVarDctMemoryLedger,
  retainedTypedArrayBytes,
} from './jpegxl-vardct-memory.ts'

export interface JpegXlVarDctPixels {
  readonly width: number
  readonly height: number
  readonly format: 'gray8' | 'rgb8' | 'rgba8'
  readonly data: Uint8Array
  readonly managedPeakBytes: number
  readonly dcPlanes?: readonly [Float64Array, Float64Array, Float64Array]
  release(): void
}

export interface JpegXlVarDctReference {
  readonly width: number
  readonly height: number
  readonly planes: readonly [Float64Array, Float64Array, Float64Array]
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

const hornussWeights = Object.freeze([
  Object.freeze([280, 3160, 3160]),
  Object.freeze([60, 864, 864]),
  Object.freeze([18, 200, 200]),
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

const dct8x32Bands = Object.freeze([
  Object.freeze([16283.249, -1.7812846, -1.6309059, -1.0382179, -0.85, -0.7, -0.9, -1.2360638]),
  Object.freeze([5089.1577, -0.3200494, -0.3536285, -0.3034, -0.61, -0.5, -0.5, -0.6]),
  Object.freeze([3397.7761, -0.32132736, -0.3450762, -0.7034, -0.9, -1, -1, -1.1754606]),
])

const dct16x32Bands = Object.freeze([
  Object.freeze([13844.971, -0.971138, -0.658, -0.42026, -0.22712, -0.2206, -0.226, -0.6]),
  Object.freeze([
    4798.964, -0.6112531, -0.8377079, -0.7901486, -0.26927274, -0.38272768, -0.22924222,
    -0.20719099,
  ]),
  Object.freeze([1807.2369, -1.2, -1.2, -0.7, -0.7, -0.7, -0.4, -0.5]),
])

const commonLargeDctBands = (x: number, y: number, b: number): readonly (readonly number[])[] =>
  Object.freeze([
    Object.freeze([x, -1.025, -0.78, -0.65012, -0.19041574, -0.20819396, -0.421064, -0.32733846]),
    Object.freeze([
      y,
      -0.30419582,
      -0.36330363,
      -0.3566038,
      -0.34430745,
      -0.33699593,
      -0.30180866,
      -0.27321684,
    ]),
    Object.freeze([b, -1.2, -1.2, -0.8, -0.7, -0.7, -0.4, -0.5]),
  ])

const dct64Bands = commonLargeDctBands(23966.166, 8380.191, 4493.024)
const dct32x64Bands = commonLargeDctBands(15358.898, 5597.3604, 2919.9617)

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
  output.set(
    1,
    Object.freeze(
      hornussWeights.map((parameters) => {
        const table = new Float64Array(64)
        table.fill(1 / (parameters[0] ?? 1))
        table[0] = 1
        table[1] = table[8] = 1 / (parameters[1] ?? 1)
        table[9] = 1 / (parameters[2] ?? 1)
        return table
      }),
    ),
  )
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

  const addDct = (
    strategies: readonly number[],
    rows: number,
    columns: number,
    bandsByChannel: readonly (readonly number[])[],
  ): void => {
    const tables = Object.freeze(
      bandsByChannel.map((bands) =>
        Float64Array.from(distanceWeights(rows, columns, bands), (weight) => 1 / weight),
      ),
    )
    for (const strategy of strategies) output.set(strategy, tables)
  }
  addDct([4], 16, 16, [
    [8996.873, -1.3000778, -0.4942453, -0.43909377, -0.6350102, -0.9017726, -1.6162099],
    [3191.4836, -0.67424583, -0.80745816, -0.4492584, -0.3586544, -0.3132239, -0.37615025],
    [1157.504, -2.0531423, -1.4, -0.5068713, -0.4270873, -1.4856834, -4.920914],
  ])
  addDct([8, 9], 8, 32, dct8x32Bands)
  addDct([10, 11], 16, 32, dct16x32Bands)
  addDct([18], 64, 64, dct64Bands)
  addDct([19, 20], 32, 64, dct32x64Bands)

  const dct4x8Weights = dct4x8Bands.map((bands) => distanceWeights(4, 8, bands))
  const dct4x8 = dct4x8Weights.map((weights) => {
    const table = new Float64Array(64)
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1)
        table[y * 8 + x] = 1 / (weights[Math.floor(y / 2) * 8 + x] ?? 1)
    }
    return table
  })
  const frozenDct4x8 = Object.freeze(dct4x8)
  output.set(12, frozenDct4x8)
  output.set(13, frozenDct4x8)

  const dct4x4Weights = dct4x4Bands.map((bands) => distanceWeights(4, 4, bands))
  output.set(
    3,
    Object.freeze(
      dct4x4Weights.map((weights) => {
        const table = new Float64Array(64)
        for (let quadrantY = 0; quadrantY < 2; quadrantY += 1) {
          for (let quadrantX = 0; quadrantX < 2; quadrantX += 1) {
            for (let y = 0; y < 4; y += 1) {
              for (let x = 0; x < 4; x += 1) {
                table[(quadrantY + y * 2) * 8 + quadrantX + x * 2] = 1 / (weights[y * 4 + x] ?? 1)
              }
            }
          }
        }
        return table
      }),
    ),
  )
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

const strategyQuantizationTable = Object.freeze([
  0, 1, 2, 3, 4, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 10, 10, 11, 12, 12, 13, 14, 14, 15, 16, 16,
])

export const jpegXlSupportedVarDctStrategyIds = Object.freeze([
  0, 1, 2, 3, 4, 5, 6, 7, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
] as const)

export const supportsJpegXlVarDctStrategy = (strategy: number): boolean =>
  jpegXlSupportedVarDctStrategyIds.includes(
    strategy as (typeof jpegXlSupportedVarDctStrategyIds)[number],
  )

interface SplinePoint {
  readonly x: number
  readonly y: number
}

const splineErf = (value: number): number => {
  const sign = value < 0 ? -1 : 1
  const x = Math.abs(value)
  const t = 1 / (1 + 0.3275911 * x)
  const polynomial =
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t
  return sign * (1 - polynomial * Math.exp(-x * x))
}

const continuousSplineIdct = (dct: readonly number[], position: number): number => {
  let sum = 0
  for (let index = 0; index < 32; index += 1) {
    sum += Math.SQRT2 * (dct[index] ?? 0) * Math.cos((Math.PI * index * (position + 0.5)) / 32)
  }
  return sum
}

const interpolateSplinePoints = (controlPoints: readonly SplinePoint[]): SplinePoint[] => {
  if (controlPoints.length <= 1) return [...controlPoints]
  const points = [
    {
      x: 2 * (controlPoints[0]?.x ?? 0) - (controlPoints[1]?.x ?? 0),
      y: 2 * (controlPoints[0]?.y ?? 0) - (controlPoints[1]?.y ?? 0),
    },
    ...controlPoints,
    {
      x: 2 * (controlPoints.at(-1)?.x ?? 0) - (controlPoints.at(-2)?.x ?? 0),
      y: 2 * (controlPoints.at(-1)?.y ?? 0) - (controlPoints.at(-2)?.y ?? 0),
    },
  ]
  const output: SplinePoint[] = []
  for (let start = 0; start < points.length - 3; start += 1) {
    const p0 = points[start]
    const p1 = points[start + 1]
    const p2 = points[start + 2]
    const p3 = points[start + 3]
    if (!p0 || !p1 || !p2 || !p3) throw invalidInput('JPEG XL spline point is missing')
    output.push(p1)
    const distances = [
      Math.sqrt(Math.hypot(p1.x - p0.x, p1.y - p0.y)),
      Math.sqrt(Math.hypot(p2.x - p1.x, p2.y - p1.y)),
      Math.sqrt(Math.hypot(p3.x - p2.x, p3.y - p2.y)),
    ]
    const times = [0, distances[0] ?? 0]
    times.push((times[1] ?? 0) + (distances[1] ?? 0))
    times.push((times[2] ?? 0) + (distances[2] ?? 0))
    for (let step = 1; step < 16; step += 1) {
      const time = (distances[0] ?? 0) + (step / 16) * (distances[1] ?? 0)
      const base = [p0, p1, p2]
      const next = [p1, p2, p3]
      const a = base.map((point, index) => {
        const span = (times[index + 1] ?? 0) - (times[index] ?? 0)
        const ratio = span === 0 ? 0 : (time - (times[index] ?? 0)) / span
        return {
          x: point.x + ratio * ((next[index]?.x ?? point.x) - point.x),
          y: point.y + ratio * ((next[index]?.y ?? point.y) - point.y),
        }
      })
      const b = [0, 1].map((index) => {
        const span = (times[index + 2] ?? 0) - (times[index] ?? 0)
        const ratio = span === 0 ? 0 : (time - (times[index] ?? 0)) / span
        const first = a[index]
        const second = a[index + 1]
        return {
          x: (first?.x ?? 0) + ratio * ((second?.x ?? 0) - (first?.x ?? 0)),
          y: (first?.y ?? 0) + ratio * ((second?.y ?? 0) - (first?.y ?? 0)),
        }
      })
      const span = (times[2] ?? 0) - (times[1] ?? 0)
      const ratio = span === 0 ? 0 : (time - (times[1] ?? 0)) / span
      output.push({
        x: (b[0]?.x ?? 0) + ratio * ((b[1]?.x ?? 0) - (b[0]?.x ?? 0)),
        y: (b[0]?.y ?? 0) + ratio * ((b[1]?.y ?? 0) - (b[0]?.y ?? 0)),
      })
    }
  }
  const last = controlPoints.at(-1)
  if (last) output.push(last)
  return output
}

const equallySpacedSplinePoints = (
  points: readonly SplinePoint[],
): readonly (readonly [SplinePoint, number])[] => {
  if (points.length === 0) return Object.freeze([])
  const output: [SplinePoint, number][] = []
  let current = points[0]
  if (!current) return Object.freeze([])
  output.push([current, 1])
  let nextIndex = 0
  while (nextIndex < points.length) {
    let previous: SplinePoint = current
    let distanceFromPrevious = 0
    for (;;) {
      const next = points[nextIndex]
      if (!next) {
        output.push([previous, distanceFromPrevious])
        return Object.freeze(output)
      }
      const distance = Math.hypot(next.x - previous.x, next.y - previous.y)
      if (distanceFromPrevious + distance >= 1) {
        const ratio = distance === 0 ? 0 : (1 - distanceFromPrevious) / distance
        current = {
          x: previous.x + ratio * (next.x - previous.x),
          y: previous.y + ratio * (next.y - previous.y),
        }
        output.push([current, 1])
        break
      }
      distanceFromPrevious += distance
      previous = next
      nextIndex += 1
    }
  }
  return Object.freeze(output)
}

const dequantizeSpline = (
  spline: Readonly<JpegXlSpline>,
  quantizationAdjustment: number,
  yToX: number,
  yToB: number,
): Readonly<{
  controlPoints: readonly SplinePoint[]
  color: readonly number[][]
  sigma: readonly number[]
}> => {
  const controlPoints: SplinePoint[] = [{ x: spline.startingX, y: spline.startingY }]
  let x = spline.startingX
  let y = spline.startingY
  let deltaX = 0
  let deltaY = 0
  for (const delta of spline.controlPointDeltas) {
    deltaX += delta[0]
    deltaY += delta[1]
    x += deltaX
    y += deltaY
    controlPoints.push({ x, y })
  }
  const inverseQuantization =
    quantizationAdjustment >= 0
      ? 1 / (1 + 0.125 * quantizationAdjustment)
      : 1 - 0.125 * quantizationAdjustment
  const channelWeights = [0.0042, 0.075, 0.07]
  const color = spline.colorDct.map((channel, channelIndex) =>
    channel.map(
      (value, index) =>
        value *
        (index === 0 ? Math.SQRT1_2 : 1) *
        (channelWeights[channelIndex] ?? 1) *
        inverseQuantization,
    ),
  )
  for (let index = 0; index < 32; index += 1) {
    if (color[0]) color[0][index] = (color[0][index] ?? 0) + yToX * (color[1]?.[index] ?? 0)
    if (color[2]) color[2][index] = (color[2][index] ?? 0) + yToB * (color[1]?.[index] ?? 0)
  }
  const sigma = spline.sigmaDct.map(
    (value, index) => value * (index === 0 ? Math.SQRT1_2 : 1) * 0.3333 * inverseQuantization,
  )
  return Object.freeze({ controlPoints: Object.freeze(controlPoints), color, sigma })
}

const applySplines = (
  planes: readonly Float32Array[],
  stride: number,
  width: number,
  height: number,
  splines: readonly JpegXlSpline[],
  quantizationAdjustment: number,
  colorCorrelation: Readonly<JpegXlJpegColorCorrelation>,
): void => {
  const yToX = correlationRatio(colorCorrelation, 0, 0)
  const yToB = correlationRatio(colorCorrelation, 2, 0)
  for (const encoded of splines) {
    const spline = dequantizeSpline(encoded, quantizationAdjustment, yToX, yToB)
    const points = equallySpacedSplinePoints(interpolateSplinePoints(spline.controlPoints))
    if (points.length < 2) continue
    const arcLength = points.length - 2 + (points.at(-1)?.[1] ?? 0)
    if (arcLength <= 0) continue
    for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
      const point = points[pointIndex]
      if (!point) continue
      const progress = Math.min(1, pointIndex / arcLength)
      const dctPosition = 31 * progress
      const color = spline.color.map((channel) => continuousSplineIdct(channel, dctPosition))
      const sigma = continuousSplineIdct(spline.sigma, dctPosition)
      const intensity = point[1]
      if (!Number.isFinite(sigma) || sigma === 0 || !Number.isFinite(intensity)) continue
      let maximumColor = 0.01
      for (const value of color) maximumColor = Math.max(maximumColor, Math.abs(value * intensity))
      const maximumDistance = Math.sqrt(
        -2 * sigma * sigma * (Math.log(0.1) * 3 - Math.log(maximumColor)),
      )
      const y0 = Math.max(0, Math.round(point[0].y - maximumDistance))
      const y1 = Math.min(height, Math.round(point[0].y + maximumDistance) + 1)
      const x0 = Math.max(0, Math.round(point[0].x - maximumDistance))
      const x1 = Math.min(width, Math.round(point[0].x + maximumDistance) + 1)
      for (let localY = y0; localY < y1; localY += 1) {
        const dy = localY - point[0].y
        for (let localX = x0; localX < x1; localX += 1) {
          const distance = Math.hypot(localX - point[0].x, dy)
          const factor =
            splineErf((distance * 0.5 + 0.353553391) / sigma) -
            splineErf((distance * 0.5 - 0.353553391) / sigma)
          const localIntensity = 0.25 * sigma * intensity * factor * factor
          const offset = localY * stride + localX
          for (let channel = 0; channel < 3; channel += 1) {
            const plane = planes[channel]
            if (plane) {
              plane[offset] = (plane[offset] ?? 0) + (color[channel] ?? 0) * localIntensity
            }
          }
        }
      }
    }
  }
}

const dctBasis = Float64Array.from({ length: 64 }, (_, index) => {
  const frequency = Math.floor(index / 8)
  const position = index & 7
  return (
    0.5 *
    (frequency === 0 ? Math.SQRT1_2 : 1) *
    Math.cos(((2 * position + 1) * frequency * Math.PI) / 16)
  )
})

const rectangularDctBases = new Map<number, Float64Array>()

const rectangularDctBasis = (size: number): Float64Array => {
  const cached = rectangularDctBases.get(size)
  if (cached) return cached
  const basis = Float64Array.from({ length: size * size }, (_, index) => {
    const frequency = Math.floor(index / size)
    const position = index % size
    return (
      Math.sqrt(2 / size) *
      (frequency === 0 ? Math.SQRT1_2 : 1) *
      Math.cos(((2 * position + 1) * frequency * Math.PI) / (2 * size))
    )
  })
  rectangularDctBases.set(size, basis)
  return basis
}

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

const smoothDcAt = (
  plane: Float64Array,
  index: number,
  width: number,
  centerWeight: number,
  sideWeight: number,
  cornerWeight: number,
): number =>
  plane[index]! * centerWeight +
  (plane[index - 1]! + plane[index + 1]! + plane[index - width]! + plane[index + width]!) *
    sideWeight +
  (plane[index - width - 1]! +
    plane[index - width + 1]! +
    plane[index + width - 1]! +
    plane[index + width + 1]!) *
    cornerWeight

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
  const factor0 = dcFactors[0]
  const factor1 = dcFactors[1]
  const factor2 = dcFactors[2]
  if (factor0 === 0 || factor1 === 0 || factor2 === 0) {
    throw invalidInput('JPEG XL adaptive DC smoothing metadata is invalid')
  }
  const plane0 = planes[0]
  const plane1 = planes[1]
  const plane2 = planes[2]
  const smoothed = [planes[0].slice(), planes[1].slice(), planes[2].slice()] as const
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x
      const center0 = plane0[index]!
      const center1 = plane1[index]!
      const center2 = plane2[index]!
      const smooth0 = smoothDcAt(plane0, index, width, centerWeight, sideWeight, cornerWeight)
      const smooth1 = smoothDcAt(plane1, index, width, centerWeight, sideWeight, cornerWeight)
      const smooth2 = smoothDcAt(plane2, index, width, centerWeight, sideWeight, cornerWeight)
      const gap = Math.max(
        0.5,
        Math.abs((center0 - smooth0) / factor0),
        Math.abs((center1 - smooth1) / factor1),
        Math.abs((center2 - smooth2) / factor2),
      )
      const mix = Math.max(0, 3 - 4 * gap)
      smoothed[0][index] = center0 + (smooth0 - center0) * mix
      smoothed[1][index] = center1 + (smooth1 - center1) * mix
      smoothed[2][index] = center2 + (smooth2 - center2) * mix
    }
  }
  for (let channel = 0; channel < 3; channel += 1) {
    const plane = planes[channel]
    const output = smoothed[channel]
    if (!plane || !output) throw invalidInput('JPEG XL adaptive DC smoothing plane is missing')
    plane.set(output)
  }
}

const inverseDct8Native = (
  coefficients: Float64Array,
  intermediate: Float64Array,
  destination: Float32Array,
  destinationWidth: number,
  destinationX: number,
  destinationY: number,
  activeVertical: Uint16Array,
): void => {
  let activeVerticalCount = 0
  for (let vertical = 0; vertical < 8; vertical += 1) {
    const rowOffset = vertical * 8
    let active = false
    for (let horizontal = 0; horizontal < 8; horizontal += 1) {
      const coefficient = coefficients[horizontal * 8 + vertical] ?? 0
      if (coefficient === 0) continue
      const basisOffset = horizontal * 8
      const value0 = coefficient * (dctBasis[basisOffset] ?? 0)
      const value1 = coefficient * (dctBasis[basisOffset + 1] ?? 0)
      const value2 = coefficient * (dctBasis[basisOffset + 2] ?? 0)
      const value3 = coefficient * (dctBasis[basisOffset + 3] ?? 0)
      const value4 = coefficient * (dctBasis[basisOffset + 4] ?? 0)
      const value5 = coefficient * (dctBasis[basisOffset + 5] ?? 0)
      const value6 = coefficient * (dctBasis[basisOffset + 6] ?? 0)
      const value7 = coefficient * (dctBasis[basisOffset + 7] ?? 0)
      if (active) {
        intermediate[rowOffset] = (intermediate[rowOffset] ?? 0) + value0
        intermediate[rowOffset + 1] = (intermediate[rowOffset + 1] ?? 0) + value1
        intermediate[rowOffset + 2] = (intermediate[rowOffset + 2] ?? 0) + value2
        intermediate[rowOffset + 3] = (intermediate[rowOffset + 3] ?? 0) + value3
        intermediate[rowOffset + 4] = (intermediate[rowOffset + 4] ?? 0) + value4
        intermediate[rowOffset + 5] = (intermediate[rowOffset + 5] ?? 0) + value5
        intermediate[rowOffset + 6] = (intermediate[rowOffset + 6] ?? 0) + value6
        intermediate[rowOffset + 7] = (intermediate[rowOffset + 7] ?? 0) + value7
      } else {
        intermediate[rowOffset] = value0
        intermediate[rowOffset + 1] = value1
        intermediate[rowOffset + 2] = value2
        intermediate[rowOffset + 3] = value3
        intermediate[rowOffset + 4] = value4
        intermediate[rowOffset + 5] = value5
        intermediate[rowOffset + 6] = value6
        intermediate[rowOffset + 7] = value7
        activeVertical[activeVerticalCount++] = vertical
        active = true
      }
    }
  }
  for (let y = 0; y < 8; y += 1) {
    let value0 = 0
    let value1 = 0
    let value2 = 0
    let value3 = 0
    let value4 = 0
    let value5 = 0
    let value6 = 0
    let value7 = 0
    for (let activeIndex = 0; activeIndex < activeVerticalCount; activeIndex += 1) {
      const vertical = activeVertical[activeIndex] ?? 0
      const rowOffset = vertical * 8
      const basis = dctBasis[rowOffset + y] ?? 0
      value0 += basis * (intermediate[rowOffset] ?? 0)
      value1 += basis * (intermediate[rowOffset + 1] ?? 0)
      value2 += basis * (intermediate[rowOffset + 2] ?? 0)
      value3 += basis * (intermediate[rowOffset + 3] ?? 0)
      value4 += basis * (intermediate[rowOffset + 4] ?? 0)
      value5 += basis * (intermediate[rowOffset + 5] ?? 0)
      value6 += basis * (intermediate[rowOffset + 6] ?? 0)
      value7 += basis * (intermediate[rowOffset + 7] ?? 0)
    }
    const outputOffset = (destinationY + y) * destinationWidth + destinationX
    destination[outputOffset] = value0 * 8
    destination[outputOffset + 1] = value1 * 8
    destination[outputOffset + 2] = value2 * 8
    destination[outputOffset + 3] = value3 * 8
    destination[outputOffset + 4] = value4 * 8
    destination[outputOffset + 5] = value5 * 8
    destination[outputOffset + 6] = value6 * 8
    destination[outputOffset + 7] = value7 * 8
  }
}

const inverseDctRectangle = (
  coefficients: Float64Array,
  outputWidth: number,
  outputHeight: number,
  intermediate: Float64Array,
  destination: Float32Array,
  destinationWidth: number,
  destinationX: number,
  destinationY: number,
  activeVerticalScratch?: Uint16Array,
): void => {
  const scale = Math.sqrt(outputWidth * outputHeight)
  const horizontalBasis = rectangularDctBasis(outputWidth)
  const verticalBasis = rectangularDctBasis(outputHeight)
  const activeVertical = activeVerticalScratch ?? new Uint16Array(outputHeight)
  let activeVerticalCount = 0
  for (let vertical = 0; vertical < outputHeight; vertical += 1) {
    const intermediateOffset = vertical * outputWidth
    intermediate.fill(0, intermediateOffset, intermediateOffset + outputWidth)
    let active = false
    for (let horizontal = 0; horizontal < outputWidth; horizontal += 1) {
      const coefficientIndex =
        outputHeight >= outputWidth
          ? horizontal * outputHeight + vertical
          : vertical * outputWidth + horizontal
      const coefficient = coefficients[coefficientIndex] ?? 0
      if (coefficient === 0) continue
      active = true
      const basisOffset = horizontal * outputWidth
      for (let x = 0; x < outputWidth; x += 1) {
        intermediate[intermediateOffset + x] =
          (intermediate[intermediateOffset + x] ?? 0) +
          coefficient * (horizontalBasis[basisOffset + x] ?? 0)
      }
    }
    if (active) activeVertical[activeVerticalCount++] = vertical
  }
  for (let y = 0; y < outputHeight; y += 1) {
    for (let x = 0; x < outputWidth; x += 1) {
      let sample = 0
      for (let activeIndex = 0; activeIndex < activeVerticalCount; activeIndex += 1) {
        const vertical = activeVertical[activeIndex] ?? 0
        sample +=
          (intermediate[vertical * outputWidth + x] ?? 0) *
          (verticalBasis[vertical * outputHeight + y] ?? 0)
      }
      destination[(destinationY + y) * destinationWidth + destinationX + x] = sample * scale
    }
  }
}

const lowFrequencyResampleScales = (size: number): Float64Array => {
  const scales = new Float64Array(size)
  const dctSize = size * 8
  for (let frequency = 0; frequency < size; frequency += 1) {
    let downsampleScale = 1
    for (let divisor = dctSize * 2; divisor >= dctSize / 2; divisor /= 2) {
      downsampleScale *= Math.cos((frequency * Math.PI) / divisor)
    }
    scales[frequency] = 1 / downsampleScale
  }
  return scales
}

const lowFrequencyResampleScaleCache = Object.freeze(
  Array.from({ length: 9 }, (_, size) =>
    size === 0 ? new Float64Array() : lowFrequencyResampleScales(size),
  ),
)

const forwardScaledDct = (
  samples: Float64Array,
  width: number,
  height: number,
  coefficients: Float64Array,
): void => {
  const areaScale = Math.sqrt(width * height)
  const horizontalBasis = rectangularDctBasis(width)
  const verticalBasis = rectangularDctBasis(height)
  for (let vertical = 0; vertical < height; vertical += 1) {
    for (let horizontal = 0; horizontal < width; horizontal += 1) {
      let coefficient = 0
      for (let y = 0; y < height; y += 1) {
        const verticalWeight = verticalBasis[vertical * height + y] ?? 0
        for (let x = 0; x < width; x += 1) {
          coefficient +=
            (samples[y * width + x] ?? 0) *
            (horizontalBasis[horizontal * width + x] ?? 0) *
            verticalWeight
        }
      }
      coefficients[vertical * width + horizontal] = coefficient / areaScale
    }
  }
}

const populateLowestFrequencies = (
  values: Float64Array,
  dcSamples: Float64Array,
  blockWidth: number,
  blockHeight: number,
  frequencyScratch: Float64Array,
): void => {
  forwardScaledDct(dcSamples, blockWidth, blockHeight, frequencyScratch)
  const horizontalScales = lowFrequencyResampleScaleCache[blockWidth]
  const verticalScales = lowFrequencyResampleScaleCache[blockHeight]
  if (!horizontalScales || !verticalScales) {
    throw invalidInput('JPEG XL low-frequency transform dimension is invalid')
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
        (frequencyScratch[vertical * blockWidth + horizontal] ?? 0) *
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

const inverseHornuss = (
  coefficients: Float64Array,
  intermediate: Float64Array,
  destination: Float32Array,
  destinationWidth: number,
  destinationX: number,
  destinationY: number,
): void => {
  intermediate.set(coefficients.subarray(0, 64), 0)
  const c00 = intermediate[0] ?? 0
  const c01 = intermediate[1] ?? 0
  const c10 = intermediate[8] ?? 0
  const c11 = intermediate[9] ?? 0
  intermediate[0] = c00 + c01 + c10 + c11
  intermediate[1] = c00 + c01 - c10 - c11
  intermediate[8] = c00 - c01 + c10 - c11
  intermediate[9] = c00 - c01 - c10 + c11
  const scratchOffset = 64
  for (let cellY = 0; cellY < 2; cellY += 1) {
    for (let cellX = 0; cellX < 2; cellX += 1) {
      const scratchBase = scratchOffset + (cellY * 2 + cellX) * 16
      let residualSum = 0
      for (let y = 0; y < 4; y += 1) {
        for (let x = 0; x < 4; x += 1) {
          const value = intermediate[(cellY + y * 2) * 8 + cellX + x * 2] ?? 0
          intermediate[scratchBase + y * 4 + x] = value
          if (x !== 0 || y !== 0) residualSum += value
        }
      }
      const average = (intermediate[scratchBase] ?? 0) - residualSum / 16
      intermediate[scratchBase] = intermediate[scratchBase + 5] ?? 0
      intermediate[scratchBase + 5] = 0
      for (let index = 0; index < 16; index += 1) {
        intermediate[scratchBase + index] = (intermediate[scratchBase + index] ?? 0) + average
      }
      for (let y = 0; y < 4; y += 1) {
        for (let x = 0; x < 4; x += 1) {
          destination[
            (destinationY + cellY * 4 + y) * destinationWidth + destinationX + cellX * 4 + x
          ] = intermediate[scratchBase + y * 4 + x] ?? 0
        }
      }
    }
  }
}

const inverseDct8x4 = (
  coefficients: Float64Array,
  intermediate: Float64Array,
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
      intermediate,
      destination,
      destinationWidth,
      destinationX + half * 4,
      destinationY,
    )
  }
}

const inverseDct4x8 = (
  coefficients: Float64Array,
  intermediate: Float64Array,
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
      8,
      4,
      intermediate,
      destination,
      destinationWidth,
      destinationX,
      destinationY + half * 4,
    )
  }
}

const inverseDct4x4 = (
  coefficients: Float64Array,
  coefficientScratch: Float64Array,
  transformScratch: Float64Array,
  destination: Float32Array,
  destinationWidth: number,
  destinationX: number,
  destinationY: number,
): void => {
  const block00 = coefficients[0] ?? 0
  const block01 = coefficients[1] ?? 0
  const block10 = coefficients[8] ?? 0
  const block11 = coefficients[9] ?? 0
  const dc = [
    block00 + block01 + block10 + block11,
    block00 + block01 - block10 - block11,
    block00 - block01 + block10 - block11,
    block00 - block01 - block10 + block11,
  ] as const
  for (let quadrantY = 0; quadrantY < 2; quadrantY += 1) {
    for (let quadrantX = 0; quadrantX < 2; quadrantX += 1) {
      coefficientScratch[0] = dc[quadrantY * 2 + quadrantX] ?? 0
      for (let y = 0; y < 4; y += 1) {
        for (let x = 0; x < 4; x += 1) {
          if (x !== 0 || y !== 0) {
            coefficientScratch[y * 4 + x] =
              coefficients[(quadrantY + y * 2) * 8 + quadrantX + x * 2] ?? 0
          }
        }
      }
      inverseDctRectangle(
        coefficientScratch,
        4,
        4,
        transformScratch,
        destination,
        destinationWidth,
        destinationX + quadrantX * 4,
        destinationY + quadrantY * 4,
      )
    }
  }
}

const inverseAfv = (
  coefficients: Float64Array,
  kind: number,
  intermediate: Float64Array,
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
    intermediate,
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
    intermediate,
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
  scratch = new Float32Array(stride * height),
): void => {
  const adjacent = 1.1 * 0.104699568
  const diagonal = 1.1 * 0.055680538
  const normalization = 1 / (1 + 4 * (adjacent + diagonal))
  const centerWeight = normalization
  const adjacentWeight = adjacent * normalization
  const diagonalWeight = diagonal * normalization
  for (const plane of planes) {
    for (let y = 1; y < height - 1; y += 1) {
      const row = y * stride
      const top = row - stride
      const bottom = row + stride
      for (let x = 1; x < width - 1; x += 1) {
        const index = row + x
        scratch[index] =
          plane[index]! * centerWeight +
          (plane[index - 1]! + plane[index + 1]! + plane[top + x]! + plane[bottom + x]!) *
            adjacentWeight +
          (plane[top + x - 1]! +
            plane[top + x + 1]! +
            plane[bottom + x - 1]! +
            plane[bottom + x + 1]!) *
            diagonalWeight
      }
    }
    for (let y = 0; y < height; y += 1) {
      if (y !== 0 && y !== height - 1 && width > 2) {
        const row = y * stride
        const top = row - stride
        const bottom = row + stride
        scratch[row] =
          plane[row]! * centerWeight +
          (plane[row]! + plane[row + 1]! + plane[top]! + plane[bottom]!) * adjacentWeight +
          (plane[top]! + plane[top + 1]! + plane[bottom]! + plane[bottom + 1]!) * diagonalWeight
        const right = row + width - 1
        scratch[right] =
          plane[right]! * centerWeight +
          (plane[right - 1]! +
            plane[right]! +
            plane[top + width - 1]! +
            plane[bottom + width - 1]!) *
            adjacentWeight +
          (plane[top + width - 2]! +
            plane[top + width - 1]! +
            plane[bottom + width - 2]! +
            plane[bottom + width - 1]!) *
            diagonalWeight
        continue
      }
      const topY = y === 0 ? 0 : y - 1
      const bottomY = y === height - 1 ? height - 1 : y + 1
      for (let x = 0; x < width; x += 1) {
        const leftX = x === 0 ? 0 : x - 1
        const rightX = x === width - 1 ? width - 1 : x + 1
        const index = y * stride + x
        scratch[index] =
          plane[index]! * centerWeight +
          (plane[y * stride + leftX]! +
            plane[y * stride + rightX]! +
            plane[topY * stride + x]! +
            plane[bottomY * stride + x]!) *
            adjacentWeight +
          (plane[topY * stride + leftX]! +
            plane[topY * stride + rightX]! +
            plane[bottomY * stride + leftX]! +
            plane[bottomY * stride + rightX]!) *
            diagonalWeight
      }
    }
    plane.set(scratch.subarray(0, stride * height))
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

const epfPatchOffsets = Object.freeze([
  Object.freeze([0, 0]),
  Object.freeze([-1, 0]),
  Object.freeze([0, -1]),
  Object.freeze([1, 0]),
  Object.freeze([0, 1]),
])

const epfCandidateCoordinates = Object.freeze({
  0: new Int8Array([
    -2, 0, -1, -1, -1, 0, -1, 1, 0, -2, 0, -1, 0, 1, 0, 2, 1, -1, 1, 0, 1, 1, 2, 0,
  ]),
  1: new Int8Array([-1, 0, 0, -1, 0, 1, 1, 0]),
  2: new Int8Array([-1, 0, 0, -1, 0, 1, 1, 0]),
})

const applyDefaultEpfStage1EdgePixel = (
  planes: readonly [Float32Array, Float32Array, Float32Array],
  output: readonly [Float32Array, Float32Array, Float32Array],
  stride: number,
  width: number,
  height: number,
  blockWidth: number,
  inverseSigmas: Float64Array<ArrayBufferLike>,
  blockRowOffset: number,
  x: number,
  y: number,
): void => {
  const coordinates = epfCandidateCoordinates[1]
  const scales = [40, 5, 3.5] as const
  const centerIndex = y * stride + x
  const inverseSigma = inverseSigmas[(blockRowOffset + (y >>> 3)) * blockWidth + (x >>> 3)] ?? 0
  if (inverseSigma < -3.9052429175127) {
    output[0][centerIndex] = planes[0][centerIndex] ?? 0
    output[1][centerIndex] = planes[1][centerIndex] ?? 0
    output[2][centerIndex] = planes[2][centerIndex] ?? 0
    return
  }
  const scaledInverseSigma =
    inverseSigma *
    1.65 *
    ((y & 7) === 0 || (y & 7) === 7 || (x & 7) === 0 || (x & 7) === 7 ? 2 / 3 : 1)
  let sum0 = planes[0][centerIndex] ?? 0
  let sum1 = planes[1][centerIndex] ?? 0
  let sum2 = planes[2][centerIndex] ?? 0
  let totalWeight = 1
  for (let coordinate = 0; coordinate < coordinates.length; coordinate += 2) {
    const offsetY = coordinates[coordinate] ?? 0
    const offsetX = coordinates[coordinate + 1] ?? 0
    let sad = 0
    for (let channel = 0; channel < 3; channel += 1) {
      const plane = planes[channel]!
      let channelSad = 0
      for (const patchOffset of epfPatchOffsets) {
        const patchY = patchOffset[0] ?? 0
        const patchX = patchOffset[1] ?? 0
        channelSad += Math.abs(
          epfSample(plane, stride, width, height, x + patchX, y + patchY) -
            epfSample(plane, stride, width, height, x + offsetX + patchX, y + offsetY + patchY),
        )
      }
      sad += channelSad * scales[channel]!
    }
    const weight = Math.max(0, 1 + sad * scaledInverseSigma)
    if (weight === 0) continue
    totalWeight += weight
    sum0 += weight * epfSample(planes[0], stride, width, height, x + offsetX, y + offsetY)
    sum1 += weight * epfSample(planes[1], stride, width, height, x + offsetX, y + offsetY)
    sum2 += weight * epfSample(planes[2], stride, width, height, x + offsetX, y + offsetY)
  }
  output[0][centerIndex] = sum0 / totalWeight
  output[1][centerIndex] = sum1 / totalWeight
  output[2][centerIndex] = sum2 / totalWeight
}

const applyDefaultEpfStage1InteriorRow = (
  planes: readonly [Float32Array, Float32Array, Float32Array],
  output: readonly [Float32Array, Float32Array, Float32Array],
  stride: number,
  width: number,
  blockWidth: number,
  inverseSigmas: Float64Array<ArrayBufferLike>,
  blockRowOffset: number,
  y: number,
  horizontalDifferences: Float32Array,
  verticalDifferences: Float32Array,
): void => {
  const plane0 = planes[0]
  const plane1 = planes[1]
  const plane2 = planes[2]
  const output0 = output[0]
  const output1 = output[1]
  const output2 = output[2]
  const row = y * stride
  const blockRow = (blockRowOffset + (y >>> 3)) * blockWidth
  const yBorder = (y & 7) === 0 || (y & 7) === 7
  for (let x = 2; x < width - 2; x += 1) {
    const inverseSigma = inverseSigmas[blockRow + (x >>> 3)] ?? 0
    const centerIndex = row + x
    if (inverseSigma < -3.9052429175127) {
      const end = Math.min(width - 2, x + 8 - (x & 7))
      for (let copyX = x; copyX < end; copyX += 1) {
        const index = row + copyX
        output0[index] = plane0[index]!
        output1[index] = plane1[index]!
        output2[index] = plane2[index]!
      }
      x = end - 1
      continue
    }
    const xBorder = (x & 7) === 0 || (x & 7) === 7
    const scaledInverseSigma = inverseSigma * 1.65 * (yBorder || xBorder ? 2 / 3 : 1)
    const left = centerIndex - 1
    const right = centerIndex + 1
    const top = centerIndex - stride
    const bottom = centerIndex + stride
    const sadLeft =
      horizontalDifferences[left]! +
      horizontalDifferences[left - 1]! +
      horizontalDifferences[top - 1]! +
      horizontalDifferences[centerIndex]! +
      horizontalDifferences[bottom - 1]!
    const sadTop =
      verticalDifferences[top]! +
      verticalDifferences[top - 1]! +
      verticalDifferences[top - stride]! +
      verticalDifferences[top + 1]! +
      verticalDifferences[centerIndex]!
    const sadRight =
      horizontalDifferences[centerIndex]! +
      horizontalDifferences[left]! +
      horizontalDifferences[top]! +
      horizontalDifferences[right]! +
      horizontalDifferences[bottom]!
    const sadBottom =
      verticalDifferences[centerIndex]! +
      verticalDifferences[left]! +
      verticalDifferences[top]! +
      verticalDifferences[right]! +
      verticalDifferences[bottom]!
    const weightLeft = Math.max(0, 1 + sadLeft * scaledInverseSigma)
    const weightTop = Math.max(0, 1 + sadTop * scaledInverseSigma)
    const weightRight = Math.max(0, 1 + sadRight * scaledInverseSigma)
    const weightBottom = Math.max(0, 1 + sadBottom * scaledInverseSigma)
    const totalWeight = 1 + weightLeft + weightTop + weightRight + weightBottom
    output0[centerIndex] =
      (plane0[centerIndex]! +
        weightLeft * plane0[centerIndex - 1]! +
        weightTop * plane0[centerIndex - stride]! +
        weightRight * plane0[centerIndex + 1]! +
        weightBottom * plane0[centerIndex + stride]!) /
      totalWeight
    output1[centerIndex] =
      (plane1[centerIndex]! +
        weightLeft * plane1[centerIndex - 1]! +
        weightTop * plane1[centerIndex - stride]! +
        weightRight * plane1[centerIndex + 1]! +
        weightBottom * plane1[centerIndex + stride]!) /
      totalWeight
    output2[centerIndex] =
      (plane2[centerIndex]! +
        weightLeft * plane2[centerIndex - 1]! +
        weightTop * plane2[centerIndex - stride]! +
        weightRight * plane2[centerIndex + 1]! +
        weightBottom * plane2[centerIndex + stride]!) /
      totalWeight
  }
}

const applyDefaultEpfStage1 = (
  planes: readonly [Float32Array, Float32Array, Float32Array],
  stride: number,
  width: number,
  height: number,
  blockWidth: number,
  inverseSigmas: Float64Array<ArrayBufferLike>,
  blockRowOffset: number,
  output: readonly [Float32Array, Float32Array, Float32Array],
  differences: readonly [Float32Array, Float32Array],
  imageHeight: number,
): void => {
  const horizontalDifferences = differences[0]
  const verticalDifferences = differences[1]
  const requiredLength = stride * height
  if (
    horizontalDifferences.length < requiredLength ||
    verticalDifferences.length < requiredLength
  ) {
    throw invalidInput('JPEG XL EPF difference scratch is too small')
  }
  const plane0 = planes[0]
  const plane1 = planes[1]
  const plane2 = planes[2]
  for (let y = 0; y < height - 1; y += 1) {
    const row = y * stride
    for (let x = 0; x < width - 1; x += 1) {
      const index = row + x
      const right = index + 1
      const bottom = index + stride
      horizontalDifferences[index] =
        Math.abs(plane0[index]! - plane0[right]!) * 40 +
        Math.abs(plane1[index]! - plane1[right]!) * 5 +
        Math.abs(plane2[index]! - plane2[right]!) * 3.5
      verticalDifferences[index] =
        Math.abs(plane0[index]! - plane0[bottom]!) * 40 +
        Math.abs(plane1[index]! - plane1[bottom]!) * 5 +
        Math.abs(plane2[index]! - plane2[bottom]!) * 3.5
    }
    const last = row + width - 1
    verticalDifferences[last] =
      Math.abs(plane0[last]! - plane0[last + stride]!) * 40 +
      Math.abs(plane1[last]! - plane1[last + stride]!) * 5 +
      Math.abs(plane2[last]! - plane2[last + stride]!) * 3.5
  }
  const lastRow = (height - 1) * stride
  for (let x = 0; x < width - 1; x += 1) {
    const index = lastRow + x
    horizontalDifferences[index] =
      Math.abs(plane0[index]! - plane0[index + 1]!) * 40 +
      Math.abs(plane1[index]! - plane1[index + 1]!) * 5 +
      Math.abs(plane2[index]! - plane2[index + 1]!) * 3.5
  }
  for (let y = 0; y < height; y += 1) {
    if (y < 2 || y >= height - 2) {
      const imageY = blockRowOffset * 8 + y
      if (imageY >= 2 && imageY < imageHeight - 2) {
        const row = y * stride
        output[0].set(planes[0].subarray(row, row + width), row)
        output[1].set(planes[1].subarray(row, row + width), row)
        output[2].set(planes[2].subarray(row, row + width), row)
        continue
      }
    }
    if (y >= 2 && y < height - 2 && width > 4) {
      applyDefaultEpfStage1InteriorRow(
        planes,
        output,
        stride,
        width,
        blockWidth,
        inverseSigmas,
        blockRowOffset,
        y,
        horizontalDifferences,
        verticalDifferences,
      )
      applyDefaultEpfStage1EdgePixel(
        planes,
        output,
        stride,
        width,
        height,
        blockWidth,
        inverseSigmas,
        blockRowOffset,
        0,
        y,
      )
      applyDefaultEpfStage1EdgePixel(
        planes,
        output,
        stride,
        width,
        height,
        blockWidth,
        inverseSigmas,
        blockRowOffset,
        1,
        y,
      )
      applyDefaultEpfStage1EdgePixel(
        planes,
        output,
        stride,
        width,
        height,
        blockWidth,
        inverseSigmas,
        blockRowOffset,
        width - 2,
        y,
      )
      applyDefaultEpfStage1EdgePixel(
        planes,
        output,
        stride,
        width,
        height,
        blockWidth,
        inverseSigmas,
        blockRowOffset,
        width - 1,
        y,
      )
      continue
    }
    for (let x = 0; x < width; x += 1) {
      applyDefaultEpfStage1EdgePixel(
        planes,
        output,
        stride,
        width,
        height,
        blockWidth,
        inverseSigmas,
        blockRowOffset,
        x,
        y,
      )
    }
  }
}

const applyDefaultEpfStage2 = (
  planes: readonly [Float32Array, Float32Array, Float32Array],
  stride: number,
  width: number,
  height: number,
  blockWidth: number,
  inverseSigmas: Float64Array<ArrayBufferLike>,
  blockRowOffset: number,
  output: readonly [Float32Array, Float32Array, Float32Array],
  imageHeight: number,
): void => {
  const coordinates = epfCandidateCoordinates[2]
  const stageScale = 6.5 * 1.65
  const plane0 = planes[0]
  const plane1 = planes[1]
  const plane2 = planes[2]
  const output0 = output[0]
  const output1 = output[1]
  const output2 = output[2]
  for (let y = 0; y < height; y += 1) {
    if (y === 0 || y === height - 1) {
      const imageY = blockRowOffset * 8 + y
      if (imageY > 0 && imageY < imageHeight - 1) {
        const row = y * stride
        output0.set(plane0.subarray(row, row + width), row)
        output1.set(plane1.subarray(row, row + width), row)
        output2.set(plane2.subarray(row, row + width), row)
        continue
      }
    }
    const blockRow = (blockRowOffset + (y >>> 3)) * blockWidth
    const yBorder = (y & 7) === 0 || (y & 7) === 7
    for (let x = 0; x < width; x += 1) {
      const inverseSigma = inverseSigmas[blockRow + (x >>> 3)] ?? 0
      const outputIndex = y * stride + x
      const centerIndex = y * stride + x
      const center0 = plane0[centerIndex] ?? 0
      const center1 = plane1[centerIndex] ?? 0
      const center2 = plane2[centerIndex] ?? 0
      if (inverseSigma < -3.9052429175127) {
        const end = Math.min(width, x + 8 - (x & 7))
        for (let copyX = x; copyX < end; copyX += 1) {
          const sourceIndex = y * stride + copyX
          const targetIndex = y * stride + copyX
          output0[targetIndex] = plane0[sourceIndex] ?? 0
          output1[targetIndex] = plane1[sourceIndex] ?? 0
          output2[targetIndex] = plane2[sourceIndex] ?? 0
        }
        x = end - 1
        continue
      }
      const xBorder = (x & 7) === 0 || (x & 7) === 7
      const scaledInverseSigma = inverseSigma * stageScale * (yBorder || xBorder ? 2 / 3 : 1)
      const interior = x > 0 && x < width - 1 && y > 0 && y < height - 1
      if (interior) {
        const top = centerIndex - stride
        const left = centerIndex - 1
        const right = centerIndex + 1
        const bottom = centerIndex + stride
        const weightTop = Math.max(
          0,
          1 +
            (Math.abs(plane0[top]! - center0) * 40 +
              Math.abs(plane1[top]! - center1) * 5 +
              Math.abs(plane2[top]! - center2) * 3.5) *
              scaledInverseSigma,
        )
        const weightLeft = Math.max(
          0,
          1 +
            (Math.abs(plane0[left]! - center0) * 40 +
              Math.abs(plane1[left]! - center1) * 5 +
              Math.abs(plane2[left]! - center2) * 3.5) *
              scaledInverseSigma,
        )
        const weightRight = Math.max(
          0,
          1 +
            (Math.abs(plane0[right]! - center0) * 40 +
              Math.abs(plane1[right]! - center1) * 5 +
              Math.abs(plane2[right]! - center2) * 3.5) *
              scaledInverseSigma,
        )
        const weightBottom = Math.max(
          0,
          1 +
            (Math.abs(plane0[bottom]! - center0) * 40 +
              Math.abs(plane1[bottom]! - center1) * 5 +
              Math.abs(plane2[bottom]! - center2) * 3.5) *
              scaledInverseSigma,
        )
        const totalWeight = 1 + weightTop + weightLeft + weightRight + weightBottom
        output0[outputIndex] =
          (center0 +
            weightTop * plane0[top]! +
            weightLeft * plane0[left]! +
            weightRight * plane0[right]! +
            weightBottom * plane0[bottom]!) /
          totalWeight
        output1[outputIndex] =
          (center1 +
            weightTop * plane1[top]! +
            weightLeft * plane1[left]! +
            weightRight * plane1[right]! +
            weightBottom * plane1[bottom]!) /
          totalWeight
        output2[outputIndex] =
          (center2 +
            weightTop * plane2[top]! +
            weightLeft * plane2[left]! +
            weightRight * plane2[right]! +
            weightBottom * plane2[bottom]!) /
          totalWeight
        continue
      }
      let sum0 = center0
      let sum1 = center1
      let sum2 = center2
      let totalWeight = 1
      for (let coordinate = 0; coordinate < coordinates.length; coordinate += 2) {
        const offsetY = coordinates[coordinate] ?? 0
        const offsetX = coordinates[coordinate + 1] ?? 0
        const candidateIndex = centerIndex + offsetY * stride + offsetX
        const candidate0 = interior
          ? (plane0[candidateIndex] ?? 0)
          : epfSample(plane0, stride, width, height, x + offsetX, y + offsetY)
        const candidate1 = interior
          ? (plane1[candidateIndex] ?? 0)
          : epfSample(plane1, stride, width, height, x + offsetX, y + offsetY)
        const candidate2 = interior
          ? (plane2[candidateIndex] ?? 0)
          : epfSample(plane2, stride, width, height, x + offsetX, y + offsetY)
        const sad =
          Math.abs(candidate0 - center0) * 40 +
          Math.abs(candidate1 - center1) * 5 +
          Math.abs(candidate2 - center2) * 3.5
        const weight = Math.max(0, 1 + sad * scaledInverseSigma)
        if (weight === 0) continue
        totalWeight += weight
        sum0 += weight * candidate0
        sum1 += weight * candidate1
        sum2 += weight * candidate2
      }
      output0[outputIndex] = sum0 / totalWeight
      output1[outputIndex] = sum1 / totalWeight
      output2[outputIndex] = sum2 / totalWeight
    }
  }
}

const applyDefaultEpfStage0EdgePixel = (
  planes: readonly [Float32Array, Float32Array, Float32Array],
  output: readonly [Float32Array, Float32Array, Float32Array],
  stride: number,
  width: number,
  height: number,
  blockWidth: number,
  inverseSigmas: Float64Array<ArrayBufferLike>,
  blockRowOffset: number,
  x: number,
  y: number,
): void => {
  const centerIndex = y * stride + x
  const inverseSigma = inverseSigmas[(blockRowOffset + (y >>> 3)) * blockWidth + (x >>> 3)] ?? 0
  if (inverseSigma < -3.9052429175127) {
    output[0][centerIndex] = planes[0][centerIndex] ?? 0
    output[1][centerIndex] = planes[1][centerIndex] ?? 0
    output[2][centerIndex] = planes[2][centerIndex] ?? 0
    return
  }
  const blockBorder = (x & 7) === 0 || (x & 7) === 7 || (y & 7) === 0 || (y & 7) === 7
  const scaledInverseSigma = inverseSigma * 0.9 * 1.65 * (blockBorder ? 2 / 3 : 1)
  let sum0 = planes[0][centerIndex] ?? 0
  let sum1 = planes[1][centerIndex] ?? 0
  let sum2 = planes[2][centerIndex] ?? 0
  let totalWeight = 1
  const coordinates = epfCandidateCoordinates[0]
  for (let coordinate = 0; coordinate < coordinates.length; coordinate += 2) {
    const offsetY = coordinates[coordinate] ?? 0
    const offsetX = coordinates[coordinate + 1] ?? 0
    let sad = 0
    for (let channel = 0; channel < 3; channel += 1) {
      const plane = planes[channel]!
      const scale = channel === 0 ? 40 : channel === 1 ? 5 : 3.5
      let channelSad = 0
      for (const patchOffset of epfPatchOffsets) {
        const patchY = patchOffset[0] ?? 0
        const patchX = patchOffset[1] ?? 0
        channelSad += Math.abs(
          epfSample(plane, stride, width, height, x + patchX, y + patchY) -
            epfSample(plane, stride, width, height, x + offsetX + patchX, y + offsetY + patchY),
        )
      }
      sad += channelSad * scale
    }
    const weight = Math.max(0, 1 + sad * scaledInverseSigma)
    if (weight === 0) continue
    totalWeight += weight
    sum0 += weight * epfSample(planes[0], stride, width, height, x + offsetX, y + offsetY)
    sum1 += weight * epfSample(planes[1], stride, width, height, x + offsetX, y + offsetY)
    sum2 += weight * epfSample(planes[2], stride, width, height, x + offsetX, y + offsetY)
  }
  output[0][centerIndex] = sum0 / totalWeight
  output[1][centerIndex] = sum1 / totalWeight
  output[2][centerIndex] = sum2 / totalWeight
}

const applyDefaultEpfStage0 = (
  planes: readonly [Float32Array, Float32Array, Float32Array],
  stride: number,
  width: number,
  height: number,
  blockWidth: number,
  inverseSigmas: Float64Array<ArrayBufferLike>,
  blockRowOffset: number,
  output: readonly [Float32Array, Float32Array, Float32Array],
  scratch: readonly [Float32Array, Float32Array],
  imageHeight: number,
): void => {
  const requiredLength = stride * height
  const differences = scratch[0]
  const totalWeights = scratch[1]
  if (differences.length < requiredLength || totalWeights.length < requiredLength) {
    throw invalidInput('JPEG XL EPF difference scratch is too small')
  }
  const plane0 = planes[0]
  const plane1 = planes[1]
  const plane2 = planes[2]
  const output0 = output[0]
  const output1 = output[1]
  const output2 = output[2]
  output0.set(plane0.subarray(0, requiredLength))
  output1.set(plane1.subarray(0, requiredLength))
  output2.set(plane2.subarray(0, requiredLength))
  totalWeights.fill(1, 0, requiredLength)
  const coordinates = epfCandidateCoordinates[0]
  for (let coordinate = 0; coordinate < coordinates.length; coordinate += 2) {
    const offsetY = coordinates[coordinate] ?? 0
    const offsetX = coordinates[coordinate + 1] ?? 0
    const startY = Math.max(0, -offsetY)
    const endY = Math.min(height, height - offsetY)
    const startX = Math.max(0, -offsetX)
    const endX = Math.min(width, width - offsetX)
    for (let y = startY; y < endY; y += 1) {
      let index = y * stride + startX
      let candidateIndex = (y + offsetY) * stride + startX + offsetX
      for (let x = startX; x < endX; x += 1) {
        differences[index] =
          Math.abs(plane0[index]! - plane0[candidateIndex]!) * 40 +
          Math.abs(plane1[index]! - plane1[candidateIndex]!) * 5 +
          Math.abs(plane2[index]! - plane2[candidateIndex]!) * 3.5
        index += 1
        candidateIndex += 1
      }
    }
    for (let y = 3; y < height - 3; y += 1) {
      const row = y * stride
      const blockRow = (blockRowOffset + (y >>> 3)) * blockWidth
      const yBorder = (y & 7) === 0 || (y & 7) === 7
      for (let x = 3; x < width - 3; x += 1) {
        const inverseSigma = inverseSigmas[blockRow + (x >>> 3)] ?? 0
        if (inverseSigma < -3.9052429175127) continue
        const centerIndex = row + x
        const sad =
          differences[centerIndex]! +
          differences[centerIndex - 1]! +
          differences[centerIndex + 1]! +
          differences[centerIndex - stride]! +
          differences[centerIndex + stride]!
        const xBorder = (x & 7) === 0 || (x & 7) === 7
        const scaledInverseSigma = inverseSigma * 0.9 * 1.65 * (yBorder || xBorder ? 2 / 3 : 1)
        const weight = Math.max(0, 1 + sad * scaledInverseSigma)
        if (weight === 0) continue
        const candidateIndex = centerIndex + offsetY * stride + offsetX
        totalWeights[centerIndex] = totalWeights[centerIndex]! + weight
        output0[centerIndex] = output0[centerIndex]! + weight * plane0[candidateIndex]!
        output1[centerIndex] = output1[centerIndex]! + weight * plane1[candidateIndex]!
        output2[centerIndex] = output2[centerIndex]! + weight * plane2[candidateIndex]!
      }
    }
  }
  for (let y = 3; y < height - 3; y += 1) {
    const row = y * stride
    for (let x = 3; x < width - 3; x += 1) {
      const index = row + x
      const weight = totalWeights[index]!
      output0[index] = output0[index]! / weight
      output1[index] = output1[index]! / weight
      output2[index] = output2[index]! / weight
    }
  }
  for (let y = 0; y < height; y += 1) {
    if (y < 3 || y >= height - 3 || width <= 6) {
      const imageY = blockRowOffset * 8 + y
      if (width > 6 && imageY >= 3 && imageY < imageHeight - 3) continue
      for (let x = 0; x < width; x += 1) {
        applyDefaultEpfStage0EdgePixel(
          planes,
          output,
          stride,
          width,
          height,
          blockWidth,
          inverseSigmas,
          blockRowOffset,
          x,
          y,
        )
      }
      continue
    }
    for (let x = 0; x < 3; x += 1) {
      applyDefaultEpfStage0EdgePixel(
        planes,
        output,
        stride,
        width,
        height,
        blockWidth,
        inverseSigmas,
        blockRowOffset,
        x,
        y,
      )
    }
    for (let x = width - 3; x < width; x += 1) {
      applyDefaultEpfStage0EdgePixel(
        planes,
        output,
        stride,
        width,
        height,
        blockWidth,
        inverseSigmas,
        blockRowOffset,
        x,
        y,
      )
    }
  }
}

const applyDefaultEpfStage = (
  planes: readonly [Float32Array, Float32Array, Float32Array],
  stride: number,
  width: number,
  height: number,
  blockWidth: number,
  inverseSigmas: Float64Array<ArrayBufferLike>,
  stage: 0 | 1 | 2,
  blockRowOffset = 0,
  output: readonly [Float32Array, Float32Array, Float32Array] = [
    new Float32Array(stride * height),
    new Float32Array(stride * height),
    new Float32Array(stride * height),
  ],
  stage1Differences?: readonly [Float32Array, Float32Array],
  imageHeight = height,
): void => {
  const requiredOutputLength = stride * height
  if (output.some((plane) => plane.length < requiredOutputLength)) {
    throw invalidInput('JPEG XL EPF output scratch is too small')
  }
  if (stage === 0) {
    applyDefaultEpfStage0(
      planes,
      stride,
      width,
      height,
      blockWidth,
      inverseSigmas,
      blockRowOffset,
      output,
      stage1Differences ?? [new Float32Array(stride * height), new Float32Array(stride * height)],
      imageHeight,
    )
    planes[0].set(output[0].subarray(0, requiredOutputLength))
    planes[1].set(output[1].subarray(0, requiredOutputLength))
    planes[2].set(output[2].subarray(0, requiredOutputLength))
    return
  }
  if (stage === 1) {
    applyDefaultEpfStage1(
      planes,
      stride,
      width,
      height,
      blockWidth,
      inverseSigmas,
      blockRowOffset,
      output,
      stage1Differences ?? [new Float32Array(stride * height), new Float32Array(stride * height)],
      imageHeight,
    )
  } else if (stage === 2) {
    applyDefaultEpfStage2(
      planes,
      stride,
      width,
      height,
      blockWidth,
      inverseSigmas,
      blockRowOffset,
      output,
      imageHeight,
    )
  }
  for (let channel = 0; channel < 3; channel += 1) {
    const plane = planes[channel]
    const filtered = output[channel]
    if (!plane || !filtered) throw invalidInput('JPEG XL EPF output plane is missing')
    plane.set(filtered.subarray(0, stride * height))
  }
}

const makeEpfInverseSigmas = (
  quantization: Int32Array<ArrayBufferLike>,
  sharpness: Int32Array<ArrayBufferLike>,
  globalScale: number,
): Float64Array => {
  const quantScale = globalScale / 65_536
  const inverseSigmas = new Float64Array(quantization.length)
  for (let blockIndex = 0; blockIndex < quantization.length; blockIndex += 1) {
    const quant = quantization[blockIndex]
    const sharp = sharpness[blockIndex]
    if (quant === undefined || sharp === undefined || quant < 1 || sharp < 0 || sharp > 7) {
      throw invalidInput('JPEG XL EPF block metadata is invalid')
    }
    const sigma = Math.min(-1e-4, (0.46 / (quantScale * quant * -1.17157287525381)) * (sharp / 7))
    inverseSigmas[blockIndex] = 1 / sigma
  }
  return inverseSigmas
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

const srgbByteThresholds = Float64Array.from({ length: 255 }, (_, byte) => {
  const encoded = (byte + 0.5) / 255
  return encoded <= 0.04045 ? encoded / 12.92 : ((encoded + 0.055) / 1.055) ** 2.4
})

const linearByteLut = Uint8Array.from({ length: 65_537 }, (_, index) => {
  const value = index / 65_536
  let low = 0
  let high = 255
  while (low + 1 < high) {
    const middle = (low + high) >>> 1
    if (value < (srgbByteThresholds[middle] ?? 1)) high = middle
    else low = middle
  }
  return high
})

const defaultUpsampling2Weights = Float64Array.from([
  -0.017162, -0.03452303, -0.04022174, -0.02921014, -0.00624645, 0.14111091, 0.28896755, 0.00278718,
  -0.01610267, 0.5666155, 0.03777607, -0.01986694, -0.03144731, -0.01185068, -0.00213539,
])

const defaultUpsampling4Weights = Float64Array.from([
  -0.02419067, -0.03491987, -0.03693351, -0.03094285, -0.00529785, -0.01663432, -0.03556863,
  -0.03888905, -0.0351685, -0.00989469, 0.23651958, 0.33392945, -0.01073543, -0.01313181,
  -0.03556694, 0.13048175, 0.40103025, 0.0395115, -0.02077584, 0.46914198, -0.0020927, -0.01484589,
  -0.04064806, 0.1894253, 0.56279892, 0.066744, -0.02335494, -0.03551682, -0.0075483, -0.02267919,
  -0.02363578, 0.00315804, -0.03399098, -0.01359519, -0.00091653, -0.00335467, -0.01163294,
  -0.01610294, -0.00974088, -0.00191622, -0.01095446, -0.03198464, -0.04455121, -0.0279979,
  -0.00645912, 0.06390599, 0.22963888, 0.00630981, -0.01897349, 0.67537268, 0.08483369, -0.02534994,
  -0.02205197, -0.01667999, -0.00384443,
])

const defaultUpsampling8Weights = Float64Array.from([
  -0.02928613, -0.03706353, -0.03783812, -0.03324558, -0.00447632, -0.02519406, -0.03752601,
  -0.03901508, -0.03663285, -0.00646649, -0.02066407, -0.03838633, -0.04002101, -0.03900035,
  -0.00901973, -0.01626393, -0.03954148, -0.0404662, -0.03979621, -0.01224485, 0.29895328,
  0.35757708, -0.02447552, -0.01081748, -0.04314594, 0.23903219, 0.41119301, -0.00573046,
  -0.01450239, -0.04246845, 0.17567618, 0.45220643, 0.02287757, -0.01936783, -0.03583255,
  0.11572472, 0.47416733, 0.0628444, -0.02685066, 0.4272005, -0.02248939, -0.01155273, -0.04562755,
  0.28689496, 0.49093869, -0.00007891, -0.01545926, -0.04562659, 0.2123892, 0.53980934, 0.03369474,
  -0.02070211, -0.03866988, 0.1422955, 0.56593398, 0.08045181, -0.02888298, -0.03680918,
  -0.00542229, -0.02920477, -0.02788574, -0.0211818, -0.03942402, -0.00775547, -0.02433614,
  -0.03193943, -0.02030828, -0.04044014, -0.01074016, -0.01930822, -0.03620399, -0.01974125,
  -0.03919545, -0.01456093, -0.00045072, -0.0036011, -0.01020207, -0.01231907, -0.00638988,
  -0.00071592, -0.00279122, -0.00957115, -0.01288327, -0.00730937, -0.00107783, -0.00210156,
  -0.00890705, -0.01317668, -0.00813895, -0.00153491, -0.02128481, -0.04173044, -0.04831487,
  -0.0329319, -0.0052526, -0.01720322, -0.04052736, -0.05045706, -0.03607317, -0.0073803,
  -0.01341764, -0.03965629, -0.05151616, -0.03814886, -0.01005819, 0.18968273, 0.33063684,
  -0.01300105, -0.0137295, -0.04017465, 0.13727832, 0.36402234, 0.0102789, -0.01832107, -0.03365072,
  0.08734506, 0.38194295, 0.04338228, -0.02525993, 0.56408126, 0.00458352, -0.01648227, -0.04887868,
  0.24585519, 0.62026135, 0.04314807, -0.02213737, -0.04158014, 0.16637289, 0.65027023, 0.09621636,
  -0.03101388, -0.04082742, -0.00904519, -0.02790922, -0.02117818, 0.00798662, -0.03995711,
  -0.01243427, -0.02231705, -0.02946266, 0.00992055, -0.03600283, -0.0168492, -0.00111684,
  -0.00411204, -0.0129713, -0.01723725, -0.01022545, -0.00165306, -0.0031311, -0.01218016,
  -0.01763266, -0.0112562, -0.00231663, -0.01374149, -0.0379762, -0.05142937, -0.03117307,
  -0.00581914, -0.01064003, -0.03608089, -0.05272168, -0.0337567, -0.00795586, 0.09628104,
  0.27129991, -0.00353779, -0.01734151, -0.03153981, 0.0568623, 0.28500998, 0.02230594, -0.02374955,
  0.68214326, 0.05018048, -0.02320852, -0.04383616, 0.18459474, 0.71517975, 0.10805613, -0.03263677,
  -0.03637639, -0.01394373, -0.02511203, -0.01728636, 0.05407331, -0.02867568, -0.01893131,
  -0.00240854, -0.00446511, -0.01636187, -0.02377053, -0.01522848, -0.00333334, -0.00819975,
  -0.02964169, -0.04499287, -0.0274535, -0.00612408, 0.02727416, 0.194466, 0.00159832, -0.02232473,
  0.74982506, 0.1145262, -0.03348048, -0.01605681, -0.02070339, -0.00458223,
])

const makeUpsamplingKernel = (factor: 2 | 4 | 8, weights: Float64Array): Float64Array => {
  const kernel = new Float64Array(factor * factor * 25)
  const half = factor / 2
  for (let kernelY = 0; kernelY < half; kernelY += 1) {
    for (let kernelX = 0; kernelX < half; kernelX += 1) {
      for (let sourceY = 0; sourceY < 5; sourceY += 1) {
        for (let sourceX = 0; sourceX < 5; sourceX += 1) {
          const first = 5 * kernelY + sourceY
          const second = 5 * kernelX + sourceX
          const low = Math.min(first, second)
          const high = Math.max(first, second)
          const weight = weights[5 * half * low - (low * (low - 1)) / 2 + high - low] ?? 0
          const topLeft = (kernelY * factor + kernelX) * 25
          const topRight = (kernelY * factor + factor - 1 - kernelX) * 25
          const bottomLeft = ((factor - 1 - kernelY) * factor + kernelX) * 25
          const bottomRight = ((factor - 1 - kernelY) * factor + factor - 1 - kernelX) * 25
          kernel[topLeft + sourceY * 5 + sourceX] = weight
          kernel[topRight + sourceY * 5 + 4 - sourceX] = weight
          kernel[bottomLeft + (4 - sourceY) * 5 + sourceX] = weight
          kernel[bottomRight + (4 - sourceY) * 5 + 4 - sourceX] = weight
        }
      }
    }
  }
  return kernel
}

const upsamplingKernels = Object.freeze({
  2: makeUpsamplingKernel(2, defaultUpsampling2Weights),
  4: makeUpsamplingKernel(4, defaultUpsampling4Weights),
  8: makeUpsamplingKernel(8, defaultUpsampling8Weights),
})

const upsampleSample = (
  plane: Float32Array,
  stride: number,
  width: number,
  height: number,
  x: number,
  y: number,
  factor: 1 | 2 | 4 | 8,
): number => {
  if (factor === 1) return plane[y * stride + x] ?? 0
  const sourceX = Math.floor(x / factor)
  const sourceY = Math.floor(y / factor)
  const kernelOffset = ((y % factor) * factor + (x % factor)) * 25
  const kernel = upsamplingKernels[factor]
  let sum = 0
  let minimum = Infinity
  let maximum = -Infinity
  let weightIndex = kernelOffset
  for (let offsetY = -2; offsetY <= 2; offsetY += 1) {
    const row = mirroredIndex(sourceY + offsetY, height) * stride
    for (let offsetX = -2; offsetX <= 2; offsetX += 1) {
      const sample = plane[row + mirroredIndex(sourceX + offsetX, width)] ?? 0
      minimum = Math.min(minimum, sample)
      maximum = Math.max(maximum, sample)
      sum += sample * (kernel[weightIndex] ?? 0)
      weightIndex += 1
    }
  }
  return Math.max(minimum, Math.min(maximum, sum))
}

const byteFromLinear = (value: number): number => {
  if (value <= 0) return 0
  if (value >= 1) return 255
  return linearByteLut[Math.round(value * 65_536)] ?? 0
}

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

const mergeProgressiveAcGroup = (
  target: Readonly<JpegXlJpegAcGroup>,
  additional: Readonly<JpegXlJpegAcGroup>,
): void => {
  if (target.vardctCoefficientOffsets.length !== additional.vardctCoefficientOffsets.length) {
    throw invalidInput('JPEG XL progressive AC block count is inconsistent')
  }
  for (let index = 0; index < target.vardctCoefficientOffsets.length; index += 1) {
    if (target.vardctCoefficientOffsets[index] !== additional.vardctCoefficientOffsets[index]) {
      throw invalidInput('JPEG XL progressive AC coefficient layout is inconsistent')
    }
  }
  for (let channel = 0; channel < 3; channel += 1) {
    const targetCoefficients = target.vardctCoefficientArenas[channel]
    const additionalCoefficients = additional.vardctCoefficientArenas[channel]
    if (
      !targetCoefficients ||
      !additionalCoefficients ||
      targetCoefficients.length !== additionalCoefficients.length
    ) {
      throw invalidInput('JPEG XL progressive AC coefficient plane is inconsistent')
    }
    for (let position = 0; position < targetCoefficients.length; position += 1) {
      const coefficient =
        (targetCoefficients[position] ?? 0) + (additionalCoefficients[position] ?? 0)
      if (coefficient < -2_147_483_648 || coefficient > 2_147_483_647) {
        throw invalidInput('JPEG XL progressive AC coefficient exceeds the signed 32-bit range')
      }
      targetCoefficients[position] = coefficient
    }
  }
}

const copyPlaneRegion = (
  source: ArrayLike<number>,
  sourceWidth: number,
  destination: Float64Array | Int32Array | Uint8Array,
  destinationWidth: number,
  destinationX: number,
  destinationY: number,
  width: number,
  height: number,
): void => {
  for (let y = 0; y < height; y += 1) {
    const sourceOffset = y * sourceWidth
    const destinationOffset = (destinationY + y) * destinationWidth + destinationX
    for (let x = 0; x < width; x += 1) {
      const value = source[sourceOffset + x]
      if (value === undefined) throw invalidInput('JPEG XL VarDCT LF group plane is truncated')
      destination[destinationOffset + x] = value
    }
  }
}

const decodeJpegXlVarDctDcGroups = (
  sections: readonly Uint8Array[],
  frame: Readonly<JpegXlFrameStructure>,
  lfGlobal: ReturnType<typeof decodeJpegXlJpegLfGlobal>,
  blockWidth: number,
  blockHeight: number,
  separatedSections: boolean,
  memory: JpegXlVarDctMemoryLedger,
  globalSectionEnd: number,
  externalDcPlanes?: readonly [Float64Array, Float64Array, Float64Array],
): Readonly<{ group: JpegXlJpegDcGroup; lease: JpegXlVarDctMemoryLease }> => {
  if (!separatedSections) {
    const decoded = decodeJpegXlJpegDcGroup(
      sections[0] ?? new Uint8Array(),
      {
        blockWidth,
        blockHeight,
        chromaSubsampling: frame.chromaSubsampling,
        groupId: 0,
        dcGroupCount: 1,
      },
      lfGlobal.globalModularCode,
      globalSectionEnd,
      false,
      externalDcPlanes,
    )
    return Object.freeze({
      group: decoded,
      lease: memory.retain(
        'jpegxl-vardct-dc-planes-and-metadata',
        retainedTypedArrayBytes(decoded) -
          (externalDcPlanes?.reduce((total, plane) => total + plane.byteLength, 0) ?? 0),
      ),
    })
  }

  const dcGroupBlockDimension = frame.groupDimension
  const dcGroupsAcross = Math.ceil(blockWidth / dcGroupBlockDimension)
  const expectedDcGroups = dcGroupsAcross * Math.ceil(blockHeight / dcGroupBlockDimension)
  if (expectedDcGroups !== frame.dcGroupCount) {
    throw invalidInput('JPEG XL VarDCT LF group geometry is inconsistent')
  }
  const blockCount = blockWidth * blockHeight
  const correlationWidth = Math.ceil(blockWidth / 8)
  const correlationHeight = Math.ceil(blockHeight / 8)
  const assembled: JpegXlJpegDcGroup = {
    blockWidth,
    blockHeight,
    dcCoefficients: Object.freeze([
      new Float64Array(blockCount),
      new Float64Array(blockCount),
      new Float64Array(blockCount),
    ]),
    extraPrecision: 0,
    strategies: new Uint8Array(blockCount),
    strategyFirstBlocks: new Uint8Array(blockCount),
    quantization: new Int32Array(blockCount),
    sharpness: new Int32Array(blockCount),
    colorCorrelationX: new Int32Array(correlationWidth * correlationHeight),
    colorCorrelationB: new Int32Array(correlationWidth * correlationHeight),
    endingBitPosition: 0,
  }
  const assembledLease = memory.retain(
    'jpegxl-vardct-dc-planes-and-metadata',
    retainedTypedArrayBytes(assembled),
  )
  for (let groupId = 0; groupId < frame.dcGroupCount; groupId += 1) {
    const groupX = (groupId % dcGroupsAcross) * dcGroupBlockDimension
    const groupY = Math.floor(groupId / dcGroupsAcross) * dcGroupBlockDimension
    const groupWidth = Math.min(dcGroupBlockDimension, blockWidth - groupX)
    const groupHeight = Math.min(dcGroupBlockDimension, blockHeight - groupY)
    const groupSection = sections[1 + groupId]
    if (!groupSection) throw invalidInput('JPEG XL VarDCT LF group section is missing')
    let externalGroupPlanes: readonly [Float64Array, Float64Array, Float64Array] | undefined
    if (externalDcPlanes) {
      const slices = externalDcPlanes.map((plane) => {
        const output = new Float64Array(groupWidth * groupHeight)
        for (let y = 0; y < groupHeight; y += 1) {
          output.set(
            plane.subarray(
              (groupY + y) * blockWidth + groupX,
              (groupY + y) * blockWidth + groupX + groupWidth,
            ),
            y * groupWidth,
          )
        }
        return output
      })
      const first = slices[0]
      const second = slices[1]
      const third = slices[2]
      if (!first || !second || !third) {
        throw invalidInput('JPEG XL external DC frame plane is missing')
      }
      externalGroupPlanes = Object.freeze([first, second, third])
    }
    const decoded = decodeJpegXlJpegDcGroup(
      groupSection,
      {
        blockWidth: groupWidth,
        blockHeight: groupHeight,
        chromaSubsampling: frame.chromaSubsampling,
        groupId,
        dcGroupCount: frame.dcGroupCount,
      },
      lfGlobal.globalModularCode,
      0,
      true,
      externalGroupPlanes,
    )
    const decodedLease = memory.retain(
      `jpegxl-vardct-lf-group-${groupId}`,
      retainedTypedArrayBytes(decoded),
    )
    for (let channel = 0; channel < 3; channel += 1) {
      const source = decoded.dcCoefficients[channel]
      const destination = assembled.dcCoefficients[channel]
      if (!source || !destination) throw invalidInput('JPEG XL VarDCT DC plane is missing')
      copyPlaneRegion(
        source,
        groupWidth,
        destination,
        blockWidth,
        groupX,
        groupY,
        groupWidth,
        groupHeight,
      )
    }
    copyPlaneRegion(
      decoded.strategies,
      groupWidth,
      assembled.strategies,
      blockWidth,
      groupX,
      groupY,
      groupWidth,
      groupHeight,
    )
    copyPlaneRegion(
      decoded.strategyFirstBlocks,
      groupWidth,
      assembled.strategyFirstBlocks,
      blockWidth,
      groupX,
      groupY,
      groupWidth,
      groupHeight,
    )
    copyPlaneRegion(
      decoded.quantization,
      groupWidth,
      assembled.quantization,
      blockWidth,
      groupX,
      groupY,
      groupWidth,
      groupHeight,
    )
    copyPlaneRegion(
      decoded.sharpness,
      groupWidth,
      assembled.sharpness,
      blockWidth,
      groupX,
      groupY,
      groupWidth,
      groupHeight,
    )
    const localCorrelationWidth = Math.ceil(groupWidth / 8)
    const localCorrelationHeight = Math.ceil(groupHeight / 8)
    const correlationX = Math.floor(groupX / 8)
    const correlationY = Math.floor(groupY / 8)
    copyPlaneRegion(
      decoded.colorCorrelationX,
      localCorrelationWidth,
      assembled.colorCorrelationX,
      correlationWidth,
      correlationX,
      correlationY,
      localCorrelationWidth,
      localCorrelationHeight,
    )
    copyPlaneRegion(
      decoded.colorCorrelationB,
      localCorrelationWidth,
      assembled.colorCorrelationB,
      correlationWidth,
      correlationX,
      correlationY,
      localCorrelationWidth,
      localCorrelationHeight,
    )
    decodedLease.release()
  }
  return Object.freeze({ group: Object.freeze(assembled), lease: assembledLease })
}

interface JpegXlVarDctBand {
  readonly blockY: number
  readonly pixelY: number
  readonly height: number
  readonly planes: readonly [Float32Array, Float32Array, Float32Array]
  readonly topEdges: readonly [Float32Array, Float32Array, Float32Array]
  readonly bottomEdges: readonly [Float32Array, Float32Array, Float32Array]
  readonly lease: JpegXlVarDctMemoryLease
}

const decodeJpegXlDct8Striped = (
  allSections: readonly Uint8Array[],
  frame: Readonly<JpegXlFrameStructure>,
  memory: JpegXlVarDctMemoryLedger,
  lfGlobal: Readonly<JpegXlJpegLfGlobal>,
  hfGlobal: Readonly<JpegXlJpegHfGlobal>,
  dcGroup: Readonly<JpegXlJpegDcGroup>,
  lfGlobalLease: JpegXlVarDctMemoryLease,
  hfGlobalLease: JpegXlVarDctMemoryLease,
  dcGroupLease: JpegXlVarDctMemoryLease,
): JpegXlVarDctPixels => {
  const codedWidth = frame.codedWidth
  const codedHeight = frame.codedHeight
  const blockWidth = Math.ceil(codedWidth / 8)
  const blockHeight = Math.ceil(codedHeight / 8)
  const paddedWidth = blockWidth * 8
  const groupCount = frame.groupsAcross * frame.groupsDown
  const groupBlockDimension = frame.groupDimension / 8
  const outputChannels = frame.colorChannels === 1 ? 1 : 3
  const outputLease = memory.retain(
    'jpegxl-vardct-output-pixels',
    frame.width * frame.height * outputChannels,
  )
  const output = new Uint8Array(frame.width * frame.height * outputChannels)
  const transformScratchLease = memory.retain(
    'jpegxl-vardct-transform-scratch',
    4 * 4_096 * 8 + 3 * 64 * 8 + 64 * 2,
  )
  const blockCoefficients = [
    new Float64Array(4_096),
    new Float64Array(4_096),
    new Float64Array(4_096),
  ] as const
  const transformIntermediate = new Float64Array(4_096)
  const dcSamples = [new Float64Array(64), new Float64Array(64), new Float64Array(64)] as const
  const dcFrequencyScratch = new Float64Array(64)
  const activeVerticalScratch = new Uint16Array(64)
  const inverseSigmas = makeEpfInverseSigmas(
    dcGroup.quantization,
    dcGroup.sharpness,
    lfGlobal.globalScale,
  )
  const maximumCombinedHeight = Math.min(codedHeight, frame.groupDimension + 16)
  const gaborishScratch = new Float32Array(paddedWidth * maximumCombinedHeight)
  const epfScratch: readonly [Float32Array, Float32Array, Float32Array] = [
    new Float32Array(paddedWidth * maximumCombinedHeight),
    new Float32Array(paddedWidth * maximumCombinedHeight),
    new Float32Array(paddedWidth * maximumCombinedHeight),
  ]
  const epfDifferenceScratch: readonly [Float32Array, Float32Array] = [
    gaborishScratch,
    new Float32Array(paddedWidth * maximumCombinedHeight),
  ]
  const restorationScratchLease = memory.retain(
    'jpegxl-vardct-restoration-band-scratch',
    paddedWidth * maximumCombinedHeight * 5 * 4,
  )
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
  const renderDcLease = memory.retain(
    'jpegxl-vardct-render-dc-planes',
    blockWidth * blockHeight * 3 * 8,
  )
  const dcPlanes: readonly [Float64Array, Float64Array, Float64Array] = [
    new Float64Array(blockWidth * blockHeight),
    new Float64Array(blockWidth * blockHeight),
    new Float64Array(blockWidth * blockHeight),
  ]
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

  const renderBand = (groupY: number): JpegXlVarDctBand => {
    const restorationHalo = 8
    const bandBlockY = groupY * groupBlockDimension
    const bandBlockHeight = Math.min(groupBlockDimension, blockHeight - bandBlockY)
    const bandHeight = Math.min(bandBlockHeight * 8, codedHeight - bandBlockY * 8)
    const edgeRows = Math.min(restorationHalo, bandHeight)
    const lease = memory.retain(
      `jpegxl-vardct-restoration-band-${groupY}`,
      paddedWidth * (bandBlockHeight * 8 + restorationHalo * 2 + edgeRows * 2) * 3 * 4,
    )
    const planes = [
      new Float32Array(paddedWidth * (bandBlockHeight * 8 + restorationHalo * 2)),
      new Float32Array(paddedWidth * (bandBlockHeight * 8 + restorationHalo * 2)),
      new Float32Array(paddedWidth * (bandBlockHeight * 8 + restorationHalo * 2)),
    ] as const
    try {
      for (let groupX = 0; groupX < frame.groupsAcross; groupX += 1) {
        const groupId = groupY * frame.groupsAcross + groupX
        const groupBlockX = groupX * groupBlockDimension
        const groupBlockWidth = Math.min(groupBlockDimension, blockWidth - groupBlockX)
        let acGroup: JpegXlJpegAcGroup | undefined
        let acGroupLease: JpegXlVarDctMemoryLease | undefined
        for (let passIndex = 0; passIndex < frame.passCount; passIndex += 1) {
          const pass = hfGlobal.passes[passIndex]
          const acSection = allSections[2 + frame.dcGroupCount + passIndex * groupCount + groupId]
          if (!pass || !acSection) throw invalidInput('JPEG XL VarDCT pass group is missing')
          const decoded = decodeJpegXlJpegAcGroup(
            acSection,
            {
              blockX: groupBlockX,
              blockY: bandBlockY,
              blockWidth: groupBlockWidth,
              blockHeight: bandBlockHeight,
              chromaSubsampling: frame.chromaSubsampling,
              histogramCount: hfGlobal.histogramCount,
              colorTransform: 'none',
            },
            lfGlobal,
            pass,
            dcGroup,
            0,
            true,
            false,
            frame.passShifts[passIndex] ?? 0,
          )
          const decodedLease = memory.retain(
            `jpegxl-vardct-coefficients-group-${groupId}-pass-${passIndex}`,
            decoded.retainedBytes,
          )
          if (acGroup) {
            mergeProgressiveAcGroup(acGroup, decoded)
            decodedLease.release()
          } else {
            acGroup = decoded
            acGroupLease = decodedLease
          }
        }
        if (!acGroup) throw invalidInput('JPEG XL VarDCT AC group is missing')
        for (let blockY = bandBlockY; blockY < bandBlockY + bandBlockHeight; blockY += 1) {
          for (let blockX = groupBlockX; blockX < groupBlockX + groupBlockWidth; blockX += 1) {
            const blockIndex = blockY * blockWidth + blockX
            const strategy = dcGroup.strategies[blockIndex]
            const firstBlock = dcGroup.strategyFirstBlocks[blockIndex]
            const quantization = dcGroup.quantization[blockIndex]
            const table = strategy === undefined ? undefined : strategyQuantizationTable[strategy]
            const dequantization =
              table === undefined
                ? undefined
                : (hfGlobal.quantizationTables[table] ?? strategyDequantization.get(strategy ?? -1))
            if (
              strategy === undefined ||
              firstBlock === undefined ||
              quantization === undefined ||
              quantization < 1
            ) {
              throw invalidInput('JPEG XL VarDCT block quantization is invalid')
            }
            if (firstBlock === 0) continue
            if (!supportsJpegXlVarDctStrategy(strategy) || !dequantization) {
              throw unsupportedOperation(
                `Common VarDCT transform strategy ${strategy} is not supported yet`,
              )
            }
            const localBlockIndex = (blockY - bandBlockY) * groupBlockWidth + (blockX - groupBlockX)
            const coefficientOffset = acGroup.vardctCoefficientOffsets[localBlockIndex]
            if (coefficientOffset === undefined || coefficientOffset < 0) {
              throw invalidInput('JPEG XL VarDCT coefficient block is missing')
            }
            const strategyBlockWidth = jpegXlVarDctStrategyBlockWidths[strategy] ?? 0
            const strategyBlockHeight = jpegXlVarDctStrategyBlockHeights[strategy] ?? 0
            const coefficientCount = strategyBlockWidth * strategyBlockHeight * 64
            for (let channel = 0; channel < 3; channel += 1) {
              const coefficients = acGroup.vardctCoefficientArenas[channel]
              const dc = dcPlanes[channel]
              const matrix = dequantization[channel]
              const values = blockCoefficients[channel]
              const channelDc = dcSamples[channel]
              if (!coefficients || !dc || !matrix || !values || !channelDc) {
                throw invalidInput('JPEG XL VarDCT channel data is missing')
              }
              values.fill(0, 0, coefficientCount)
              for (let localY = 0; localY < strategyBlockHeight; localY += 1) {
                for (let localX = 0; localX < strategyBlockWidth; localX += 1) {
                  channelDc[localY * strategyBlockWidth + localX] =
                    dc[(blockY + localY) * blockWidth + blockX + localX] ?? 0
                }
              }
              const coefficientScale =
                (inverseGlobalScale * (channelMultipliers[channel] ?? 1)) / quantization
              for (let position = 0; position < coefficientCount; position += 1) {
                const coefficient = coefficients[coefficientOffset + position] ?? 0
                if (coefficient !== 0) {
                  values[position] =
                    adjustQuantizationBias(coefficient, channel) *
                    coefficientScale *
                    (matrix[position] ?? 1)
                }
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
                const yValue = yValues[position] ?? 0
                if (yValue !== 0) values[position] = (values[position] ?? 0) + yValue * ratio
              }
            }
            for (let channel = 0; channel < 3; channel += 1) {
              const values = blockCoefficients[channel]
              const channelDc = dcSamples[channel]
              const plane = planes[channel]
              if (!values || !channelDc || !plane)
                throw invalidInput('JPEG XL VarDCT render plane is missing')
              populateLowestFrequencies(
                values,
                channelDc,
                strategyBlockWidth,
                strategyBlockHeight,
                dcFrequencyScratch,
              )
              const destinationY = (blockY - bandBlockY) * 8 + restorationHalo
              if (strategy === 0) {
                inverseDct8Native(
                  values,
                  transformIntermediate,
                  plane,
                  paddedWidth,
                  blockX * 8,
                  destinationY,
                  activeVerticalScratch,
                )
              } else if (strategy === 1) {
                inverseHornuss(
                  values,
                  transformIntermediate,
                  plane,
                  paddedWidth,
                  blockX * 8,
                  destinationY,
                )
              } else if (strategy === 2) {
                inverseDct2TopBlock(values, plane, paddedWidth, blockX * 8, destinationY)
              } else if (strategy === 3) {
                inverseDct4x4(
                  values,
                  dcFrequencyScratch,
                  transformIntermediate,
                  plane,
                  paddedWidth,
                  blockX * 8,
                  destinationY,
                )
              } else if ((strategy >= 4 && strategy <= 11) || (strategy >= 18 && strategy <= 20)) {
                inverseDctRectangle(
                  values,
                  strategyBlockWidth * 8,
                  strategyBlockHeight * 8,
                  transformIntermediate,
                  plane,
                  paddedWidth,
                  blockX * 8,
                  destinationY,
                  activeVerticalScratch,
                )
              } else if (strategy === 12) {
                inverseDct4x8(
                  values,
                  transformIntermediate,
                  plane,
                  paddedWidth,
                  blockX * 8,
                  destinationY,
                )
              } else if (strategy === 13) {
                inverseDct8x4(
                  values,
                  transformIntermediate,
                  plane,
                  paddedWidth,
                  blockX * 8,
                  destinationY,
                )
              } else if (strategy >= 14 && strategy <= 17) {
                inverseAfv(
                  values,
                  strategy - 14,
                  transformIntermediate,
                  plane,
                  paddedWidth,
                  blockX * 8,
                  destinationY,
                )
              }
            }
          }
        }
        acGroupLease?.release()
      }
      const topStart = restorationHalo * paddedWidth
      const bottomStart =
        (restorationHalo + Math.max(0, bandHeight - restorationHalo)) * paddedWidth
      const edgeLength = Math.min(restorationHalo, bandHeight) * paddedWidth
      const topEdges: readonly [Float32Array, Float32Array, Float32Array] = [
        planes[0].slice(topStart, topStart + edgeLength),
        planes[1].slice(topStart, topStart + edgeLength),
        planes[2].slice(topStart, topStart + edgeLength),
      ]
      const bottomEdges: readonly [Float32Array, Float32Array, Float32Array] = [
        planes[0].slice(bottomStart, bottomStart + edgeLength),
        planes[1].slice(bottomStart, bottomStart + edgeLength),
        planes[2].slice(bottomStart, bottomStart + edgeLength),
      ]
      return Object.freeze({
        blockY: bandBlockY,
        pixelY: bandBlockY * 8,
        height: bandHeight,
        planes,
        topEdges: Object.freeze(topEdges),
        bottomEdges: Object.freeze(bottomEdges),
        lease,
      })
    } catch (error) {
      lease.release()
      throw error
    }
  }

  const processBand = (
    center: JpegXlVarDctBand,
    before: JpegXlVarDctBand | undefined,
    next: JpegXlVarDctBand | undefined,
  ): void => {
    const restorationHalo = 8
    const topRows = before ? before.bottomEdges[0].length / paddedWidth : 0
    const bottomRows = next ? next.topEdges[0].length / paddedWidth : 0
    for (let channel = 0; channel < 3; channel += 1) {
      const plane = center.planes[channel]
      if (!plane) throw invalidInput('JPEG XL restoration-band plane is missing')
      if (before) plane.set(before.bottomEdges[channel] ?? new Float32Array(), 0)
      if (next) {
        plane.set(
          next.topEdges[channel] ?? new Float32Array(),
          (restorationHalo + center.height) * paddedWidth,
        )
      }
    }
    const workingStart = (restorationHalo - topRows) * paddedWidth
    const workingLength = (topRows + center.height + bottomRows) * paddedWidth
    const combined = [
      center.planes[0].subarray(workingStart, workingStart + workingLength),
      center.planes[1].subarray(workingStart, workingStart + workingLength),
      center.planes[2].subarray(workingStart, workingStart + workingLength),
    ] as const
    const combinedHeight = topRows + center.height + bottomRows
    const combinedStart = center.pixelY - topRows
    if (frame.gaborish) {
      applyDefaultGaborish(combined, paddedWidth, codedWidth, combinedHeight, gaborishScratch)
    }
    const blockRowOffset = combinedStart >>> 3
    for (const stage of [0, 1, 2] as const) {
      const enabled =
        stage === 0
          ? frame.epfIterations >= 3
          : stage === 1
            ? frame.epfIterations >= 1
            : frame.epfIterations >= 2
      if (!enabled) continue
      applyDefaultEpfStage(
        combined,
        paddedWidth,
        codedWidth,
        combinedHeight,
        blockWidth,
        inverseSigmas,
        stage,
        blockRowOffset,
        epfScratch,
        epfDifferenceScratch,
        frame.codedHeight,
      )
    }
    const centerOffsetY = topRows
    const temporaryRgb = new Uint8Array(3)
    for (let localY = 0; localY < center.height; localY += 1) {
      const sourceY = centerOffsetY + localY
      const outputY = center.pixelY + localY
      let sourceIndex = sourceY * paddedWidth
      let outputIndex = outputY * frame.width * outputChannels
      for (let x = 0; x < frame.width; x += 1) {
        writeRgb(
          outputChannels === 3 ? output : temporaryRgb,
          outputChannels === 3 ? outputIndex : 0,
          combined[0][sourceIndex] ?? 0,
          combined[1][sourceIndex] ?? 0,
          combined[2][sourceIndex] ?? 0,
        )
        if (outputChannels === 1) output[outputIndex] = temporaryRgb[0] ?? 0
        sourceIndex += 1
        outputIndex += outputChannels
      }
    }
  }

  let before: JpegXlVarDctBand | undefined
  let center: JpegXlVarDctBand | undefined
  try {
    for (let groupY = 0; groupY < frame.groupsDown; groupY += 1) {
      const next = renderBand(groupY)
      if (!center) {
        center = next
        continue
      }
      processBand(center, before, next)
      before?.lease.release()
      before = center
      center = next
    }
    if (center) processBand(center, before, undefined)
  } finally {
    before?.lease.release()
    center?.lease.release()
    transformScratchLease.release()
    restorationScratchLease.release()
    renderDcLease.release()
    hfGlobalLease.release()
    dcGroupLease.release()
    lfGlobalLease.release()
  }
  const result = Object.freeze({
    width: frame.width,
    height: frame.height,
    format: outputChannels === 1 ? 'gray8' : 'rgb8',
    data: output,
    managedPeakBytes: memory.peakBytes,
    release: outputLease.release,
  })
  return result
}

export const decodeJpegXlDct8Section = (
  section: Uint8Array,
  frame: Readonly<JpegXlFrameStructure>,
  limits: Readonly<ImageLimits>,
  memory: JpegXlVarDctMemoryLedger,
  continuationSections?: readonly Uint8Array[],
  externalDcPlanes?: readonly [Float64Array, Float64Array, Float64Array],
  returnDcPlanes = false,
  references: ReadonlyMap<number, Readonly<JpegXlVarDctReference>> = new Map(),
): JpegXlVarDctPixels => {
  const separatedSections = continuationSections !== undefined
  if (
    frame.encoding !== 'vardct' ||
    frame.colorTransform !== 'xyb' ||
    frame.bitDepth !== 8 ||
    (frame.alphaBitDepth !== undefined && frame.alphaBitDepth !== 8) ||
    (separatedSections
      ? continuationSections.length + 1 !==
        2 + frame.dcGroupCount + frame.groupsAcross * frame.groupsDown * frame.passCount
      : frame.passCount !== 1 || frame.sections.length !== 1)
  ) {
    throw unsupportedOperation(
      'Common VarDCT decode currently requires bounded 8-bit XYB groups with optional 8-bit alpha',
    )
  }
  if (
    frame.alphaBitDepth !== undefined &&
    (frame.extraChannelUpsampling[0] ?? 1) !== frame.upsampling
  ) {
    throw unsupportedOperation('Common VarDCT alpha requires matching color and alpha upsampling')
  }
  if (frame.upsampling !== 1 && (frame.frameFlags & 1) !== 0) {
    throw unsupportedOperation('Common VarDCT noise with frame upsampling is not supported yet')
  }
  const codedWidth = frame.codedWidth
  const codedHeight = frame.codedHeight
  const blockWidth = Math.ceil(codedWidth / 8)
  const blockHeight = Math.ceil(codedHeight / 8)
  const paddedWidth = blockWidth * 8
  const paddedHeight = blockHeight * 8
  const planeBytes = BigInt(paddedWidth) * BigInt(paddedHeight) * 3n * 4n
  const outputChannels = frame.alphaBitDepth === undefined ? (frame.colorChannels === 1 ? 1 : 3) : 4
  const outputBytes = BigInt(frame.width) * BigInt(frame.height) * BigInt(outputChannels)
  if (planeBytes + outputBytes > BigInt(limits.maxDecodedBytes)) {
    throw limitExceeded(
      `JPEG XL VarDCT working data requires ${planeBytes + outputBytes} bytes; maxDecodedBytes is ${limits.maxDecodedBytes}`,
    )
  }

  const allSections = separatedSections ? [section, ...continuationSections] : [section]
  const lfGlobal = decodeJpegXlJpegLfGlobal(
    section,
    0,
    separatedSections && frame.alphaBitDepth === undefined,
    frame.frameFlags,
    frame.codedWidth,
    frame.codedHeight,
    frame.alphaBitDepth === undefined ? 0 : 1,
  )
  const lfGlobalLease = memory.retain(
    'jpegxl-vardct-lf-metadata',
    retainedTypedArrayBytes(lfGlobal),
  )
  let globalSectionEnd = lfGlobal.endingBitPosition
  let alphaPlane: Int32Array<ArrayBufferLike> | undefined
  const groupedAlpha =
    frame.alphaBitDepth !== undefined &&
    (codedWidth > frame.groupDimension || codedHeight > frame.groupDimension)
  if (frame.alphaBitDepth !== undefined) {
    if (groupedAlpha) {
      globalSectionEnd = readJpegXlStandaloneModularHeader(section, globalSectionEnd, [
        { width: codedWidth, height: codedHeight },
      ])
      alphaPlane = new Int32Array(codedWidth * codedHeight)
    } else {
      const decodedAlpha = decodeJpegXlStandaloneModular(
        section,
        globalSectionEnd,
        [{ width: codedWidth, height: codedHeight }],
        0,
        lfGlobal.globalModularCode,
      )
      const decodedPlane = decodedAlpha.planes[0]
      if (!decodedPlane) throw invalidInput('JPEG XL VarDCT global alpha plane is missing')
      alphaPlane = decodedPlane
      globalSectionEnd = decodedAlpha.endingBitPosition
    }
  }
  const { group: dcGroup, lease: dcGroupLease } = decodeJpegXlVarDctDcGroups(
    allSections,
    frame,
    lfGlobal,
    blockWidth,
    blockHeight,
    separatedSections,
    memory,
    globalSectionEnd,
    externalDcPlanes,
  )
  const hfSection = separatedSections ? allSections[1 + frame.dcGroupCount] : section
  if (!hfSection) throw invalidInput('JPEG XL VarDCT HF global section is missing')
  const hfGlobal = decodeJpegXlJpegHfGlobal(
    hfSection,
    {
      dcGroupCount: frame.dcGroupCount,
      groupCount: frame.groupsAcross * frame.groupsDown,
      passCount: frame.passCount,
    },
    lfGlobal,
    separatedSections ? 0 : dcGroup.endingBitPosition,
    separatedSections,
  )
  const hfGlobalLease = memory.retain(
    'jpegxl-vardct-hf-metadata',
    retainedTypedArrayBytes(hfGlobal),
  )
  if (
    separatedSections &&
    frame.groupsDown > 1 &&
    frame.alphaBitDepth === undefined &&
    frame.upsampling === 1 &&
    externalDcPlanes === undefined &&
    references.size === 0 &&
    lfGlobal.patches.length === 0 &&
    lfGlobal.splines.length === 0 &&
    lfGlobal.noiseLut === undefined
  ) {
    return decodeJpegXlDct8Striped(
      allSections,
      frame,
      memory,
      lfGlobal,
      hfGlobal,
      dcGroup,
      lfGlobalLease,
      hfGlobalLease,
      dcGroupLease,
    )
  }
  const primaryPlanesLease = memory.retain(
    'jpegxl-vardct-primary-float32-planes',
    paddedWidth * paddedHeight * 3 * 4,
  )
  const planes = [
    new Float32Array(paddedWidth * paddedHeight),
    new Float32Array(paddedWidth * paddedHeight),
    new Float32Array(paddedWidth * paddedHeight),
  ] as const
  const transformScratchLease = memory.retain(
    'jpegxl-vardct-transform-scratch',
    4 * 4_096 * 8 + 3 * 64 * 8,
  )
  const blockCoefficients = [
    new Float64Array(4_096),
    new Float64Array(4_096),
    new Float64Array(4_096),
  ] as const
  const transformIntermediate = new Float64Array(4_096)
  const dcSamples = [new Float64Array(64), new Float64Array(64), new Float64Array(64)] as const
  const dcFrequencyScratch = new Float64Array(64)
  const activeVerticalScratch = new Uint16Array(64)
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
  if (((frame.frameFlags & 32) !== 0) !== (externalDcPlanes !== undefined)) {
    throw invalidInput('JPEG XL VarDCT external DC frame dependency is inconsistent')
  }
  const renderDcLease = externalDcPlanes
    ? undefined
    : memory.retain('jpegxl-vardct-render-dc-planes', blockWidth * blockHeight * 3 * 8)
  const dcPlanes: readonly [Float64Array, Float64Array, Float64Array] = externalDcPlanes ?? [
    new Float64Array(blockWidth * blockHeight),
    new Float64Array(blockWidth * blockHeight),
    new Float64Array(blockWidth * blockHeight),
  ]
  if (!externalDcPlanes) {
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
  }

  const groupCount = frame.groupsAcross * frame.groupsDown
  const groupBlockDimension = frame.groupDimension / 8
  for (let groupId = 0; groupId < groupCount; groupId += 1) {
    const groupBlockX = (groupId % frame.groupsAcross) * groupBlockDimension
    const groupBlockY = Math.floor(groupId / frame.groupsAcross) * groupBlockDimension
    const groupBlockWidth = Math.min(groupBlockDimension, blockWidth - groupBlockX)
    const groupBlockHeight = Math.min(groupBlockDimension, blockHeight - groupBlockY)
    let acGroup: JpegXlJpegAcGroup | undefined
    let acGroupLease: JpegXlVarDctMemoryLease | undefined
    for (let passIndex = 0; passIndex < frame.passCount; passIndex += 1) {
      const pass = hfGlobal.passes[passIndex]
      const acSection = separatedSections
        ? allSections[2 + frame.dcGroupCount + passIndex * groupCount + groupId]
        : section
      if (!pass || !acSection) throw invalidInput('JPEG XL VarDCT pass group is missing')
      const decoded = decodeJpegXlJpegAcGroup(
        acSection,
        {
          blockX: groupBlockX,
          blockY: groupBlockY,
          blockWidth: groupBlockWidth,
          blockHeight: groupBlockHeight,
          chromaSubsampling: frame.chromaSubsampling,
          histogramCount: hfGlobal.histogramCount,
          colorTransform: 'none',
        },
        lfGlobal,
        pass,
        dcGroup,
        separatedSections ? 0 : hfGlobal.endingBitPosition,
        separatedSections && (!groupedAlpha || passIndex !== frame.passCount - 1),
        false,
        frame.passShifts[passIndex] ?? 0,
      )
      if (groupedAlpha && passIndex === frame.passCount - 1) {
        if (!alphaPlane) throw invalidInput('JPEG XL VarDCT alpha destination is missing')
        const groupPixelX = groupBlockX * 8
        const groupPixelY = groupBlockY * 8
        const groupPixelWidth = Math.min(frame.groupDimension, codedWidth - groupPixelX)
        const groupPixelHeight = Math.min(frame.groupDimension, codedHeight - groupPixelY)
        const alpha = decodeJpegXlStandaloneModular(
          acSection,
          decoded.endingBitPosition,
          [{ width: groupPixelWidth, height: groupPixelHeight }],
          1 + 3 * frame.dcGroupCount + 17 + passIndex * groupCount + groupId,
          lfGlobal.globalModularCode,
        )
        const sourceAlpha = alpha.planes[0]
        if (!sourceAlpha) throw invalidInput('JPEG XL VarDCT alpha group is missing')
        copyPlaneRegion(
          sourceAlpha,
          groupPixelWidth,
          alphaPlane,
          codedWidth,
          groupPixelX,
          groupPixelY,
          groupPixelWidth,
          groupPixelHeight,
        )
      }
      const decodedLease = memory.retain(
        groupCount === 1
          ? `jpegxl-vardct-coefficients-pass-${passIndex}`
          : `jpegxl-vardct-coefficients-group-${groupId}-pass-${passIndex}`,
        decoded.retainedBytes,
      )
      if (acGroup) {
        mergeProgressiveAcGroup(acGroup, decoded)
        decodedLease.release()
      } else {
        acGroup = decoded
        acGroupLease = decodedLease
      }
    }
    if (!acGroup) throw invalidInput('JPEG XL VarDCT AC group is missing')
    for (let blockY = groupBlockY; blockY < groupBlockY + groupBlockHeight; blockY += 1) {
      for (let blockX = groupBlockX; blockX < groupBlockX + groupBlockWidth; blockX += 1) {
        const blockIndex = blockY * blockWidth + blockX
        const strategy = dcGroup.strategies[blockIndex]
        const firstBlock = dcGroup.strategyFirstBlocks[blockIndex]
        const quantization = dcGroup.quantization[blockIndex]
        const quantizationTable =
          strategy === undefined ? undefined : strategyQuantizationTable[strategy]
        const dequantizationForStrategy =
          quantizationTable === undefined
            ? undefined
            : (hfGlobal.quantizationTables[quantizationTable] ??
              strategyDequantization.get(strategy ?? -1))
        if (
          strategy === undefined ||
          firstBlock === undefined ||
          quantization === undefined ||
          quantization < 1
        ) {
          throw invalidInput('JPEG XL VarDCT block quantization is invalid')
        }
        if (firstBlock === 0) continue
        if (!supportsJpegXlVarDctStrategy(strategy) || !dequantizationForStrategy) {
          throw unsupportedOperation(
            `Common VarDCT transform strategy ${strategy} is not supported yet`,
          )
        }
        const localBlockIndex = (blockY - groupBlockY) * groupBlockWidth + (blockX - groupBlockX)
        const coefficientOffset = acGroup.vardctCoefficientOffsets[localBlockIndex]
        if (coefficientOffset === undefined || coefficientOffset < 0) {
          throw invalidInput('JPEG XL VarDCT coefficient block is missing')
        }
        const strategyBlockWidth = jpegXlVarDctStrategyBlockWidths[strategy] ?? 0
        const strategyBlockHeight = jpegXlVarDctStrategyBlockHeights[strategy] ?? 0
        const coveredBlocks = strategyBlockWidth * strategyBlockHeight
        const coefficientCount = coveredBlocks * 64
        for (let channel = 0; channel < 3; channel += 1) {
          const coefficients = acGroup.vardctCoefficientArenas[channel]
          const dc = dcPlanes[channel]
          const dequantization = dequantizationForStrategy[channel]
          const values = blockCoefficients[channel]
          const channelDc = dcSamples[channel]
          if (!coefficients || !dc || !dequantization || !values || !channelDc) {
            throw invalidInput('JPEG XL VarDCT channel data is missing')
          }
          values.fill(0, 0, coefficientCount)
          for (let localY = 0; localY < strategyBlockHeight; localY += 1) {
            for (let localX = 0; localX < strategyBlockWidth; localX += 1) {
              const value = dc[(blockY + localY) * blockWidth + blockX + localX]
              if (value === undefined)
                throw invalidInput('JPEG XL VarDCT DC coefficient is missing')
              channelDc[localY * strategyBlockWidth + localX] = value
            }
          }
          const coefficientScale =
            (inverseGlobalScale * (channelMultipliers[channel] ?? 1)) / quantization
          for (let position = 0; position < coefficientCount; position += 1) {
            const coefficient = coefficients[coefficientOffset + position] ?? 0
            if (coefficient !== 0) {
              values[position] =
                adjustQuantizationBias(coefficient, channel) *
                coefficientScale *
                (dequantization[position] ?? 1)
            }
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
            const yValue = yValues[position] ?? 0
            if (yValue !== 0) values[position] = (values[position] ?? 0) + yValue * ratio
          }
        }
        for (let channel = 0; channel < 3; channel += 1) {
          const values = blockCoefficients[channel]
          const channelDc = dcSamples[channel]
          const plane = planes[channel]
          if (!values || !channelDc || !plane) {
            throw invalidInput('JPEG XL VarDCT render plane is missing')
          }
          populateLowestFrequencies(
            values,
            channelDc,
            strategyBlockWidth,
            strategyBlockHeight,
            dcFrequencyScratch,
          )
          if (strategy === 0) {
            inverseDct8Native(
              values,
              transformIntermediate,
              plane,
              paddedWidth,
              blockX * 8,
              blockY * 8,
              activeVerticalScratch,
            )
          } else if (strategy === 1) {
            inverseHornuss(
              values,
              transformIntermediate,
              plane,
              paddedWidth,
              blockX * 8,
              blockY * 8,
            )
          } else if (strategy === 2) {
            inverseDct2TopBlock(values, plane, paddedWidth, blockX * 8, blockY * 8)
          } else if (strategy === 3) {
            inverseDct4x4(
              values,
              dcFrequencyScratch,
              transformIntermediate,
              plane,
              paddedWidth,
              blockX * 8,
              blockY * 8,
            )
          } else if ((strategy >= 4 && strategy <= 11) || (strategy >= 18 && strategy <= 20)) {
            inverseDctRectangle(
              values,
              strategyBlockWidth * 8,
              strategyBlockHeight * 8,
              transformIntermediate,
              plane,
              paddedWidth,
              blockX * 8,
              blockY * 8,
              activeVerticalScratch,
            )
          } else if (strategy === 12) {
            inverseDct4x8(values, transformIntermediate, plane, paddedWidth, blockX * 8, blockY * 8)
          } else if (strategy === 13) {
            inverseDct8x4(values, transformIntermediate, plane, paddedWidth, blockX * 8, blockY * 8)
          } else if (strategy >= 14 && strategy <= 17) {
            inverseAfv(
              values,
              strategy - 14,
              transformIntermediate,
              plane,
              paddedWidth,
              blockX * 8,
              blockY * 8,
            )
          } else {
            throw unsupportedOperation(
              `Common VarDCT transform strategy ${strategy} is not supported yet`,
            )
          }
        }
      }
    }
    acGroupLease?.release()
  }

  if (frame.gaborish) {
    const scratch = memory.retain('jpegxl-vardct-gaborish-scratch', paddedWidth * codedHeight * 4)
    applyDefaultGaborish(planes, paddedWidth, codedWidth, codedHeight)
    scratch.release()
  }
  const inverseSigmas = makeEpfInverseSigmas(
    dcGroup.quantization,
    dcGroup.sharpness,
    lfGlobal.globalScale,
  )
  if (frame.epfIterations >= 3) {
    const scratch = memory.retain(
      'jpegxl-vardct-epf-stage-0-output',
      paddedWidth * codedHeight * 3 * 4,
    )
    applyDefaultEpfStage(planes, paddedWidth, codedWidth, codedHeight, blockWidth, inverseSigmas, 0)
    scratch.release()
  }
  if (frame.epfIterations >= 1) {
    const scratch = memory.retain(
      'jpegxl-vardct-epf-stage-1-output',
      paddedWidth * codedHeight * 3 * 4,
    )
    applyDefaultEpfStage(planes, paddedWidth, codedWidth, codedHeight, blockWidth, inverseSigmas, 1)
    scratch.release()
  }
  if (frame.epfIterations >= 2) {
    const scratch = memory.retain(
      'jpegxl-vardct-epf-stage-2-output',
      paddedWidth * codedHeight * 3 * 4,
    )
    applyDefaultEpfStage(planes, paddedWidth, codedWidth, codedHeight, blockWidth, inverseSigmas, 2)
    scratch.release()
  }
  for (const patch of lfGlobal.patches) {
    const reference = references.get(patch.referenceId)
    if (
      !reference ||
      patch.referenceX + patch.width > reference.width ||
      patch.referenceY + patch.height > reference.height
    ) {
      throw invalidInput('JPEG XL patch reference is unavailable or outside its frame')
    }
    if (patch.blendMode > 3) {
      throw unsupportedOperation('JPEG XL alpha-weighted patch blending is not supported yet')
    }
    for (let channel = 0; channel < 3; channel += 1) {
      const destination = planes[channel]
      const source = reference.planes[channel]
      if (!destination || !source) throw invalidInput('JPEG XL patch channel is missing')
      for (let y = 0; y < patch.height; y += 1) {
        const destinationBase = (patch.y + y) * paddedWidth + patch.x
        const sourceBase = (patch.referenceY + y) * reference.width + patch.referenceX
        for (let x = 0; x < patch.width; x += 1) {
          const sourceValue = source[sourceBase + x] ?? 0
          const destinationIndex = destinationBase + x
          if (patch.blendMode === 0) continue
          if (patch.blendMode === 1) destination[destinationIndex] = sourceValue
          else if (patch.blendMode === 2) {
            destination[destinationIndex] = (destination[destinationIndex] ?? 0) + sourceValue
          } else {
            destination[destinationIndex] = (destination[destinationIndex] ?? 0) * sourceValue
          }
        }
      }
    }
  }
  if (lfGlobal.splines.length > 0) {
    applySplines(
      planes,
      paddedWidth,
      codedWidth,
      codedHeight,
      lfGlobal.splines,
      lfGlobal.splineQuantizationAdjustment,
      lfGlobal.colorCorrelation,
    )
  }
  if (lfGlobal.noiseLut) {
    const scratch = memory.retain(
      'jpegxl-vardct-synthetic-noise-and-convolution',
      codedWidth * codedHeight * 4 * 4,
    )
    applyNoise(
      planes,
      paddedWidth,
      codedWidth,
      codedHeight,
      lfGlobal.noiseLut,
      lfGlobal.colorCorrelation,
    )
    scratch.release()
  }

  if (returnDcPlanes) {
    const copied = planes.map((plane) => {
      const output = new Float64Array(codedWidth * codedHeight)
      for (let y = 0; y < codedHeight; y += 1) {
        for (let x = 0; x < codedWidth; x += 1) {
          output[y * codedWidth + x] = plane[y * paddedWidth + x] ?? 0
        }
      }
      return output
    })
    const first = copied[0]
    const second = copied[1]
    const third = copied[2]
    if (!first || !second || !third) throw invalidInput('JPEG XL VarDCT DC frame plane is missing')
    const dcPlanes = Object.freeze([first, second, third] as const)
    primaryPlanesLease.release()
    transformScratchLease.release()
    renderDcLease?.release()
    hfGlobalLease.release()
    dcGroupLease.release()
    lfGlobalLease.release()
    return Object.freeze({
      width: codedWidth,
      height: codedHeight,
      format: 'rgb8',
      data: new Uint8Array(),
      dcPlanes,
      managedPeakBytes: memory.peakBytes,
      release: (): void => {},
    })
  }

  const format =
    frame.alphaBitDepth !== undefined ? 'rgba8' : frame.colorChannels === 1 ? 'gray8' : 'rgb8'
  const outputLease = memory.retain(
    'jpegxl-vardct-output-pixels',
    frame.width * frame.height * outputChannels,
  )
  const output = new Uint8Array(frame.width * frame.height * outputChannels)
  if (format === 'gray8') {
    const rgb = new Uint8Array(3)
    for (let y = 0; y < frame.height; y += 1) {
      for (let x = 0; x < frame.width; x += 1) {
        if (frame.upsampling === 1) {
          const planeIndex = y * paddedWidth + x
          writeRgb(
            rgb,
            0,
            planes[0][planeIndex] ?? 0,
            planes[1][planeIndex] ?? 0,
            planes[2][planeIndex] ?? 0,
          )
        } else {
          writeRgb(
            rgb,
            0,
            upsampleSample(planes[0], paddedWidth, codedWidth, codedHeight, x, y, frame.upsampling),
            upsampleSample(planes[1], paddedWidth, codedWidth, codedHeight, x, y, frame.upsampling),
            upsampleSample(planes[2], paddedWidth, codedWidth, codedHeight, x, y, frame.upsampling),
          )
        }
        output[y * frame.width + x] = rgb[0] ?? 0
      }
    }
  } else if (format === 'rgb8' && frame.upsampling === 1) {
    for (let y = 0; y < frame.height; y += 1) {
      let outputIndex = y * frame.width * 3
      let planeIndex = y * paddedWidth
      for (let x = 0; x < frame.width; x += 1) {
        writeRgb(
          output,
          outputIndex,
          planes[0][planeIndex] ?? 0,
          planes[1][planeIndex] ?? 0,
          planes[2][planeIndex] ?? 0,
        )
        outputIndex += 3
        planeIndex += 1
      }
    }
  } else if (format === 'rgb8') {
    for (let y = 0; y < frame.height; y += 1) {
      let outputIndex = y * frame.width * 3
      for (let x = 0; x < frame.width; x += 1) {
        writeRgb(
          output,
          outputIndex,
          upsampleSample(planes[0], paddedWidth, codedWidth, codedHeight, x, y, frame.upsampling),
          upsampleSample(planes[1], paddedWidth, codedWidth, codedHeight, x, y, frame.upsampling),
          upsampleSample(planes[2], paddedWidth, codedWidth, codedHeight, x, y, frame.upsampling),
        )
        outputIndex += 3
      }
    }
  } else if (frame.upsampling === 1) {
    if (!alphaPlane) throw invalidInput('JPEG XL VarDCT alpha plane is missing')
    for (let y = 0; y < frame.height; y += 1) {
      let outputIndex = y * frame.width * 4
      let planeIndex = y * paddedWidth
      let alphaIndex = y * codedWidth
      for (let x = 0; x < frame.width; x += 1) {
        writeRgb(
          output,
          outputIndex,
          planes[0][planeIndex] ?? 0,
          planes[1][planeIndex] ?? 0,
          planes[2][planeIndex] ?? 0,
        )
        output[outputIndex + 3] = Math.max(0, Math.min(255, alphaPlane[alphaIndex] ?? 0))
        outputIndex += 4
        planeIndex += 1
        alphaIndex += 1
      }
    }
  } else {
    if (!alphaPlane) throw invalidInput('JPEG XL VarDCT alpha plane is missing')
    const alphaFloat = Float32Array.from(alphaPlane)
    for (let y = 0; y < frame.height; y += 1) {
      let outputIndex = y * frame.width * 4
      for (let x = 0; x < frame.width; x += 1) {
        writeRgb(
          output,
          outputIndex,
          upsampleSample(planes[0], paddedWidth, codedWidth, codedHeight, x, y, frame.upsampling),
          upsampleSample(planes[1], paddedWidth, codedWidth, codedHeight, x, y, frame.upsampling),
          upsampleSample(planes[2], paddedWidth, codedWidth, codedHeight, x, y, frame.upsampling),
        )
        output[outputIndex + 3] = Math.max(
          0,
          Math.min(
            255,
            Math.round(
              upsampleSample(
                alphaFloat,
                codedWidth,
                codedWidth,
                codedHeight,
                x,
                y,
                frame.upsampling,
              ),
            ),
          ),
        )
        outputIndex += 4
      }
    }
  }
  primaryPlanesLease.release()
  transformScratchLease.release()
  renderDcLease?.release()
  hfGlobalLease.release()
  dcGroupLease.release()
  lfGlobalLease.release()
  return Object.freeze({
    width: frame.width,
    height: frame.height,
    format,
    data: output,
    managedPeakBytes: memory.peakBytes,
    release: outputLease.release,
  })
}
