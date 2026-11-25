import { ascii, uint32BigEndian } from './helpers.ts'

export const detectIsobmffBrands = (data: Uint8Array): readonly string[] => {
  if (data.byteLength < 16 || ascii(data, 4, 4) !== 'ftyp') return []
  const size32 = uint32BigEndian(data, 0)
  let contentStart = 8
  let declaredSize = size32
  if (size32 === 0) declaredSize = data.byteLength
  else if (size32 === 1) {
    if (data.byteLength < 24) return []
    const high = uint32BigEndian(data, 8)
    const low = uint32BigEndian(data, 12)
    const extended = BigInt(high) * 0x1_0000_0000n + BigInt(low)
    if (extended > BigInt(Number.MAX_SAFE_INTEGER)) return []
    declaredSize = Number(extended)
    contentStart = 16
  }

  const end = Math.min(declaredSize, data.byteLength)
  if (end - contentStart < 8) return []
  const brands = [ascii(data, contentStart, 4)]
  for (let offset = contentStart + 8; offset + 4 <= end; offset += 4) {
    brands.push(ascii(data, offset, 4))
  }
  return brands
}
