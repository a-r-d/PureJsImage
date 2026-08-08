type RegisteredFormat =
  | 'avif'
  | 'bmp'
  | 'gif'
  | 'heif'
  | 'ico'
  | 'jp2'
  | 'jpeg'
  | 'png'
  | 'tiff'
  | 'webp'

export interface RecognizedInputFormat {
  readonly name: string
  readonly registeredFormat?: RegisteredFormat
  readonly malformedMessage?: string
}

interface MagicFormat extends RecognizedInputFormat {
  readonly signatures: readonly (readonly number[])[]
}

const magicFormats: readonly MagicFormat[] = [
  { name: 'PNG', registeredFormat: 'png', signatures: [[137, 80, 78, 71, 13, 10, 26, 10]] },
  { name: 'JPEG', registeredFormat: 'jpeg', signatures: [[0xff, 0xd8, 0xff]] },
  {
    name: 'GIF',
    registeredFormat: 'gif',
    signatures: [
      [71, 73, 70, 56, 55, 97],
      [71, 73, 70, 56, 57, 97],
    ],
  },
  { name: 'BMP', registeredFormat: 'bmp', signatures: [[66, 77]] },
  {
    name: 'TIFF',
    registeredFormat: 'tiff',
    signatures: [
      [73, 73, 42, 0],
      [77, 77, 0, 42],
    ],
  },
  {
    name: 'BigTIFF',
    signatures: [
      [73, 73, 43, 0, 8, 0, 0, 0],
      [77, 77, 0, 43, 0, 8, 0, 0],
    ],
  },
  { name: 'PDF', signatures: [[37, 80, 68, 70, 45]] },
  { name: 'ICO', registeredFormat: 'ico', signatures: [[0, 0, 1, 0]] },
  { name: 'CUR', signatures: [[0, 0, 2, 0]] },
  { name: 'JPEG XL codestream', signatures: [[0xff, 0x0a]] },
  {
    name: 'JPEG XL container',
    signatures: [[0, 0, 0, 12, 74, 88, 76, 32, 13, 10, 135, 10]],
  },
  {
    name: 'JPEG 2000 container',
    registeredFormat: 'jp2',
    signatures: [[0, 0, 0, 12, 106, 80, 32, 32, 13, 10, 135, 10]],
  },
  { name: 'JPEG 2000 codestream', signatures: [[0xff, 0x4f, 0xff, 0x51]] },
  { name: 'WebP', registeredFormat: 'webp', signatures: [[82, 73, 70, 70]] },
]

const startsWith = (data: Uint8Array, signature: readonly number[], offset = 0): boolean => {
  if (offset < 0 || offset + signature.length > data.byteLength) return false
  for (let index = 0; index < signature.length; index += 1) {
    if (data[offset + index] !== signature[index]) return false
  }
  return true
}

const svgFormat = (data: Uint8Array): RecognizedInputFormat | undefined => {
  let offset = startsWith(data, [0xef, 0xbb, 0xbf]) ? 3 : 0
  while (offset < data.byteLength) {
    const value = data[offset]
    if (value !== 0x09 && value !== 0x0a && value !== 0x0d && value !== 0x20) break
    offset += 1
  }
  const text = new TextDecoder('utf-8', { fatal: false })
    .decode(data.subarray(offset))
    .toLowerCase()
  const element = text.indexOf('<svg')
  if (element < 0) return undefined
  const terminator = text[element + 4]
  return terminator === '>' ||
    terminator === '/' ||
    terminator === ' ' ||
    terminator === '\t' ||
    terminator === '\r' ||
    terminator === '\n'
    ? { name: 'SVG' }
    : undefined
}

const isWebp = (data: Uint8Array): boolean =>
  startsWith(data, [82, 73, 70, 70]) && startsWith(data, [87, 69, 66, 80], 8)

const uint32BigEndian = (data: Uint8Array, offset: number): number =>
  ((data[offset] ?? 0) * 16_777_216 +
    (data[offset + 1] ?? 0) * 65_536 +
    (data[offset + 2] ?? 0) * 256 +
    (data[offset + 3] ?? 0)) >>>
  0

const fourCharacters = (data: Uint8Array, offset: number): string =>
  String.fromCharCode(
    data[offset] ?? 0,
    data[offset + 1] ?? 0,
    data[offset + 2] ?? 0,
    data[offset + 3] ?? 0,
  )

const isobmffBrands = (data: Uint8Array): readonly string[] => {
  if (data.byteLength < 16 || fourCharacters(data, 4) !== 'ftyp') return []
  const size32 = uint32BigEndian(data, 0)
  let contentOffset = 8
  let declaredSize = size32 === 0 ? data.byteLength : size32
  if (size32 === 1) {
    if (data.byteLength < 24) return []
    const high = uint32BigEndian(data, 8)
    const low = uint32BigEndian(data, 12)
    const extended = BigInt(high) * 0x1_0000_0000n + BigInt(low)
    if (extended > BigInt(Number.MAX_SAFE_INTEGER)) return []
    declaredSize = Number(extended)
    contentOffset = 16
  }
  const end = Math.min(data.byteLength, declaredSize)
  if (declaredSize < contentOffset + 8 || (end - contentOffset) % 4 !== 0) return []
  const brands = [fourCharacters(data, contentOffset)]
  for (let offset = contentOffset + 8; offset + 4 <= end; offset += 4) {
    brands.push(fourCharacters(data, offset))
  }
  return brands
}

const isobmffFormat = (data: Uint8Array): RecognizedInputFormat | undefined => {
  const brands = isobmffBrands(data)
  if (brands.some((brand) => brand === 'avif' || brand === 'avis')) {
    return { name: 'AVIF', registeredFormat: 'avif' }
  }
  const heifBrands = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'])
  return brands.some((brand) => heifBrands.has(brand))
    ? { name: 'HEIF/HEIC', registeredFormat: 'heif' }
    : undefined
}

const prefixedJpeg = (data: Uint8Array): RecognizedInputFormat | undefined => {
  const maximumOffset = Math.min(16, data.byteLength - 3)
  for (let offset = 1; offset <= maximumOffset; offset += 1) {
    if (!startsWith(data, [0xff, 0xd8, 0xff], offset)) continue
    return {
      name: 'JPEG',
      registeredFormat: 'jpeg',
      malformedMessage: `JPEG SOI marker starts at byte ${offset}; leading data is invalid`,
    }
  }
  return undefined
}

export const recognizeInputFormat = (data: Uint8Array): RecognizedInputFormat | undefined => {
  for (const format of magicFormats) {
    if (!format.signatures.some((signature) => startsWith(data, signature))) continue
    if (format.name === 'WebP' && !isWebp(data)) continue
    return format
  }
  return isobmffFormat(data) ?? prefixedJpeg(data) ?? svgFormat(data)
}
