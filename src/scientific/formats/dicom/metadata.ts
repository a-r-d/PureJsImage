import { invalidInput, unsupportedOperation } from '../../../errors.ts'
import { dicomTag } from './constants.ts'
import {
  type DicomDataset,
  type DicomElement,
  collectDicomElements,
  decodeDicomText,
  requireUniqueDicomElement,
} from './elements.ts'
import type { DicomFileMetaInformation } from './file-meta.ts'
import {
  type DicomImageOrientationPatient,
  type DicomImagePositionPatient,
  type DicomPixelSpacingMm,
  dicomNumberTupleEqual,
  dicomPixelSpacingEqual,
  parseDicomImageOrientationPatient,
  parseDicomImagePositionPatient,
  parseDicomPerFrameFunctionalGroups,
  parseDicomPixelSpacing,
  parseDicomSharedFunctionalGroup,
  resolveDicomHomogeneousValue,
  validateDicomPixelSpacing,
} from './functional-groups.ts'
import type { DicomPixelDescription } from './pixel-description.ts'
import {
  type DicomStoredValueTransform,
  type DicomVoiPreset,
  dicomStoredValueTransformsEqual,
  dicomVoiPresetsEqual,
  parseDicomStoredValueTransform,
  parseDicomVoiPresets,
} from './presentation.ts'
import { decodeDicomUid } from './transfer-syntax.ts'

export interface DicomTechnicalMetadata {
  readonly sopClassUid: string
  readonly sopInstanceUid?: string
  readonly transferSyntaxUid: string
  readonly modality?: string
  readonly rows: number
  readonly columns: number
  readonly numberOfFrames: number
  readonly samplesPerPixel: number
  readonly photometricInterpretation: string
  readonly bitsAllocated: number
  readonly bitsStored: number
  readonly highBit: number
  readonly pixelRepresentation: 'unsigned' | 'signed'
  readonly pixelSpacingMm?: DicomPixelSpacingMm
  readonly storedValueTransform?: DicomStoredValueTransform
  readonly storedValueTransformConflict?: 'inhomogeneous'
  readonly voiPresets?: readonly DicomVoiPreset[]
  readonly voiPresetConflict?: 'inhomogeneous'
  readonly monochromeInverted: boolean
  readonly imagePositionPatient?: DicomImagePositionPatient
  readonly imageOrientationPatient?: DicomImageOrientationPatient
  readonly frameOfReferenceUid?: string
}

export type {
  DicomImageOrientationPatient,
  DicomImagePositionPatient,
  DicomPixelSpacingMm,
} from './functional-groups.ts'
export type {
  DicomStoredValueTransform,
  DicomVoiLutFunction,
  DicomVoiPreset,
} from './presentation.ts'

const optionalText = (dataset: DicomDataset, tag: number, label: string): string | undefined => {
  const matches = collectDicomElements(dataset.elements, tag)
  if (matches.length > 1) throw invalidInput(`DICOM ${label} is duplicated`)
  const value = matches[0]?.value
  return value === undefined ? undefined : decodeDicomText(value)
}

const optionalUid = (dataset: DicomDataset, tag: number, label: string): string | undefined => {
  const matches = collectDicomElements(dataset.elements, tag)
  if (matches.length > 1) throw invalidInput(`DICOM ${label} is duplicated`)
  const value = matches[0]?.value
  return value === undefined ? undefined : decodeDicomUid(value, label)
}

const requiredDatasetUid = (dataset: DicomDataset, tag: number, label: string): string => {
  const element = requireUniqueDicomElement(dataset.elements, tag, label)
  if (element.value === undefined) throw invalidInput(`DICOM ${label} value was not materialized`)
  return decodeDicomUid(element.value, label)
}

const datasetContainsTag = (elements: readonly DicomElement[], tag: number): boolean => {
  for (const element of elements) {
    if (element.tag === tag) return true
    if (element.sequence !== undefined) {
      for (const item of element.sequence.items) {
        if (datasetContainsTag(item.elements, tag)) return true
      }
    }
  }
  return false
}

const rejectUnsupportedLuts = (dataset: DicomDataset): void => {
  if (datasetContainsTag(dataset.elements, dicomTag.modalityLutSequence)) {
    throw unsupportedOperation('DICOM Modality LUT Sequence is unsupported')
  }
  if (datasetContainsTag(dataset.elements, dicomTag.voiLutSequence)) {
    throw unsupportedOperation('DICOM VOI LUT Sequence is unsupported')
  }
}

const resolvedValue = <T>(
  resolution: ReturnType<typeof resolveDicomHomogeneousValue<T>>,
): T | undefined => (resolution.status === 'value' ? resolution.value : undefined)

export const createDicomTechnicalMetadata = (
  fileMeta: DicomFileMetaInformation,
  dataset: DicomDataset,
  pixels: DicomPixelDescription,
): DicomTechnicalMetadata => {
  rejectUnsupportedLuts(dataset)
  const sopClassUid = requiredDatasetUid(dataset, dicomTag.sopClassUid, 'SOP Class UID')
  const sopInstanceUid = requiredDatasetUid(dataset, dicomTag.sopInstanceUid, 'SOP Instance UID')
  if (
    fileMeta.mediaStorageSopClassUid !== undefined &&
    fileMeta.mediaStorageSopClassUid !== sopClassUid
  ) {
    throw invalidInput('DICOM Media Storage SOP Class UID does not match SOP Class UID')
  }
  if (
    fileMeta.mediaStorageSopInstanceUid !== undefined &&
    fileMeta.mediaStorageSopInstanceUid !== sopInstanceUid
  ) {
    throw invalidInput('DICOM Media Storage SOP Instance UID does not match SOP Instance UID')
  }
  const modality = optionalText(dataset, dicomTag.modality, 'Modality')
  const frameOfReferenceUid = optionalUid(
    dataset,
    dicomTag.frameOfReferenceUid,
    'Frame of Reference UID',
  )
  const shared = parseDicomSharedFunctionalGroup(dataset)
  const perFrame = parseDicomPerFrameFunctionalGroups(dataset, pixels.numberOfFrames)
  const storedValueTransform = resolveDicomHomogeneousValue(
    parseDicomStoredValueTransform(dataset.elements),
    shared?.storedValueTransform,
    perFrame.map((group) => group.storedValueTransform),
    dicomStoredValueTransformsEqual,
  )
  const voiPresets = resolveDicomHomogeneousValue(
    parseDicomVoiPresets(dataset.elements),
    shared?.voiPresets,
    perFrame.map((group) => group.voiPresets),
    dicomVoiPresetsEqual,
  )
  const pixelSpacingTopLevel = parseDicomPixelSpacing(dataset.elements)
  const pixelSpacingShared = shared?.pixelSpacingMm
  const pixelSpacingPerFrame = perFrame.map((group) => group.pixelSpacingMm)
  if (pixelSpacingTopLevel !== undefined) {
    validateDicomPixelSpacing(pixelSpacingTopLevel, pixels.rows, pixels.columns)
  }
  if (pixelSpacingShared !== undefined) {
    validateDicomPixelSpacing(pixelSpacingShared, pixels.rows, pixels.columns)
  }
  for (const spacing of pixelSpacingPerFrame) {
    if (spacing !== undefined) validateDicomPixelSpacing(spacing, pixels.rows, pixels.columns)
  }
  const pixelSpacingMm = resolveDicomHomogeneousValue(
    pixelSpacingTopLevel,
    pixelSpacingShared,
    pixelSpacingPerFrame,
    dicomPixelSpacingEqual,
  )
  const imagePositionPatient = resolveDicomHomogeneousValue(
    parseDicomImagePositionPatient(dataset.elements),
    shared?.imagePositionPatient,
    perFrame.map((group) => group.imagePositionPatient),
    dicomNumberTupleEqual,
  )
  const imageOrientationPatient = resolveDicomHomogeneousValue(
    parseDicomImageOrientationPatient(dataset.elements),
    shared?.imageOrientationPatient,
    perFrame.map((group) => group.imageOrientationPatient),
    dicomNumberTupleEqual,
  )
  const spacing = resolvedValue(pixelSpacingMm)
  const position = resolvedValue(imagePositionPatient)
  const orientation = resolvedValue(imageOrientationPatient)
  const transform = resolvedValue(storedValueTransform)
  const presets = resolvedValue(voiPresets)
  return Object.freeze({
    sopClassUid,
    ...(sopInstanceUid === undefined ? {} : { sopInstanceUid }),
    transferSyntaxUid: fileMeta.transferSyntaxUid,
    ...(modality === undefined ? {} : { modality }),
    rows: pixels.rows,
    columns: pixels.columns,
    numberOfFrames: pixels.numberOfFrames,
    samplesPerPixel: pixels.samplesPerPixel,
    photometricInterpretation: pixels.photometricInterpretation,
    bitsAllocated: pixels.bitsAllocated,
    bitsStored: pixels.bitsStored,
    highBit: pixels.highBit,
    pixelRepresentation: pixels.pixelRepresentation,
    ...(spacing === undefined ? {} : { pixelSpacingMm: spacing }),
    ...(transform === undefined ? {} : { storedValueTransform: transform }),
    ...(storedValueTransform.status === 'conflict'
      ? { storedValueTransformConflict: 'inhomogeneous' as const }
      : {}),
    ...(presets === undefined ? {} : { voiPresets: presets }),
    ...(voiPresets.status === 'conflict' ? { voiPresetConflict: 'inhomogeneous' as const } : {}),
    monochromeInverted: pixels.photometricInterpretation === 'MONOCHROME1',
    ...(position === undefined ? {} : { imagePositionPatient: position }),
    ...(orientation === undefined ? {} : { imageOrientationPatient: orientation }),
    ...(frameOfReferenceUid === undefined ? {} : { frameOfReferenceUid }),
  })
}
