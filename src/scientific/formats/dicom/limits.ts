import { invalidInput } from '../../../errors.ts'

export interface DicomLimits {
  readonly maxMetadataBytes: number
  readonly maxElementValueBytes: number
  readonly maxElements: number
  readonly maxSequenceDepth: number
  readonly maxSequenceItems: number
  readonly maxStringBytes: number
  readonly maxRows: number
  readonly maxColumns: number
  readonly maxFrames: number
  readonly maxFragments: number
  readonly maxEncodedFrameBytes: number
  readonly maxDecodedFrameBytes: number
  readonly maxOffsetTableBytes: number
  readonly maxLutEntries: number
}

export type DicomLimitOptions = Partial<DicomLimits>

export const defaultDicomLimits: Readonly<DicomLimits> = Object.freeze({
  maxMetadataBytes: 16_777_216,
  maxElementValueBytes: 1_048_576,
  maxElements: 100_000,
  maxSequenceDepth: 16,
  maxSequenceItems: 16_384,
  maxStringBytes: 65_536,
  maxRows: 65_536,
  maxColumns: 65_536,
  maxFrames: 16_384,
  maxFragments: 65_536,
  maxEncodedFrameBytes: 67_108_864,
  maxDecodedFrameBytes: 67_108_864,
  maxOffsetTableBytes: 4_194_304,
  maxLutEntries: 65_536,
})

const positiveInteger = (label: string, value: number): number => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw invalidInput(`${label} must be a positive safe integer`)
  }
  return value
}

export const resolveDicomLimits = (options: DicomLimitOptions = {}): Readonly<DicomLimits> =>
  Object.freeze({
    maxMetadataBytes: positiveInteger(
      'DICOM maxMetadataBytes',
      options.maxMetadataBytes ?? defaultDicomLimits.maxMetadataBytes,
    ),
    maxElementValueBytes: positiveInteger(
      'DICOM maxElementValueBytes',
      options.maxElementValueBytes ?? defaultDicomLimits.maxElementValueBytes,
    ),
    maxElements: positiveInteger(
      'DICOM maxElements',
      options.maxElements ?? defaultDicomLimits.maxElements,
    ),
    maxSequenceDepth: positiveInteger(
      'DICOM maxSequenceDepth',
      options.maxSequenceDepth ?? defaultDicomLimits.maxSequenceDepth,
    ),
    maxSequenceItems: positiveInteger(
      'DICOM maxSequenceItems',
      options.maxSequenceItems ?? defaultDicomLimits.maxSequenceItems,
    ),
    maxStringBytes: positiveInteger(
      'DICOM maxStringBytes',
      options.maxStringBytes ?? defaultDicomLimits.maxStringBytes,
    ),
    maxRows: positiveInteger('DICOM maxRows', options.maxRows ?? defaultDicomLimits.maxRows),
    maxColumns: positiveInteger(
      'DICOM maxColumns',
      options.maxColumns ?? defaultDicomLimits.maxColumns,
    ),
    maxFrames: positiveInteger(
      'DICOM maxFrames',
      options.maxFrames ?? defaultDicomLimits.maxFrames,
    ),
    maxFragments: positiveInteger(
      'DICOM maxFragments',
      options.maxFragments ?? defaultDicomLimits.maxFragments,
    ),
    maxEncodedFrameBytes: positiveInteger(
      'DICOM maxEncodedFrameBytes',
      options.maxEncodedFrameBytes ?? defaultDicomLimits.maxEncodedFrameBytes,
    ),
    maxDecodedFrameBytes: positiveInteger(
      'DICOM maxDecodedFrameBytes',
      options.maxDecodedFrameBytes ?? defaultDicomLimits.maxDecodedFrameBytes,
    ),
    maxOffsetTableBytes: positiveInteger(
      'DICOM maxOffsetTableBytes',
      options.maxOffsetTableBytes ?? defaultDicomLimits.maxOffsetTableBytes,
    ),
    maxLutEntries: positiveInteger(
      'DICOM maxLutEntries',
      options.maxLutEntries ?? defaultDicomLimits.maxLutEntries,
    ),
  })

export const addDicomSafe = (left: number, right: number, label: string): number => {
  const total = BigInt(left) + BigInt(right)
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw invalidInput(`DICOM ${label} exceeds the JavaScript safe integer range`)
  }
  return Number(total)
}

export const requireDicomSafeInteger = (value: number, label: string): number => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw invalidInput(`DICOM ${label} must be a non-negative safe integer`)
  }
  return value
}
