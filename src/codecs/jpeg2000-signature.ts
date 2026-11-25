export const signature = Uint8Array.of(0, 0, 0, 12, 0x6a, 0x50, 0x20, 0x20, 0x0d, 0x0a, 0x87, 0x0a)

export const isJp2 = (header: Uint8Array): boolean => {
  if (header.byteLength < signature.byteLength) return false
  for (let index = 0; index < signature.byteLength; index += 1) {
    if (header[index] !== signature[index]) return false
  }
  return true
}
