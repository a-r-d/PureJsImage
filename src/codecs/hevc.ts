import { invalidInput, unsupportedOperation } from '../errors.ts'
import { HevcCabacDecoder } from './hevc-cabac.ts'

const MAX_EXP_GOLOMB_PREFIX_BITS = 31
const MAX_REFERENCE_PICTURES = 64
const MAX_SHORT_TERM_REFERENCE_PICTURE_SETS = 64
const MAX_TILE_COLUMNS = 20
const MAX_TILE_ROWS = 22
const MAX_ENTRY_POINT_OFFSETS = 4096

class HevcBitReader {
  readonly #data: Uint8Array
  #position = 0

  constructor(data: Uint8Array) {
    this.#data = data
  }

  get bitsRemaining(): number {
    return this.#data.byteLength * 8 - this.#position
  }

  get byteAligned(): boolean {
    return (this.#position & 7) === 0
  }

  get position(): number {
    return this.#position
  }

  readBit(): number {
    if (this.#position >= this.#data.byteLength * 8) {
      throw invalidInput('HEVC RBSP is truncated')
    }
    const byte = this.#data[this.#position >>> 3]
    if (byte === undefined) throw invalidInput('HEVC RBSP is truncated')
    const value = (byte >>> (7 - (this.#position & 7))) & 1
    this.#position += 1
    return value
  }

  readBits(count: number): number {
    if (!Number.isInteger(count) || count < 0 || count > 32) {
      throw invalidInput(`Invalid HEVC bit count: ${count}`)
    }
    let value = 0
    for (let index = 0; index < count; index += 1) value = value * 2 + this.readBit()
    return value
  }

  skipBits(count: number): void {
    if (!Number.isSafeInteger(count) || count < 0) {
      throw invalidInput(`Invalid HEVC skip count: ${count}`)
    }
    if (count > this.bitsRemaining) throw invalidInput('HEVC RBSP is truncated')
    this.#position += count
  }

  readUnsignedExpGolomb(): number {
    let leadingZeros = 0
    while (this.readBit() === 0) {
      leadingZeros += 1
      if (leadingZeros > MAX_EXP_GOLOMB_PREFIX_BITS) {
        throw invalidInput('HEVC Exp-Golomb value is unreasonably large')
      }
    }
    const suffix = this.readBits(leadingZeros)
    const value = 2 ** leadingZeros - 1 + suffix
    if (!Number.isSafeInteger(value)) throw invalidInput('HEVC Exp-Golomb value overflows')
    return value
  }

  readSignedExpGolomb(): number {
    const encoded = this.readUnsignedExpGolomb()
    return (encoded & 1) === 0 ? -(encoded / 2) : (encoded + 1) / 2
  }

  readByteAlignment(): void {
    if (this.readBit() !== 1) throw invalidInput('HEVC byte-alignment marker is invalid')
    while (!this.byteAligned) {
      if (this.readBit() !== 0) throw invalidInput('HEVC byte-alignment padding is invalid')
    }
  }

  readRbspTrailingBits(): void {
    this.readByteAlignment()
    if (this.bitsRemaining !== 0) throw invalidInput('HEVC parameter set has trailing data')
  }
}

export const hevcRbspFromNalUnit = (nalUnit: Uint8Array, expectedType: number): Uint8Array => {
  if (nalUnit.byteLength < 3) throw invalidInput('HEVC NAL unit is truncated')
  const first = nalUnit[0] ?? 0
  const second = nalUnit[1] ?? 0
  if ((first & 0x80) !== 0) throw invalidInput('HEVC NAL forbidden-zero bit is set')
  if (((first >>> 1) & 0x3f) !== expectedType) {
    throw invalidInput(`Expected HEVC NAL type ${expectedType}`)
  }
  if ((second & 0x07) === 0) throw invalidInput('HEVC NAL temporal ID is zero')

  const output: number[] = []
  let zeroCount = 0
  for (let index = 2; index < nalUnit.byteLength; index += 1) {
    const value = nalUnit[index]
    if (value === undefined) throw invalidInput('HEVC NAL unit is truncated')
    if (zeroCount >= 2) {
      if (value === 3) {
        const next = nalUnit[index + 1]
        if (next === undefined) break
        if (next > 3) throw invalidInput('HEVC emulation-prevention byte is malformed')
        zeroCount = 0
        continue
      }
      if (value <= 2) throw invalidInput('HEVC NAL unit is missing emulation prevention')
    }
    output.push(value)
    zeroCount = value === 0 ? zeroCount + 1 : 0
  }
  if (output.length === 0) throw invalidInput('HEVC RBSP is empty')
  return Uint8Array.from(output)
}

const rbspByteOffsetToEbspBoundary = (nalUnit: Uint8Array, target: number): number => {
  let rbspBytes = 0
  let zeroCount = 0
  const payloadBytes = nalUnit.byteLength - 2
  for (let offset = 0; offset <= payloadBytes; offset += 1) {
    if (rbspBytes === target) return offset
    const value = nalUnit[offset + 2]
    if (value === undefined) break
    if (zeroCount >= 2 && value === 3) {
      zeroCount = 0
      continue
    }
    rbspBytes += 1
    zeroCount = value === 0 ? zeroCount + 1 : 0
  }
  throw invalidInput('HEVC slice header has no matching EBSP boundary')
}

const rbspBytesBeforeEbspBoundary = (nalUnit: Uint8Array, boundary: number): number => {
  const payloadBytes = nalUnit.byteLength - 2
  if (!Number.isSafeInteger(boundary) || boundary < 0 || boundary > payloadBytes) {
    throw invalidInput('HEVC slice entry point exceeds its EBSP payload')
  }
  let rbspBytes = 0
  let zeroCount = 0
  for (let offset = 0; offset < boundary; offset += 1) {
    const value = nalUnit[offset + 2]
    if (value === undefined) throw invalidInput('HEVC slice EBSP payload is truncated')
    if (zeroCount >= 2 && value === 3) {
      zeroCount = 0
      continue
    }
    rbspBytes += 1
    zeroCount = value === 0 ? zeroCount + 1 : 0
  }
  return rbspBytes
}

interface ProfileTierLevel {
  readonly level: number
  readonly profile: number
  readonly tier: number
}

const parseProfileTierLevel = (
  reader: HevcBitReader,
  maxSubLayersMinus1: number,
): ProfileTierLevel => {
  reader.skipBits(2)
  const tier = reader.readBit()
  const profile = reader.readBits(5)
  reader.skipBits(32 + 4 + 44)
  const level = reader.readBits(8)
  const subLayerProfilePresent: number[] = []
  const subLayerLevelPresent: number[] = []
  for (let index = 0; index < maxSubLayersMinus1; index += 1) {
    subLayerProfilePresent.push(reader.readBit())
    subLayerLevelPresent.push(reader.readBit())
  }
  if (maxSubLayersMinus1 > 0) reader.skipBits((8 - maxSubLayersMinus1) * 2)
  for (let index = 0; index < maxSubLayersMinus1; index += 1) {
    if (subLayerProfilePresent[index] === 1) reader.skipBits(2 + 1 + 5 + 32 + 4 + 44)
    if (subLayerLevelPresent[index] === 1) reader.skipBits(8)
  }
  return { profile, tier, level }
}

export interface HevcScalingList {
  readonly coefficients: Uint8Array
  readonly dc: number
}

export type HevcScalingLists = ReadonlyMap<number, HevcScalingList>

const DEFAULT_INTRA_8X8 = Uint8Array.from([
  16, 16, 16, 16, 17, 18, 21, 24, 16, 16, 16, 16, 17, 19, 22, 25, 16, 16, 17, 18, 20, 22, 25, 29,
  16, 16, 18, 21, 24, 27, 31, 36, 17, 17, 20, 24, 30, 35, 41, 47, 18, 19, 22, 27, 35, 44, 54, 65,
  21, 22, 25, 31, 41, 54, 70, 88, 24, 25, 29, 36, 47, 65, 88, 115,
])
const DEFAULT_INTER_8X8 = Uint8Array.from([
  16, 16, 16, 16, 17, 18, 20, 24, 16, 16, 16, 17, 18, 20, 24, 25, 16, 16, 17, 18, 20, 24, 25, 28,
  16, 17, 18, 20, 24, 25, 28, 33, 17, 18, 20, 24, 25, 28, 33, 41, 18, 20, 24, 25, 28, 33, 41, 54,
  20, 24, 25, 28, 33, 41, 54, 71, 24, 25, 28, 33, 41, 54, 71, 91,
])

const scalingListKey = (sizeId: number, matrixId: number): number => sizeId * 6 + matrixId

const defaultScalingList = (sizeId: number, matrixId: number): HevcScalingList => ({
  coefficients:
    sizeId === 0
      ? new Uint8Array(16).fill(16)
      : (matrixId < 3 ? DEFAULT_INTRA_8X8 : DEFAULT_INTER_8X8).slice(),
  dc: 16,
})

const defaultScalingLists = (): Map<number, HevcScalingList> => {
  const lists = new Map<number, HevcScalingList>()
  for (let sizeId = 0; sizeId < 4; sizeId += 1) {
    for (let matrixId = 0; matrixId < 6; matrixId += sizeId === 3 ? 3 : 1) {
      lists.set(scalingListKey(sizeId, matrixId), defaultScalingList(sizeId, matrixId))
    }
  }
  return lists
}

const diagonalScalingScan = (size: 4 | 8): readonly number[] => {
  const output: number[] = []
  for (let diagonal = 0; diagonal <= (size - 1) * 2; diagonal += 1) {
    for (let y = diagonal; y >= 0; y -= 1) {
      const x = diagonal - y
      if (x < size && y < size) output.push(y * size + x)
    }
  }
  return output
}

const parseScalingListData = (reader: HevcBitReader): HevcScalingLists => {
  const lists = defaultScalingLists()
  for (let sizeId = 0; sizeId < 4; sizeId += 1) {
    const matrixStep = sizeId === 3 ? 3 : 1
    for (let matrixId = 0; matrixId < 6; matrixId += matrixStep) {
      if (reader.readBit() === 0) {
        const delta = reader.readUnsignedExpGolomb()
        if (delta > matrixId) throw invalidInput('HEVC scaling-list prediction is invalid')
        if (delta > 0) {
          const reference = lists.get(scalingListKey(sizeId, matrixId - delta))
          if (!reference) throw invalidInput('HEVC scaling-list reference is missing')
          lists.set(scalingListKey(sizeId, matrixId), {
            coefficients: reference.coefficients.slice(),
            dc: reference.dc,
          })
        }
        continue
      }
      let nextCoefficient = 8
      let dc = 16
      if (sizeId > 1) {
        dc = 8 + reader.readSignedExpGolomb()
        if (dc < 1 || dc > 255) throw invalidInput('HEVC scaling-list DC value is invalid')
        nextCoefficient = dc
      }
      const coefficientCount = Math.min(64, 1 << (4 + sizeId * 2))
      const coefficients = new Uint8Array(coefficientCount)
      const scan = diagonalScalingScan(sizeId === 0 ? 4 : 8)
      for (let index = 0; index < coefficientCount; index += 1) {
        const delta = reader.readSignedExpGolomb()
        nextCoefficient = (nextCoefficient + delta + 256) & 0xff
        if (nextCoefficient === 0) throw invalidInput('HEVC scaling-list coefficient is zero')
        const position = scan[index]
        if (position === undefined) throw invalidInput('HEVC scaling-list scan is invalid')
        coefficients[position] = nextCoefficient
      }
      lists.set(scalingListKey(sizeId, matrixId), { coefficients, dc })
    }
  }
  return lists
}

const parseShortTermReferencePictureSet = (
  reader: HevcBitReader,
  index: number,
  deltaPictureCounts: number[],
): void => {
  const predicted = index !== 0 && reader.readBit() === 1
  let count = 0
  if (predicted) {
    reader.readBit()
    reader.readUnsignedExpGolomb()
    const referenceCount = deltaPictureCounts[index - 1]
    if (referenceCount === undefined) throw invalidInput('HEVC short-term reference set is invalid')
    for (let picture = 0; picture <= referenceCount; picture += 1) {
      const used = reader.readBit() === 1
      const useDelta = used || reader.readBit() === 1
      if (useDelta) count += 1
    }
  } else {
    const negative = reader.readUnsignedExpGolomb()
    const positive = reader.readUnsignedExpGolomb()
    count = negative + positive
    if (count > MAX_REFERENCE_PICTURES) {
      throw invalidInput('HEVC short-term reference set is unreasonably large')
    }
    for (let picture = 0; picture < negative; picture += 1) {
      reader.readUnsignedExpGolomb()
      reader.readBit()
    }
    for (let picture = 0; picture < positive; picture += 1) {
      reader.readUnsignedExpGolomb()
      reader.readBit()
    }
  }
  if (count > MAX_REFERENCE_PICTURES) {
    throw invalidInput('HEVC short-term reference set is unreasonably large')
  }
  deltaPictureCounts.push(count)
}

const parseSubLayerHrdParameters = (
  reader: HevcBitReader,
  cpbCount: number,
  subPictureParameters: boolean,
): void => {
  for (let index = 0; index < cpbCount; index += 1) {
    reader.readUnsignedExpGolomb()
    reader.readUnsignedExpGolomb()
    if (subPictureParameters) {
      reader.readUnsignedExpGolomb()
      reader.readUnsignedExpGolomb()
    }
    reader.readBit()
  }
}

const parseHrdParameters = (reader: HevcBitReader, maxSubLayersMinus1: number): void => {
  const nalParameters = reader.readBit() === 1
  const vclParameters = reader.readBit() === 1
  let subPictureParameters = false
  if (nalParameters || vclParameters) {
    subPictureParameters = reader.readBit() === 1
    if (subPictureParameters) reader.skipBits(8 + 5 + 1 + 5)
    reader.skipBits(4 + 4)
    if (subPictureParameters) reader.skipBits(4)
    reader.skipBits(5 + 5 + 5)
  }
  for (let layer = 0; layer <= maxSubLayersMinus1; layer += 1) {
    const fixedRateGeneral = reader.readBit() === 1
    const fixedRateWithin = fixedRateGeneral || reader.readBit() === 1
    let lowDelay = false
    if (fixedRateWithin) reader.readUnsignedExpGolomb()
    else lowDelay = reader.readBit() === 1
    const cpbCount = lowDelay ? 1 : reader.readUnsignedExpGolomb() + 1
    if (cpbCount > 32) throw invalidInput('HEVC HRD CPB count is unreasonably large')
    if (nalParameters) parseSubLayerHrdParameters(reader, cpbCount, subPictureParameters)
    if (vclParameters) parseSubLayerHrdParameters(reader, cpbCount, subPictureParameters)
  }
}

export interface HevcVuiInspection {
  readonly chromaLocationBottom: number | undefined
  readonly chromaLocationTop: number | undefined
  readonly colorPrimaries: number | undefined
  readonly fullRange: boolean | undefined
  readonly matrixCoefficients: number | undefined
  readonly transferCharacteristics: number | undefined
}

const parseVuiParameters = (
  reader: HevcBitReader,
  maxSubLayersMinus1: number,
): HevcVuiInspection => {
  if (reader.readBit() === 1) {
    const aspectRatio = reader.readBits(8)
    if (aspectRatio === 255) reader.skipBits(32)
  }
  if (reader.readBit() === 1) reader.readBit()
  let fullRange: boolean | undefined
  let colorPrimaries: number | undefined
  let transferCharacteristics: number | undefined
  let matrixCoefficients: number | undefined
  if (reader.readBit() === 1) {
    reader.skipBits(3)
    fullRange = reader.readBit() === 1
    if (reader.readBit() === 1) {
      colorPrimaries = reader.readBits(8)
      transferCharacteristics = reader.readBits(8)
      matrixCoefficients = reader.readBits(8)
    }
  }
  let chromaLocationTop: number | undefined
  let chromaLocationBottom: number | undefined
  if (reader.readBit() === 1) {
    chromaLocationTop = reader.readUnsignedExpGolomb()
    chromaLocationBottom = reader.readUnsignedExpGolomb()
  }
  reader.skipBits(3)
  if (reader.readBit() === 1) {
    reader.readUnsignedExpGolomb()
    reader.readUnsignedExpGolomb()
    reader.readUnsignedExpGolomb()
    reader.readUnsignedExpGolomb()
  }
  if (reader.readBit() === 1) {
    reader.skipBits(64)
    if (reader.readBit() === 1) reader.readUnsignedExpGolomb()
    if (reader.readBit() === 1) parseHrdParameters(reader, maxSubLayersMinus1)
  }
  if (reader.readBit() === 1) {
    reader.skipBits(3)
    reader.readUnsignedExpGolomb()
    reader.readUnsignedExpGolomb()
    reader.readUnsignedExpGolomb()
    reader.readUnsignedExpGolomb()
    reader.readUnsignedExpGolomb()
  }
  return {
    fullRange,
    colorPrimaries,
    transferCharacteristics,
    matrixCoefficients,
    chromaLocationTop,
    chromaLocationBottom,
  }
}

export interface HevcVpsInspection extends ProfileTierLevel {
  readonly id: number
  readonly maxLayers: number
  readonly maxSubLayers: number
}

export const inspectHevcVps = (nalUnit: Uint8Array): HevcVpsInspection => {
  const reader = new HevcBitReader(hevcRbspFromNalUnit(nalUnit, 32))
  const id = reader.readBits(4)
  reader.skipBits(2)
  const maxLayers = reader.readBits(6) + 1
  const maxSubLayersMinus1 = reader.readBits(3)
  if (maxSubLayersMinus1 > 6) throw invalidInput('HEVC VPS declares too many sub-layers')
  reader.readBit()
  if (reader.readBits(16) !== 0xffff) throw invalidInput('HEVC VPS reserved bits are invalid')
  return {
    id,
    maxLayers,
    maxSubLayers: maxSubLayersMinus1 + 1,
    ...parseProfileTierLevel(reader, maxSubLayersMinus1),
  }
}

export interface HevcSpsInspection extends ProfileTierLevel {
  readonly adaptiveMotionPrediction: boolean
  readonly bitDepth: number
  readonly chromaFormat: 0 | 1 | 2 | 3
  readonly codedHeight: number
  readonly codedWidth: number
  readonly conformanceX: number
  readonly conformanceY: number
  readonly ctbCount: number
  readonly ctbHeight: number
  readonly ctbWidth: number
  readonly height: number
  readonly id: number
  readonly log2CtbSize: number
  readonly log2MaxPictureOrderCount: number
  readonly log2MaxTransformBlockSize: number
  readonly log2MinCodingBlockSize: number
  readonly log2MinTransformBlockSize: number
  readonly maxSubLayers: number
  readonly maxTransformHierarchyDepthIntra: number
  readonly maxTransformHierarchyDepthInter: number
  readonly pcmEnabled: boolean
  readonly pcmLoopFilterDisabled: boolean
  readonly pcmSampleBitDepthChroma: number
  readonly pcmSampleBitDepthLuma: number
  readonly sampleAdaptiveOffset: boolean
  readonly scalingLists: HevcScalingLists | undefined
  readonly scalingListsEnabled: boolean
  readonly scalingListsPresent: boolean
  readonly separateColorPlane: boolean
  readonly strongIntraSmoothing: boolean
  readonly temporalMotionVectorPrediction: boolean
  readonly vpsId: number
  readonly vui: HevcVuiInspection | undefined
  readonly width: number
}

const chromaFormatValue = (value: number): 0 | 1 | 2 | 3 => {
  if (value === 0 || value === 1 || value === 2 || value === 3) return value
  throw invalidInput(`Unsupported HEVC SPS chroma format: ${value}`)
}

export const inspectHevcSps = (nalUnit: Uint8Array): HevcSpsInspection => {
  const reader = new HevcBitReader(hevcRbspFromNalUnit(nalUnit, 33))
  const vpsId = reader.readBits(4)
  const maxSubLayersMinus1 = reader.readBits(3)
  if (maxSubLayersMinus1 > 6) throw invalidInput('HEVC SPS declares too many sub-layers')
  reader.readBit()
  const profileTierLevel = parseProfileTierLevel(reader, maxSubLayersMinus1)
  const id = reader.readUnsignedExpGolomb()
  if (id > 15) throw invalidInput(`HEVC SPS ID is out of range: ${id}`)
  const chromaFormat = chromaFormatValue(reader.readUnsignedExpGolomb())
  const separateColorPlane = chromaFormat === 3 && reader.readBit() === 1
  const codedWidth = reader.readUnsignedExpGolomb()
  const codedHeight = reader.readUnsignedExpGolomb()
  if (codedWidth < 1 || codedHeight < 1) throw invalidInput('HEVC SPS dimensions are invalid')
  let leftOffset = 0
  let rightOffset = 0
  let topOffset = 0
  let bottomOffset = 0
  if (reader.readBit() === 1) {
    leftOffset = reader.readUnsignedExpGolomb()
    rightOffset = reader.readUnsignedExpGolomb()
    topOffset = reader.readUnsignedExpGolomb()
    bottomOffset = reader.readUnsignedExpGolomb()
  }
  const bitDepthLuma = 8 + reader.readUnsignedExpGolomb()
  const bitDepthChroma = 8 + reader.readUnsignedExpGolomb()
  if (bitDepthLuma !== bitDepthChroma) {
    throw invalidInput('HEVC SPS luma and chroma bit depths differ')
  }
  if (bitDepthLuma > 16) throw invalidInput(`Unsupported HEVC SPS bit depth: ${bitDepthLuma}`)
  const log2MaxPictureOrderCount = 4 + reader.readUnsignedExpGolomb()
  if (log2MaxPictureOrderCount > 16) {
    throw invalidInput('HEVC SPS picture-order-count width is invalid')
  }
  const orderingInfoPresent = reader.readBit() === 1
  const firstOrderingLayer = orderingInfoPresent ? 0 : maxSubLayersMinus1
  for (let index = firstOrderingLayer; index <= maxSubLayersMinus1; index += 1) {
    const buffering = reader.readUnsignedExpGolomb()
    const reordering = reader.readUnsignedExpGolomb()
    reader.readUnsignedExpGolomb()
    if (buffering > 16 || reordering > buffering) {
      throw invalidInput('HEVC SPS sub-layer ordering is invalid')
    }
  }
  const log2MinCodingBlockSize = 3 + reader.readUnsignedExpGolomb()
  const log2CtbSize = log2MinCodingBlockSize + reader.readUnsignedExpGolomb()
  const log2MinTransformBlockSize = 2 + reader.readUnsignedExpGolomb()
  const log2MaxTransformBlockSize = log2MinTransformBlockSize + reader.readUnsignedExpGolomb()
  if (
    log2MinCodingBlockSize > 6 ||
    log2CtbSize > 6 ||
    log2MinTransformBlockSize > 5 ||
    log2MaxTransformBlockSize > 5 ||
    log2MaxTransformBlockSize > log2CtbSize
  ) {
    throw invalidInput('HEVC SPS block dimensions are invalid')
  }
  const maxTransformHierarchyDepthInter = reader.readUnsignedExpGolomb()
  const maxTransformHierarchyDepthIntra = reader.readUnsignedExpGolomb()
  if (maxTransformHierarchyDepthInter > 6 || maxTransformHierarchyDepthIntra > 6) {
    throw invalidInput('HEVC SPS transform hierarchy depth is invalid')
  }
  const scalingListsEnabled = reader.readBit() === 1
  const scalingListsPresent = scalingListsEnabled && reader.readBit() === 1
  const scalingLists = scalingListsEnabled
    ? scalingListsPresent
      ? parseScalingListData(reader)
      : defaultScalingLists()
    : undefined
  const adaptiveMotionPrediction = reader.readBit() === 1
  const sampleAdaptiveOffset = reader.readBit() === 1
  const pcmEnabled = reader.readBit() === 1
  let pcmSampleBitDepthLuma = bitDepthLuma
  let pcmSampleBitDepthChroma = bitDepthChroma
  let pcmLoopFilterDisabled = false
  if (pcmEnabled) {
    pcmSampleBitDepthLuma = reader.readBits(4) + 1
    pcmSampleBitDepthChroma = reader.readBits(4) + 1
    const log2MinPcmBlock = reader.readUnsignedExpGolomb() + 3
    const log2MaxPcmBlock = log2MinPcmBlock + reader.readUnsignedExpGolomb()
    pcmLoopFilterDisabled = reader.readBit() === 1
    if (
      pcmSampleBitDepthLuma > bitDepthLuma ||
      pcmSampleBitDepthChroma > bitDepthChroma ||
      log2MinPcmBlock > log2MaxPcmBlock ||
      log2MaxPcmBlock > log2CtbSize
    ) {
      throw invalidInput('HEVC SPS PCM configuration is invalid')
    }
  }
  const shortTermSetCount = reader.readUnsignedExpGolomb()
  if (shortTermSetCount > MAX_SHORT_TERM_REFERENCE_PICTURE_SETS) {
    throw invalidInput('HEVC SPS has too many short-term reference sets')
  }
  const deltaPictureCounts: number[] = []
  for (let index = 0; index < shortTermSetCount; index += 1) {
    parseShortTermReferencePictureSet(reader, index, deltaPictureCounts)
  }
  if (reader.readBit() === 1) {
    const longTermCount = reader.readUnsignedExpGolomb()
    if (longTermCount > MAX_REFERENCE_PICTURES) {
      throw invalidInput('HEVC SPS has too many long-term reference pictures')
    }
    for (let index = 0; index < longTermCount; index += 1) {
      reader.skipBits(log2MaxPictureOrderCount)
      reader.readBit()
    }
  }
  const temporalMotionVectorPrediction = reader.readBit() === 1
  const strongIntraSmoothing = reader.readBit() === 1
  const vui = reader.readBit() === 1 ? parseVuiParameters(reader, maxSubLayersMinus1) : undefined
  if (reader.readBit() === 1) {
    const rangeExtension = reader.readBit() === 1
    const multilayerExtension = reader.readBit() === 1
    const threeDimensionalExtension = reader.readBit() === 1
    const screenContentExtension = reader.readBit() === 1
    const unspecifiedExtension = reader.readBits(4)
    if (
      rangeExtension ||
      multilayerExtension ||
      threeDimensionalExtension ||
      screenContentExtension ||
      unspecifiedExtension !== 0
    ) {
      throw unsupportedOperation('HEVC SPS extensions are unsupported')
    }
  }
  reader.readRbspTrailingBits()

  const chromaArrayType = separateColorPlane ? 0 : chromaFormat
  const subWidth = chromaArrayType === 1 || chromaArrayType === 2 ? 2 : 1
  const subHeight = chromaArrayType === 1 ? 2 : 1
  const width = codedWidth - subWidth * (leftOffset + rightOffset)
  const height = codedHeight - subHeight * (topOffset + bottomOffset)
  const conformanceX = subWidth * leftOffset
  const conformanceY = subHeight * topOffset
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw invalidInput('HEVC SPS conformance window exceeds the coded dimensions')
  }
  const ctbSize = 2 ** log2CtbSize
  const ctbWidth = Math.ceil(codedWidth / ctbSize)
  const ctbHeight = Math.ceil(codedHeight / ctbSize)
  const ctbCount = ctbWidth * ctbHeight
  if (!Number.isSafeInteger(ctbCount) || ctbCount < 1) {
    throw invalidInput('HEVC SPS coding-tree-block geometry is invalid')
  }
  return {
    id,
    vpsId,
    maxSubLayers: maxSubLayersMinus1 + 1,
    chromaFormat,
    separateColorPlane,
    codedWidth,
    codedHeight,
    conformanceX,
    conformanceY,
    width,
    height,
    bitDepth: bitDepthLuma,
    log2MaxPictureOrderCount,
    log2CtbSize,
    log2MinCodingBlockSize,
    log2MinTransformBlockSize,
    log2MaxTransformBlockSize,
    maxTransformHierarchyDepthInter,
    maxTransformHierarchyDepthIntra,
    ctbWidth,
    ctbHeight,
    ctbCount,
    scalingListsEnabled,
    scalingListsPresent,
    scalingLists,
    adaptiveMotionPrediction,
    sampleAdaptiveOffset,
    pcmEnabled,
    pcmSampleBitDepthLuma,
    pcmSampleBitDepthChroma,
    pcmLoopFilterDisabled,
    temporalMotionVectorPrediction,
    strongIntraSmoothing,
    vui,
    ...profileTierLevel,
  }
}

export interface HevcPpsInspection {
  readonly cabacInitializationPresent: boolean
  readonly cbQpOffset: number
  readonly constrainedIntraPrediction: boolean
  readonly cuQpDeltaDepth: number | undefined
  readonly cuQpDeltaEnabled: boolean
  readonly deblockingFilterOverride: boolean
  readonly betaOffset: number
  readonly dependentSliceSegments: boolean
  readonly entropyCodingSynchronization: boolean
  readonly id: number
  readonly initialQp: number
  readonly loopFilterAcrossSlices: boolean
  readonly numExtraSliceHeaderBits: number
  readonly outputFlagPresent: boolean
  readonly ppsDeblockingFilterDisabled: boolean
  readonly crQpOffset: number
  readonly scalingListsPresent: boolean
  readonly scalingLists: HevcScalingLists | undefined
  readonly signDataHiding: boolean
  readonly sliceChromaQpOffsetsPresent: boolean
  readonly sliceHeaderExtensionPresent: boolean
  readonly spsId: number
  readonly tileColumnWidths: readonly number[]
  readonly tileColumns: number
  readonly tileRowHeights: readonly number[]
  readonly tileRows: number
  readonly tilesEnabled: boolean
  readonly transquantBypassEnabled: boolean
  readonly tcOffset: number
  readonly transformSkipEnabled: boolean
  readonly uniformTileSpacing: boolean
}

export const inspectHevcPps = (nalUnit: Uint8Array): HevcPpsInspection => {
  const reader = new HevcBitReader(hevcRbspFromNalUnit(nalUnit, 34))
  const id = reader.readUnsignedExpGolomb()
  const spsId = reader.readUnsignedExpGolomb()
  if (id > 63 || spsId > 15) throw invalidInput('HEVC PPS or SPS ID is out of range')
  const dependentSliceSegments = reader.readBit() === 1
  const outputFlagPresent = reader.readBit() === 1
  const numExtraSliceHeaderBits = reader.readBits(3)
  const signDataHiding = reader.readBit() === 1
  const cabacInitializationPresent = reader.readBit() === 1
  const defaultL0References = reader.readUnsignedExpGolomb() + 1
  const defaultL1References = reader.readUnsignedExpGolomb() + 1
  const initialQp = 26 + reader.readSignedExpGolomb()
  if (defaultL0References > 15 || defaultL1References > 15 || initialQp < -72 || initialQp > 51) {
    throw invalidInput('HEVC PPS reference count or initial QP is invalid')
  }
  const constrainedIntraPrediction = reader.readBit() === 1
  const transformSkipEnabled = reader.readBit() === 1
  const cuQpDeltaEnabled = reader.readBit() === 1
  const cuQpDeltaDepth = cuQpDeltaEnabled ? reader.readUnsignedExpGolomb() : undefined
  if (cuQpDeltaDepth !== undefined && cuQpDeltaDepth > 6) {
    throw invalidInput('HEVC PPS CU QP delta depth is invalid')
  }
  const cbQpOffset = reader.readSignedExpGolomb()
  const crQpOffset = reader.readSignedExpGolomb()
  if (cbQpOffset < -12 || cbQpOffset > 12 || crQpOffset < -12 || crQpOffset > 12) {
    throw invalidInput('HEVC PPS chroma QP offset is invalid')
  }
  const sliceChromaQpOffsetsPresent = reader.readBit() === 1
  reader.readBit()
  reader.readBit()
  const transquantBypassEnabled = reader.readBit() === 1
  const tilesEnabled = reader.readBit() === 1
  const entropyCodingSynchronization = reader.readBit() === 1
  let tileColumns = 1
  let tileRows = 1
  let uniformTileSpacing = true
  const tileColumnWidths: number[] = []
  const tileRowHeights: number[] = []
  if (tilesEnabled) {
    tileColumns = reader.readUnsignedExpGolomb() + 1
    tileRows = reader.readUnsignedExpGolomb() + 1
    if (tileColumns > MAX_TILE_COLUMNS || tileRows > MAX_TILE_ROWS) {
      throw invalidInput('HEVC PPS tile grid is unreasonably large')
    }
    uniformTileSpacing = reader.readBit() === 1
    if (!uniformTileSpacing) {
      for (let column = 1; column < tileColumns; column += 1) {
        tileColumnWidths.push(reader.readUnsignedExpGolomb() + 1)
      }
      for (let row = 1; row < tileRows; row += 1) {
        tileRowHeights.push(reader.readUnsignedExpGolomb() + 1)
      }
    }
    reader.readBit()
  }
  const loopFilterAcrossSlices = reader.readBit() === 1
  const deblockingFilterControlPresent = reader.readBit() === 1
  let deblockingFilterOverride = false
  let ppsDeblockingFilterDisabled = false
  let betaOffset = 0
  let tcOffset = 0
  if (deblockingFilterControlPresent) {
    deblockingFilterOverride = reader.readBit() === 1
    ppsDeblockingFilterDisabled = reader.readBit() === 1
    if (!ppsDeblockingFilterDisabled) {
      betaOffset = reader.readSignedExpGolomb()
      tcOffset = reader.readSignedExpGolomb()
      if (betaOffset < -6 || betaOffset > 6 || tcOffset < -6 || tcOffset > 6) {
        throw invalidInput('HEVC PPS deblocking-filter offset is invalid')
      }
    }
  }
  const scalingListsPresent = reader.readBit() === 1
  const scalingLists = scalingListsPresent ? parseScalingListData(reader) : undefined
  reader.readBit()
  const parallelMergeLevel = reader.readUnsignedExpGolomb() + 2
  if (parallelMergeLevel > 6) throw invalidInput('HEVC PPS parallel merge level is invalid')
  const sliceHeaderExtensionPresent = reader.readBit() === 1
  if (reader.readBit() === 1) {
    const rangeExtension = reader.readBit() === 1
    const multilayerExtension = reader.readBit() === 1
    const threeDimensionalExtension = reader.readBit() === 1
    const screenContentExtension = reader.readBit() === 1
    const unspecifiedExtension = reader.readBits(4)
    if (
      rangeExtension ||
      multilayerExtension ||
      threeDimensionalExtension ||
      screenContentExtension ||
      unspecifiedExtension !== 0
    ) {
      throw unsupportedOperation('HEVC PPS extensions are unsupported')
    }
  }
  reader.readRbspTrailingBits()
  return {
    id,
    spsId,
    initialQp,
    dependentSliceSegments,
    outputFlagPresent,
    numExtraSliceHeaderBits,
    cabacInitializationPresent,
    signDataHiding,
    cbQpOffset,
    crQpOffset,
    constrainedIntraPrediction,
    transformSkipEnabled,
    transquantBypassEnabled,
    cuQpDeltaEnabled,
    cuQpDeltaDepth,
    tilesEnabled,
    entropyCodingSynchronization,
    tileColumns,
    tileRows,
    uniformTileSpacing,
    tileColumnWidths,
    tileRowHeights,
    loopFilterAcrossSlices,
    deblockingFilterOverride,
    ppsDeblockingFilterDisabled,
    betaOffset,
    tcOffset,
    scalingListsPresent,
    scalingLists,
    sliceChromaQpOffsetsPresent,
    sliceHeaderExtensionPresent,
  }
}

const ceilLog2 = (value: number): number => (value <= 1 ? 0 : Math.ceil(Math.log2(value)))

export interface HevcSliceInspection {
  readonly address: number
  readonly dependent: boolean
  readonly entryPointOffsets: number
  readonly firstInPicture: boolean
  readonly headerBytes: number
  readonly noOutputOfPriorPictures: boolean
  readonly payloadBytes: number
  readonly ppsId: number
  readonly sampleAdaptiveOffsetChroma: boolean
  readonly sampleAdaptiveOffsetLuma: boolean
  readonly cbQpOffset: number
  readonly crQpOffset: number
  readonly deblockingFilterDisabled: boolean
  readonly betaOffset: number
  readonly tcOffset: number
  readonly sliceQp: number | undefined
  readonly sliceType: 2 | undefined
  readonly spsId: number
}

export interface HevcSliceData extends HevcSliceInspection {
  readonly cabacBitOffset: number
  readonly rbsp: Uint8Array
  readonly substreamByteOffsets: readonly number[]
}

export const readHevcSliceData = (
  nalUnit: Uint8Array,
  nalUnitType: number,
  parameterSets: {
    readonly pps: readonly HevcPpsInspection[]
    readonly sps: readonly HevcSpsInspection[]
  },
): HevcSliceData => {
  if (nalUnitType !== 19 && nalUnitType !== 20) {
    throw unsupportedOperation(`Unsupported HEVC random-access NAL type: ${nalUnitType}`)
  }
  const rbsp = hevcRbspFromNalUnit(nalUnit, nalUnitType)
  const reader = new HevcBitReader(rbsp)
  const firstInPicture = reader.readBit() === 1
  const noOutputOfPriorPictures = reader.readBit() === 1
  const ppsId = reader.readUnsignedExpGolomb()
  const pps = parameterSets.pps.find((candidate) => candidate.id === ppsId)
  if (!pps) throw invalidInput(`HEVC slice references missing PPS ${ppsId}`)
  const sps = parameterSets.sps.find((candidate) => candidate.id === pps.spsId)
  if (!sps) throw invalidInput(`HEVC PPS ${ppsId} references missing SPS ${pps.spsId}`)
  let dependent = false
  let address = 0
  if (!firstInPicture) {
    if (pps.dependentSliceSegments) dependent = reader.readBit() === 1
    const addressBits = ceilLog2(sps.ctbCount)
    address = reader.readBits(addressBits)
    if (address === 0 || address >= sps.ctbCount) {
      throw invalidInput('HEVC slice-segment address is outside the coded picture')
    }
  }
  let sliceType: 2 | undefined
  let saoLuma = false
  let saoChroma = false
  let sliceQp: number | undefined
  let cbQpOffset = pps.cbQpOffset
  let crQpOffset = pps.crQpOffset
  let deblockingFilterDisabled = pps.ppsDeblockingFilterDisabled
  let betaOffset = pps.betaOffset
  let tcOffset = pps.tcOffset
  if (!dependent) {
    reader.skipBits(pps.numExtraSliceHeaderBits)
    const parsedSliceType = reader.readUnsignedExpGolomb()
    if (parsedSliceType !== 2) {
      throw unsupportedOperation('Inter-predicted HEVC slices are unsupported')
    }
    sliceType = 2
    if (pps.outputFlagPresent) reader.readBit()
    if (sps.separateColorPlane) reader.skipBits(2)
    if (sps.sampleAdaptiveOffset) {
      saoLuma = reader.readBit() === 1
      if (sps.chromaFormat !== 0) saoChroma = reader.readBit() === 1
    }
    sliceQp = pps.initialQp + reader.readSignedExpGolomb()
    if (sliceQp < -sps.bitDepth * 6 + 48 || sliceQp > 51) {
      throw invalidInput('HEVC slice QP is invalid')
    }
    if (pps.sliceChromaQpOffsetsPresent) {
      const sliceCbOffset = reader.readSignedExpGolomb()
      const sliceCrOffset = reader.readSignedExpGolomb()
      if (sliceCbOffset < -12 || sliceCbOffset > 12 || sliceCrOffset < -12 || sliceCrOffset > 12) {
        throw invalidInput('HEVC slice chroma QP offset is invalid')
      }
      cbQpOffset += sliceCbOffset
      crQpOffset += sliceCrOffset
    }
    if (pps.deblockingFilterOverride && reader.readBit() === 1) {
      deblockingFilterDisabled = reader.readBit() === 1
      if (!deblockingFilterDisabled) {
        betaOffset = reader.readSignedExpGolomb()
        tcOffset = reader.readSignedExpGolomb()
        if (betaOffset < -6 || betaOffset > 6 || tcOffset < -6 || tcOffset > 6) {
          throw invalidInput('HEVC slice deblocking-filter offset is invalid')
        }
      }
    }
    if (pps.loopFilterAcrossSlices && (saoLuma || saoChroma || !deblockingFilterDisabled)) {
      reader.readBit()
    }
  }
  let entryPointOffsets = 0
  const entryPointSizes: number[] = []
  if (pps.tilesEnabled || pps.entropyCodingSynchronization) {
    entryPointOffsets = reader.readUnsignedExpGolomb()
    if (entryPointOffsets > MAX_ENTRY_POINT_OFFSETS) {
      throw invalidInput('HEVC slice has too many entry-point offsets')
    }
    if (entryPointOffsets > 0) {
      const offsetBits = reader.readUnsignedExpGolomb() + 1
      if (offsetBits > 32) throw invalidInput('HEVC slice entry-point width is invalid')
      for (let index = 0; index < entryPointOffsets; index += 1) {
        entryPointSizes.push(reader.readBits(offsetBits) + 1)
      }
    }
  }
  if (pps.sliceHeaderExtensionPresent) {
    const extensionBytes = reader.readUnsignedExpGolomb()
    if (extensionBytes > 4096) throw invalidInput('HEVC slice-header extension is too large')
    reader.skipBits(extensionBytes * 8)
  }
  reader.readByteAlignment()
  if (reader.bitsRemaining < 9)
    throw invalidInput('HEVC slice has no complete CABAC initialization')
  new HevcCabacDecoder(rbsp, reader.position)
  const cabacByteOffset = reader.position / 8
  const cabacEbspOffset = rbspByteOffsetToEbspBoundary(nalUnit, cabacByteOffset)
  const substreamByteOffsets = [cabacByteOffset]
  let cumulativeEbspBytes = 0
  for (const size of entryPointSizes) {
    cumulativeEbspBytes += size
    if (!Number.isSafeInteger(cumulativeEbspBytes)) {
      throw invalidInput('HEVC slice entry-point offsets overflow')
    }
    const ebspOffset = cabacEbspOffset + cumulativeEbspBytes
    if (ebspOffset > nalUnit.byteLength - 2) {
      throw invalidInput('HEVC slice entry-point offset exceeds its payload')
    }
    substreamByteOffsets.push(rbspBytesBeforeEbspBoundary(nalUnit, ebspOffset))
  }
  return {
    firstInPicture,
    noOutputOfPriorPictures,
    dependent,
    address,
    ppsId,
    spsId: sps.id,
    sliceType,
    sliceQp,
    sampleAdaptiveOffsetLuma: saoLuma,
    sampleAdaptiveOffsetChroma: saoChroma,
    cbQpOffset,
    crQpOffset,
    deblockingFilterDisabled,
    betaOffset,
    tcOffset,
    entryPointOffsets,
    headerBytes: reader.position / 8,
    payloadBytes: Math.ceil(reader.bitsRemaining / 8),
    cabacBitOffset: reader.position,
    rbsp,
    substreamByteOffsets,
  }
}

export const inspectHevcSlice = (
  nalUnit: Uint8Array,
  nalUnitType: number,
  parameterSets: {
    readonly pps: readonly HevcPpsInspection[]
    readonly sps: readonly HevcSpsInspection[]
  },
): HevcSliceInspection => {
  const {
    rbsp: _rbsp,
    cabacBitOffset: _cabacBitOffset,
    ...inspection
  } = readHevcSliceData(nalUnit, nalUnitType, parameterSets)
  return inspection
}
