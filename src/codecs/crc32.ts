const table = new Uint32Array(256)

for (let index = 0; index < table.length; index += 1) {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  }
  table[index] = value >>> 0
}

// Each slice advances a byte through one additional zero byte of the CRC.
let slices: Uint32Array | undefined

const crcSlices = (): Uint32Array => {
  if (slices) return slices
  const values = new Uint32Array(8 * 256)
  values.set(table)
  for (let index = 256; index < values.length; index += 1) {
    const previous = values[index - 256] ?? 0
    values[index] = (table[previous & 255] ?? 0) ^ (previous >>> 8)
  }
  slices = values
  return values
}

const updateBytes = (crc: number, data: Uint8Array): number => {
  let value = crc
  const length = data.byteLength
  for (let index = 0; index < length; index += 1) {
    value = (table[(value ^ (data[index] ?? 0)) & 0xff] ?? 0) ^ (value >>> 8)
  }
  return value >>> 0
}

const updateSliced = (crc: number, data: Uint8Array): number => {
  const values = crcSlices()
  const length = data.byteLength
  const view = new DataView(data.buffer, data.byteOffset, length)
  let value = crc
  let index = 0
  for (; index + 8 <= length; index += 8) {
    const first = value ^ view.getUint32(index, true)
    const second = view.getUint32(index + 4, true)
    value =
      (values[1792 + (first & 255)] ?? 0) ^
      (values[1536 + ((first >>> 8) & 255)] ?? 0) ^
      (values[1280 + ((first >>> 16) & 255)] ?? 0) ^
      (values[1024 + (first >>> 24)] ?? 0) ^
      (values[768 + (second & 255)] ?? 0) ^
      (values[512 + ((second >>> 8) & 255)] ?? 0) ^
      (values[256 + ((second >>> 16) & 255)] ?? 0) ^
      (values[second >>> 24] ?? 0)
  }
  for (; index < length; index += 1) {
    value = (table[(value ^ (data[index] ?? 0)) & 0xff] ?? 0) ^ (value >>> 8)
  }
  return value >>> 0
}

// The byte loop finishes small images before V8 optimizes the sliced loop.
// Switch once this module has checked 256 KiB.
let checkedBytes = 0

export const updateCrc32 = (crc: number, data: Uint8Array): number => {
  if (checkedBytes < 262_144) {
    checkedBytes += data.byteLength
    return updateBytes(crc, data)
  }
  return data.byteLength < 64 ? updateBytes(crc, data) : updateSliced(crc, data)
}

export const crc32 = (...parts: readonly Uint8Array[]): number => {
  let value = 0xffffffff
  for (const part of parts) value = updateCrc32(value, part)
  return (value ^ 0xffffffff) >>> 0
}
