import type { ChromaSubsampling } from '../codec.ts'
import { invalidInput } from '../errors.ts'

const MAX_OBUS = 65_536
const SELECT_SCREEN_CONTENT_TOOLS = 2
const SELECT_INTEGER_MV = 2

export const av1ObuType = {
  sequenceHeader: 1,
  temporalDelimiter: 2,
  frameHeader: 3,
  tileGroup: 4,
  metadata: 5,
  frame: 6,
  redundantFrameHeader: 7,
  tileList: 8,
  padding: 15,
} as const

export interface Av1Obu {
  readonly type: number
  readonly temporalId: number
  readonly spatialId: number
  readonly offset: number
  readonly headerBytes: number
  readonly payload: Uint8Array
  readonly totalBytes: number
}

export interface Av1OperatingPoint {
  readonly idc: number
  readonly level: number
  readonly tier: number
  readonly decoderModelPresent: boolean
  readonly initialDisplayDelay?: number
}

export interface Av1SequenceHeader {
  readonly profile: number
  readonly stillPicture: boolean
  readonly reducedStillPictureHeader: boolean
  readonly operatingPoints: readonly Av1OperatingPoint[]
  readonly decoderModelInfoPresent: boolean
  readonly frameIdNumbersPresent: boolean
  readonly maxFrameWidth: number
  readonly maxFrameHeight: number
  readonly use128x128Superblock: boolean
  readonly enableFilterIntra: boolean
  readonly enableIntraEdgeFilter: boolean
  readonly enableInterintraCompound: boolean
  readonly enableMaskedCompound: boolean
  readonly enableWarpedMotion: boolean
  readonly enableDualFilter: boolean
  readonly enableOrderHint: boolean
  readonly enableJointCompound: boolean
  readonly enableReferenceFrameMvs: boolean
  readonly forceScreenContentTools: number
  readonly forceIntegerMv: number
  readonly orderHintBits: number
  readonly enableSuperres: boolean
  readonly enableCdef: boolean
  readonly enableRestoration: boolean
  readonly bitDepth: 8 | 10 | 12
  readonly monochrome: boolean
  readonly chromaSubsampling: ChromaSubsampling
  readonly colorPrimaries: number
  readonly transferCharacteristics: number
  readonly matrixCoefficients: number
  readonly fullRange: boolean
  readonly chromaSamplePosition: number
  readonly separateUvDeltaQ: boolean
  readonly filmGrainParamsPresent: boolean
}

export class Av1BitReader {
  readonly #data: Uint8Array
  #position = 0

  constructor(data: Uint8Array) {
    this.#data = data
  }

  get bitPosition(): number {
    return this.#position
  }

  get bytePosition(): number {
    if ((this.#position & 7) !== 0) throw invalidInput('AV1 reader is not byte-aligned')
    return this.#position >>> 3
  }

  get remainingBits(): number {
    return this.#data.byteLength * 8 - this.#position
  }

  readBit(): number {
    if (this.#position >= this.#data.byteLength * 8) {
      throw invalidInput('AV1 bitstream is truncated')
    }
    const byte = this.#data[this.#position >>> 3]
    if (byte === undefined) throw invalidInput('AV1 bitstream is truncated')
    const value = (byte >>> (7 - (this.#position & 7))) & 1
    this.#position += 1
    return value
  }

  readBits(count: number): number {
    if (!Number.isInteger(count) || count < 0 || count > 32) {
      throw invalidInput(`Invalid AV1 bit count: ${count}`)
    }
    let value = 0
    for (let index = 0; index < count; index += 1) value = value * 2 + this.readBit()
    return value
  }

  readSigned(count: number): number {
    if (!Number.isInteger(count) || count < 1 || count > 32) {
      throw invalidInput(`Invalid AV1 signed bit count: ${count}`)
    }
    const value = this.readBits(count)
    const signMask = 2 ** (count - 1)
    return (value & signMask) === 0 ? value : value - 2 * signMask
  }

  readNonSymmetric(symbols: number): number {
    if (!Number.isSafeInteger(symbols) || symbols < 1) {
      throw invalidInput(`Invalid AV1 non-symmetric alphabet size: ${symbols}`)
    }
    if (symbols === 1) return 0
    const width = Math.floor(Math.log2(symbols)) + 1
    const threshold = 2 ** width - symbols
    const value = this.readBits(width - 1)
    if (value < threshold) return value
    return value * 2 - threshold + this.readBit()
  }

  alignToByte(): void {
    while ((this.#position & 7) !== 0) {
      if (this.readBit() !== 0) throw invalidInput('AV1 byte-alignment bit must be zero')
    }
  }

  readUnsignedVariableLength(): number {
    let leadingZeros = 0
    while (this.readBit() === 0) {
      leadingZeros += 1
      if (leadingZeros > 32) throw invalidInput('AV1 variable-length integer is invalid')
    }
    if (leadingZeros === 32) return 0xffff_ffff
    return this.readBits(leadingZeros) + 2 ** leadingZeros - 1
  }

  readTrailingBits(): void {
    if (this.readBit() !== 1) throw invalidInput('AV1 trailing one bit is missing')
    while (this.#position < this.#data.byteLength * 8) {
      if (this.readBit() !== 0) throw invalidInput('AV1 trailing padding bits must be zero')
    }
  }
}

export const readAv1Leb128 = (
  data: Uint8Array,
  offset: number,
): { readonly value: number; readonly bytes: number } => {
  let value = 0n
  for (let index = 0; index < 8; index += 1) {
    const byte = data[offset + index]
    if (byte === undefined) throw invalidInput('AV1 LEB128 value is truncated')
    value |= BigInt(byte & 0x7f) << BigInt(index * 7)
    if (value > 0xffff_ffffn) throw invalidInput('AV1 LEB128 value exceeds 32 bits')
    if ((byte & 0x80) === 0) return { value: Number(value), bytes: index + 1 }
  }
  throw invalidInput('AV1 LEB128 value exceeds eight bytes')
}

export const parseAv1Obus = (data: Uint8Array): readonly Av1Obu[] => {
  const obus: Av1Obu[] = []
  let offset = 0
  while (offset < data.byteLength) {
    if (obus.length >= MAX_OBUS) throw invalidInput('AV1 bitstream contains too many OBUs')
    const first = data[offset]
    if (first === undefined) throw invalidInput('AV1 OBU header is truncated')
    if ((first & 0x80) !== 0) throw invalidInput('AV1 OBU forbidden bit is set')
    if ((first & 1) !== 0) throw invalidInput('AV1 OBU reserved bit is set')

    const type = (first >>> 3) & 0x0f
    const extension = (first & 4) !== 0
    const hasSize = (first & 2) !== 0
    if (!hasSize) throw invalidInput('AV1 low-overhead OBU requires an explicit size field')
    let headerBytes = 1
    let temporalId = 0
    let spatialId = 0
    if (extension) {
      const extensionByte = data[offset + headerBytes]
      if (extensionByte === undefined) throw invalidInput('AV1 OBU extension is truncated')
      if ((extensionByte & 7) !== 0) throw invalidInput('AV1 OBU extension reserved bits are set')
      temporalId = extensionByte >>> 5
      spatialId = (extensionByte >>> 3) & 3
      headerBytes += 1
    }

    const encodedSize = readAv1Leb128(data, offset + headerBytes)
    headerBytes += encodedSize.bytes
    const payloadBytes = encodedSize.value
    const totalBytes = headerBytes + payloadBytes
    if (!Number.isSafeInteger(totalBytes) || totalBytes < headerBytes) {
      throw invalidInput('AV1 OBU size overflows')
    }
    const end = offset + totalBytes
    if (end > data.byteLength) throw invalidInput('AV1 OBU payload is truncated')

    obus.push({
      type,
      temporalId,
      spatialId,
      offset,
      headerBytes,
      payload: data.subarray(offset + headerBytes, end),
      totalBytes,
    })
    offset = end
  }
  return obus
}

export const parseAv1SequenceHeader = (data: Uint8Array): Av1SequenceHeader => {
  const reader = new Av1BitReader(data)
  const profile = reader.readBits(3)
  if (profile > 2) throw invalidInput(`Unsupported AV1 sequence profile: ${profile}`)
  const stillPicture = reader.readBit() === 1
  const reducedStillPictureHeader = reader.readBit() === 1
  if (reducedStillPictureHeader && !stillPicture) {
    throw invalidInput('AV1 reduced still-picture header requires still_picture')
  }

  let decoderModelInfoPresent = false
  let bufferDelayLength = 0
  let initialDisplayDelayPresent = false
  const operatingPoints: Av1OperatingPoint[] = []
  if (reducedStillPictureHeader) {
    operatingPoints.push({
      idc: 0,
      level: reader.readBits(5),
      tier: 0,
      decoderModelPresent: false,
    })
  } else {
    const timingInfoPresent = reader.readBit() === 1
    if (timingInfoPresent) {
      reader.readBits(32)
      reader.readBits(32)
      if (reader.readBit() === 1) reader.readUnsignedVariableLength()
      decoderModelInfoPresent = reader.readBit() === 1
      if (decoderModelInfoPresent) {
        bufferDelayLength = reader.readBits(5) + 1
        reader.readBits(32)
        reader.readBits(5)
        reader.readBits(5)
      }
    }
    initialDisplayDelayPresent = reader.readBit() === 1
    const operatingPointCount = reader.readBits(5) + 1
    for (let index = 0; index < operatingPointCount; index += 1) {
      const idc = reader.readBits(12)
      const level = reader.readBits(5)
      const tier = level > 7 ? reader.readBit() : 0
      let decoderModelPresent = false
      if (decoderModelInfoPresent) {
        decoderModelPresent = reader.readBit() === 1
        if (decoderModelPresent) {
          reader.readBits(bufferDelayLength)
          reader.readBits(bufferDelayLength)
          reader.readBit()
        }
      }
      const initialDisplayDelay =
        initialDisplayDelayPresent && reader.readBit() === 1 ? reader.readBits(4) + 1 : undefined
      operatingPoints.push({
        idc,
        level,
        tier,
        decoderModelPresent,
        ...(initialDisplayDelay !== undefined ? { initialDisplayDelay } : {}),
      })
    }
  }

  const frameWidthBits = reader.readBits(4) + 1
  const frameHeightBits = reader.readBits(4) + 1
  const maxFrameWidth = reader.readBits(frameWidthBits) + 1
  const maxFrameHeight = reader.readBits(frameHeightBits) + 1
  let frameIdNumbersPresent = false
  if (!reducedStillPictureHeader) {
    frameIdNumbersPresent = reader.readBit() === 1
    if (frameIdNumbersPresent) {
      reader.readBits(4)
      reader.readBits(3)
    }
  }

  const use128x128Superblock = reader.readBit() === 1
  const enableFilterIntra = reader.readBit() === 1
  const enableIntraEdgeFilter = reader.readBit() === 1
  let enableInterintraCompound = false
  let enableMaskedCompound = false
  let enableWarpedMotion = false
  let enableDualFilter = false
  let enableOrderHint = false
  let enableJointCompound = false
  let enableReferenceFrameMvs = false
  let forceScreenContentTools = SELECT_SCREEN_CONTENT_TOOLS
  let forceIntegerMv = SELECT_INTEGER_MV
  let orderHintBits = 0
  if (!reducedStillPictureHeader) {
    enableInterintraCompound = reader.readBit() === 1
    enableMaskedCompound = reader.readBit() === 1
    enableWarpedMotion = reader.readBit() === 1
    enableDualFilter = reader.readBit() === 1
    enableOrderHint = reader.readBit() === 1
    if (enableOrderHint) {
      enableJointCompound = reader.readBit() === 1
      enableReferenceFrameMvs = reader.readBit() === 1
    }
    forceScreenContentTools =
      reader.readBit() === 1 ? SELECT_SCREEN_CONTENT_TOOLS : reader.readBit()
    if (forceScreenContentTools > 0) {
      forceIntegerMv = reader.readBit() === 1 ? SELECT_INTEGER_MV : reader.readBit()
    }
    if (enableOrderHint) orderHintBits = reader.readBits(3) + 1
  }

  const enableSuperres = reader.readBit() === 1
  const enableCdef = reader.readBit() === 1
  const enableRestoration = reader.readBit() === 1
  const highBitDepth = reader.readBit() === 1
  const bitDepth: 8 | 10 | 12 =
    profile === 2 && highBitDepth ? (reader.readBit() === 1 ? 12 : 10) : highBitDepth ? 10 : 8
  const monochrome = profile === 1 ? false : reader.readBit() === 1
  const colorDescriptionPresent = reader.readBit() === 1
  const colorPrimaries = colorDescriptionPresent ? reader.readBits(8) : 2
  const transferCharacteristics = colorDescriptionPresent ? reader.readBits(8) : 2
  const matrixCoefficients = colorDescriptionPresent ? reader.readBits(8) : 2

  let fullRange: boolean
  let subsamplingX: number
  let subsamplingY: number
  let chromaSamplePosition = 0
  let separateUvDeltaQ = false
  if (monochrome) {
    fullRange = reader.readBit() === 1
    subsamplingX = 1
    subsamplingY = 1
  } else if (colorPrimaries === 1 && transferCharacteristics === 13 && matrixCoefficients === 0) {
    fullRange = true
    subsamplingX = 0
    subsamplingY = 0
    separateUvDeltaQ = reader.readBit() === 1
  } else {
    fullRange = reader.readBit() === 1
    if (profile === 0) {
      subsamplingX = 1
      subsamplingY = 1
    } else if (profile === 1) {
      subsamplingX = 0
      subsamplingY = 0
    } else if (bitDepth === 12) {
      subsamplingX = reader.readBit()
      subsamplingY = subsamplingX === 1 ? reader.readBit() : 0
    } else {
      subsamplingX = 1
      subsamplingY = 0
    }
    if (subsamplingX === 1 && subsamplingY === 1) {
      chromaSamplePosition = reader.readBits(2)
    }
    separateUvDeltaQ = reader.readBit() === 1
  }
  const filmGrainParamsPresent = reader.readBit() === 1
  reader.readTrailingBits()

  const chromaSubsampling: ChromaSubsampling = monochrome
    ? '400'
    : subsamplingX === 0
      ? '444'
      : subsamplingY === 0
        ? '422'
        : '420'
  return {
    profile,
    stillPicture,
    reducedStillPictureHeader,
    operatingPoints,
    decoderModelInfoPresent,
    frameIdNumbersPresent,
    maxFrameWidth,
    maxFrameHeight,
    use128x128Superblock,
    enableFilterIntra,
    enableIntraEdgeFilter,
    enableInterintraCompound,
    enableMaskedCompound,
    enableWarpedMotion,
    enableDualFilter,
    enableOrderHint,
    enableJointCompound,
    enableReferenceFrameMvs,
    forceScreenContentTools,
    forceIntegerMv,
    orderHintBits,
    enableSuperres,
    enableCdef,
    enableRestoration,
    bitDepth,
    monochrome,
    chromaSubsampling,
    colorPrimaries,
    transferCharacteristics,
    matrixCoefficients,
    fullRange,
    chromaSamplePosition,
    separateUvDeltaQ,
    filmGrainParamsPresent,
  }
}

export const inspectAv1Bitstream = (
  data: Uint8Array,
): { readonly obus: readonly Av1Obu[]; readonly sequence: Av1SequenceHeader } => {
  const obus = parseAv1Obus(data)
  const sequenceHeaders = obus.filter((obu) => obu.type === av1ObuType.sequenceHeader)
  if (sequenceHeaders.length !== 1) {
    throw invalidInput(
      `AV1 image item requires exactly one sequence header; found ${sequenceHeaders.length}`,
    )
  }
  const sequenceHeader = sequenceHeaders[0]
  if (!sequenceHeader) throw invalidInput('AV1 image item has no sequence header')
  return { obus, sequence: parseAv1SequenceHeader(sequenceHeader.payload) }
}
