import { invalidInput, unsupportedOperation } from '../errors.ts'
import { Av1BitReader } from './av1.ts'
import type { Av1SequenceHeader } from './av1.ts'

const MAX_TILE_WIDTH = 4096
const MAX_TILE_AREA = 4096 * 2304
const MAX_TILE_COLS = 64
const MAX_TILE_ROWS = 64
const MAX_SEGMENTS = 8
const SEGMENT_FEATURE_BITS = [8, 6, 6, 6, 6, 3, 0, 0] as const
const SEGMENT_FEATURE_LIMITS = [255, 63, 63, 63, 63, 7, 0, 0] as const
const SEGMENT_FEATURE_SIGNED = [true, true, true, true, true, false, false, false] as const

export interface Av1Tile {
  readonly column: number
  readonly data: Uint8Array
  readonly miColumnEnd: number
  readonly miColumnStart: number
  readonly miRowEnd: number
  readonly miRowStart: number
  readonly row: number
}

export interface Av1FrameHeader {
  readonly allowIntrabc: boolean
  readonly allowScreenContentTools: boolean
  readonly allLossless: boolean
  readonly baseQuantizer: number
  readonly cdefBits: number
  readonly cdefDamping: number
  readonly cdefUvPrimaryStrengths: readonly number[]
  readonly cdefUvSecondaryStrengths: readonly number[]
  readonly cdefYPrimaryStrengths: readonly number[]
  readonly cdefYSecondaryStrengths: readonly number[]
  readonly codedLossless: boolean
  readonly deltaLfPresent: boolean
  readonly deltaQPresent: boolean
  readonly deltaQResolution: number
  readonly deltaUAc: number
  readonly deltaUDc: number
  readonly deltaVAc: number
  readonly deltaVDc: number
  readonly deltaYDc: number
  readonly disableCdfUpdate: boolean
  readonly frameHeight: number
  readonly frameWidth: number
  readonly headerBytes: number
  readonly loopFilterDeltaEnabled: boolean
  readonly loopFilterLevels: readonly number[]
  readonly loopFilterModeDeltas: readonly number[]
  readonly loopFilterRefDeltas: readonly number[]
  readonly loopFilterSharpness: number
  readonly qmU: number
  readonly qmV: number
  readonly qmY: number
  readonly reducedTransformSet: boolean
  readonly renderHeight: number
  readonly renderWidth: number
  readonly restorationTypes: readonly number[]
  readonly restorationUnitSizes: readonly number[]
  readonly segmentationEnabled: boolean
  readonly tileColumns: number
  readonly tileRows: number
  readonly tileSizeBytes: number
  readonly transformMode: '4x4' | 'largest' | 'select'
  readonly upscaledWidth: number
  readonly usingQMatrix: boolean
}

export interface Av1Frame {
  readonly header: Av1FrameHeader
  readonly tiles: readonly Av1Tile[]
}

interface TileLayout {
  readonly columnStarts: readonly number[]
  readonly columns: number
  readonly columnsLog2: number
  readonly rowStarts: readonly number[]
  readonly rows: number
  readonly rowsLog2: number
  readonly tileSizeBytes: number
}

interface Quantization {
  readonly base: number
  readonly uAc: number
  readonly uDc: number
  readonly vAc: number
  readonly vDc: number
  readonly yDc: number
  readonly qmU: number
  readonly qmV: number
  readonly qmY: number
  readonly usingQMatrix: boolean
}

interface Segmentation {
  readonly enabled: boolean
  readonly featureData: readonly (readonly number[])[]
  readonly featureEnabled: readonly (readonly boolean[])[]
}

const tileLog2 = (blockSize: number, target: number): number => {
  let value = 0
  while (blockSize * 2 ** value < target) value += 1
  return value
}

const readDeltaQuantizer = (reader: Av1BitReader): number =>
  reader.readBit() === 1 ? reader.readSigned(7) : 0

const parseQuantization = (reader: Av1BitReader, sequence: Av1SequenceHeader): Quantization => {
  const base = reader.readBits(8)
  const yDc = readDeltaQuantizer(reader)
  let uDc = 0
  let uAc = 0
  let vDc = 0
  let vAc = 0
  if (!sequence.monochrome) {
    const differentUv = sequence.separateUvDeltaQ && reader.readBit() === 1
    uDc = readDeltaQuantizer(reader)
    uAc = readDeltaQuantizer(reader)
    if (differentUv) {
      vDc = readDeltaQuantizer(reader)
      vAc = readDeltaQuantizer(reader)
    } else {
      vDc = uDc
      vAc = uAc
    }
  }
  const usingQMatrix = reader.readBit() === 1
  let qmY = 15
  let qmU = 15
  let qmV = 15
  if (usingQMatrix) {
    qmY = reader.readBits(4)
    qmU = reader.readBits(4)
    qmV = sequence.separateUvDeltaQ ? reader.readBits(4) : qmU
  }
  return { base, yDc, uDc, uAc, vDc, vAc, usingQMatrix, qmY, qmU, qmV }
}

const parseSegmentation = (reader: Av1BitReader): Segmentation => {
  const enabled = reader.readBit() === 1
  const featureEnabled: boolean[][] = Array.from({ length: MAX_SEGMENTS }, () =>
    Array.from({ length: SEGMENT_FEATURE_BITS.length }, () => false),
  )
  const featureData: number[][] = Array.from({ length: MAX_SEGMENTS }, () =>
    Array.from({ length: SEGMENT_FEATURE_BITS.length }, () => 0),
  )
  if (!enabled) return { enabled, featureEnabled, featureData }

  for (let segment = 0; segment < MAX_SEGMENTS; segment += 1) {
    const enabledFeatures = featureEnabled[segment]
    const featureValues = featureData[segment]
    if (!enabledFeatures || !featureValues) {
      throw invalidInput('AV1 segmentation state is invalid')
    }
    for (let feature = 0; feature < SEGMENT_FEATURE_BITS.length; feature += 1) {
      const active = reader.readBit() === 1
      enabledFeatures[feature] = active
      if (!active) continue
      const bits = SEGMENT_FEATURE_BITS[feature] ?? 0
      const value = SEGMENT_FEATURE_SIGNED[feature]
        ? reader.readSigned(bits + 1)
        : reader.readBits(bits)
      const limit = SEGMENT_FEATURE_LIMITS[feature] ?? 0
      featureValues[feature] = Math.max(-limit, Math.min(limit, value))
    }
  }
  return { enabled, featureEnabled, featureData }
}

const parseTileLayout = (
  reader: Av1BitReader,
  sequence: Av1SequenceHeader,
  miColumns: number,
  miRows: number,
): TileLayout => {
  const shift = sequence.use128x128Superblock ? 5 : 4
  const size = shift + 2
  const sbColumns = sequence.use128x128Superblock ? (miColumns + 31) >> 5 : (miColumns + 15) >> 4
  const sbRows = sequence.use128x128Superblock ? (miRows + 31) >> 5 : (miRows + 15) >> 4
  const maxTileWidthSb = MAX_TILE_WIDTH >> size
  let maxTileAreaSb = MAX_TILE_AREA >> (2 * size)
  const minimumColumnLog2 = tileLog2(maxTileWidthSb, sbColumns)
  const maximumColumnLog2 = tileLog2(1, Math.min(sbColumns, MAX_TILE_COLS))
  const maximumRowLog2 = tileLog2(1, Math.min(sbRows, MAX_TILE_ROWS))
  const minimumTilesLog2 = Math.max(minimumColumnLog2, tileLog2(maxTileAreaSb, sbRows * sbColumns))
  const columnStarts: number[] = []
  const rowStarts: number[] = []
  let columnsLog2: number
  let rowsLog2: number

  if (reader.readBit() === 1) {
    columnsLog2 = minimumColumnLog2
    while (columnsLog2 < maximumColumnLog2 && reader.readBit() === 1) columnsLog2 += 1
    const tileWidthSb = Math.ceil(sbColumns / 2 ** columnsLog2)
    for (let start = 0; start < sbColumns; start += tileWidthSb) columnStarts.push(start << shift)
    columnStarts.push(miColumns)

    rowsLog2 = Math.max(minimumTilesLog2 - columnsLog2, 0)
    while (rowsLog2 < maximumRowLog2 && reader.readBit() === 1) rowsLog2 += 1
    const tileHeightSb = Math.ceil(sbRows / 2 ** rowsLog2)
    for (let start = 0; start < sbRows; start += tileHeightSb) rowStarts.push(start << shift)
    rowStarts.push(miRows)
  } else {
    let start = 0
    let widest = 0
    while (start < sbColumns) {
      columnStarts.push(start << shift)
      const width = reader.readNonSymmetric(Math.min(sbColumns - start, maxTileWidthSb)) + 1
      widest = Math.max(widest, width)
      start += width
    }
    columnStarts.push(miColumns)
    columnsLog2 = tileLog2(1, columnStarts.length - 1)
    maxTileAreaSb =
      minimumTilesLog2 > 0 ? (sbRows * sbColumns) >> (minimumTilesLog2 + 1) : sbRows * sbColumns
    const maxTileHeightSb = Math.max(Math.floor(maxTileAreaSb / widest), 1)
    start = 0
    while (start < sbRows) {
      rowStarts.push(start << shift)
      start += reader.readNonSymmetric(Math.min(sbRows - start, maxTileHeightSb)) + 1
    }
    rowStarts.push(miRows)
    rowsLog2 = tileLog2(1, rowStarts.length - 1)
  }

  const columns = columnStarts.length - 1
  const rows = rowStarts.length - 1
  let tileSizeBytes = 0
  if (columnsLog2 > 0 || rowsLog2 > 0) {
    reader.readBits(columnsLog2 + rowsLog2)
    tileSizeBytes = reader.readBits(2) + 1
  }
  return {
    columnStarts,
    columns,
    columnsLog2,
    rowStarts,
    rows,
    rowsLog2,
    tileSizeBytes,
  }
}

const parseLoopFilter = (
  reader: Av1BitReader,
  planes: number,
  codedLossless: boolean,
  allowIntrabc: boolean,
): LoopFilterConfiguration => {
  const levels = [0, 0, 0, 0]
  const refDeltas = [1, 0, 0, 0, -1, 0, -1, -1]
  const modeDeltas = [0, 0]
  if (codedLossless || allowIntrabc) {
    return { levels, sharpness: 0, deltaEnabled: false, refDeltas, modeDeltas }
  }
  levels[0] = reader.readBits(6)
  levels[1] = reader.readBits(6)
  if (planes > 1 && (levels[0] !== 0 || levels[1] !== 0)) {
    levels[2] = reader.readBits(6)
    levels[3] = reader.readBits(6)
  }
  const sharpness = reader.readBits(3)
  const deltaEnabled = reader.readBit() === 1
  if (!deltaEnabled || reader.readBit() === 0) {
    return { levels, sharpness, deltaEnabled, refDeltas, modeDeltas }
  }
  for (let index = 0; index < refDeltas.length; index += 1) {
    if (reader.readBit() === 1) refDeltas[index] = reader.readSigned(7)
  }
  for (let index = 0; index < modeDeltas.length; index += 1) {
    if (reader.readBit() === 1) modeDeltas[index] = reader.readSigned(7)
  }
  return { levels, sharpness, deltaEnabled, refDeltas, modeDeltas }
}

const parseCdef = (
  reader: Av1BitReader,
  sequence: Av1SequenceHeader,
  planes: number,
  codedLossless: boolean,
  allowIntrabc: boolean,
): CdefConfiguration => {
  if (codedLossless || allowIntrabc || !sequence.enableCdef) {
    return {
      bits: 0,
      damping: 3,
      yPrimaryStrengths: [0],
      ySecondaryStrengths: [0],
      uvPrimaryStrengths: [0],
      uvSecondaryStrengths: [0],
    }
  }
  const damping = reader.readBits(2) + 3
  const bits = reader.readBits(2)
  const yPrimaryStrengths: number[] = []
  const ySecondaryStrengths: number[] = []
  const uvPrimaryStrengths: number[] = []
  const uvSecondaryStrengths: number[] = []
  for (let index = 0; index < 2 ** bits; index += 1) {
    yPrimaryStrengths.push(reader.readBits(4))
    const ySecondary = reader.readBits(2)
    ySecondaryStrengths.push(ySecondary === 3 ? 4 : ySecondary)
    if (planes > 1) {
      uvPrimaryStrengths.push(reader.readBits(4))
      const uvSecondary = reader.readBits(2)
      uvSecondaryStrengths.push(uvSecondary === 3 ? 4 : uvSecondary)
    }
  }
  return {
    bits,
    damping,
    yPrimaryStrengths,
    ySecondaryStrengths,
    uvPrimaryStrengths,
    uvSecondaryStrengths,
  }
}

interface RestorationConfiguration {
  readonly types: readonly number[]
  readonly unitSizes: readonly number[]
}

interface LoopFilterConfiguration {
  readonly deltaEnabled: boolean
  readonly levels: readonly number[]
  readonly modeDeltas: readonly number[]
  readonly refDeltas: readonly number[]
  readonly sharpness: number
}

interface CdefConfiguration {
  readonly bits: number
  readonly damping: number
  readonly uvPrimaryStrengths: readonly number[]
  readonly uvSecondaryStrengths: readonly number[]
  readonly yPrimaryStrengths: readonly number[]
  readonly ySecondaryStrengths: readonly number[]
}

const parseRestoration = (
  reader: Av1BitReader,
  sequence: Av1SequenceHeader,
  planes: number,
  allLossless: boolean,
  allowIntrabc: boolean,
): RestorationConfiguration => {
  if (allLossless || allowIntrabc || !sequence.enableRestoration) {
    return {
      types: Array.from({ length: planes }, () => 0),
      unitSizes: Array.from({ length: planes }, () => 256),
    }
  }
  const remappedTypes = [0, 3, 1, 2] as const
  const types = Array.from({ length: planes }, () => remappedTypes[reader.readBits(2)] ?? 0)
  const usesRestoration = types.some((type) => type !== 0)
  const usesChromaRestoration = types.slice(1).some((type) => type !== 0)
  let lumaUnitSize = 64
  let chromaUnitSize = 64
  if (usesRestoration) {
    let shift = reader.readBit()
    if (sequence.use128x128Superblock) shift += 1
    else if (shift === 1) shift += reader.readBit()
    lumaUnitSize = 256 >> (2 - shift)
    chromaUnitSize = lumaUnitSize
    if (sequence.chromaSubsampling === '420' && usesChromaRestoration) {
      chromaUnitSize >>= reader.readBit()
    }
  }
  return {
    types,
    unitSizes: Array.from({ length: planes }, (_value, plane) =>
      plane === 0 ? lumaUnitSize : chromaUnitSize,
    ),
  }
}

const littleEndian = (data: Uint8Array, offset: number, bytes: number): number => {
  let value = 0
  for (let index = 0; index < bytes; index += 1) {
    const byte = data[offset + index]
    if (byte === undefined) throw invalidInput('AV1 tile size is truncated')
    value += byte * 2 ** (index * 8)
  }
  return value
}

export const parseAv1Frame = (sequence: Av1SequenceHeader, data: Uint8Array): Av1Frame => {
  if (!sequence.reducedStillPictureHeader || !sequence.stillPicture) {
    throw unsupportedOperation('Phase B2 supports reduced still-picture AV1 frames only')
  }
  if (sequence.filmGrainParamsPresent) {
    throw unsupportedOperation('Phase B2 does not support AV1 film grain')
  }
  const reader = new Av1BitReader(data)
  const disableCdfUpdate = reader.readBit() === 1
  const allowScreenContentTools =
    sequence.forceScreenContentTools === 2
      ? reader.readBit() === 1
      : sequence.forceScreenContentTools === 1
  if (allowScreenContentTools && sequence.forceIntegerMv === 2) reader.readBit()

  let frameWidth = sequence.maxFrameWidth
  const frameHeight = sequence.maxFrameHeight
  const upscaledWidth = frameWidth
  if (sequence.enableSuperres && reader.readBit() === 1) {
    const denominator = reader.readBits(3) + 9
    frameWidth = Math.floor((upscaledWidth * 8 + denominator / 2) / denominator)
  }
  const miColumns = 2 * ((frameWidth + 7) >> 3)
  const miRows = 2 * ((frameHeight + 7) >> 3)
  const differentRenderSize = reader.readBit() === 1
  const renderWidth = differentRenderSize ? reader.readBits(16) + 1 : upscaledWidth
  const renderHeight = differentRenderSize ? reader.readBits(16) + 1 : frameHeight
  const allowIntrabc =
    allowScreenContentTools && upscaledWidth === frameWidth ? reader.readBit() === 1 : false
  const layout = parseTileLayout(reader, sequence, miColumns, miRows)
  const quantization = parseQuantization(reader, sequence)
  const segmentation = parseSegmentation(reader)
  let deltaQPresent = false
  let deltaQResolution = 0
  let deltaLfPresent = false
  if (quantization.base > 0) {
    deltaQPresent = reader.readBit() === 1
    if (deltaQPresent) {
      deltaQResolution = reader.readBits(2)
      if (!allowIntrabc) deltaLfPresent = reader.readBit() === 1
      if (deltaLfPresent) {
        reader.readBits(2)
        reader.readBit()
      }
    }
  }

  let codedLossless = true
  for (let segment = 0; segment < MAX_SEGMENTS; segment += 1) {
    const segmentDelta =
      segmentation.featureEnabled[segment]?.[0] === true
        ? (segmentation.featureData[segment]?.[0] ?? 0)
        : 0
    const quantizer = Math.max(0, Math.min(255, quantization.base + segmentDelta))
    if (
      quantizer !== 0 ||
      quantization.yDc !== 0 ||
      quantization.uDc !== 0 ||
      quantization.uAc !== 0 ||
      quantization.vDc !== 0 ||
      quantization.vAc !== 0
    ) {
      codedLossless = false
    }
  }
  const allLossless = codedLossless && frameWidth === upscaledWidth
  const planes = sequence.monochrome ? 1 : 3
  const loopFilter = parseLoopFilter(reader, planes, codedLossless, allowIntrabc)
  const cdef = parseCdef(reader, sequence, planes, codedLossless, allowIntrabc)
  const restoration = parseRestoration(reader, sequence, planes, allLossless, allowIntrabc)
  const transformMode = codedLossless ? '4x4' : reader.readBit() === 1 ? 'select' : 'largest'
  const reducedTransformSet = reader.readBit() === 1
  reader.alignToByte()
  const headerBytes = reader.bytePosition

  const tileReader = new Av1BitReader(data.subarray(headerBytes))
  const tileCount = layout.columns * layout.rows
  const hasRange = tileCount > 1 && tileReader.readBit() === 1
  const tileBits = layout.columnsLog2 + layout.rowsLog2
  const tileStart = hasRange ? tileReader.readBits(tileBits) : 0
  const tileEnd = hasRange ? tileReader.readBits(tileBits) : tileCount - 1
  if (tileStart !== 0 || tileEnd !== tileCount - 1) {
    throw unsupportedOperation('Phase B2 requires every AV1 tile in one frame OBU')
  }
  tileReader.alignToByte()
  let offset = headerBytes + tileReader.bytePosition
  const tiles: Av1Tile[] = []
  for (let tile = tileStart; tile <= tileEnd; tile += 1) {
    let length = data.byteLength - offset
    if (tile !== tileEnd) {
      length = littleEndian(data, offset, layout.tileSizeBytes) + 1
      offset += layout.tileSizeBytes
    }
    const end = offset + length
    if (length < 1 || end > data.byteLength) throw invalidInput('AV1 tile payload is truncated')
    const row = Math.floor(tile / layout.columns)
    const column = tile % layout.columns
    const miRowStart = layout.rowStarts[row]
    const miRowEnd = layout.rowStarts[row + 1]
    const miColumnStart = layout.columnStarts[column]
    const miColumnEnd = layout.columnStarts[column + 1]
    if (
      miRowStart === undefined ||
      miRowEnd === undefined ||
      miColumnStart === undefined ||
      miColumnEnd === undefined
    ) {
      throw invalidInput('AV1 tile boundaries are invalid')
    }
    tiles.push({
      row,
      column,
      miRowStart,
      miRowEnd,
      miColumnStart,
      miColumnEnd,
      data: data.subarray(offset, end),
    })
    offset = end
  }
  if (offset !== data.byteLength) throw invalidInput('AV1 frame has trailing tile data')

  return {
    header: {
      frameWidth,
      frameHeight,
      upscaledWidth,
      usingQMatrix: quantization.usingQMatrix,
      qmY: quantization.qmY,
      qmU: quantization.qmU,
      qmV: quantization.qmV,
      renderWidth,
      renderHeight,
      headerBytes,
      disableCdfUpdate,
      allowScreenContentTools,
      allowIntrabc,
      baseQuantizer: quantization.base,
      deltaYDc: quantization.yDc,
      deltaUDc: quantization.uDc,
      deltaUAc: quantization.uAc,
      deltaVDc: quantization.vDc,
      deltaVAc: quantization.vAc,
      segmentationEnabled: segmentation.enabled,
      deltaQPresent,
      deltaQResolution,
      deltaLfPresent,
      codedLossless,
      allLossless,
      cdefBits: cdef.bits,
      cdefDamping: cdef.damping,
      cdefYPrimaryStrengths: cdef.yPrimaryStrengths,
      cdefYSecondaryStrengths: cdef.ySecondaryStrengths,
      cdefUvPrimaryStrengths: cdef.uvPrimaryStrengths,
      cdefUvSecondaryStrengths: cdef.uvSecondaryStrengths,
      loopFilterLevels: loopFilter.levels,
      loopFilterSharpness: loopFilter.sharpness,
      loopFilterDeltaEnabled: loopFilter.deltaEnabled,
      loopFilterRefDeltas: loopFilter.refDeltas,
      loopFilterModeDeltas: loopFilter.modeDeltas,
      restorationTypes: restoration.types,
      restorationUnitSizes: restoration.unitSizes,
      transformMode,
      reducedTransformSet,
      tileColumns: layout.columns,
      tileRows: layout.rows,
      tileSizeBytes: layout.tileSizeBytes,
    },
    tiles,
  }
}
