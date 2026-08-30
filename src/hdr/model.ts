import type { PixelColorSemantics } from '../color.ts'
import { normalizePixelColorSemantics } from '../color.ts'
import { invalidInput, limitExceeded } from '../errors.ts'

export type GainMapTriplet = readonly [number, number, number]
export type GainMapChannelCount = 1 | 3
export type GainMapContainer = 'jpeg' | 'avif' | 'heif'
export type GainMapMetadataRepresentation = 'iso-21496-1' | 'ultra-hdr-xmp'

export interface GainMapRational {
  readonly numerator: number
  readonly denominator: number
}

export interface GainMapSourceRange {
  readonly start: number
  readonly end: number
}

export interface GainMapDimensions {
  readonly width: number
  readonly height: number
}

export interface GainMapExactIsoMetadata {
  readonly minimum: readonly [GainMapRational, GainMapRational, GainMapRational]
  readonly maximum: readonly [GainMapRational, GainMapRational, GainMapRational]
  readonly gamma: readonly [GainMapRational, GainMapRational, GainMapRational]
  readonly offsetSdr: readonly [GainMapRational, GainMapRational, GainMapRational]
  readonly offsetHdr: readonly [GainMapRational, GainMapRational, GainMapRational]
  readonly capacityMinimum: GainMapRational
  readonly capacityMaximum: GainMapRational
}

export interface GainMapUltraHdrLexicalMetadata {
  readonly minimum?: readonly string[]
  readonly maximum?: readonly string[]
  readonly gamma?: readonly string[]
  readonly offsetSdr?: readonly string[]
  readonly offsetHdr?: readonly string[]
  readonly capacityMinimum?: string
  readonly capacityMaximum?: string
}

export interface GainMapMetadata {
  readonly baseRendition: 'sdr' | 'hdr'
  readonly channelCount: GainMapChannelCount
  readonly baseDimensions: GainMapDimensions
  readonly gainMapDimensions: GainMapDimensions
  readonly minimum: GainMapTriplet
  readonly maximum: GainMapTriplet
  readonly gamma: GainMapTriplet
  readonly offsetSdr: GainMapTriplet
  readonly offsetHdr: GainMapTriplet
  readonly capacityMinimum: number
  readonly capacityMaximum: number
  readonly useBaseColorSpace: boolean
  readonly baseColor: PixelColorSemantics
  readonly alternateColor: PixelColorSemantics
  readonly gainMapColor: PixelColorSemantics
  readonly container: GainMapContainer
  readonly representations: readonly GainMapMetadataRepresentation[]
  readonly selectedRepresentation: GainMapMetadataRepresentation
  readonly sourceCardinality: 'scalar' | 'rgb'
  readonly baseRange?: GainMapSourceRange
  readonly gainMapRange?: GainMapSourceRange
  readonly metadataRanges: readonly GainMapSourceRange[]
  readonly orientation: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
  readonly exactIso?: GainMapExactIsoMetadata
  readonly ultraHdrLexical?: GainMapUltraHdrLexicalMetadata
  readonly warnings: readonly string[]
}

export interface GainMapMetadataLimits {
  readonly maxDimension?: number
  readonly maxPixels?: number
  readonly maxRanges?: number
  readonly maxWarnings?: number
  readonly maxRationalMagnitude?: number
}

interface ResolvedGainMapMetadataLimits {
  readonly maxDimension: number
  readonly maxPixels: number
  readonly maxRanges: number
  readonly maxWarnings: number
  readonly maxRationalMagnitude: number
}

const defaultLimits: ResolvedGainMapMetadataLimits = Object.freeze({
  maxDimension: 100_000,
  maxPixels: 268_435_456,
  maxRanges: 32,
  maxWarnings: 32,
  maxRationalMagnitude: 4_294_967_295,
})

const record = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const positiveLimit = (value: number | undefined, fallback: number, label: string): number => {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1) {
    throw invalidInput(`${label} must be a positive safe integer`)
  }
  return resolved
}

const resolveLimits = (limits: Readonly<GainMapMetadataLimits>): ResolvedGainMapMetadataLimits =>
  Object.freeze({
    maxDimension: positiveLimit(limits.maxDimension, defaultLimits.maxDimension, 'maxDimension'),
    maxPixels: positiveLimit(limits.maxPixels, defaultLimits.maxPixels, 'maxPixels'),
    maxRanges: positiveLimit(limits.maxRanges, defaultLimits.maxRanges, 'maxRanges'),
    maxWarnings: positiveLimit(limits.maxWarnings, defaultLimits.maxWarnings, 'maxWarnings'),
    maxRationalMagnitude: positiveLimit(
      limits.maxRationalMagnitude,
      defaultLimits.maxRationalMagnitude,
      'maxRationalMagnitude',
    ),
  })

const finite = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw invalidInput(`${label} must be finite`)
  }
  return value
}

const dimensions = (
  value: unknown,
  label: string,
  limits: ResolvedGainMapMetadataLimits,
): GainMapDimensions => {
  if (!record(value)) throw invalidInput(`${label} dimensions must be an object`)
  const width = value.width
  const height = value.height
  if (
    typeof width !== 'number' ||
    typeof height !== 'number' ||
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1
  ) {
    throw invalidInput(`${label} dimensions must be positive safe integers`)
  }
  if (width > limits.maxDimension || height > limits.maxDimension) {
    throw limitExceeded(`${label} dimensions exceed the HDR dimension limit`)
  }
  if (BigInt(width) * BigInt(height) > BigInt(limits.maxPixels)) {
    throw limitExceeded(`${label} pixels exceed the HDR pixel limit`)
  }
  return Object.freeze({ width, height })
}

const triplet = (
  value: unknown,
  label: string,
): { readonly value: GainMapTriplet; readonly cardinality: 'scalar' | 'rgb' } => {
  if (typeof value === 'number') {
    const item = finite(value, label)
    return { value: Object.freeze([item, item, item]), cardinality: 'scalar' }
  }
  if (!Array.isArray(value) || (value.length !== 1 && value.length !== 3)) {
    throw invalidInput(`${label} must contain one or three values`)
  }
  const first = finite(value[0], `${label}[0]`)
  if (value.length === 1) {
    return { value: Object.freeze([first, first, first]), cardinality: 'scalar' }
  }
  return {
    value: Object.freeze([first, finite(value[1], `${label}[1]`), finite(value[2], `${label}[2]`)]),
    cardinality: 'rgb',
  }
}

const sourceRange = (value: unknown, label: string): GainMapSourceRange => {
  if (!record(value)) throw invalidInput(`${label} must be an object`)
  const start = value.start
  const end = value.end
  if (
    typeof start !== 'number' ||
    typeof end !== 'number' ||
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end <= start
  ) {
    throw invalidInput(`${label} must be a non-empty safe source range`)
  }
  return Object.freeze({ start, end })
}

const rangeList = (
  value: unknown,
  label: string,
  maxRanges: number,
): readonly GainMapSourceRange[] => {
  if (!Array.isArray(value)) throw invalidInput(`${label} must be an array`)
  if (value.length > maxRanges) throw limitExceeded(`${label} exceeds the HDR range limit`)
  return Object.freeze(value.map((item, index) => sourceRange(item, `${label}[${index}]`)))
}

const rational = (value: unknown, label: string, maxMagnitude: number): GainMapRational => {
  if (!record(value)) throw invalidInput(`${label} must be an object`)
  const numerator = value.numerator
  const denominator = value.denominator
  if (
    typeof numerator !== 'number' ||
    typeof denominator !== 'number' ||
    !Number.isSafeInteger(numerator) ||
    !Number.isSafeInteger(denominator) ||
    denominator <= 0 ||
    Math.abs(numerator) > maxMagnitude ||
    denominator > maxMagnitude
  ) {
    throw invalidInput(`${label} is not a bounded rational`)
  }
  return Object.freeze({ numerator, denominator })
}

const rationalTriplet = (
  value: unknown,
  label: string,
  maxMagnitude: number,
): readonly [GainMapRational, GainMapRational, GainMapRational] => {
  if (!Array.isArray(value) || value.length !== 3) {
    throw invalidInput(`${label} must contain three rationals`)
  }
  return Object.freeze([
    rational(value[0], `${label}[0]`, maxMagnitude),
    rational(value[1], `${label}[1]`, maxMagnitude),
    rational(value[2], `${label}[2]`, maxMagnitude),
  ])
}

const exactIso = (value: unknown, maxMagnitude: number): GainMapExactIsoMetadata | undefined => {
  if (value === undefined) return undefined
  if (!record(value)) throw invalidInput('exactIso must be an object')
  return Object.freeze({
    minimum: rationalTriplet(value.minimum, 'exactIso.minimum', maxMagnitude),
    maximum: rationalTriplet(value.maximum, 'exactIso.maximum', maxMagnitude),
    gamma: rationalTriplet(value.gamma, 'exactIso.gamma', maxMagnitude),
    offsetSdr: rationalTriplet(value.offsetSdr, 'exactIso.offsetSdr', maxMagnitude),
    offsetHdr: rationalTriplet(value.offsetHdr, 'exactIso.offsetHdr', maxMagnitude),
    capacityMinimum: rational(value.capacityMinimum, 'exactIso.capacityMinimum', maxMagnitude),
    capacityMaximum: rational(value.capacityMaximum, 'exactIso.capacityMaximum', maxMagnitude),
  })
}

const lexicalArray = (value: unknown, label: string): readonly string[] | undefined => {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || (value.length !== 1 && value.length !== 3)) {
    throw invalidInput(`${label} must contain one or three decimal strings`)
  }
  const output = value.map((item) => {
    if (typeof item !== 'string' || item.length < 1 || item.length > 64) {
      throw invalidInput(`${label} contains an invalid decimal string`)
    }
    return item
  })
  return Object.freeze(output)
}

const lexicalScalar = (value: unknown, label: string): string | undefined => {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length < 1 || value.length > 64) {
    throw invalidInput(`${label} must be a bounded decimal string`)
  }
  return value
}

const ultraHdrLexical = (value: unknown): GainMapUltraHdrLexicalMetadata | undefined => {
  if (value === undefined) return undefined
  if (!record(value)) throw invalidInput('ultraHdrLexical must be an object')
  const minimum = lexicalArray(value.minimum, 'ultraHdrLexical.minimum')
  const maximum = lexicalArray(value.maximum, 'ultraHdrLexical.maximum')
  const gamma = lexicalArray(value.gamma, 'ultraHdrLexical.gamma')
  const offsetSdr = lexicalArray(value.offsetSdr, 'ultraHdrLexical.offsetSdr')
  const offsetHdr = lexicalArray(value.offsetHdr, 'ultraHdrLexical.offsetHdr')
  const capacityMinimum = lexicalScalar(value.capacityMinimum, 'ultraHdrLexical.capacityMinimum')
  const capacityMaximum = lexicalScalar(value.capacityMaximum, 'ultraHdrLexical.capacityMaximum')
  return Object.freeze({
    ...(minimum === undefined ? {} : { minimum }),
    ...(maximum === undefined ? {} : { maximum }),
    ...(gamma === undefined ? {} : { gamma }),
    ...(offsetSdr === undefined ? {} : { offsetSdr }),
    ...(offsetHdr === undefined ? {} : { offsetHdr }),
    ...(capacityMinimum === undefined ? {} : { capacityMinimum }),
    ...(capacityMaximum === undefined ? {} : { capacityMaximum }),
  })
}

const representations = (value: unknown): readonly GainMapMetadataRepresentation[] => {
  if (!Array.isArray(value) || value.length < 1 || value.length > 2) {
    throw invalidInput('representations must contain one or two values')
  }
  const output: GainMapMetadataRepresentation[] = []
  for (const item of value) {
    if (item !== 'iso-21496-1' && item !== 'ultra-hdr-xmp') {
      throw invalidInput('Gain-map metadata representation is invalid')
    }
    if (output.includes(item)) throw invalidInput('Gain-map metadata representation is duplicated')
    output.push(item)
  }
  return Object.freeze(output)
}

const warningList = (value: unknown, maxWarnings: number): readonly string[] => {
  if (!Array.isArray(value)) throw invalidInput('warnings must be an array')
  if (value.length > maxWarnings) throw limitExceeded('warnings exceed the HDR warning limit')
  return Object.freeze(
    value.map((item) => {
      if (typeof item !== 'string' || item.length > 512) {
        throw invalidInput('Gain-map warning must be a bounded string')
      }
      return item
    }),
  )
}

const aspectRatiosMatch = (base: GainMapDimensions, map: GainMapDimensions): boolean =>
  BigInt(base.width) * BigInt(map.height) === BigInt(base.height) * BigInt(map.width)

export const normalizeGainMapMetadata = (
  value: unknown,
  limitOptions: Readonly<GainMapMetadataLimits> = {},
): GainMapMetadata => {
  if (!record(value)) throw invalidInput('Gain-map metadata must be an object')
  const limits = resolveLimits(limitOptions)
  const baseDimensions = dimensions(value.baseDimensions, 'Base image', limits)
  const gainMapDimensions = dimensions(value.gainMapDimensions, 'Gain-map image', limits)
  if (!aspectRatiosMatch(baseDimensions, gainMapDimensions)) {
    throw invalidInput('Base and gain-map dimensions must have the same exact aspect ratio')
  }
  if (value.baseRendition !== 'sdr' && value.baseRendition !== 'hdr') {
    throw invalidInput('baseRendition must be sdr or hdr')
  }
  if (value.channelCount !== 1 && value.channelCount !== 3) {
    throw invalidInput('channelCount must be one or three')
  }
  const minimum = triplet(value.minimum, 'minimum')
  const maximum = triplet(value.maximum, 'maximum')
  const gamma = triplet(value.gamma, 'gamma')
  const offsetSdr = triplet(value.offsetSdr, 'offsetSdr')
  const offsetHdr = triplet(value.offsetHdr, 'offsetHdr')
  const cardinalities = [
    minimum.cardinality,
    maximum.cardinality,
    gamma.cardinality,
    offsetSdr.cardinality,
    offsetHdr.cardinality,
  ]
  const inferredCardinality = cardinalities.includes('rgb') ? 'rgb' : 'scalar'
  const requestedCardinality = value.sourceCardinality
  if (
    requestedCardinality !== undefined &&
    requestedCardinality !== 'scalar' &&
    requestedCardinality !== 'rgb'
  ) {
    throw invalidInput('sourceCardinality must be scalar or rgb')
  }
  const sourceCardinality = requestedCardinality ?? inferredCardinality
  if (
    sourceCardinality === 'scalar' &&
    [minimum.value, maximum.value, gamma.value, offsetSdr.value, offsetHdr.value].some(
      (items) => items[0] !== items[1] || items[0] !== items[2],
    )
  ) {
    throw invalidInput('Scalar gain-map metadata must be identical across RGB')
  }
  if (sourceCardinality === 'rgb' && inferredCardinality !== 'rgb') {
    throw invalidInput('RGB source cardinality requires three-channel metadata')
  }
  if (value.channelCount === 1 && sourceCardinality === 'rgb') {
    throw invalidInput('A one-channel gain map cannot use three-channel metadata')
  }
  for (let channel = 0; channel < 3; channel += 1) {
    if ((gamma.value[channel] ?? 0) <= 0) throw invalidInput('Gain-map gamma must be positive')
    if ((minimum.value[channel] ?? 0) > (maximum.value[channel] ?? 0)) {
      throw invalidInput('Gain-map minimum cannot exceed maximum')
    }
    if ((offsetSdr.value[channel] ?? -1) < 0 || (offsetHdr.value[channel] ?? -1) < 0) {
      throw invalidInput('Gain-map offsets must be nonnegative')
    }
  }
  const capacityMinimum = finite(value.capacityMinimum, 'capacityMinimum')
  const capacityMaximum = finite(value.capacityMaximum, 'capacityMaximum')
  if (capacityMinimum >= capacityMaximum) {
    throw invalidInput('Gain-map capacity minimum must be below maximum')
  }
  const foundRepresentations = representations(value.representations)
  if (
    value.selectedRepresentation !== 'iso-21496-1' &&
    value.selectedRepresentation !== 'ultra-hdr-xmp'
  ) {
    throw invalidInput('selectedRepresentation is invalid')
  }
  if (!foundRepresentations.includes(value.selectedRepresentation)) {
    throw invalidInput('selectedRepresentation is not present in representations')
  }
  if (value.container !== 'jpeg' && value.container !== 'avif' && value.container !== 'heif') {
    throw invalidInput('Gain-map container is invalid')
  }
  if (typeof value.useBaseColorSpace !== 'boolean') {
    throw invalidInput('useBaseColorSpace must be boolean')
  }
  const orientation = value.orientation
  if (
    typeof orientation !== 'number' ||
    !Number.isSafeInteger(orientation) ||
    orientation < 1 ||
    orientation > 8
  ) {
    throw invalidInput('Gain-map orientation must be an EXIF orientation from 1 through 8')
  }
  const baseRange =
    value.baseRange === undefined ? undefined : sourceRange(value.baseRange, 'baseRange')
  const gainMapRange =
    value.gainMapRange === undefined ? undefined : sourceRange(value.gainMapRange, 'gainMapRange')
  if (
    baseRange &&
    gainMapRange &&
    baseRange.start < gainMapRange.end &&
    gainMapRange.start < baseRange.end
  ) {
    throw invalidInput('Base and gain-map source ranges overlap')
  }
  const normalizedExactIso = exactIso(value.exactIso, limits.maxRationalMagnitude)
  const normalizedLexical = ultraHdrLexical(value.ultraHdrLexical)
  return Object.freeze({
    baseRendition: value.baseRendition,
    channelCount: value.channelCount,
    baseDimensions,
    gainMapDimensions,
    minimum: minimum.value,
    maximum: maximum.value,
    gamma: gamma.value,
    offsetSdr: offsetSdr.value,
    offsetHdr: offsetHdr.value,
    capacityMinimum,
    capacityMaximum,
    useBaseColorSpace: value.useBaseColorSpace,
    baseColor: normalizePixelColorSemantics(value.baseColor),
    alternateColor: normalizePixelColorSemantics(value.alternateColor),
    gainMapColor: normalizePixelColorSemantics(value.gainMapColor),
    container: value.container,
    representations: foundRepresentations,
    selectedRepresentation: value.selectedRepresentation,
    sourceCardinality,
    ...(baseRange ? { baseRange } : {}),
    ...(gainMapRange ? { gainMapRange } : {}),
    metadataRanges: rangeList(value.metadataRanges ?? [], 'metadataRanges', limits.maxRanges),
    orientation: orientation as GainMapMetadata['orientation'],
    ...(normalizedExactIso ? { exactIso: normalizedExactIso } : {}),
    ...(normalizedLexical ? { ultraHdrLexical: normalizedLexical } : {}),
    warnings: warningList(value.warnings ?? [], limits.maxWarnings),
  })
}
