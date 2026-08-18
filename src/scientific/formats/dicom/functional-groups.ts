import { invalidInput } from '../../../errors.ts'
import { dicomTag } from './constants.ts'
import {
  type DicomDataset,
  type DicomElement,
  type DicomItem,
  decodeDicomDecimalStrings,
  findDicomElement,
} from './elements.ts'
import {
  type DicomStoredValueTransform,
  type DicomVoiPreset,
  parseDicomStoredValueTransform,
  parseDicomVoiPresets,
} from './presentation.ts'

export interface DicomPixelSpacingMm {
  readonly row: number
  readonly column: number
}

export type DicomImagePositionPatient = readonly [number, number, number]
export type DicomImageOrientationPatient = readonly [number, number, number, number, number, number]

export interface DicomFunctionalGroupValues {
  readonly storedValueTransform?: DicomStoredValueTransform
  readonly voiPresets?: readonly DicomVoiPreset[]
  readonly pixelSpacingMm?: DicomPixelSpacingMm
  readonly imagePositionPatient?: DicomImagePositionPatient
  readonly imageOrientationPatient?: DicomImageOrientationPatient
}

export type DicomHomogeneousResolution<T> =
  | { readonly status: 'absent' }
  | { readonly status: 'value'; readonly value: T }
  | { readonly status: 'conflict' }

const sequenceItems = (
  elements: readonly DicomElement[],
  tag: number,
  label: string,
): readonly DicomItem[] => {
  const element = findDicomElement(elements, tag)
  if (element === undefined) return []
  if (element.sequence === undefined) {
    throw invalidInput(`DICOM ${label} is not a sequence`)
  }
  return element.sequence.items
}

const singleSequenceItemElements = (
  elements: readonly DicomElement[],
  tag: number,
  label: string,
): readonly DicomElement[] | undefined => {
  const items = sequenceItems(elements, tag, label)
  if (items.length === 0) return undefined
  if (items.length > 1) throw invalidInput(`DICOM ${label} must contain one item`)
  const item = items[0]
  if (item === undefined) return undefined
  return item.elements
}

export const parseDicomPixelSpacing = (
  elements: readonly DicomElement[],
): DicomPixelSpacingMm | undefined => {
  const value = findDicomElement(elements, dicomTag.pixelSpacing)?.value
  if (value === undefined) return undefined
  const numbers = decodeDicomDecimalStrings(value, 'Pixel Spacing')
  if (numbers.length !== 2 || numbers[0] === undefined || numbers[1] === undefined) {
    throw invalidInput('DICOM Pixel Spacing must contain two values')
  }
  return Object.freeze({
    row: numbers[0],
    column: numbers[1],
  })
}

export const parseDicomImagePositionPatient = (
  elements: readonly DicomElement[],
): DicomImagePositionPatient | undefined => {
  const value = findDicomElement(elements, dicomTag.imagePositionPatient)?.value
  if (value === undefined) return undefined
  const numbers = decodeDicomDecimalStrings(value, 'Image Position Patient')
  if (
    numbers.length !== 3 ||
    numbers[0] === undefined ||
    numbers[1] === undefined ||
    numbers[2] === undefined
  ) {
    throw invalidInput('DICOM Image Position Patient must contain three values')
  }
  return Object.freeze([numbers[0], numbers[1], numbers[2]])
}

export const parseDicomImageOrientationPatient = (
  elements: readonly DicomElement[],
): DicomImageOrientationPatient | undefined => {
  const value = findDicomElement(elements, dicomTag.imageOrientationPatient)?.value
  if (value === undefined) return undefined
  const numbers = decodeDicomDecimalStrings(value, 'Image Orientation Patient')
  if (
    numbers.length !== 6 ||
    numbers[0] === undefined ||
    numbers[1] === undefined ||
    numbers[2] === undefined ||
    numbers[3] === undefined ||
    numbers[4] === undefined ||
    numbers[5] === undefined
  ) {
    throw invalidInput('DICOM Image Orientation Patient must contain six values')
  }
  return Object.freeze([numbers[0], numbers[1], numbers[2], numbers[3], numbers[4], numbers[5]])
}

export const parseDicomFunctionalGroupItem = (
  elements: readonly DicomElement[],
): DicomFunctionalGroupValues => {
  const transformElements = singleSequenceItemElements(
    elements,
    dicomTag.pixelValueTransformationSequence,
    'Pixel Value Transformation Sequence',
  )
  const voiElements = singleSequenceItemElements(
    elements,
    dicomTag.frameVoiLutSequence,
    'Frame VOI LUT Sequence',
  )
  const measureElements = singleSequenceItemElements(
    elements,
    dicomTag.pixelMeasuresSequence,
    'Pixel Measures Sequence',
  )
  const positionElements = singleSequenceItemElements(
    elements,
    dicomTag.planePositionSequence,
    'Plane Position Sequence',
  )
  const orientationElements = singleSequenceItemElements(
    elements,
    dicomTag.planeOrientationSequence,
    'Plane Orientation Sequence',
  )
  const storedValueTransform =
    transformElements === undefined ? undefined : parseDicomStoredValueTransform(transformElements)
  const voiPresets = voiElements === undefined ? undefined : parseDicomVoiPresets(voiElements)
  const pixelSpacingMm =
    measureElements === undefined ? undefined : parseDicomPixelSpacing(measureElements)
  const imagePositionPatient =
    positionElements === undefined ? undefined : parseDicomImagePositionPatient(positionElements)
  const imageOrientationPatient =
    orientationElements === undefined
      ? undefined
      : parseDicomImageOrientationPatient(orientationElements)
  return Object.freeze({
    ...(storedValueTransform === undefined ? {} : { storedValueTransform }),
    ...(voiPresets === undefined ? {} : { voiPresets }),
    ...(pixelSpacingMm === undefined ? {} : { pixelSpacingMm }),
    ...(imagePositionPatient === undefined ? {} : { imagePositionPatient }),
    ...(imageOrientationPatient === undefined ? {} : { imageOrientationPatient }),
  })
}

export const parseDicomSharedFunctionalGroup = (
  dataset: DicomDataset,
): DicomFunctionalGroupValues | undefined => {
  const elements = singleSequenceItemElements(
    dataset.elements,
    dicomTag.sharedFunctionalGroupsSequence,
    'Shared Functional Groups Sequence',
  )
  return elements === undefined ? undefined : parseDicomFunctionalGroupItem(elements)
}

export const parseDicomPerFrameFunctionalGroups = (
  dataset: DicomDataset,
  numberOfFrames: number,
): readonly DicomFunctionalGroupValues[] => {
  const items = sequenceItems(
    dataset.elements,
    dicomTag.perFrameFunctionalGroupsSequence,
    'Per-frame Functional Groups Sequence',
  )
  if (items.length === 0) return Object.freeze([])
  if (items.length !== numberOfFrames) {
    throw invalidInput(
      `DICOM Per-frame Functional Groups Sequence item count ${items.length} does not match Number of Frames ${numberOfFrames}`,
    )
  }
  return Object.freeze(items.map((item) => parseDicomFunctionalGroupItem(item.elements)))
}

export const resolveDicomHomogeneousValue = <T>(
  topLevel: T | undefined,
  shared: T | undefined,
  perFrame: readonly (T | undefined)[],
  equal: (left: T, right: T) => boolean,
): DicomHomogeneousResolution<T> => {
  if (perFrame.length > 0) {
    const present: T[] = []
    for (const value of perFrame) {
      if (value !== undefined) present.push(value)
    }
    if (present.length > 0) {
      if (present.length !== perFrame.length) return Object.freeze({ status: 'conflict' })
      const first = present[0]
      if (first === undefined) return Object.freeze({ status: 'absent' })
      for (const value of present) {
        if (!equal(first, value)) return Object.freeze({ status: 'conflict' })
      }
      if (shared !== undefined && !equal(shared, first)) {
        return Object.freeze({ status: 'conflict' })
      }
      if (topLevel !== undefined && !equal(topLevel, first)) {
        return Object.freeze({ status: 'conflict' })
      }
      return Object.freeze({ status: 'value', value: first })
    }
  }
  if (shared !== undefined) {
    if (topLevel !== undefined && !equal(topLevel, shared)) {
      return Object.freeze({ status: 'conflict' })
    }
    return Object.freeze({ status: 'value', value: shared })
  }
  if (topLevel !== undefined) return Object.freeze({ status: 'value', value: topLevel })
  return Object.freeze({ status: 'absent' })
}

export const dicomPixelSpacingEqual = (
  left: DicomPixelSpacingMm,
  right: DicomPixelSpacingMm,
): boolean => left.row === right.row && left.column === right.column

export const dicomNumberTupleEqual = (
  left: readonly number[],
  right: readonly number[],
): boolean => {
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}
