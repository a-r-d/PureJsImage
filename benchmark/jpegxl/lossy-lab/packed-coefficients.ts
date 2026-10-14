import type { JpegXlEncoderMemory } from '../../../src/codecs/jpegxl-encoder-memory.ts'

export type PackedCoefficients =
  | { readonly values: Int8Array; readonly exceptions: Int16Array }
  | { readonly values: Int16Array; readonly exceptions: null }

/** First-party lossless storage: signed bytes with -128 escaping an Int16 value. */
export function packCoefficients(
  source: Int16Array,
  memory: JpegXlEncoderMemory,
): PackedCoefficients {
  let count = 0
  for (let i = 0; i < source.length; i++) {
    const value = source[i] ?? 0
    if (value < -127 || value > 127) count++
  }
  // Dense large coefficients keep their original storage rather than expanding it.
  if (count * 2 >= source.length) return { values: source, exceptions: null }
  const values = memory.allocate(Int8Array, source.length)
  const exceptions = memory.allocate(Int16Array, count)
  let index = 0
  for (let i = 0; i < source.length; i++) {
    const value = source[i] ?? 0
    if (value < -127 || value > 127) {
      values[i] = -128
      exceptions[index++] = value
    } else values[i] = value
  }
  return { values, exceptions }
}

export function unpackCoefficients(source: PackedCoefficients, output: Int16Array): void {
  if (output.length < source.values.length) throw new Error('Coefficient output is too short')
  if (source.exceptions === null) {
    output.set(source.values)
    return
  }
  let index = 0
  for (let i = 0; i < source.values.length; i++) {
    const value = source.values[i] ?? 0
    if (value === -128) {
      const expanded = source.exceptions[index++]
      if (expanded === undefined) throw new Error('Missing coefficient exception')
      output[i] = expanded
    } else output[i] = value
  }
  if (index !== source.exceptions.length) throw new Error('Unused coefficient exceptions')
}
