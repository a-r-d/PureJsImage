const table = new Uint32Array(256)

for (let index = 0; index < table.length; index += 1) {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  }
  table[index] = value >>> 0
}

export const updateCrc32 = (crc: number, data: Uint8Array): number => {
  let value = crc
  for (const byte of data) {
    value = (table[(value ^ byte) & 0xff] ?? 0) ^ (value >>> 8)
  }
  return value >>> 0
}

export const crc32 = (...parts: readonly Uint8Array[]): number => {
  let value = 0xffffffff
  for (const part of parts) value = updateCrc32(value, part)
  return (value ^ 0xffffffff) >>> 0
}
