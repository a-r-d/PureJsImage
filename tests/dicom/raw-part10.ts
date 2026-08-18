import {
  dicomTag,
  dicomUndefinedLength,
  encapsulatedUncompressedExplicitVrLittleEndianUid,
  explicitVrLittleEndianUid,
} from '../../src/scientific/formats/dicom/constants.ts'

const encoder = new TextEncoder()

export const writeUint16Le = (output: number[], value: number): void => {
  output.push(value & 0xff, (value >>> 8) & 0xff)
}

export const writeUint32Le = (output: number[], value: number): void => {
  output.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff)
}

export const writeDicomTagLe = (output: number[], tag: number): void => {
  writeUint16Le(output, tag >>> 16)
  writeUint16Le(output, tag & 0xffff)
}

export const writeExplicitElement = (
  output: number[],
  tag: number,
  vr: string,
  value: Uint8Array,
  valueLength = value.byteLength,
): void => {
  writeDicomTagLe(output, tag)
  output.push(vr.charCodeAt(0), vr.charCodeAt(1))
  if (vr === 'OB' || vr === 'OW' || vr === 'UN' || vr === 'SQ' || vr === 'UT' || vr === 'OV') {
    writeUint16Le(output, 0)
    writeUint32Le(output, valueLength)
  } else if (
    vr === 'UL' ||
    vr === 'US' ||
    vr === 'UI' ||
    vr === 'CS' ||
    vr === 'DS' ||
    vr === 'IS'
  ) {
    if (vr === 'UL') writeUint16Le(output, 4)
    else writeUint16Le(output, valueLength)
  } else {
    writeUint16Le(output, valueLength)
  }
  for (let index = 0; index < value.byteLength; index += 1) output.push(value[index] ?? 0)
}

export const writeImplicitElement = (
  output: number[],
  tag: number,
  value: Uint8Array,
  valueLength = value.byteLength,
): void => {
  writeDicomTagLe(output, tag)
  writeUint32Le(output, valueLength)
  for (let index = 0; index < value.byteLength; index += 1) output.push(value[index] ?? 0)
}

export const writeUint64Le = (output: number[], value: number): void => {
  writeUint32Le(output, value >>> 0)
  writeUint32Le(output, Math.floor(value / 0x1_0000_0000))
}

export const writeFragmentItem = (output: number[], payload: Uint8Array): void => {
  writeDicomTagLe(output, dicomTag.item)
  writeUint32Le(output, payload.byteLength)
  for (let index = 0; index < payload.byteLength; index += 1) output.push(payload[index] ?? 0)
}

export const writeSequenceDelimitation = (output: number[]): void => {
  writeDicomTagLe(output, dicomTag.sequenceDelimitation)
  writeUint32Le(output, 0)
}

export const writeUidBytes = (value: string): Uint8Array => {
  const raw = encoder.encode(value)
  if ((raw.byteLength & 1) === 0) return raw
  const padded = new Uint8Array(raw.byteLength + 1)
  padded.set(raw)
  return padded
}

export const defaultTestSopClassUid = '1.2.840.10008.5.1.4.1.1.7'
export const defaultTestSopInstanceUid = '1.2.826.0.1.3680043.10.850.1.1'
export const defaultTestImplementationClassUid = '1.2.826.0.1.3680043.10.850.1'

export const writeRawPart10Preamble = (output: number[]): void => {
  for (let index = 0; index < 128; index += 1) output.push(0)
  output.push(0x44, 0x49, 0x43, 0x4d)
}

export const writeRawFileMeta = (
  output: number[],
  transferSyntaxUid: string = explicitVrLittleEndianUid,
): void => {
  const body: number[] = []
  writeExplicitElement(body, dicomTag.fileMetaInformationVersion, 'OB', Uint8Array.of(0, 1))
  writeExplicitElement(
    body,
    dicomTag.mediaStorageSopClassUid,
    'UI',
    writeUidBytes(defaultTestSopClassUid),
  )
  writeExplicitElement(
    body,
    dicomTag.mediaStorageSopInstanceUid,
    'UI',
    writeUidBytes(defaultTestSopInstanceUid),
  )
  writeExplicitElement(body, dicomTag.transferSyntaxUid, 'UI', writeUidBytes(transferSyntaxUid))
  writeExplicitElement(
    body,
    dicomTag.implementationClassUid,
    'UI',
    writeUidBytes(defaultTestImplementationClassUid),
  )
  writeDicomTagLe(output, dicomTag.fileMetaInformationGroupLength)
  output.push(0x55, 0x4c)
  writeUint16Le(output, 4)
  writeUint32Le(output, body.length)
  output.push(...body)
}

export const writeUndefinedLengthOb = (output: number[], tag: number): void => {
  writeDicomTagLe(output, tag)
  output.push(0x4f, 0x42)
  writeUint16Le(output, 0)
  writeUint32Le(output, dicomUndefinedLength)
}

export const writeUndefinedLengthUn = (output: number[], tag: number): void => {
  writeDicomTagLe(output, tag)
  output.push(0x55, 0x4e)
  writeUint16Le(output, 0)
  writeUint32Le(output, dicomUndefinedLength)
}

export const writeItemStart = (output: number[], length = dicomUndefinedLength): void => {
  writeDicomTagLe(output, dicomTag.item)
  writeUint32Le(output, length)
}

export const writeItemDelimitation = (output: number[]): void => {
  writeDicomTagLe(output, dicomTag.itemDelimitation)
  writeUint32Le(output, 0)
}

const writeUInt16Element = (output: number[], tag: number, value: number): void => {
  writeExplicitElement(output, tag, 'US', Uint8Array.of(value & 0xff, (value >>> 8) & 0xff))
}

export const writeRawGrayscaleIdentity = (
  output: number[],
  options: {
    readonly rows: number
    readonly columns: number
    readonly bitsAllocated?: 8 | 16
    readonly bitsStored?: number
    readonly frames?: number
    readonly signed?: boolean
  },
): void => {
  const bitsAllocated = options.bitsAllocated ?? 8
  const bitsStored = options.bitsStored ?? bitsAllocated
  writeExplicitElement(output, dicomTag.sopClassUid, 'UI', writeUidBytes(defaultTestSopClassUid))
  writeExplicitElement(
    output,
    dicomTag.sopInstanceUid,
    'UI',
    writeUidBytes(defaultTestSopInstanceUid),
  )
  writeExplicitElement(output, dicomTag.samplesPerPixel, 'US', Uint8Array.of(1, 0))
  writeExplicitElement(
    output,
    dicomTag.photometricInterpretation,
    'CS',
    writeUidBytes('MONOCHROME2'),
  )
  if (options.frames !== undefined) {
    writeExplicitElement(
      output,
      dicomTag.numberOfFrames,
      'IS',
      writeUidBytes(String(options.frames)),
    )
  }
  writeUInt16Element(output, dicomTag.rows, options.rows)
  writeUInt16Element(output, dicomTag.columns, options.columns)
  writeUInt16Element(output, dicomTag.bitsAllocated, bitsAllocated)
  writeUInt16Element(output, dicomTag.bitsStored, bitsStored)
  writeUInt16Element(output, dicomTag.highBit, bitsStored - 1)
  writeUInt16Element(output, dicomTag.pixelRepresentation, options.signed === true ? 1 : 0)
}

export const writeRawEncapsulatedPixelData = (
  output: number[],
  fragments: readonly Uint8Array[],
): void => {
  writeUndefinedLengthOb(output, dicomTag.pixelData)
  for (const fragment of fragments) writeFragmentItem(output, fragment)
  writeSequenceDelimitation(output)
}

export const writeRawExtendedOffsetTable = (
  output: number[],
  offsets: readonly number[],
  lengths?: readonly number[],
): void => {
  const offsetBytes: number[] = []
  for (const offset of offsets) writeUint64Le(offsetBytes, offset)
  writeExplicitElement(output, dicomTag.extendedOffsetTable, 'OV', Uint8Array.from(offsetBytes))
  if (lengths === undefined) return
  const lengthBytes: number[] = []
  for (const length of lengths) writeUint64Le(lengthBytes, length)
  writeExplicitElement(
    output,
    dicomTag.extendedOffsetTableLengths,
    'OV',
    Uint8Array.from(lengthBytes),
  )
}

export const writeRawPart10Bytes = (
  transferSyntaxUid: string,
  writeDataset: (output: number[]) => void,
): Uint8Array => {
  const output: number[] = []
  writeRawPart10Preamble(output)
  writeRawFileMeta(output, transferSyntaxUid)
  writeDataset(output)
  return Uint8Array.from(output)
}

export { encapsulatedUncompressedExplicitVrLittleEndianUid }
