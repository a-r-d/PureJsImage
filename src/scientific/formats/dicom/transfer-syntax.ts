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

export const decodeDicomUid = (
  bytes: Uint8Array,
  label: string,
  options: { readonly conformance?: 'strict' | 'tolerant' } = {},
): string => {
  if (options.conformance === 'tolerant') {
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
  if (bytes.byteLength === 0) throw invalidInput(`DICOM ${label} is empty`)
  if (bytes.byteLength > 64) {
    throw invalidInput(`DICOM ${label} exceeds 64 bytes including padding`)
  }
  let end = bytes.byteLength
  if (bytes[end - 1] === 0x20) {
    throw invalidInput(`DICOM ${label} must not use SPACE padding`)
  }
  if (bytes[end - 1] === 0) {
    if (end > 1 && bytes[end - 2] === 0) {
      throw invalidInput(`DICOM ${label} has repeated trailing NULLs`)
    }
    if ((bytes.byteLength & 1) !== 0) {
      throw invalidInput(`DICOM ${label} NULL padding is not the even-length pad`)
    }
    end -= 1
    if ((end & 1) === 0) {
      throw invalidInput(`DICOM ${label} NULL padding is not required for an even-length UID`)
    }
  }
  if (end === 0) throw invalidInput(`DICOM ${label} is empty`)
  let uid = ''
  for (let index = 0; index < end; index += 1) {
    const code = bytes[index]
    if (code === 0) throw invalidInput(`DICOM ${label} contains an embedded NULL`)
    if (code === 0x20) throw invalidInput(`DICOM ${label} must not use SPACE padding`)
    if (code === undefined || code < 0x30 || code > 0x39) {
      if (code !== 0x2e) throw invalidInput(`DICOM ${label} is not a UID`)
    }
    uid += String.fromCharCode(code ?? 0)
  }
  const components = uid.split('.')
  if (components.length === 0 || components.some((component) => component.length === 0)) {
    throw invalidInput(`DICOM ${label} contains an empty component`)
  }
  for (const component of components) {
    if (!/^(?:0|[1-9][0-9]*)$/.test(component)) {
      throw invalidInput(`DICOM ${label} contains a leading zero`)
    }
  }
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
