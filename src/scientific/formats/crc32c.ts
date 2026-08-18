const table = new Uint32Array(256)
for (let index = 0; index < 256; index += 1) {
  let crc = index
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc & 1) === 0 ? crc >>> 1 : (crc >>> 1) ^ 0x82f6_3b78
  }
  table[index] = crc
}

/** Castagnoli CRC-32C of `bytes`, matching the Zarr v3 `crc32c` checksum codec. */
export const crc32c = (bytes: Uint8Array): number => {
  let crc = 0xffff_ffff
  for (let index = 0; index < bytes.byteLength; index += 1) {
    crc = (table[(crc ^ (bytes[index] ?? 0)) & 0xff] ?? 0) ^ (crc >>> 8)
  }
  return (crc ^ 0xffff_ffff) >>> 0
}
