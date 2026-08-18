import {
  type DicomVr,
  dicomLongValueLengthVrs,
  dicomPreambleLength,
  dicomTag,
  dicomUndefinedLength,
  explicitVrLittleEndianUid,
  implicitVrLittleEndianUid,
  isDicomDelimiterTag,
  isDicomVr,
} from '../../src/scientific/formats/dicom/constants.ts'
import {
  lookupDicomDictionary,
  resolveImplicitVr,
} from '../../src/scientific/formats/dicom/dictionary.ts'

export type DicomWriteTransferSyntax = 'explicit-vr-le' | 'implicit-vr-le'

export interface DicomWriteElement {
  readonly tag: number
  readonly vr?: DicomVr
  readonly value?: Uint8Array
  readonly items?: readonly (readonly DicomWriteElement[])[]
  readonly fragments?: readonly Uint8Array[]
  readonly undefinedLength?: boolean
  readonly nestedExplicitVr?: boolean
  readonly forceLength?: number
  readonly rawHeader?: Uint8Array
}

export interface DicomWriteOptions {
  readonly transferSyntax: DicomWriteTransferSyntax
  readonly transferSyntaxUid?: string
  readonly preamble?: Uint8Array
  readonly includeDicomPrefix?: boolean
  readonly fileMeta?: readonly DicomWriteElement[]
  readonly rawFileMeta?: Uint8Array
  readonly fileMetaGroupLength?: number
  readonly omitFileMetaGroupLength?: boolean
  readonly omitTransferSyntax?: boolean
  readonly dataset: readonly DicomWriteElement[]
}

const uidBytes = (value: string): Uint8Array => {
  const raw = new TextEncoder().encode(value)
  if ((raw.byteLength & 1) === 0) return raw
  const padded = new Uint8Array(raw.byteLength + 1)
  padded.set(raw)
  return padded
}

const writeUint16 = (output: number[], value: number): void => {
  output.push(value & 0xff, (value >>> 8) & 0xff)
}

const writeUint32 = (output: number[], value: number): void => {
  output.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff)
}

const writeTag = (output: number[], tag: number): void => {
  writeUint16(output, tag >>> 16)
  writeUint16(output, tag & 0xffff)
}

const padEven = (value: Uint8Array): Uint8Array => {
  if ((value.byteLength & 1) === 0) return value
  const padded = new Uint8Array(value.byteLength + 1)
  padded.set(value)
  return padded
}

const resolveVr = (element: DicomWriteElement, explicitVr: boolean): DicomVr | undefined => {
  if (element.vr !== undefined) return element.vr
  if (isDicomDelimiterTag(element.tag)) return undefined
  if (element.items !== undefined) return 'SQ'
  const implicit = resolveImplicitVr(element.tag)
  if (implicit !== undefined) return implicit
  if (explicitVr)
    throw new Error(`Test DICOM writer needs a VR for tag ${element.tag.toString(16)}`)
  return undefined
}

const appendBytes = (output: number[], bytes: Uint8Array): void => {
  for (let index = 0; index < bytes.byteLength; index += 1) output.push(bytes[index] ?? 0)
}

const writeDataset = (
  output: number[],
  elements: readonly DicomWriteElement[],
  explicitVr: boolean,
): void => {
  for (const element of elements) {
    if (element.rawHeader !== undefined) {
      appendBytes(output, element.rawHeader)
      if (element.value !== undefined) appendBytes(output, element.value)
      continue
    }
    writeTag(output, element.tag)
    if (isDicomDelimiterTag(element.tag)) {
      writeUint32(
        output,
        element.forceLength ?? (element.undefinedLength === true ? dicomUndefinedLength : 0),
      )
      continue
    }
    const vr = resolveVr(element, explicitVr)
    if (element.fragments !== undefined) {
      if (explicitVr) {
        if (vr === undefined || !isDicomVr(vr)) {
          throw new Error(`Explicit VR test element ${element.tag.toString(16)} is missing a VR`)
        }
        output.push(vr.charCodeAt(0), vr.charCodeAt(1))
        writeUint16(output, 0)
        writeUint32(output, dicomUndefinedLength)
      } else {
        writeUint32(output, dicomUndefinedLength)
      }
      for (const fragment of element.fragments) {
        const padded = padEven(fragment)
        writeTag(output, dicomTag.item)
        writeUint32(output, padded.byteLength)
        appendBytes(output, padded)
      }
      writeTag(output, dicomTag.sequenceDelimitation)
      writeUint32(output, 0)
      continue
    }
    const childBytes: number[] = []
    if (element.items !== undefined) {
      const nestedExplicit =
        element.nestedExplicitVr ??
        (element.vr === 'UN' && element.undefinedLength === true ? false : explicitVr)
      for (const item of element.items) {
        writeTag(childBytes, dicomTag.item)
        if (element.undefinedLength === true) {
          writeUint32(childBytes, dicomUndefinedLength)
          writeDataset(childBytes, item, nestedExplicit)
          writeTag(childBytes, dicomTag.itemDelimitation)
          writeUint32(childBytes, 0)
        } else {
          const itemBytes: number[] = []
          writeDataset(itemBytes, item, nestedExplicit)
          writeUint32(childBytes, itemBytes.length)
          childBytes.push(...itemBytes)
        }
      }
      if (element.undefinedLength === true) {
        writeTag(childBytes, dicomTag.sequenceDelimitation)
        writeUint32(childBytes, 0)
      }
    }
    const value =
      element.items !== undefined
        ? Uint8Array.from(childBytes)
        : padEven(element.value ?? new Uint8Array())
    const length =
      element.forceLength ??
      (element.undefinedLength === true ? dicomUndefinedLength : value.byteLength)
    if (explicitVr) {
      if (vr === undefined || !isDicomVr(vr)) {
        throw new Error(`Explicit VR test element ${element.tag.toString(16)} is missing a VR`)
      }
      output.push(vr.charCodeAt(0), vr.charCodeAt(1))
      if (dicomLongValueLengthVrs.has(vr)) {
        writeUint16(output, 0)
        writeUint32(output, length)
      } else {
        writeUint16(output, length)
      }
    } else {
      writeUint32(output, length)
    }
    appendBytes(output, value)
  }
}

const defaultFileMeta = (
  transferSyntaxUid: string,
  omitTransferSyntax: boolean,
): DicomWriteElement[] => {
  const elements: DicomWriteElement[] = [
    {
      tag: dicomTag.fileMetaInformationVersion,
      vr: 'OB',
      value: Uint8Array.of(0, 1),
    },
    {
      tag: dicomTag.mediaStorageSopClassUid,
      vr: 'UI',
      value: uidBytes('1.2.840.10008.5.1.4.1.1.7'),
    },
    {
      tag: dicomTag.mediaStorageSopInstanceUid,
      vr: 'UI',
      value: uidBytes('1.2.826.0.1.3680043.10.850.1.1'),
    },
  ]
  if (!omitTransferSyntax) {
    elements.push({
      tag: dicomTag.transferSyntaxUid,
      vr: 'UI',
      value: uidBytes(transferSyntaxUid),
    })
  }
  elements.push(
    {
      tag: dicomTag.implementationClassUid,
      vr: 'UI',
      value: uidBytes('1.2.826.0.1.3680043.10.850.1'),
    },
    {
      tag: dicomTag.implementationVersionName,
      vr: 'SH',
      value: uidBytes('PUREJSIMAGE_TEST'),
    },
  )
  return elements
}

export const writeDicomPart10 = (options: Readonly<DicomWriteOptions>): Uint8Array => {
  const explicitDataset = options.transferSyntax === 'explicit-vr-le'
  const transferSyntaxUid =
    options.transferSyntaxUid ??
    (explicitDataset ? explicitVrLittleEndianUid : implicitVrLittleEndianUid)
  const output: number[] = []
  const preamble = options.preamble ?? new Uint8Array(dicomPreambleLength)
  if (preamble.byteLength !== dicomPreambleLength) {
    throw new Error('DICOM preamble must be 128 bytes')
  }
  appendBytes(output, preamble)
  if (options.includeDicomPrefix !== false) {
    output.push(0x44, 0x49, 0x43, 0x4d)
  }
  if (options.rawFileMeta !== undefined) {
    appendBytes(output, options.rawFileMeta)
    writeDataset(output, options.dataset, explicitDataset)
    return Uint8Array.from(output)
  }
  const fileMetaSource =
    options.fileMeta ?? defaultFileMeta(transferSyntaxUid, options.omitTransferSyntax === true)
  const fileMetaBody: number[] = []
  writeDataset(fileMetaBody, fileMetaSource, true)
  if (options.omitFileMetaGroupLength !== true) {
    writeTag(output, dicomTag.fileMetaInformationGroupLength)
    output.push(0x55, 0x4c)
    writeUint16(output, 4)
    writeUint32(output, options.fileMetaGroupLength ?? fileMetaBody.length)
  }
  output.push(...fileMetaBody)
  writeDataset(output, options.dataset, explicitDataset)
  return Uint8Array.from(output)
}

export const dicomTextBytes = (value: string): Uint8Array => uidBytes(value)

export const dicomTestSopClassUid = '1.2.840.10008.5.1.4.1.1.7'
export const dicomTestSopInstanceUid = '1.2.826.0.1.3680043.10.850.1.1'

export const dicomIdentityElements = (
  sopInstanceUid = dicomTestSopInstanceUid,
): DicomWriteElement[] => [
  { tag: dicomTag.sopClassUid, vr: 'UI', value: dicomTextBytes(dicomTestSopClassUid) },
  { tag: dicomTag.sopInstanceUid, vr: 'UI', value: dicomTextBytes(sopInstanceUid) },
]

export const dicomMonochromePixelElements = (options: {
  readonly rows: number
  readonly columns: number
  readonly bitsAllocated: 8 | 16
  readonly bitsStored?: number
  readonly signed?: boolean
  readonly photometric?: 'MONOCHROME1' | 'MONOCHROME2'
  readonly samplesPerPixel?: number
}): DicomWriteElement[] => {
  const bitsStored = options.bitsStored ?? options.bitsAllocated
  return [
    {
      tag: dicomTag.samplesPerPixel,
      vr: 'US',
      value: dicomUInt16Bytes(options.samplesPerPixel ?? 1),
    },
    {
      tag: dicomTag.photometricInterpretation,
      vr: 'CS',
      value: dicomTextBytes(options.photometric ?? 'MONOCHROME2'),
    },
    { tag: dicomTag.rows, vr: 'US', value: dicomUInt16Bytes(options.rows) },
    { tag: dicomTag.columns, vr: 'US', value: dicomUInt16Bytes(options.columns) },
    { tag: dicomTag.bitsAllocated, vr: 'US', value: dicomUInt16Bytes(options.bitsAllocated) },
    { tag: dicomTag.bitsStored, vr: 'US', value: dicomUInt16Bytes(bitsStored) },
    { tag: dicomTag.highBit, vr: 'US', value: dicomUInt16Bytes(bitsStored - 1) },
    {
      tag: dicomTag.pixelRepresentation,
      vr: 'US',
      value: dicomUInt16Bytes(options.signed === true ? 1 : 0),
    },
  ]
}

export const dicomUInt16Bytes = (...values: readonly number[]): Uint8Array => {
  const bytes = new Uint8Array(values.length * 2)
  const view = new DataView(bytes.buffer)
  for (let index = 0; index < values.length; index += 1)
    view.setUint16(index * 2, values[index] ?? 0, true)
  return bytes
}

export const dicomInt16Bytes = (...values: readonly number[]): Uint8Array => {
  const bytes = new Uint8Array(values.length * 2)
  const view = new DataView(bytes.buffer)
  for (let index = 0; index < values.length; index += 1)
    view.setInt16(index * 2, values[index] ?? 0, true)
  return bytes
}

export const dicomDecimalBytes = (...values: readonly number[]): Uint8Array =>
  dicomTextBytes(values.map((value) => String(value)).join('\\'))

export const dicomUInt32Bytes = (...values: readonly number[]): Uint8Array => {
  const bytes = new Uint8Array(values.length * 4)
  const view = new DataView(bytes.buffer)
  for (let index = 0; index < values.length; index += 1)
    view.setUint32(index * 4, values[index] ?? 0, true)
  return bytes
}

export const dicomUInt64Bytes = (...values: readonly number[]): Uint8Array => {
  const bytes = new Uint8Array(values.length * 8)
  const view = new DataView(bytes.buffer)
  for (let index = 0; index < values.length; index += 1)
    view.setBigUint64(index * 8, BigInt(values[index] ?? 0), true)
  return bytes
}

export const dicomEncapsulatedFragments = (
  frames: readonly (readonly Uint8Array[])[],
  offsetTable: 'empty' | 'basic',
): readonly Uint8Array[] => {
  const paddedFrames = frames.map((frame) => frame.map((fragment) => padEven(fragment)))
  const pixelFragments = paddedFrames.flat()
  if (offsetTable === 'empty') return [new Uint8Array(), ...pixelFragments]
  const offsets: number[] = []
  let position = 0
  for (const frame of paddedFrames) {
    offsets.push(position)
    for (const fragment of frame) position += 8 + fragment.byteLength
  }
  return [dicomUInt32Bytes(...offsets), ...pixelFragments]
}

export const knownDictionaryKeyword = (tag: number): string | undefined =>
  lookupDicomDictionary(tag).entry?.keyword
