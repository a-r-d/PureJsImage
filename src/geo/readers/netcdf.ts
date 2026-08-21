import type { AbortOptions } from '../../abort.ts'
import { throwIfAborted } from '../../abort.ts'
import { invalidInput, unsupportedFormat } from '../../errors.ts'
import {
  type NetCdfAttribute,
  type NetCdfClassicFile,
  type NetCdfDimension,
  type NetCdfVariable,
  netCdfAttributeNumbers,
  netCdfAttributeString,
  openNetCdfClassic,
  readNetCdfVariableSection,
  readNetCdfVariableValues,
} from '../../netcdf/classic.ts'
import type { RasterBlock } from '../../raster.ts'
import type {
  NormalizedScientificDatasetDescriptor,
  ScientificAxisDescriptor,
  ScientificDataset,
  ScientificMetadataObject,
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
import type {
  GeoAffineTransform,
  GeoAxisKind,
  GeoBandDescriptor,
  GeoDiagnostic,
  GeoMetadataObject,
  GeoNoDataValue,
  GeoRasterDataset,
  GeoSpatialReference,
} from '../contracts.ts'
import { geoRasterSchemaVersion, normalizeGeoSpatialReference } from '../contracts.ts'
import { geoCoordinateSystemTypeFromWkt } from '../crs.ts'
import type { GeoRasterDocument, GeoRasterReader } from './index.ts'
import { createGeoDatasetFromScientific } from './shared.ts'

export interface GeoNetCdfReaderLimits {
  readonly maxHeaderBytes?: number
  readonly headerReadChunkBytes?: number
  readonly maxDimensions?: number
  readonly maxVariables?: number
  readonly maxAttributes?: number
  readonly maxNameBytes?: number
  readonly maxAttributeValues?: number
  readonly maxAttributeBytes?: number
  readonly maxRecordCount?: number
  readonly maxVariableElements?: number
  readonly maxCoordinateValues?: number
  readonly maxCoordinateBytes?: number
  readonly maxRegionBytes?: number
  readonly maxRegionValues?: number
  readonly maxReadOperations?: number
  readonly coordinateRelativeTolerance?: number
  readonly coordinateAbsoluteTolerance?: number
}

export interface CfGridMappingDefinition {
  readonly name: string
  readonly coordinateSystemType: GeoSpatialReference['coordinateSystemType']
  readonly requiresCoordinateTransformer: boolean
}

export const cfGridMappings: readonly CfGridMappingDefinition[] = Object.freeze([
  Object.freeze({
    name: 'latitude_longitude',
    coordinateSystemType: 'geographic',
    requiresCoordinateTransformer: false,
  }),
  Object.freeze({
    name: 'transverse_mercator',
    coordinateSystemType: 'projected',
    requiresCoordinateTransformer: true,
  }),
  Object.freeze({
    name: 'lambert_conformal_conic',
    coordinateSystemType: 'projected',
    requiresCoordinateTransformer: true,
  }),
  Object.freeze({
    name: 'polar_stereographic',
    coordinateSystemType: 'projected',
    requiresCoordinateTransformer: true,
  }),
  Object.freeze({
    name: 'mercator',
    coordinateSystemType: 'projected',
    requiresCoordinateTransformer: true,
  }),
  Object.freeze({
    name: 'albers_conical_equal_area',
    coordinateSystemType: 'projected',
    requiresCoordinateTransformer: true,
  }),
  Object.freeze({
    name: 'rotated_latitude_longitude',
    coordinateSystemType: 'geographic',
    requiresCoordinateTransformer: true,
  }),
])

export const geoNetCdfReaderDescriptor: ScientificReaderDescriptor = Object.freeze({
  id: 'purejsimage/geo/netcdf',
  version: '1.0.0',
  format: 'Classic NetCDF with CF rectilinear grids',
  extensions: Object.freeze(['nc', 'cdf', 'netcdf']),
  mediaTypes: Object.freeze(['application/x-netcdf']),
  capabilities: Object.freeze({
    containers: ['CDF-1', 'CDF-2'],
    datasets: 'one-per-regular-CF-raster-variable',
    regionReads: true,
    remoteRangeReads: true,
    curvilinear: 'detected-unsupported',
    netcdf4: false,
  }),
})

interface ResolvedReaderLimits {
  readonly maxCoordinateValues: number
  readonly maxCoordinateBytes: number
  readonly maxRegionBytes: number
  readonly maxRegionValues: number
  readonly maxReadOperations: number
  readonly coordinateRelativeTolerance: number
  readonly coordinateAbsoluteTolerance: number
}

interface RegularAxis {
  readonly origin: number
  readonly step: number
  readonly values: readonly number[]
}

interface CandidateRecord {
  readonly variable: string
  readonly status: 'dataset' | 'not-raster' | 'unsupported-grid'
  readonly reason: string
  readonly diagnostics: readonly GeoDiagnostic[]
}

const positive = (value: number | undefined, fallback: number, label: string): number => {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || result < 1) throw invalidInput(`${label} must be positive`)
  return result
}

const nonNegativeFinite = (value: number | undefined, fallback: number, label: string): number => {
  const result = value ?? fallback
  if (!Number.isFinite(result) || result < 0) {
    throw invalidInput(`${label} must be a non-negative finite number`)
  }
  return result
}

const resolveReaderLimits = (options: Readonly<GeoNetCdfReaderLimits>): ResolvedReaderLimits =>
  Object.freeze({
    maxCoordinateValues: positive(options.maxCoordinateValues, 65_536, 'maxCoordinateValues'),
    maxCoordinateBytes: positive(
      options.maxCoordinateBytes,
      16 * 1024 * 1024,
      'maxCoordinateBytes',
    ),
    maxRegionBytes: positive(options.maxRegionBytes, 64 * 1024 * 1024, 'maxRegionBytes'),
    maxRegionValues: positive(options.maxRegionValues, 16_777_216, 'maxRegionValues'),
    maxReadOperations: positive(options.maxReadOperations, 1_048_576, 'maxReadOperations'),
    coordinateRelativeTolerance: nonNegativeFinite(
      options.coordinateRelativeTolerance,
      1e-9,
      'coordinateRelativeTolerance',
    ),
    coordinateAbsoluteTolerance: nonNegativeFinite(
      options.coordinateAbsoluteTolerance,
      1e-12,
      'coordinateAbsoluteTolerance',
    ),
  })

const attributeMetadata = (attributes: readonly NetCdfAttribute[]): GeoMetadataObject =>
  normalizeScientificMetadataObject(
    Object.fromEntries(
      attributes.map((attribute) => [
        attribute.name,
        typeof attribute.values === 'string'
          ? attribute.values
          : attribute.values.map((value) =>
              Number.isNaN(value)
                ? 'NaN'
                : value === Number.POSITIVE_INFINITY
                  ? 'Infinity'
                  : value === Number.NEGATIVE_INFINITY
                    ? '-Infinity'
                    : value,
            ),
      ]),
    ),
  )

const scalarAttribute = (
  attributes: readonly NetCdfAttribute[],
  name: string,
): number | undefined => {
  const values = netCdfAttributeNumbers(attributes, name)
  return values?.length === 1 && Number.isFinite(values[0]) ? values[0] : undefined
}

const validRange = (
  attributes: readonly NetCdfAttribute[],
): readonly [number, number] | undefined => {
  const declared = netCdfAttributeNumbers(attributes, 'valid_range')
  if (declared?.length === 2 && declared.every(Number.isFinite)) {
    return Object.freeze([declared[0] ?? 0, declared[1] ?? 0])
  }
  const minimum = scalarAttribute(attributes, 'valid_min')
  const maximum = scalarAttribute(attributes, 'valid_max')
  return minimum === undefined || maximum === undefined
    ? undefined
    : Object.freeze([minimum, maximum])
}

const noDataValue = (variable: NetCdfVariable): GeoNoDataValue | undefined => {
  const fill = netCdfAttributeNumbers(variable.attributes, '_FillValue')
  const missing = netCdfAttributeNumbers(variable.attributes, 'missing_value')
  const value = fill?.length === 1 ? fill[0] : missing?.find(Number.isFinite)
  if (value === undefined) return undefined
  if (Number.isNaN(value)) return 'NaN'
  return Number.isFinite(value) ? value : undefined
}

const coordinateTokens = (variable: NetCdfVariable): readonly string[] =>
  Object.freeze(
    (netCdfAttributeString(variable.attributes, 'coordinates') ?? '')
      .trim()
      .split(/\s+/u)
      .filter((value) => value.length > 0),
  )

type CoordinateRole = 'x' | 'y' | 'time' | 'vertical' | 'band' | 'ensemble' | 'other'

const coordinateRole = (variable: NetCdfVariable): CoordinateRole => {
  const standard = netCdfAttributeString(variable.attributes, 'standard_name')?.toLowerCase() ?? ''
  const axis = netCdfAttributeString(variable.attributes, 'axis')?.toUpperCase()
  const units = netCdfAttributeString(variable.attributes, 'units')?.toLowerCase() ?? ''
  const name = variable.name.toLowerCase()
  if (
    axis === 'X' ||
    standard === 'longitude' ||
    standard === 'projection_x_coordinate' ||
    /degrees?_east/u.test(units) ||
    /^(?:lon|longitude|x)$/u.test(name)
  ) {
    return 'x'
  }
  if (
    axis === 'Y' ||
    standard === 'latitude' ||
    standard === 'projection_y_coordinate' ||
    /degrees?_north/u.test(units) ||
    /^(?:lat|latitude|y)$/u.test(name)
  ) {
    return 'y'
  }
  if (axis === 'T' || standard === 'time' || /\bsince\b/u.test(units) || name === 'time') {
    return 'time'
  }
  if (
    axis === 'Z' ||
    netCdfAttributeString(variable.attributes, 'positive') !== undefined ||
    /height|depth|altitude|pressure/u.test(standard) ||
    /^(?:z|level|lev|depth|height)$/u.test(name)
  ) {
    return 'vertical'
  }
  if (/band|channel|wavelength/u.test(`${standard} ${name}`)) return 'band'
  if (/ensemble|realization|member/u.test(`${standard} ${name}`)) return 'ensemble'
  return 'other'
}

const mappingByName = (name: string | undefined): CfGridMappingDefinition | undefined =>
  name === undefined ? undefined : cfGridMappings.find((entry) => entry.name === name)

const regularAxis = (
  values: readonly number[],
  limits: ResolvedReaderLimits,
): RegularAxis | undefined => {
  if (values.length < 2 || values.some((value) => !Number.isFinite(value))) return undefined
  const origin = values[0]
  const last = values.at(-1)
  if (origin === undefined || last === undefined) return undefined
  const step = (last - origin) / (values.length - 1)
  if (!Number.isFinite(step) || step === 0) return undefined
  for (let index = 0; index < values.length; index += 1) {
    const expected = origin + index * step
    const actual = values[index]
    if (actual === undefined) return undefined
    const tolerance = Math.max(
      limits.coordinateAbsoluteTolerance,
      limits.coordinateRelativeTolerance * Math.max(1, Math.abs(step), Math.abs(expected)),
    )
    if (Math.abs(actual - expected) > tolerance) return undefined
  }
  return Object.freeze({ origin, step, values })
}

const wktType = (wkt: string): GeoSpatialReference['coordinateSystemType'] | undefined => {
  const type = geoCoordinateSystemTypeFromWkt(wkt)
  return type === 'unknown' ? undefined : type
}

const wktAuthority = (wkt: string): readonly [string, string] | undefined => {
  const matches = [
    ...wkt.matchAll(/(?:ID|AUTHORITY)\s*\[\s*["']([^"']+)["']\s*,\s*["']?(\d+)["']?/giu),
  ]
  const match = matches.at(-1)
  return match?.[1] === undefined || match[2] === undefined
    ? undefined
    : Object.freeze([match[1], match[2]])
}

const spatialReference = (
  xCoordinate: NetCdfVariable,
  yCoordinate: NetCdfVariable,
  mappingVariable: NetCdfVariable | undefined,
): { readonly reference: GeoSpatialReference; readonly diagnostics: readonly GeoDiagnostic[] } => {
  const mappingName =
    mappingVariable === undefined
      ? undefined
      : netCdfAttributeString(mappingVariable.attributes, 'grid_mapping_name')
  const definition = mappingByName(mappingName)
  const wkt =
    mappingVariable === undefined
      ? undefined
      : (netCdfAttributeString(mappingVariable.attributes, 'crs_wkt') ??
        netCdfAttributeString(mappingVariable.attributes, 'spatial_ref'))
  const coordinateType =
    wkt === undefined
      ? (definition?.coordinateSystemType ??
        (coordinateRole(xCoordinate) === 'x' &&
        /degrees?_east/u.test(netCdfAttributeString(xCoordinate.attributes, 'units') ?? '')
          ? 'geographic'
          : 'unknown'))
      : (wktType(wkt) ?? definition?.coordinateSystemType ?? 'unknown')
  const authority = wkt === undefined ? undefined : wktAuthority(wkt)
  const unsupportedMapping = mappingName !== undefined && definition === undefined
  const diagnostics: GeoDiagnostic[] = unsupportedMapping
    ? [
        Object.freeze({
          severity: 'warning',
          code: 'netcdf-unsupported-grid-mapping',
          message: `CF grid mapping ${mappingName} is preserved but is not recognized.`,
          path: `variables.${mappingVariable?.name ?? ''}.grid_mapping_name`,
        }),
      ]
    : []
  const evidenceMetadata = normalizeScientificMetadataObject({
    xCoordinate: xCoordinate.name,
    yCoordinate: yCoordinate.name,
    ...(mappingName === undefined ? {} : { gridMappingName: mappingName }),
    ...(mappingVariable === undefined
      ? {}
      : { attributes: attributeMetadata(mappingVariable.attributes) }),
    ...(wkt === undefined ? {} : { originalWkt: wkt }),
  })
  const reference = normalizeGeoSpatialReference({
    schemaVersion: geoRasterSchemaVersion,
    coordinateSystemType: coordinateType,
    ...(authority?.[0] === undefined ? {} : { authority: authority[0] }),
    ...(authority?.[1] === undefined ? {} : { code: authority[1] }),
    ...(mappingName === undefined ? {} : { name: mappingName }),
    ...(wkt !== undefined && /^\s*(?:PROJCRS|GEOGCRS|GEODCRS|COMPOUNDCRS|VERTCRS)\s*\[/iu.test(wkt)
      ? { wkt2: wkt }
      : {}),
    formalAxes: [],
    applicationAxes: {
      x: { name: netCdfAttributeString(xCoordinate.attributes, 'long_name') ?? xCoordinate.name },
      y: { name: netCdfAttributeString(yCoordinate.attributes, 'long_name') ?? yCoordinate.name },
    },
    evidence: [
      {
        kind: 'embedded',
        sourceId: 'primary',
        locator: mappingVariable?.name ?? `${xCoordinate.name},${yCoordinate.name}`,
        citation: 'CF coordinate and grid-mapping attributes',
        metadata: evidenceMetadata,
      },
    ],
    state: coordinateType === 'unknown' || unsupportedMapping ? 'unknown' : 'incomplete',
    confidence: coordinateType === 'unknown' ? 0.35 : wkt === undefined ? 0.7 : 0.9,
    diagnostics: [
      ...(coordinateType === 'unknown'
        ? [
            {
              severity: 'warning' as const,
              code: 'unknown-crs' as const,
              message:
                'CF coordinates define a grid but the coordinate reference system is incomplete.',
              path: 'spatialReference',
            },
          ]
        : []),
      ...diagnostics,
    ],
  })
  return Object.freeze({ reference, diagnostics: Object.freeze(diagnostics) })
}

const calendarDiagnostic = (coordinate: NetCdfVariable): GeoDiagnostic | undefined => {
  const calendar = netCdfAttributeString(coordinate.attributes, 'calendar')?.toLowerCase()
  if (calendar === undefined) return undefined
  const supported = new Set([
    'standard',
    'gregorian',
    'proleptic_gregorian',
    'julian',
    'noleap',
    '365_day',
    'all_leap',
    '366_day',
    '360_day',
  ])
  return supported.has(calendar)
    ? undefined
    : Object.freeze({
        severity: 'warning',
        code: 'netcdf-unsupported-calendar',
        message: `CF calendar ${calendar} is preserved but is not interpreted.`,
        path: `variables.${coordinate.name}.calendar`,
      })
}

class NetCdfScientificDataset implements ScientificDataset {
  readonly descriptor: NormalizedScientificDatasetDescriptor
  readonly #file: NetCdfClassicFile
  readonly #variable: NetCdfVariable
  readonly #xDimension: NetCdfDimension
  readonly #yDimension: NetCdfDimension
  readonly #limits: ResolvedReaderLimits

  constructor(options: {
    readonly descriptor: NormalizedScientificDatasetDescriptor
    readonly file: NetCdfClassicFile
    readonly variable: NetCdfVariable
    readonly xDimension: NetCdfDimension
    readonly yDimension: NetCdfDimension
    readonly limits: ResolvedReaderLimits
  }) {
    this.descriptor = options.descriptor
    this.#file = options.file
    this.#variable = options.variable
    this.#xDimension = options.xDimension
    this.#yDimension = options.yDimension
    this.#limits = options.limits
  }

  async *readPlane(request: Readonly<ScientificPlaneReadRequest>): AsyncIterable<RasterBlock> {
    const selected = normalizeScientificPlaneReadRequest(this.descriptor, request)
    if (
      selected.displayAxes[0] !== this.#xDimension.name ||
      selected.displayAxes[1] !== this.#yDimension.name
    ) {
      throw invalidInput(`NetCDF variable ${this.#variable.name} requires its CF X/Y axis order`)
    }
    const fixedIndices = new Map(
      selected.fixedIndices.map((entry) => {
        const dimension = this.#variable.dimensions.find(({ name }) => name === entry.axisId)
        if (dimension === undefined) throw invalidInput(`Unknown NetCDF dimension ${entry.axisId}`)
        return [dimension.id, entry.index] as const
      }),
    )
    const data = await readNetCdfVariableSection(this.#file, this.#variable, {
      xDimensionId: this.#xDimension.id,
      yDimensionId: this.#yDimension.id,
      fixedIndices,
      x: selected.x,
      y: selected.y,
      width: selected.width,
      height: selected.height,
      limits: {
        maxBytes: this.#limits.maxRegionBytes,
        maxValues: this.#limits.maxRegionValues,
        maxReadOperations: this.#limits.maxReadOperations,
      },
      ...(selected.signal === undefined ? {} : { signal: selected.signal }),
    })
    yield Object.freeze({
      x: selected.x,
      y: selected.y,
      width: selected.width,
      height: selected.height,
      stride: selected.width * this.#variable.elementBytes,
      format: Object.freeze({
        sampleType: this.#variable.sampleType ?? 'uint8',
        channels: 1,
        planar: false,
      }),
      data,
    })
  }
}

const axisKind = (
  role: CoordinateRole,
  coordinate: NetCdfVariable | undefined,
): ScientificAxisDescriptor['kind'] => {
  if (role === 'x' || role === 'y') return 'space'
  if (role === 'time') return 'time'
  if (role === 'vertical') return 'space'
  if (role === 'band') return 'channel'
  if (role === 'ensemble') return 'other'
  return coordinate === undefined ? 'index' : 'other'
}

const geoAxisKind = (role: CoordinateRole): GeoAxisKind => {
  if (role === 'time') return 'time'
  if (role === 'vertical') return 'vertical'
  if (role === 'band') return 'band'
  if (role === 'ensemble') return 'ensemble'
  return 'other'
}

const variableMetadata = (variable: NetCdfVariable): ScientificMetadataObject =>
  normalizeScientificMetadataObject({
    name: variable.name,
    dimensions: variable.dimensions.map(({ name }) => name),
    type: variable.type,
    record: variable.record,
    declaredSize: variable.declaredSize,
    dataOffset: variable.dataOffset,
    attributes: attributeMetadata(variable.attributes),
  })

const createReaderDocument = async (
  context: Readonly<ScientificOpenContext>,
  options: Readonly<GeoNetCdfReaderLimits>,
): Promise<GeoRasterDocument> => {
  const readerLimits = resolveReaderLimits(options)
  const file = await openNetCdfClassic(context.primary.source, {
    ...options,
    ...(context.signal === undefined ? {} : { signal: context.signal }),
  })
  const byName = new Map(file.variables.map((variable) => [variable.name, variable]))
  const coordinateVariables = file.variables.filter(
    (variable) =>
      variable.sampleType !== undefined &&
      variable.dimensionIds.length === 1 &&
      variable.dimensionIds[0] !== undefined &&
      variable.name === file.dimensions[variable.dimensionIds[0]]?.name,
  )
  const coordinateCache = new Map<string, Promise<readonly number[]>>()
  const valuesFor = (variable: NetCdfVariable): Promise<readonly number[]> => {
    const cached = coordinateCache.get(variable.name)
    if (cached !== undefined) return cached
    const values = readNetCdfVariableValues(
      file,
      variable,
      {
        maxBytes: readerLimits.maxCoordinateBytes,
        maxValues: readerLimits.maxCoordinateValues,
        maxReadOperations: readerLimits.maxReadOperations,
      },
      context.signal,
    )
    coordinateCache.set(variable.name, values)
    return values
  }
  const referencedCoordinates = new Set(
    file.variables
      .flatMap((variable) => [
        ...coordinateTokens(variable),
        netCdfAttributeString(variable.attributes, 'grid_mapping') ?? '',
      ])
      .filter(Boolean),
  )
  const records: CandidateRecord[] = []
  const entries: { readonly id: string; readonly dataset: GeoRasterDataset }[] = []
  for (const variable of file.variables) {
    throwIfAborted(context.signal)
    if (
      variable.sampleType === undefined ||
      variable.dimensions.length < 2 ||
      coordinateVariables.includes(variable) ||
      referencedCoordinates.has(variable.name)
    ) {
      records.push(
        Object.freeze({
          variable: variable.name,
          status: 'not-raster',
          reason: 'metadata or coordinate variable',
          diagnostics: [],
        }),
      )
      continue
    }
    if (variable.dimensions.some(({ length }) => length < 1)) {
      records.push(
        Object.freeze({
          variable: variable.name,
          status: 'unsupported-grid',
          reason: 'zero-length dimension',
          diagnostics: [],
        }),
      )
      continue
    }
    const explicitCoordinates = coordinateTokens(variable)
      .map((name) => byName.get(name))
      .filter((entry): entry is NetCdfVariable => entry !== undefined)
    const availableCoordinates = [...explicitCoordinates, ...coordinateVariables]
    const curvilinear = availableCoordinates.filter(
      (coordinate) =>
        coordinate.dimensionIds.length === 2 &&
        (coordinateRole(coordinate) === 'x' || coordinateRole(coordinate) === 'y') &&
        coordinate.dimensionIds.every((id) => variable.dimensionIds.includes(id)),
    )
    if (
      curvilinear.some((coordinate) => coordinateRole(coordinate) === 'x') &&
      curvilinear.some((coordinate) => coordinateRole(coordinate) === 'y')
    ) {
      const diagnostic: GeoDiagnostic = Object.freeze({
        severity: 'warning',
        code: 'netcdf-curvilinear-grid',
        message:
          'Two-dimensional longitude/latitude coordinates are curvilinear and are not exposed as an affine Geo raster.',
        path: `variables.${variable.name}.coordinates`,
        metadata: normalizeScientificMetadataObject({
          coordinates: curvilinear.map(({ name }) => name),
        }),
      })
      records.push(
        Object.freeze({
          variable: variable.name,
          status: 'unsupported-grid',
          reason: 'curvilinear coordinates',
          diagnostics: [diagnostic],
        }),
      )
      continue
    }
    const oneDimensional = availableCoordinates.filter(
      (coordinate) =>
        coordinate.dimensionIds.length === 1 &&
        variable.dimensionIds.includes(coordinate.dimensionIds[0] ?? -1),
    )
    const xCoordinate = oneDimensional.find((coordinate) => coordinateRole(coordinate) === 'x')
    const yCoordinate = oneDimensional.find((coordinate) => coordinateRole(coordinate) === 'y')
    const xDimension =
      xCoordinate === undefined ? undefined : file.dimensions[xCoordinate.dimensionIds[0] ?? -1]
    const yDimension =
      yCoordinate === undefined ? undefined : file.dimensions[yCoordinate.dimensionIds[0] ?? -1]
    if (
      xCoordinate === undefined ||
      yCoordinate === undefined ||
      xDimension === undefined ||
      yDimension === undefined ||
      xDimension.id === yDimension.id
    ) {
      records.push(
        Object.freeze({
          variable: variable.name,
          status: 'not-raster',
          reason: 'distinct CF X/Y coordinate variables are unavailable',
          diagnostics: [],
        }),
      )
      continue
    }
    let xAxis: RegularAxis | undefined
    let yAxis: RegularAxis | undefined
    try {
      ;[xAxis, yAxis] = await Promise.all([valuesFor(xCoordinate), valuesFor(yCoordinate)]).then(
        ([xValues, yValues]) => [
          regularAxis(xValues, readerLimits),
          regularAxis(yValues, readerLimits),
        ],
      )
    } catch (error: unknown) {
      if (!(error instanceof Error) || !/max(?:Values|Bytes)/u.test(error.message)) throw error
    }
    if (xAxis === undefined || yAxis === undefined) {
      const diagnostic: GeoDiagnostic = Object.freeze({
        severity: 'warning',
        code: 'netcdf-irregular-rectilinear-grid',
        message:
          'One-dimensional CF coordinates require lookup and are not exposed through the affine-only Geo grid contract.',
        path: `variables.${variable.name}.coordinates`,
        metadata: normalizeScientificMetadataObject({ x: xCoordinate.name, y: yCoordinate.name }),
      })
      records.push(
        Object.freeze({
          variable: variable.name,
          status: 'unsupported-grid',
          reason: 'irregular rectilinear coordinates',
          diagnostics: [diagnostic],
        }),
      )
      continue
    }
    const mappingName = netCdfAttributeString(variable.attributes, 'grid_mapping')
    const mappingVariable = mappingName === undefined ? undefined : byName.get(mappingName)
    const reference = spatialReference(xCoordinate, yCoordinate, mappingVariable)
    const coordinateByDimension = new Map<number, NetCdfVariable>()
    for (const coordinate of oneDimensional) {
      const dimensionId = coordinate.dimensionIds[0]
      if (dimensionId !== undefined && !coordinateByDimension.has(dimensionId)) {
        coordinateByDimension.set(dimensionId, coordinate)
      }
    }
    const scientificAxes: ScientificAxisDescriptor[] = []
    const axisKinds: Record<string, GeoAxisKind> = {}
    const axisMetadata: Record<string, GeoMetadataObject> = {}
    const diagnostics: GeoDiagnostic[] = [...reference.diagnostics]
    for (const dimension of variable.dimensions) {
      const coordinate = coordinateByDimension.get(dimension.id)
      const role =
        dimension.id === xDimension.id
          ? 'x'
          : dimension.id === yDimension.id
            ? 'y'
            : coordinate === undefined
              ? coordinateRole({ ...variable, name: dimension.name })
              : coordinateRole(coordinate)
      let coordinateValues: readonly number[] | undefined
      if (
        coordinate !== undefined &&
        dimension.id !== xDimension.id &&
        dimension.id !== yDimension.id
      ) {
        try {
          coordinateValues = await valuesFor(coordinate)
        } catch (error: unknown) {
          if (!(error instanceof Error) || !/max(?:Values|Bytes)/u.test(error.message)) throw error
        }
      }
      const unit =
        coordinate === undefined ? undefined : netCdfAttributeString(coordinate.attributes, 'units')
      const coordinates: ScientificAxisDescriptor['coordinates'] =
        dimension.id === xDimension.id
          ? Object.freeze({ type: 'linear', origin: xAxis.origin, step: xAxis.step })
          : dimension.id === yDimension.id
            ? Object.freeze({ type: 'linear', origin: yAxis.origin, step: yAxis.step })
            : coordinateValues === undefined
              ? Object.freeze({ type: 'index' })
              : Object.freeze({ type: 'lookup', values: coordinateValues })
      scientificAxes.push(
        Object.freeze({
          id: dimension.name,
          name:
            coordinate === undefined
              ? dimension.name
              : (netCdfAttributeString(coordinate.attributes, 'long_name') ?? coordinate.name),
          kind: axisKind(role, coordinate),
          length: dimension.length,
          ...(unit === undefined ? {} : { unit }),
          coordinates,
        }),
      )
      if (role !== 'x' && role !== 'y') axisKinds[dimension.name] = geoAxisKind(role)
      if (coordinate !== undefined) {
        axisMetadata[dimension.name] = normalizeScientificMetadataObject({
          coordinateVariable: coordinate.name,
          attributes: attributeMetadata(coordinate.attributes),
        })
        const calendar = calendarDiagnostic(coordinate)
        if (calendar !== undefined) diagnostics.push(calendar)
      }
    }
    const noData = noDataValue(variable)
    const descriptor = normalizeScientificDatasetDescriptor({
      schemaVersion: 1,
      axes: scientificAxes,
      sampleType: variable.sampleType,
      components: [
        {
          id: variable.name,
          name:
            netCdfAttributeString(variable.attributes, 'long_name') ??
            netCdfAttributeString(variable.attributes, 'standard_name') ??
            variable.name,
          kind: 'scalar',
          ...(netCdfAttributeString(variable.attributes, 'units') === undefined
            ? {}
            : { unit: netCdfAttributeString(variable.attributes, 'units') }),
        },
      ],
      ...(typeof noData !== 'number' ? {} : { noDataValue: noData }),
      metadata: normalizeScientificMetadataObject({
        'purejsimage:netcdf': variableMetadata(variable),
      }),
      capabilities: {
        regionReads: true,
        resolutionLevels: false,
        planeReads: { kind: 'ordered-axis-pairs', pairs: [[xDimension.name, yDimension.name]] },
      },
    })
    const scientific = new NetCdfScientificDataset({
      descriptor,
      file,
      variable,
      xDimension,
      yDimension,
      limits: readerLimits,
    })
    identifyScientificDataset(
      scientific,
      await createScientificDatasetIdentity({
        reader: geoNetCdfReaderDescriptor,
        datasetId: variable.name,
        resources: [context.primary],
      }),
    )
    const scale = scalarAttribute(variable.attributes, 'scale_factor')
    const offset = scalarAttribute(variable.attributes, 'add_offset')
    const range = validRange(variable.attributes)
    const standardName = netCdfAttributeString(variable.attributes, 'standard_name')
    const unit = netCdfAttributeString(variable.attributes, 'units')
    const band: GeoBandDescriptor = Object.freeze({
      sourceComponentIndex: 0,
      name:
        netCdfAttributeString(variable.attributes, 'long_name') ??
        netCdfAttributeString(variable.attributes, 'standard_name') ??
        variable.name,
      ...(standardName === undefined ? {} : { commonName: standardName }),
      ...(unit === undefined ? {} : { unit }),
      ...(scale === undefined ? {} : { scale }),
      ...(offset === undefined ? {} : { offset }),
      ...(noData === undefined ? {} : { noData }),
      ...(range === undefined ? {} : { validRange: range }),
      colorInterpretation: /height|elevation|altitude/u.test(variable.name.toLowerCase())
        ? 'elevation'
        : 'undefined',
      dataType: variable.sampleType,
      categorical: false,
    })
    const affine: GeoAffineTransform = Object.freeze([
      xAxis.step,
      0,
      xAxis.origin,
      0,
      yAxis.step,
      yAxis.origin,
    ])
    const dataset = createGeoDatasetFromScientific(scientific, {
      id: variable.name,
      title: netCdfAttributeString(variable.attributes, 'long_name') ?? variable.name,
      xAxisId: xDimension.name,
      yAxisId: yDimension.name,
      pixelToWorld: affine,
      pixelRegistration: 'pixel-is-point',
      spatialReference: reference.reference,
      ...(noData === undefined ? {} : { noData: { kind: 'scalar', value: noData } }),
      bands: [band],
      axisKinds,
      axisMetadata,
      sourceFormat: {
        id: 'netcdf-classic-cf',
        name: `NetCDF CDF-${file.version} with CF metadata`,
      },
      formatEvidence: normalizeScientificMetadataObject({
        variable: variableMetadata(variable),
        xCoordinate: variableMetadata(xCoordinate),
        yCoordinate: variableMetadata(yCoordinate),
        ...(mappingVariable === undefined
          ? {}
          : { gridMapping: variableMetadata(mappingVariable) }),
        coordinateTolerance: {
          relative: readerLimits.coordinateRelativeTolerance,
          absolute: readerLimits.coordinateAbsoluteTolerance,
        },
      }),
      diagnostics,
      storage: {
        organization: variable.record ? 'stripped' : 'contiguous',
        byteOrder: 'big-endian',
        metadata: {
          record: variable.record,
          dataOffset: variable.dataOffset,
          declaredSize: variable.declaredSize,
        },
      },
    })
    entries.push(Object.freeze({ id: variable.name, dataset }))
    records.push(
      Object.freeze({
        variable: variable.name,
        status: 'dataset',
        reason: 'regular one-dimensional CF X/Y coordinates',
        diagnostics: dataset.descriptor.diagnostics,
      }),
    )
  }
  const metadata = normalizeScientificMetadataObject({
    container: `CDF-${file.version}`,
    numRecords: file.numRecords,
    headerByteLength: file.headerByteLength,
    metadataBytesRead: file.metadataBytesRead,
    dimensions: file.dimensions.map(({ id, name, length, unlimited }) => ({
      id,
      name,
      length,
      unlimited,
    })),
    globalAttributes: attributeMetadata(file.globalAttributes),
    variables: file.variables.map(variableMetadata),
    candidates: records,
    exclusions: {
      cdf5: 'unsupported',
      netcdf4Hdf5: 'unsupported',
      irregularRectilinear: 'coordinate-lookup-required',
      curvilinear: 'unsupported-grid',
    },
  })
  if (entries.length === 0 && records.every(({ status }) => status === 'not-raster')) {
    throw unsupportedFormat('NetCDF contains no CF raster variable with coordinate evidence')
  }
  return Object.freeze({
    reader: Object.freeze({
      id: geoNetCdfReaderDescriptor.id,
      version: geoNetCdfReaderDescriptor.version,
    }),
    format: geoNetCdfReaderDescriptor.format,
    metadata,
    datasets: Object.freeze(
      entries.map(({ id, dataset }) =>
        Object.freeze({
          id,
          ...(dataset.descriptor.title === undefined ? {} : { name: dataset.descriptor.title }),
          descriptor: dataset.descriptor,
          diagnostics: dataset.descriptor.diagnostics,
        }),
      ),
    ),
    async openDataset(id: string, openOptions?: Readonly<AbortOptions>) {
      throwIfAborted(openOptions?.signal ?? context.signal)
      const entry = entries.find((candidate) => candidate.id === id)
      if (entry === undefined) throw invalidInput(`Unknown NetCDF Geo dataset ${id}`)
      return entry.dataset
    },
  })
}

export const createGeoNetCdfReader = (
  options: Readonly<GeoNetCdfReaderLimits> = {},
): GeoRasterReader =>
  Object.freeze({
    descriptor: geoNetCdfReaderDescriptor,
    async probe(context: Readonly<ScientificOpenContext>) {
      throwIfAborted(context.signal)
      const magic = await context.primary.source.read(0, Math.min(4, context.primary.source.size), {
        ...(context.signal === undefined ? {} : { signal: context.signal }),
      })
      if (magic[0] !== 0x43 || magic[1] !== 0x44 || magic[2] !== 0x46) {
        return Object.freeze({ confidence: 0, reason: 'NetCDF CDF magic is absent' })
      }
      if (magic[3] === 5)
        return Object.freeze({ confidence: 0, reason: 'NetCDF CDF-5 is unsupported' })
      return magic[3] === 1 || magic[3] === 2
        ? Object.freeze({ confidence: 1, reason: `NetCDF CDF-${magic[3]} classic container` })
        : Object.freeze({ confidence: 0, reason: 'NetCDF classic version is unsupported' })
    },
    open(context: Readonly<ScientificOpenContext>) {
      return createReaderDocument(context, options)
    },
  })

export const geoNetCdfReader: GeoRasterReader = createGeoNetCdfReader()
