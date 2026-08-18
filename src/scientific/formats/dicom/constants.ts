export const dicomPreambleLength = 128
export const dicomPrefix = 'DICM'
export const dicomPrefixLength = 4
export const dicomPart10HeaderLength = dicomPreambleLength + dicomPrefixLength

export const dicomUndefinedLength = 0xffff_ffff

export const dicomFileMetaGroup = 0x0002
export const dicomItemGroup = 0xfffe

export const dicomTag = Object.freeze({
  fileMetaInformationGroupLength: 0x0002_0000,
  fileMetaInformationVersion: 0x0002_0001,
  mediaStorageSopClassUid: 0x0002_0002,
  mediaStorageSopInstanceUid: 0x0002_0003,
  transferSyntaxUid: 0x0002_0010,
  implementationClassUid: 0x0002_0012,
  implementationVersionName: 0x0002_0013,
  sopClassUid: 0x0008_0016,
  sopInstanceUid: 0x0008_0018,
  modality: 0x0008_0060,
  samplesPerPixel: 0x0028_0002,
  photometricInterpretation: 0x0028_0004,
  planarConfiguration: 0x0028_0006,
  numberOfFrames: 0x0028_0008,
  rows: 0x0028_0010,
  columns: 0x0028_0011,
  pixelSpacing: 0x0028_0030,
  bitsAllocated: 0x0028_0100,
  bitsStored: 0x0028_0101,
  highBit: 0x0028_0102,
  pixelRepresentation: 0x0028_0103,
  windowCenter: 0x0028_1050,
  windowWidth: 0x0028_1051,
  rescaleIntercept: 0x0028_1052,
  rescaleSlope: 0x0028_1053,
  rescaleType: 0x0028_1054,
  windowCenterWidthExplanation: 0x0028_1055,
  voiLutFunction: 0x0028_1056,
  modalityLutSequence: 0x0028_3000,
  voiLutSequence: 0x0028_3010,
  imagePositionPatient: 0x0020_0032,
  imageOrientationPatient: 0x0020_0037,
  frameOfReferenceUid: 0x0020_0052,
  frameContentSequence: 0x0020_9111,
  planePositionSequence: 0x0020_9113,
  planeOrientationSequence: 0x0020_9116,
  pixelMeasuresSequence: 0x0028_9110,
  frameVoiLutSequence: 0x0028_9132,
  pixelValueTransformationSequence: 0x0028_9145,
  sharedFunctionalGroupsSequence: 0x5200_9229,
  perFrameFunctionalGroupsSequence: 0x5200_9230,
  extendedOffsetTable: 0x7fe0_0001,
  extendedOffsetTableLengths: 0x7fe0_0002,
  pixelData: 0x7fe0_0010,
  item: 0xfffe_e000,
  itemDelimitation: 0xfffe_e00d,
  sequenceDelimitation: 0xfffe_e0dd,
})

export const implicitVrLittleEndianUid = '1.2.840.10008.1.2'
export const explicitVrLittleEndianUid = '1.2.840.10008.1.2.1'
export const encapsulatedUncompressedExplicitVrLittleEndianUid = '1.2.840.10008.1.2.1.98'
export const rleLosslessUid = '1.2.840.10008.1.2.5'
export const jpegBaseline8BitUid = '1.2.840.10008.1.2.4.50'
export const jpegLosslessSv1Uid = '1.2.840.10008.1.2.4.70'
export const jpeg2000LosslessUid = '1.2.840.10008.1.2.4.90'
export const jpeg2000Uid = '1.2.840.10008.1.2.4.91'

export const dicomValueRepresentations = Object.freeze([
  'AE',
  'AS',
  'AT',
  'CS',
  'DA',
  'DS',
  'DT',
  'FD',
  'FL',
  'IS',
  'LO',
  'LT',
  'OB',
  'OD',
  'OF',
  'OL',
  'OV',
  'OW',
  'PN',
  'SH',
  'SL',
  'SQ',
  'SS',
  'ST',
  'SV',
  'TM',
  'UC',
  'UI',
  'UL',
  'UN',
  'UR',
  'US',
  'UT',
  'UV',
] as const)

export type DicomVr = (typeof dicomValueRepresentations)[number]

const vrSet = new Set<string>(dicomValueRepresentations)

export const isDicomVr = (value: string): value is DicomVr => vrSet.has(value)

/** Explicit VR codes that encode a 32-bit value length after a 16-bit reserved field. */
export const dicomLongValueLengthVrs: ReadonlySet<DicomVr> = new Set([
  'OB',
  'OD',
  'OF',
  'OL',
  'OV',
  'OW',
  'SQ',
  'SV',
  'UC',
  'UN',
  'UR',
  'UT',
  'UV',
])

export const dicomBinaryValueVrs: ReadonlySet<DicomVr> = new Set([
  'OB',
  'OD',
  'OF',
  'OL',
  'OV',
  'OW',
  'UN',
])

export const formatDicomTag = (tag: number): string => {
  const group = (tag >>> 16).toString(16).toUpperCase().padStart(4, '0')
  const element = (tag & 0xffff).toString(16).toUpperCase().padStart(4, '0')
  return `(${group},${element})`
}

export const parseDicomTagText = (value: string): number => {
  const match = /^([0-9A-Fa-f]{4}),([0-9A-Fa-f]{4})$/.exec(value)
  if (match === null || match[1] === undefined || match[2] === undefined) {
    throw new Error(`Invalid DICOM tag ${value}`)
  }
  return (Number.parseInt(match[1], 16) << 16) | Number.parseInt(match[2], 16)
}

export const dicomGroup = (tag: number): number => tag >>> 16

export const dicomElement = (tag: number): number => tag & 0xffff

export const isDicomPrivateTag = (tag: number): boolean => (dicomGroup(tag) & 1) === 1

export const isDicomDelimiterTag = (tag: number): boolean =>
  tag === dicomTag.item ||
  tag === dicomTag.itemDelimitation ||
  tag === dicomTag.sequenceDelimitation
