import type { Av1FrameHeader } from './av1-frame.ts'

export interface Av1FilterPlane {
  readonly data: Uint8Array
  readonly height: number
  readonly stride: number
  readonly width: number
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
  readonly cdefColumns: number
  readonly chromaShiftX: number
  readonly chromaShiftY: number
  readonly cdefIndices: Uint16Array
  readonly miColumns: number
  readonly miRows: number
  readonly restoration: readonly [
    Av1RestorationPlaneState,
    Av1RestorationPlaneState,
    Av1RestorationPlaneState,
  ]
  readonly skips: Uint8Array
  readonly transformHeights: readonly [Uint8Array, Uint8Array, Uint8Array]
  readonly transformWidths: readonly [Uint8Array, Uint8Array, Uint8Array]
}

const cdefDirections = Int8Array.from([
  -1, 1, -2, 2, 0, 1, -1, 2, 0, 1, 0, 2, 0, 1, 1, 2, 1, 1, 2, 2, 1, 0, 2, 1, 1, 0, 2, 0, 1, 0, 2,
  -1,
])
const cdefUvDirections420 = Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7])
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

const clonePlanes = (
  planes: readonly [Av1FilterPlane, Av1FilterPlane, Av1FilterPlane],
): [Av1FilterPlane, Av1FilterPlane, Av1FilterPlane] => [
  { ...planes[0], data: planes[0].data.slice() },
  { ...planes[1], data: planes[1].data.slice() },
  { ...planes[2], data: planes[2].data.slice() },
]

const planeContextWidth = (state: Av1PostFilterState, plane: number): number => {
  const shiftX = plane === 0 ? 0 : state.chromaShiftX
  return (state.miColumns + (1 << shiftX) - 1) >> shiftX
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
  const contextColumn = column >> shiftX
  const contextRow = row >> shiftY
  return transforms[plane]?.[contextRow * planeContextWidth(state, plane) + contextColumn] ?? 0
}

const filter4Clamp = (value: number): number => clip(-128, 127, value)

const narrowFilter = (
  plane: Av1FilterPlane,
  x: number,
  y: number,
  dx: number,
  dy: number,
  highEdgeVariance: boolean,
): void => {
  const q0Index = y * plane.stride + x
  const q1Index = (y + dy) * plane.stride + x + dx
  const p0Index = (y - dy) * plane.stride + x - dx
  const p1Index = (y - 2 * dy) * plane.stride + x - 2 * dx
  const q0 = (plane.data[q0Index] ?? 0) - 128
  const q1 = (plane.data[q1Index] ?? 0) - 128
  const p0 = (plane.data[p0Index] ?? 0) - 128
  const p1 = (plane.data[p1Index] ?? 0) - 128
  let filter = highEdgeVariance ? filter4Clamp(p1 - q1) : 0
  filter = filter4Clamp(filter + 3 * (q0 - p0))
  const filter1 = filter4Clamp(filter + 4) >> 3
  const filter2 = filter4Clamp(filter + 3) >> 3
  plane.data[q0Index] = filter4Clamp(q0 - filter1) + 128
  plane.data[p0Index] = filter4Clamp(p0 + filter2) + 128
  if (!highEdgeVariance) {
    const outerFilter = round2(filter1, 1)
    plane.data[q1Index] = filter4Clamp(q1 - outerFilter) + 128
    plane.data[p1Index] = filter4Clamp(p1 + outerFilter) + 128
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
  let flat = false
  if (filterSize >= 8) {
    flat =
      Math.abs(p1 - p0) <= 1 &&
      Math.abs(q1 - q0) <= 1 &&
      Math.abs(sample(-3) - p0) <= 1 &&
      Math.abs(sample(2) - q0) <= 1 &&
      (filterLength < 8 || (Math.abs(sample(-4) - p0) <= 1 && Math.abs(sample(3) - q0) <= 1))
  }
  if (filterSize === 4 || !flat) {
    narrowFilter(plane, x, y, dx, dy, highEdgeVariance)
    return
  }
  const flat2 =
    filterSize >= 16 &&
    Math.abs(sample(-7) - p0) <= 1 &&
    Math.abs(sample(6) - q0) <= 1 &&
    Math.abs(sample(-6) - p0) <= 1 &&
    Math.abs(sample(5) - q0) <= 1 &&
    Math.abs(sample(-5) - p0) <= 1 &&
    Math.abs(sample(4) - q0) <= 1
  wideFilter(plane, x, y, dx, dy, flat2 ? 4 : 3, isLuma, wideScratch)
}

export const applyAv1LoopFilter = (
  planes: readonly [Av1FilterPlane, Av1FilterPlane, Av1FilterPlane],
  header: Av1FrameHeader,
  state: Av1PostFilterState,
): void => {
  const wideScratch = new Int16Array(12)
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
          const baseLevel = header.loopFilterLevels[planeIndex === 0 ? pass : planeIndex + 1] ?? 0
          const shift = baseLevel >> 5
          const referenceDelta = header.loopFilterDeltaEnabled
            ? (header.loopFilterRefDeltas[0] ?? 0) << shift
            : 0
          const level = clip(0, 63, baseLevel + referenceDelta)
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
              limit,
              blockLimit,
              threshold,
              planeIndex === 0,
              wideScratch,
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
): readonly [number, number] => {
  partial.fill(0)
  costs.fill(0)
  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      const value = (plane.data[(y + row) * plane.stride + x + column] ?? 0) - 128
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
  const tapSet = primaryStrength & 1
  for (let localY = 0; localY < height; localY += 1) {
    for (let localX = 0; localX < width; localX += 1) {
      const sourceIndex = (y0 + localY) * source.stride + x0 + localX
      const center = source.data[sourceIndex] ?? 0
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
            const sample = source.data[sampleY * source.stride + sampleX] ?? 0
            const primary = directionOffsetIndex === 0
            const strength = primary ? primaryStrength : secondaryStrength
            const taps = primary ? cdefPrimaryTaps : cdefSecondaryTaps
            sum += (taps[tapSet * 2 + tap] ?? 0) * constrainCdef(sample - center, strength, damping)
            minimum = Math.min(minimum, sample)
            maximum = Math.max(maximum, sample)
          }
        }
      }
      target.data[sourceIndex] = clip(minimum, maximum, center + ((8 + sum - Number(sum < 0)) >> 4))
    }
  }
}

export const applyAv1Cdef = (
  planes: readonly [Av1FilterPlane, Av1FilterPlane, Av1FilterPlane],
  header: Av1FrameHeader,
  state: Av1PostFilterState,
): [Av1FilterPlane, Av1FilterPlane, Av1FilterPlane] => {
  const output = clonePlanes(planes)
  const partial = new Int32Array(120)
  const costs = new Float64Array(8)
  for (let row = 0; row < state.miRows; row += 2) {
    for (let column = 0; column < state.miColumns; column += 2) {
      const baseRow = row & ~15
      const baseColumn = column & ~15
      const storedIndex =
        state.cdefIndices[(baseRow >> 4) * state.cdefColumns + (baseColumn >> 4)] ?? 0
      if (storedIndex === 0) continue
      const index = storedIndex - 1
      const first = row * state.miColumns + column
      const skip =
        (state.skips[first] ?? 0) === 1 &&
        (state.skips[first + 1] ?? 0) === 1 &&
        (state.skips[first + state.miColumns] ?? 0) === 1 &&
        (state.skips[first + state.miColumns + 1] ?? 0) === 1
      if (skip) continue
      const [lumaDirection, variance] = cdefDirection(
        planes[0],
        column * 4,
        row * 4,
        partial,
        costs,
      )
      const lumaPrimaryBase = header.cdefYPrimaryStrengths[index] ?? 0
      const lumaSecondary = header.cdefYSecondaryStrengths[index] ?? 0
      const scaledVariance = Math.floor(variance / 64)
      const varianceStrength = scaledVariance > 0 ? Math.min(floorLog2(scaledVariance), 12) : 0
      const lumaPrimary = variance ? (lumaPrimaryBase * (4 + varianceStrength) + 8) >> 4 : 0
      filterCdefBlock(
        planes[0],
        output[0],
        0,
        state,
        row,
        column,
        lumaPrimary,
        lumaSecondary,
        header.cdefDamping,
        lumaPrimary === 0 ? 0 : lumaDirection,
      )
      const chromaPrimary = header.cdefUvPrimaryStrengths[index] ?? 0
      const chromaSecondary = header.cdefUvSecondaryStrengths[index] ?? 0
      const chromaDirection =
        chromaPrimary === 0 ? 0 : (cdefUvDirections420[lumaDirection] ?? lumaDirection)
      for (let planeIndex = 1; planeIndex < 3; planeIndex += 1) {
        const sourcePlane = planes[planeIndex]
        const outputPlane = output[planeIndex]
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
          header.cdefDamping - 1,
          chromaDirection,
        )
      }
    }
  }
  return output
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
    return deblocked.data[y * deblocked.stride + x] ?? 0
  }
  if (y > stripeEndY) {
    y = Math.min(stripeEndY + 2, y)
    return deblocked.data[y * deblocked.stride + x] ?? 0
  }
  return cdef.data[y * cdef.stride + x] ?? 0
}

const wienerCoefficients = (source: Int8Array, offset: number, output: Int16Array): void => {
  output[3] = 128
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
): void => {
  const coefficientOffset = unitIndex * 6
  wienerCoefficients(unit.wiener, coefficientOffset, verticalFilter)
  wienerCoefficients(unit.wiener, coefficientOffset + 3, horizontalFilter)
  for (let row = 0; row < height + 6; row += 1) {
    for (let column = 0; column < width; column += 1) {
      let sum = 0
      for (let tap = 0; tap < 7; tap += 1) {
        sum +=
          (horizontalFilter[tap] ?? 0) *
          sourceSample(
            deblocked,
            cdef,
            x + column + tap - 3,
            y + row - 3,
            planeEndX,
            planeEndY,
            stripeStartY,
            stripeEndY,
          )
      }
      intermediate[row * width + column] = clip(-2048, 6143, round2(sum, 3))
    }
  }
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      let sum = 0
      for (let tap = 0; tap < 7; tap += 1) {
        sum += (verticalFilter[tap] ?? 0) * (intermediate[(row + tap) * width + column] ?? 0)
      }
      output.data[(y + row) * output.stride + x + column] = clip(0, 255, round2(sum, 11))
    }
  }
}

const boxFilter = (
  deblocked: Av1FilterPlane,
  cdef: Av1FilterPlane,
  x: number,
  y: number,
  width: number,
  height: number,
  set: number,
  pass: number,
  planeEndX: number,
  planeEndY: number,
  stripeStartY: number,
  stripeEndY: number,
  aValues: Int32Array,
  bValues: Int32Array,
  filtered: Int32Array,
): void => {
  const radius = sgrParameters[set * 4 + pass * 2] ?? 0
  if (radius === 0) return
  const epsilon = sgrParameters[set * 4 + pass * 2 + 1] ?? 0
  const boxWidth = width + 2
  const n = (2 * radius + 1) ** 2
  const nSquaredEpsilon = n * n * epsilon
  const scale = Math.floor((2 ** 20 + Math.floor(nSquaredEpsilon / 2)) / nSquaredEpsilon)
  const oneOverN = Math.floor((2 ** 12 + Math.floor(n / 2)) / n)
  for (let inputRow = -1; inputRow <= height; inputRow += 1) {
    for (let inputColumn = -1; inputColumn <= width; inputColumn += 1) {
      let squares = 0
      let sum = 0
      for (let deltaY = -radius; deltaY <= radius; deltaY += 1) {
        for (let deltaX = -radius; deltaX <= radius; deltaX += 1) {
          const sample = sourceSample(
            deblocked,
            cdef,
            x + inputColumn + deltaX,
            y + inputRow + deltaY,
            planeEndX,
            planeEndY,
            stripeStartY,
            stripeEndY,
          )
          squares += sample * sample
          sum += sample
        }
      }
      const variance = Math.max(0, squares * n - sum * sum)
      const z = round2(variance * scale, 20)
      const a = z >= 255 ? 256 : z === 0 ? 1 : Math.floor((z * 256 + Math.floor(z / 2)) / (z + 1))
      const b = round2((256 - a) * sum * oneOverN, 12)
      const target = (inputRow + 1) * boxWidth + inputColumn + 1
      aValues[target] = a
      bValues[target] = b
    }
  }
  for (let row = 0; row < height; row += 1) {
    const shift = pass === 0 && (row & 1) === 1 ? 4 : 5
    for (let column = 0; column < width; column += 1) {
      let a = 0
      let b = 0
      for (let deltaY = -1; deltaY <= 1; deltaY += 1) {
        for (let deltaX = -1; deltaX <= 1; deltaX += 1) {
          const weight =
            pass === 0
              ? ((row + deltaY) & 1) === 1
                ? deltaX === 0
                  ? 6
                  : 5
                : 0
              : deltaX === 0 || deltaY === 0
                ? 4
                : 3
          const source = (row + deltaY + 1) * boxWidth + column + deltaX + 1
          a += weight * (aValues[source] ?? 0)
          b += weight * (bValues[source] ?? 0)
        }
      }
      const center = cdef.data[(y + row) * cdef.stride + x + column] ?? 0
      filtered[row * width + column] = round2(a * center + b, 8 + shift - 4)
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
): void => {
  const set = unit.sgrSets[unitIndex] ?? 0
  boxFilter(
    deblocked,
    cdef,
    x,
    y,
    width,
    height,
    set,
    0,
    planeEndX,
    planeEndY,
    stripeStartY,
    stripeEndY,
    aValues,
    bValues,
    filtered0,
  )
  boxFilter(
    deblocked,
    cdef,
    x,
    y,
    width,
    height,
    set,
    1,
    planeEndX,
    planeEndY,
    stripeStartY,
    stripeEndY,
    aValues,
    bValues,
    filtered1,
  )
  const weight0 = unit.sgrXqd[unitIndex * 2] ?? 0
  const weight1 = unit.sgrXqd[unitIndex * 2 + 1] ?? 0
  const weight2 = 128 - weight0 - weight1
  const radius0 = sgrParameters[set * 4] ?? 0
  const radius1 = sgrParameters[set * 4 + 2] ?? 0
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const target = (y + row) * output.stride + x + column
      const source = cdef.data[target] ?? 0
      const scaledSource = source << 4
      const sample = row * width + column
      const projected =
        weight1 * scaledSource +
        weight0 * (radius0 ? (filtered0[sample] ?? 0) : scaledSource) +
        weight2 * (radius1 ? (filtered1[sample] ?? 0) : scaledSource)
      output.data[target] = clip(0, 255, round2(projected, 11))
    }
  }
}

export const applyAv1LoopRestoration = (
  deblocked: readonly [Av1FilterPlane, Av1FilterPlane, Av1FilterPlane],
  cdef: readonly [Av1FilterPlane, Av1FilterPlane, Av1FilterPlane],
  header: Av1FrameHeader,
  state: Av1PostFilterState,
): [Av1FilterPlane, Av1FilterPlane, Av1FilterPlane] => {
  const output = clonePlanes(cdef)
  const verticalFilter = new Int16Array(7)
  const horizontalFilter = new Int16Array(7)
  const intermediate = new Int32Array(40)
  const aValues = new Int32Array(36)
  const bValues = new Int32Array(36)
  const filtered0 = new Int32Array(16)
  const filtered1 = new Int32Array(16)
  for (let lumaY = 0; lumaY < header.frameHeight; lumaY += 4) {
    const stripeNumber = Math.floor((lumaY + 8) / 64)
    for (let lumaX = 0; lumaX < header.upscaledWidth; lumaX += 4) {
      for (let planeIndex = 0; planeIndex < 3; planeIndex += 1) {
        const unit = state.restoration[planeIndex]
        const deblockedPlane = deblocked[planeIndex]
        const outputPlane = output[planeIndex]
        if (!unit || !deblockedPlane || !outputPlane || unit.types.length === 0) continue
        const shiftX = planeIndex === 0 ? 0 : state.chromaShiftX
        const shiftY = planeIndex === 0 ? 0 : state.chromaShiftY
        const plane = cdef[planeIndex]
        if (!plane) continue
        const planeEndX = Math.ceil(header.upscaledWidth / 2 ** shiftX) - 1
        const planeEndY = Math.ceil(header.frameHeight / 2 ** shiftY) - 1
        const x = lumaX >> shiftX
        const y = lumaY >> shiftY
        const width = Math.min(4 >> shiftX, planeEndX - x + 1)
        const height = Math.min(4 >> shiftY, planeEndY - y + 1)
        const unitRow = Math.min(unit.rows - 1, Math.floor(((lumaY + 8) >> shiftY) / unit.unitSize))
        const unitColumn = Math.min(unit.columns - 1, Math.floor(x / unit.unitSize))
        const unitIndex = unitRow * unit.columns + unitColumn
        const type = unit.types[unitIndex] ?? 0
        if (type === 0) continue
        const stripeStartY = (-8 + stripeNumber * 64) >> shiftY
        const stripeEndY = stripeStartY + (64 >> shiftY) - 1
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
          )
        }
      }
    }
  }
  return output
}

export const applyAv1PostFilters = (
  planes: [Av1FilterPlane, Av1FilterPlane, Av1FilterPlane],
  header: Av1FrameHeader,
  state: Av1PostFilterState,
): [Av1FilterPlane, Av1FilterPlane, Av1FilterPlane] => {
  applyAv1LoopFilter(planes, header, state)
  const hasCdef =
    state.cdefIndices.some((value) => value !== 0) &&
    (header.cdefYPrimaryStrengths.some((value) => value !== 0) ||
      header.cdefYSecondaryStrengths.some((value) => value !== 0) ||
      header.cdefUvPrimaryStrengths.some((value) => value !== 0) ||
      header.cdefUvSecondaryStrengths.some((value) => value !== 0))
  const cdef = hasCdef ? applyAv1Cdef(planes, header, state) : planes
  const hasRestoration = state.restoration.some((plane) => plane.types.some((value) => value !== 0))
  return hasRestoration ? applyAv1LoopRestoration(planes, cdef, header, state) : cdef
}
