import { invalidInput } from './errors.ts'

export type PixelColorFamily = 'gray' | 'rgb' | 'yuv' | 'xyz' | 'unspecified'
export type PixelColorPrimaries =
  | 'srgb'
  | 'display-p3'
  | 'rec2020'
  | 'source-profile'
  | 'unspecified'
export type PixelMatrixCoefficients = 'identity' | 'bt601' | 'bt709' | 'bt2020-ncl' | 'unspecified'
export type PixelRange = 'full' | 'limited' | 'unspecified'
export type PixelAlphaSemantics = 'none' | 'straight' | 'premultiplied' | 'unspecified'
export type PixelColorProvenance =
  | 'decoder-converted'
  | 'container-signaled'
  | 'icc'
  | 'assumed-default'
  | 'unspecified'
export type PixelRenderingIntent = 'perceptual' | 'relative' | 'saturation' | 'absolute'
export type PixelTransferFunction =
  | { readonly kind: 'srgb' | 'linear' | 'pq' | 'hlg' | 'source-profile' | 'unspecified' }
  | { readonly kind: 'gamma'; readonly exponent: number }

export interface PixelIccSemantics {
  readonly relevance: 'source' | 'emitted-pixels'
  readonly description?: string
}

export interface PixelColorSemantics {
  readonly family: PixelColorFamily
  readonly primaries: PixelColorPrimaries
  readonly transfer: PixelTransferFunction
  readonly matrix: PixelMatrixCoefficients
  readonly range: PixelRange
  readonly alpha: PixelAlphaSemantics
  readonly provenance: PixelColorProvenance
  readonly renderingIntent?: PixelRenderingIntent
  readonly icc?: PixelIccSemantics
}

const families = new Set<PixelColorFamily>(['gray', 'rgb', 'yuv', 'xyz', 'unspecified'])
const primaries = new Set<PixelColorPrimaries>([
  'srgb',
  'display-p3',
  'rec2020',
  'source-profile',
  'unspecified',
])
const matrices = new Set<PixelMatrixCoefficients>([
  'identity',
  'bt601',
  'bt709',
  'bt2020-ncl',
  'unspecified',
])
const ranges = new Set<PixelRange>(['full', 'limited', 'unspecified'])
const alphas = new Set<PixelAlphaSemantics>(['none', 'straight', 'premultiplied', 'unspecified'])
const provenances = new Set<PixelColorProvenance>([
  'decoder-converted',
  'container-signaled',
  'icc',
  'assumed-default',
  'unspecified',
])
const renderingIntents = new Set<PixelRenderingIntent>([
  'perceptual',
  'relative',
  'saturation',
  'absolute',
])
const transferKinds = new Set([
  'srgb',
  'linear',
  'pq',
  'hlg',
  'source-profile',
  'unspecified',
  'gamma',
])

const record = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const allowedKeys = (value: Readonly<Record<string, unknown>>, keys: readonly string[]): void => {
  const allowed = new Set(keys)
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw invalidInput(`Unknown pixel color semantics field: ${key}`)
  }
}

const enumValue = <T extends string>(value: unknown, values: ReadonlySet<T>, label: string): T => {
  if (typeof value !== 'string' || !values.has(value as T)) {
    throw invalidInput(`Pixel color ${label} is invalid`)
  }
  return value as T
}

const normalizeTransfer = (value: unknown): PixelTransferFunction => {
  if (!record(value)) throw invalidInput('Pixel color transfer function must be an object')
  allowedKeys(value, ['kind', 'exponent'])
  const kind = enumValue(value.kind, transferKinds, 'transfer function')
  if (kind === 'gamma') {
    if (
      !Number.isFinite(value.exponent) ||
      typeof value.exponent !== 'number' ||
      value.exponent <= 0
    ) {
      throw invalidInput('Pixel color gamma exponent must be finite and greater than zero')
    }
    return Object.freeze({ kind, exponent: value.exponent })
  }
  if (value.exponent !== undefined) {
    throw invalidInput('Pixel color transfer exponent requires kind: gamma')
  }
  if (
    kind !== 'srgb' &&
    kind !== 'linear' &&
    kind !== 'pq' &&
    kind !== 'hlg' &&
    kind !== 'source-profile' &&
    kind !== 'unspecified'
  ) {
    throw invalidInput('Pixel color transfer function is invalid')
  }
  return Object.freeze({ kind })
}

const normalizeIcc = (value: unknown): PixelIccSemantics | undefined => {
  if (value === undefined) return undefined
  if (!record(value)) throw invalidInput('Pixel ICC semantics must be an object')
  allowedKeys(value, ['relevance', 'description'])
  if (value.relevance !== 'source' && value.relevance !== 'emitted-pixels') {
    throw invalidInput('Pixel ICC relevance is invalid')
  }
  if (value.description !== undefined && typeof value.description !== 'string') {
    throw invalidInput('Pixel ICC description must be a string')
  }
  if (typeof value.description === 'string' && value.description.length > 1024) {
    throw invalidInput('Pixel ICC description exceeds 1024 characters')
  }
  return Object.freeze({
    relevance: value.relevance,
    ...(typeof value.description === 'string' ? { description: value.description } : {}),
  })
}

export const normalizePixelColorSemantics = (value: unknown): PixelColorSemantics => {
  if (!record(value)) throw invalidInput('Pixel color semantics must be an object')
  allowedKeys(value, [
    'family',
    'primaries',
    'transfer',
    'matrix',
    'range',
    'alpha',
    'provenance',
    'renderingIntent',
    'icc',
  ])
  const icc = normalizeIcc(value.icc)
  const normalized: PixelColorSemantics = {
    family: enumValue(value.family, families, 'family'),
    primaries: enumValue(value.primaries, primaries, 'primaries'),
    transfer: normalizeTransfer(value.transfer),
    matrix: enumValue(value.matrix, matrices, 'matrix coefficients'),
    range: enumValue(value.range, ranges, 'range'),
    alpha: enumValue(value.alpha, alphas, 'alpha semantics'),
    provenance: enumValue(value.provenance, provenances, 'provenance'),
    ...(value.renderingIntent === undefined
      ? {}
      : {
          renderingIntent: enumValue(value.renderingIntent, renderingIntents, 'rendering intent'),
        }),
    ...(icc === undefined ? {} : { icc }),
  }
  if (normalized.provenance === 'icc' && normalized.icc === undefined) {
    throw invalidInput('ICC pixel provenance requires ICC semantics')
  }
  if (normalized.family === 'yuv' && normalized.matrix === 'identity') {
    throw invalidInput('YUV pixels cannot use identity matrix coefficients')
  }
  return Object.freeze(normalized)
}

export const unspecifiedPixelColorSemantics = Object.freeze<PixelColorSemantics>({
  family: 'unspecified',
  primaries: 'unspecified',
  transfer: Object.freeze({ kind: 'unspecified' }),
  matrix: 'unspecified',
  range: 'unspecified',
  alpha: 'unspecified',
  provenance: 'unspecified',
})
