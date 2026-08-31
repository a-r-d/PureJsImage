import { invalidInput, unsupportedOperation } from '../errors.ts'
import {
  JpegXlBitReader,
  JpegXlEntropySymbolReader,
  jpegXlCeilLog2,
  readJpegXlContextMap,
  readJpegXlEntropyCode,
  type JpegXlEntropyCode,
} from './jpegxl-bitstream.ts'
import {
  decodeJpegXlStandaloneModular,
  readJpegXlModularTree,
  type JpegXlModularGlobalCode,
  type JpegXlModularNode,
} from './jpegxl-decode.ts'

interface DistributionValue {
  readonly value: number
}

interface DistributionBits {
  readonly bits: number
  readonly offset: number
}

type Distribution = DistributionValue | DistributionBits

const value = (number: number): DistributionValue => ({ value: number })
const bits = (count: number, offset = 0): DistributionBits => ({ bits: count, offset })

const readU32 = (
  reader: JpegXlBitReader,
  distributions: readonly [Distribution, Distribution, Distribution, Distribution],
): number => {
  const distribution = distributions[reader.readBits(2)]
  if (!distribution) throw invalidInput('JPEG XL integer distribution is invalid')
  return 'value' in distribution
    ? distribution.value
    : distribution.offset + reader.readBits(distribution.bits)
}

const readF16 = (reader: JpegXlBitReader): number => {
  const encoded = reader.readBits(16)
  const sign = (encoded & 0x8000) === 0 ? 1 : -1
  const exponent = (encoded >>> 10) & 0x1f
  const mantissa = encoded & 0x03ff
  if (exponent === 0x1f) throw invalidInput('JPEG XL half-precision value is not finite')
  if (exponent === 0) return sign * mantissa * 2 ** -24
  return sign * (1 + mantissa / 1_024) * 2 ** (exponent - 15)
}

const unpackSigned = (encoded: number): number =>
  (encoded & 1) === 0 ? encoded / 2 : -(encoded + 1) / 2

const requireZeroRemainder = (reader: JpegXlBitReader, label: string): void => {
  while (reader.remainingBits > 0) {
    const count = Math.min(32, reader.remainingBits)
    if (reader.readBits(count) !== 0) {
      throw invalidInput(`${label} has nonzero trailing data`)
    }
  }
}

export interface JpegXlJpegLfGlobal {
  readonly dcQuantization: readonly [number, number, number]
  readonly blockContexts: JpegXlJpegBlockContexts
  readonly colorCorrelation: JpegXlJpegColorCorrelation
  readonly globalScale: number
  readonly quantDc: number
  readonly globalModularCode: JpegXlModularGlobalCode
}

export interface JpegXlJpegColorCorrelation {
  readonly colorFactor: number
  readonly baseCorrelationX: number
  readonly baseCorrelationB: number
  readonly yToXDc: number
  readonly yToBDc: number
}

export interface JpegXlJpegDcGroupOptions {
  readonly blockWidth: number
  readonly blockHeight: number
  readonly chromaSubsampling: readonly [number, number, number]
  readonly groupId: number
  readonly dcGroupCount: number
}

export interface JpegXlJpegDcGroup {
  readonly blockWidth: number
  readonly blockHeight: number
  readonly dcCoefficients: readonly Int32Array<ArrayBufferLike>[]
  readonly extraPrecision: number
  readonly quantization: Int32Array<ArrayBufferLike>
  readonly sharpness: Int32Array<ArrayBufferLike>
  readonly colorCorrelationX: Int32Array<ArrayBufferLike>
  readonly colorCorrelationB: Int32Array<ArrayBufferLike>
  readonly endingBitPosition: number
}

export interface JpegXlJpegHfGlobalOptions {
  readonly dcGroupCount: number
  readonly groupCount: number
  readonly passCount: number
}

export interface JpegXlJpegHfPass {
  readonly coefficientOrders: readonly Uint8Array<ArrayBufferLike>[]
  readonly coefficientCode: JpegXlEntropyCode
}

export interface JpegXlJpegHfGlobal {
  readonly dct8QuantizationDenominator: number | undefined
  readonly dct8Quantization: readonly Int32Array<ArrayBufferLike>[] | undefined
  readonly histogramCount: number
  readonly passes: readonly JpegXlJpegHfPass[]
  readonly endingBitPosition: number
}

export interface JpegXlJpegAcGroupOptions {
  readonly blockX: number
  readonly blockY: number
  readonly blockWidth: number
  readonly blockHeight: number
  readonly chromaSubsampling: readonly [number, number, number]
  readonly histogramCount: number
}

export interface JpegXlJpegAcGroup {
  readonly componentCoefficients: readonly Int32Array<ArrayBufferLike>[]
  readonly componentBlockWidths: readonly [number, number, number]
  readonly componentBlockHeights: readonly [number, number, number]
  readonly endingBitPosition: number
}

export interface JpegXlJpegBlockContexts {
  readonly dcThresholds: readonly (readonly number[])[]
  readonly quantizationThresholds: readonly number[]
  readonly contextMap: readonly number[]
  readonly contextCount: number
  readonly dcContextCount: number
}

const defaultBlockContextMap = Object.freeze([
  0, 1, 2, 2, 3, 3, 4, 5, 6, 6, 6, 6, 6, 7, 8, 9, 9, 10, 11, 12, 13, 14, 14, 14, 14, 14, 7, 8, 9, 9,
  10, 11, 12, 13, 14, 14, 14, 14, 14,
])

const readBlockContexts = (reader: JpegXlBitReader): JpegXlJpegBlockContexts => {
  if (reader.readBits(1) !== 0) {
    return Object.freeze({
      dcThresholds: Object.freeze([Object.freeze([]), Object.freeze([]), Object.freeze([])]),
      quantizationThresholds: Object.freeze([]),
      contextMap: defaultBlockContextMap,
      contextCount: 15,
      dcContextCount: 1,
    })
  }
  const dcThresholds: number[][] = []
  let dcContextCount = 1
  for (let channel = 0; channel < 3; channel += 1) {
    const count = reader.readBits(4)
    dcContextCount *= count + 1
    dcThresholds.push(
      Array.from({ length: count }, () =>
        unpackSigned(readU32(reader, [bits(4), bits(8, 16), bits(16, 272), bits(32, 65_808)])),
      ),
    )
  }
  const quantizationThresholds = Array.from(
    { length: reader.readBits(4) },
    () => readU32(reader, [bits(2), bits(3, 4), bits(5, 12), bits(8, 44)]) + 1,
  )
  if (dcContextCount * (quantizationThresholds.length + 1) > 64) {
    throw invalidInput('JPEG-derived JPEG XL block context map is too large')
  }
  const entries = 3 * 13 * dcContextCount * (quantizationThresholds.length + 1)
  const decoded = readJpegXlContextMap(reader, entries)
  if (decoded.histogramCount > 16) {
    throw invalidInput('JPEG-derived JPEG XL block context map has too many contexts')
  }
  return Object.freeze({
    dcThresholds: Object.freeze(dcThresholds.map((thresholds) => Object.freeze(thresholds))),
    quantizationThresholds: Object.freeze(quantizationThresholds),
    contextMap: decoded.contextMap,
    contextCount: decoded.histogramCount,
    dcContextCount,
  })
}

const readColorCorrelation = (reader: JpegXlBitReader): JpegXlJpegColorCorrelation => {
  if (reader.readBits(1) !== 0) {
    return Object.freeze({
      colorFactor: 84,
      baseCorrelationX: 0,
      baseCorrelationB: 0,
      yToXDc: 0,
      yToBDc: 0,
    })
  }
  const colorFactor = readU32(reader, [value(84), value(256), bits(8, 2), bits(16, 258)])
  const baseCorrelationX = readF16(reader)
  const baseCorrelationB = readF16(reader)
  if (Math.abs(baseCorrelationX) > 4 || Math.abs(baseCorrelationB) > 4) {
    throw invalidInput('JPEG-derived JPEG XL color correlation is out of range')
  }
  return Object.freeze({
    colorFactor,
    baseCorrelationX,
    baseCorrelationB,
    yToXDc: reader.readBits(8) - 128,
    yToBDc: reader.readBits(8) - 128,
  })
}

const subsamplingShifts = (
  modes: readonly [number, number, number],
): readonly (readonly [number, number])[] => {
  const raw = modes.map((mode): readonly [number, number] => {
    if (mode === 0) return Object.freeze([0, 0])
    if (mode === 1) return Object.freeze([1, 1])
    if (mode === 2) return Object.freeze([1, 0])
    if (mode === 3) return Object.freeze([0, 1])
    throw invalidInput('JPEG-derived JPEG XL chroma subsampling mode is invalid')
  })
  const maximumHorizontal = Math.max(...raw.map(([horizontal]) => horizontal))
  const maximumVertical = Math.max(...raw.map(([, vertical]) => vertical))
  return Object.freeze(
    raw.map(([horizontal, vertical]): readonly [number, number] =>
      Object.freeze([maximumHorizontal - horizontal, maximumVertical - vertical] as const),
    ),
  )
}

const requireZeroPadding = (section: Uint8Array, bitPosition: number, label: string): void => {
  const reader = new JpegXlBitReader(section, bitPosition)
  requireZeroRemainder(reader, label)
}

export const decodeJpegXlJpegDcGroup = (
  section: Uint8Array,
  options: Readonly<JpegXlJpegDcGroupOptions>,
  globalCode: Readonly<JpegXlModularGlobalCode>,
): JpegXlJpegDcGroup => {
  const { blockWidth, blockHeight, chromaSubsampling, groupId, dcGroupCount } = options
  if (
    !Number.isSafeInteger(blockWidth) ||
    !Number.isSafeInteger(blockHeight) ||
    blockWidth < 1 ||
    blockHeight < 1 ||
    blockWidth * blockHeight > 67_108_864 ||
    !Number.isSafeInteger(groupId) ||
    groupId < 0 ||
    !Number.isSafeInteger(dcGroupCount) ||
    dcGroupCount < 1
  ) {
    throw invalidInput('JPEG-derived JPEG XL DC group geometry is invalid')
  }
  const reader = new JpegXlBitReader(section)
  const extraPrecision = reader.readBits(2)
  const shifts = subsamplingShifts(chromaSubsampling)
  const layoutForJxlChannel = (channel: number): Readonly<{ width: number; height: number }> => {
    const shift = shifts[channel]
    if (!shift) throw invalidInput('JPEG-derived JPEG XL channel shift is missing')
    const horizontal = 2 ** shift[0]
    const vertical = 2 ** shift[1]
    if (blockWidth % horizontal !== 0 || blockHeight % vertical !== 0) {
      throw invalidInput('JPEG-derived JPEG XL DC group is not aligned to chroma sampling')
    }
    return Object.freeze({ width: blockWidth / horizontal, height: blockHeight / vertical })
  }
  const cb = layoutForJxlChannel(0)
  const y = layoutForJxlChannel(1)
  const cr = layoutForJxlChannel(2)
  const decodedDc = decodeJpegXlStandaloneModular(
    section,
    reader.bitPosition,
    [y, cb, cr],
    1 + groupId,
    globalCode,
  )
  const divisor = 2 ** extraPrecision
  const dcCoefficients = decodedDc.planes.map((plane) => {
    const output = new Int32Array(plane.length)
    for (let index = 0; index < plane.length; index += 1) {
      const encoded = plane[index]
      if (encoded === undefined || encoded % divisor !== 0) {
        throw invalidInput('JPEG-derived JPEG XL DC coefficient is not integral')
      }
      output[index] = encoded / divisor
    }
    return output
  })

  const metadataReader = new JpegXlBitReader(section, decodedDc.endingBitPosition)
  const blockCount = blockWidth * blockHeight
  const count = metadataReader.readBits(jpegXlCeilLog2(blockCount)) + 1
  const correlationWidth = Math.ceil(blockWidth / 8)
  const correlationHeight = Math.ceil(blockHeight / 8)
  const metadata = decodeJpegXlStandaloneModular(
    section,
    metadataReader.bitPosition,
    [
      { width: correlationWidth, height: correlationHeight },
      { width: correlationWidth, height: correlationHeight },
      { width: count, height: 2 },
      { width: blockWidth, height: blockHeight },
    ],
    1 + 2 * dcGroupCount + groupId,
    globalCode,
  )
  const strategiesAndQuantization = metadata.planes[2]
  const sharpness = metadata.planes[3]
  if (!strategiesAndQuantization || !sharpness) {
    throw invalidInput('JPEG-derived JPEG XL AC metadata planes are missing')
  }
  if (count !== blockCount) {
    throw unsupportedOperation('JPEG-derived JPEG XL non-DCT8 AC strategies are not supported')
  }
  const quantization = new Int32Array(blockCount)
  for (let index = 0; index < blockCount; index += 1) {
    if (strategiesAndQuantization[index] !== 0) {
      throw unsupportedOperation('JPEG-derived JPEG XL non-DCT8 AC strategies are not supported')
    }
    const rawQuantization = strategiesAndQuantization[count + index]
    const sharpnessValue = sharpness[index]
    if (rawQuantization === undefined || sharpnessValue === undefined) {
      throw invalidInput('JPEG-derived JPEG XL AC metadata is truncated')
    }
    if (sharpnessValue < 0 || sharpnessValue > 7) {
      throw invalidInput('JPEG-derived JPEG XL EPF sharpness is invalid')
    }
    quantization[index] = Math.max(0, Math.min(255, rawQuantization)) + 1
  }
  requireZeroPadding(section, metadata.endingBitPosition, 'JPEG XL DC group section')
  const colorCorrelationX = metadata.planes[0]
  const colorCorrelationB = metadata.planes[1]
  if (!colorCorrelationX || !colorCorrelationB) {
    throw invalidInput('JPEG-derived JPEG XL color-correlation planes are missing')
  }
  return Object.freeze({
    blockWidth,
    blockHeight,
    dcCoefficients: Object.freeze(dcCoefficients),
    extraPrecision,
    quantization,
    sharpness,
    colorCorrelationX,
    colorCorrelationB,
    endingBitPosition: metadata.endingBitPosition,
  })
}

const coefficientFrequencyContext = Object.freeze([
  0xbad, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 15, 16, 16, 17, 17, 18, 18, 19, 19,
  20, 20, 21, 21, 22, 22, 23, 23, 23, 23, 24, 24, 24, 24, 25, 25, 25, 25, 26, 26, 26, 26, 27, 27,
  27, 27, 28, 28, 28, 28, 29, 29, 29, 29, 30, 30, 30, 30,
])

const coefficientNonzeroContext = Object.freeze([
  0xbad, 0, 31, 62, 62, 93, 93, 93, 93, 123, 123, 123, 123, 152, 152, 152, 152, 152, 152, 152, 152,
  180, 180, 180, 180, 180, 180, 180, 180, 180, 180, 180, 180, 206, 206, 206, 206, 206, 206, 206,
  206, 206, 206, 206, 206, 206, 206, 206, 206, 206, 206, 206, 206, 206, 206, 206, 206, 206, 206,
  206, 206, 206, 206, 206,
])

const predictNonzeroCount = (
  plane: Int32Array<ArrayBufferLike>,
  width: number,
  x: number,
  y: number,
): number => {
  if (x === 0) return y === 0 ? 32 : (plane[(y - 1) * width] ?? 32)
  const left = plane[y * width + x - 1] ?? 32
  if (y === 0) return left
  return Math.floor(((plane[(y - 1) * width + x] ?? 32) + left + 1) / 2)
}

const dcContextPlane = (
  dcGroup: Readonly<JpegXlJpegDcGroup>,
  shifts: readonly (readonly [number, number])[],
  blockContexts: Readonly<JpegXlJpegBlockContexts>,
): Uint8Array<ArrayBufferLike> => {
  const output = new Uint8Array(dcGroup.blockWidth * dcGroup.blockHeight)
  if (blockContexts.dcContextCount === 1) return output
  const planeForChannel = (channel: number): Int32Array<ArrayBufferLike> => {
    const plane = dcGroup.dcCoefficients[channel < 2 ? channel ^ 1 : channel]
    if (!plane) throw invalidInput('JPEG-derived JPEG XL DC plane is missing')
    return plane
  }
  for (let y = 0; y < dcGroup.blockHeight; y += 1) {
    for (let x = 0; x < dcGroup.blockWidth; x += 1) {
      const buckets = [0, 0, 0]
      for (let channel = 0; channel < 3; channel += 1) {
        const shift = shifts[channel]
        const thresholds = blockContexts.dcThresholds[channel]
        if (!shift || !thresholds) throw invalidInput('JPEG-derived JPEG XL DC context is missing')
        const planeWidth = dcGroup.blockWidth >> shift[0]
        const coefficient = planeForChannel(channel)[(y >> shift[1]) * planeWidth + (x >> shift[0])]
        if (coefficient === undefined) {
          throw invalidInput('JPEG-derived JPEG XL DC context index is invalid')
        }
        for (const threshold of thresholds) {
          if (coefficient > threshold) buckets[channel] = (buckets[channel] ?? 0) + 1
        }
      }
      let bucket = buckets[0] ?? 0
      bucket *= (blockContexts.dcThresholds[2]?.length ?? 0) + 1
      bucket += buckets[2] ?? 0
      bucket *= (blockContexts.dcThresholds[1]?.length ?? 0) + 1
      bucket += buckets[1] ?? 0
      if (bucket >= blockContexts.dcContextCount) {
        throw invalidInput('JPEG-derived JPEG XL DC context is out of range')
      }
      output[y * dcGroup.blockWidth + x] = bucket
    }
  }
  return output
}

const blockContext = (
  contexts: Readonly<JpegXlJpegBlockContexts>,
  dcIndex: number,
  quantization: number,
  channel: number,
): number => {
  let quantizationIndex = 0
  for (const threshold of contexts.quantizationThresholds) {
    if (quantization > threshold) quantizationIndex += 1
  }
  const mappedChannel = channel < 2 ? channel ^ 1 : 2
  let index = mappedChannel * 13
  index *= contexts.quantizationThresholds.length + 1
  index += quantizationIndex
  index *= contexts.dcContextCount
  index += dcIndex
  const context = contexts.contextMap[index]
  if (context === undefined || context >= contexts.contextCount) {
    throw invalidInput('JPEG-derived JPEG XL block context is invalid')
  }
  return context
}

const unpackCoefficient = (encoded: number): number =>
  (encoded & 1) === 0 ? encoded / 2 : -(encoded >>> 1) - 1

export const decodeJpegXlJpegAcGroup = (
  section: Uint8Array,
  options: Readonly<JpegXlJpegAcGroupOptions>,
  lfGlobal: Readonly<JpegXlJpegLfGlobal>,
  hfPass: Readonly<JpegXlJpegHfPass>,
  dcGroup: Readonly<JpegXlJpegDcGroup>,
): JpegXlJpegAcGroup => {
  const { blockX, blockY, blockWidth, blockHeight, chromaSubsampling, histogramCount } = options
  if (
    !Number.isSafeInteger(blockX) ||
    !Number.isSafeInteger(blockY) ||
    !Number.isSafeInteger(blockWidth) ||
    !Number.isSafeInteger(blockHeight) ||
    blockX < 0 ||
    blockY < 0 ||
    blockWidth < 1 ||
    blockHeight < 1 ||
    blockX + blockWidth > dcGroup.blockWidth ||
    blockY + blockHeight > dcGroup.blockHeight ||
    !Number.isSafeInteger(histogramCount) ||
    histogramCount < 1
  ) {
    throw invalidInput('JPEG-derived JPEG XL AC group geometry is invalid')
  }
  const shifts = subsamplingShifts(chromaSubsampling)
  const reader = new JpegXlBitReader(section)
  const selectorBits = jpegXlCeilLog2(histogramCount)
  const histogram = selectorBits === 0 ? 0 : reader.readBits(selectorBits)
  if (histogram >= histogramCount) {
    throw invalidInput('JPEG-derived JPEG XL histogram selector is invalid')
  }
  const maximumBlocks = blockWidth * blockHeight * 3
  const symbols = new JpegXlEntropySymbolReader(hfPass.coefficientCode, maximumBlocks * 64)
  const dcContexts = dcContextPlane(dcGroup, shifts, lfGlobal.blockContexts)
  const contextOffset = histogram * lfGlobal.blockContexts.contextCount * (37 + 458)
  const nonzeroPlanes: Int32Array<ArrayBufferLike>[] = []
  const internalCoefficients: Int32Array<ArrayBufferLike>[] = []
  const internalWidths: number[] = []
  const internalHeights: number[] = []
  for (let channel = 0; channel < 3; channel += 1) {
    const shift = shifts[channel]
    if (!shift || blockX % 2 ** shift[0] !== 0 || blockY % 2 ** shift[1] !== 0) {
      throw invalidInput('JPEG-derived JPEG XL AC group is not aligned to chroma sampling')
    }
    const width = blockWidth >> shift[0]
    const height = blockHeight >> shift[1]
    internalWidths.push(width)
    internalHeights.push(height)
    nonzeroPlanes.push(new Int32Array(width * height))
    internalCoefficients.push(new Int32Array(width * height * 64))
  }

  for (let y = 0; y < blockHeight; y += 1) {
    for (let x = 0; x < blockWidth; x += 1) {
      for (const channel of [1, 0, 2]) {
        const shift = shifts[channel]
        if (!shift || (x & (2 ** shift[0] - 1)) !== 0 || (y & (2 ** shift[1] - 1)) !== 0) {
          continue
        }
        const localX = x >> shift[0]
        const localY = y >> shift[1]
        const width = internalWidths[channel]
        const nonzeroPlane = nonzeroPlanes[channel]
        const coefficients = internalCoefficients[channel]
        const order = hfPass.coefficientOrders[channel]
        if (!width || !nonzeroPlane || !coefficients || !order) {
          throw invalidInput('JPEG-derived JPEG XL AC channel is missing')
        }
        const predicted = predictNonzeroCount(nonzeroPlane, width, localX, localY)
        const fullX = blockX + x
        const fullY = blockY + y
        const dcIndex = dcContexts[fullY * dcGroup.blockWidth + fullX]
        const quantization = dcGroup.quantization[fullY * dcGroup.blockWidth + fullX]
        if (dcIndex === undefined || quantization === undefined) {
          throw invalidInput('JPEG-derived JPEG XL AC block metadata is missing')
        }
        const context = blockContext(lfGlobal.blockContexts, dcIndex, quantization, channel)
        const nonzeroBucket =
          predicted < 8 ? predicted : 4 + Math.floor(Math.min(64, predicted) / 2)
        const nonzeroContext =
          contextOffset + nonzeroBucket * lfGlobal.blockContexts.contextCount + context
        let nonzero = symbols.readHybridUint(nonzeroContext, reader)
        if (nonzero > 63) throw invalidInput('JPEG-derived JPEG XL AC nonzero count is invalid')
        nonzeroPlane[localY * width + localX] = nonzero
        const coefficientBase = (localY * width + localX) * 64
        const densityOffset =
          contextOffset + lfGlobal.blockContexts.contextCount * 37 + 458 * context
        let previous = nonzero > 4 ? 0 : 1
        for (let scan = 1; scan < 64 && nonzero !== 0; scan += 1) {
          const remainingContext = coefficientNonzeroContext[nonzero]
          const frequencyContext = coefficientFrequencyContext[scan]
          if (remainingContext === undefined || frequencyContext === undefined) {
            throw invalidInput('JPEG-derived JPEG XL AC coefficient context is invalid')
          }
          const coefficientContext =
            densityOffset + (remainingContext + frequencyContext) * 2 + previous
          const encoded = symbols.readHybridUint(coefficientContext, reader)
          const coefficient = unpackCoefficient(encoded)
          const position = order[scan]
          if (position === undefined) {
            throw invalidInput('JPEG-derived JPEG XL coefficient order is incomplete')
          }
          coefficients[coefficientBase + position] = coefficient
          previous = encoded === 0 ? 0 : 1
          nonzero -= previous
        }
        if (nonzero !== 0) {
          throw invalidInput('JPEG-derived JPEG XL AC nonzero count exceeds its block')
        }
      }
    }
  }
  if (!symbols.hasValidFinalState()) {
    throw invalidInput('JPEG-derived JPEG XL AC ANS state is invalid')
  }
  requireZeroPadding(section, reader.bitPosition, 'JPEG XL AC group section')

  const jpegComponents: Int32Array<ArrayBufferLike>[] = []
  for (const channel of [1, 0, 2]) {
    const width = internalWidths[channel]
    const height = internalHeights[channel]
    const encoded = internalCoefficients[channel]
    const dc = dcGroup.dcCoefficients[channel < 2 ? channel ^ 1 : channel]
    const shift = shifts[channel]
    if (!width || !height || !encoded || !dc || !shift) {
      throw invalidInput('JPEG-derived JPEG XL coefficient component is missing')
    }
    const output = new Int32Array(width * height * 64)
    const dcWidth = dcGroup.blockWidth >> shift[0]
    const dcX = blockX >> shift[0]
    const dcY = blockY >> shift[1]
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const base = (y * width + x) * 64
        for (let position = 1; position < 64; position += 1) {
          const transposed = (position & 7) * 8 + (position >>> 3)
          const coefficient = encoded[base + transposed] ?? 0
          if (coefficient < -4095 || coefficient > 4095) {
            throw invalidInput('JPEG-derived JPEG XL AC coefficient is out of JPEG range')
          }
          output[base + position] = coefficient
        }
        const dcCoefficient = dc[(dcY + y) * dcWidth + dcX + x]
        if (dcCoefficient === undefined || dcCoefficient < -2047 || dcCoefficient > 2047) {
          throw invalidInput('JPEG-derived JPEG XL DC coefficient is out of JPEG range')
        }
        output[base] = dcCoefficient
      }
    }
    jpegComponents.push(output)
  }
  return Object.freeze({
    componentCoefficients: Object.freeze(jpegComponents),
    componentBlockWidths: Object.freeze([
      internalWidths[1] ?? 0,
      internalWidths[0] ?? 0,
      internalWidths[2] ?? 0,
    ] as [number, number, number]),
    componentBlockHeights: Object.freeze([
      internalHeights[1] ?? 0,
      internalHeights[0] ?? 0,
      internalHeights[2] ?? 0,
    ] as [number, number, number]),
    endingBitPosition: reader.bitPosition,
  })
}

const naturalDct8Order = (): Uint8Array<ArrayBufferLike> => {
  const order = new Uint8Array(64)
  let position = 0
  for (let diagonal = 0; diagonal <= 14; diagonal += 1) {
    const start = Math.max(0, diagonal - 7)
    const end = Math.min(7, diagonal)
    if ((diagonal & 1) === 0) {
      for (let x = start; x <= end; x += 1) {
        const y = diagonal - x
        order[position] = y * 8 + x
        position += 1
      }
    } else {
      for (let x = end; x >= start; x -= 1) {
        const y = diagonal - x
        order[position] = y * 8 + x
        position += 1
      }
    }
  }
  return order
}

const coefficientOrderContext = (value: number): number =>
  Math.min(value === 0 ? 0 : Math.floor(Math.log2(value)) + 1, 7)

const decodeLehmerPermutation = (code: readonly number[]): Uint8Array<ArrayBufferLike> => {
  const available = Array.from({ length: code.length }, (_, index) => index)
  const permutation = new Uint8Array(code.length)
  for (let index = 0; index < code.length; index += 1) {
    const position = code[index]
    if (position === undefined || position < 0 || position >= available.length) {
      throw invalidInput('JPEG XL coefficient-order permutation is invalid')
    }
    const selected = available.splice(position, 1)[0]
    if (selected === undefined) {
      throw invalidInput('JPEG XL coefficient-order permutation is incomplete')
    }
    permutation[index] = selected
  }
  return permutation
}

const readDct8CoefficientOrders = (
  reader: JpegXlBitReader,
  customized: boolean,
): readonly Uint8Array<ArrayBufferLike>[] => {
  const natural = naturalDct8Order()
  if (!customized) {
    return Object.freeze([natural.slice(), natural.slice(), natural.slice()])
  }
  const code = readJpegXlEntropyCode(reader, 8)
  const symbols = new JpegXlEntropySymbolReader(code, 192)
  const orders: Uint8Array<ArrayBufferLike>[] = []
  for (let channel = 0; channel < 3; channel += 1) {
    const lehmer = new Array<number>(64).fill(0)
    const end = symbols.readHybridUint(coefficientOrderContext(64), reader) + 1
    if (end > 64) throw invalidInput('JPEG XL coefficient-order extent is invalid')
    let previous = 0
    for (let index = 1; index < end; index += 1) {
      const encoded = symbols.readHybridUint(coefficientOrderContext(previous), reader)
      if (encoded >= 64 - index) {
        throw invalidInput('JPEG XL coefficient-order Lehmer value is invalid')
      }
      lehmer[index] = encoded
      previous = encoded
    }
    const permutation = decodeLehmerPermutation(lehmer)
    const order = new Uint8Array(64)
    for (let index = 0; index < order.length; index += 1) {
      const naturalIndex = permutation[index]
      if (naturalIndex === undefined) {
        throw invalidInput('JPEG XL coefficient-order permutation is incomplete')
      }
      order[index] = natural[naturalIndex] ?? 0
    }
    orders.push(order)
  }
  if (!symbols.hasValidFinalState()) {
    throw invalidInput('JPEG XL coefficient-order ANS state is invalid')
  }
  return Object.freeze(orders)
}

const quantizationWidths = Object.freeze([1, 1, 1, 1, 2, 4, 1, 1, 2, 1, 1, 8, 4, 16, 8, 32, 16])
const quantizationHeights = Object.freeze([1, 1, 1, 1, 2, 4, 2, 4, 4, 1, 1, 8, 8, 16, 16, 32, 32])

export const decodeJpegXlJpegHfGlobal = (
  section: Uint8Array,
  options: Readonly<JpegXlJpegHfGlobalOptions>,
  lfGlobal: Readonly<JpegXlJpegLfGlobal>,
): JpegXlJpegHfGlobal => {
  const { dcGroupCount, groupCount, passCount } = options
  if (
    !Number.isSafeInteger(dcGroupCount) ||
    dcGroupCount < 1 ||
    !Number.isSafeInteger(groupCount) ||
    groupCount < 1 ||
    !Number.isSafeInteger(passCount) ||
    passCount < 1 ||
    passCount > 11
  ) {
    throw invalidInput('JPEG-derived JPEG XL HF global geometry is invalid')
  }
  const reader = new JpegXlBitReader(section)
  const allDefaultQuantization = reader.readBits(1) !== 0
  let dct8QuantizationDenominator: number | undefined
  let dct8Quantization: readonly Int32Array<ArrayBufferLike>[] | undefined
  if (!allDefaultQuantization) {
    for (let table = 0; table < quantizationWidths.length; table += 1) {
      const mode = reader.readBits(3)
      if (mode === 0) continue
      if (mode !== 7) {
        throw unsupportedOperation(
          `JPEG-derived JPEG XL quantization mode ${mode} is not supported`,
        )
      }
      const width = (quantizationWidths[table] ?? 0) * 8
      const height = (quantizationHeights[table] ?? 0) * 8
      const denominator = readF16(reader)
      if (!Number.isFinite(denominator) || denominator <= 0) {
        throw invalidInput('JPEG-derived JPEG XL raw quantization denominator is invalid')
      }
      const decoded = decodeJpegXlStandaloneModular(
        section,
        reader.bitPosition,
        [
          { width, height },
          { width, height },
          { width, height },
        ],
        1 + 3 * dcGroupCount + table,
        lfGlobal.globalModularCode,
      )
      for (const plane of decoded.planes) {
        if (plane.some((entry) => entry <= 0)) {
          throw invalidInput('JPEG-derived JPEG XL raw quantization table is invalid')
        }
      }
      if (table === 0) {
        dct8QuantizationDenominator = denominator
        dct8Quantization = decoded.planes
      }
      reader.skipBits(decoded.endingBitPosition - reader.bitPosition)
    }
  }
  const histogramBits = jpegXlCeilLog2(groupCount)
  const histogramCount = (histogramBits === 0 ? 0 : reader.readBits(histogramBits)) + 1
  const contextsPerHistogram = lfGlobal.blockContexts.contextCount * (37 + 458)
  const passes: JpegXlJpegHfPass[] = []
  for (let pass = 0; pass < passCount; pass += 1) {
    const usedOrders = readU32(reader, [value(0x5f), value(0x13), value(0), bits(13)])
    if ((usedOrders & ~1) !== 0) {
      throw unsupportedOperation(
        'JPEG-derived JPEG XL non-DCT8 coefficient orders are not supported',
      )
    }
    const coefficientOrders = readDct8CoefficientOrders(reader, (usedOrders & 1) !== 0)
    const coefficientCode = readJpegXlEntropyCode(reader, histogramCount * contextsPerHistogram)
    passes.push(Object.freeze({ coefficientOrders, coefficientCode }))
  }
  requireZeroPadding(section, reader.bitPosition, 'JPEG XL HF global section')
  return Object.freeze({
    dct8QuantizationDenominator,
    dct8Quantization,
    histogramCount,
    passes: Object.freeze(passes),
    endingBitPosition: reader.bitPosition,
  })
}

export const decodeJpegXlJpegLfGlobal = (section: Uint8Array): JpegXlJpegLfGlobal => {
  const reader = new JpegXlBitReader(section)
  const dcQuantization: [number, number, number] = [1, 1, 1]
  if (reader.readBits(1) === 0) {
    for (let channel = 0; channel < dcQuantization.length; channel += 1) {
      const quantization = readF16(reader) / 128
      if (!Number.isFinite(quantization) || quantization <= 0) {
        throw invalidInput('JPEG-derived JPEG XL DC quantization is invalid')
      }
      dcQuantization[channel] = quantization
    }
  }
  const globalScale = readU32(reader, [
    bits(11, 1),
    bits(11, 2_049),
    bits(12, 4_097),
    bits(16, 8_193),
  ])
  const quantDc = readU32(reader, [value(16), bits(5, 1), bits(8, 1), bits(16, 1)])
  const blockContexts = readBlockContexts(reader)
  const colorCorrelation = readColorCorrelation(reader)
  if (reader.readBits(1) === 0) {
    throw invalidInput('JPEG-derived JPEG XL global Modular tree is missing')
  }
  const tree: Readonly<{ readonly nodes: readonly JpegXlModularNode[]; readonly leaves: number }> =
    readJpegXlModularTree(reader)
  const pixelCode: JpegXlEntropyCode = readJpegXlEntropyCode(reader, tree.leaves)
  requireZeroRemainder(reader, 'JPEG XL LF global section')
  return Object.freeze({
    dcQuantization: Object.freeze(dcQuantization),
    blockContexts,
    colorCorrelation,
    globalScale,
    quantDc,
    globalModularCode: Object.freeze({ nodes: tree.nodes, leaves: tree.leaves, pixelCode }),
  })
}
