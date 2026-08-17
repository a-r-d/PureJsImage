import { invalidInput, limitExceeded } from '../../errors.ts'

export interface Lz4BlockDecodeOptions {
  readonly maxOutputBytes: number
  readonly expectedOutputBytes?: number
}

/** Decode one LZ4 block (not a frame) into a bounded output buffer. */
export const decodeLz4Block = (
  input: Uint8Array,
  options: Readonly<Lz4BlockDecodeOptions>,
): Uint8Array => {
  if (!Number.isSafeInteger(options.maxOutputBytes) || options.maxOutputBytes < 1) {
    throw invalidInput('LZ4 maxOutputBytes must be a positive safe integer')
  }
  if (
    options.expectedOutputBytes !== undefined &&
    (!Number.isSafeInteger(options.expectedOutputBytes) || options.expectedOutputBytes < 0)
  ) {
    throw invalidInput('LZ4 expectedOutputBytes must be a non-negative safe integer')
  }
  if (
    options.expectedOutputBytes !== undefined &&
    options.expectedOutputBytes > options.maxOutputBytes
  ) {
    throw limitExceeded(
      `LZ4 expectedOutputBytes ${options.expectedOutputBytes} exceeds maxOutputBytes ${options.maxOutputBytes}`,
    )
  }
  let buffer = new Uint8Array(options.expectedOutputBytes ?? Math.min(options.maxOutputBytes, 4096))
  let written = 0
  let cursor = 0
  const readByte = (): number => {
    const value = input[cursor]
    if (value === undefined) throw invalidInput('LZ4 block is truncated')
    cursor += 1
    return value
  }
  const push = (value: number): void => {
    if (written >= options.maxOutputBytes) {
      throw limitExceeded(`LZ4 output exceeds ${options.maxOutputBytes} bytes`)
    }
    if (written >= buffer.byteLength) {
      const grown = new Uint8Array(
        Math.min(options.maxOutputBytes, Math.max(buffer.byteLength * 2, 64)),
      )
      grown.set(buffer.subarray(0, written))
      buffer = grown
    }
    buffer[written] = value
    written += 1
  }
  const readLength = (start: number): number => {
    let length = start
    if (start < 15) return length
    while (true) {
      const extra = readByte()
      length += extra
      if (extra < 255) return length
    }
  }
  while (cursor < input.byteLength) {
    const token = readByte()
    const literalLength = readLength(token >>> 4)
    if (cursor + literalLength > input.byteLength)
      throw invalidInput('LZ4 literals overrun the block')
    for (let index = 0; index < literalLength; index += 1) push(readByte())
    if (cursor === input.byteLength) break
    if (cursor + 2 > input.byteLength) throw invalidInput('LZ4 match is missing an offset')
    const offset = readByte() | (readByte() << 8)
    if (offset === 0 || offset > written) throw invalidInput('LZ4 match offset is invalid')
    const matchLength = readLength(token & 0x0f) + 4
    let source = written - offset
    for (let index = 0; index < matchLength; index += 1) {
      push(buffer[source] ?? 0)
      source += 1
    }
  }
  if (options.expectedOutputBytes !== undefined && written !== options.expectedOutputBytes) {
    throw invalidInput(`LZ4 decoded ${written} bytes; expected ${options.expectedOutputBytes}`)
  }
  return buffer.subarray(0, written)
}
