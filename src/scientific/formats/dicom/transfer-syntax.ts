import { invalidInput, unsupportedOperation } from '../../../errors.ts'
import {
  encapsulatedUncompressedExplicitVrLittleEndianUid,
  explicitVrLittleEndianUid,
  implicitVrLittleEndianUid,
  jpeg2000LosslessUid,
  jpeg2000Uid,
  jpegBaseline8BitUid,
  jpegLosslessSv1Uid,
  rleLosslessUid,
} from './constants.ts'

export type DicomTransferSyntaxKind =
  | 'implicit-vr-little-endian'
  | 'explicit-vr-little-endian'
  | 'encapsulated-uncompressed-explicit-vr-little-endian'
  | 'rle-lossless'
  | 'jpeg-baseline-8bit'
  | 'jpeg-lossless-sv1'
  | 'jpeg2000-lossless'
  | 'jpeg2000'

export interface DicomTransferSyntax {
  readonly uid: string
  readonly kind: DicomTransferSyntaxKind
  readonly explicitVr: boolean
  readonly littleEndian: true
  readonly encapsulated: boolean
}

export const implicitVrLittleEndian: Readonly<DicomTransferSyntax> = Object.freeze({
  uid: implicitVrLittleEndianUid,
  kind: 'implicit-vr-little-endian',
  explicitVr: false,
  littleEndian: true,
  encapsulated: false,
})

export const explicitVrLittleEndian: Readonly<DicomTransferSyntax> = Object.freeze({
  uid: explicitVrLittleEndianUid,
  kind: 'explicit-vr-little-endian',
  explicitVr: true,
  littleEndian: true,
  encapsulated: false,
})

export const encapsulatedUncompressedExplicitVrLittleEndian: Readonly<DicomTransferSyntax> =
  Object.freeze({
    uid: encapsulatedUncompressedExplicitVrLittleEndianUid,
    kind: 'encapsulated-uncompressed-explicit-vr-little-endian',
    explicitVr: true,
    littleEndian: true,
    encapsulated: true,
  })

export const rleLossless: Readonly<DicomTransferSyntax> = Object.freeze({
  uid: rleLosslessUid,
  kind: 'rle-lossless',
  explicitVr: true,
  littleEndian: true,
  encapsulated: true,
})

export const jpegBaseline8Bit: Readonly<DicomTransferSyntax> = Object.freeze({
  uid: jpegBaseline8BitUid,
  kind: 'jpeg-baseline-8bit',
  explicitVr: true,
  littleEndian: true,
  encapsulated: true,
})

export const jpegLosslessSv1: Readonly<DicomTransferSyntax> = Object.freeze({
  uid: jpegLosslessSv1Uid,
  kind: 'jpeg-lossless-sv1',
  explicitVr: true,
  littleEndian: true,
  encapsulated: true,
})

export const jpeg2000Lossless: Readonly<DicomTransferSyntax> = Object.freeze({
  uid: jpeg2000LosslessUid,
  kind: 'jpeg2000-lossless',
  explicitVr: true,
  littleEndian: true,
  encapsulated: true,
})

export const jpeg2000: Readonly<DicomTransferSyntax> = Object.freeze({
  uid: jpeg2000Uid,
  kind: 'jpeg2000',
  explicitVr: true,
  littleEndian: true,
  encapsulated: true,
})

export const decodeDicomUid = (bytes: Uint8Array, label: string): string => {
  let end = bytes.byteLength
  while (end > 0 && (bytes[end - 1] === 0 || bytes[end - 1] === 0x20)) end -= 1
  if (end === 0) throw invalidInput(`DICOM ${label} is empty`)
  let uid = ''
  for (let index = 0; index < end; index += 1) {
    const code = bytes[index]
    if (code === undefined || code < 0x20 || code > 0x7e) {
      throw invalidInput(`DICOM ${label} contains a non-ASCII byte`)
    }
    uid += String.fromCharCode(code)
  }
  if (!/^[0-9]+(?:\.[0-9]+)*$/.test(uid)) throw invalidInput(`DICOM ${label} is not a UID`)
  return uid
}

export const resolveDicomTransferSyntax = (uid: string): DicomTransferSyntax => {
  if (uid === implicitVrLittleEndianUid) return implicitVrLittleEndian
  if (uid === explicitVrLittleEndianUid) return explicitVrLittleEndian
  if (uid === encapsulatedUncompressedExplicitVrLittleEndianUid) {
    return encapsulatedUncompressedExplicitVrLittleEndian
  }
  if (uid === rleLosslessUid) return rleLossless
  if (uid === jpegBaseline8BitUid) return jpegBaseline8Bit
  if (uid === jpegLosslessSv1Uid) return jpegLosslessSv1
  if (uid === jpeg2000LosslessUid) return jpeg2000Lossless
  if (uid === jpeg2000Uid) return jpeg2000
  throw unsupportedOperation(`DICOM transfer syntax ${uid} is unsupported`)
}
