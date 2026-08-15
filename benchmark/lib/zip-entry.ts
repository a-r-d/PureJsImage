import { inflateRawSync } from 'node:zlib'

const endOfCentralDirectorySignature = 0x0605_4b50
const centralDirectorySignature = 0x0201_4b50
const localFileSignature = 0x0403_4b50
const maximumCommentBytes = 65_535

const requireRange = (bytes: Uint8Array, offset: number, length: number, label: string): void => {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset > bytes.byteLength - length
  ) {
    throw new Error(`ZIP ${label} is truncated`)
  }
}

const findEndOfCentralDirectory = (bytes: Uint8Array, view: DataView): number => {
  const minimum = Math.max(0, bytes.byteLength - maximumCommentBytes - 22)
  for (let offset = bytes.byteLength - 22; offset >= minimum; offset -= 1) {
    if (view.getUint32(offset, true) === endOfCentralDirectorySignature) return offset
  }
  throw new Error('ZIP end-of-central-directory record is missing')
}

export const extractPinnedZipEntry = (
  archive: Uint8Array,
  entryName: string,
  maximumOutputBytes: number,
): Uint8Array<ArrayBuffer> => {
  if (entryName.length === 0 || entryName.includes('/') || entryName.includes('\\')) {
    throw new Error('ZIP entry name must be one plain filename')
  }
  if (!Number.isSafeInteger(maximumOutputBytes) || maximumOutputBytes < 1) {
    throw new Error('ZIP output limit must be a positive safe integer')
  }
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength)
  const end = findEndOfCentralDirectory(archive, view)
  requireRange(archive, end, 22, 'end-of-central-directory record')
  if (view.getUint16(end + 4, true) !== 0 || view.getUint16(end + 6, true) !== 0) {
    throw new Error('Multi-disk ZIP archives are unsupported')
  }
  const entries = view.getUint16(end + 10, true)
  const centralBytes = view.getUint32(end + 12, true)
  const centralOffset = view.getUint32(end + 16, true)
  if (entries === 0xffff || centralBytes === 0xffff_ffff || centralOffset === 0xffff_ffff) {
    throw new Error('ZIP64 archives are unsupported')
  }
  requireRange(archive, centralOffset, centralBytes, 'central directory')

  let cursor = centralOffset
  let match:
    | Readonly<{
        flags: number
        method: number
        compressedBytes: number
        outputBytes: number
        localOffset: number
      }>
    | undefined
  const decoder = new TextDecoder('utf-8', { fatal: true })
  for (let index = 0; index < entries; index += 1) {
    requireRange(archive, cursor, 46, 'central-directory entry')
    if (view.getUint32(cursor, true) !== centralDirectorySignature) {
      throw new Error('ZIP central-directory signature is invalid')
    }
    const flags = view.getUint16(cursor + 8, true)
    const method = view.getUint16(cursor + 10, true)
    const compressedBytes = view.getUint32(cursor + 20, true)
    const outputBytes = view.getUint32(cursor + 24, true)
    const nameBytes = view.getUint16(cursor + 28, true)
    const extraBytes = view.getUint16(cursor + 30, true)
    const commentBytes = view.getUint16(cursor + 32, true)
    const localOffset = view.getUint32(cursor + 42, true)
    const entryBytes = 46 + nameBytes + extraBytes + commentBytes
    requireRange(archive, cursor, entryBytes, 'central-directory entry')
    const name = decoder.decode(archive.subarray(cursor + 46, cursor + 46 + nameBytes))
    if (name === entryName) {
      if (match !== undefined)
        throw new Error(`ZIP entry ${JSON.stringify(entryName)} is duplicated`)
      match = Object.freeze({ flags, method, compressedBytes, outputBytes, localOffset })
    }
    cursor += entryBytes
  }
  if (cursor !== centralOffset + centralBytes)
    throw new Error('ZIP central-directory extent is invalid')
  if (match === undefined) throw new Error(`ZIP entry ${JSON.stringify(entryName)} is missing`)
  if ((match.flags & 1) !== 0) throw new Error('Encrypted ZIP entries are unsupported')
  if (match.method !== 0 && match.method !== 8)
    throw new Error(`ZIP compression method ${match.method} is unsupported`)
  if (match.outputBytes > maximumOutputBytes) {
    throw new Error(`ZIP entry exceeds ${maximumOutputBytes} output bytes`)
  }

  requireRange(archive, match.localOffset, 30, 'local-file header')
  if (view.getUint32(match.localOffset, true) !== localFileSignature) {
    throw new Error('ZIP local-file signature is invalid')
  }
  if (
    view.getUint16(match.localOffset + 6, true) !== match.flags ||
    view.getUint16(match.localOffset + 8, true) !== match.method
  ) {
    throw new Error('ZIP local and central headers disagree')
  }
  const localNameBytes = view.getUint16(match.localOffset + 26, true)
  const localExtraBytes = view.getUint16(match.localOffset + 28, true)
  requireRange(archive, match.localOffset + 30, localNameBytes + localExtraBytes, 'local-file name')
  const localName = decoder.decode(
    archive.subarray(match.localOffset + 30, match.localOffset + 30 + localNameBytes),
  )
  if (localName !== entryName) throw new Error('ZIP local and central names disagree')
  const payloadOffset = match.localOffset + 30 + localNameBytes + localExtraBytes
  requireRange(archive, payloadOffset, match.compressedBytes, 'entry payload')
  const compressed = archive.subarray(payloadOffset, payloadOffset + match.compressedBytes)
  const output =
    match.method === 0
      ? Uint8Array.from(compressed)
      : Uint8Array.from(inflateRawSync(compressed, { maxOutputLength: maximumOutputBytes }))
  if (output.byteLength !== match.outputBytes) throw new Error('ZIP entry length is invalid')
  return output
}
