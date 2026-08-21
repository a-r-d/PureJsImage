import type { AbortOptions } from '../../abort.ts'
import { throwIfAborted } from '../../abort.ts'
import { invalidInput, limitExceeded, unsupportedFormat } from '../../errors.ts'
import type {
  NormalizedScientificDatasetDescriptor,
  ScientificDataset,
  ScientificPlaneReadRequest,
} from '../../scientific/dataset.ts'
import {
  normalizeScientificDatasetDescriptor,
  normalizeScientificMetadataObject,
  normalizeScientificPlaneReadRequest,
} from '../../scientific/dataset.ts'
import type { ScientificOpenContext, ScientificReaderDescriptor } from '../../scientific/reader.ts'
import {
  createScientificDatasetIdentity,
  identifyScientificDataset,
} from '../../scientific/reader.ts'
import type { RasterBlock } from '../../raster.ts'
import { readExactly, type ImageSource } from '../../source.ts'
import type { GeoAffineTransform, GeoRasterDataset, GeoSpatialReference } from '../contracts.ts'
import { geoRasterSchemaVersion, normalizeGeoSpatialReference } from '../contracts.ts'
import type { GeoRasterDocument, GeoRasterReader } from './index.ts'
import { createGeoDatasetFromScientific } from './shared.ts'

export interface SrtmHgtLocation {
  /** Integer latitude of the tile's southwest corner. */
  readonly latitude: number
  /** Integer longitude of the tile's southwest corner. */
  readonly longitude: number
}

export interface SrtmHgtReaderOptions {
  readonly location?: SrtmHgtLocation
  readonly maxRegionBytes?: number
}

const supportedDimensions = Object.freeze([1_201, 3_601])
const voidValue = -32_768

const dimensionForSize = (size: number): number | undefined =>
  supportedDimensions.find((dimension) => dimension * dimension * 2 === size)

const normalizeLocation = (value: Readonly<SrtmHgtLocation>): SrtmHgtLocation => {
  if (
    !Number.isSafeInteger(value.latitude) ||
    !Number.isSafeInteger(value.longitude) ||
    value.latitude < -90 ||
    value.latitude > 89 ||
    value.longitude < -180 ||
    value.longitude > 179
  ) {
    throw invalidInput('HGT location must be an integer southwest tile coordinate')
  }
  return Object.freeze({ latitude: value.latitude, longitude: value.longitude })
}

const locationFromName = (name: string | undefined): SrtmHgtLocation | undefined => {
  if (name === undefined) return undefined
  const leaf = name.slice(name.lastIndexOf('/') + 1)
  const match = leaf.match(/^([NS])(\d{2})([EW])(\d{3})\.hgt$/iu)
  if (match === null) return undefined
  const latitudeMagnitude = Number(match[2])
  const longitudeMagnitude = Number(match[4])
  if (latitudeMagnitude > 90 || longitudeMagnitude > 180) return undefined
  const latitude = (match[1]?.toUpperCase() === 'S' ? -1 : 1) * latitudeMagnitude
  const longitude = (match[3]?.toUpperCase() === 'W' ? -1 : 1) * longitudeMagnitude
  try {
    return normalizeLocation({ latitude, longitude })
  } catch {
    return undefined
  }
}

const maxRegionBytes = (value: number | undefined): number => {
  const result = value ?? 64 * 1024 * 1024
  if (!Number.isSafeInteger(result) || result < 2) {
    throw invalidInput('HGT maxRegionBytes must be a safe integer of at least two bytes')
  }
  return result
}

class HgtScientificDataset implements ScientificDataset {
  readonly descriptor: NormalizedScientificDatasetDescriptor
  readonly #source: ImageSource
  readonly #dimension: number
  readonly #maxRegionBytes: number

  constructor(source: ImageSource, dimension: number, maximum: number) {
    this.#source = source
    this.#dimension = dimension
    this.#maxRegionBytes = maximum
    this.descriptor = normalizeScientificDatasetDescriptor({
      schemaVersion: 1,
      axes: [
        {
          id: 'x',
          name: 'Longitude',
          kind: 'space',
          length: dimension,
          unit: 'degree',
          coordinates: { type: 'index' },
        },
        {
          id: 'y',
          name: 'Latitude',
          kind: 'space',
          length: dimension,
          unit: 'degree',
          coordinates: { type: 'index' },
        },
      ],
      sampleType: 'int16',
      components: [{ id: 'elevation', name: 'Elevation', kind: 'scalar', unit: 'm' }],
      noDataValue: voidValue,
      capabilities: {
        regionReads: true,
        resolutionLevels: false,
        planeReads: { kind: 'ordered-axis-pairs', pairs: [['x', 'y']] },
      },
    })
  }

  async *readPlane(request: Readonly<ScientificPlaneReadRequest>): AsyncIterable<RasterBlock> {
    const selected = normalizeScientificPlaneReadRequest(this.descriptor, request)
    const rowBytes = selected.width * 2
    if (rowBytes > this.#maxRegionBytes)
      throw limitExceeded('HGT selected row exceeds maxRegionBytes')
    const rowsPerBlock = Math.max(1, Math.floor(this.#maxRegionBytes / rowBytes))
    for (let localY = 0; localY < selected.height; localY += rowsPerBlock) {
      throwIfAborted(selected.signal)
      const height = Math.min(rowsPerBlock, selected.height - localY)
      const data = new Uint8Array(rowBytes * height)
      for (let row = 0; row < height; row += 1) {
        const sourceY = selected.y + localY + row
        const bytes = await readExactly(
          this.#source,
          (sourceY * this.#dimension + selected.x) * 2,
          rowBytes,
          { ...(selected.signal === undefined ? {} : { signal: selected.signal }) },
        )
        data.set(bytes, row * rowBytes)
      }
      yield Object.freeze({
        x: selected.x,
        y: selected.y + localY,
        width: selected.width,
        height,
        stride: rowBytes,
        format: Object.freeze({ sampleType: 'int16', channels: 1, planar: false }),
        data,
      })
    }
  }
}

export const srtmHgtReaderDescriptor: ScientificReaderDescriptor = Object.freeze({
  id: 'purejsimage/geo/srtm-hgt',
  version: '1.0.0',
  format: 'SRTM HGT',
  extensions: Object.freeze(['hgt']),
  mediaTypes: Object.freeze(['application/x-srtm-hgt']),
  capabilities: Object.freeze({
    datasets: 'single-elevation-tile',
    regionReads: true,
    sampleType: 'int16',
    byteOrder: 'big-endian',
  }),
})

const hgtReference = (): GeoSpatialReference =>
  normalizeGeoSpatialReference({
    schemaVersion: geoRasterSchemaVersion,
    coordinateSystemType: 'geographic',
    authority: 'EPSG',
    code: 4326,
    name: 'WGS 84',
    horizontalUnit: { name: 'degree', symbol: '°' },
    formalAxes: Object.freeze([
      Object.freeze({
        name: 'Geodetic latitude',
        abbreviation: 'Lat',
        direction: 'north',
        unit: { name: 'degree', symbol: '°' },
        order: 0,
      }),
      Object.freeze({
        name: 'Geodetic longitude',
        abbreviation: 'Lon',
        direction: 'east',
        unit: { name: 'degree', symbol: '°' },
        order: 1,
      }),
    ]),
    applicationAxes: {
      x: { name: 'Longitude', formalAxisIndex: 1 },
      y: { name: 'Latitude', formalAxisIndex: 0 },
    },
    evidence: [
      {
        kind: 'derived',
        sourceId: 'primary',
        locator: 'SRTM HGT format definition',
        citation: 'SRTM HGT tiles use geographic WGS 84 coordinates',
      },
    ],
    state: 'complete',
    confidence: 1,
    diagnostics: [],
  })

export const createSrtmHgtReader = (
  options: Readonly<SrtmHgtReaderOptions> = {},
): GeoRasterReader => {
  const override = options.location === undefined ? undefined : normalizeLocation(options.location)
  const maximum = maxRegionBytes(options.maxRegionBytes)
  return Object.freeze({
    descriptor: srtmHgtReaderDescriptor,
    async probe(context: Readonly<ScientificOpenContext>) {
      throwIfAborted(context.signal)
      const dimension = dimensionForSize(context.primary.source.size)
      if (dimension === undefined)
        return Object.freeze({
          confidence: 0,
          reason: 'HGT file size is not a supported square tile',
        })
      const location = override ?? locationFromName(context.primary.name)
      return location === undefined
        ? Object.freeze({ confidence: 0, reason: 'HGT tile location is unavailable' })
        : Object.freeze({
            confidence: 1,
            reason: `${dimension} by ${dimension} HGT tile and location match`,
          })
    },
    async open(context: Readonly<ScientificOpenContext>): Promise<GeoRasterDocument> {
      throwIfAborted(context.signal)
      const dimension = dimensionForSize(context.primary.source.size)
      if (dimension === undefined)
        throw unsupportedFormat('HGT file size does not match a supported square tile dimension')
      const location = override ?? locationFromName(context.primary.name)
      if (location === undefined)
        throw invalidInput('HGT requires a valid N/S E/W filename or explicit location override')
      const interval = 1 / (dimension - 1)
      const affine: GeoAffineTransform = Object.freeze([
        interval,
        0,
        location.longitude,
        0,
        -interval,
        location.latitude + 1,
      ])
      const scientific = new HgtScientificDataset(context.primary.source, dimension, maximum)
      identifyScientificDataset(
        scientific,
        await createScientificDatasetIdentity({
          reader: srtmHgtReaderDescriptor,
          datasetId: 'elevation',
          resources: [context.primary],
        }),
      )
      const evidence = normalizeScientificMetadataObject({
        dimension,
        southwest: [location.longitude, location.latitude],
        intervalDegrees: interval,
        rowOrientation: 'north-to-south',
        voidValue,
      })
      const dataset: GeoRasterDataset = createGeoDatasetFromScientific(scientific, {
        id: 'elevation',
        title: context.primary.name ?? 'SRTM elevation',
        pixelToWorld: affine,
        pixelRegistration: 'pixel-is-point',
        spatialReference: hgtReference(),
        noData: { kind: 'scalar', value: voidValue },
        bands: [
          Object.freeze({
            sourceComponentIndex: 0,
            name: 'Elevation',
            colorInterpretation: 'elevation',
            unit: 'm',
            noData: voidValue,
            dataType: 'int16',
            categorical: false,
          }),
        ],
        sourceFormat: { id: 'srtm-hgt', name: 'SRTM HGT' },
        formatEvidence: evidence,
        storage: {
          organization: 'contiguous',
          byteOrder: 'big-endian',
          metadata: { rowOrientation: 'north-to-south', exactDimensionFromFileSize: dimension },
        },
      })
      return Object.freeze({
        reader: Object.freeze({
          id: srtmHgtReaderDescriptor.id,
          version: srtmHgtReaderDescriptor.version,
        }),
        format: srtmHgtReaderDescriptor.format,
        metadata: evidence,
        datasets: Object.freeze([
          Object.freeze({
            id: 'elevation',
            name: context.primary.name ?? 'SRTM elevation',
            descriptor: dataset.descriptor,
            diagnostics: dataset.descriptor.diagnostics,
          }),
        ]),
        async openDataset(id: string, openOptions?: Readonly<AbortOptions>) {
          throwIfAborted(openOptions?.signal ?? context.signal)
          if (id !== 'elevation') throw invalidInput(`Unknown HGT dataset ${id}`)
          return dataset
        },
      })
    },
  })
}

export const srtmHgtReader: GeoRasterReader = createSrtmHgtReader()
