import { invalidInput } from '../errors.ts'

export const ascii = (data: Uint8Array, offset: number, length: number): string => {
  let value = ''
  for (let index = offset; index < offset + length; index += 1) {
    const byte = data[index]
    if (byte === undefined) throw invalidInput('String extends beyond available image data')
    value += String.fromCharCode(byte)
  }
  return value
}

export const uint16BigEndian = (data: Uint8Array, offset: number): number => {
  const high = data[offset]
  const low = data[offset + 1]
  if (high === undefined || low === undefined) throw invalidInput('16-bit value is truncated')
  return high * 256 + low
}

export const uint16LittleEndian = (data: Uint8Array, offset: number): number => {
  const low = data[offset]
  const high = data[offset + 1]
  if (high === undefined || low === undefined) throw invalidInput('16-bit value is truncated')
  return low + high * 256
}

export const uint32BigEndian = (data: Uint8Array, offset: number): number => {
  const first = data[offset]
  const second = data[offset + 1]
  const third = data[offset + 2]
  const fourth = data[offset + 3]
  if (first === undefined || second === undefined || third === undefined || fourth === undefined) {
    throw invalidInput('32-bit value is truncated')
  }
  return first * 16_777_216 + second * 65_536 + third * 256 + fourth
}
