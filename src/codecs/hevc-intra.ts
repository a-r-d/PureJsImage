import { invalidInput } from '../errors.ts'

const INTRA_ANGLES = [
  0, 0, 32, 26, 21, 17, 13, 9, 5, 2, 0, -2, -5, -9, -13, -17, -21, -26, -32, -26, -21, -17, -13, -9,
  -5, -2, 0, 2, 5, 9, 13, 17, 21, 26, 32,
] as const

const INVERSE_ANGLES = new Map<number, number>([
  [11, -4096],
  [12, -1638],
  [13, -910],
  [14, -630],
  [15, -482],
  [16, -390],
  [17, -315],
  [18, -256],
  [19, -315],
  [20, -390],
  [21, -482],
  [22, -630],
  [23, -910],
  [24, -1638],
  [25, -4096],
])

const clipSample = (value: number, bitDepth: number): number =>
  Math.max(0, Math.min((1 << bitDepth) - 1, value))

const arraySample = (samples: Int32Array, index: number): number => {
  const value = samples[index]
  if (value === undefined) throw invalidInput('HEVC intra-reference index is out of range')
  return value
}

const validateReferences = (
  samples: readonly (number | undefined)[],
  size: number,
  bitDepth: number,
  name: string,
): void => {
  if (samples.length !== size * 2 + 1) {
    throw invalidInput(`HEVC ${name} intra-reference length is invalid`)
  }
  const maximum = (1 << bitDepth) - 1
  for (const sample of samples) {
    if (sample !== undefined && (!Number.isInteger(sample) || sample < 0 || sample > maximum)) {
      throw invalidInput(`HEVC ${name} intra-reference sample is invalid`)
    }
  }
}

export interface HevcIntraReferences {
  /** Index zero is the shared top-left sample; remaining entries proceed right. */
  readonly top: Int32Array
  /** Index zero is the shared top-left sample; remaining entries proceed down. */
  readonly left: Int32Array
}

export const prepareHevcIntraReferences = (
  topInput: readonly (number | undefined)[],
  leftInput: readonly (number | undefined)[],
  size: number,
  bitDepth: number,
): HevcIntraReferences => {
  if (![4, 8, 16, 32].includes(size)) throw invalidInput('HEVC intra block size is invalid')
  if (bitDepth !== 8 && bitDepth !== 10) throw invalidInput('HEVC intra bit depth is invalid')
  validateReferences(topInput, size, bitDepth, 'top')
  validateReferences(leftInput, size, bitDepth, 'left')
  if (topInput[0] !== undefined && leftInput[0] !== undefined && topInput[0] !== leftInput[0]) {
    throw invalidInput('HEVC top-left intra references conflict')
  }

  // This order is the substitution order in H.265 8.4.4.2.2: bottom-up on
  // the left edge, through the corner, then left-to-right on the top edge.
  const perimeter: (number | undefined)[] = []
  for (let index = size * 2; index >= 1; index -= 1) perimeter.push(leftInput[index])
  perimeter.push(leftInput[0] ?? topInput[0])
  for (let index = 1; index <= size * 2; index += 1) perimeter.push(topInput[index])
  const firstAvailable = perimeter.find((sample) => sample !== undefined)
  let previous = firstAvailable ?? 1 << (bitDepth - 1)
  for (let index = 0; index < perimeter.length; index += 1) {
    const sample = perimeter[index]
    if (sample === undefined) perimeter[index] = previous
    else previous = sample
  }

  const top = new Int32Array(size * 2 + 1)
  const left = new Int32Array(size * 2 + 1)
  for (let index = 0; index <= size * 2; index += 1) {
    const leftValue = perimeter[size * 2 - index]
    const topValue = perimeter[size * 2 + index]
    if (leftValue === undefined || topValue === undefined) {
      throw invalidInput('HEVC intra-reference substitution failed')
    }
    left[index] = leftValue
    top[index] = topValue
  }
  return { top, left }
}

const filterReferences = (
  references: HevcIntraReferences,
  size: number,
  mode: number,
  component: 0 | 1 | 2,
  bitDepth: number,
  strongIntraSmoothing: boolean,
): HevcIntraReferences => {
  // The supported picture subset is 4:2:0. Neighbour filtering applies to
  // luma (and to 4:4:4 chroma), but not to subsampled chroma components.
  if (component !== 0 || mode === 1 || size === 4) return references
  const threshold = size === 8 ? 7 : size === 16 ? 1 : 0
  if (Math.min(Math.abs(mode - 26), Math.abs(mode - 10)) <= threshold) return references
  const top = new Int32Array(references.top.length)
  const left = new Int32Array(references.left.length)
  const end = size * 2
  const bilinear =
    strongIntraSmoothing &&
    component === 0 &&
    size === 32 &&
    Math.abs(
      arraySample(references.top, 0) +
        arraySample(references.top, end) -
        2 * arraySample(references.top, size),
    ) <
      1 << (bitDepth - 5) &&
    Math.abs(
      arraySample(references.left, 0) +
        arraySample(references.left, end) -
        2 * arraySample(references.left, size),
    ) <
      1 << (bitDepth - 5)
  if (bilinear) {
    top[0] = arraySample(references.top, 0)
    left[0] = arraySample(references.left, 0)
    for (let index = 1; index < end; index += 1) {
      top[index] =
        ((end - index) * arraySample(references.top, 0) +
          index * arraySample(references.top, end) +
          32) >>
        6
      left[index] =
        ((end - index) * arraySample(references.left, 0) +
          index * arraySample(references.left, end) +
          32) >>
        6
    }
    top[end] = arraySample(references.top, end)
    left[end] = arraySample(references.left, end)
    return { top, left }
  }
  const corner =
    (arraySample(references.left, 1) +
      2 * arraySample(references.top, 0) +
      arraySample(references.top, 1) +
      2) >>
    2
  top[0] = corner
  left[0] = corner
  for (let index = 1; index < end; index += 1) {
    top[index] =
      (arraySample(references.top, index - 1) +
        2 * arraySample(references.top, index) +
        arraySample(references.top, index + 1) +
        2) >>
      2
    left[index] =
      (arraySample(references.left, index - 1) +
        2 * arraySample(references.left, index) +
        arraySample(references.left, index + 1) +
        2) >>
      2
  }
  top[end] = arraySample(references.top, end)
  left[end] = arraySample(references.left, end)
  return { top, left }
}

export interface HevcIntraPredictionOptions {
  readonly bitDepth: 8 | 10
  readonly component: 0 | 1 | 2
  readonly disableBoundaryFilter?: boolean
  readonly mode: number
  readonly size: 4 | 8 | 16 | 32
  readonly strongIntraSmoothing?: boolean
}

export const predictHevcIntra = (
  inputReferences: HevcIntraReferences,
  options: HevcIntraPredictionOptions,
): Int32Array => {
  const { bitDepth, component, mode, size } = options
  if (!Number.isInteger(mode) || mode < 0 || mode > 34) {
    throw invalidInput('HEVC intra prediction mode is invalid')
  }
  if (inputReferences.top.length !== size * 2 + 1 || inputReferences.left.length !== size * 2 + 1) {
    throw invalidInput('HEVC prepared intra-reference dimensions are invalid')
  }
  const references = filterReferences(
    inputReferences,
    size,
    mode,
    component,
    bitDepth,
    options.strongIntraSmoothing ?? false,
  )
  const { top, left } = references
  const output = new Int32Array(size * size)
  if (mode === 0) {
    const shift = Math.log2(size) + 1
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        output[y * size + x] =
          ((size - 1 - x) * arraySample(left, y + 1) +
            (x + 1) * arraySample(top, size + 1) +
            (size - 1 - y) * arraySample(top, x + 1) +
            (y + 1) * arraySample(left, size + 1) +
            size) >>
          shift
      }
    }
    return output
  }
  if (mode === 1) {
    let sum = size
    for (let index = 1; index <= size; index += 1) {
      sum += arraySample(top, index) + arraySample(left, index)
    }
    const dc = sum >> (Math.log2(size) + 1)
    output.fill(dc)
    if (component === 0 && size < 32 && !options.disableBoundaryFilter) {
      output[0] = (arraySample(left, 1) + 2 * dc + arraySample(top, 1) + 2) >> 2
      for (let x = 1; x < size; x += 1) {
        output[x] = (arraySample(top, x + 1) + 3 * dc + 2) >> 2
      }
      for (let y = 1; y < size; y += 1) {
        output[y * size] = (arraySample(left, y + 1) + 3 * dc + 2) >> 2
      }
    }
    return output
  }

  const angle = INTRA_ANGLES[mode]
  if (angle === undefined) throw invalidInput('HEVC intra prediction angle is invalid')
  const vertical = mode >= 18
  const main = vertical ? top : left
  const side = vertical ? left : top
  const reference = new Map<number, number>()
  for (let index = 0; index <= size; index += 1) {
    reference.set(index, arraySample(main, index))
  }
  if (angle < 0 && (size * angle) >> 5 < -1) {
    const inverseAngle = INVERSE_ANGLES.get(mode)
    if (inverseAngle === undefined) throw invalidInput('HEVC inverse intra angle is missing')
    for (let index = -1; index >= (size * angle) >> 5; index -= 1) {
      reference.set(index, arraySample(side, (index * inverseAngle + 128) >> 8))
    }
  } else {
    for (let index = size + 1; index <= size * 2; index += 1) {
      reference.set(index, arraySample(main, index))
    }
  }
  const sample = (index: number): number => {
    const value = reference.get(index)
    if (value === undefined) throw invalidInput('HEVC angular intra reference is unavailable')
    return value
  }
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const displacement = (vertical ? y + 1 : x + 1) * angle
      const base = displacement >> 5
      const fraction = displacement & 31
      const position = (vertical ? x : y) + base + 1
      output[y * size + x] =
        fraction === 0
          ? sample(position)
          : ((32 - fraction) * sample(position) + fraction * sample(position + 1) + 16) >> 5
    }
  }
  if (component === 0 && size < 32 && !options.disableBoundaryFilter) {
    if (mode === 26) {
      for (let y = 0; y < size; y += 1) {
        output[y * size] = clipSample(
          arraySample(top, 1) + ((arraySample(left, y + 1) - arraySample(top, 0)) >> 1),
          bitDepth,
        )
      }
    } else if (mode === 10) {
      for (let x = 0; x < size; x += 1) {
        output[x] = clipSample(
          arraySample(left, 1) + ((arraySample(top, x + 1) - arraySample(top, 0)) >> 1),
          bitDepth,
        )
      }
    }
  }
  return output
}

export const deriveHevcLumaCandidates = (leftMode: number, topMode: number): readonly number[] => {
  if (
    !Number.isInteger(leftMode) ||
    leftMode < 0 ||
    leftMode > 34 ||
    !Number.isInteger(topMode) ||
    topMode < 0 ||
    topMode > 34
  ) {
    throw invalidInput('HEVC neighbouring intra mode is invalid')
  }
  if (leftMode === topMode) {
    return leftMode < 2
      ? [0, 1, 26]
      : [leftMode, 2 + ((leftMode + 29) % 32), 2 + ((leftMode - 1) % 32)]
  }
  if (leftMode !== 0 && topMode !== 0) return [leftMode, topMode, 0]
  if (leftMode !== 1 && topMode !== 1) return [leftMode, topMode, 1]
  return [leftMode, topMode, 26]
}

export const deriveHevcLumaMode = (
  candidates: readonly number[],
  selectedCandidate: number | undefined,
  remainingMode: number | undefined,
): number => {
  if (candidates.length !== 3) throw invalidInput('HEVC luma candidate count is invalid')
  if (selectedCandidate !== undefined) {
    if (!Number.isInteger(selectedCandidate) || selectedCandidate < 0 || selectedCandidate > 2) {
      throw invalidInput('HEVC luma candidate index is invalid')
    }
    const mode = candidates[selectedCandidate]
    if (mode === undefined) throw invalidInput('HEVC selected luma candidate is missing')
    return mode
  }
  if (
    remainingMode === undefined ||
    !Number.isInteger(remainingMode) ||
    remainingMode < 0 ||
    remainingMode > 31
  ) {
    throw invalidInput('HEVC remaining luma mode is invalid')
  }
  let mode = remainingMode
  for (const candidate of [...candidates].sort((left, right) => left - right)) {
    if (mode >= candidate) mode += 1
  }
  return mode
}

export const deriveHevcChromaMode = (codedMode: number, lumaMode: number): number => {
  if (!Number.isInteger(codedMode) || codedMode < 0 || codedMode > 4) {
    throw invalidInput('HEVC coded chroma mode is invalid')
  }
  if (!Number.isInteger(lumaMode) || lumaMode < 0 || lumaMode > 34) {
    throw invalidInput('HEVC luma mode for chroma prediction is invalid')
  }
  if (codedMode === 4) return lumaMode
  const base = [0, 26, 10, 1][codedMode]
  if (base === undefined) throw invalidInput('HEVC chroma prediction mode is invalid')
  return base === lumaMode ? 34 : base
}
