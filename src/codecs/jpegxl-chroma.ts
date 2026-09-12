import { throwIfAborted } from '../abort.ts'
import { invalidInput } from '../errors.ts'

export const jpegXlChromaShifts = (
  modes: readonly [number, number, number],
): readonly (readonly [number, number])[] => {
  const raw = modes.map((mode): readonly [number, number] => {
    if (mode === 0) return [0, 0]
    if (mode === 1) return [1, 1]
    if (mode === 2) return [1, 0]
    if (mode === 3) return [0, 1]
    throw invalidInput('JPEG XL chroma subsampling mode is invalid')
  })
  const horizontal = Math.max(...raw.map((value) => value[0])),
    vertical = Math.max(...raw.map((value) => value[1]))
  return raw.map((value) => [horizontal - value[0], vertical - value[1]] as const)
}

/** JFIF chroma reconstruction uses separable three-quarter/one-quarter interpolation. */
export const reconstructJpegXlChroma = (
  plane: Float64Array,
  width: number,
  height: number,
  outputWidth: number,
  outputHeight: number,
  horizontal: number,
  vertical: number,
  signal?: AbortSignal,
): Float64Array => {
  if (horizontal === 0 && vertical === 0) return plane
  let input = Float32Array.from(plane)
  if (horizontal !== 0) {
    const expanded = new Float32Array(outputWidth * height)
    for (let y = 0; y < height; y++) {
      throwIfAborted(signal)
      for (let x = 0; x < outputWidth; x++) {
        const center = x >>> 1,
          neighbor = Math.max(0, Math.min(width - 1, center + (x & 1 ? 1 : -1)))
        expanded[y * outputWidth + x] =
          0.75 * input[y * width + center]! + 0.25 * input[y * width + neighbor]!
      }
    }
    input = expanded
    width = outputWidth
  }
  const output = new Float64Array(outputWidth * outputHeight)
  if (vertical === 0) {
    output.set(input)
    return output
  }
  for (let y = 0; y < outputHeight; y++) {
    throwIfAborted(signal)
    const center = y >>> 1,
      neighbor = Math.max(0, Math.min(height - 1, center + (y & 1 ? 1 : -1)))
    for (let x = 0; x < outputWidth; x++)
      output[y * outputWidth + x] =
        0.75 * input[center * width + x]! + 0.25 * input[neighbor * width + x]!
  }
  return output
}

export const jpegXlYcbcrToRgb = (planes: readonly Float64Array[]): readonly Float64Array[] => {
  const cb = planes[0],
    y = planes[1],
    cr = planes[2]
  if (!cb || !y || !cr) throw invalidInput('JPEG XL YCbCr color planes are missing')
  const red = new Float64Array(y.length),
    green = new Float64Array(y.length),
    blue = new Float64Array(y.length)
  for (let i = 0; i < y.length; i++) {
    const luma = y[i]! + 128 / 255
    red[i] = luma + 1.402 * cr[i]!
    green[i] = luma - (0.114 * 1.772 * cb[i]! + 0.299 * 1.402 * cr[i]!) / 0.587
    blue[i] = luma + 1.772 * cb[i]!
  }
  return [red, green, blue, ...planes.slice(3)]
}
