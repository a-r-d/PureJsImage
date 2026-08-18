import { invalidInput } from '../errors.ts'
import type { Av1FrameHeader } from './av1-frame.ts'

export interface Av1FilterPlane {
  readonly data: Uint8Array | Uint16Array
  readonly height: number
  readonly rowOffsets?: Int32Array
  readonly storageHeight?: number
  readonly stride: number
  readonly width: number
  readonly yOrigin?: number
}

export interface Av1RestorationPlaneState {
  readonly columns: number
  readonly rows: number
  readonly sgrSets: Uint8Array
  readonly sgrXqd: Int16Array
  readonly types: Uint8Array
  readonly unitSize: number
  readonly wiener: Int8Array
}

export interface Av1PostFilterState {
  readonly bitDepth: 8 | 10 | 12
  readonly cdefColumns: number
  readonly contextMiColumns: number
  readonly contextMiRows: number
  readonly chromaShiftX: number
  readonly chromaShiftY: number
  readonly cdefIndices: Uint16Array
  readonly miColumns: number
  readonly miColumnStart: number
  readonly miRows: number
  readonly miRowStart: number
  readonly restoration: readonly [
    Av1RestorationPlaneState,
    Av1RestorationPlaneState,
    Av1RestorationPlaneState,
  ]
  readonly skips: Uint8Array
  readonly segmentIds: Uint8Array
  readonly transformHeights: readonly [Uint8Array, Uint8Array, Uint8Array]
  readonly transformWidths: readonly [Uint8Array, Uint8Array, Uint8Array]
}

const cdefDirections = Int8Array.from([
  -1, 1, -2, 2, 0, 1, -1, 2, 0, 1, 0, 2, 0, 1, 1, 2, 1, 1, 2, 2, 1, 0, 2, 1, 1, 0, 2, 0, 1, 0, 2,
  -1,
])
const cdefUvDirections422 = Uint8Array.from([7, 0, 2, 4, 5, 6, 6, 6])
const cdefPrimaryTaps = Uint8Array.from([4, 2, 3, 3])
const cdefSecondaryTaps = Uint8Array.from([2, 1, 2, 1])
const cdefDivisionTable = Uint16Array.from([0, 840, 420, 280, 210, 168, 140, 120, 105])
const sgrParameters = Uint8Array.from([
  2, 12, 1, 4, 2, 15, 1, 6, 2, 18, 1, 8, 2, 21, 1, 9, 2, 24, 1, 10, 2, 29, 1, 11, 2, 36, 1, 12, 2,
  45, 1, 13, 2, 56, 1, 14, 2, 68, 1, 15, 0, 0, 1, 5, 0, 0, 1, 8, 0, 0, 1, 11, 0, 0, 1, 14, 2, 30, 0,
  0, 2, 75, 0, 0,
])

const clip = (minimum: number, maximum: number, value: number): number =>
  Math.max(minimum, Math.min(maximum, value))

const round2 = (value: number, bits: number): number =>
  bits === 0 ? value : Math.floor((value + 2 ** (bits - 1)) / 2 ** bits)

const floorLog2 = (value: number): number => Math.floor(Math.log2(value))

const planeSample = (plane: Av1FilterPlane, x: number, y: number): number => {
  if (x < 0 || x >= plane.width || y < 0 || y >= plane.height) return 0
  const mappedRow = plane.rowOffsets?.[y]
  if (plane.rowOffsets) {
    return mappedRow === undefined || mappedRow < 0
      ? 0
      : (plane.data[mappedRow * plane.stride + x] ?? 0)
  }
  const localY = y - (plane.yOrigin ?? 0)
  const storageHeight = plane.storageHeight ?? plane.height
  return localY < 0 || localY >= storageHeight ? 0 : (plane.data[localY * plane.stride + x] ?? 0)
}

const sampleBuffer = (
  source: Uint8Array | Uint16Array,
  length: number,
): Uint8Array | Uint16Array =>
  source instanceof Uint8Array ? new Uint8Array(length) : new Uint16Array(length)

const planeContextWidth = (state: Av1PostFilterState, plane: number): number => {
  const shiftX = plane === 0 ? 0 : state.chromaShiftX
  return (state.contextMiColumns + (1 << shiftX) - 1) >> shiftX
}

const transformAt = (
  transforms: readonly [Uint8Array, Uint8Array, Uint8Array],
  state: Av1PostFilterState,
  plane: number,
  row: number,
  column: number,
): number => {
  const shiftX = plane === 0 ? 0 : state.chromaShiftX
  const shiftY = plane === 0 ? 0 : state.chromaShiftY
  const contextColumn = (column - state.miColumnStart) >> shiftX
  const contextRow = (row - state.miRowStart) >> shiftY
  if (
    contextColumn < 0 ||
    contextColumn >= planeContextWidth(state, plane) ||
    contextRow < 0 ||
    contextRow >= state.contextMiRows >> shiftY
  ) {
    return 0
  }
  return transforms[plane]?.[contextRow * planeContextWidth(state, plane) + contextColumn] ?? 0
}
const segmentAt = (state: Av1PostFilterState, row: number, column: number): number => {
  if (state.segmentIds.length === 0) return 0
  const contextRow = row - state.miRowStart
  const contextColumn = column - state.miColumnStart
  if (
    contextRow < 0 ||
    contextRow >= state.contextMiRows ||
    contextColumn < 0 ||
    contextColumn >= state.contextMiColumns
  ) {
    return 0
  }
  return state.segmentIds[contextRow * state.contextMiColumns + contextColumn] ?? 0
}

const segmentLoopFilterLevels = (
  header: Av1FrameHeader,
): readonly [Uint8Array, Uint8Array, Uint8Array, Uint8Array] => {
  const levels: [Uint8Array, Uint8Array, Uint8Array, Uint8Array] = [
    new Uint8Array(8),
    new Uint8Array(8),
    new Uint8Array(8),
    new Uint8Array(8),
  ]
  for (let levelIndex = 0; levelIndex < levels.length; levelIndex += 1) {
    const baseLevel = header.loopFilterLevels[levelIndex] ?? 0
    const segmentLevels = levels[levelIndex]
    if (!segmentLevels) continue
    for (let segment = 0; segment < segmentLevels.length; segment += 1) {
      const segmentDelta =
        header.segmentation.featureEnabled[segment]?.[levelIndex + 1] === true
          ? (header.segmentation.featureData[segment]?.[levelIndex + 1] ?? 0)
          : 0
      let level = clip(0, 63, baseLevel + segmentDelta)
      if (header.loopFilterDeltaEnabled) {
        level = clip(0, 63, level + ((header.loopFilterRefDeltas[0] ?? 0) << (level >> 5)))
      }
      segmentLevels[segment] = level
    }
  }
  return levels
}

const skipAt = (state: Av1PostFilterState, row: number, column: number): number => {
  const contextRow = row - state.miRowStart
  const contextColumn = column - state.miColumnStart
  if (
    contextRow < 0 ||
    contextRow >= state.contextMiRows ||
    contextColumn < 0 ||
    contextColumn >= state.contextMiColumns
  ) {
    return 0
  }
  return state.skips[contextRow * state.contextMiColumns + contextColumn] ?? 0
}

const filter4Clamp = (value: number, depthShift: number): number =>
  clip(-128 << depthShift, (128 << depthShift) - 1, value)

const narrowFilter = (
  plane: Av1FilterPlane,
  x: number,
  y: number,
  dx: number,
  dy: number,
  highEdgeVariance: boolean,
  depthShift: number,
): void => {
  const q0Index = y * plane.stride + x
  const q1Index = (y + dy) * plane.stride + x + dx
  const p0Index = (y - dy) * plane.stride + x - dx
  const p1Index = (y - 2 * dy) * plane.stride + x - 2 * dx
  const q0 = plane.data[q0Index] ?? 0
  const q1 = plane.data[q1Index] ?? 0
  const p0 = plane.data[p0Index] ?? 0
  const p1 = plane.data[p1Index] ?? 0
  const sampleMaximum = (256 << depthShift) - 1
  let filter = highEdgeVariance ? filter4Clamp(p1 - q1, depthShift) : 0
  filter = filter4Clamp(filter + 3 * (q0 - p0), depthShift)
  const filter1 = Math.min(filter + 4, (128 << depthShift) - 1) >> 3
  const filter2 = Math.min(filter + 3, (128 << depthShift) - 1) >> 3
  plane.data[q0Index] = clip(0, sampleMaximum, q0 - filter1)
  plane.data[p0Index] = clip(0, sampleMaximum, p0 + filter2)
  if (!highEdgeVariance) {
    const outerFilter = (filter1 + 1) >> 1
    plane.data[q1Index] = clip(0, sampleMaximum, q1 - outerFilter)
    plane.data[p1Index] = clip(0, sampleMaximum, p1 + outerFilter)
  }
}

const wideFilter = (
  plane: Av1FilterPlane,
  x: number,
  y: number,
  dx: number,
  dy: number,
  log2Size: 3 | 4,
  isLuma: boolean,
  scratch: Int16Array,
): void => {
  const n = log2Size === 4 ? 6 : isLuma ? 3 : 2
  const n2 = log2Size === 3 && isLuma ? 0 : 1
  for (let i = -n; i < n; i += 1) {
    let total = 0
    for (let j = -n; j <= n; j += 1) {
      const position = clip(-(n + 1), n, i + j)
      const tap = Math.abs(j) <= n2 ? 2 : 1
      total += (plane.data[(y + position * dy) * plane.stride + x + position * dx] ?? 0) * tap
    }
    scratch[i + n] = round2(total, log2Size)
  }
  for (let i = -n; i < n; i += 1) {
    plane.data[(y + i * dy) * plane.stride + x + i * dx] = scratch[i + n] ?? 0
  }
}

const filterSample = (
  plane: Av1FilterPlane,
  x: number,
  y: number,
  dx: number,
  dy: number,
  filterSize: number,
  limit: number,
  blockLimit: number,
  threshold: number,
  isLuma: boolean,
  wideScratch: Int16Array,
  depthShift: number,
): void => {
  const sample = (offset: number): number =>
    plane.data[(y + offset * dy) * plane.stride + x + offset * dx] ?? 0
  const q0 = sample(0)
  const q1 = sample(1)
  const p0 = sample(-1)
  const p1 = sample(-2)
  const highEdgeVariance = Math.abs(p1 - p0) > threshold || Math.abs(q1 - q0) > threshold
  const filterLength = filterSize === 4 ? 4 : !isLuma ? 6 : filterSize === 8 ? 8 : 16
  let masked =
    Math.abs(p1 - p0) > limit ||
    Math.abs(q1 - q0) > limit ||
    2 * Math.abs(p0 - q0) + Math.floor(Math.abs(p1 - q1) / 2) > blockLimit
  if (filterLength >= 6) {
    masked ||= Math.abs(sample(-3) - p1) > limit || Math.abs(sample(2) - q1) > limit
  }
  if (filterLength >= 8) {
    masked ||= Math.abs(sample(-4) - sample(-3)) > limit || Math.abs(sample(3) - sample(2)) > limit
  }
  if (masked) return
  const flatThreshold = 1 << depthShift
  let flat = false
  if (filterLength >= 6) {
    flat =
      Math.abs(p1 - p0) <= flatThreshold &&
      Math.abs(q1 - q0) <= flatThreshold &&
      Math.abs(sample(-3) - p0) <= flatThreshold &&
      Math.abs(sample(2) - q0) <= flatThreshold &&
      (filterLength < 8 ||
        (Math.abs(sample(-4) - p0) <= flatThreshold && Math.abs(sample(3) - q0) <= flatThreshold))
  }
  if (filterSize === 4 || !flat) {
    narrowFilter(plane, x, y, dx, dy, highEdgeVariance, depthShift)
    return
  }
  const flat2 =
    filterLength >= 16 &&
    Math.abs(sample(-7) - p0) <= flatThreshold &&
    Math.abs(sample(6) - q0) <= flatThreshold &&
    Math.abs(sample(-6) - p0) <= flatThreshold &&
    Math.abs(sample(5) - q0) <= flatThreshold &&
    Math.abs(sample(-5) - p0) <= flatThreshold &&
    Math.abs(sample(4) - q0) <= flatThreshold
  wideFilter(plane, x, y, dx, dy, flat2 ? 4 : 3, isLuma, wideScratch)
}

export const applyAv1LoopFilter = (
  planes: readonly [Av1FilterPlane, Av1FilterPlane, Av1FilterPlane],
  header: Av1FrameHeader,
  state: Av1PostFilterState,
): void => {
  const depthShift = state.bitDepth - 8
  const wideScratch = new Int16Array(12)
  const filterLevels = segmentLoopFilterLevels(header)
  for (let planeIndex = 0; planeIndex < 3; planeIndex += 1) {
    if (planeIndex > 0 && (header.loopFilterLevels[planeIndex + 1] ?? 0) === 0) continue
    const plane = planes[planeIndex]
    if (!plane) continue
    const shiftX = planeIndex === 0 ? 0 : state.chromaShiftX
    const shiftY = planeIndex === 0 ? 0 : state.chromaShiftY
    const stepX = 1 << shiftX
    const stepY = 1 << shiftY
    for (let pass = 0; pass < 2; pass += 1) {
      const dx = pass === 0 ? 1 : 0
      const dy = pass === 0 ? 0 : 1
      for (let inputRow = 0; inputRow < state.miRows; inputRow += stepY) {
        for (let inputColumn = 0; inputColumn < state.miColumns; inputColumn += stepX) {
          const lumaX = inputColumn * 4
          const lumaY = inputRow * 4
          if (
            lumaX >= header.frameWidth ||
            lumaY >= header.frameHeight ||
            (pass === 0 ? lumaX === 0 : lumaY === 0)
          ) {
            continue
          }
          const row = inputRow | shiftY
          const column = inputColumn | shiftX
          const previousRow = row - (dy << shiftY)
          const previousColumn = column - (dx << shiftX)
          const x = lumaX >> shiftX
          const y = lumaY >> shiftY
          const transformWidth = transformAt(state.transformWidths, state, planeIndex, row, column)
          const transformHeight = transformAt(
            state.transformHeights,
            state,
            planeIndex,
            row,
            column,
          )
          const previousTransformWidth = transformAt(
            state.transformWidths,
            state,
            planeIndex,
            previousRow,
            previousColumn,
          )
          const previousTransformHeight = transformAt(
            state.transformHeights,
            state,
            planeIndex,
            previousRow,
            previousColumn,
          )
          if (transformWidth === 0 || transformHeight === 0) continue
          const transformEdge = pass === 0 ? x % transformWidth === 0 : y % transformHeight === 0
          if (!transformEdge) continue
          const levelIndex = planeIndex === 0 ? pass : planeIndex + 1
          const level = filterLevels[levelIndex]?.[segmentAt(state, row, column)] ?? 0
          if (level === 0) continue
          const sharpnessShift =
            header.loopFilterSharpness > 4 ? 2 : header.loopFilterSharpness > 0 ? 1 : 0
          const limit =
            header.loopFilterSharpness > 0
              ? clip(1, 9 - header.loopFilterSharpness, level >> sharpnessShift)
              : Math.max(1, level >> sharpnessShift)
          const blockLimit = 2 * (level + 2) + limit
          const threshold = level >> 4
          const baseFilterSize =
            pass === 0
              ? Math.min(previousTransformWidth, transformWidth)
              : Math.min(previousTransformHeight, transformHeight)
          const filterSize = Math.min(planeIndex === 0 ? 16 : 8, baseFilterSize)
          for (let index = 0; index < 4; index += 1) {
            filterSample(
              plane,
              x + dy * index,
              y + dx * index,
              dx,
              dy,
              filterSize,
              limit << depthShift,
              blockLimit << depthShift,
              threshold << depthShift,
              planeIndex === 0,
              wideScratch,
              depthShift,
            )
          }
        }
      }
    }
  }
}

const cdefDirection = (
  plane: Av1FilterPlane,
  x: number,
  y: number,
  partial: Int32Array,
  costs: Float64Array,
  depthShift: number,
): readonly [number, number] => {
  partial.fill(0)
  costs.fill(0)
  const sourceY = y - (plane.yOrigin ?? 0)
  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      const value =
        ((plane.data[(sourceY + row) * plane.stride + x + column] ?? 0) >> depthShift) - 128
      partial[row + column] = (partial[row + column] ?? 0) + value
      partial[15 + row + (column >> 1)] = (partial[15 + row + (column >> 1)] ?? 0) + value
      partial[30 + row] = (partial[30 + row] ?? 0) + value
      partial[45 + 3 + row - (column >> 1)] = (partial[45 + 3 + row - (column >> 1)] ?? 0) + value
      partial[60 + 7 + row - column] = (partial[60 + 7 + row - column] ?? 0) + value
      partial[75 + 3 - (row >> 1) + column] = (partial[75 + 3 - (row >> 1) + column] ?? 0) + value
      partial[90 + column] = (partial[90 + column] ?? 0) + value
      partial[105 + (row >> 1) + column] = (partial[105 + (row >> 1) + column] ?? 0) + value
    }
  }
  for (let index = 0; index < 8; index += 1) {
    const horizontal = partial[30 + index] ?? 0
    const vertical = partial[90 + index] ?? 0
    costs[2] = (costs[2] ?? 0) + horizontal * horizontal
    costs[6] = (costs[6] ?? 0) + vertical * vertical
  }
  costs[2] = (costs[2] ?? 0) * (cdefDivisionTable[8] ?? 0)
  costs[6] = (costs[6] ?? 0) * (cdefDivisionTable[8] ?? 0)
  for (let index = 0; index < 7; index += 1) {
    const divisor = cdefDivisionTable[index + 1] ?? 0
    for (const direction of [0, 4] as const) {
      const offset = direction * 15
      const first = partial[offset + index] ?? 0
      const second = partial[offset + 14 - index] ?? 0
      costs[direction] = (costs[direction] ?? 0) + (first * first + second * second) * divisor
    }
  }
  for (const direction of [0, 4] as const) {
    const center = partial[direction * 15 + 7] ?? 0
    costs[direction] = (costs[direction] ?? 0) + center * center * (cdefDivisionTable[8] ?? 0)
  }
  for (let direction = 1; direction < 8; direction += 2) {
    const offset = direction * 15
    for (let index = 0; index <= 4; index += 1) {
      const value = partial[offset + 3 + index] ?? 0
      costs[direction] = (costs[direction] ?? 0) + value * value
    }
    costs[direction] = (costs[direction] ?? 0) * (cdefDivisionTable[8] ?? 0)
    for (let index = 0; index < 3; index += 1) {
      const first = partial[offset + index] ?? 0
      const second = partial[offset + 10 - index] ?? 0
      costs[direction] =
        (costs[direction] ?? 0) +
        (first * first + second * second) * (cdefDivisionTable[2 * index + 2] ?? 0)
    }
  }
  let bestCost = 0
  let direction = 0
  for (let index = 0; index < 8; index += 1) {
    if ((costs[index] ?? 0) > bestCost) {
      bestCost = costs[index] ?? 0
      direction = index
    }
  }
  return [direction, Math.floor((bestCost - (costs[(direction + 4) & 7] ?? 0)) / 1024)]
}

const constrainCdef = (difference: number, threshold: number, damping: number): number => {
  if (threshold === 0) return 0
  const dampingAdjustment = Math.max(0, damping - floorLog2(threshold))
  const magnitude = Math.abs(difference)
  const constrained = clip(0, magnitude, threshold - (magnitude >> dampingAdjustment))
  return difference < 0 ? -constrained : constrained
}

const filterCdefBlock = (
  source: Av1FilterPlane,
  target: Av1FilterPlane,
  planeIndex: number,
  state: Av1PostFilterState,
  row: number,
  column: number,
  primaryStrength: number,
  secondaryStrength: number,
  damping: number,
  direction: number,
): void => {
  const shiftX = planeIndex === 0 ? 0 : state.chromaShiftX
  const shiftY = planeIndex === 0 ? 0 : state.chromaShiftY
  const x0 = (column * 4) >> shiftX
  const y0 = (row * 4) >> shiftY
  const width = 8 >> shiftX
  const height = 8 >> shiftY
  const tapSet = (primaryStrength >> (state.bitDepth - 8)) & 1
  const sourceOriginY = source.yOrigin ?? 0
  const targetOriginY = target.yOrigin ?? 0
  for (let localY = 0; localY < height; localY += 1) {
    for (let localX = 0; localX < width; localX += 1) {
      const sampleX0 = x0 + localX
      const sampleY0 = y0 + localY
      const center = source.data[(sampleY0 - sourceOriginY) * source.stride + sampleX0] ?? 0
      let minimum = center
      let maximum = center
      let sum = 0
      for (let tap = 0; tap < 2; tap += 1) {
        for (let sign = -1; sign <= 1; sign += 2) {
          for (
            let directionOffsetIndex = -1;
            directionOffsetIndex <= 1;
            directionOffsetIndex += 1
          ) {
            const sampleDirection =
              directionOffsetIndex === 0
                ? direction
                : (direction + directionOffsetIndex * 2 + 8) & 7
            const directionOffset = sampleDirection * 4 + tap * 2
            const sampleY = y0 + localY + sign * (cdefDirections[directionOffset] ?? 0)
            const sampleX = x0 + localX + sign * (cdefDirections[directionOffset + 1] ?? 0)
            const candidateRow = (sampleY << shiftY) >> 2
            const candidateColumn = (sampleX << shiftX) >> 2
            if (
              candidateRow < 0 ||
              candidateRow >= state.miRows ||
              candidateColumn < 0 ||
              candidateColumn >= state.miColumns
            ) {
              continue
            }
            const sample = source.data[(sampleY - sourceOriginY) * source.stride + sampleX] ?? 0
            const primary = directionOffsetIndex === 0
            const strength = primary ? primaryStrength : secondaryStrength
            const taps = primary ? cdefPrimaryTaps : cdefSecondaryTaps
            sum += (taps[tapSet * 2 + tap] ?? 0) * constrainCdef(sample - center, strength, damping)
            minimum = Math.min(minimum, sample)
            maximum = Math.max(maximum, sample)
          }
        }
      }
      target.data[(sampleY0 - targetOriginY) * target.stride + sampleX0] = clip(
        minimum,
        maximum,
        center + ((8 + sum - Number(sum < 0)) >> 4),
      )
    }
  }
}

export const applyAv1Cdef = (
  planes: readonly [Av1FilterPlane, Av1FilterPlane, Av1FilterPlane],
  header: Av1FrameHeader,
  state: Av1PostFilterState,
): [Av1FilterPlane, Av1FilterPlane, Av1FilterPlane] => {
  interface MutableBand extends Av1FilterPlane {
    storageHeight: number
    yOrigin: number
  }
  const createBand = (plane: Av1FilterPlane, rows: number): MutableBand => ({
    data: sampleBuffer(plane.data, plane.stride * rows),
    height: plane.height,
    storageHeight: 0,
    stride: plane.stride,
    width: plane.width,
    yOrigin: 0,
  })
  const createBands = (haloRows: number): [MutableBand, MutableBand, MutableBand] => [
    createBand(planes[0], Math.min(planes[0].height, 8 + haloRows)),
    createBand(planes[1], Math.min(planes[1].height, (8 >> state.chromaShiftY) + haloRows)),
    createBand(planes[2], Math.min(planes[2].height, (8 >> state.chromaShiftY) + haloRows)),
  ]
  const sourceWindows = createBands(4)
  let pending = createBands(0)
  let current = createBands(0)
  let hasPending = false
  const copyRows = (
    target: MutableBand,
    source: Av1FilterPlane,
    startY: number,
    rows: number,
  ): void => {
    const length = rows * source.stride
    target.data.fill(0)
    target.data.set(source.data.subarray(startY * source.stride, startY * source.stride + length))
    target.yOrigin = startY
    target.storageHeight = rows
  }
  const copyBandFromWindow = (
    target: MutableBand,
    source: MutableBand,
    startY: number,
    rows: number,
  ): void => {
    const sourceOffset = (startY - source.yOrigin) * source.stride
    const length = rows * source.stride
    target.data.fill(0)
    target.data.set(source.data.subarray(sourceOffset, sourceOffset + length))
    target.yOrigin = startY
    target.storageHeight = rows
  }
  const commitBands = (bands: readonly [MutableBand, MutableBand, MutableBand]): void => {
    for (let planeIndex = 0; planeIndex < 3; planeIndex += 1) {
      const plane = planes[planeIndex]
      const band = bands[planeIndex]
      if (!plane || !band || band.storageHeight === 0) continue
      const length = band.storageHeight * plane.stride
      plane.data.set(band.data.subarray(0, length), band.yOrigin * plane.stride)
    }
  }
  const partial = new Int32Array(120)
  const costs = new Float64Array(8)
  const depthShift = state.bitDepth - 8
  for (let lumaY = 0; lumaY < header.frameHeight; lumaY += 8) {
    for (let planeIndex = 0; planeIndex < 3; planeIndex += 1) {
      const plane = planes[planeIndex]
      const window = sourceWindows[planeIndex]
      if (!plane || !window) continue
      const shiftY = planeIndex === 0 ? 0 : state.chromaShiftY
      const bandStart = lumaY >> shiftY
      const bandEnd = Math.min(plane.height, (lumaY + 8) >> shiftY)
      const sourceStart = Math.max(0, bandStart - 2)
      const sourceEnd = Math.min(plane.height, bandEnd + 2)
      copyRows(window, plane, sourceStart, sourceEnd - sourceStart)
    }
    if (hasPending) commitBands(pending)
    for (let planeIndex = 0; planeIndex < 3; planeIndex += 1) {
      const plane = planes[planeIndex]
      const window = sourceWindows[planeIndex]
      const band = current[planeIndex]
      if (!plane || !window || !band) continue
      const shiftY = planeIndex === 0 ? 0 : state.chromaShiftY
      const startY = lumaY >> shiftY
      const rows = Math.min(plane.height - startY, 8 >> shiftY)
      copyBandFromWindow(band, window, startY, rows)
    }
    const row = lumaY >> 2
    for (let column = 0; column < state.miColumns; column += 2) {
      const baseRow = row & ~15
      const baseColumn = column & ~15
      const storedIndex =
        state.cdefIndices[(baseRow >> 4) * state.cdefColumns + (baseColumn >> 4)] ?? 0
      if (storedIndex === 0) continue
      const index = storedIndex - 1
      const skip =
        skipAt(state, row, column) === 1 &&
        skipAt(state, row, column + 1) === 1 &&
        skipAt(state, row + 1, column) === 1 &&
        skipAt(state, row + 1, column + 1) === 1
      if (skip) continue
      const [lumaDirection, variance] = cdefDirection(
        sourceWindows[0],
        column * 4,
        row * 4,
        partial,
        costs,
        depthShift,
      )
      const lumaPrimaryBase = header.cdefYPrimaryStrengths[index] ?? 0
      const lumaSecondary = (header.cdefYSecondaryStrengths[index] ?? 0) << depthShift
      const scaledVariance = Math.floor(variance / 64)
      const varianceStrength = scaledVariance > 0 ? Math.min(floorLog2(scaledVariance), 12) : 0
      const lumaPrimary =
        variance > 0 ? ((lumaPrimaryBase << depthShift) * (4 + varianceStrength) + 8) >> 4 : 0
      filterCdefBlock(
        sourceWindows[0],
        current[0],
        0,
        state,
        row,
        column,
        lumaPrimary,
        lumaSecondary,
        header.cdefDamping + depthShift,
        lumaPrimaryBase === 0 ? 0 : lumaDirection,
      )
      const chromaPrimary = (header.cdefUvPrimaryStrengths[index] ?? 0) << depthShift
      const chromaSecondary = (header.cdefUvSecondaryStrengths[index] ?? 0) << depthShift
      const chromaDirection =
        chromaPrimary === 0
          ? 0
          : state.chromaShiftX === 1 && state.chromaShiftY === 0
            ? (cdefUvDirections422[lumaDirection] ?? lumaDirection)
            : lumaDirection
      for (let planeIndex = 1; planeIndex < 3; planeIndex += 1) {
        const sourcePlane = sourceWindows[planeIndex]
        const outputPlane = current[planeIndex]
        if (!sourcePlane || !outputPlane || sourcePlane.width === 0 || sourcePlane.height === 0) {
          continue
        }
        filterCdefBlock(
          sourcePlane,
          outputPlane,
          planeIndex,
          state,
          row,
          column,
          chromaPrimary,
          chromaSecondary,
          header.cdefDamping + depthShift - 1,
          chromaDirection,
        )
      }
    }
    const reusable = pending
    pending = current
    current = reusable
    hasPending = true
  }
  if (hasPending) commitBands(pending)
  return [planes[0], planes[1], planes[2]]
}

const snapshotRestorationBoundaries = (
  planes: readonly [Av1FilterPlane, Av1FilterPlane, Av1FilterPlane],
  header: Av1FrameHeader,
  state: Av1PostFilterState,
): [Av1FilterPlane, Av1FilterPlane, Av1FilterPlane] => {
  const snapshotPlane = (plane: Av1FilterPlane, shiftY: number): Av1FilterPlane => {
    const rowOffsets = new Int32Array(plane.height)
    rowOffsets.fill(-1)
    let rows = 0
    const stripeHeight = 64 >> shiftY
    const stripeCount = Math.ceil((header.frameHeight + 8) / 64)
    for (let stripe = 0; stripe < stripeCount; stripe += 1) {
      const stripeStart = (-8 + stripe * 64) >> shiftY
      const stripeEnd = stripeStart + stripeHeight - 1
      for (let boundary = 0; boundary < 4; boundary += 1) {
        const row =
          boundary === 0
            ? stripeStart - 2
            : boundary === 1
              ? stripeStart - 1
              : boundary === 2
                ? stripeEnd + 1
                : stripeEnd + 2
        if (row >= 0 && row < plane.height && (rowOffsets[row] ?? -1) < 0) {
          rowOffsets[row] = rows
          rows += 1
        }
      }
    }
    const data = sampleBuffer(plane.data, rows * plane.stride)
    for (let row = 0; row < plane.height; row += 1) {
      const targetRow = rowOffsets[row] ?? -1
      if (targetRow < 0) continue
      data.set(
        plane.data.subarray(row * plane.stride, (row + 1) * plane.stride),
        targetRow * plane.stride,
      )
    }
    return {
      data,
      height: plane.height,
      rowOffsets,
      stride: plane.stride,
      width: plane.width,
    }
  }
  return [
    snapshotPlane(planes[0], 0),
    snapshotPlane(planes[1], state.chromaShiftY),
    snapshotPlane(planes[2], state.chromaShiftY),
  ]
}

const sourceSample = (
  deblocked: Av1FilterPlane,
  cdef: Av1FilterPlane,
  inputX: number,
  inputY: number,
  planeEndX: number,
  planeEndY: number,
  stripeStartY: number,
  stripeEndY: number,
): number => {
  const x = clip(0, planeEndX, inputX)
  let y = clip(0, planeEndY, inputY)
  if (y < stripeStartY) {
    y = Math.max(stripeStartY - 2, y)
    return planeSample(deblocked, x, y)
  }
  if (y > stripeEndY) {
    y = Math.min(stripeEndY + 2, y)
    return planeSample(deblocked, x, y)
  }
  return cdef.data[y * cdef.stride + x] ?? 0
}

const wienerCoefficients = (
  source: Int8Array,
  offset: number,
  output: Int16Array,
  center: number,
): void => {
  output[3] = center
  for (let index = 0; index < 3; index += 1) {
    const value = source[offset + index] ?? 0
    output[index] = value
    output[6 - index] = value
    output[3] = (output[3] ?? 0) - 2 * value
  }
}

const restoreWienerBlock = (
  deblocked: Av1FilterPlane,
  cdef: Av1FilterPlane,
  output: Av1FilterPlane,
  unit: Av1RestorationPlaneState,
  unitIndex: number,
  x: number,
  y: number,
  width: number,
  height: number,
  planeEndX: number,
  planeEndY: number,
  stripeStartY: number,
  stripeEndY: number,
  verticalFilter: Int16Array,
  horizontalFilter: Int16Array,
  intermediate: Int32Array,
  window: Int32Array,
  windowStride: number,
  bitDepth: 8 | 10 | 12,
): void => {
  const coefficientOffset = unitIndex * 6
  const highBitDepth = bitDepth > 8
  wienerCoefficients(unit.wiener, coefficientOffset, verticalFilter, 128)
  wienerCoefficients(unit.wiener, coefficientOffset + 3, horizontalFilter, 128)
  const horizontalBits = 3 + Number(bitDepth === 12) * 2
  const verticalBits = 11 - Number(bitDepth === 12) * 2
  const horizontalOffset = 2 ** (bitDepth + 6)
  const horizontalMaximum = 2 ** (bitDepth + 8 - horizontalBits) - 1
  const verticalOffset = 2 ** (bitDepth + verticalBits - 1)
  const sampleMaximum = 2 ** bitDepth - 1
  const windowRadius = 2
  const originX = x - 3
  const originY = y - 3
  const windowRows = height + 6
  const windowColumns = width + 6
  const interior =
    !highBitDepth &&
    originX >= 0 &&
    originX + windowColumns - 1 <= planeEndX &&
    originY >= 0 &&
    originY + windowRows - 1 <= planeEndY &&
    originY >= stripeStartY &&
    originY + windowRows - 1 <= stripeEndY &&
    cdef.rowOffsets === undefined &&
    cdef.data instanceof Uint8Array
  const h0 = horizontalFilter[0] ?? 0
  const h1 = horizontalFilter[1] ?? 0
  const h2 = horizontalFilter[2] ?? 0
  const h3 = horizontalFilter[3] ?? 0
  const h4 = horizontalFilter[4] ?? 0
  const h5 = horizontalFilter[5] ?? 0
  const h6 = horizontalFilter[6] ?? 0
  const v0 = verticalFilter[0] ?? 0
  const v1 = verticalFilter[1] ?? 0
  const v2 = verticalFilter[2] ?? 0
  const v3 = verticalFilter[3] ?? 0
  const v4 = verticalFilter[4] ?? 0
  const v5 = verticalFilter[5] ?? 0
  const v6 = verticalFilter[6] ?? 0
  const outputData = output.data
  const outputStride = output.stride
  if (interior) {
    const cdefData = cdef.data
    const cdefStride = cdef.stride
    for (let row = 0; row < windowRows; row += 1) {
      const sourceRow = (originY + row) * cdefStride + originX
      const intermediateRow = row * width
      for (let column = 0; column < width; column += 1) {
        const origin = sourceRow + column
        const sum =
          h0 * (cdefData[origin] ?? 0) +
          h1 * (cdefData[origin + 1] ?? 0) +
          h2 * (cdefData[origin + 2] ?? 0) +
          h3 * (cdefData[origin + 3] ?? 0) +
          h4 * (cdefData[origin + 4] ?? 0) +
          h5 * (cdefData[origin + 5] ?? 0) +
          h6 * (cdefData[origin + 6] ?? 0)
        const rounded = Math.floor((sum + 4) / 8)
        intermediate[intermediateRow + column] =
          rounded < -2048 ? -2048 : rounded > 6143 ? 6143 : rounded
      }
    }
    for (let row = 0; row < height; row += 1) {
      const row0 = row * width
      const dest = row * outputStride + x
      for (let column = 0; column < width; column += 1) {
        const sum =
          v0 * (intermediate[row0 + column] ?? 0) +
          v1 * (intermediate[row0 + width + column] ?? 0) +
          v2 * (intermediate[row0 + width * 2 + column] ?? 0) +
          v3 * (intermediate[row0 + width * 3 + column] ?? 0) +
          v4 * (intermediate[row0 + width * 4 + column] ?? 0) +
          v5 * (intermediate[row0 + width * 5 + column] ?? 0) +
          v6 * (intermediate[row0 + width * 6 + column] ?? 0)
        const rounded = Math.floor((sum + 1024) / 2048)
        outputData[dest + column] = rounded < 0 ? 0 : rounded > 255 ? 255 : rounded
      }
    }
    return
  }
  fillRestorationWindow(
    deblocked,
    cdef,
    x,
    y,
    width,
    height,
    windowRadius,
    planeEndX,
    planeEndY,
    stripeStartY,
    stripeEndY,
    window,
    windowStride,
  )
  if (!highBitDepth) {
    for (let row = 0; row < height + 6; row += 1) {
      const windowRow = row * windowStride
      const intermediateRow = row * width
      for (let column = 0; column < width; column += 1) {
        const origin = windowRow + column
        const sum =
          h0 * (window[origin] ?? 0) +
          h1 * (window[origin + 1] ?? 0) +
          h2 * (window[origin + 2] ?? 0) +
          h3 * (window[origin + 3] ?? 0) +
          h4 * (window[origin + 4] ?? 0) +
          h5 * (window[origin + 5] ?? 0) +
          h6 * (window[origin + 6] ?? 0)
        const rounded = Math.floor((sum + 4) / 8)
        intermediate[intermediateRow + column] =
          rounded < -2048 ? -2048 : rounded > 6143 ? 6143 : rounded
      }
    }
    for (let row = 0; row < height; row += 1) {
      const row0 = row * width
      const dest = row * outputStride + x
      for (let column = 0; column < width; column += 1) {
        const sum =
          v0 * (intermediate[row0 + column] ?? 0) +
          v1 * (intermediate[row0 + width + column] ?? 0) +
          v2 * (intermediate[row0 + width * 2 + column] ?? 0) +
          v3 * (intermediate[row0 + width * 3 + column] ?? 0) +
          v4 * (intermediate[row0 + width * 4 + column] ?? 0) +
          v5 * (intermediate[row0 + width * 5 + column] ?? 0) +
          v6 * (intermediate[row0 + width * 6 + column] ?? 0)
        const rounded = Math.floor((sum + 1024) / 2048)
        outputData[dest + column] = rounded < 0 ? 0 : rounded > 255 ? 255 : rounded
      }
    }
    return
  }
  for (let row = 0; row < height + 6; row += 1) {
    const windowRow = row * windowStride
    for (let column = 0; column < width; column += 1) {
      const origin = windowRow + column
      const sum =
        h0 * (window[origin] ?? 0) +
        h1 * (window[origin + 1] ?? 0) +
        h2 * (window[origin + 2] ?? 0) +
        h3 * (window[origin + 3] ?? 0) +
        h4 * (window[origin + 4] ?? 0) +
        h5 * (window[origin + 5] ?? 0) +
        h6 * (window[origin + 6] ?? 0)
      intermediate[row * width + column] = clip(
        0,
        horizontalMaximum,
        round2(sum + horizontalOffset, horizontalBits),
      )
    }
  }
  for (let row = 0; row < height; row += 1) {
    const row0 = row * width
    for (let column = 0; column < width; column += 1) {
      const sum =
        v0 * (intermediate[row0 + column] ?? 0) +
        v1 * (intermediate[row0 + width + column] ?? 0) +
        v2 * (intermediate[row0 + width * 2 + column] ?? 0) +
        v3 * (intermediate[row0 + width * 3 + column] ?? 0) +
        v4 * (intermediate[row0 + width * 4 + column] ?? 0) +
        v5 * (intermediate[row0 + width * 5 + column] ?? 0) +
        v6 * (intermediate[row0 + width * 6 + column] ?? 0)
      outputData[row * outputStride + x + column] = clip(
        0,
        sampleMaximum,
        round2(sum - verticalOffset, verticalBits),
      )
    }
  }
}

const fillRestorationWindow = (
  deblocked: Av1FilterPlane,
  cdef: Av1FilterPlane,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  planeEndX: number,
  planeEndY: number,
  stripeStartY: number,
  stripeEndY: number,
  window: Int32Array,
  windowStride: number,
): void => {
  const originX = x - 1 - radius
  const originY = y - 1 - radius
  const rows = height + 2 + 2 * radius
  const columns = width + 2 + 2 * radius
  const interior =
    originX >= 0 &&
    originX + columns - 1 <= planeEndX &&
    originY >= 0 &&
    originY + rows - 1 <= planeEndY &&
    originY >= stripeStartY &&
    originY + rows - 1 <= stripeEndY &&
    cdef.rowOffsets === undefined
  if (interior) {
    const cdefData = cdef.data
    const cdefStride = cdef.stride
    for (let row = 0; row < rows; row += 1) {
      const source = (originY + row) * cdefStride + originX
      const destination = row * windowStride
      for (let column = 0; column < columns; column += 1) {
        window[destination + column] = cdefData[source + column] ?? 0
      }
    }
    return
  }
  for (let row = 0; row < rows; row += 1) {
    const sampleY = originY + row
    const rowOffset = row * windowStride
    for (let column = 0; column < columns; column += 1) {
      window[rowOffset + column] = sourceSample(
        deblocked,
        cdef,
        originX + column,
        sampleY,
        planeEndX,
        planeEndY,
        stripeStartY,
        stripeEndY,
      )
    }
  }
}

const boxFilter8 = (
  cdefData: Uint8Array,
  cdefStride: number,
  windowRadius: number,
  x: number,
  y: number,
  width: number,
  height: number,
  set: number,
  pass: number,
  aValues: Int32Array,
  bValues: Int32Array,
  filtered: Int32Array,
  prefixSums: Int32Array,
  prefixSquares: Int32Array,
  prefixStride: number,
): void => {
  const radius = sgrParameters[set * 4 + pass * 2] ?? 0
  if (radius === 0) return
  const epsilon = sgrParameters[set * 4 + pass * 2 + 1] ?? 0
  const boxWidth = width + 2
  const n = (2 * radius + 1) ** 2
  const nSquaredEpsilon = n * n * epsilon
  const scale = Math.floor((1_048_576 + Math.floor(nSquaredEpsilon / 2)) / nSquaredEpsilon)
  const oneOverN = Math.floor((4096 + Math.floor(n / 2)) / n)
  for (let inputRow = -1; inputRow <= height; inputRow += 1) {
    const centerRow = inputRow + 1 + windowRadius
    const topRow = (centerRow - radius) * prefixStride
    const bottomRow = (centerRow + radius + 1) * prefixStride
    for (let inputColumn = -1; inputColumn <= width; inputColumn += 1) {
      const centerColumn = inputColumn + 1 + windowRadius
      const left = centerColumn - radius
      const right = centerColumn + radius + 1
      const sum =
        (prefixSums[bottomRow + right] ?? 0) -
        (prefixSums[topRow + right] ?? 0) -
        (prefixSums[bottomRow + left] ?? 0) +
        (prefixSums[topRow + left] ?? 0)
      const squares =
        (prefixSquares[bottomRow + right] ?? 0) -
        (prefixSquares[topRow + right] ?? 0) -
        (prefixSquares[bottomRow + left] ?? 0) +
        (prefixSquares[topRow + left] ?? 0)
      const variance = Math.max(0, squares * n - sum * sum)
      const z = (variance * scale + 524_288) >> 20
      const a = z >= 255 ? 256 : z === 0 ? 1 : Math.floor((z * 256 + (z >> 1)) / (z + 1))
      const b = ((256 - a) * sum * oneOverN + 2048) >> 12
      const target = (inputRow + 1) * boxWidth + inputColumn + 1
      aValues[target] = a
      bValues[target] = b
    }
  }
  if (pass === 0) {
    for (let row = 0; row < height; row += 1) {
      const oddRow = (row & 1) === 1
      const shift = oddRow ? 8 : 9
      const rounding = 1 << (shift - 1)
      const cdefRow = (y + row) * cdefStride + x
      const row0 = row * boxWidth
      const row1 = row0 + boxWidth
      const row2 = row1 + boxWidth
      for (let column = 0; column < width; column += 1) {
        let a = 0
        let b = 0
        if (oddRow) {
          const origin = row1 + column
          a =
            5 * (aValues[origin] ?? 0) +
            6 * (aValues[origin + 1] ?? 0) +
            5 * (aValues[origin + 2] ?? 0)
          b =
            5 * (bValues[origin] ?? 0) +
            6 * (bValues[origin + 1] ?? 0) +
            5 * (bValues[origin + 2] ?? 0)
        } else {
          const top = row0 + column
          const bottom = row2 + column
          a =
            5 *
              ((aValues[top] ?? 0) +
                (aValues[top + 2] ?? 0) +
                (aValues[bottom] ?? 0) +
                (aValues[bottom + 2] ?? 0)) +
            6 * ((aValues[top + 1] ?? 0) + (aValues[bottom + 1] ?? 0))
          b =
            5 *
              ((bValues[top] ?? 0) +
                (bValues[top + 2] ?? 0) +
                (bValues[bottom] ?? 0) +
                (bValues[bottom + 2] ?? 0)) +
            6 * ((bValues[top + 1] ?? 0) + (bValues[bottom + 1] ?? 0))
        }
        filtered[row * width + column] =
          (a * (cdefData[cdefRow + column] ?? 0) + b + rounding) >> shift
      }
    }
    return
  }
  for (let row = 0; row < height; row += 1) {
    const cdefRow = (y + row) * cdefStride + x
    const row0 = row * boxWidth
    const row1 = row0 + boxWidth
    const row2 = row1 + boxWidth
    for (let column = 0; column < width; column += 1) {
      const top = row0 + column
      const middle = row1 + column
      const bottom = row2 + column
      const a =
        3 *
          ((aValues[top] ?? 0) +
            (aValues[top + 2] ?? 0) +
            (aValues[bottom] ?? 0) +
            (aValues[bottom + 2] ?? 0)) +
        4 *
          ((aValues[top + 1] ?? 0) +
            (aValues[middle] ?? 0) +
            (aValues[middle + 1] ?? 0) +
            (aValues[middle + 2] ?? 0) +
            (aValues[bottom + 1] ?? 0))
      const b =
        3 *
          ((bValues[top] ?? 0) +
            (bValues[top + 2] ?? 0) +
            (bValues[bottom] ?? 0) +
            (bValues[bottom + 2] ?? 0)) +
        4 *
          ((bValues[top + 1] ?? 0) +
            (bValues[middle] ?? 0) +
            (bValues[middle + 1] ?? 0) +
            (bValues[middle + 2] ?? 0) +
            (bValues[bottom + 1] ?? 0))
      filtered[row * width + column] = (a * (cdefData[cdefRow + column] ?? 0) + b + 256) >> 9
    }
  }
}

const boxFilter = (
  cdef: Av1FilterPlane,
  _window: Int32Array,
  _windowStride: number,
  windowRadius: number,
  x: number,
  y: number,
  width: number,
  height: number,
  set: number,
  pass: number,
  aValues: Int32Array,
  bValues: Int32Array,
  filtered: Int32Array,
  prefixSums: Int32Array,
  prefixSquares: Int32Array,
  prefixStride: number,
  bitDepth: 8 | 10 | 12,
): void => {
  if (bitDepth === 8 && cdef.data instanceof Uint8Array) {
    boxFilter8(
      cdef.data,
      cdef.stride,
      windowRadius,
      x,
      y,
      width,
      height,
      set,
      pass,
      aValues,
      bValues,
      filtered,
      prefixSums,
      prefixSquares,
      prefixStride,
    )
    return
  }
  const radius = sgrParameters[set * 4 + pass * 2] ?? 0
  if (radius === 0) return
  const epsilon = sgrParameters[set * 4 + pass * 2 + 1] ?? 0
  const boxWidth = width + 2
  const n = (2 * radius + 1) ** 2
  const nSquaredEpsilon = n * n * epsilon
  const depthShift = bitDepth - 8
  const scale = Math.floor((2 ** 20 + Math.floor(nSquaredEpsilon / 2)) / nSquaredEpsilon)
  const oneOverN = Math.floor((2 ** 12 + Math.floor(n / 2)) / n)
  for (let inputRow = -1; inputRow <= height; inputRow += 1) {
    for (let inputColumn = -1; inputColumn <= width; inputColumn += 1) {
      const centerRow = inputRow + 1 + windowRadius
      const centerColumn = inputColumn + 1 + windowRadius
      const top = centerRow - radius
      const left = centerColumn - radius
      const bottom = centerRow + radius + 1
      const right = centerColumn + radius + 1
      const sum =
        (prefixSums[bottom * prefixStride + right] ?? 0) -
        (prefixSums[top * prefixStride + right] ?? 0) -
        (prefixSums[bottom * prefixStride + left] ?? 0) +
        (prefixSums[top * prefixStride + left] ?? 0)
      const squares =
        (prefixSquares[bottom * prefixStride + right] ?? 0) -
        (prefixSquares[top * prefixStride + right] ?? 0) -
        (prefixSquares[bottom * prefixStride + left] ?? 0) +
        (prefixSquares[top * prefixStride + left] ?? 0)
      const normalizedSquares = round2(squares, depthShift * 2)
      const normalizedSum = round2(sum, depthShift)
      const variance = Math.max(0, normalizedSquares * n - normalizedSum * normalizedSum)
      const z = round2(variance * scale, 20)
      const a = z >= 255 ? 256 : z === 0 ? 1 : Math.floor((z * 256 + Math.floor(z / 2)) / (z + 1))
      const b = round2((256 - a) * sum * oneOverN, 12)
      const target = (inputRow + 1) * boxWidth + inputColumn + 1
      aValues[target] = a
      bValues[target] = b
    }
  }
  const cdefData = cdef.data
  const cdefStride = cdef.stride
  if (pass === 0) {
    for (let row = 0; row < height; row += 1) {
      const oddRow = (row & 1) === 1
      const shift = oddRow ? 4 : 5
      const cdefRow = (y + row) * cdefStride + x
      const row0 = row * boxWidth
      const row1 = row0 + boxWidth
      const row2 = row1 + boxWidth
      for (let column = 0; column < width; column += 1) {
        let a = 0
        let b = 0
        if (oddRow) {
          const origin = row1 + column
          a =
            5 * (aValues[origin] ?? 0) +
            6 * (aValues[origin + 1] ?? 0) +
            5 * (aValues[origin + 2] ?? 0)
          b =
            5 * (bValues[origin] ?? 0) +
            6 * (bValues[origin + 1] ?? 0) +
            5 * (bValues[origin + 2] ?? 0)
        } else {
          const top = row0 + column
          const bottom = row2 + column
          a =
            5 *
              ((aValues[top] ?? 0) +
                (aValues[top + 2] ?? 0) +
                (aValues[bottom] ?? 0) +
                (aValues[bottom + 2] ?? 0)) +
            6 * ((aValues[top + 1] ?? 0) + (aValues[bottom + 1] ?? 0))
          b =
            5 *
              ((bValues[top] ?? 0) +
                (bValues[top + 2] ?? 0) +
                (bValues[bottom] ?? 0) +
                (bValues[bottom + 2] ?? 0)) +
            6 * ((bValues[top + 1] ?? 0) + (bValues[bottom + 1] ?? 0))
        }
        filtered[row * width + column] = round2(
          a * (cdefData[cdefRow + column] ?? 0) + b,
          8 + shift - 4,
        )
      }
    }
    return
  }
  for (let row = 0; row < height; row += 1) {
    const cdefRow = (y + row) * cdefStride + x
    const row0 = row * boxWidth
    const row1 = row0 + boxWidth
    const row2 = row1 + boxWidth
    for (let column = 0; column < width; column += 1) {
      const top = row0 + column
      const middle = row1 + column
      const bottom = row2 + column
      const a =
        3 *
          ((aValues[top] ?? 0) +
            (aValues[top + 2] ?? 0) +
            (aValues[bottom] ?? 0) +
            (aValues[bottom + 2] ?? 0)) +
        4 *
          ((aValues[top + 1] ?? 0) +
            (aValues[middle] ?? 0) +
            (aValues[middle + 1] ?? 0) +
            (aValues[middle + 2] ?? 0) +
            (aValues[bottom + 1] ?? 0))
      const b =
        3 *
          ((bValues[top] ?? 0) +
            (bValues[top + 2] ?? 0) +
            (bValues[bottom] ?? 0) +
            (bValues[bottom + 2] ?? 0)) +
        4 *
          ((bValues[top + 1] ?? 0) +
            (bValues[middle] ?? 0) +
            (bValues[middle + 1] ?? 0) +
            (bValues[middle + 2] ?? 0) +
            (bValues[bottom + 1] ?? 0))
      filtered[row * width + column] = round2(a * (cdefData[cdefRow + column] ?? 0) + b, 9)
    }
  }
}

const restoreSelfGuidedBlock = (
  deblocked: Av1FilterPlane,
  cdef: Av1FilterPlane,
  output: Av1FilterPlane,
  unit: Av1RestorationPlaneState,
  unitIndex: number,
  x: number,
  y: number,
  width: number,
  height: number,
  planeEndX: number,
  planeEndY: number,
  stripeStartY: number,
  stripeEndY: number,
  aValues: Int32Array,
  bValues: Int32Array,
  filtered0: Int32Array,
  filtered1: Int32Array,
  window: Int32Array,
  windowStride: number,
  prefixSums: Int32Array,
  prefixSquares: Int32Array,
  prefixStride: number,
  bitDepth: 8 | 10 | 12,
): void => {
  const set = unit.sgrSets[unitIndex] ?? 0
  const radius0 = sgrParameters[set * 4] ?? 0
  const radius1 = sgrParameters[set * 4 + 2] ?? 0
  const windowRadius = radius0 > radius1 ? radius0 : radius1
  if (windowRadius > 0) {
    fillRestorationWindow(
      deblocked,
      cdef,
      x,
      y,
      width,
      height,
      windowRadius,
      planeEndX,
      planeEndY,
      stripeStartY,
      stripeEndY,
      window,
      windowStride,
    )
    const windowRows = height + 2 + 2 * windowRadius
    const windowColumns = width + 2 + 2 * windowRadius
    for (let row = 0; row < windowRows; row += 1) {
      const windowRow = row * windowStride
      const prefixRow = (row + 1) * prefixStride
      const previousPrefixRow = row * prefixStride
      for (let column = 0; column < windowColumns; column += 1) {
        const sample = window[windowRow + column] ?? 0
        prefixSums[prefixRow + column + 1] =
          (prefixSums[previousPrefixRow + column + 1] ?? 0) +
          (prefixSums[prefixRow + column] ?? 0) -
          (prefixSums[previousPrefixRow + column] ?? 0) +
          sample
        prefixSquares[prefixRow + column + 1] =
          (prefixSquares[previousPrefixRow + column + 1] ?? 0) +
          (prefixSquares[prefixRow + column] ?? 0) -
          (prefixSquares[previousPrefixRow + column] ?? 0) +
          sample * sample
      }
    }
  }
  boxFilter(
    cdef,
    window,
    windowStride,
    windowRadius,
    x,
    y,
    width,
    height,
    set,
    0,
    aValues,
    bValues,
    filtered0,
    prefixSums,
    prefixSquares,
    prefixStride,
    bitDepth,
  )
  boxFilter(
    cdef,
    window,
    windowStride,
    windowRadius,
    x,
    y,
    width,
    height,
    set,
    1,
    aValues,
    bValues,
    filtered1,
    prefixSums,
    prefixSquares,
    prefixStride,
    bitDepth,
  )
  const weight0 = unit.sgrXqd[unitIndex * 2] ?? 0
  const weight1 = unit.sgrXqd[unitIndex * 2 + 1] ?? 0
  const weight2 = 128 - weight0 - weight1
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const target = row * output.stride + x + column
      const source = cdef.data[(y + row) * cdef.stride + x + column] ?? 0
      const scaledSource = source << 4
      const sample = row * width + column
      const projected =
        weight1 * scaledSource +
        weight0 * (radius0 ? (filtered0[sample] ?? 0) : scaledSource) +
        weight2 * (radius1 ? (filtered1[sample] ?? 0) : scaledSource)
      output.data[target] = clip(0, 2 ** bitDepth - 1, round2(projected, 11))
    }
  }
}

const countRestorationUnits = (unitSize: number, planeSize: number): number =>
  Math.max(Math.floor((planeSize + (unitSize >> 1)) / unitSize), 1)

const validateRestorationPlaneState = (
  header: Av1FrameHeader,
  state: Av1PostFilterState,
  planeIndex: number,
): void => {
  const plane = state.restoration[planeIndex]
  if (!plane) throw invalidInput('AV1 restoration plane state is missing')
  const unitSize = plane.unitSize
  if (
    !Number.isSafeInteger(unitSize) ||
    unitSize < 32 ||
    unitSize > 256 ||
    (unitSize & (unitSize - 1)) !== 0
  ) {
    throw invalidInput('AV1 restoration unit size is invalid')
  }
  const shiftX = planeIndex === 0 ? 0 : state.chromaShiftX
  const shiftY = planeIndex === 0 ? 0 : state.chromaShiftY
  const planeWidth = Math.ceil(header.upscaledWidth / 2 ** shiftX)
  const planeHeight = Math.ceil(header.frameHeight / 2 ** shiftY)
  const columns = countRestorationUnits(unitSize, planeWidth)
  const rows = countRestorationUnits(unitSize, planeHeight)
  const units = columns * rows
  if (!Number.isSafeInteger(units) || plane.columns !== columns || plane.rows !== rows) {
    throw invalidInput('AV1 restoration unit grid is invalid')
  }
  if (
    plane.types.length !== units ||
    plane.wiener.length !== units * 6 ||
    plane.sgrSets.length !== units ||
    plane.sgrXqd.length !== units * 2
  ) {
    throw invalidInput('AV1 restoration unit state is truncated')
  }
  const frameType = header.restorationTypes[planeIndex] ?? 0
  if (!Number.isSafeInteger(frameType) || frameType < 0 || frameType > 3) {
    throw invalidInput('AV1 restoration frame type is invalid')
  }
  for (let unit = 0; unit < units; unit += 1) {
    const type = plane.types[unit] ?? 0
    if (type > 2 || (type !== 0 && frameType !== 3 && type !== frameType)) {
      throw invalidInput('AV1 restoration unit type is invalid')
    }
    if (type === 1) {
      const offset = unit * 6
      for (const passOffset of [offset, offset + 3]) {
        const first = plane.wiener[passOffset] ?? 0
        const second = plane.wiener[passOffset + 1] ?? 0
        const third = plane.wiener[passOffset + 2] ?? 0
        if (
          (planeIndex === 0 ? first < -5 || first > 10 : first !== 0) ||
          second < -23 ||
          second > 8 ||
          third < -17 ||
          third > 46
        ) {
          throw invalidInput('AV1 Wiener restoration coefficients are invalid')
        }
      }
    } else if (type === 2) {
      const set = plane.sgrSets[unit] ?? 0
      const first = plane.sgrXqd[unit * 2] ?? 0
      const second = plane.sgrXqd[unit * 2 + 1] ?? 0
      const firstRadius = set < 10 || set >= 14
      const secondRadius = set < 14
      if (
        set > 15 ||
        (firstRadius ? first < -96 || first > 31 : first !== 0) ||
        (secondRadius ? second < -32 || second > 95 : second !== 95)
      ) {
        throw invalidInput('AV1 self-guided restoration parameters are invalid')
      }
    }
  }
}

const validateRestorationState = (header: Av1FrameHeader, state: Av1PostFilterState): void => {
  for (let planeIndex = 0; planeIndex < 3; planeIndex += 1) {
    validateRestorationPlaneState(header, state, planeIndex)
  }
}

export const applyAv1LoopRestoration = (
  deblocked: readonly [Av1FilterPlane, Av1FilterPlane, Av1FilterPlane],
  cdef: readonly [Av1FilterPlane, Av1FilterPlane, Av1FilterPlane],
  header: Av1FrameHeader,
  state: Av1PostFilterState,
): [Av1FilterPlane, Av1FilterPlane, Av1FilterPlane] => {
  validateRestorationState(header, state)
  const bandHeight = state.bitDepth === 8 ? 8 : 4
  const createBand = (plane: Av1FilterPlane, rows: number): Av1FilterPlane => ({
    ...plane,
    data: sampleBuffer(plane.data, plane.stride * rows),
    height: rows,
  })
  const createBands = (): [Av1FilterPlane, Av1FilterPlane, Av1FilterPlane] => [
    createBand(cdef[0], bandHeight),
    createBand(cdef[1], bandHeight >> state.chromaShiftY),
    createBand(cdef[2], bandHeight >> state.chromaShiftY),
  ]
  let pendingOldest = createBands()
  let pendingNewest = createBands()
  let current = createBands()
  let pendingOldestLumaY = 0
  let pendingNewestLumaY = 0
  let pendingCount = 0
  const copyFromSource = (target: Av1FilterPlane, source: Av1FilterPlane, startY: number): void => {
    const rows = Math.min(target.height, source.height - startY)
    const length = rows * source.stride
    target.data.fill(0)
    target.data.set(source.data.subarray(startY * source.stride, startY * source.stride + length))
  }
  const commit = (target: Av1FilterPlane, source: Av1FilterPlane, startY: number): void => {
    const rows = Math.min(source.height, target.height - startY)
    const length = rows * target.stride
    target.data.set(source.data.subarray(0, length), startY * target.stride)
  }
  const commitBands = (
    bands: readonly [Av1FilterPlane, Av1FilterPlane, Av1FilterPlane],
    lumaY: number,
  ): void => {
    for (let planeIndex = 0; planeIndex < 3; planeIndex += 1) {
      const plane = cdef[planeIndex]
      const band = bands[planeIndex]
      if (!plane || !band) continue
      const shiftY = planeIndex === 0 ? 0 : state.chromaShiftY
      commit(plane, band, lumaY >> shiftY)
    }
  }
  const verticalFilter = new Int16Array(7)
  const horizontalFilter = new Int16Array(7)
  let maxTileWidth = 4
  for (let planeIndex = 0; planeIndex < 3; planeIndex += 1) {
    const unit = state.restoration[planeIndex]
    if (!unit || unit.types.length === 0) continue
    const shiftX = planeIndex === 0 ? 0 : state.chromaShiftX
    const planeWidth = Math.ceil(header.upscaledWidth / 2 ** shiftX)
    const lastWidth = planeWidth - (unit.columns - 1) * unit.unitSize
    if (unit.unitSize > maxTileWidth) maxTileWidth = unit.unitSize
    if (lastWidth > maxTileWidth) maxTileWidth = lastWidth
  }
  const windowRows = bandHeight + 6
  const windowStride = maxTileWidth + 6
  const window = new Int32Array(windowStride * windowRows)
  const prefixStride = windowStride + 1
  const prefixSums = new Int32Array(prefixStride * (windowRows + 1))
  const prefixSquares = new Int32Array(prefixStride * (windowRows + 1))
  const aValues = new Int32Array((maxTileWidth + 2) * (bandHeight + 2))
  const bValues = new Int32Array((maxTileWidth + 2) * (bandHeight + 2))
  const filtered0 = new Int32Array(maxTileWidth * bandHeight)
  const filtered1 = new Int32Array(maxTileWidth * bandHeight)
  const intermediate = new Int32Array(maxTileWidth * windowRows)
  for (let lumaY = 0; lumaY < header.frameHeight; lumaY += bandHeight) {
    for (let planeIndex = 0; planeIndex < 3; planeIndex += 1) {
      const plane = cdef[planeIndex]
      const band = current[planeIndex]
      if (!plane || !band) continue
      const shiftY = planeIndex === 0 ? 0 : state.chromaShiftY
      copyFromSource(band, plane, lumaY >> shiftY)
    }
    const stripeNumber = Math.floor((lumaY + 8) / 64)
    for (let planeIndex = 0; planeIndex < 3; planeIndex += 1) {
      const unit = state.restoration[planeIndex]
      const deblockedPlane = deblocked[planeIndex]
      const outputPlane = current[planeIndex]
      if (!unit || !deblockedPlane || !outputPlane || unit.types.length === 0) continue
      const shiftX = planeIndex === 0 ? 0 : state.chromaShiftX
      const shiftY = planeIndex === 0 ? 0 : state.chromaShiftY
      const plane = cdef[planeIndex]
      if (!plane) continue
      const planeEndX = Math.ceil(header.upscaledWidth / 2 ** shiftX) - 1
      const planeEndY = Math.ceil(header.frameHeight / 2 ** shiftY) - 1
      const y = lumaY >> shiftY
      const height = Math.min(bandHeight >> shiftY, planeEndY - y + 1)
      if (height < 1) continue
      const stripeStartY = (-8 + stripeNumber * 64) >> shiftY
      const stripeEndY = stripeStartY + (64 >> shiftY) - 1
      for (let x = 0; x <= planeEndX; ) {
        const unitRow = Math.min(unit.rows - 1, Math.floor(((lumaY + 8) >> shiftY) / unit.unitSize))
        const unitColumn = Math.min(unit.columns - 1, Math.floor(x / unit.unitSize))
        const unitIndex = unitRow * unit.columns + unitColumn
        const type = unit.types[unitIndex] ?? 0
        const nextUnitX =
          unitColumn + 1 < unit.columns ? (unitColumn + 1) * unit.unitSize : planeEndX + 1
        // Int32 prefix squares overflow on wide 10/12-bit windows (12-bit 4x4 is already near the
        // signed 32-bit limit). Keep 8-bit tiles unit-wide; high-bit stays on 4-sample tiles.
        const tileLimit = state.bitDepth === 8 ? nextUnitX - x : 4 >> shiftX
        const width = Math.min(tileLimit, planeEndX - x + 1)
        if (type === 1) {
          restoreWienerBlock(
            deblockedPlane,
            plane,
            outputPlane,
            unit,
            unitIndex,
            x,
            y,
            width,
            height,
            planeEndX,
            planeEndY,
            stripeStartY,
            stripeEndY,
            verticalFilter,
            horizontalFilter,
            intermediate,
            window,
            windowStride,
            state.bitDepth,
          )
        } else if (type === 2) {
          restoreSelfGuidedBlock(
            deblockedPlane,
            plane,
            outputPlane,
            unit,
            unitIndex,
            x,
            y,
            width,
            height,
            planeEndX,
            planeEndY,
            stripeStartY,
            stripeEndY,
            aValues,
            bValues,
            filtered0,
            filtered1,
            window,
            windowStride,
            prefixSums,
            prefixSquares,
            prefixStride,
            state.bitDepth,
          )
        }
        x += width
      }
    }
    if (pendingCount === 2) commitBands(pendingOldest, pendingOldestLumaY)
    const reusable = pendingOldest
    pendingOldest = pendingNewest
    pendingOldestLumaY = pendingNewestLumaY
    pendingNewest = current
    pendingNewestLumaY = lumaY
    current = reusable
    pendingCount = Math.min(2, pendingCount + 1)
  }
  if (pendingCount === 2) commitBands(pendingOldest, pendingOldestLumaY)
  if (pendingCount > 0) commitBands(pendingNewest, pendingNewestLumaY)
  return [cdef[0], cdef[1], cdef[2]]
}

export interface Av1PreRestorationPlanes {
  readonly cdef: [Av1FilterPlane, Av1FilterPlane, Av1FilterPlane]
  readonly deblocked: [Av1FilterPlane, Av1FilterPlane, Av1FilterPlane]
  readonly hasRestoration: boolean
}

export const applyAv1DeblockAndCdef = (
  planes: [Av1FilterPlane, Av1FilterPlane, Av1FilterPlane],
  header: Av1FrameHeader,
  state: Av1PostFilterState,
): Av1PreRestorationPlanes => {
  applyAv1LoopFilter(planes, header, state)
  const hasRestoration = state.restoration.some((plane) => plane.types.some((value) => value !== 0))
  const deblocked = hasRestoration ? snapshotRestorationBoundaries(planes, header, state) : planes
  const hasCdef =
    state.cdefIndices.some((value) => value !== 0) &&
    (header.cdefYPrimaryStrengths.some((value) => value !== 0) ||
      header.cdefYSecondaryStrengths.some((value) => value !== 0) ||
      header.cdefUvPrimaryStrengths.some((value) => value !== 0) ||
      header.cdefUvSecondaryStrengths.some((value) => value !== 0))
  const cdef = hasCdef ? applyAv1Cdef(planes, header, state) : planes
  return { cdef, deblocked, hasRestoration }
}

export const applyAv1PostFilters = (
  planes: [Av1FilterPlane, Av1FilterPlane, Av1FilterPlane],
  header: Av1FrameHeader,
  state: Av1PostFilterState,
): [Av1FilterPlane, Av1FilterPlane, Av1FilterPlane] => {
  const filtered = applyAv1DeblockAndCdef(planes, header, state)
  return filtered.hasRestoration
    ? applyAv1LoopRestoration(filtered.deblocked, filtered.cdef, header, state)
    : filtered.cdef
}
