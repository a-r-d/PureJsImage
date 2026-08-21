import { throwIfAborted } from '../abort.ts'
import { invalidInput, limitExceeded } from '../errors.ts'
import type {
  NormalizedScientificDatasetDescriptor,
  ScientificAxisCoordinates,
  ScientificAxisDescriptor,
  ScientificDataset,
  ScientificNoData,
  ScientificSpatialReference,
} from '../scientific/dataset.ts'
import {
  resolveScientificDescriptorAtResolutionLevel,
  supportsScientificPlaneRead,
} from '../scientific/dataset.ts'
import type {
  NumericArray,
  NumericSampleType,
  NumericTile,
  NumericTileAllocator,
  NumericTileSource,
} from '../scientific/numeric-tile.ts'
import {
  numericTileSampleOffset,
  resolveNumericTileSource,
  validateNumericTile,
} from '../scientific/numeric-tile.ts'
import type { ScientificDocument } from '../scientific/reader.ts'
import { getScientificDatasetIdentity } from '../scientific/reader.ts'
import type {
  GeoAffineTransform,
  GeoAxisCoordinateBlock,
  GeoAxisCoordinateReadRequest,
  GeoAxisDescriptor,
  GeoAxisIndex,
  GeoAxisKind,
  GeoBandDescriptor,
  GeoColorInterpretation,
  GeoDiagnostic,
  GeoGridGeometry,
  GeoMetadataObject,
  GeoNoData,
  GeoNumericTile,
  GeoPixelRegionReadRequest,
  GeoRasterDataset,
  GeoRasterDescriptor,
  GeoRasterLevel,
  GeoRasterView,
  GeoRasterViewSelection,
  GeoSourceFormat,
  GeoSpatialDimension,
  GeoSpatialReference,
  GeoValidationLimits,
  GeoWorldRegionReadRequest,
  ResolvedGeoValidationLimits,
} from './contracts.ts'
import {
  createGeoDiagnostic,
  createGeoGridGeometry,
  geoRasterSchemaVersion,
  geoSelectionToScientificRequest,
  geoViewPlaneCount,
  geoWorldBoundsToPixelRegion,
  normalizeGeoPixelRegion,
  normalizeGeoRasterDescriptor,
  normalizeGeoSpatialReference,
  resolveGeoValidationLimits,
} from './contracts.ts'

export interface ScientificGeoAdapterOptions {
  readonly datasetId?: string
  readonly title?: string
  readonly sourceFormat?: GeoSourceFormat
  readonly xAxisId?: string
  readonly yAxisId?: string
  readonly axisKinds?: Readonly<Record<string, GeoAxisKind>>
  readonly formatEvidence?: GeoMetadataObject
  readonly allocator?: NumericTileAllocator
  readonly limits?: GeoValidationLimits
}

export interface ScientificDocumentGeoAdapterOptions
  extends Omit<ScientificGeoAdapterOptions, 'datasetId' | 'sourceFormat'> {
  readonly signal?: AbortSignal
}

export interface GeoScientificAdapterSuccess {
  readonly ok: true
  readonly dataset: GeoRasterDataset
  readonly diagnostics: readonly GeoDiagnostic[]
}

export interface GeoScientificAdapterFailure {
  readonly ok: false
  readonly diagnostics: readonly GeoDiagnostic[]
}

export type GeoScientificAdapterResult = GeoScientificAdapterSuccess | GeoScientificAdapterFailure

export interface GeoToScientificSpatialReferenceResult {
  readonly spatialReference: ScientificSpatialReference
  readonly diagnostics: readonly GeoDiagnostic[]
}

const failure = (diagnostic: GeoDiagnostic): GeoScientificAdapterFailure =>
  Object.freeze({ ok: false, diagnostics: Object.freeze([createGeoDiagnostic(diagnostic)]) })

const boundedId = (value: string, label: string, maximum: number): string => {
  const result = value.trim()
  if (result.length < 1 || result.length > maximum) {
    throw invalidInput(`${label} must be a bounded non-empty string`)
  }
  return result
}

const noDataFromScientific = (value: ScientificNoData | undefined): GeoNoData => {
  if (value === undefined) return Object.freeze({ kind: 'none' })
  if (value.kind === 'scalar') return Object.freeze({ kind: 'scalar', value: value.value })
  return Object.freeze({ kind: 'components', values: Object.freeze([...value.values]) })
}

const scientificNoDataFromGeo = (value: GeoNoData): ScientificNoData | undefined => {
  if (value.kind === 'none') return undefined
  if (value.kind === 'scalar') return Object.freeze({ kind: 'scalar', value: value.value })
  return Object.freeze({ kind: 'components', values: Object.freeze([...value.values]) })
}

const scientificRegistration = (
  value: ScientificSpatialReference['pixelInterpretation'],
): GeoGridGeometry['pixelRegistration'] =>
  value === 'pixel-is-area'
    ? 'pixel-is-area'
    : value === 'pixel-is-point'
      ? 'pixel-is-point'
      : 'unknown'

const componentColor = (
  kind: NormalizedScientificDatasetDescriptor['components'][number]['kind'],
): GeoColorInterpretation => {
  if (kind === 'red' || kind === 'green' || kind === 'blue' || kind === 'alpha') return kind
  if (kind === 'intensity') return 'gray'
  return 'undefined'
}

const commonBandName = (
  kind: NormalizedScientificDatasetDescriptor['components'][number]['kind'],
): string | undefined =>
  kind === 'red' || kind === 'green' || kind === 'blue' || kind === 'alpha' ? kind : undefined

const bandNoData = (
  value: ScientificNoData | undefined,
  component: number,
): number | string | undefined => {
  if (value === undefined) return undefined
  if (value.kind === 'scalar') return value.value
  return value.values[component]
}

const bandsFromScientific = (
  descriptor: NormalizedScientificDatasetDescriptor,
): readonly GeoBandDescriptor[] =>
  Object.freeze(
    descriptor.components.map((component, index) => {
      const commonName = commonBandName(component.kind)
      const noData = bandNoData(descriptor.spatialReference?.noData, index)
      return Object.freeze({
        sourceComponentIndex: index,
        name: component.name ?? component.id,
        ...(commonName === undefined ? {} : { commonName }),
        colorInterpretation: componentColor(component.kind),
        ...(component.unit === undefined ? {} : { unit: component.unit }),
        ...(noData === undefined ? {} : { noData }),
        dataType: descriptor.sampleType,
        categorical: false,
      })
    }),
  )

const orderedSpatialPair = (
  descriptor: NormalizedScientificDatasetDescriptor,
): readonly [string, string] | undefined => {
  const planeReads = descriptor.capabilities.planeReads
  if (planeReads.kind !== 'ordered-axis-pairs' || planeReads.pairs.length !== 1) return undefined
  const pair = planeReads.pairs[0]
  if (pair === undefined) return undefined
  const horizontal = descriptor.axes.find(({ id }) => id === pair[0])
  const vertical = descriptor.axes.find(({ id }) => id === pair[1])
  return horizontal?.kind === 'space' && vertical?.kind === 'space' ? pair : undefined
}

const findSpatialAxes = (
  descriptor: NormalizedScientificDatasetDescriptor,
  options: Readonly<ScientificGeoAdapterOptions>,
): readonly [ScientificAxisDescriptor, ScientificAxisDescriptor] | undefined => {
  const byId = (id: string | undefined): ScientificAxisDescriptor | undefined =>
    id === undefined ? undefined : descriptor.axes.find((axis) => axis.id === id)
  if (options.xAxisId !== undefined || options.yAxisId !== undefined) {
    const x = byId(options.xAxisId)
    const y = byId(options.yAxisId)
    return x?.kind === 'space' && y?.kind === 'space' && x.id !== y.id ? [x, y] : undefined
  }
  const x = descriptor.axes.find(({ id, kind }) => kind === 'space' && id.toLowerCase() === 'x')
  const y = descriptor.axes.find(({ id, kind }) => kind === 'space' && id.toLowerCase() === 'y')
  if (x !== undefined && y !== undefined) return [x, y]
  const ordered = orderedSpatialPair(descriptor)
  if (ordered !== undefined) {
    const horizontal = byId(ordered[0])
    const vertical = byId(ordered[1])
    if (horizontal !== undefined && vertical !== undefined) return [horizontal, vertical]
  }
  const spatial = descriptor.axes.filter(({ kind }) => kind === 'space')
  return spatial.length === 2 && spatial[0] !== undefined && spatial[1] !== undefined
    ? [spatial[0], spatial[1]]
    : undefined
}

const geoAxisKind = (
  axis: ScientificAxisDescriptor,
  configured: Readonly<Record<string, GeoAxisKind>> | undefined,
): GeoAxisKind => {
  const selected = configured?.[axis.id]
  if (selected !== undefined) return selected
  if (axis.kind === 'time') return 'time'
  if (axis.kind === 'channel' || axis.kind === 'spectral') return 'band'
  return 'other'
}

const geoAxisCoordinates = (
  coordinates: ScientificAxisCoordinates,
  limits: ResolvedGeoValidationLimits,
): GeoAxisDescriptor['coordinates'] => {
  if (coordinates.type === 'index') return Object.freeze({ kind: 'index' })
  if (coordinates.type === 'linear') {
    return Object.freeze({ kind: 'linear', origin: coordinates.origin, step: coordinates.step })
  }
  if (coordinates.values.length <= limits.maxEmbeddedCoordinateValues) {
    return Object.freeze({ kind: 'values', values: Object.freeze([...coordinates.values]) })
  }
  return Object.freeze({
    kind: 'lazy',
    valueType: coordinates.type === 'lookup' ? 'number' : 'string',
  })
}

const diagnosticBoundsDiffer = (
  source: ScientificSpatialReference['bounds'],
  generated: GeoGridGeometry['worldBounds'],
): boolean => {
  if (source === undefined) return false
  const close = (left: number, right: number): boolean =>
    Math.abs(left - right) <= Math.max(1, Math.abs(left), Math.abs(right)) * 1e-12
  return !(
    close(source.minX, generated.minX) &&
    close(source.minY, generated.minY) &&
    close(source.maxX, generated.maxX) &&
    close(source.maxY, generated.maxY)
  )
}

const spatialReferenceFromScientific = (
  value: ScientificSpatialReference,
  datasetId: string,
  xAxis: ScientificAxisDescriptor,
  yAxis: ScientificAxisDescriptor,
  limits: ResolvedGeoValidationLimits,
): GeoSpatialReference => {
  const diagnostics: GeoDiagnostic[] = []
  if (value.crs.kind === 'unknown') {
    diagnostics.push({
      severity: 'warning',
      code: 'unknown-crs',
      message:
        'The source has grid georeferencing but does not identify a coordinate reference system.',
      path: 'spatialReference.crs',
    })
  } else {
    diagnostics.push({
      severity: 'info',
      code: 'incomplete-crs',
      message: 'The scientific CRS contract does not contain formal axes, WKT2, or PROJJSON.',
      path: 'spatialReference.crs',
    })
  }
  const horizontalUnit =
    xAxis.unit !== undefined && xAxis.unit === yAxis.unit
      ? Object.freeze({ name: xAxis.unit, symbol: xAxis.unit })
      : undefined
  return normalizeGeoSpatialReference(
    {
      schemaVersion: geoRasterSchemaVersion,
      coordinateSystemType: value.crs.kind,
      ...(value.crs.authority === undefined ? {} : { authority: value.crs.authority }),
      ...(value.crs.code === undefined ? {} : { code: value.crs.code }),
      ...(value.crs.name === undefined ? {} : { name: value.crs.name }),
      ...(horizontalUnit === undefined ? {} : { horizontalUnit }),
      formalAxes: [],
      applicationAxes: {
        x: { name: xAxis.name ?? xAxis.id },
        y: { name: yAxis.name ?? yAxis.id },
      },
      evidence: [
        {
          kind: 'embedded',
          sourceId: datasetId,
          locator: 'ScientificDataset.descriptor.spatialReference',
          ...(value.crs.name === undefined ? {} : { citation: value.crs.name }),
          ...(value.metadata === undefined ? {} : { metadata: value.metadata }),
        },
      ],
      state: value.crs.kind === 'unknown' ? 'unknown' : 'incomplete',
      confidence:
        value.crs.kind === 'unknown'
          ? 0.25
          : value.crs.authority !== undefined && value.crs.code !== undefined
            ? 0.8
            : 0.6,
      diagnostics,
    },
    limits,
  )
}

const spatialDimension = (
  axis: ScientificAxisDescriptor,
  dimensionIndex: number,
): GeoSpatialDimension => Object.freeze({ id: axis.id, name: axis.name ?? axis.id, dimensionIndex })

const geometryFromScientific = (
  spatialReference: ScientificSpatialReference,
  width: number,
  height: number,
  x: GeoSpatialDimension,
  y: GeoSpatialDimension,
  limits: ResolvedGeoValidationLimits,
): GeoGridGeometry => {
  const pixelToWorld = spatialReference.pixelToModel
  if (pixelToWorld === undefined) {
    throw invalidInput('Scientific geospatial adaptation requires pixelToModel')
  }
  const initial = createGeoGridGeometry(
    {
      width,
      height,
      spatialDimensions: { x, y },
      pixelToWorld,
      pixelRegistration: scientificRegistration(spatialReference.pixelInterpretation),
      noData: noDataFromScientific(spatialReference.noData),
    },
    limits,
  )
  if (!diagnosticBoundsDiffer(spatialReference.bounds, initial.worldBounds)) return initial
  return createGeoGridGeometry(
    {
      width,
      height,
      spatialDimensions: { x, y },
      pixelToWorld,
      pixelRegistration: scientificRegistration(spatialReference.pixelInterpretation),
      noData: noDataFromScientific(spatialReference.noData),
      warnings: [
        {
          severity: 'warning',
          code: 'source-bounds-differ',
          message:
            'Source bounds differ from the bounds calculated from transformed raster corners.',
          path: 'worldBounds',
        },
      ],
    },
    limits,
  )
}

const nominalResolution = (
  affine: GeoAffineTransform,
  unit: string | undefined,
): GeoRasterLevel['nominalResolution'] => {
  const x = Math.hypot(affine[0], affine[3])
  const y = Math.hypot(affine[1], affine[4])
  if (!Number.isFinite(x) || !Number.isFinite(y) || x <= 0 || y <= 0) return undefined
  return Object.freeze({ x, y, ...(unit === undefined ? {} : { unit }) })
}

const levelsFromScientific = (
  descriptor: NormalizedScientificDatasetDescriptor,
  xAxis: ScientificAxisDescriptor,
  yAxis: ScientificAxisDescriptor,
  spatialX: GeoSpatialDimension,
  spatialY: GeoSpatialDimension,
  unit: string | undefined,
  limits: ResolvedGeoValidationLimits,
): readonly GeoRasterLevel[] => {
  const baseWidth = xAxis.length
  const baseHeight = yAxis.length
  return Object.freeze(
    descriptor.levels.map((sourceLevel, sourceOrder) => {
      const resolved = resolveScientificDescriptorAtResolutionLevel(descriptor, sourceLevel.level)
      const x = resolved.axes.find(({ id }) => id === xAxis.id)
      const y = resolved.axes.find(({ id }) => id === yAxis.id)
      if (x === undefined || y === undefined) {
        throw invalidInput(`Scientific resolution level ${sourceLevel.level} omits a spatial axis`)
      }
      for (const axis of resolved.axes) {
        if (axis.id === xAxis.id || axis.id === yAxis.id) continue
        const base = descriptor.axes.find(({ id }) => id === axis.id)
        if (base?.length !== axis.length) {
          throw invalidInput(
            `Scientific resolution level ${sourceLevel.level} changes non-spatial axis ${axis.id}`,
          )
        }
      }
      const spatialReference = resolved.spatialReference
      if (spatialReference?.pixelToModel === undefined) {
        throw invalidInput(
          `Scientific resolution level ${sourceLevel.level} has no pixel-to-world affine`,
        )
      }
      const geometry = geometryFromScientific(
        spatialReference,
        x.length,
        y.length,
        spatialX,
        spatialY,
        limits,
      )
      const resolution = nominalResolution(geometry.pixelToWorld, unit)
      return Object.freeze({
        id: String(sourceLevel.level),
        sourceResolutionLevel: sourceLevel.level,
        sourceOrder,
        width: x.length,
        height: y.length,
        geometry,
        ...(resolution === undefined ? {} : { nominalResolution: resolution }),
        downsample: Object.freeze({ x: baseWidth / x.length, y: baseHeight / y.length }),
        storage: Object.freeze({ organization: 'unknown' as const }),
      })
    }),
  )
}

const descriptorFromScientific = (
  scientific: ScientificDataset,
  datasetId: string,
  xAxis: ScientificAxisDescriptor,
  yAxis: ScientificAxisDescriptor,
  options: Readonly<ScientificGeoAdapterOptions>,
  limits: ResolvedGeoValidationLimits,
): GeoRasterDescriptor => {
  const descriptor = scientific.descriptor
  const xIndex = descriptor.axes.findIndex(({ id }) => id === xAxis.id)
  const yIndex = descriptor.axes.findIndex(({ id }) => id === yAxis.id)
  const spatialX = spatialDimension(xAxis, xIndex)
  const spatialY = spatialDimension(yAxis, yIndex)
  const spatial = descriptor.spatialReference
  if (spatial?.pixelToModel === undefined) {
    throw invalidInput('Scientific dataset has no usable geospatial affine')
  }
  const reference = spatialReferenceFromScientific(spatial, datasetId, xAxis, yAxis, limits)
  const dimensions = Object.freeze(
    descriptor.axes.map((axis, index) =>
      Object.freeze({
        id: axis.id,
        ...(axis.name === undefined ? {} : { name: axis.name }),
        index,
        length: axis.length,
        kind:
          index === xIndex
            ? ('spatial-x' as const)
            : index === yIndex
              ? ('spatial-y' as const)
              : ('non-spatial' as const),
      }),
    ),
  )
  const axes = Object.freeze(
    descriptor.axes.flatMap((axis, index) =>
      index === xIndex || index === yIndex
        ? []
        : [
            Object.freeze({
              id: axis.id,
              ...(axis.name === undefined ? {} : { name: axis.name }),
              kind: geoAxisKind(axis, options.axisKinds),
              dimensionIndex: index,
              length: axis.length,
              ...(axis.unit === undefined ? {} : { unit: axis.unit }),
              coordinates: geoAxisCoordinates(axis.coordinates, limits),
            }),
          ],
    ),
  )
  const unit = reference.horizontalUnit?.symbol ?? reference.horizontalUnit?.name
  const levels = levelsFromScientific(descriptor, xAxis, yAxis, spatialX, spatialY, unit, limits)
  const primary = levels.find(({ sourceResolutionLevel }) => sourceResolutionLevel === 0)
  if (primary === undefined) throw invalidInput('Scientific dataset has no resolution level zero')
  const diagnostics = Object.freeze([...reference.diagnostics, ...primary.geometry.warnings])
  return normalizeGeoRasterDescriptor(
    {
      schemaVersion: geoRasterSchemaVersion,
      id: datasetId,
      ...(options.title === undefined ? {} : { title: options.title }),
      shape: Object.freeze(descriptor.axes.map(({ length }) => length)),
      dimensions,
      spatialDimensions: Object.freeze({ x: spatialX, y: spatialY }),
      axes,
      sampleType: descriptor.sampleType,
      bands: bandsFromScientific(descriptor),
      levels,
      primaryLevelId: primary.id,
      spatialReference: reference,
      grid: primary.geometry,
      capabilities: Object.freeze({
        pixelRegionReads: descriptor.capabilities.regionReads,
        worldRegionReads: primary.geometry.worldToPixel !== undefined,
        resolutionLevels: descriptor.capabilities.resolutionLevels,
        axisCoordinateReads: true,
        bandSelection: true,
      }),
      sourceFormat: options.sourceFormat ?? { id: 'scientific', name: 'Scientific dataset' },
      ...(options.formatEvidence === undefined
        ? descriptor.metadata === undefined
          ? {}
          : { formatEvidence: descriptor.metadata }
        : { formatEvidence: options.formatEvidence }),
      diagnostics,
    },
    descriptor.components.length,
    limits,
  )
}

const normalizeViewSelection = (
  value: Readonly<GeoRasterViewSelection>,
  descriptor: Readonly<GeoRasterDescriptor>,
  limits: ResolvedGeoValidationLimits,
): GeoRasterViewSelection => {
  if (
    value.spatialDimensions[0] !== descriptor.spatialDimensions.x.id ||
    value.spatialDimensions[1] !== descriptor.spatialDimensions.y.id
  ) {
    throw invalidInput('Geo view spatial dimensions do not match the grid X/Y order')
  }
  if (!descriptor.levels.some(({ id }) => id === value.levelId)) {
    throw invalidInput(`Geo view level ${value.levelId} is unavailable`)
  }
  const selections = new Map<string, GeoRasterViewSelection['nonSpatial'][number]>()
  for (const entry of value.nonSpatial) {
    const axis = descriptor.axes.find(({ id }) => id === entry.axisId)
    if (axis === undefined) throw invalidInput(`Geo view axis ${entry.axisId} is unavailable`)
    if (selections.has(axis.id)) throw invalidInput(`Geo view repeats axis ${axis.id}`)
    if (entry.kind === 'index') {
      if (!Number.isSafeInteger(entry.index) || entry.index < 0 || entry.index >= axis.length) {
        throw invalidInput(`Geo view index for ${axis.id} is outside the axis`)
      }
      selections.set(axis.id, Object.freeze({ kind: 'index', axisId: axis.id, index: entry.index }))
    } else {
      if (
        !Number.isSafeInteger(entry.start) ||
        !Number.isSafeInteger(entry.length) ||
        entry.start < 0 ||
        entry.length < 1 ||
        entry.start + entry.length > axis.length
      ) {
        throw invalidInput(`Geo view range for ${axis.id} is outside the axis`)
      }
      selections.set(
        axis.id,
        Object.freeze({
          kind: 'range',
          axisId: axis.id,
          start: entry.start,
          length: entry.length,
        }),
      )
    }
  }
  for (const axis of descriptor.axes) {
    if (!selections.has(axis.id)) {
      if (axis.length !== 1) throw invalidInput(`Geo view must select non-spatial axis ${axis.id}`)
      selections.set(axis.id, Object.freeze({ kind: 'index', axisId: axis.id, index: 0 }))
    }
  }
  if (value.sourceBands.length < 1) throw invalidInput('Geo view must select at least one band')
  const availableBands = new Set(
    descriptor.bands.map(({ sourceComponentIndex }) => sourceComponentIndex),
  )
  const seenBands = new Set<number>()
  const sourceBands = Object.freeze(
    value.sourceBands.map((sourceComponentIndex) => {
      if (
        !Number.isSafeInteger(sourceComponentIndex) ||
        sourceComponentIndex < 0 ||
        !availableBands.has(sourceComponentIndex)
      ) {
        throw invalidInput(`Geo view source band ${sourceComponentIndex} is unavailable`)
      }
      if (seenBands.has(sourceComponentIndex)) {
        throw invalidInput(`Geo view repeats source band ${sourceComponentIndex}`)
      }
      seenBands.add(sourceComponentIndex)
      return sourceComponentIndex
    }),
  )
  const result = Object.freeze({
    spatialDimensions: Object.freeze([
      descriptor.spatialDimensions.x.id,
      descriptor.spatialDimensions.y.id,
    ] as const),
    nonSpatial: Object.freeze(
      descriptor.axes.map((axis) => {
        const selected = selections.get(axis.id)
        if (selected === undefined) throw invalidInput(`Geo view omitted axis ${axis.id}`)
        return selected
      }),
    ),
    sourceBands,
    levelId: value.levelId,
  })
  geoViewPlaneCount(result, descriptor, limits)
  return result
}

const fixedIndexSelections = function* (
  selection: Readonly<GeoRasterViewSelection>,
): Generator<readonly GeoAxisIndex[]> {
  const starts = selection.nonSpatial.map((entry) =>
    entry.kind === 'index' ? entry.index : entry.start,
  )
  const lengths = selection.nonSpatial.map((entry) => (entry.kind === 'index' ? 1 : entry.length))
  const offsets = new Array<number>(selection.nonSpatial.length).fill(0)
  let complete = false
  while (!complete) {
    yield Object.freeze(
      selection.nonSpatial.map((entry, index) =>
        Object.freeze({
          axisId: entry.axisId,
          index: (starts[index] ?? 0) + (offsets[index] ?? 0),
        }),
      ),
    )
    for (let index = offsets.length - 1; index >= 0; index -= 1) {
      const next = (offsets[index] ?? 0) + 1
      if (next < (lengths[index] ?? 0)) {
        offsets[index] = next
        break
      }
      offsets[index] = 0
      if (index === 0) complete = true
    }
    if (offsets.length === 0) complete = true
  }
}

const allocateNumericArray = (sampleType: NumericSampleType, length: number): NumericArray => {
  if (sampleType === 'uint8') return new Uint8Array(length)
  if (sampleType === 'uint16') return new Uint16Array(length)
  if (sampleType === 'uint32') return new Uint32Array(length)
  if (sampleType === 'uint64') return new BigUint64Array(length)
  if (sampleType === 'int8') return new Int8Array(length)
  if (sampleType === 'int16') return new Int16Array(length)
  if (sampleType === 'int32') return new Int32Array(length)
  if (sampleType === 'int64') return new BigInt64Array(length)
  if (sampleType === 'float32') return new Float32Array(length)
  return new Float64Array(length)
}

const writeNumericValue = (
  target: NumericArray,
  targetIndex: number,
  value: number | bigint,
): void => {
  if (target instanceof BigUint64Array || target instanceof BigInt64Array) {
    if (typeof value !== 'bigint') throw invalidInput('Geo tile bigint storage received a number')
    target[targetIndex] = value
    return
  }
  if (typeof value !== 'number') throw invalidInput('Geo tile numeric storage received a bigint')
  target[targetIndex] = value
}

const allBandsInOrder = (sourceBands: readonly number[], componentCount: number): boolean =>
  sourceBands.length === componentCount && sourceBands.every((band, index) => band === index)

const geoTile = (
  source: NumericTile,
  sourceBands: readonly number[],
  fixedIndices: readonly GeoAxisIndex[],
  levelId: string,
): GeoNumericTile => {
  validateNumericTile(source)
  if (allBandsInOrder(sourceBands, source.componentCount)) {
    return Object.freeze({
      ...source,
      fixedIndices,
      sourceBands,
      levelId,
    })
  }
  const elementCount = source.width * source.height * sourceBands.length
  if (!Number.isSafeInteger(elementCount)) {
    source.release()
    throw limitExceeded('Geo selected-band tile element count overflowed')
  }
  const data = allocateNumericArray(source.sampleType, elementCount)
  let destination = 0
  try {
    for (let y = 0; y < source.height; y += 1) {
      for (let x = 0; x < source.width; x += 1) {
        for (const band of sourceBands) {
          const value = source.data[numericTileSampleOffset(source, x, y, band)]
          if (value === undefined) throw invalidInput('Geo source tile is truncated')
          writeNumericValue(data, destination, value)
          destination += 1
        }
      }
    }
  } finally {
    source.release()
  }
  return Object.freeze({
    x: source.x,
    y: source.y,
    width: source.width,
    height: source.height,
    sampleType: source.sampleType,
    componentCount: sourceBands.length,
    layout: 'interleaved',
    rowStrideElements: source.width * sourceBands.length,
    data,
    release() {},
    fixedIndices,
    sourceBands,
    levelId,
  })
}

class ScientificGeoRasterView implements GeoRasterView {
  readonly dataset: GeoRasterDataset
  readonly selection: GeoRasterViewSelection
  readonly level: GeoRasterLevel
  readonly #tileSource: NumericTileSource

  constructor(
    dataset: GeoRasterDataset,
    selection: GeoRasterViewSelection,
    tileSource: NumericTileSource,
  ) {
    this.dataset = dataset
    this.selection = selection
    const level = dataset.descriptor.levels.find(({ id }) => id === selection.levelId)
    if (level === undefined)
      throw invalidInput(`Geo view level ${selection.levelId} is unavailable`)
    this.level = level
    this.#tileSource = tileSource
  }

  async *readPixelRegion(
    request: Readonly<GeoPixelRegionReadRequest>,
  ): AsyncGenerator<GeoNumericTile> {
    const region = normalizeGeoPixelRegion(request.region, this.level.geometry)
    throwIfAborted(request.signal)
    for (const fixedIndices of fixedIndexSelections(this.selection)) {
      throwIfAborted(request.signal)
      const planeRequest = geoSelectionToScientificRequest(
        this.selection,
        this.level,
        fixedIndices,
        region,
        request.signal,
      )
      for await (const tile of this.#tileSource.readNumericTiles({
        ...planeRequest,
        ...(request.targetSampleType === undefined
          ? {}
          : { targetSampleType: request.targetSampleType }),
      })) {
        yield geoTile(tile, this.selection.sourceBands, fixedIndices, this.level.id)
      }
    }
  }

  readWorldRegion(request: Readonly<GeoWorldRegionReadRequest>): AsyncIterable<GeoNumericTile> {
    const region = geoWorldBoundsToPixelRegion(
      request.bounds,
      this.level.geometry,
      request.clamp ?? false,
    )
    return this.readPixelRegion({
      region,
      ...(request.targetSampleType === undefined
        ? {}
        : { targetSampleType: request.targetSampleType }),
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    })
  }
}

class ScientificGeoRasterDataset implements GeoRasterDataset {
  readonly descriptor: GeoRasterDescriptor
  readonly scientificDataset: ScientificDataset
  readonly #limits: ResolvedGeoValidationLimits
  readonly #tileSource: NumericTileSource
  readonly #scientificAxes: ReadonlyMap<string, ScientificAxisDescriptor>

  constructor(
    descriptor: GeoRasterDescriptor,
    scientificDataset: ScientificDataset,
    options: Readonly<ScientificGeoAdapterOptions>,
    limits: ResolvedGeoValidationLimits,
  ) {
    this.descriptor = descriptor
    this.scientificDataset = scientificDataset
    this.#limits = limits
    this.#tileSource = resolveNumericTileSource(scientificDataset, {
      ...(options.allocator === undefined ? {} : { allocator: options.allocator }),
    })
    this.#scientificAxes = new Map(scientificDataset.descriptor.axes.map((axis) => [axis.id, axis]))
  }

  createView(selection: Readonly<GeoRasterViewSelection>): GeoRasterView {
    return new ScientificGeoRasterView(
      this,
      normalizeViewSelection(selection, this.descriptor, this.#limits),
      this.#tileSource,
    )
  }

  async readAxisCoordinates(
    request: Readonly<GeoAxisCoordinateReadRequest>,
  ): Promise<GeoAxisCoordinateBlock> {
    throwIfAborted(request.signal)
    const axis = this.descriptor.axes.find(({ id }) => id === request.axisId)
    const source = this.#scientificAxes.get(request.axisId)
    if (axis === undefined || source === undefined) {
      throw invalidInput(`Geo coordinate axis ${request.axisId} is unavailable`)
    }
    if (
      !Number.isSafeInteger(request.start) ||
      !Number.isSafeInteger(request.length) ||
      request.start < 0 ||
      request.length < 1 ||
      request.length > this.#limits.maxAxisCoordinateReadLength ||
      request.start + request.length > axis.length
    ) {
      throw invalidInput('Geo axis coordinate read is outside its bounded axis range')
    }
    let values: readonly (number | string)[]
    if (source.coordinates.type === 'index') {
      values = Object.freeze(
        Array.from({ length: request.length }, (_, index) => request.start + index),
      )
    } else if (source.coordinates.type === 'linear') {
      const coordinates = source.coordinates
      values = Object.freeze(
        Array.from(
          { length: request.length },
          (_, index) => coordinates.origin + (request.start + index) * coordinates.step,
        ),
      )
    } else {
      values = Object.freeze(
        source.coordinates.values.slice(request.start, request.start + request.length),
      )
    }
    throwIfAborted(request.signal)
    return Object.freeze({ axisId: axis.id, start: request.start, values })
  }
}

export const adaptScientificDatasetToGeo = (
  scientificDataset: ScientificDataset,
  options: Readonly<ScientificGeoAdapterOptions> = {},
): GeoScientificAdapterResult => {
  const identity = getScientificDatasetIdentity(scientificDataset)
  const datasetId = options.datasetId ?? identity?.datasetId
  if (datasetId === undefined) {
    return failure({
      severity: 'error',
      code: 'scientific-dataset-id-missing',
      message: 'Geo adaptation requires a stable dataset ID or a scientific dataset identity.',
      path: 'datasetId',
    })
  }
  const spatialReference = scientificDataset.descriptor.spatialReference
  if (spatialReference === undefined) {
    return failure({
      severity: 'error',
      code: 'scientific-geo-evidence-missing',
      message: 'The scientific dataset has no explicit geospatial reference.',
      path: 'descriptor.spatialReference',
    })
  }
  if (spatialReference.pixelToModel === undefined) {
    return failure({
      severity: 'error',
      code: 'scientific-spatial-reference-incomplete',
      message: 'The scientific spatial reference has no pixel-to-world affine.',
      path: 'descriptor.spatialReference.pixelToModel',
    })
  }
  const axes = findSpatialAxes(scientificDataset.descriptor, options)
  if (axes === undefined) {
    return failure({
      severity: 'error',
      code: 'scientific-spatial-axes-ambiguous',
      message: 'Geo adaptation requires one explicit X axis and one explicit Y axis.',
      path: 'descriptor.axes',
    })
  }
  if (!supportsScientificPlaneRead(scientificDataset.descriptor, [axes[0].id, axes[1].id])) {
    return failure({
      severity: 'error',
      code: 'scientific-spatial-plane-unavailable',
      message: 'The scientific dataset cannot read the selected X/Y spatial plane.',
      path: 'descriptor.capabilities.planeReads',
    })
  }
  const limits = resolveGeoValidationLimits(options.limits)
  const stableId = boundedId(datasetId, 'Geo dataset ID', limits.maxStringLength)
  const descriptor = descriptorFromScientific(
    scientificDataset,
    stableId,
    axes[0],
    axes[1],
    options,
    limits,
  )
  const dataset = new ScientificGeoRasterDataset(descriptor, scientificDataset, options, limits)
  return Object.freeze({ ok: true, dataset, diagnostics: descriptor.diagnostics })
}

export const adaptScientificDocumentDatasetToGeo = async (
  document: ScientificDocument,
  datasetId: string,
  options: Readonly<ScientificDocumentGeoAdapterOptions> = {},
): Promise<GeoScientificAdapterResult> => {
  const { signal, ...adapterOptions } = options
  const dataset = await document.openDataset(datasetId, signal === undefined ? {} : { signal })
  return adaptScientificDatasetToGeo(dataset, {
    ...adapterOptions,
    datasetId,
    sourceFormat: {
      id: document.reader.id,
      name: document.format,
      version: document.reader.version,
    },
  })
}

const scientificCrsKind = (
  value: GeoSpatialReference['coordinateSystemType'],
): 'projected' | 'geographic' | 'unknown' =>
  value === 'projected' ? 'projected' : value === 'geographic' ? 'geographic' : 'unknown'

export const geoSpatialReferenceToScientific = (
  referenceValue: Readonly<GeoSpatialReference>,
  geometry: Readonly<GeoGridGeometry>,
  limits: Readonly<GeoValidationLimits> = {},
): GeoToScientificSpatialReferenceResult => {
  const reference = normalizeGeoSpatialReference(referenceValue, limits)
  const lost: string[] = []
  if (reference.wkt2 !== undefined) lost.push('WKT2')
  if (reference.projJson !== undefined) lost.push('PROJJSON')
  if (reference.vertical !== undefined) lost.push('vertical CRS')
  if (reference.coordinateEpoch !== undefined) lost.push('coordinate epoch')
  if (reference.formalAxes.length > 0) lost.push('formal CRS axes')
  if (reference.evidence.length > 0) lost.push('CRS evidence')
  if (reference.state !== 'complete' || reference.confidence !== undefined) {
    lost.push('CRS diagnostic state')
  }
  if (
    reference.coordinateSystemType !== 'projected' &&
    reference.coordinateSystemType !== 'geographic'
  ) {
    lost.push('coordinate-system type')
  }
  const diagnostics =
    lost.length === 0
      ? Object.freeze([])
      : Object.freeze([
          createGeoDiagnostic({
            severity: 'info',
            code: 'scientific-contract-loss',
            message: `The scientific spatial contract omits: ${lost.join(', ')}.`,
            path: 'spatialReference',
          }),
        ])
  const noData = scientificNoDataFromGeo(geometry.noData)
  return Object.freeze({
    spatialReference: Object.freeze({
      crs: Object.freeze({
        kind: scientificCrsKind(reference.coordinateSystemType),
        ...(reference.authority === undefined ? {} : { authority: reference.authority }),
        ...(reference.code === undefined ? {} : { code: reference.code }),
        ...(reference.name === undefined ? {} : { name: reference.name }),
      }),
      pixelInterpretation:
        geometry.pixelRegistration === 'unknown' ? 'unspecified' : geometry.pixelRegistration,
      pixelToModel: geometry.pixelToWorld,
      ...(geometry.worldToPixel === undefined ? {} : { modelToPixel: geometry.worldToPixel }),
      bounds: geometry.worldBounds,
      ...(noData === undefined ? {} : { noData }),
    }),
    diagnostics,
  })
}
