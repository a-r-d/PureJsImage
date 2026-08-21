import type { AbortOptions } from '../../abort.ts'
import { throwIfAborted } from '../../abort.ts'
import { invalidInput, limitExceeded } from '../../errors.ts'
import type { RasterBlock } from '../../raster.ts'
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
import { type ImageSource, readExactly } from '../../source.ts'
import type { GeoAffineTransform, GeoRasterDataset, GeoSpatialReference } from '../contracts.ts'
import { geoRasterSchemaVersion, normalizeGeoSpatialReference } from '../contracts.ts'
import type { GeoRasterDocument, GeoRasterReader } from './index.ts'
import { createGeoDatasetFromScientific } from './shared.ts'

export interface EsriAsciiGridLimits {
  readonly maxFileBytes?: number
  readonly maxHeaderBytes?: number
  readonly maxRows?: number
  readonly maxColumns?: number
  readonly maxTokens?: number
  readonly maxRowBytes?: number
  readonly maxDecodedBytes?: number
}

interface ResolvedAsciiLimits {
  readonly maxFileBytes: number
  readonly maxHeaderBytes: number
  readonly maxRows: number
  readonly maxColumns: number
  readonly maxTokens: number
  readonly maxRowBytes: number
  readonly maxDecodedBytes: number
}

interface ParsedAsciiGrid {
  readonly ncols: number
  readonly nrows: number
  readonly cellsize: number
  readonly originKind: 'corner' | 'center'
  readonly xOrigin: number
  readonly yOrigin: number
  readonly noData?: number
  readonly rows: readonly (readonly string[])[]
  readonly pixelToWorld: GeoAffineTransform
}

const defaults: ResolvedAsciiLimits = Object.freeze({
  maxFileBytes: 64 * 1024 * 1024,
  maxHeaderBytes: 64 * 1024,
  maxRows: 100_000,
  maxColumns: 100_000,
  maxTokens: 16_777_216,
  maxRowBytes: 4 * 1024 * 1024,
  maxDecodedBytes: 256 * 1024 * 1024,
})

const positive = (value: number | undefined, fallback: number, label: string): number => {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || result < 1) {
    throw invalidInput(`${label} must be a positive safe integer`)
  }
  return result
}

const resolveLimits = (value: Readonly<EsriAsciiGridLimits>): ResolvedAsciiLimits =>
  Object.freeze({
    maxFileBytes: positive(value.maxFileBytes, defaults.maxFileBytes, 'ASCII Grid maxFileBytes'),
    maxHeaderBytes: positive(
      value.maxHeaderBytes,
      defaults.maxHeaderBytes,
      'ASCII Grid maxHeaderBytes',
    ),
    maxRows: positive(value.maxRows, defaults.maxRows, 'ASCII Grid maxRows'),
    maxColumns: positive(value.maxColumns, defaults.maxColumns, 'ASCII Grid maxColumns'),
    maxTokens: positive(value.maxTokens, defaults.maxTokens, 'ASCII Grid maxTokens'),
    maxRowBytes: positive(value.maxRowBytes, defaults.maxRowBytes, 'ASCII Grid maxRowBytes'),
    maxDecodedBytes: positive(
      value.maxDecodedBytes,
      defaults.maxDecodedBytes,
      'ASCII Grid maxDecodedBytes',
    ),
  })

const numericPattern = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/u

const numeric = (value: string | undefined, label: string): number => {
  if (value === undefined || !numericPattern.test(value)) throw invalidInput(`${label} is invalid`)
  const result = Number(value)
  if (!Number.isFinite(result)) throw invalidInput(`${label} must be finite`)
  return result
}

const integer = (value: string | undefined, label: string): number => {
  const result = numeric(value, label)
  if (!Number.isSafeInteger(result) || result < 1) throw invalidInput(`${label} must be positive`)
  return result
}

const decodeText = (bytes: Uint8Array): string => {
  if (bytes.includes(0)) throw invalidInput('ASCII Grid contains a NUL byte')
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw invalidInput('ASCII Grid is not valid UTF-8 text')
  }
}

const parseAscii = (text: string, limits: ResolvedAsciiLimits): ParsedAsciiGrid => {
  const lines = text.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n')
  while ((lines.at(-1)?.trim().length ?? 0) === 0) lines.pop()
  const header = new Map<string, string>()
  let lineIndex = 0
  let headerBytes = 0
  const known = new Set([
    'ncols',
    'nrows',
    'xllcorner',
    'xllcenter',
    'yllcorner',
    'yllcenter',
    'cellsize',
    'nodata_value',
  ])
  while (lineIndex < lines.length) {
    const line = lines[lineIndex] ?? ''
    const fields = line.trim().split(/\s+/u)
    const key = fields[0]?.toLowerCase()
    if (key !== undefined && numericPattern.test(key)) break
    if (key === undefined || !known.has(key) || fields.length !== 2) {
      throw invalidInput(`ASCII Grid header line ${lineIndex + 1} is invalid`)
    }
    if (header.has(key)) throw invalidInput(`ASCII Grid header repeats ${key}`)
    header.set(key, fields[1] ?? '')
    headerBytes += new TextEncoder().encode(line).byteLength + 1
    if (headerBytes > limits.maxHeaderBytes)
      throw limitExceeded('ASCII Grid header exceeds maxHeaderBytes')
    lineIndex += 1
  }
  const ncols = integer(header.get('ncols'), 'ASCII Grid ncols')
  const nrows = integer(header.get('nrows'), 'ASCII Grid nrows')
  if (ncols > limits.maxColumns || nrows > limits.maxRows) {
    throw limitExceeded('ASCII Grid dimensions exceed configured row or column limits')
  }
  const tokens = BigInt(ncols) * BigInt(nrows)
  if (tokens > BigInt(limits.maxTokens)) throw limitExceeded('ASCII Grid exceeds maxTokens')
  if (tokens * 8n > BigInt(limits.maxDecodedBytes))
    throw limitExceeded('ASCII Grid exceeds maxDecodedBytes')
  const xCorner = header.get('xllcorner')
  const xCenter = header.get('xllcenter')
  const yCorner = header.get('yllcorner')
  const yCenter = header.get('yllcenter')
  if (
    (xCorner === undefined) === (xCenter === undefined) ||
    (yCorner === undefined) === (yCenter === undefined)
  ) {
    throw invalidInput('ASCII Grid requires exactly one corner or center declaration per axis')
  }
  if ((xCorner === undefined) !== (yCorner === undefined)) {
    throw invalidInput('ASCII Grid cannot mix corner and center origin declarations')
  }
  const originKind = xCorner === undefined ? 'center' : 'corner'
  const xOrigin = numeric(xCorner ?? xCenter, 'ASCII Grid X origin')
  const yOrigin = numeric(yCorner ?? yCenter, 'ASCII Grid Y origin')
  const cellsize = numeric(header.get('cellsize'), 'ASCII Grid cellsize')
  if (cellsize <= 0) throw invalidInput('ASCII Grid cellsize must be positive')
  const noData = header.has('nodata_value')
    ? numeric(header.get('nodata_value'), 'ASCII Grid NODATA_value')
    : undefined
  const dataLines = lines.slice(lineIndex)
  if (dataLines.length !== nrows)
    throw invalidInput(`ASCII Grid requires exactly ${nrows} data rows`)
  const rows = Object.freeze(
    dataLines.map((line, row) => {
      if (new TextEncoder().encode(line).byteLength > limits.maxRowBytes) {
        throw limitExceeded(`ASCII Grid row ${row + 1} exceeds maxRowBytes`)
      }
      const fields = line.trim().split(/\s+/u)
      if (fields.length !== ncols)
        throw invalidInput(`ASCII Grid row ${row + 1} requires ${ncols} values`)
      for (let column = 0; column < fields.length; column += 1)
        numeric(fields[column], `ASCII Grid row ${row + 1} column ${column + 1}`)
      return Object.freeze(fields)
    }),
  )
  const pixelToWorld: GeoAffineTransform =
    originKind === 'corner'
      ? Object.freeze([cellsize, 0, xOrigin, 0, -cellsize, yOrigin + nrows * cellsize])
      : Object.freeze([cellsize, 0, xOrigin, 0, -cellsize, yOrigin + (nrows - 1) * cellsize])
  return Object.freeze({
    ncols,
    nrows,
    cellsize,
    originKind,
    xOrigin,
    yOrigin,
    ...(noData === undefined ? {} : { noData }),
    rows,
    pixelToWorld,
  })
}

class AsciiScientificDataset implements ScientificDataset {
  readonly descriptor: NormalizedScientificDatasetDescriptor
  readonly #source: ImageSource
  readonly #limits: ResolvedAsciiLimits

  constructor(source: ImageSource, parsed: ParsedAsciiGrid, limits: ResolvedAsciiLimits) {
    this.#source = source
    this.#limits = limits
    this.descriptor = normalizeScientificDatasetDescriptor({
      schemaVersion: 1,
      axes: [
        { id: 'x', name: 'X', kind: 'space', length: parsed.ncols, coordinates: { type: 'index' } },
        { id: 'y', name: 'Y', kind: 'space', length: parsed.nrows, coordinates: { type: 'index' } },
      ],
      sampleType: 'float64',
      components: [{ id: 'elevation', name: 'Elevation', kind: 'scalar' }],
      ...(parsed.noData === undefined ? {} : { noDataValue: parsed.noData }),
      capabilities: {
        regionReads: true,
        resolutionLevels: false,
        planeReads: { kind: 'ordered-axis-pairs', pairs: [['x', 'y']] },
      },
    })
  }

  async *readPlane(request: Readonly<ScientificPlaneReadRequest>): AsyncIterable<RasterBlock> {
    const selected = normalizeScientificPlaneReadRequest(this.descriptor, request)
    throwIfAborted(selected.signal)
    const bytes = await readExactly(this.#source, 0, this.#source.size, {
      ...(selected.signal === undefined ? {} : { signal: selected.signal }),
    })
    const parsed = parseAscii(decodeText(bytes), this.#limits)
    const output = new Uint8Array(selected.width * selected.height * 8)
    const view = new DataView(output.buffer)
    for (let row = 0; row < selected.height; row += 1) {
      throwIfAborted(selected.signal)
      const values = parsed.rows[selected.y + row]
      if (values === undefined) throw invalidInput('ASCII Grid selected row is unavailable')
      for (let column = 0; column < selected.width; column += 1) {
        view.setFloat64(
          (row * selected.width + column) * 8,
          numeric(values[selected.x + column], 'ASCII Grid sample'),
          false,
        )
      }
    }
    yield Object.freeze({
      x: selected.x,
      y: selected.y,
      width: selected.width,
      height: selected.height,
      stride: selected.width * 8,
      format: Object.freeze({ sampleType: 'float64', channels: 1, planar: false }),
      data: output,
    })
  }
}

export const esriAsciiGridReaderDescriptor: ScientificReaderDescriptor = Object.freeze({
  id: 'purejsimage/geo/esri-ascii-grid',
  version: '1.0.0',
  format: 'Esri ASCII Grid',
  extensions: Object.freeze(['asc', 'grd']),
  mediaTypes: Object.freeze(['text/plain', 'application/x-esri-ascii-grid']),
  capabilities: Object.freeze({
    datasets: 'single-geo-raster',
    regionReads: 'sequential-text-parse',
    cloudOptimized: false,
  }),
})

const unknownReference = (): GeoSpatialReference =>
  normalizeGeoSpatialReference({
    schemaVersion: geoRasterSchemaVersion,
    coordinateSystemType: 'unknown',
    formalAxes: [],
    applicationAxes: { x: { name: 'X' }, y: { name: 'Y' } },
    evidence: [
      {
        kind: 'embedded',
        sourceId: 'primary',
        locator: 'ASCII Grid lower-left origin and cellsize',
      },
    ],
    state: 'unknown',
    confidence: 0.3,
    diagnostics: [
      {
        severity: 'warning',
        code: 'unknown-crs',
        message: 'ASCII Grid does not identify a coordinate reference system.',
        path: 'header',
      },
    ],
  })

export const createEsriAsciiGridReader = (
  options: Readonly<EsriAsciiGridLimits> = {},
): GeoRasterReader => {
  const limits = resolveLimits(options)
  return Object.freeze({
    descriptor: esriAsciiGridReaderDescriptor,
    async probe(context: Readonly<ScientificOpenContext>) {
      throwIfAborted(context.signal)
      const length = Math.min(context.primary.source.size, limits.maxHeaderBytes)
      const text = decodeText(
        await context.primary.source.read(0, length, {
          ...(context.signal === undefined ? {} : { signal: context.signal }),
        }),
      )
      return /^\s*ncols\s+\d+/iu.test(text)
        ? Object.freeze({ confidence: 0.98, reason: 'ASCII Grid ncols header matches' })
        : Object.freeze({ confidence: 0, reason: 'ASCII Grid header does not match' })
    },
    async open(context: Readonly<ScientificOpenContext>): Promise<GeoRasterDocument> {
      throwIfAborted(context.signal)
      if (context.primary.source.size > limits.maxFileBytes)
        throw limitExceeded('ASCII Grid exceeds maxFileBytes')
      const bytes = await readExactly(context.primary.source, 0, context.primary.source.size, {
        ...(context.signal === undefined ? {} : { signal: context.signal }),
      })
      const parsed = parseAscii(decodeText(bytes), limits)
      const scientific = new AsciiScientificDataset(context.primary.source, parsed, limits)
      identifyScientificDataset(
        scientific,
        await createScientificDatasetIdentity({
          reader: esriAsciiGridReaderDescriptor,
          datasetId: 'grid',
          resources: [context.primary],
        }),
      )
      const dataset: GeoRasterDataset = createGeoDatasetFromScientific(scientific, {
        id: 'grid',
        title: context.primary.name ?? 'Esri ASCII Grid',
        pixelToWorld: parsed.pixelToWorld,
        pixelRegistration: parsed.originKind === 'corner' ? 'pixel-is-area' : 'pixel-is-point',
        spatialReference: unknownReference(),
        ...(parsed.noData === undefined
          ? {}
          : { noData: { kind: 'scalar', value: parsed.noData } }),
        bands: [
          Object.freeze({
            sourceComponentIndex: 0,
            name: 'Elevation',
            colorInterpretation: 'elevation',
            ...(parsed.noData === undefined ? {} : { noData: parsed.noData }),
            dataType: 'float64',
            categorical: false,
          }),
        ],
        sourceFormat: { id: 'esri-ascii-grid', name: 'Esri ASCII Grid' },
        formatEvidence: normalizeScientificMetadataObject({
          ncols: parsed.ncols,
          nrows: parsed.nrows,
          cellsize: parsed.cellsize,
          originKind: parsed.originKind,
          xOrigin: parsed.xOrigin,
          yOrigin: parsed.yOrigin,
          noData: parsed.noData ?? null,
          randomRegionAccess: 'requires-reparsing-preceding-ascii-content',
          cloudOptimized: false,
        }),
        diagnostics: [
          {
            severity: 'info',
            code: 'ascii-grid-sequential-read',
            message:
              'Region reads reparse preceding ASCII content because no persistent row index is prepared.',
            path: 'capabilities.pixelRegionReads',
          },
        ],
        storage: {
          organization: 'contiguous',
          byteOrder: 'not-applicable',
          metadata: { encoding: 'ASCII', randomRegionAccess: 'sequential-prefix-parse' },
        },
      })
      const metadata = normalizeScientificMetadataObject({
        ncols: parsed.ncols,
        nrows: parsed.nrows,
        cellsize: parsed.cellsize,
        originKind: parsed.originKind,
      })
      return Object.freeze({
        reader: Object.freeze({
          id: esriAsciiGridReaderDescriptor.id,
          version: esriAsciiGridReaderDescriptor.version,
        }),
        format: esriAsciiGridReaderDescriptor.format,
        metadata,
        datasets: Object.freeze([
          Object.freeze({
            id: 'grid',
            name: context.primary.name ?? 'Esri ASCII Grid',
            descriptor: dataset.descriptor,
            diagnostics: dataset.descriptor.diagnostics,
          }),
        ]),
        async openDataset(id: string, openOptions?: Readonly<AbortOptions>) {
          throwIfAborted(openOptions?.signal ?? context.signal)
          if (id !== 'grid') throw invalidInput(`Unknown ASCII Grid dataset ${id}`)
          return dataset
        },
      })
    },
  })
}

export const esriAsciiGridReader: GeoRasterReader = createEsriAsciiGridReader()
