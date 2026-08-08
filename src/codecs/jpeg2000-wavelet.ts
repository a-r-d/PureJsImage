import { invalidInput } from '../errors.ts'

export interface Jpeg2000ResolutionCoefficients {
  readonly x0: number
  readonly y0: number
  readonly width: number
  readonly height: number
  readonly values: Float32Array
}

const padding = 4

const extendSymmetric = (line: Float32Array, length: number): void => {
  let leftSource = padding + 1
  let rightSource = padding + length - 2
  for (let index = 1; index <= padding; index += 1) {
    line[padding - index] = line[leftSource] ?? 0
    line[padding + length - 1 + index] = line[rightSource] ?? 0
    leftSource += 1
    rightSource -= 1
  }
}

const inverse53 = (line: Float32Array, length: number, origin: number): void => {
  const lowParity = origin & 1
  extendSymmetric(line, length)
  for (let index = padding + lowParity; index < padding + length; index += 2) {
    line[index] = (line[index] ?? 0) - (((line[index - 1] ?? 0) + (line[index + 1] ?? 0) + 2) >> 2)
  }
  extendSymmetric(line, length)
  for (let index = padding + (lowParity ^ 1); index < padding + length; index += 2) {
    line[index] = (line[index] ?? 0) + (((line[index - 1] ?? 0) + (line[index + 1] ?? 0)) >> 1)
  }
}

const inverse97 = (line: Float32Array, length: number, origin: number): void => {
  const alpha = -1.586134342059924
  const beta = -0.052980118572961
  const gamma = 0.882911075530934
  const delta = 0.443506852043971
  const scale = 1.230174104914001
  const lowParity = origin & 1
  const highParity = lowParity ^ 1

  for (let index = padding + highParity; index < padding + length; index += 2) {
    line[index] = (line[index] ?? 0) / scale
  }
  for (let index = padding + lowParity; index < padding + length; index += 2) {
    line[index] = (line[index] ?? 0) * scale
  }
  extendSymmetric(line, length)
  for (let index = padding + lowParity; index < padding + length; index += 2) {
    line[index] = (line[index] ?? 0) - delta * ((line[index - 1] ?? 0) + (line[index + 1] ?? 0))
  }
  extendSymmetric(line, length)
  for (let index = padding + highParity; index < padding + length; index += 2) {
    line[index] = (line[index] ?? 0) - gamma * ((line[index - 1] ?? 0) + (line[index + 1] ?? 0))
  }
  extendSymmetric(line, length)
  for (let index = padding + lowParity; index < padding + length; index += 2) {
    line[index] = (line[index] ?? 0) - beta * ((line[index - 1] ?? 0) + (line[index + 1] ?? 0))
  }
  extendSymmetric(line, length)
  for (let index = padding + highParity; index < padding + length; index += 2) {
    line[index] = (line[index] ?? 0) - alpha * ((line[index - 1] ?? 0) + (line[index + 1] ?? 0))
  }
}

const synthesizeLine = (
  line: Float32Array,
  length: number,
  reversible: boolean,
  origin: number,
): void => {
  if (reversible) inverse53(line, length, origin)
  else inverse97(line, length, origin)
}

const synthesizeLevel = (
  low: Jpeg2000ResolutionCoefficients,
  high: Jpeg2000ResolutionCoefficients,
  reversible: boolean,
): Jpeg2000ResolutionCoefficients => {
  const { width, height, values } = high
  const originX = high.x0
  const originY = high.y0
  if (values.length !== width * height) throw invalidInput('JPEG 2000 wavelet level is invalid')
  const lowX = originX & 1
  const lowY = originY & 1
  for (let y = 0; y < low.height; y += 1) {
    let target = (y * 2 + lowY) * width + lowX
    const source = y * low.width
    for (let x = 0; x < low.width; x += 1) {
      values[target] = low.values[source + x] ?? 0
      target += 2
    }
  }

  if (width === 1) {
    if ((originX & 1) !== 0) {
      for (let y = 0; y < height; y += 1) values[y] = (values[y] ?? 0) * 0.5
    }
  } else {
    const row = new Float32Array(width + padding * 2)
    for (let y = 0; y < height; y += 1) {
      const start = y * width
      row.set(values.subarray(start, start + width), padding)
      synthesizeLine(row, width, reversible, originX)
      values.set(row.subarray(padding, padding + width), start)
    }
  }

  if (height === 1) {
    if ((originY & 1) !== 0) {
      for (let x = 0; x < width; x += 1) values[x] = (values[x] ?? 0) * 0.5
    }
  } else {
    const column = new Float32Array(height + padding * 2)
    for (let x = 0; x < width; x += 1) {
      for (let y = 0; y < height; y += 1) column[padding + y] = values[y * width + x] ?? 0
      synthesizeLine(column, height, reversible, originY)
      for (let y = 0; y < height; y += 1) values[y * width + x] = column[padding + y] ?? 0
    }
  }
  return high
}

export const inverseJpeg2000Wavelet = (
  levels: readonly Jpeg2000ResolutionCoefficients[],
  reversible: boolean,
): Jpeg2000ResolutionCoefficients => {
  const first = levels[0]
  if (!first) throw invalidInput('JPEG 2000 wavelet has no resolution levels')
  let result = first
  for (let index = 1; index < levels.length; index += 1) {
    const next = levels[index]
    if (!next) throw invalidInput('JPEG 2000 wavelet level is missing')
    result = synthesizeLevel(result, next, reversible)
  }
  return result
}
