import type { AbortOptions } from '../../../abort.ts'
import { throwIfAborted } from '../../../abort.ts'
import type { ZipLimits } from '../../../archive/zip.ts'
import { invalidInput, limitExceeded, unsupportedFormat } from '../../../errors.ts'
import type { RasterBlock, RasterSampleType } from '../../../raster.ts'
import { rasterSampleBytes } from '../../../raster.ts'
import type {
  NormalizedScientificDatasetDescriptor,
  ScientificAxisDescriptor,
  ScientificAxisKind,
  ScientificDataset,
  ScientificPlaneReadRequest,
  ScientificResolutionLevel,
  ScientificSpatialReference,
} from '../../../scientific/dataset.ts'
import {
  normalizeScientificDatasetDescriptor,
  normalizeScientificMetadataObject,
  normalizeScientificPlaneReadRequest,
} from '../../../scientific/dataset.ts'
import { rasterBlockToNumericTile } from '../../../scientific/numeric-tile.ts'
import type {
  ScientificCompanionResolver,
  ScientificOpenContext,
  ScientificReaderDescriptor,
} from '../../../scientific/reader.ts'
import {
  createScientificDatasetIdentity,
  getScientificDatasetIdentity,
  identifyScientificDataset,
} from '../../../scientific/reader.ts'
import type { ImageSource } from '../../../source.ts'
import { readExactly } from '../../../source.ts'
import {
  discoverZarrRoot,
  parseZarrNodeJson,
  readZarrJsonBytes,
  type ZarrArrayMetadata,
  type ZarrCodec,
  type ZarrGroupMetadata,
  type ZarrObject,
  type ZarrObjectStore,
  type ZarrRoot,
  type ZarrStore,
  type ZarrStoreDiagnostics,
} from '../../../zarr/core.ts'
import {
  ZarrHttpObjectStore,
  type ZarrHttpStoreOptions,
  type ZarrHttpStoreStats,
} from '../../../zarr/http-store.ts'
import { isZipBytes, openZarrZipStore } from '../../../zarr/zip-store.ts'
import type {
  GeoAxisCoordinateBlock,
  GeoAxisCoordinateReadRequest,
  GeoAxisDescriptor,
  GeoAxisKind,
  GeoBandDescriptor,
  GeoDiagnostic,
  GeoGridGeometry,
  GeoMetadataObject,
  GeoNoData,
  GeoRasterDataset,
  GeoRasterDescriptor,
  GeoRasterLevel,
  GeoRasterView,
  GeoRasterViewSelection,
  GeoSpatialReference,
} from '../../contracts.ts'
import {
  createGeoDiagnostic,
  createGeoGridGeometry,
  geoRasterSchemaVersion,
  normalizeGeoRasterDescriptor,
  normalizeGeoSpatialReference,
} from '../../contracts.ts'
import type {
  GeoZarrConventionMetadata,
  GeoZarrConventionMode,
  GeoZarrConventionNodeSource,
  GeoZarrDiagnostic,
  GeoZarrNormalizedLevel,
  GeoZarrNormalizedNodeMetadata,
  GeoZarrSpatialMetadata,
} from '../../conventions/geozarr/index.ts'
import {
  parseGeoZarrConventionMetadata,
  type GeoZarrConventionLimits,
  type GeoZarrConventionRegistration,
} from '../../conventions/geozarr/index.ts'
import { geoZarrDiagnostic, rejectGeoZarrErrors } from '../../conventions/geozarr/diagnostics.ts'
import { parseGeoZarrProjMetadata } from '../../conventions/geozarr/proj.ts'
import {
  hasKnownGeoZarrConvention,
  parseGeoZarrConventionRegistrations,
} from '../../conventions/geozarr/registry.ts'
import { parseGeoZarrSpatialMetadata } from '../../conventions/geozarr/spatial.ts'
import { resolveGeoZarrConventionLimits } from '../../conventions/geozarr/validation.ts'
import {
  adaptScientificDatasetToGeo,
  geoSpatialReferenceToScientific,
} from '../../scientific-adapter.ts'
import type { GeoRasterDocument, GeoRasterReader } from '../index.ts'

export interface GeoZarrReaderLimits {
  readonly maxMetadataBytes: number
  readonly maxDimensions: number
  readonly maxChunkBytes: number
  readonly maxDecodedChunkBytes: number
  readonly maxOpenSources: number
  readonly maxCachedChunkBytes: number
  readonly maxStoreResolutions: number
  readonly maxDatasets: number
  readonly maxLevels: number
  readonly maxRegionBytes: number
  readonly rowsPerBlock: number
  readonly maxCoordinateValues: number
  readonly zip?: ZipLimits
}

/** Runtime-neutral store input without exposing the internal Zarr parser or decoder modules. */
export interface GeoZarrObjectStore {
  resolve(
    relative: string,
    signal?: AbortSignal,
  ): Promise<{ readonly id: string; readonly source: ImageSource } | undefined>
  close?(): void | Promise<void>
}

export interface GeoZarrReaderOptions {
  readonly limits?: Partial<GeoZarrReaderLimits>
  readonly conventionMode?: GeoZarrConventionMode
  readonly conventionLimits?: Readonly<GeoZarrConventionLimits>
  /** Bounded array candidates for a group without a multiscales layout. No store listing occurs. */
  readonly candidateArrayPaths?: readonly string[]
}

export interface OpenGeoZarrObjectStoreOptions extends GeoZarrReaderOptions, AbortOptions {
  readonly primaryName?: string
  readonly storeKind?: GeoZarrStoreKind
}

export interface OpenGeoZarrHttpOptions extends GeoZarrReaderOptions, AbortOptions {
  readonly http?: Omit<ZarrHttpStoreOptions, 'signal'>
}

export type GeoZarrStoreKind = 'http' | 'directory' | 'zip' | 'scientific-context' | 'object-store'

export interface GeoZarrArrayInspection {
  readonly path: string
  readonly shape: readonly number[]
  readonly dimensions: readonly (string | null)[]
  readonly sampleType: RasterSampleType
  readonly logicalChunkShape: readonly number[]
  readonly outerShardShape?: readonly number[]
  readonly sharded: boolean
  readonly codecs: readonly string[]
  readonly fill: GeoMetadataObject
}

export interface GeoZarrLevelInspection {
  readonly id: string
  readonly order: number
  readonly array: GeoZarrArrayInspection
  readonly geometry: GeoGridGeometry
  readonly relativeScale?: readonly number[]
  readonly relativeTranslation?: readonly number[]
  readonly resamplingMethod?: string
}

export interface GeoZarrDatasetInspection {
  readonly id: string
  readonly title?: string
  readonly levels: readonly GeoZarrLevelInspection[]
  readonly diagnostics: readonly GeoDiagnostic[]
}

export interface GeoZarrIoReport {
  readonly metadataRequests: number
  readonly metadataBytes: number
  readonly chunkRequests: number
  readonly chunkBytes: number
  readonly uniqueBytes: number
  readonly cacheHits: number
  readonly coalescedConsumers: number
  readonly cancelledReads: number
  readonly sourceCacheBytes: number
  readonly logicalChunkReads: number
  readonly outerShardAccesses: number
  readonly uniqueShardObjects: number
  readonly shardIndexReads: number
  readonly shardPayloadRanges: number
}

export interface GeoZarrStructuralReport {
  readonly reportKind: 'structural-diagnostic'
  readonly zarrFormat: 2 | 3
  readonly storeKind: GeoZarrStoreKind
  readonly rootNodeType: 'array' | 'group'
  readonly rootMetadataObject: string
  readonly conventions: readonly GeoZarrConventionRegistration[]
  readonly datasets: readonly GeoZarrDatasetInspection[]
  readonly store: ZarrStoreDiagnostics
  readonly io: GeoZarrIoReport
  readonly compatibilityWarnings: readonly GeoZarrDiagnostic[]
}

export interface GeoZarrDocument extends GeoRasterDocument {
  inspectStructure(): GeoZarrStructuralReport
}

export interface GeoZarrReader extends GeoRasterReader {
  open(context: Readonly<ScientificOpenContext>): Promise<GeoZarrDocument>
}

export const geoZarrReaderDescriptor: ScientificReaderDescriptor = Object.freeze({
  id: 'purejsimage/geo/geozarr',
  version: '1.0.0',
  format: 'GeoZarr',
  extensions: Object.freeze(['zarr', 'zip']),
  mediaTypes: Object.freeze(['application/x-zarr', 'application/vnd+zarr', 'application/zip']),
  capabilities: Object.freeze({
    datasets: 'geo-raster-series',
    axes: 'labeled',
    zarr: '2-3',
    rangeReads: true,
    resolutionLevels: true,
    sharding: 'v3-sharding-indexed',
    stores: Object.freeze(['http', 'directory', 'zip', 'object-store']),
  }),
})

const defaults: Readonly<GeoZarrReaderLimits> = Object.freeze({
  maxMetadataBytes: 1_048_576,
  maxDimensions: 16,
  maxChunkBytes: 67_108_864,
  maxDecodedChunkBytes: 67_108_864,
  maxOpenSources: 4_096,
  maxCachedChunkBytes: 16_777_216,
  maxStoreResolutions: 8_192,
  maxDatasets: 256,
  maxLevels: 64,
  maxRegionBytes: 67_108_864,
  rowsPerBlock: 32,
  maxCoordinateValues: 65_536,
})

const positive = (value: number | undefined, fallback: number, label: string): number => {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || result < 1) {
    throw invalidInput(`${label} must be a positive safe integer`)
  }
  return result
}

const resolveLimits = (value: Partial<GeoZarrReaderLimits> = {}): Readonly<GeoZarrReaderLimits> =>
  Object.freeze({
    maxMetadataBytes: positive(
      value.maxMetadataBytes,
      defaults.maxMetadataBytes,
      'GeoZarr maxMetadataBytes',
    ),
    maxDimensions: positive(value.maxDimensions, defaults.maxDimensions, 'GeoZarr maxDimensions'),
    maxChunkBytes: positive(value.maxChunkBytes, defaults.maxChunkBytes, 'GeoZarr maxChunkBytes'),
    maxDecodedChunkBytes: positive(
      value.maxDecodedChunkBytes,
      defaults.maxDecodedChunkBytes,
      'GeoZarr maxDecodedChunkBytes',
    ),
    maxOpenSources: positive(
      value.maxOpenSources,
      defaults.maxOpenSources,
      'GeoZarr maxOpenSources',
    ),
    maxCachedChunkBytes: positive(
      value.maxCachedChunkBytes,
      defaults.maxCachedChunkBytes,
      'GeoZarr maxCachedChunkBytes',
    ),
    maxStoreResolutions: positive(
      value.maxStoreResolutions,
      defaults.maxStoreResolutions,
      'GeoZarr maxStoreResolutions',
    ),
    maxDatasets: positive(value.maxDatasets, defaults.maxDatasets, 'GeoZarr maxDatasets'),
    maxLevels: positive(value.maxLevels, defaults.maxLevels, 'GeoZarr maxLevels'),
    maxRegionBytes: positive(
      value.maxRegionBytes,
      defaults.maxRegionBytes,
      'GeoZarr maxRegionBytes',
    ),
    rowsPerBlock: positive(value.rowsPerBlock, defaults.rowsPerBlock, 'GeoZarr rowsPerBlock'),
    maxCoordinateValues: positive(
      value.maxCoordinateValues,
      defaults.maxCoordinateValues,
      'GeoZarr maxCoordinateValues',
    ),
    ...(value.zip === undefined ? {} : { zip: value.zip }),
  })

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const boundedPath = (value: string, label: string): string => {
  if (
    value.length < 1 ||
    value.length > 4_096 ||
    value.startsWith('/') ||
    value.endsWith('/') ||
    value.includes('\\') ||
    value.split('/').some((entry) => entry.length === 0 || entry === '.' || entry === '..')
  ) {
    throw invalidInput(`${label} must be a bounded safe relative path`)
  }
  return value
}

const normalizeCandidatePaths = (values: readonly string[] | undefined): readonly string[] => {
  if (values === undefined) return Object.freeze([])
  if (values.length > defaults.maxDatasets)
    throw limitExceeded('GeoZarr candidates exceed maxDatasets')
  const seen = new Set<string>()
  return Object.freeze(
    values.map((value, index) => {
      const path = boundedPath(value, `GeoZarr candidateArrayPaths[${index}]`)
      if (seen.has(path)) throw invalidInput(`GeoZarr candidate array ${path} is duplicated`)
      seen.add(path)
      return path
    }),
  )
}

const metadataObjectFor = (format: 2 | 3, path: string, nodeType: 'array' | 'group'): string => {
  const leaf = format === 3 ? 'zarr.json' : nodeType === 'array' ? '.zarray' : '.zgroup'
  return path.length === 0 ? leaf : `${path}/${leaf}`
}

const attributesObjectFor = (format: 2 | 3, path: string): string | undefined =>
  format === 3 ? undefined : path.length === 0 ? '.zattrs' : `${path}/.zattrs`

const nodeSource = (
  format: 2 | 3,
  nodeType: 'array' | 'group',
  path: string,
  metadata: ZarrArrayMetadata | ZarrGroupMetadata,
): GeoZarrConventionNodeSource => ({
  zarrFormat: format,
  nodeType,
  path,
  metadata:
    format === 3
      ? {
          zarr_format: 3,
          node_type: nodeType,
          attributes: metadata.attributes,
          ...(nodeType === 'array' && 'shape' in metadata
            ? {
                shape: metadata.shape,
                dimension_names: metadata.dimensionNames ?? metadata.shape.map(() => null),
              }
            : {}),
        }
      : metadata.attributes,
  ...(nodeType === 'array' && 'shape' in metadata ? { shape: metadata.shape } : {}),
  ...(nodeType === 'array' && 'dimensionNames' in metadata && metadata.dimensionNames !== undefined
    ? { dimensionNames: metadata.dimensionNames }
    : {}),
})

const unknownSpatialReference = (sourceId: string): GeoSpatialReference =>
  normalizeGeoSpatialReference({
    schemaVersion: geoRasterSchemaVersion,
    coordinateSystemType: 'unknown',
    formalAxes: [],
    applicationAxes: { x: { name: 'X' }, y: { name: 'Y' } },
    evidence: [{ kind: 'embedded', sourceId, locator: 'GeoZarr spatial metadata' }],
    state: 'unknown',
    confidence: 0.2,
    diagnostics: [
      {
        severity: 'warning',
        code: 'unknown-crs',
        message: 'The GeoZarr grid has no recognized CRS metadata.',
        path: 'proj',
      },
    ],
  })

const geoDiagnostic = (value: GeoZarrDiagnostic): GeoDiagnostic =>
  createGeoDiagnostic({
    severity: value.severity,
    code: 'geozarr-convention',
    message: `${value.code}: ${value.message}`,
    path: value.path,
    ...(value.conventionUuid === undefined
      ? {}
      : { metadata: { conventionUuid: value.conventionUuid } }),
  })

const noDataValue = (
  attributes: Readonly<Record<string, unknown>>,
): number | string | undefined => {
  for (const key of ['_FillValue', 'missing_value', 'nodata']) {
    const value = attributes[key]
    if (typeof value === 'number' || typeof value === 'string') return value
  }
  return undefined
}

const noDataFor = (array: Readonly<ZarrArrayMetadata>): GeoNoData => {
  const value = noDataValue(array.attributes)
  if (value !== undefined) return Object.freeze({ kind: 'scalar', value })
  if (array.fill.kind === 'defined' && array.fill.numeric !== undefined) {
    const numeric = array.fill.numeric
    return Object.freeze({
      kind: 'scalar',
      value: Number.isNaN(numeric) ? 'NaN' : numeric,
    })
  }
  return Object.freeze({ kind: 'none' })
}

const fillMetadata = (array: Readonly<ZarrArrayMetadata>): GeoMetadataObject => {
  if (array.fill.kind === 'undefined') return Object.freeze({ kind: 'undefined' })
  const hex = [...array.fill.bytes].map((value) => value.toString(16).padStart(2, '0')).join('')
  const numeric = array.fill.numeric
  return Object.freeze({
    kind: 'defined',
    bytes: hex,
    ...(numeric === undefined
      ? {}
      : Number.isFinite(numeric)
        ? { numeric }
        : { numeric: Number.isNaN(numeric) ? 'NaN' : numeric > 0 ? 'Infinity' : '-Infinity' }),
  })
}

const codecNames = (codecs: readonly ZarrCodec[]): readonly string[] => {
  const names: string[] = []
  const add = (value: unknown): void => {
    if (!isRecord(value) || typeof value.name !== 'string') return
    names.push(value.name)
  }
  for (const codec of codecs) {
    names.push(codec.name)
    if (codec.name !== 'sharding_indexed') continue
    if (Array.isArray(codec.configuration.codecs)) codec.configuration.codecs.forEach(add)
    if (Array.isArray(codec.configuration.index_codecs))
      codec.configuration.index_codecs.forEach(add)
  }
  return Object.freeze([...new Set(names)])
}

const numericShape = (value: unknown, rank: number): readonly number[] | undefined => {
  if (
    !Array.isArray(value) ||
    value.length !== rank ||
    value.some((entry) => !Number.isSafeInteger(entry) || Number(entry) < 1)
  ) {
    return undefined
  }
  return Object.freeze(value.map(Number))
}

const arrayInspection = (path: string, array: ZarrArrayMetadata): GeoZarrArrayInspection => {
  const sharding = array.codecs.find((codec) => codec.name === 'sharding_indexed')
  const logical =
    sharding === undefined
      ? array.chunkShape
      : (numericShape(sharding.configuration.chunk_shape, array.shape.length) ?? array.chunkShape)
  return Object.freeze({
    path,
    shape: Object.freeze([...array.shape]),
    dimensions: Object.freeze([...(array.dimensionNames ?? array.shape.map(() => null))]),
    sampleType: array.dataType,
    logicalChunkShape: Object.freeze([...logical]),
    ...(sharding === undefined ? {} : { outerShardShape: Object.freeze([...array.chunkShape]) }),
    sharded: sharding !== undefined,
    codecs: codecNames(array.codecs),
    fill: fillMetadata(array),
  })
}

const dimensionId = (value: string | null | undefined, index: number): string =>
  value === null || value === undefined || value.length === 0 ? `dimension-${index}` : value

const axisKind = (name: string): GeoAxisKind => {
  const lower = name.toLowerCase()
  if (lower === 'band' || lower === 'bands' || lower === 'c' || lower === 'channel') return 'band'
  if (lower === 't' || lower === 'time') return 'time'
  if (lower === 'z' || lower === 'vertical' || lower === 'height') return 'vertical'
  if (lower === 'depth') return 'depth'
  if (lower === 'ensemble' || lower === 'member' || lower === 'realization') return 'ensemble'
  if (lower === 'scenario') return 'scenario'
  return 'other'
}

const scientificAxisKind = (kind: GeoAxisKind): ScientificAxisKind => {
  if (kind === 'band') return 'channel'
  if (kind === 'time') return 'time'
  if (kind === 'vertical' || kind === 'depth') return 'space'
  return 'other'
}

const finiteAttribute = (
  attributes: Readonly<Record<string, unknown>>,
  key: string,
): number | undefined => {
  const value = attributes[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

const bandFor = (array: ZarrArrayMetadata): GeoBandDescriptor => {
  const scale = finiteAttribute(array.attributes, 'scale_factor')
  const offset = finiteAttribute(array.attributes, 'add_offset')
  const unit = typeof array.attributes.units === 'string' ? array.attributes.units : undefined
  const description =
    typeof array.attributes.long_name === 'string' ? array.attributes.long_name : undefined
  const nodata = noDataValue(array.attributes)
  return Object.freeze({
    sourceComponentIndex: 0,
    name: 'Component 0',
    ...(description === undefined ? {} : { description }),
    colorInterpretation: 'undefined',
    ...(unit === undefined ? {} : { unit }),
    ...(scale === undefined ? {} : { scale }),
    ...(offset === undefined ? {} : { offset }),
    ...(nodata === undefined ? {} : { noData: nodata }),
    dataType: array.dataType,
    categorical: false,
  })
}

const affineClose = (left: readonly number[], right: readonly number[]): boolean =>
  left.length === right.length &&
  left.every((value, index) => {
    const expected = right[index] ?? 0
    return Math.abs(value - expected) <= Math.max(1, Math.abs(value), Math.abs(expected)) * 1e-9
  })

const derivedAffine = (
  source: GeoGridGeometry,
  scale: readonly number[],
  translation: readonly number[] | undefined,
  yIndex: number,
  xIndex: number,
): readonly [number, number, number, number, number, number] | undefined => {
  const compact = scale.length === 2
  const sx = compact ? scale[1] : scale[xIndex]
  const sy = compact ? scale[0] : scale[yIndex]
  const tx = compact ? (translation?.[1] ?? 0) : (translation?.[xIndex] ?? 0)
  const ty = compact ? (translation?.[0] ?? 0) : (translation?.[yIndex] ?? 0)
  if (![sx, sy, tx, ty].every((value) => typeof value === 'number' && Number.isFinite(value))) {
    return undefined
  }
  const [a, b, c, d, e, f] = source.pixelToWorld
  return Object.freeze([
    a * Number(sx),
    b * Number(sy),
    a * Number(tx) + b * Number(ty) + c,
    d * Number(sx),
    e * Number(sy),
    d * Number(tx) + e * Number(ty) + f,
  ] as const)
}

interface OpenedLevel {
  readonly id: string
  readonly path: string
  readonly order: number
  readonly array: ZarrArrayMetadata
  readonly geometry: GeoGridGeometry
  readonly derivedFrom?: string
  readonly relativeScale?: readonly number[]
  readonly relativeTranslation?: readonly number[]
  readonly resamplingMethod?: string
}

interface DatasetState {
  readonly id: string
  readonly title?: string
  readonly levels: readonly OpenedLevel[]
  readonly convention: GeoZarrConventionMetadata | StandaloneConventionMetadata
  readonly spatialReference: GeoSpatialReference
  readonly diagnostics: readonly GeoDiagnostic[]
  readonly coordinateArrays: ReadonlyMap<string, ZarrArrayMetadata>
  dataset?: GeoRasterDataset
}

const conventionFormat = (
  convention: GeoZarrConventionMetadata | StandaloneConventionMetadata,
): 2 | 3 =>
  'group' in convention ? convention.group.node.zarrFormat : convention.node.node.zarrFormat

interface StandaloneConventionMetadata {
  readonly registrations: readonly GeoZarrConventionRegistration[]
  readonly node: GeoZarrNormalizedNodeMetadata
  readonly diagnostics: readonly GeoZarrDiagnostic[]
  readonly levels: readonly GeoZarrNormalizedLevel[]
  readonly crs?: GeoSpatialReference
}

const standaloneConvention = (
  source: GeoZarrConventionNodeSource,
  mode: GeoZarrConventionMode,
  conventionLimits: Readonly<GeoZarrConventionLimits> | undefined,
): StandaloneConventionMetadata => {
  const limits = resolveGeoZarrConventionLimits(conventionLimits)
  const attributes = isRecord(source.metadata)
    ? source.zarrFormat === 3 && isRecord(source.metadata.attributes)
      ? source.metadata.attributes
      : source.metadata
    : {}
  const registration = parseGeoZarrConventionRegistrations(
    attributes,
    mode,
    limits,
    `${source.path || '<root>'}.attributes.zarr_conventions`,
  )
  const proj = parseGeoZarrProjMetadata(
    attributes,
    mode,
    limits,
    `${source.path || '<root>'}.attributes`,
  )
  const spatial = parseGeoZarrSpatialMetadata(
    attributes,
    {
      path: `${source.path || '<root>'}.attributes`,
      nodeType: 'array',
      ...(source.shape === undefined ? {} : { shape: source.shape }),
      ...(source.dimensionNames === undefined ? {} : { dimensionNames: source.dimensionNames }),
    },
    mode,
    limits,
  )
  const missingRegistrations: GeoZarrDiagnostic[] = []
  for (const name of ['proj', 'spatial'] as const) {
    const present = Object.keys(attributes).some((key) => key.startsWith(`${name}:`))
    if (present && !hasKnownGeoZarrConvention(registration.registrations, name)) {
      missingRegistrations.push(
        geoZarrDiagnostic(
          mode === 'strict' ? 'error' : 'warning',
          'malformed-registration',
          `${name} metadata is present without its known UUID registration`,
          `${source.path || '<root>'}.attributes`,
        ),
      )
    }
  }
  const diagnostics = Object.freeze([
    ...registration.diagnostics,
    ...proj.diagnostics,
    ...spatial.diagnostics,
    ...missingRegistrations,
  ])
  rejectGeoZarrErrors(mode, diagnostics)
  return Object.freeze({
    registrations: registration.registrations,
    node: Object.freeze({
      node: Object.freeze({
        zarrFormat: source.zarrFormat,
        nodeType: 'array',
        path: source.path,
        attributes: normalizeScientificMetadataObject(attributes),
        ...(source.shape === undefined ? {} : { shape: source.shape }),
        ...(source.dimensionNames === undefined ? {} : { dimensionNames: source.dimensionNames }),
      }),
      registrations: registration.registrations,
      ...(proj.value === undefined ? {} : { proj: proj.value }),
      ...(spatial.value === undefined ? {} : { spatial: spatial.value }),
    }),
    diagnostics,
    levels: Object.freeze([]),
    ...(proj.value?.spatialReference === undefined ? {} : { crs: proj.value.spatialReference }),
  })
}

const explicitLevelAffine = (
  normalized: GeoZarrNormalizedLevel,
): readonly [number, number, number, number, number, number] | undefined => {
  if (normalized.layout.spatialTransform !== undefined) return normalized.layout.spatialTransform
  const raw = normalized.node?.attributes['spatial:transform']
  if (
    Array.isArray(raw) &&
    raw.length === 6 &&
    raw.every((entry): entry is number => typeof entry === 'number' && Number.isFinite(entry))
  ) {
    return Object.freeze([...raw] as [number, number, number, number, number, number])
  }
  return undefined
}

const geometryFor = (
  array: ZarrArrayMetadata,
  spatial: GeoZarrSpatialMetadata,
  affine: readonly [number, number, number, number, number, number],
): GeoGridGeometry => {
  const indices = spatial.sourceDimensionIndices
  const dimensions = spatial.dimensions
  if (indices === undefined || dimensions === undefined) {
    throw invalidInput('GeoZarr spatial dimensions are incomplete')
  }
  const height = array.shape[indices[0]]
  const width = array.shape[indices[1]]
  if (height === undefined || width === undefined)
    throw invalidInput('GeoZarr spatial shape is missing')
  return createGeoGridGeometry({
    width,
    height,
    spatialDimensions: {
      x: { id: dimensions[1], name: dimensions[1], dimensionIndex: indices[1] },
      y: { id: dimensions[0], name: dimensions[0], dimensionIndex: indices[0] },
    },
    pixelToWorld: affine,
    pixelRegistration: spatial.pixelRegistration,
    noData: noDataFor(array),
  })
}

const createLevelStates = (
  arrays: ReadonlyMap<string, ZarrArrayMetadata>,
  convention: GeoZarrConventionMetadata,
  diagnostics: GeoDiagnostic[],
): readonly OpenedLevel[] => {
  const normalized = convention.levels
  const resolved = new Map<string, OpenedLevel>()
  const resolving = new Set<string>()
  const byAsset = new Map(normalized.map((level) => [level.asset, level]))
  const resolve = (level: GeoZarrNormalizedLevel): OpenedLevel => {
    const existing = resolved.get(level.asset)
    if (existing !== undefined) return existing
    if (resolving.has(level.asset))
      throw invalidInput('GeoZarr multiscale derivation contains a cycle')
    resolving.add(level.asset)
    const array = arrays.get(level.asset)
    if (array === undefined || level.spatial === undefined) {
      throw invalidInput(`GeoZarr multiscale level ${level.asset} lacks array or spatial metadata`)
    }
    let affine = explicitLevelAffine(level)
    if (
      affine === undefined &&
      level.derivedFrom !== undefined &&
      level.relativeScale !== undefined
    ) {
      const parentMetadata = byAsset.get(level.derivedFrom)
      if (parentMetadata === undefined)
        throw invalidInput(`GeoZarr level ${level.asset} has no source level`)
      const parent = resolve(parentMetadata)
      const indices = level.spatial.sourceDimensionIndices
      if (indices !== undefined) {
        affine = derivedAffine(
          parent.geometry,
          level.relativeScale,
          level.relativeTranslation,
          indices[0],
          indices[1],
        )
      }
    }
    if (affine === undefined && level.order === 0) affine = level.spatial.affine
    if (affine === undefined) {
      throw invalidInput(
        `GeoZarr level ${level.asset} has no explicit or defensibly derived affine`,
      )
    }
    const geometry = geometryFor(array, level.spatial, affine)
    if (
      level.derivedFrom !== undefined &&
      level.relativeScale !== undefined &&
      explicitLevelAffine(level) !== undefined
    ) {
      const parentMetadata = byAsset.get(level.derivedFrom)
      const indices = level.spatial.sourceDimensionIndices
      if (parentMetadata !== undefined && indices !== undefined) {
        const expected = derivedAffine(
          resolve(parentMetadata).geometry,
          level.relativeScale,
          level.relativeTranslation,
          indices[0],
          indices[1],
        )
        if (expected !== undefined && !affineClose(geometry.pixelToWorld, expected)) {
          diagnostics.push(
            createGeoDiagnostic({
              severity: 'warning',
              code: 'geozarr-inconsistent-level',
              message: `GeoZarr level ${level.asset} explicit transform disagrees with its relative multiscale transform.`,
              path: `multiscales.layout[${level.order}]`,
            }),
          )
        }
      }
    }
    const result: OpenedLevel = Object.freeze({
      id: String(level.order),
      path: array.path,
      order: level.order,
      array,
      geometry,
      ...(level.derivedFrom === undefined ? {} : { derivedFrom: level.derivedFrom }),
      ...(level.relativeScale === undefined ? {} : { relativeScale: level.relativeScale }),
      ...(level.relativeTranslation === undefined
        ? {}
        : { relativeTranslation: level.relativeTranslation }),
      ...(level.resamplingMethod === undefined ? {} : { resamplingMethod: level.resamplingMethod }),
    })
    resolving.delete(level.asset)
    resolved.set(level.asset, result)
    return result
  }
  return Object.freeze(normalized.map(resolve))
}

const assertLevelCompatibility = (levels: readonly OpenedLevel[]): void => {
  const base = levels[0]
  if (base === undefined) throw invalidInput('GeoZarr dataset has no levels')
  const baseNames = base.array.dimensionNames ?? base.array.shape.map(() => null)
  for (const level of levels.slice(1)) {
    const names = level.array.dimensionNames ?? level.array.shape.map(() => null)
    if (
      level.array.dataType !== base.array.dataType ||
      names.length !== baseNames.length ||
      names.some((name, index) => name !== baseNames[index])
    ) {
      throw invalidInput(`GeoZarr level ${level.path} changes sample type or dimension ordering`)
    }
    for (let index = 0; index < names.length; index += 1) {
      if (
        index !== base.geometry.spatialDimensions.x.dimensionIndex &&
        index !== base.geometry.spatialDimensions.y.dimensionIndex &&
        level.array.shape[index] !== base.array.shape[index]
      ) {
        throw invalidInput(`GeoZarr level ${level.path} changes a non-spatial dimension`)
      }
    }
  }
}

const scientificSpatialReference = (
  reference: GeoSpatialReference,
  geometry: GeoGridGeometry,
): ScientificSpatialReference =>
  geoSpatialReferenceToScientific(reference, geometry).spatialReference

const scientificDescriptor = (state: DatasetState): NormalizedScientificDatasetDescriptor => {
  const base = state.levels[0]
  if (base === undefined) throw invalidInput('GeoZarr dataset has no base level')
  const names = base.array.dimensionNames ?? base.array.shape.map(() => null)
  const ids = names.map(dimensionId)
  if (new Set(ids).size !== ids.length) throw invalidInput('GeoZarr dimension names must be unique')
  const spatialIndices = new Set([
    base.geometry.spatialDimensions.x.dimensionIndex,
    base.geometry.spatialDimensions.y.dimensionIndex,
  ])
  const axes: ScientificAxisDescriptor[] = ids.map((id, index) => {
    const kind = spatialIndices.has(index) ? 'space' : scientificAxisKind(axisKind(id))
    return Object.freeze({
      id,
      name: id,
      kind,
      length: base.array.shape[index] ?? 0,
      coordinates: Object.freeze({ type: 'index' as const }),
    })
  })
  const levels: ScientificResolutionLevel[] = state.levels.map((level) =>
    Object.freeze({
      level: level.order,
      axisLengths: Object.freeze(
        ids.map((axisId, index) =>
          Object.freeze({ axisId, length: level.array.shape[index] ?? 0 }),
        ),
      ),
      spatialReference: scientificSpatialReference(state.spatialReference, level.geometry),
    }),
  )
  return normalizeScientificDatasetDescriptor({
    schemaVersion: 1,
    axes: Object.freeze(axes),
    sampleType: base.array.dataType,
    components: Object.freeze([
      Object.freeze({ id: 'value', name: 'Component 0', kind: 'scalar' as const }),
    ]),
    levels: Object.freeze(levels),
    spatialReference: scientificSpatialReference(state.spatialReference, base.geometry),
    metadata: normalizeScientificMetadataObject({
      zarrFormat: conventionFormat(state.convention),
      geoZarrLevels: state.levels.map((level) => arrayInspection(level.path, level.array)),
    }),
    capabilities: Object.freeze({
      regionReads: true,
      resolutionLevels: state.levels.length > 1,
      planeReads: { kind: 'any-axis-pair' as const },
    }),
  })
}

const packDisplayOrder = (
  packed: Uint8Array,
  shape: readonly number[],
  horizontal: number,
  vertical: number,
  sampleBytes: number,
): Uint8Array => {
  const width = shape[horizontal] ?? 0
  const height = shape[vertical] ?? 0
  const output = new Uint8Array(width * height * sampleBytes)
  const strides = new Array<number>(shape.length)
  let stride = 1
  for (let index = shape.length - 1; index >= 0; index -= 1) {
    strides[index] = stride
    stride *= shape[index] ?? 1
  }
  const xStride = strides[horizontal] ?? 0
  const yStride = strides[vertical] ?? 0
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const source = (y * yStride + x * xStride) * sampleBytes
      output.set(packed.subarray(source, source + sampleBytes), (y * width + x) * sampleBytes)
    }
  }
  return output
}

const displayOrderIsPacked = (shape: readonly number[], horizontal: number): boolean => {
  for (let index = horizontal + 1; index < shape.length; index += 1) {
    if ((shape[index] ?? 1) > 1) return false
  }
  return true
}

class GeoZarrScientificDataset implements ScientificDataset {
  readonly descriptor: NormalizedScientificDatasetDescriptor
  readonly #store: ZarrStore
  readonly #levels: readonly OpenedLevel[]
  readonly #axisIds: readonly string[]
  readonly #limits: Readonly<GeoZarrReaderLimits>

  constructor(store: ZarrStore, state: DatasetState, limits: Readonly<GeoZarrReaderLimits>) {
    this.#store = store
    this.#levels = state.levels
    this.#limits = limits
    this.descriptor = scientificDescriptor(state)
    this.#axisIds = this.descriptor.axes.map((axis) => axis.id)
  }

  async *readPlane(request: Readonly<ScientificPlaneReadRequest>): AsyncIterable<RasterBlock> {
    const selected = normalizeScientificPlaneReadRequest(this.descriptor, request)
    const level = this.#levels.find((entry) => entry.order === selected.resolutionLevel)
    if (level === undefined) throw invalidInput('GeoZarr resolution level is missing')
    const horizontal = this.#axisIds.indexOf(selected.displayAxes[0] ?? '')
    const vertical = this.#axisIds.indexOf(selected.displayAxes[1] ?? '')
    if (horizontal < 0 || vertical < 0) throw invalidInput('GeoZarr display axes are invalid')
    const start = level.array.shape.map(() => 0)
    const shape = level.array.shape.map(() => 1)
    for (const fixed of selected.fixedIndices) {
      const axis = this.#axisIds.indexOf(fixed.axisId)
      if (axis < 0) throw invalidInput(`GeoZarr fixed axis ${fixed.axisId} is unknown`)
      start[axis] = fixed.index
    }
    start[horizontal] = selected.x
    start[vertical] = selected.y
    shape[horizontal] = selected.width
    const sampleBytes = rasterSampleBytes(level.array.dataType)
    const rowBytes = selected.width * sampleBytes
    if (rowBytes > this.#limits.maxRegionBytes)
      throw limitExceeded('GeoZarr row exceeds maxRegionBytes')
    const rows = Math.max(
      1,
      Math.min(this.#limits.rowsPerBlock, Math.floor(this.#limits.maxRegionBytes / rowBytes)),
    )
    const session = this.#store.createReadSession()
    try {
      for (let localY = 0; localY < selected.height; localY += rows) {
        throwIfAborted(selected.signal)
        const height = Math.min(rows, selected.height - localY)
        const blockStart = start.slice()
        const blockShape = shape.slice()
        blockStart[vertical] = selected.y + localY
        blockShape[vertical] = height
        const packed = await this.#store.readRegion(
          level.array,
          blockStart,
          blockShape,
          selected.signal,
          session,
        )
        const data = displayOrderIsPacked(blockShape, horizontal)
          ? packed
          : packDisplayOrder(packed, blockShape, horizontal, vertical, sampleBytes)
        yield Object.freeze({
          x: selected.x,
          y: selected.y + localY,
          width: selected.width,
          height,
          stride: rowBytes,
          format: Object.freeze({ sampleType: level.array.dataType, channels: 1, planar: false }),
          data,
          release() {
            data.fill(0)
          },
        })
      }
    } finally {
      session.release()
    }
  }
}

const spatialScale = (
  level: OpenedLevel,
): Readonly<{ readonly x: number; readonly y: number }> | undefined => {
  const scale = level.relativeScale
  if (scale === undefined) return undefined
  const xIndex = level.geometry.spatialDimensions.x.dimensionIndex
  const yIndex = level.geometry.spatialDimensions.y.dimensionIndex
  const compact = scale.length === 2
  const x = compact ? scale[1] : scale[xIndex]
  const y = compact ? scale[0] : scale[yIndex]
  return typeof x === 'number' && typeof y === 'number' && x > 0 && y > 0
    ? Object.freeze({ x, y })
    : undefined
}

const comparableAffineDownsample = (
  base: OpenedLevel,
  level: OpenedLevel,
): Readonly<{ readonly x: number; readonly y: number }> | undefined => {
  const [baseA, baseB, , baseD, baseE] = base.geometry.pixelToWorld
  const [levelA, levelB, , levelD, levelE] = level.geometry.pixelToWorld
  const baseX = Math.hypot(baseA, baseD)
  const baseY = Math.hypot(baseB, baseE)
  const levelX = Math.hypot(levelA, levelD)
  const levelY = Math.hypot(levelB, levelE)
  if ([baseX, baseY, levelX, levelY].some((value) => value === 0 || !Number.isFinite(value))) {
    return undefined
  }
  const parallel = (
    firstX: number,
    firstY: number,
    secondX: number,
    secondY: number,
    firstLength: number,
    secondLength: number,
  ): boolean =>
    Math.abs(firstX * secondY - firstY * secondX) <= firstLength * secondLength * 1e-9 &&
    firstX * secondX + firstY * secondY > 0
  if (
    !parallel(baseA, baseD, levelA, levelD, baseX, levelX) ||
    !parallel(baseB, baseE, levelB, levelE, baseY, levelY)
  ) {
    return undefined
  }
  return Object.freeze({ x: levelX / baseX, y: levelY / baseY })
}

const declaredDownsample = (
  level: OpenedLevel,
  base: OpenedLevel,
  levelsByPath: ReadonlyMap<string, OpenedLevel>,
  visiting: Set<string> = new Set(),
): Readonly<{ readonly x: number; readonly y: number }> | undefined => {
  if (level.path === base.path) return Object.freeze({ x: 1, y: 1 })
  const scale = spatialScale(level)
  if (scale === undefined || level.derivedFrom === undefined || visiting.has(level.path)) {
    return undefined
  }
  const parent = levelsByPath.get(level.derivedFrom)
  if (parent === undefined) return undefined
  visiting.add(level.path)
  const parentScale = declaredDownsample(parent, base, levelsByPath, visiting)
  visiting.delete(level.path)
  return parentScale === undefined
    ? undefined
    : Object.freeze({ x: parentScale.x * scale.x, y: parentScale.y * scale.y })
}

const levelDescriptor = (
  level: OpenedLevel,
  base: OpenedLevel,
  levelsByPath: ReadonlyMap<string, OpenedLevel>,
): GeoRasterLevel => {
  const inspection = arrayInspection(level.path, level.array)
  const resolution = Object.freeze({
    x: Math.hypot(level.geometry.pixelToWorld[0], level.geometry.pixelToWorld[3]),
    y: Math.hypot(level.geometry.pixelToWorld[1], level.geometry.pixelToWorld[4]),
  })
  const compression = inspection.codecs.join('+')
  const downsample =
    declaredDownsample(level, base, levelsByPath) ?? comparableAffineDownsample(base, level)
  return Object.freeze({
    id: level.id,
    ...(level.path.length === 0 ? {} : { arrayPath: level.path }),
    sourceResolutionLevel: level.order,
    sourceOrder: level.order,
    width: level.geometry.width,
    height: level.geometry.height,
    geometry: level.geometry,
    nominalResolution: resolution,
    ...(downsample === undefined ? {} : { downsample }),
    storage: Object.freeze({
      organization: 'chunked' as const,
      chunkShape: inspection.logicalChunkShape,
      ...(compression.length === 0 ? {} : { compression }),
      byteOrder:
        level.array.dataType === 'uint8' || level.array.dataType === 'int8'
          ? ('not-applicable' as const)
          : level.array.endian === 'little'
            ? ('little-endian' as const)
            : ('big-endian' as const),
      metadata: normalizeScientificMetadataObject({
        sharded: inspection.sharded,
        ...(inspection.outerShardShape === undefined
          ? {}
          : { outerShardShape: inspection.outerShardShape }),
        codecs: inspection.codecs,
        ...(level.resamplingMethod === undefined
          ? {}
          : { resamplingMethod: level.resamplingMethod }),
      }),
    }),
  })
}

const descriptorFor = (adapted: GeoRasterDataset, state: DatasetState): GeoRasterDescriptor => {
  const base = state.levels[0]
  if (base === undefined) throw invalidInput('GeoZarr dataset has no base level')
  const coordinateIds = new Set(state.coordinateArrays.keys())
  const names = base.array.dimensionNames ?? base.array.shape.map(() => null)
  const bandNames =
    Array.isArray(base.array.attributes.band_names) &&
    base.array.attributes.band_names.length <= 4_096
      ? base.array.attributes.band_names.filter(
          (entry): entry is string => typeof entry === 'string',
        )
      : undefined
  const axes: readonly GeoAxisDescriptor[] = Object.freeze(
    adapted.descriptor.axes.map((axis) => {
      const id = dimensionId(names[axis.dimensionIndex], axis.dimensionIndex)
      const kind = axisKind(id)
      const labels =
        kind === 'band' && bandNames?.length === axis.length
          ? Object.freeze([...bandNames])
          : undefined
      return Object.freeze({
        ...axis,
        kind,
        coordinates: coordinateIds.has(axis.id)
          ? Object.freeze({ kind: 'lazy' as const, valueType: 'number' as const })
          : labels === undefined
            ? axis.coordinates
            : Object.freeze({ kind: 'values' as const, values: labels }),
        ...(labels === undefined ? {} : { metadata: { labels } }),
      })
    }),
  )
  const levelsByPath = new Map(state.levels.map((level) => [level.path, level]))
  const levels = Object.freeze(
    state.levels.map((level) => levelDescriptor(level, base, levelsByPath)),
  )
  const identity = getScientificDatasetIdentity(adapted.scientificDataset)
  return normalizeGeoRasterDescriptor(
    {
      ...adapted.descriptor,
      ...(state.title === undefined ? {} : { title: state.title }),
      axes,
      bands: Object.freeze([bandFor(base.array)]),
      levels,
      primaryLevelId: levels[0]?.id ?? '0',
      spatialReference: state.spatialReference,
      grid: base.geometry,
      sourceFormat: Object.freeze({ id: 'geozarr', name: 'GeoZarr' }),
      formatEvidence: normalizeScientificMetadataObject({
        zarrFormat: conventionFormat(state.convention),
        registrations: state.convention.registrations.map((entry) => ({
          uuid: entry.uuid,
          name: entry.name ?? null,
          schemaUrl: entry.schemaUrl ?? null,
          specUrl: entry.specUrl ?? null,
          version: entry.version.selectedTag ?? null,
          versionStatus: entry.version.status,
        })),
        arrays: state.levels.map((level) => arrayInspection(level.path, level.array)),
        ...(identity === undefined ? {} : { sourceIdentity: identity }),
      }),
      diagnostics: state.diagnostics,
    },
    1,
  )
}

class GeoZarrDataset implements GeoRasterDataset {
  readonly descriptor: GeoRasterDescriptor
  readonly scientificDataset: ScientificDataset
  readonly #adapted: GeoRasterDataset
  readonly #store: ZarrStore
  readonly #coordinateArrays: ReadonlyMap<string, ZarrArrayMetadata>
  readonly #limits: Readonly<GeoZarrReaderLimits>

  constructor(
    adapted: GeoRasterDataset,
    state: DatasetState,
    store: ZarrStore,
    limits: Readonly<GeoZarrReaderLimits>,
  ) {
    this.#adapted = adapted
    this.scientificDataset = adapted.scientificDataset
    this.descriptor = descriptorFor(adapted, state)
    this.#store = store
    this.#coordinateArrays = state.coordinateArrays
    this.#limits = limits
  }

  createView(selection: Readonly<GeoRasterViewSelection>): GeoRasterView {
    const source = this.#adapted.createView(selection)
    return Object.freeze({
      dataset: this,
      selection: source.selection,
      level: this.descriptor.levels.find((level) => level.id === source.level.id) ?? source.level,
      readPixelRegion: source.readPixelRegion.bind(source),
      readWorldRegion: source.readWorldRegion.bind(source),
    })
  }

  async readAxisCoordinates(
    request: Readonly<GeoAxisCoordinateReadRequest>,
  ): Promise<GeoAxisCoordinateBlock> {
    const array = this.#coordinateArrays.get(request.axisId)
    if (array === undefined) return this.#adapted.readAxisCoordinates(request)
    if (
      !Number.isSafeInteger(request.start) ||
      !Number.isSafeInteger(request.length) ||
      request.start < 0 ||
      request.length < 1 ||
      request.length > this.#limits.maxCoordinateValues ||
      request.start + request.length > (array.shape[0] ?? 0)
    ) {
      throw invalidInput('GeoZarr coordinate read is outside its bounded axis range')
    }
    const bytes = await this.#store.readRegion(
      array,
      [request.start],
      [request.length],
      request.signal,
    )
    const block: RasterBlock = Object.freeze({
      x: request.start,
      y: 0,
      width: request.length,
      height: 1,
      stride: request.length * rasterSampleBytes(array.dataType),
      format: Object.freeze({ sampleType: array.dataType, channels: 1, planar: false }),
      data: bytes,
    })
    const tile = rasterBlockToNumericTile(block)
    try {
      const output: (number | string)[] = []
      for (let index = 0; index < tile.data.length; index += 1) {
        const value = tile.data[index]
        if (value !== undefined) output.push(typeof value === 'bigint' ? value.toString() : value)
      }
      const values = Object.freeze(output)
      return Object.freeze({ axisId: request.axisId, start: request.start, values })
    } finally {
      tile.release()
    }
  }
}

const coordinatePaths = (array: ZarrArrayMetadata): ReadonlyMap<string, string> => {
  const result = new Map<string, string>()
  const explicit = array.attributes.coordinate_arrays
  if (isRecord(explicit)) {
    for (const [axis, value] of Object.entries(explicit)) {
      if (typeof value === 'string')
        result.set(axis, boundedPath(value, `coordinate_arrays.${axis}`))
    }
  }
  if (typeof array.attributes.coordinates === 'string') {
    for (const token of array.attributes.coordinates.trim().split(/\s+/u)) {
      if (token.length > 0 && !result.has(token))
        result.set(token, boundedPath(token, 'coordinates'))
    }
  }
  return result
}

const openCoordinateArrays = async (
  store: ZarrStore,
  base: ZarrArrayMetadata,
  spatial: GeoGridGeometry,
  signal: AbortSignal | undefined,
): Promise<ReadonlyMap<string, ZarrArrayMetadata>> => {
  const output = new Map<string, ZarrArrayMetadata>()
  const names = base.dimensionNames ?? base.shape.map(() => null)
  const spatialIds = new Set([spatial.spatialDimensions.x.id, spatial.spatialDimensions.y.id])
  for (const [axisName, path] of coordinatePaths(base)) {
    if (spatialIds.has(axisName)) continue
    const index = names.indexOf(axisName)
    if (index < 0) continue
    const array = await store.openArray(path, signal)
    if (array.shape.length !== 1 || array.shape[0] !== base.shape[index]) {
      throw invalidInput(`GeoZarr coordinate array ${path} does not match axis ${axisName}`)
    }
    output.set(dimensionId(names[index], index), array)
  }
  return output
}

const arrayNodeType = async (
  store: ZarrStore,
  path: string,
  signal: AbortSignal | undefined,
): Promise<'array' | 'group' | undefined> => {
  const arrayJson = await store.readJsonOptional(
    metadataObjectFor(store.format, path, 'array'),
    signal,
  )
  if (arrayJson !== undefined) return parseZarrNodeJson(arrayJson)?.nodeType ?? 'array'
  const groupJson = await store.readJsonOptional(
    metadataObjectFor(store.format, path, 'group'),
    signal,
  )
  return groupJson === undefined ? undefined : (parseZarrNodeJson(groupJson)?.nodeType ?? 'group')
}

const openLayoutArray = async (
  store: ZarrStore,
  asset: string,
  signal: AbortSignal | undefined,
): Promise<{
  readonly semanticPath: string
  readonly arrayPath: string
  readonly array: ZarrArrayMetadata
}> => {
  const type = await arrayNodeType(store, asset, signal)
  if (type === 'array')
    return { semanticPath: asset, arrayPath: asset, array: await store.openArray(asset, signal) }
  if (type === 'group') {
    const nested = `${asset}/data`
    if ((await arrayNodeType(store, nested, signal)) === 'array') {
      return {
        semanticPath: asset,
        arrayPath: nested,
        array: await store.openArray(nested, signal),
      }
    }
  }
  throw invalidInput(
    `GeoZarr layout asset ${asset} does not resolve to an array or a group/data array`,
  )
}

const titleFrom = (attributes: Readonly<Record<string, unknown>>, fallback: string): string =>
  typeof attributes.title === 'string' &&
  attributes.title.length > 0 &&
  attributes.title.length <= 4_096
    ? attributes.title
    : fallback

const buildStates = async (
  root: ZarrRoot,
  options: Readonly<GeoZarrReaderOptions>,
  limits: Readonly<GeoZarrReaderLimits>,
  signal: AbortSignal | undefined,
): Promise<readonly DatasetState[]> => {
  const mode = options.conventionMode ?? 'strict'
  if (mode !== 'strict' && mode !== 'compatibility') {
    throw invalidInput('GeoZarr conventionMode must be strict or compatibility')
  }
  if (root.nodeType === 'array') {
    const array = root.metadata as ZarrArrayMetadata
    const source = nodeSource(root.format, 'array', '', array)
    const convention = standaloneConvention(source, mode, options.conventionLimits)
    const spatial = convention.node.spatial
    if (spatial?.affine === undefined)
      throw unsupportedFormat('Zarr root array has no usable GeoZarr spatial transform')
    const geometry = geometryFor(array, spatial, spatial.affine)
    const diagnostics = convention.diagnostics.map(geoDiagnostic)
    const reference = convention.node.proj?.spatialReference ?? unknownSpatialReference('root')
    const level: OpenedLevel = Object.freeze({ id: '0', path: '', order: 0, array, geometry })
    const coordinates = await openCoordinateArrays(root.store, array, geometry, signal)
    return Object.freeze([
      {
        id: 'root',
        title: titleFrom(array.attributes, 'GeoZarr root array'),
        levels: Object.freeze([level]),
        convention,
        spatialReference: reference,
        diagnostics: Object.freeze(diagnostics),
        coordinateArrays: coordinates,
      },
    ])
  }
  const group = root.metadata as ZarrGroupMetadata
  const groupSource = nodeSource(root.format, 'group', '', group)
  const discovery = parseGeoZarrConventionMetadata(
    { group: groupSource },
    {
      mode: 'compatibility',
      ...(options.conventionLimits === undefined ? {} : { limits: options.conventionLimits }),
    },
  )
  const layouts = discovery.multiscales?.layout ?? []
  if (layouts.length > limits.maxLevels)
    throw limitExceeded('GeoZarr multiscale levels exceed maxLevels')
  if (layouts.length > 0) {
    const opened = await Promise.all(
      layouts.map((layout) => openLayoutArray(root.store, layout.asset, signal)),
    )
    const children = opened.map((entry) =>
      nodeSource(root.format, 'array', entry.semanticPath, entry.array),
    )
    const convention = parseGeoZarrConventionMetadata(
      { group: groupSource, children, availablePaths: layouts.map((layout) => layout.asset) },
      {
        mode,
        ...(options.conventionLimits === undefined ? {} : { limits: options.conventionLimits }),
      },
    )
    const arrays = new Map(opened.map((entry) => [entry.semanticPath, entry.array]))
    const diagnostics = convention.diagnostics.map(geoDiagnostic)
    const levels = createLevelStates(arrays, convention, diagnostics)
    assertLevelCompatibility(levels)
    const base = levels[0]
    if (base === undefined) throw invalidInput('GeoZarr multiscale dataset has no base level')
    const reference =
      convention.levels[0]?.proj?.spatialReference ??
      convention.crs ??
      unknownSpatialReference('root')
    const coordinates = await openCoordinateArrays(root.store, base.array, base.geometry, signal)
    return Object.freeze([
      {
        id: 'multiscales',
        title: titleFrom(group.attributes, 'GeoZarr multiscale raster'),
        levels,
        convention,
        spatialReference: reference,
        diagnostics: Object.freeze(diagnostics),
        coordinateArrays: coordinates,
      },
    ])
  }
  const candidates = normalizeCandidatePaths(options.candidateArrayPaths)
  if (candidates.length === 0) {
    throw unsupportedFormat(
      'GeoZarr group has no multiscales layout; provide bounded candidateArrayPaths instead of enumerating the store',
    )
  }
  if (candidates.length > limits.maxDatasets)
    throw limitExceeded('GeoZarr datasets exceed maxDatasets')
  const states: DatasetState[] = []
  for (const path of candidates) {
    const array = await root.store.openArray(path, signal)
    const child = nodeSource(root.format, 'array', path, array)
    const convention = parseGeoZarrConventionMetadata(
      { group: groupSource, children: [child] },
      {
        mode,
        ...(options.conventionLimits === undefined ? {} : { limits: options.conventionLimits }),
      },
    )
    const normalized = convention.children[0]
    if (normalized === undefined) throw invalidInput(`GeoZarr array ${path} was not composed`)
    const spatial = normalized.spatial
    if (spatial?.affine === undefined)
      throw unsupportedFormat(`GeoZarr array ${path} has no usable spatial transform`)
    const geometry = geometryFor(array, spatial, spatial.affine)
    const level: OpenedLevel = Object.freeze({ id: '0', path, order: 0, array, geometry })
    states.push({
      id: path,
      title: titleFrom(array.attributes, path),
      levels: Object.freeze([level]),
      convention,
      spatialReference:
        normalized.proj?.spatialReference ?? convention.crs ?? unknownSpatialReference(path),
      diagnostics: Object.freeze(convention.diagnostics.map(geoDiagnostic)),
      coordinateArrays: await openCoordinateArrays(root.store, array, geometry, signal),
    })
  }
  return Object.freeze(states)
}

const emptyIo = (): GeoZarrIoReport =>
  Object.freeze({
    metadataRequests: 0,
    metadataBytes: 0,
    chunkRequests: 0,
    chunkBytes: 0,
    uniqueBytes: 0,
    cacheHits: 0,
    coalescedConsumers: 0,
    cancelledReads: 0,
    sourceCacheBytes: 0,
    logicalChunkReads: 0,
    outerShardAccesses: 0,
    uniqueShardObjects: 0,
    shardIndexReads: 0,
    shardPayloadRanges: 0,
  })

const storeIo = (store: ZarrStoreDiagnostics): GeoZarrIoReport =>
  Object.freeze({
    metadataRequests: store.metadataReadRequests,
    metadataBytes: store.metadataReadBytes,
    chunkRequests: store.chunkReadRequests,
    chunkBytes: store.chunkReadBytes,
    uniqueBytes: store.metadataReadBytes + store.chunkReadBytes,
    cacheHits: store.metadataCacheHits + store.chunkCacheHits,
    coalescedConsumers: 0,
    cancelledReads: store.cancelledReads,
    sourceCacheBytes: store.chunkCacheBytes,
    logicalChunkReads: store.logicalChunkReads,
    outerShardAccesses: store.outerShardAccesses,
    uniqueShardObjects: store.uniqueShardObjects,
    shardIndexReads: store.shardIndexReads,
    shardPayloadRanges: store.shardPayloadRanges,
  })

const httpIo = (stats: ZarrHttpStoreStats, store: ZarrStoreDiagnostics): GeoZarrIoReport =>
  Object.freeze({
    metadataRequests: stats.metadataRequests,
    metadataBytes: stats.metadataBytesFetched,
    chunkRequests: stats.arrayRequests,
    chunkBytes: stats.arrayBytesFetched,
    uniqueBytes: stats.uniqueBytes,
    cacheHits: stats.sourceCacheHits + store.metadataCacheHits + store.chunkCacheHits,
    coalescedConsumers: stats.coalescedConsumers,
    cancelledReads: stats.abortedConsumers + store.cancelledReads,
    sourceCacheBytes: stats.sourceCacheBytes,
    logicalChunkReads: store.logicalChunkReads,
    outerShardAccesses: store.outerShardAccesses,
    uniqueShardObjects: store.uniqueShardObjects,
    shardIndexReads: store.shardIndexReads,
    shardPayloadRanges: store.shardPayloadRanges,
  })

class GeoZarrDocumentImpl implements GeoZarrDocument {
  readonly reader = Object.freeze({
    id: geoZarrReaderDescriptor.id,
    version: geoZarrReaderDescriptor.version,
  })
  readonly format = 'GeoZarr'
  readonly metadata: GeoMetadataObject
  readonly datasets: GeoRasterDocument['datasets']
  readonly #store: ZarrStore
  readonly #root: ZarrRoot
  readonly #states: readonly DatasetState[]
  readonly #storeKind: GeoZarrStoreKind
  readonly #io: (() => GeoZarrIoReport) | undefined
  #closed = false

  constructor(
    root: ZarrRoot,
    states: readonly DatasetState[],
    scientificDatasets: ReadonlyMap<string, ScientificDataset>,
    limits: Readonly<GeoZarrReaderLimits>,
    storeKind: GeoZarrStoreKind,
    io?: () => GeoZarrIoReport,
  ) {
    this.#root = root
    this.#store = root.store
    this.#states = states
    this.#storeKind = storeKind
    this.#io = io
    this.metadata = normalizeScientificMetadataObject({
      zarrFormat: root.format,
      rootNodeType: root.nodeType,
      rootMetadataObject: root.metadataObject,
      storeKind,
    })
    this.datasets = Object.freeze(
      states.map((state) => {
        const scientific = scientificDatasets.get(state.id)
        if (scientific === undefined)
          throw invalidInput(`GeoZarr dataset ${state.id} has no source`)
        const xAxisId = state.levels[0]?.geometry.spatialDimensions.x.id
        const yAxisId = state.levels[0]?.geometry.spatialDimensions.y.id
        const adapted = adaptScientificDatasetToGeo(scientific, {
          datasetId: state.id,
          ...(state.title === undefined ? {} : { title: state.title }),
          ...(xAxisId === undefined ? {} : { xAxisId }),
          ...(yAxisId === undefined ? {} : { yAxisId }),
          axisKinds: Object.fromEntries(
            scientific.descriptor.axes.map((axis) => [axis.id, axisKind(axis.id)]),
          ),
          sourceFormat: { id: 'geozarr', name: 'GeoZarr' },
        })
        if (!adapted.ok)
          throw invalidInput(adapted.diagnostics[0]?.message ?? 'GeoZarr adaptation failed')
        const dataset = new GeoZarrDataset(adapted.dataset, state, root.store, limits)
        state.dataset = dataset
        return Object.freeze({
          id: state.id,
          ...(state.title === undefined ? {} : { name: state.title }),
          descriptor: dataset.descriptor,
          diagnostics: state.diagnostics,
        })
      }),
    )
  }

  async openDataset(id: string, options: Readonly<AbortOptions> = {}): Promise<GeoRasterDataset> {
    if (this.#closed) throw invalidInput('GeoZarr document is closed')
    throwIfAborted(options.signal)
    const state = this.#states.find((entry) => entry.id === id)
    if (state?.dataset === undefined) throw invalidInput(`GeoZarr dataset ${id} is unavailable`)
    return state.dataset
  }

  inspectStructure(): GeoZarrStructuralReport {
    const store = this.#store.diagnostics()
    const conventions = Object.freeze(
      this.#states.flatMap((state) => state.convention.registrations),
    )
    return Object.freeze({
      reportKind: 'structural-diagnostic',
      zarrFormat: this.#root.format,
      storeKind: this.#storeKind,
      rootNodeType: this.#root.nodeType,
      rootMetadataObject: this.#root.metadataObject,
      conventions,
      datasets: Object.freeze(
        this.#states.map((state) =>
          Object.freeze({
            id: state.id,
            ...(state.title === undefined ? {} : { title: state.title }),
            levels: Object.freeze(
              state.levels.map((level) =>
                Object.freeze({
                  id: level.id,
                  order: level.order,
                  array: arrayInspection(level.path, level.array),
                  geometry: level.geometry,
                  ...(level.relativeScale === undefined
                    ? {}
                    : { relativeScale: level.relativeScale }),
                  ...(level.relativeTranslation === undefined
                    ? {}
                    : { relativeTranslation: level.relativeTranslation }),
                  ...(level.resamplingMethod === undefined
                    ? {}
                    : { resamplingMethod: level.resamplingMethod }),
                }),
              ),
            ),
            diagnostics: state.diagnostics,
          }),
        ),
      ),
      store,
      io: this.#io?.() ?? storeIo(store),
      compatibilityWarnings: Object.freeze(
        this.#states.flatMap((state) =>
          state.convention.diagnostics.filter((entry) => entry.severity !== 'error'),
        ),
      ),
    })
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    await this.#store.close()
  }
}

interface InternalOpenOptions extends GeoZarrReaderOptions, AbortOptions {
  readonly storeKind: GeoZarrStoreKind
  readonly io?: (store: ZarrStore) => GeoZarrIoReport
}

const openRoot = async (
  root: ZarrRoot,
  options: Readonly<InternalOpenOptions>,
): Promise<GeoZarrDocument> => {
  const limits = resolveLimits(options.limits)
  try {
    const states = await buildStates(root, options, limits, options.signal)
    if (states.length === 0) throw unsupportedFormat('Zarr store contains no GeoZarr datasets')
    const scientificDatasets = new Map<string, ScientificDataset>()
    for (const state of states) {
      const scientific = new GeoZarrScientificDataset(root.store, state, limits)
      const metadataPaths = [
        metadataObjectFor(root.format, '', root.nodeType),
        ...(attributesObjectFor(root.format, '') === undefined
          ? []
          : [attributesObjectFor(root.format, '') ?? '']),
        ...state.levels.flatMap((level) => [
          metadataObjectFor(root.format, level.array.path, 'array'),
          ...(attributesObjectFor(root.format, level.array.path) === undefined
            ? []
            : [attributesObjectFor(root.format, level.array.path) ?? '']),
        ]),
        ...[...state.coordinateArrays.values()].flatMap((array) => [
          metadataObjectFor(root.format, array.path, 'array'),
          ...(attributesObjectFor(root.format, array.path) === undefined
            ? []
            : [attributesObjectFor(root.format, array.path) ?? '']),
        ]),
      ]
      const resources = await root.store.identityResources(metadataPaths, options.signal)
      const identity = await createScientificDatasetIdentity({
        reader: { id: geoZarrReaderDescriptor.id, version: geoZarrReaderDescriptor.version },
        datasetId: state.id,
        resources,
      })
      identifyScientificDataset(scientific, identity)
      scientificDatasets.set(state.id, scientific)
    }
    return new GeoZarrDocumentImpl(
      root,
      states,
      scientificDatasets,
      limits,
      options.storeKind,
      options.io === undefined ? undefined : () => options.io?.(root.store) ?? emptyIo(),
    )
  } catch (error) {
    await root.store.close()
    throw error
  }
}

const openObjectStore = async (
  objectStore: ZarrObjectStore,
  options: Readonly<OpenGeoZarrObjectStoreOptions>,
  io?: (store: ZarrStore) => GeoZarrIoReport,
): Promise<GeoZarrDocument> => {
  const limits = resolveLimits(options.limits)
  try {
    const root = await discoverZarrRoot(objectStore, options.primaryName, limits, options.signal)
    return await openRoot(root, {
      ...options,
      limits,
      storeKind: options.storeKind ?? 'object-store',
      ...(io === undefined ? {} : { io }),
    })
  } catch (error) {
    await objectStore.close?.()
    throw error
  }
}

export const openGeoZarrObjectStore = async (
  objectStore: GeoZarrObjectStore,
  options: Readonly<OpenGeoZarrObjectStoreOptions> = {},
): Promise<GeoZarrDocument> => openObjectStore(objectStore, options)

export const openGeoZarrHttp = async (
  input: string | URL,
  options: Readonly<OpenGeoZarrHttpOptions> = {},
): Promise<GeoZarrDocument> => {
  const objectStore = new ZarrHttpObjectStore(input, {
    ...options.http,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
  try {
    const primary = await objectStore.openRootObject()
    return await openObjectStore(
      objectStore,
      {
        ...options,
        primaryName: primary.id,
        storeKind: 'http',
      },
      (store) => httpIo(objectStore.stats(), store.diagnostics()),
    )
  } catch (error) {
    objectStore.close()
    throw error
  }
}

const contextObjectStore = (
  primaryName: string,
  primary: ZarrObject,
  companions: ScientificCompanionResolver | undefined,
): ZarrObjectStore =>
  Object.freeze({
    async resolve(relative: string, signal?: AbortSignal): Promise<ZarrObject | undefined> {
      if (relative === primaryName) return primary
      if (companions === undefined) return undefined
      return companions.resolve(
        { kind: 'relative-name', name: relative },
        signal === undefined ? {} : { signal },
      )
    },
  })

const primaryMetadataName = (context: Readonly<ScientificOpenContext>, json: unknown): string => {
  const name = context.primary.name
  if (name !== undefined && /(?:^|\/)(?:zarr\.json|\.zgroup|\.zarray|\.zattrs)$/u.test(name)) {
    return name
  }
  const node = parseZarrNodeJson(json)
  if (node?.format === 2) return node.nodeType === 'array' ? '.zarray' : '.zgroup'
  return 'zarr.json'
}

const openContextRoot = async (
  context: Readonly<ScientificOpenContext>,
  limits: Readonly<GeoZarrReaderLimits>,
): Promise<{ readonly root: ZarrRoot; readonly storeKind: GeoZarrStoreKind }> => {
  const prefix = await context.primary.source.read(0, Math.min(context.primary.source.size, 4), {
    ...(context.signal === undefined ? {} : { signal: context.signal }),
  })
  if (isZipBytes(prefix)) {
    const opened = await openZarrZipStore(context.primary.source, {
      limits,
      ...(limits.zip === undefined ? {} : { zip: limits.zip }),
      identityResource: context.primary,
      ...(context.signal === undefined ? {} : { signal: context.signal }),
    })
    const node = parseZarrNodeJson(opened.json)
    if (node === undefined) throw invalidInput('GeoZarr ZIP root metadata is invalid')
    const metadata =
      node.nodeType === 'array'
        ? await opened.store.openArray('', context.signal)
        : await opened.store.openGroup('', context.signal)
    return {
      root: Object.freeze({
        metadataObject: opened.metadataObject,
        ...node,
        store: opened.store,
        metadata,
      }),
      storeKind: 'zip',
    }
  }
  if (context.primary.source.size > limits.maxMetadataBytes) {
    throw limitExceeded('GeoZarr root metadata exceeds maxMetadataBytes')
  }
  const bytes = await readExactly(context.primary.source, 0, context.primary.source.size, {
    ...(context.signal === undefined ? {} : { signal: context.signal }),
  })
  const json = readZarrJsonBytes(bytes)
  const name = primaryMetadataName(context, json)
  const resolver = contextObjectStore(name, context.primary, context.companions)
  return {
    root: await discoverZarrRoot(resolver, name, limits, context.signal),
    storeKind: 'scientific-context',
  }
}

const probeAttributes = (json: unknown): Readonly<Record<string, unknown>> | undefined => {
  if (!isRecord(json)) return undefined
  return isRecord(json.attributes) ? json.attributes : json
}

const hasKnownGeoZarrUuid = (
  attributes: Readonly<Record<string, unknown>> | undefined,
): boolean => {
  if (!Array.isArray(attributes?.zarr_conventions)) return false
  const known = new Set([
    'f17cb550-5864-4468-aeb7-f3180cfb622f',
    '689b58e2-cf7b-45e0-9fff-9cfc0883d6b4',
    'd35379db-88df-4056-af3a-620245f8e347',
  ])
  return attributes.zarr_conventions.some(
    (entry) => isRecord(entry) && typeof entry.uuid === 'string' && known.has(entry.uuid),
  )
}

const resourceHasGeoZarrHint = (context: Readonly<ScientificOpenContext>): boolean => {
  const name = context.primary.name?.toLowerCase() ?? ''
  const mediaType = context.primary.mediaType?.toLowerCase()
  return (
    name.endsWith('.zarr') ||
    name.endsWith('.zarr.zip') ||
    name.endsWith('/zarr.json') ||
    name.endsWith('/.zgroup') ||
    mediaType === 'application/x-zarr' ||
    mediaType === 'application/vnd+zarr'
  )
}

const probeGeoZarr = async (
  context: Readonly<ScientificOpenContext>,
  limits: Readonly<GeoZarrReaderLimits>,
): Promise<{ readonly confidence: number; readonly reason?: string }> => {
  const size = Math.min(context.primary.source.size, Math.min(limits.maxMetadataBytes, 16_384))
  if (size < 2) return { confidence: 0 }
  const bytes = await context.primary.source.read(0, size, {
    ...(context.signal === undefined ? {} : { signal: context.signal }),
  })
  if (isZipBytes(bytes)) {
    return resourceHasGeoZarrHint(context)
      ? { confidence: 0.35, reason: 'ZIP store with a GeoZarr-compatible name or media type' }
      : { confidence: 0 }
  }
  const json = readZarrJsonBytes(bytes)
  if (hasKnownGeoZarrUuid(probeAttributes(json))) {
    return { confidence: 0.98, reason: 'Known GeoZarr convention UUID in root metadata' }
  }
  const hinted = resourceHasGeoZarrHint(context)
  return hinted
    ? { confidence: 0.2, reason: 'Zarr name hint without confirming GeoZarr conventions' }
    : { confidence: 0 }
}

export const createGeoZarrReader = (
  options: Readonly<GeoZarrReaderOptions> = {},
): GeoZarrReader => {
  const limits = resolveLimits(options.limits)
  normalizeCandidatePaths(options.candidateArrayPaths)
  return Object.freeze({
    descriptor: geoZarrReaderDescriptor,
    probe(context: Readonly<ScientificOpenContext>) {
      return probeGeoZarr(context, limits)
    },
    async open(context: Readonly<ScientificOpenContext>): Promise<GeoZarrDocument> {
      const opened = await openContextRoot(context, limits)
      return openRoot(opened.root, {
        ...options,
        limits,
        ...(context.signal === undefined ? {} : { signal: context.signal }),
        storeKind: opened.storeKind,
      })
    },
  })
}

export const geoZarrReader = createGeoZarrReader()
