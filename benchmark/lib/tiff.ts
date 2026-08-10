export interface TiffDimensions {
  type: 'tiff'
  width: number
  height: number
}

const uint64Number = (
  view: DataView,
  offset: number,
  littleEndian: boolean,
): number | undefined => {
  if (offset < 0 || offset > view.byteLength - 8) return undefined
  const value = view.getBigUint64(offset, littleEndian)
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : undefined
}

export const identifyTiff = (bytes: Uint8Array): TiffDimensions | undefined => {
  if (bytes.byteLength < 14) return undefined

  const isLittleEndian = bytes[0] === 0x49 && bytes[1] === 0x49
  const isBigEndian = bytes[0] === 0x4d && bytes[1] === 0x4d
  if (!isLittleEndian && !isBigEndian) return undefined

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const littleEndian = isLittleEndian
  const version = view.getUint16(2, littleEndian)
  const bigTiff = version === 43
  if (version !== 42 && !bigTiff) return undefined
  if (
    bigTiff &&
    (bytes.byteLength < 24 ||
      view.getUint16(4, littleEndian) !== 8 ||
      view.getUint16(6, littleEndian) !== 0)
  ) {
    return undefined
  }

  const ifdOffset = bigTiff ? uint64Number(view, 8, littleEndian) : view.getUint32(4, littleEndian)
  if (ifdOffset === undefined) return undefined
  const countBytes = bigTiff ? 8 : 2
  const entryBytes = bigTiff ? 20 : 12
  const nextOffsetBytes = bigTiff ? 8 : 4
  if (ifdOffset < 0 || ifdOffset > bytes.byteLength - countBytes - nextOffsetBytes) {
    return undefined
  }

  const entryCount = bigTiff
    ? uint64Number(view, ifdOffset, littleEndian)
    : view.getUint16(ifdOffset, littleEndian)
  if (
    entryCount === undefined ||
    entryCount >
      Math.floor((bytes.byteLength - ifdOffset - countBytes - nextOffsetBytes) / entryBytes)
  ) {
    return undefined
  }

  let width: number | undefined
  let height: number | undefined
  for (let index = 0; index < entryCount; index += 1) {
    const entryOffset = ifdOffset + countBytes + index * entryBytes
    const tag = view.getUint16(entryOffset, littleEndian)
    if (tag !== 256 && tag !== 257) continue
    const fieldType = view.getUint16(entryOffset + 2, littleEndian)
    const count = bigTiff
      ? uint64Number(view, entryOffset + 4, littleEndian)
      : view.getUint32(entryOffset + 4, littleEndian)
    if (count !== 1) continue
    const valueOffset = entryOffset + (bigTiff ? 12 : 8)
    const value =
      fieldType === 3
        ? view.getUint16(valueOffset, littleEndian)
        : fieldType === 4
          ? view.getUint32(valueOffset, littleEndian)
          : fieldType === 16 && bigTiff
            ? uint64Number(view, valueOffset, littleEndian)
            : undefined
    if (tag === 256) width = value
    else height = value
  }

  if (!width || !height) return undefined
  return { type: 'tiff', width, height }
}
