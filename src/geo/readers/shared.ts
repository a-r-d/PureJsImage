import { invalidInput } from '../../errors.ts'
import type {
  NormalizedScientificDatasetDescriptor,
  ScientificDataset,
  ScientificNoData,
  ScientificPlaneReadRequest,
  ScientificResolutionLevel,
  ScientificSpatialReference,
} from '../../scientific/dataset.ts'
import {
  normalizeScientificDatasetDescriptor,
  resolveScientificDescriptorAtResolutionLevel,
} from '../../scientific/dataset.ts'
import { getScientificDatasetIdentity, identifyScientificDataset } from '../../scientific/reader.ts'
import type {
  GeoAffineTransform,
  GeoAxisKind,
  GeoBandDescriptor,
  GeoDiagnostic,
  GeoMetadataObject,
  GeoNoData,
  GeoPixelRegistration,
  GeoRasterDataset,
  GeoRasterDescriptor,
  GeoRasterLevel,
  GeoRasterView,
  GeoRasterViewSelection,
  GeoSourceFormat,
  GeoSpatialReference,
} from '../contracts.ts'
import { normalizeGeoRasterDescriptor } from '../contracts.ts'
import { adaptScientificDatasetToGeo } from '../scientific-adapter.ts'

export interface GeoScientificDatasetOptions {
  readonly id: string
  readonly title?: string
  readonly xAxisId?: string
  readonly yAxisId?: string
  readonly pixelToWorld: GeoAffineTransform
  readonly pixelRegistration: GeoPixelRegistration
  readonly spatialReference: GeoSpatialReference
  readonly noData?: GeoNoData
  readonly bands?: readonly GeoBandDescriptor[]
  readonly axisKinds?: Readonly<Record<string, GeoAxisKind>>
  readonly axisMetadata?: Readonly<Record<string, GeoMetadataObject>>
  readonly sourceFormat: GeoSourceFormat
  readonly formatEvidence?: GeoMetadataObject
  readonly diagnostics?: readonly GeoDiagnostic[]
  readonly storage?: GeoRasterLevel['storage']
}

const scientificNoData = (value: GeoNoData | undefined): ScientificNoData | undefined => {
  if (value === undefined || value.kind === 'none') return undefined
  if (value.kind === 'scalar') return Object.freeze({ kind: 'scalar', value: value.value })
  return Object.freeze({ kind: 'components', values: Object.freeze([...value.values]) })
}

const scientificCrsKind = (
  value: GeoSpatialReference['coordinateSystemType'],
): ScientificSpatialReference['crs']['kind'] =>
  value === 'projected' ? 'projected' : value === 'geographic' ? 'geographic' : 'unknown'

const scientificRegistration = (
  value: GeoPixelRegistration,
): ScientificSpatialReference['pixelInterpretation'] =>
  value === 'pixel-is-area'
    ? 'pixel-is-area'
    : value === 'pixel-is-point'
      ? 'pixel-is-point'
      : 'unspecified'

const levelAffine = (
  base: GeoAffineTransform,
  baseWidth: number,
  baseHeight: number,
  width: number,
  height: number,
): GeoAffineTransform => {
  const scaleX = baseWidth / width
  const scaleY = baseHeight / height
  return Object.freeze([
    base[0] * scaleX,
    base[1] * scaleY,
    base[2],
    base[3] * scaleX,
    base[4] * scaleY,
    base[5],
  ])
}

const scientificReference = (
  options: Readonly<GeoScientificDatasetOptions>,
  affine: GeoAffineTransform,
): ScientificSpatialReference => {
  const noData = scientificNoData(options.noData)
  return Object.freeze({
    crs: Object.freeze({
      kind: scientificCrsKind(options.spatialReference.coordinateSystemType),
      ...(options.spatialReference.authority === undefined
        ? {}
        : { authority: options.spatialReference.authority }),
      ...(options.spatialReference.code === undefined
        ? {}
        : { code: options.spatialReference.code }),
      ...(options.spatialReference.name === undefined
        ? {}
        : { name: options.spatialReference.name }),
    }),
    pixelInterpretation: scientificRegistration(options.pixelRegistration),
    pixelToModel: affine,
    ...(noData === undefined ? {} : { noData }),
    metadata: Object.freeze({
      adapter: 'purejsimage/geo/readers',
      sourceFormat: options.sourceFormat.id,
    }),
  })
}

const decorateScientificDataset = (
  source: ScientificDataset,
  options: Readonly<GeoScientificDatasetOptions>,
): ScientificDataset => {
  const xAxisId = options.xAxisId ?? 'x'
  const yAxisId = options.yAxisId ?? 'y'
  const xAxis = source.descriptor.axes.find(({ id }) => id === xAxisId)
  const yAxis = source.descriptor.axes.find(({ id }) => id === yAxisId)
  if (xAxis === undefined || yAxis === undefined || xAxis.id === yAxis.id) {
    throw invalidInput('Geo scientific decoration requires distinct X and Y axes')
  }
  const levels: readonly ScientificResolutionLevel[] = Object.freeze(
    source.descriptor.levels.map((level) => {
      const resolved = resolveScientificDescriptorAtResolutionLevel(source.descriptor, level.level)
      const width = resolved.axes.find(({ id }) => id === xAxisId)?.length
      const height = resolved.axes.find(({ id }) => id === yAxisId)?.length
      if (width === undefined || height === undefined) {
        throw invalidInput(`Scientific level ${level.level} omits a spatial axis`)
      }
      const affine = levelAffine(options.pixelToWorld, xAxis.length, yAxis.length, width, height)
      return Object.freeze({
        ...level,
        spatialReference: scientificReference(options, affine),
      })
    }),
  )
  const descriptor: NormalizedScientificDatasetDescriptor = normalizeScientificDatasetDescriptor({
    ...source.descriptor,
    axes: Object.freeze(
      source.descriptor.axes.map((axis) =>
        axis.id === xAxisId || axis.id === yAxisId
          ? Object.freeze({ ...axis, kind: 'space' as const })
          : axis,
      ),
    ),
    levels,
    spatialReference: scientificReference(options, options.pixelToWorld),
  })
  const readSeries = source.readSeries
  const decorated: ScientificDataset = Object.freeze({
    descriptor,
    readPlane(request: Readonly<ScientificPlaneReadRequest>) {
      return source.readPlane(request)
    },
    ...(readSeries === undefined
      ? {}
      : {
          readSeries(request: Parameters<typeof readSeries>[0]) {
            return readSeries.call(source, request)
          },
        }),
  })
  const identity = getScientificDatasetIdentity(source)
  return identity === undefined ? decorated : identifyScientificDataset(decorated, identity)
}

class NormalizedGeoDataset implements GeoRasterDataset {
  readonly descriptor: GeoRasterDescriptor
  readonly scientificDataset: ScientificDataset
  readonly #delegate: GeoRasterDataset

  constructor(delegate: GeoRasterDataset, descriptor: GeoRasterDescriptor) {
    this.#delegate = delegate
    this.scientificDataset = delegate.scientificDataset
    this.descriptor = descriptor
  }

  createView(selection: Readonly<GeoRasterViewSelection>): GeoRasterView {
    const view = this.#delegate.createView(selection)
    const level = this.descriptor.levels.find(({ id }) => id === view.level.id)
    if (level === undefined) throw invalidInput(`Geo view level ${view.level.id} is unavailable`)
    return Object.freeze({
      dataset: this,
      selection: view.selection,
      level,
      readPixelRegion: view.readPixelRegion.bind(view),
      readWorldRegion: view.readWorldRegion.bind(view),
    })
  }

  readAxisCoordinates: GeoRasterDataset['readAxisCoordinates'] = (request) =>
    this.#delegate.readAxisCoordinates(request)
}

export const createGeoDatasetFromScientific = (
  source: ScientificDataset,
  options: Readonly<GeoScientificDatasetOptions>,
): GeoRasterDataset => {
  const scientific = decorateScientificDataset(source, options)
  const adapted = adaptScientificDatasetToGeo(scientific, {
    datasetId: options.id,
    ...(options.title === undefined ? {} : { title: options.title }),
    xAxisId: options.xAxisId ?? 'x',
    yAxisId: options.yAxisId ?? 'y',
    ...(options.axisKinds === undefined ? {} : { axisKinds: options.axisKinds }),
    sourceFormat: options.sourceFormat,
    ...(options.formatEvidence === undefined ? {} : { formatEvidence: options.formatEvidence }),
  })
  if (!adapted.ok) throw invalidInput(adapted.diagnostics[0]?.message ?? 'Geo adaptation failed')
  const bands = options.bands ?? adapted.dataset.descriptor.bands
  const axes = Object.freeze(
    adapted.dataset.descriptor.axes.map((axis) => {
      const metadata = options.axisMetadata?.[axis.id]
      return metadata === undefined ? axis : Object.freeze({ ...axis, metadata })
    }),
  )
  const storage = options.storage
  const descriptor = normalizeGeoRasterDescriptor(
    {
      ...adapted.dataset.descriptor,
      spatialReference: options.spatialReference,
      levels:
        storage === undefined
          ? adapted.dataset.descriptor.levels
          : Object.freeze(
              adapted.dataset.descriptor.levels.map((level) =>
                Object.freeze({ ...level, storage }),
              ),
            ),
      grid: adapted.dataset.descriptor.grid,
      axes,
      bands,
      sourceFormat: options.sourceFormat,
      ...(options.formatEvidence === undefined ? {} : { formatEvidence: options.formatEvidence }),
      diagnostics: Object.freeze([
        ...(options.diagnostics ?? []),
        ...adapted.dataset.descriptor.diagnostics.filter(
          ({ code }) => code !== 'unknown-crs' && code !== 'incomplete-crs',
        ),
        ...options.spatialReference.diagnostics,
      ]),
    },
    scientific.descriptor.components.length,
  )
  return new NormalizedGeoDataset(adapted.dataset, descriptor)
}
