import type { AbortOptions } from '../../abort.ts'
import { throwIfAborted } from '../../abort.ts'
import { invalidInput, unsupportedFormat } from '../../errors.ts'
import { normalizeScientificMetadataObject } from '../../scientific/dataset.ts'
import type {
  ScientificDocument,
  ScientificOpenContext,
  ScientificReaderDescriptor,
  ScientificResource,
} from '../../scientific/reader.ts'
import { enviReader } from '../../scientific/readers/envi.ts'
import type {
  GeoAffineTransform,
  GeoBandDescriptor,
  GeoMetadataObject,
  GeoSpatialReference,
} from '../contracts.ts'
import { geoRasterSchemaVersion, normalizeGeoSpatialReference } from '../contracts.ts'
import { geoCoordinateSystemTypeFromWkt } from '../crs.ts'
import type { GeoRasterDocument, GeoRasterReader } from './index.ts'
import { createGeoDatasetFromScientific } from './shared.ts'

export const geoEnviReaderDescriptor: ScientificReaderDescriptor = Object.freeze({
  id: 'purejsimage/geo/envi',
  version: '1.0.0',
  format: 'Georeferenced ENVI',
  extensions: enviReader.descriptor.extensions,
  mediaTypes: enviReader.descriptor.mediaTypes,
  capabilities: Object.freeze({
    datasets: 'single-geo-raster',
    interleaves: ['bsq', 'bil', 'bip'],
    regionReads: true,
    decoder: 'purejsimage/envi',
  }),
})

interface EnviMapInfo {
  readonly projection: string
  readonly referenceX: number
  readonly referenceY: number
  readonly mapX: number
  readonly mapY: number
  readonly pixelX: number
  readonly pixelY: number
  readonly extras: readonly string[]
  readonly pixelToWorld: GeoAffineTransform
}

const list = (value: string): readonly string[] =>
  Object.freeze(
    value
      .replace(/^\s*\{/u, '')
      .replace(/\}\s*$/u, '')
      .split(',')
      .map((entry) => entry.trim()),
  )

const finite = (value: string | undefined, label: string): number => {
  const result = Number(value)
  if (value === undefined || value.length === 0 || !Number.isFinite(result)) {
    throw invalidInput(`ENVI map info ${label} must be finite`)
  }
  return result
}

const parseMapInfo = (value: string | undefined): EnviMapInfo => {
  if (value === undefined) throw unsupportedFormat('ENVI header has no map info georeferencing')
  const values = list(value)
  if (values.length < 7) throw invalidInput('ENVI map info requires at least seven values')
  const projection = values[0]
  if (projection === undefined || projection.length === 0) {
    throw invalidInput('ENVI map info projection name is empty')
  }
  const referenceX = finite(values[1], 'reference pixel X')
  const referenceY = finite(values[2], 'reference pixel Y')
  const mapX = finite(values[3], 'map X')
  const mapY = finite(values[4], 'map Y')
  const pixelX = finite(values[5], 'pixel size X')
  const pixelY = finite(values[6], 'pixel size Y')
  if (referenceX <= 0 || referenceY <= 0 || pixelX <= 0 || pixelY <= 0) {
    throw invalidInput('ENVI map info reference pixels and pixel sizes must be positive')
  }
  const centerColumn = referenceX - 1
  const centerRow = referenceY - 1
  return Object.freeze({
    projection,
    referenceX,
    referenceY,
    mapX,
    mapY,
    pixelX,
    pixelY,
    extras: Object.freeze(values.slice(7)),
    pixelToWorld: Object.freeze([
      pixelX,
      0,
      mapX - centerColumn * pixelX - pixelX / 2,
      0,
      -pixelY,
      mapY + centerRow * pixelY + pixelY / 2,
    ] as const),
  })
}

const extraValue = (map: EnviMapInfo, name: string): string | undefined => {
  const prefix = `${name.toLowerCase()}=`
  return map.extras
    .find((entry) => entry.toLowerCase().startsWith(prefix))
    ?.slice(prefix.length)
    .trim()
}

const coordinateType = (projection: string): GeoSpatialReference['coordinateSystemType'] =>
  /geographic|lat\s*\/?\s*lon|longitude/u.test(projection.toLowerCase())
    ? 'geographic'
    : /utm|projection|state plane/u.test(projection.toLowerCase())
      ? 'projected'
      : 'unknown'

const wktAuthority = (wkt: string | undefined): readonly [string, string] | undefined => {
  if (wkt === undefined) return undefined
  const matches = [
    ...wkt.matchAll(/(?:ID|AUTHORITY)\s*\[\s*["']([^"']+)["']\s*,\s*["']?(\d+)["']?/giu),
  ]
  const match = matches.at(-1)
  return match?.[1] === undefined || match[2] === undefined
    ? undefined
    : Object.freeze([match[1], match[2]])
}

const isWkt2 = (value: string): boolean =>
  /^\s*(?:PROJCRS|GEOGCRS|GEODCRS|COMPOUNDCRS|VERTCRS)\s*\[/iu.test(value)

const wktCoordinateType = (
  value: string | undefined,
): GeoSpatialReference['coordinateSystemType'] | undefined => {
  const type = geoCoordinateSystemTypeFromWkt(value)
  return type === 'unknown' ? undefined : type
}

const enviSpatialReference = (
  map: EnviMapInfo,
  coordinateSystemString: string | undefined,
): GeoSpatialReference => {
  const type = coordinateType(map.projection)
  const wktType = wktCoordinateType(coordinateSystemString)
  const conflictingTypes = wktType !== undefined && type !== 'unknown' && wktType !== type
  const authority = wktAuthority(coordinateSystemString)
  const units = extraValue(map, 'units')
  return normalizeGeoSpatialReference({
    schemaVersion: geoRasterSchemaVersion,
    coordinateSystemType: type,
    ...(authority?.[0] === undefined ? {} : { authority: authority[0] }),
    ...(authority?.[1] === undefined ? {} : { code: authority[1] }),
    name: map.projection,
    ...(coordinateSystemString !== undefined && isWkt2(coordinateSystemString)
      ? { wkt2: coordinateSystemString }
      : {}),
    ...(units === undefined ? {} : { horizontalUnit: { name: units, symbol: units } }),
    formalAxes: [],
    applicationAxes: { x: { name: 'X' }, y: { name: 'Y' } },
    evidence: Object.freeze([
      Object.freeze({
        kind: 'embedded' as const,
        sourceId: 'header',
        locator: 'map info',
        citation: map.projection,
        metadata: normalizeScientificMetadataObject({
          referencePixel: [map.referenceX, map.referenceY],
          mapCoordinate: [map.mapX, map.mapY],
          pixelSize: [map.pixelX, map.pixelY],
          extras: map.extras,
        }),
      }),
      ...(coordinateSystemString === undefined
        ? []
        : [
            Object.freeze({
              kind: 'embedded' as const,
              sourceId: 'header',
              locator: 'coordinate system string',
              metadata: normalizeScientificMetadataObject({ originalWkt: coordinateSystemString }),
            }),
          ]),
    ]),
    state: type === 'unknown' ? 'unknown' : 'incomplete',
    confidence: coordinateSystemString === undefined || conflictingTypes ? 0.65 : 0.8,
    diagnostics:
      type === 'unknown'
        ? [
            {
              severity: 'warning',
              code: 'unknown-crs',
              message: 'ENVI map info defines a grid but the coordinate system type is unknown.',
              path: 'map info',
            },
          ]
        : conflictingTypes
          ? [
              {
                severity: 'warning',
                code: 'incomplete-crs',
                message: `ENVI map info is ${type}, but the coordinate-system string is ${wktType}.`,
                path: 'coordinate system string',
              },
            ]
          : [],
  })
}

const optionalFinite = (value: string | undefined, label: string): number | undefined => {
  if (value === undefined) return undefined
  const result = Number(value)
  if (!Number.isFinite(result)) throw invalidInput(`ENVI ${label} must be finite`)
  return result
}

const headerFields = (document: ScientificDocument): Readonly<Record<string, string>> => {
  const fields = document.metadata.fields
  if (fields === null || Array.isArray(fields) || typeof fields !== 'object') {
    throw invalidInput('ENVI normalized header fields are unavailable')
  }
  const output: Record<string, string> = {}
  for (const [key, value] of Object.entries(fields))
    if (typeof value === 'string') output[key] = value
  return Object.freeze(output)
}

const bandEntries = (
  fields: Readonly<Record<string, string>>,
  count: number,
): GeoMetadataObject => {
  const names = fields['band names'] === undefined ? undefined : list(fields['band names'])
  const wavelengths =
    fields.wavelength === undefined ? undefined : list(fields.wavelength).map(Number)
  const wavelengthUnit = fields['wavelength units']
  return normalizeScientificMetadataObject({
    entries: Array.from({ length: count }, (_, index) => ({
      index,
      name: names?.[index] ?? null,
      wavelength:
        wavelengths?.[index] === undefined || !Number.isFinite(wavelengths[index])
          ? null
          : wavelengths[index],
      wavelengthUnit: wavelengthUnit ?? null,
    })),
  })
}

const createDocument = async (
  context: Readonly<ScientificOpenContext>,
): Promise<GeoRasterDocument> => {
  const scientificDocument = await enviReader.open(context)
  const fields = headerFields(scientificDocument)
  const map = parseMapInfo(fields['map info'])
  const reference = enviSpatialReference(map, fields['coordinate system string'])
  const summary = scientificDocument.datasets[0]
  if (summary === undefined) throw invalidInput('ENVI scientific reader returned no dataset')
  const source = await scientificDocument.openDataset(summary.id, {
    ...(context.signal === undefined ? {} : { signal: context.signal }),
  })
  const noData = optionalFinite(fields['data ignore value'], 'data ignore value')
  const reflectanceFactor = optionalFinite(
    fields['reflectance scale factor'],
    'reflectance scale factor',
  )
  if (reflectanceFactor !== undefined && reflectanceFactor <= 0) {
    throw invalidInput('ENVI reflectance scale factor must be positive')
  }
  const component = source.descriptor.components[0]
  if (component === undefined) throw invalidInput('ENVI scientific dataset has no sample component')
  const band: GeoBandDescriptor = Object.freeze({
    sourceComponentIndex: 0,
    name: component.name ?? component.id,
    colorInterpretation: 'undefined',
    ...(reflectanceFactor === undefined ? {} : { scale: 1 / reflectanceFactor }),
    ...(noData === undefined ? {} : { noData }),
    dataType: source.descriptor.sampleType,
    categorical: fields['file type']?.toLowerCase() === 'envi classification',
  })
  const channel = source.descriptor.axes.find(({ id }) => id === 'channel')
  const acquisition = Object.fromEntries(
    ['acquisition time', 'sensor type', 'sun azimuth', 'sun elevation', 'cloud cover'].flatMap(
      (key) => (fields[key] === undefined ? [] : [[key, fields[key]] as const]),
    ),
  )
  const formatEvidence = normalizeScientificMetadataObject({
    samples: source.descriptor.axes.find(({ id }) => id === 'x')?.length ?? 0,
    lines: source.descriptor.axes.find(({ id }) => id === 'y')?.length ?? 0,
    bands: channel?.length ?? 1,
    dataType: scientificDocument.metadata.dataType ?? null,
    interleave: scientificDocument.metadata.interleave ?? null,
    byteOrder: scientificDocument.metadata.byteOrder ?? null,
    headerOffset: scientificDocument.metadata.headerOffset ?? null,
    mapInfo: fields['map info'] ?? null,
    coordinateSystemString: fields['coordinate system string'] ?? null,
    acquisition,
  })
  const dataset = createGeoDatasetFromScientific(source, {
    id: summary.id,
    ...(summary.name === undefined ? {} : { title: summary.name }),
    pixelToWorld: map.pixelToWorld,
    pixelRegistration: 'pixel-is-area',
    spatialReference: reference,
    ...(noData === undefined ? {} : { noData: { kind: 'scalar', value: noData } }),
    bands: Object.freeze([band]),
    axisKinds: { channel: 'band' },
    ...(channel === undefined
      ? {}
      : { axisMetadata: { channel: bandEntries(fields, channel.length) } }),
    sourceFormat: { id: 'envi', name: 'ENVI' },
    formatEvidence,
    storage: Object.freeze({
      organization: 'contiguous',
      byteOrder: scientificDocument.metadata.byteOrder === 0 ? 'little-endian' : 'big-endian',
      metadata: normalizeScientificMetadataObject({
        interleave: scientificDocument.metadata.interleave ?? null,
      }),
    }),
  })
  return Object.freeze({
    reader: Object.freeze({
      id: geoEnviReaderDescriptor.id,
      version: geoEnviReaderDescriptor.version,
    }),
    format: geoEnviReaderDescriptor.format,
    metadata: formatEvidence,
    datasets: Object.freeze([
      Object.freeze({
        id: summary.id,
        ...(summary.name === undefined ? {} : { name: summary.name }),
        descriptor: dataset.descriptor,
        diagnostics: dataset.descriptor.diagnostics,
      }),
    ]),
    async openDataset(id: string, options?: Readonly<AbortOptions>) {
      throwIfAborted(options?.signal ?? context.signal)
      if (id !== summary.id) throw invalidInput(`Unknown ENVI geo dataset ${id}`)
      return dataset
    },
    ...(scientificDocument.close === undefined
      ? {}
      : { close: () => scientificDocument.close?.() }),
  })
}

export const geoEnviReader: GeoRasterReader = Object.freeze({
  descriptor: geoEnviReaderDescriptor,
  async probe(context: Readonly<ScientificOpenContext>) {
    const result = await enviReader.probe(context)
    if (result.confidence === 0) return result
    const primaryLength = Math.min(context.primary.source.size, 16_384)
    const primaryBytes = await context.primary.source.read(0, primaryLength, {
      ...(context.signal === undefined ? {} : { signal: context.signal }),
    })
    let header: ScientificResource = context.primary
    if (!/^(?:\uFEFF)?\s*ENVI(?:\r?\n|\r)/u.test(new TextDecoder().decode(primaryBytes))) {
      const name = context.primary.name
      const slash = name?.lastIndexOf('/') ?? -1
      const leaf = name === undefined ? undefined : name.slice(slash + 1)
      const dot = leaf?.lastIndexOf('.') ?? -1
      const stem =
        name === undefined || leaf === undefined
          ? undefined
          : `${slash < 0 ? '' : name.slice(0, slash + 1)}${dot > 0 ? leaf.slice(0, dot) : leaf}`
      const resolved =
        stem === undefined
          ? undefined
          : await context.companions?.resolve(
              { kind: 'role', role: 'header', relativeName: `${stem}.hdr` },
              { ...(context.signal === undefined ? {} : { signal: context.signal }) },
            )
      if (resolved === undefined) {
        return Object.freeze({ confidence: 0, reason: 'ENVI geo header is unavailable' })
      }
      header = resolved
    }
    const length = Math.min(header.source.size, 16_384)
    const bytes = await header.source.read(0, length, {
      ...(context.signal === undefined ? {} : { signal: context.signal }),
    })
    const text = new TextDecoder().decode(bytes)
    return /(?:^|\n)\s*map\s+info\s*=/iu.test(text)
      ? Object.freeze({ confidence: result.confidence, reason: 'ENVI header contains map info' })
      : Object.freeze({ confidence: 0, reason: 'ENVI header probe has no map info' })
  },
  open(context: Readonly<ScientificOpenContext>) {
    throwIfAborted(context.signal)
    return createDocument(context)
  },
})
