import { invalidInput } from '../../../errors.ts'
import { dicomTag } from './constants.ts'
import {
  type DicomElement,
  decodeDicomDecimalStrings,
  decodeDicomText,
  findDicomElement,
} from './elements.ts'

export type DicomVoiLutFunction = 'LINEAR' | 'LINEAR_EXACT' | 'SIGMOID'

export interface DicomStoredValueTransform {
  readonly kind: 'linear'
  readonly slope: number
  readonly intercept: number
  readonly type?: string
}

export interface DicomVoiPreset {
  readonly center: number
  readonly width: number
  readonly explanation?: string
  readonly function: DicomVoiLutFunction
}

const singleDecimal = (bytes: Uint8Array, label: string): number => {
  const values = decodeDicomDecimalStrings(bytes, label)
  if (values.length !== 1 || values[0] === undefined) {
    throw invalidInput(`DICOM ${label} must contain one value`)
  }
  return values[0]
}

const splitDicomStringValues = (bytes: Uint8Array): readonly string[] => {
  const text = decodeDicomText(bytes)
  if (text.length === 0) return Object.freeze([])
  return Object.freeze(text.split('\\'))
}

const parseVoiLutFunction = (bytes: Uint8Array | undefined): DicomVoiLutFunction => {
  if (bytes === undefined) return 'LINEAR'
  const values = splitDicomStringValues(bytes)
  if (values.length !== 1 || values[0] === undefined || values[0].length === 0) {
    throw invalidInput('DICOM VOI LUT Function must contain one value')
  }
  const value = values[0]
  if (value !== 'LINEAR' && value !== 'LINEAR_EXACT' && value !== 'SIGMOID') {
    throw invalidInput(`DICOM VOI LUT Function ${value} is unsupported`)
  }
  return value
}

const requireWindowWidth = (width: number, voiFunction: DicomVoiLutFunction): void => {
  if (voiFunction === 'LINEAR') {
    if (!(width >= 1)) {
      throw invalidInput('DICOM Window Width must be at least 1 for LINEAR')
    }
    return
  }
  if (!(width > 0)) {
    throw invalidInput(`DICOM Window Width must be greater than 0 for ${voiFunction}`)
  }
}

export const parseDicomStoredValueTransform = (
  elements: readonly DicomElement[],
): DicomStoredValueTransform | undefined => {
  const slopeBytes = findDicomElement(elements, dicomTag.rescaleSlope)?.value
  const interceptBytes = findDicomElement(elements, dicomTag.rescaleIntercept)?.value
  const typeBytes = findDicomElement(elements, dicomTag.rescaleType)?.value
  if (slopeBytes === undefined && interceptBytes === undefined) {
    if (typeBytes !== undefined) {
      throw invalidInput('DICOM Rescale Type is present without Rescale Slope and Intercept')
    }
    return undefined
  }
  if (slopeBytes === undefined || interceptBytes === undefined) {
    throw invalidInput('DICOM Rescale Slope and Rescale Intercept must be paired')
  }
  const type = typeBytes === undefined ? undefined : decodeDicomText(typeBytes)
  return Object.freeze({
    kind: 'linear',
    slope: singleDecimal(slopeBytes, 'Rescale Slope'),
    intercept: singleDecimal(interceptBytes, 'Rescale Intercept'),
    ...(type === undefined || type.length === 0 ? {} : { type }),
  })
}

export const parseDicomVoiPresets = (
  elements: readonly DicomElement[],
): readonly DicomVoiPreset[] | undefined => {
  const centerBytes = findDicomElement(elements, dicomTag.windowCenter)?.value
  const widthBytes = findDicomElement(elements, dicomTag.windowWidth)?.value
  const explanationBytes = findDicomElement(elements, dicomTag.windowCenterWidthExplanation)?.value
  const functionBytes = findDicomElement(elements, dicomTag.voiLutFunction)?.value
  if (centerBytes === undefined && widthBytes === undefined) {
    if (explanationBytes !== undefined || functionBytes !== undefined) {
      throw invalidInput(
        'DICOM Window explanation or VOI LUT Function is present without Window Center and Width',
      )
    }
    return undefined
  }
  if (centerBytes === undefined || widthBytes === undefined) {
    throw invalidInput('DICOM Window Center and Window Width must be paired')
  }
  const centers = decodeDicomDecimalStrings(centerBytes, 'Window Center')
  const widths = decodeDicomDecimalStrings(widthBytes, 'Window Width')
  if (centers.length !== widths.length) {
    throw invalidInput('DICOM Window Center and Window Width counts do not match')
  }
  const voiFunction = parseVoiLutFunction(functionBytes)
  const explanations =
    explanationBytes === undefined ? undefined : splitDicomStringValues(explanationBytes)
  if (explanations !== undefined && explanations.length !== centers.length) {
    throw invalidInput('DICOM Window Center & Width Explanation count does not match Window Center')
  }
  const presets: DicomVoiPreset[] = []
  for (let index = 0; index < centers.length; index += 1) {
    const center = centers[index]
    const width = widths[index]
    if (center === undefined || width === undefined) {
      throw invalidInput('DICOM Window Center and Window Width must be paired')
    }
    requireWindowWidth(width, voiFunction)
    const explanation = explanations?.[index]
    presets.push(
      Object.freeze({
        center,
        width,
        ...(explanation === undefined || explanation.length === 0 ? {} : { explanation }),
        function: voiFunction,
      }),
    )
  }
  return Object.freeze(presets)
}

export const applyDicomModalityTransform = (
  storedValue: number,
  transform: DicomStoredValueTransform,
): number => transform.slope * storedValue + transform.intercept

export const applyDicomVoiWindow = (
  modalityValue: number,
  preset: DicomVoiPreset,
  outputMin = 0,
  outputMax = 255,
): number => {
  const center = preset.center
  const width = preset.width
  if (preset.function === 'LINEAR') {
    requireWindowWidth(width, 'LINEAR')
    const lower = center - 0.5 - (width - 1) / 2
    const upper = center - 0.5 + (width - 1) / 2
    if (modalityValue <= lower) return outputMin
    if (modalityValue > upper) return outputMax
    return (
      ((modalityValue - (center - 0.5)) / (width - 1) + 0.5) * (outputMax - outputMin) + outputMin
    )
  }
  requireWindowWidth(width, preset.function)
  if (preset.function === 'LINEAR_EXACT') {
    const lower = center - width / 2
    const upper = center + width / 2
    if (modalityValue <= lower) return outputMin
    if (modalityValue > upper) return outputMax
    return ((modalityValue - center) / width + 0.5) * (outputMax - outputMin) + outputMin
  }
  return (
    outputMin + (outputMax - outputMin) / (1 + Math.exp((-4 * (modalityValue - center)) / width))
  )
}

export const dicomStoredValueTransformsEqual = (
  left: DicomStoredValueTransform,
  right: DicomStoredValueTransform,
): boolean =>
  left.kind === right.kind &&
  left.slope === right.slope &&
  left.intercept === right.intercept &&
  left.type === right.type

export const dicomVoiPresetsEqual = (
  left: readonly DicomVoiPreset[],
  right: readonly DicomVoiPreset[],
): boolean => {
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) {
    const first = left[index]
    const second = right[index]
    if (
      first === undefined ||
      second === undefined ||
      first.center !== second.center ||
      first.width !== second.width ||
      first.function !== second.function ||
      first.explanation !== second.explanation
    ) {
      return false
    }
  }
  return true
}
