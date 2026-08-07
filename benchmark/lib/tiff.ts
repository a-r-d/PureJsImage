export interface TiffDimensions {
  type: 'tiff'
  width: number
  height: number
}

const readDimension = (
  view: DataView,
  entryOffset: number,
  littleEndian: boolean,
): number | undefined => {
  const fieldType = view.getUint16(entryOffset + 2, littleEndian)
  const count = view.getUint32(entryOffset + 4, littleEndian)
  if (count !== 1) return undefined

  if (fieldType === 3) return view.getUint16(entryOffset + 8, littleEndian)
  if (fieldType === 4) return view.getUint32(entryOffset + 8, littleEndian)
  return undefined
}

export const identifyClassicTiff = (bytes: Uint8Array): TiffDimensions | undefined => {
  if (bytes.byteLength < 14) return undefined

  const isLittleEndian = bytes[0] === 0x49 && bytes[1] === 0x49
  const isBigEndian = bytes[0] === 0x4d && bytes[1] === 0x4d
  if (!isLittleEndian && !isBigEndian) return undefined

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const littleEndian = isLittleEndian
  if (view.getUint16(2, littleEndian) !== 42) return undefined

  const ifdOffset = view.getUint32(4, littleEndian)
  if (ifdOffset > bytes.byteLength - 6) return undefined

  const entryCount = view.getUint16(ifdOffset, littleEndian)
  if (entryCount > Math.floor((bytes.byteLength - ifdOffset - 6) / 12)) return undefined

  let width: number | undefined
  let height: number | undefined
  for (let index = 0; index < entryCount; index += 1) {
    const entryOffset = ifdOffset + 2 + index * 12
    const tag = view.getUint16(entryOffset, littleEndian)
    if (tag === 256) width = readDimension(view, entryOffset, littleEndian)
    if (tag === 257) height = readDimension(view, entryOffset, littleEndian)
  }

  if (!width || !height) return undefined
  return { type: 'tiff', width, height }
}
