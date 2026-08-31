import { invalidInput, limitExceeded } from '../errors.ts'
import type { CropOptions, ResizeKernel } from '../pipeline.ts'
import { gainMapDimensionsAreCompatible, type GainMapDimensions } from './model.ts'

export interface GainMapFraction {
  readonly numerator: number
  readonly denominator: number
}

export interface GainMapContinuousRegion {
  readonly left: GainMapFraction
  readonly top: GainMapFraction
  readonly right: GainMapFraction
  readonly bottom: GainMapFraction
}

export interface GainMapGeometryState {
  readonly base: GainMapDimensions
  readonly gainMap: GainMapDimensions
}

export interface GainMapCropPlan extends GainMapGeometryState {
  readonly baseCrop: Readonly<CropOptions>
  readonly gainMapSourceRegion: GainMapContinuousRegion
}

export interface GainMapResizePlan extends GainMapGeometryState {
  readonly kernel: ResizeKernel
}

export type GainMapQuarterTurn = 90 | 180 | 270

const gcd = (left: number, right: number): number => {
  let a = Math.abs(left)
  let b = Math.abs(right)
  while (b !== 0) {
    const next = a % b
    a = b
    b = next
  }
  return a || 1
}

const fraction = (numerator: number, denominator: number): GainMapFraction => {
  if (
    !Number.isSafeInteger(numerator) ||
    !Number.isSafeInteger(denominator) ||
    numerator < 0 ||
    denominator < 1
  ) {
    throw invalidInput('Gain-map geometry fraction is invalid')
  }
  const divisor = gcd(numerator, denominator)
  return Object.freeze({ numerator: numerator / divisor, denominator: denominator / divisor })
}

const dimensions = (value: GainMapDimensions, label: string): GainMapDimensions => {
  if (
    !Number.isSafeInteger(value.width) ||
    !Number.isSafeInteger(value.height) ||
    value.width < 1 ||
    value.height < 1
  ) {
    throw invalidInput(`${label} dimensions are invalid`)
  }
  return Object.freeze({ width: value.width, height: value.height })
}

const validateState = (state: GainMapGeometryState): GainMapGeometryState => {
  const base = dimensions(state.base, 'Base')
  const gainMap = dimensions(state.gainMap, 'Gain-map')
  if (!gainMapDimensionsAreCompatible(base, gainMap)) {
    throw invalidInput(
      'Base and gain-map geometry must have the same aspect ratio within one gain-map pixel',
    )
  }
  return Object.freeze({ base, gainMap })
}

const compatibleMapDimensions = (
  source: GainMapGeometryState,
  outputBase: GainMapDimensions,
  explicit: GainMapDimensions | undefined,
  maxGainMapPixels: number,
): GainMapDimensions => {
  if (!Number.isSafeInteger(maxGainMapPixels) || maxGainMapPixels < 1) {
    throw invalidInput('maxGainMapPixels must be a positive safe integer')
  }
  if (explicit) {
    const result = dimensions(explicit, 'Output gain-map')
    if (!gainMapDimensionsAreCompatible(outputBase, result)) {
      throw invalidInput('Explicit output gain-map dimensions have an incompatible aspect ratio')
    }
    if (BigInt(result.width) * BigInt(result.height) > BigInt(maxGainMapPixels)) {
      throw limitExceeded('Output gain-map pixels exceed maxGainMapPixels')
    }
    return result
  }
  const idealWidth = (outputBase.width * source.gainMap.width) / source.base.width
  const idealHeight = (outputBase.height * source.gainMap.height) / source.base.height
  const roundedCandidates = (value: number): readonly number[] =>
    [...new Set([Math.floor(value), Math.round(value), Math.ceil(value)])]
      .map((candidate) => Math.max(1, candidate))
      .sort((left, right) => left - right)
  const candidates: Array<{
    readonly dimensions: GainMapDimensions
    readonly maximumRelativeError: number
    readonly totalRelativeError: number
  }> = []
  let compatibleCandidateExceededLimit = false
  for (const width of roundedCandidates(idealWidth)) {
    for (const height of roundedCandidates(idealHeight)) {
      const candidate = Object.freeze({ width, height })
      if (!gainMapDimensionsAreCompatible(outputBase, candidate)) continue
      if (BigInt(width) * BigInt(height) > BigInt(maxGainMapPixels)) {
        compatibleCandidateExceededLimit = true
        continue
      }
      const widthError = Math.abs(width - idealWidth) / idealWidth
      const heightError = Math.abs(height - idealHeight) / idealHeight
      candidates.push({
        dimensions: candidate,
        maximumRelativeError: Math.max(widthError, heightError),
        totalRelativeError: widthError + heightError,
      })
    }
  }
  candidates.sort(
    (left, right) =>
      left.maximumRelativeError - right.maximumRelativeError ||
      left.totalRelativeError - right.totalRelativeError ||
      left.dimensions.width * left.dimensions.height -
        right.dimensions.width * right.dimensions.height ||
      left.dimensions.width - right.dimensions.width ||
      left.dimensions.height - right.dimensions.height,
  )
  const selected = candidates[0]
  if (selected) return selected.dimensions
  if (compatibleCandidateExceededLimit) {
    throw limitExceeded('Output gain-map pixels exceed maxGainMapPixels')
  }
  throw invalidInput('Output gain-map dimensions have an incompatible aspect ratio')
}

export const planGainMapCrop = (
  stateValue: GainMapGeometryState,
  crop: Readonly<CropOptions>,
  options: Readonly<{
    readonly gainMapDimensions?: GainMapDimensions
    readonly maxGainMapPixels?: number
  }> = {},
): GainMapCropPlan => {
  const state = validateState(stateValue)
  if (
    !Number.isSafeInteger(crop.x) ||
    !Number.isSafeInteger(crop.y) ||
    !Number.isSafeInteger(crop.width) ||
    !Number.isSafeInteger(crop.height) ||
    crop.x < 0 ||
    crop.y < 0 ||
    crop.width < 1 ||
    crop.height < 1 ||
    crop.x + crop.width > state.base.width ||
    crop.y + crop.height > state.base.height
  ) {
    throw invalidInput('Gain-map crop is outside the base image')
  }
  const base = Object.freeze({ width: crop.width, height: crop.height })
  const gainMap = compatibleMapDimensions(
    state,
    base,
    options.gainMapDimensions,
    options.maxGainMapPixels ?? 268_435_456,
  )
  return Object.freeze({
    base,
    gainMap,
    baseCrop: Object.freeze({ ...crop }),
    gainMapSourceRegion: Object.freeze({
      left: fraction(crop.x * state.gainMap.width, state.base.width),
      top: fraction(crop.y * state.gainMap.height, state.base.height),
      right: fraction((crop.x + crop.width) * state.gainMap.width, state.base.width),
      bottom: fraction((crop.y + crop.height) * state.gainMap.height, state.base.height),
    }),
  })
}

export const planGainMapResize = (
  stateValue: GainMapGeometryState,
  outputBaseValue: GainMapDimensions,
  options: Readonly<{
    readonly gainMapDimensions?: GainMapDimensions
    readonly kernel?: ResizeKernel
    readonly maxGainMapPixels?: number
  }> = {},
): GainMapResizePlan => {
  const state = validateState(stateValue)
  const base = dimensions(outputBaseValue, 'Output base')
  const kernel = options.kernel ?? 'lanczos3'
  if (kernel !== 'nearest' && kernel !== 'bilinear' && kernel !== 'lanczos3') {
    throw invalidInput('Gain-map resize kernel is invalid')
  }
  const gainMap = compatibleMapDimensions(
    state,
    base,
    options.gainMapDimensions,
    options.maxGainMapPixels ?? 268_435_456,
  )
  return Object.freeze({ base, gainMap, kernel })
}

export const planGainMapQuarterTurn = (
  stateValue: GainMapGeometryState,
  degrees: GainMapQuarterTurn,
): GainMapGeometryState => {
  const state = validateState(stateValue)
  if (degrees !== 90 && degrees !== 180 && degrees !== 270) {
    throw invalidInput('Gain-map rotation must be 90, 180, or 270 degrees')
  }
  if (degrees === 180) return state
  return Object.freeze({
    base: Object.freeze({ width: state.base.height, height: state.base.width }),
    gainMap: Object.freeze({ width: state.gainMap.height, height: state.gainMap.width }),
  })
}

export const planGainMapOrientation = (
  stateValue: GainMapGeometryState,
  orientation: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8,
): GainMapGeometryState => {
  const state = validateState(stateValue)
  if (!Number.isInteger(orientation) || orientation < 1 || orientation > 8) {
    throw invalidInput('Gain-map EXIF orientation is invalid')
  }
  return orientation >= 5
    ? Object.freeze({
        base: Object.freeze({ width: state.base.height, height: state.base.width }),
        gainMap: Object.freeze({ width: state.gainMap.height, height: state.gainMap.width }),
      })
    : state
}
