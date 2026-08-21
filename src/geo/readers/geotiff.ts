import type { AbortOptions } from '../../abort.ts'
import { throwIfAborted } from '../../abort.ts'
import { invalidInput, unsupportedFormat } from '../../errors.ts'
import type { GeoTiffKey, GeoTiffProfile } from '../../geotiff.ts'
import type { ScientificOpenContext, ScientificReaderDescriptor } from '../../scientific/reader.ts'
import { createTiffReader } from '../../scientific/readers/tiff.ts'
import {
  getTiffScientificDocumentBridge,
  type TiffScientificDatasetBridge,
  type TiffScientificDocumentBridge,
} from '../../scientific/readers/tiff-bridge.ts'
import { HttpRangeSource, type HttpRangeSourceStats } from '../../sources/http-range.ts'
import { inspectCog, type CogDirectoryInspection, type CogInspectionIssue } from '../../tiff/cog.ts'
import { tiffCompressionName } from '../../tiff/compressions.ts'
import type { TiffDirectory } from '../../tiff/types.ts'
import type {
  GeoBandDescriptor,
  GeoCrsEvidence,
  GeoDiagnostic,
  GeoDiagnosticCode,
  GeoMetadataObject,
  GeoRasterDataset,
  GeoRasterDescriptor,
  GeoRasterLevel,
  GeoRasterView,
  GeoRasterViewSelection,
  GeoSpatialReference,
  GeoUnitDescriptor,
} from '../contracts.ts'
import { createGeoDiagnostic, normalizeGeoRasterDescriptor } from '../contracts.ts'
import { geoCrsStateFromEvidence } from '../crs.ts'
import { adaptScientificDatasetToGeo } from '../scientific-adapter.ts'
import type { GeoRasterDocument, GeoRasterReader } from './index.ts'

export interface GeoTiffReaderOptions {
  /** Aggregate admitted GeoTIFF and optional TIFF metadata. Defaults to 64 KiB. */
  readonly maxMetadataBytes?: number
  /** Largest admitted optional metadata tag. Defaults to 16 KiB. */
  readonly maxMetadataTagBytes?: number
}

export interface GeoTiffKeyEvidence {
  readonly id: number
  readonly name?: string
  readonly recognized: boolean
  readonly location: number
  readonly count: number
  readonly offset: number
  readonly value: number | string | readonly number[] | null
  readonly unavailableReason?: string
}

export interface GeoTiffMetadataDiagnostic {
  readonly code:
    | 'INCONSISTENT_TIEPOINT'
    | 'UNSUPPORTED_GCP_WARP'
    | 'UNSUPPORTED_PROJECTIVE_TRANSFORM'
  readonly severity: 'warning' | 'error'
  readonly message: string
  readonly tiepointIndex?: number
}

export interface GeoTiffIoReport {
  readonly requests: number
  readonly transferredBytes: number
  readonly uniqueBytes: number
  readonly rangeCacheHits: number
  readonly rangeCacheBytes: number
  readonly coalescedConsumers: number
  readonly abortedConsumers: number
  readonly encodedCache: {
    readonly hits: number
    readonly misses: number
    readonly entries: number
    readonly residentBytes: number
  }
}

export interface GeoTiffGeospatialInspection {
  readonly path: string
  readonly rasterType: 'pixel-is-area' | 'pixel-is-point' | 'unspecified'
  readonly projectedCrs?: number
  readonly geographicCrs?: number
  readonly verticalCrs?: number
  readonly affine?: readonly number[]
  readonly bounds?: {
    readonly minX: number
    readonly minY: number
    readonly maxX: number
    readonly maxY: number
  }
  readonly keyCount: number
  readonly unknownKeys: readonly GeoTiffKeyEvidence[]
  readonly diagnostics: readonly GeoTiffMetadataDiagnostic[]
}

export interface GeoTiffStructuralReport {
  readonly reportKind: 'structural-diagnostic'
  readonly formalCogCertification: false
  readonly container: 'TIFF' | 'BigTIFF'
  readonly byteOrder: 'little-endian' | 'big-endian'
  readonly objectSize: number
  readonly topLevelDirectoryCount: number
  readonly directories: readonly CogDirectoryInspection[]
  readonly overviewDimensions: readonly { readonly width: number; readonly height: number }[]
  readonly geospatialMetadata: readonly GeoTiffGeospatialInspection[]
  readonly rangeReadSuitability: 'suitable' | 'limited' | 'not-applicable'
  readonly likelyCog: boolean
  readonly issues: readonly CogInspectionIssue[]
  readonly io: GeoTiffIoReport
}

export interface GeoTiffDocument extends GeoRasterDocument {
  inspectStructure(): Promise<GeoTiffStructuralReport>
}

export interface GeoTiffReader extends GeoRasterReader {
  open(context: Readonly<ScientificOpenContext>): Promise<GeoTiffDocument>
}

export const geoTiffReaderDescriptor: ScientificReaderDescriptor = Object.freeze({
  id: 'purejsimage/geo/geotiff',
  version: '1.0.0',
  format: 'GeoTIFF',
  extensions: Object.freeze(['tif', 'tiff', 'geotiff']),
  mediaTypes: Object.freeze(['image/tiff', 'image/geotiff', 'image/x-geotiff']),
  capabilities: Object.freeze({
    datasets: 'geo-raster-series',
    rangeReads: true,
    resolutionLevels: true,
    structuralDiagnostics: true,
  }),
})

const jsonNumber = (value: number): number | string => {
  if (Number.isFinite(value)) return value
  if (Number.isNaN(value)) return 'NaN'
  return value > 0 ? 'Infinity' : '-Infinity'
}

const keyMetadata = (key: GeoTiffKey): GeoMetadataObject => ({
  id: key.id,
  name: key.name ?? null,
  recognized: key.recognized,
  location: key.location,
  count: key.count,
  offset: key.offset,
  value:
    key.value === null
      ? null
      : Array.isArray(key.value)
        ? key.value.map(jsonNumber)
        : typeof key.value === 'number'
          ? jsonNumber(key.value)
          : key.value,
  unavailableReason: key.unavailableReason ?? null,
})

const profileMetadata = (profile: GeoTiffProfile): GeoMetadataObject => ({
  modelType: profile.modelType ?? null,
  rasterType: profile.rasterType,
  projectedCrs: profile.projectedCrs ?? null,
  geographicCrs: profile.geographicCrs ?? null,
  verticalCrs: profile.verticalCrs ?? null,
  verticalDatum: profile.verticalDatum ?? null,
  verticalUnits: profile.verticalUnits ?? null,
  citations: {
    model: profile.modelCitation ?? null,
    projected: profile.projectedCitation ?? null,
    geographic: profile.geographicCitation ?? null,
    vertical: profile.verticalCitation ?? null,
  },
  keys: [...profile.keys.values()].map(keyMetadata),
  tiepoints: profile.tiepoints.map(({ raster, model }) => ({
    raster: [raster.x, raster.y, raster.z],
    model: [model.x, model.y, model.z],
  })),
  pixelScale:
    profile.pixelScale === undefined
      ? null
      : [profile.pixelScale.x, profile.pixelScale.y, profile.pixelScale.z],
  modelTransformation: profile.modelTransformation?.map(jsonNumber) ?? null,
  gdalMetadata: profile.gdalMetadata.map((item) => ({ ...item })),
  noData:
    profile.noData === undefined
      ? null
      : Array.isArray(profile.noData)
        ? profile.noData.map((value) => (typeof value === 'number' ? jsonNumber(value) : value))
        : typeof profile.noData === 'number'
          ? jsonNumber(profile.noData)
          : profile.noData,
  diagnostics: profile.diagnostics.map(({ code, severity, message, tiepointIndex }) => ({
    code,
    severity,
    message,
    tiepointIndex: tiepointIndex ?? null,
  })),
})

const linearUnit = (
  code: number | undefined,
  size: number | undefined,
): GeoUnitDescriptor | undefined => {
  if (code === 9_001) return Object.freeze({ name: 'metre', symbol: 'm', conversionToSI: 1 })
  if (code === 9_002)
    return Object.freeze({ name: 'international foot', symbol: 'ft', conversionToSI: 0.3048 })
  if (code === 9_003)
    return Object.freeze({
      name: 'US survey foot',
      symbol: 'ftUS',
      conversionToSI: 1200 / 3937,
    })
  if (size !== undefined && Number.isFinite(size) && size > 0) {
    return Object.freeze({ name: 'user-defined linear unit', conversionToSI: size })
  }
  return undefined
}

const angularUnit = (
  code: number | undefined,
  size: number | undefined,
): GeoUnitDescriptor | undefined => {
  if (code === 9_101) return Object.freeze({ name: 'radian', symbol: 'rad', conversionToSI: 1 })
  if (code === 9_102)
    return Object.freeze({ name: 'degree', symbol: 'deg', conversionToSI: Math.PI / 180 })
  if (code === 9_103)
    return Object.freeze({ name: 'arc-minute', symbol: 'arcmin', conversionToSI: Math.PI / 10_800 })
  if (code === 9_104)
    return Object.freeze({
      name: 'arc-second',
      symbol: 'arcsec',
      conversionToSI: Math.PI / 648_000,
    })
  if (code === 9_105 || code === 9_106)
    return Object.freeze({ name: code === 9_105 ? 'grad' : 'gon', conversionToSI: Math.PI / 200 })
  if (size !== undefined && Number.isFinite(size) && size > 0) {
    return Object.freeze({ name: 'user-defined angular unit', conversionToSI: size })
  }
  return undefined
}

const epsgCode = (value: number | undefined): number | undefined =>
  value === undefined || value <= 0 || value === 32_767 ? undefined : value

const diagnosticCode = (code: GeoTiffProfile['diagnostics'][number]['code']): GeoDiagnosticCode => {
  if (code === 'INCONSISTENT_TIEPOINT') return 'geotiff-inconsistent-tiepoint'
  if (code === 'UNSUPPORTED_GCP_WARP') return 'geotiff-unsupported-gcp-warp'
  return 'geotiff-unsupported-projective-transform'
}

const profileDiagnostics = (profile: GeoTiffProfile, path: string): readonly GeoDiagnostic[] =>
  Object.freeze(
    profile.diagnostics.map((diagnostic) =>
      createGeoDiagnostic({
        severity: diagnostic.severity,
        code: diagnosticCode(diagnostic.code),
        message: diagnostic.message,
        path,
        ...(diagnostic.tiepointIndex === undefined
          ? {}
          : { metadata: { tiepointIndex: diagnostic.tiepointIndex } }),
      }),
    ),
  )

const spatialReference = (
  source: GeoSpatialReference,
  profile: GeoTiffProfile,
  datasetId: string,
): GeoSpatialReference => {
  const projected = epsgCode(profile.projectedCrs)
  const geographic = epsgCode(profile.geographicCrs)
  const vertical = epsgCode(profile.verticalCrs)
  const code = projected ?? geographic
  const coordinateSystemType =
    profile.modelType === 1 || profile.projectedCrs !== undefined
      ? ('projected' as const)
      : profile.modelType === 2 || profile.geographicCrs !== undefined
        ? ('geographic' as const)
        : ('unknown' as const)
  const horizontalUnit =
    coordinateSystemType === 'projected'
      ? linearUnit(profile.projectedLinearUnits, profile.projectedLinearUnitSize)
      : angularUnit(profile.angularUnits, profile.angularUnitSize)
  const verticalUnit = linearUnit(profile.verticalUnits, undefined)
  const citation =
    coordinateSystemType === 'projected'
      ? (profile.projectedCitation ?? profile.modelCitation)
      : (profile.geographicCitation ?? profile.modelCitation)
  const evidence: GeoCrsEvidence[] = [
    ...source.evidence,
    Object.freeze({
      kind: 'embedded' as const,
      sourceId: datasetId,
      locator: `TIFF IFD ${profile.directory.index} GeoTIFF tags`,
      ...(citation === undefined ? {} : { citation }),
      metadata: profileMetadata(profile),
    }),
    ...[
      profile.modelCitation,
      profile.projectedCitation,
      profile.geographicCitation,
      profile.verticalCitation,
    ].flatMap((value, index) =>
      value === undefined
        ? []
        : [
            Object.freeze({
              kind: 'citation' as const,
              sourceId: datasetId,
              locator: `GeoTIFF citation ${index}`,
              citation: value,
            }),
          ],
    ),
  ]
  const diagnostics = Object.freeze([
    ...source.diagnostics.filter(({ code: sourceCode }) => sourceCode !== 'unknown-crs'),
    ...profileDiagnostics(profile, `ifd[${profile.directory.index}]`),
    ...(code === undefined
      ? [
          createGeoDiagnostic({
            severity: 'warning',
            code: 'unknown-crs',
            message: 'GeoTIFF grid geometry is available, but no recognized CRS code is present.',
            path: 'spatialReference',
          }),
        ]
      : []),
  ])
  const hasUnresolvedCrsEvidence =
    coordinateSystemType !== 'unknown' ||
    citation !== undefined ||
    profile.verticalCitation !== undefined ||
    vertical !== undefined
  const state = geoCrsStateFromEvidence(code !== undefined, hasUnresolvedCrsEvidence)
  return Object.freeze({
    schemaVersion: 1,
    coordinateSystemType,
    ...(code === undefined ? {} : { authority: 'EPSG', code }),
    ...(citation === undefined ? {} : { name: citation }),
    ...(horizontalUnit === undefined ? {} : { horizontalUnit }),
    ...(vertical === undefined && profile.verticalCitation === undefined
      ? {}
      : {
          vertical: Object.freeze({
            ...(vertical === undefined ? {} : { authority: 'EPSG', code: vertical }),
            ...(profile.verticalCitation === undefined ? {} : { name: profile.verticalCitation }),
            ...(verticalUnit === undefined ? {} : { unit: verticalUnit }),
          }),
        }),
    formalAxes: source.formalAxes,
    applicationAxes: source.applicationAxes,
    evidence: Object.freeze(evidence),
    state,
    confidence: code === undefined ? 0.4 : 0.95,
    diagnostics,
  })
}

const gdalItem = (
  profile: GeoTiffProfile,
  component: number,
  names: readonly string[],
): string | undefined => {
  const selected = profile.gdalMetadata.find(
    ({ name, sample }) =>
      (sample === component || sample === undefined) && names.includes(name.toUpperCase()),
  )
  return selected?.value.trim() || undefined
}

const finiteGdalNumber = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

const gdalColor = (
  value: string | undefined,
  fallback: GeoBandDescriptor['colorInterpretation'],
): GeoBandDescriptor['colorInterpretation'] => {
  const normalized = value?.trim().toLowerCase()
  if (normalized === 'gray' || normalized === 'grey') return 'gray'
  if (normalized === 'red' || normalized === 'green' || normalized === 'blue') return normalized
  if (normalized === 'alpha') return 'alpha'
  if (normalized === 'palette') return 'palette'
  if (normalized === 'nir') return 'nir'
  if (normalized === 'undefined') return 'undefined'
  return normalized === undefined ? fallback : 'other'
}

const bands = (
  source: readonly GeoBandDescriptor[],
  profile: GeoTiffProfile,
): readonly GeoBandDescriptor[] =>
  Object.freeze(
    source.map((band) => {
      const component = band.sourceComponentIndex
      const name = gdalItem(profile, component, ['DESCRIPTION'])
      const unit = gdalItem(profile, component, ['UNITTYPE', 'UNIT'])
      const scale = finiteGdalNumber(gdalItem(profile, component, ['SCALE']))
      const offset = finiteGdalNumber(gdalItem(profile, component, ['OFFSET']))
      const color = gdalItem(profile, component, ['COLORINTERP', 'COLORINTERPRETATION'])
      return Object.freeze({
        ...band,
        name: name ?? band.name,
        colorInterpretation: gdalColor(color, band.colorInterpretation),
        ...(unit === undefined ? {} : { unit }),
        ...(scale === undefined ? {} : { scale }),
        ...(offset === undefined ? {} : { offset }),
      })
    }),
  )

const storageFor = (
  level: GeoRasterLevel,
  directory: TiffDirectory,
  descriptor: GeoRasterDescriptor,
  littleEndian: boolean,
): GeoRasterLevel['storage'] => {
  const chunkShape = descriptor.shape.map((length, index) => {
    if (index === descriptor.spatialDimensions.x.dimensionIndex) {
      return directory.tiled ? (directory.tileWidth ?? level.width) : level.width
    }
    if (index === descriptor.spatialDimensions.y.dimensionIndex) {
      return directory.tiled ? (directory.tileHeight ?? level.height) : level.height
    }
    return Math.min(1, length)
  })
  return Object.freeze({
    organization: directory.tiled ? 'tiled' : 'stripped',
    chunkShape: Object.freeze(chunkShape),
    compression: tiffCompressionName(directory.compression),
    byteOrder: littleEndian ? 'little-endian' : 'big-endian',
    metadata: Object.freeze({
      directoryIndex: directory.index,
      directoryOffset: directory.offset,
      photometric: directory.photometric,
      planar: directory.planar,
      samplesPerPixel: directory.samplesPerPixel,
      bitsPerSample: [...directory.bitsPerSample],
      sampleFormats: [...directory.sampleFormats],
    }),
  })
}

const affineClose = (left: readonly number[], right: readonly number[]): boolean =>
  left.every(
    (value, index) =>
      Math.abs(value - (right[index] ?? Number.NaN)) <=
      Math.max(1, Math.abs(value), Math.abs(right[index] ?? 0)) * 1e-9,
  )

const overviewDiagnostics = (
  descriptor: GeoRasterDescriptor,
  bridge: TiffScientificDatasetBridge,
): readonly GeoDiagnostic[] => {
  const page = bridge.pages[0]
  const base = descriptor.levels[0]
  if (page === undefined || base === undefined) return Object.freeze([])
  return Object.freeze(
    descriptor.levels.flatMap((level, index) => {
      const source = page.levels[index]
      if (index === 0 || source?.georeferencing !== 'explicit') return []
      const expected = [
        base.geometry.pixelToWorld[0] * (base.width / level.width),
        base.geometry.pixelToWorld[1] * (base.height / level.height),
        base.geometry.pixelToWorld[2],
        base.geometry.pixelToWorld[3] * (base.width / level.width),
        base.geometry.pixelToWorld[4] * (base.height / level.height),
        base.geometry.pixelToWorld[5],
      ]
      return affineClose(level.geometry.pixelToWorld, expected)
        ? []
        : [
            createGeoDiagnostic({
              severity: 'warning',
              code: 'geotiff-inconsistent-overview',
              message:
                'The explicit overview transform does not preserve the base level origin and proportional pixel geometry.',
              path: `levels[${index}].geometry.pixelToWorld`,
              metadata: { expectedAffine: expected },
            }),
          ]
    }),
  )
}

const enrichedDescriptor = (
  source: GeoRasterDescriptor,
  datasetBridge: TiffScientificDatasetBridge,
  documentBridge: TiffScientificDocumentBridge,
): GeoRasterDescriptor => {
  const firstPage = datasetBridge.pages[0]
  const primaryProfile = firstPage?.levels[0]?.geoTiffProfile
  if (firstPage === undefined || primaryProfile?.model === undefined) {
    throw unsupportedFormat('TIFF dataset has no complete affine GeoTIFF georeferencing')
  }
  const updatedLevels = Object.freeze(
    source.levels.map((level, index) => {
      const bridgeLevel = firstPage.levels[index]
      if (bridgeLevel === undefined) {
        throw invalidInput(`GeoTIFF dataset bridge omits resolution level ${index}`)
      }
      return Object.freeze({
        ...level,
        sourcePath: `page[${firstPage.page}]/level[${index}]/ifd[${bridgeLevel.directory.index}]`,
        storage: storageFor(
          level,
          bridgeLevel.directory,
          source,
          documentBridge.document.littleEndian,
        ),
      })
    }),
  )
  const updatedReference = spatialReference(source.spatialReference, primaryProfile, source.id)
  const updatedBands = bands(source.bands, primaryProfile)
  const preliminary: GeoRasterDescriptor = Object.freeze({
    ...source,
    bands: updatedBands,
    levels: updatedLevels,
    spatialReference: updatedReference,
    grid: updatedLevels[0]?.geometry ?? source.grid,
    sourceFormat: Object.freeze({ id: 'geotiff', name: 'GeoTIFF' }),
    formatEvidence: Object.freeze({
      geotiff: profileMetadata(primaryProfile),
      levels: firstPage.levels.map((level) => ({
        level: level.level,
        directoryIndex: level.directory.index,
        georeferencing: level.georeferencing,
        profile: level.geoTiffProfile === undefined ? null : profileMetadata(level.geoTiffProfile),
      })),
    }),
    diagnostics: Object.freeze([
      ...source.diagnostics.filter(({ code }) => code !== 'unknown-crs'),
      ...updatedReference.diagnostics,
    ]),
  })
  return normalizeGeoRasterDescriptor(
    Object.freeze({
      ...preliminary,
      diagnostics: Object.freeze([
        ...preliminary.diagnostics,
        ...overviewDiagnostics(preliminary, datasetBridge),
      ]),
    }),
    updatedBands.length,
  )
}

class GeoTiffRasterDataset implements GeoRasterDataset {
  readonly descriptor: GeoRasterDescriptor
  readonly scientificDataset: GeoRasterDataset['scientificDataset']
  readonly #delegate: GeoRasterDataset

  constructor(delegate: GeoRasterDataset, descriptor: GeoRasterDescriptor) {
    this.#delegate = delegate
    this.descriptor = descriptor
    this.scientificDataset = delegate.scientificDataset
  }

  createView(selection: Readonly<GeoRasterViewSelection>): GeoRasterView {
    const view = this.#delegate.createView(selection)
    const level = this.descriptor.levels.find(({ id }) => id === view.level.id)
    if (level === undefined)
      throw invalidInput(`GeoTIFF view level ${view.level.id} is unavailable`)
    return Object.freeze({
      dataset: this,
      selection: view.selection,
      level,
      readPixelRegion: (request: Parameters<GeoRasterView['readPixelRegion']>[0]) =>
        view.readPixelRegion(request),
      readWorldRegion: (request: Parameters<GeoRasterView['readWorldRegion']>[0]) =>
        view.readWorldRegion(request),
    })
  }

  readAxisCoordinates: GeoRasterDataset['readAxisCoordinates'] = (request) =>
    this.#delegate.readAxisCoordinates(request)
}

const ioReport = (bridge: TiffScientificDocumentBridge): GeoTiffIoReport => {
  const stats: HttpRangeSourceStats | undefined =
    bridge.source instanceof HttpRangeSource ? bridge.source.stats : undefined
  return Object.freeze({
    requests: stats?.requests ?? 0,
    transferredBytes: stats?.transferBytes ?? 0,
    uniqueBytes: stats?.uniqueBytes ?? 0,
    rangeCacheHits: stats?.cacheHits ?? 0,
    rangeCacheBytes: stats?.cacheBytes ?? 0,
    coalescedConsumers: stats?.coalescedConsumers ?? 0,
    abortedConsumers: stats?.abortedConsumers ?? 0,
    encodedCache: bridge.encodedSource.stats,
  })
}

const geospatialInspection = (
  bridge: TiffScientificDocumentBridge,
): readonly GeoTiffGeospatialInspection[] =>
  Object.freeze(
    bridge.datasets.flatMap(({ pages }) =>
      pages.flatMap(({ page, levels }) =>
        levels.flatMap(({ level, geoTiffProfile }) =>
          geoTiffProfile === undefined
            ? []
            : [
                Object.freeze({
                  path: `page[${page}]/level[${level}]/ifd[${geoTiffProfile.directory.index}]`,
                  rasterType: geoTiffProfile.rasterType,
                  ...(geoTiffProfile.projectedCrs === undefined
                    ? {}
                    : { projectedCrs: geoTiffProfile.projectedCrs }),
                  ...(geoTiffProfile.geographicCrs === undefined
                    ? {}
                    : { geographicCrs: geoTiffProfile.geographicCrs }),
                  ...(geoTiffProfile.verticalCrs === undefined
                    ? {}
                    : { verticalCrs: geoTiffProfile.verticalCrs }),
                  ...(geoTiffProfile.model === undefined
                    ? {}
                    : {
                        affine: Object.freeze([
                          (geoTiffProfile.model.matrix[0] ?? 0) /
                            (geoTiffProfile.model.matrix[15] ?? 1),
                          (geoTiffProfile.model.matrix[1] ?? 0) /
                            (geoTiffProfile.model.matrix[15] ?? 1),
                          (geoTiffProfile.model.matrix[3] ?? 0) /
                            (geoTiffProfile.model.matrix[15] ?? 1),
                          (geoTiffProfile.model.matrix[4] ?? 0) /
                            (geoTiffProfile.model.matrix[15] ?? 1),
                          (geoTiffProfile.model.matrix[5] ?? 0) /
                            (geoTiffProfile.model.matrix[15] ?? 1),
                          (geoTiffProfile.model.matrix[7] ?? 0) /
                            (geoTiffProfile.model.matrix[15] ?? 1),
                        ]),
                      }),
                  ...(geoTiffProfile.boundingBox === undefined
                    ? {}
                    : { bounds: geoTiffProfile.boundingBox }),
                  keyCount: geoTiffProfile.keys.size,
                  unknownKeys: Object.freeze(
                    [...geoTiffProfile.keys.values()].filter(({ recognized }) => !recognized),
                  ),
                  diagnostics: geoTiffProfile.diagnostics,
                }),
              ],
        ),
      ),
    ),
  )

const structuralReport = async (
  bridge: TiffScientificDocumentBridge,
): Promise<GeoTiffStructuralReport> => {
  const inspection = await inspectCog(bridge.document)
  const remote = bridge.source instanceof HttpRangeSource
  const tiled = inspection.directories.every(({ tiled: directoryTiled }) => directoryTiled)
  return Object.freeze({
    reportKind: 'structural-diagnostic',
    formalCogCertification: false,
    container: inspection.container,
    byteOrder: inspection.byteOrder,
    objectSize: bridge.source.size,
    topLevelDirectoryCount: inspection.topLevelDirectoryCount,
    directories: inspection.directories,
    overviewDimensions: Object.freeze(
      bridge.datasets.flatMap(({ pages }) =>
        pages.flatMap(({ levels }) =>
          levels
            .filter(({ level }) => level > 0)
            .map(({ directory }) =>
              Object.freeze({ width: directory.width, height: directory.height }),
            ),
        ),
      ),
    ),
    geospatialMetadata: geospatialInspection(bridge),
    rangeReadSuitability: remote ? (tiled ? 'suitable' : 'limited') : 'not-applicable',
    likelyCog: inspection.likelyCog,
    issues: inspection.issues,
    io: ioReport(bridge),
  })
}

const createDocument = async (
  context: Readonly<ScientificOpenContext>,
  options: Readonly<GeoTiffReaderOptions>,
): Promise<GeoTiffDocument> => {
  const scientificDocument = await createTiffReader(options).open(context)
  const bridge = getTiffScientificDocumentBridge(scientificDocument)
  if (bridge === undefined) throw invalidInput('TIFF scientific document bridge is unavailable')
  const entries: {
    readonly id: string
    readonly name?: string
    readonly dataset: GeoRasterDataset
  }[] = []
  for (const summary of scientificDocument.datasets) {
    throwIfAborted(context.signal)
    const datasetBridge = bridge.datasets.find(({ datasetId }) => datasetId === summary.id)
    if (datasetBridge === undefined) continue
    const scientificDataset = await scientificDocument.openDataset(summary.id, {
      ...(context.signal === undefined ? {} : { signal: context.signal }),
    })
    const adapted = adaptScientificDatasetToGeo(scientificDataset, {
      datasetId: summary.id,
      ...(summary.name === undefined ? {} : { title: summary.name }),
      sourceFormat: { id: 'geotiff', name: 'GeoTIFF' },
    })
    if (!adapted.ok) continue
    try {
      const descriptor = enrichedDescriptor(adapted.dataset.descriptor, datasetBridge, bridge)
      entries.push(
        Object.freeze({
          id: summary.id,
          ...(summary.name === undefined ? {} : { name: summary.name }),
          dataset: new GeoTiffRasterDataset(adapted.dataset, descriptor),
        }),
      )
    } catch (error: unknown) {
      if (!(error instanceof Error) || !error.message.includes('no complete affine')) throw error
    }
  }
  const inspections = geospatialInspection(bridge)
  const metadataWarnings = bridge.datasets.flatMap(({ pages }) =>
    pages.flatMap(({ page, levels }) =>
      levels.flatMap(({ level, warning }) =>
        warning === undefined ? [] : [{ page, level, warning }],
      ),
    ),
  )
  if (entries.length === 0 && inspections.length === 0 && metadataWarnings[0] !== undefined) {
    await scientificDocument.close?.()
    throw invalidInput(`GeoTIFF metadata could not be normalized: ${metadataWarnings[0].warning}`)
  }
  if (entries.length === 0 && inspections.length === 0) {
    await scientificDocument.close?.()
    throw unsupportedFormat(
      'TIFF contains no dataset with complete affine GeoTIFF georeferencing; use the scientific TIFF reader for non-geospatial TIFF.',
    )
  }
  return Object.freeze({
    reader: Object.freeze({
      id: geoTiffReaderDescriptor.id,
      version: geoTiffReaderDescriptor.version,
    }),
    format: geoTiffReaderDescriptor.format,
    metadata: Object.freeze({
      ...scientificDocument.metadata,
      adapter: 'purejsimage/geo/readers/geotiff',
      formalCogCertification: false,
      geospatialInspectionCount: inspections.length,
      ...(metadataWarnings.length === 0 ? {} : { geospatialMetadataWarnings: metadataWarnings }),
    }),
    datasets: Object.freeze(
      entries.map(({ id, name, dataset }) =>
        Object.freeze({
          id,
          ...(name === undefined ? {} : { name }),
          descriptor: dataset.descriptor,
          diagnostics: dataset.descriptor.diagnostics,
        }),
      ),
    ),
    async openDataset(id: string, openOptions?: Readonly<AbortOptions>) {
      throwIfAborted(openOptions?.signal ?? context.signal)
      const selected = entries.find((entry) => entry.id === id)
      if (selected === undefined) throw invalidInput(`Unknown GeoTIFF dataset ${id}`)
      return selected.dataset
    },
    inspectStructure: () => structuralReport(bridge),
    ...(scientificDocument.close === undefined
      ? {}
      : { close: () => scientificDocument.close?.() }),
  })
}

export const createGeoTiffReader = (
  options: Readonly<GeoTiffReaderOptions> = {},
): GeoTiffReader => {
  const scientificReader = createTiffReader(options)
  return Object.freeze({
    descriptor: geoTiffReaderDescriptor,
    probe: (context: Readonly<ScientificOpenContext>) => scientificReader.probe(context),
    open(context: Readonly<ScientificOpenContext>) {
      throwIfAborted(context.signal)
      return createDocument(context, options)
    },
  })
}

export const geoTiffReader: GeoTiffReader = createGeoTiffReader()
