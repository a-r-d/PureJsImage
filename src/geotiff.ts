import { invalidInput, unsupportedOperation } from './errors.ts'
import type { TiffDirectory, TiffTagReadOptions, TiffTagValue } from './tiff/types.ts'
import type { TiffProfile, TiffProfileContext } from './tiff/profiles.ts'
import { parseXmlDocument, xmlChildren, xmlLocalName } from './xml.ts'

const tagModelPixelScale = 33_550
const tagModelTiepoint = 33_922
const tagModelTransformation = 34_264
const tagGeoKeyDirectory = 34_735
const tagGeoDoubleParams = 34_736
const tagGeoAsciiParams = 34_737
const tagGdalMetadata = 42_112
const tagGdalNoData = 42_113

const keyModelType = 1_024
const keyRasterType = 1_025
const keyModelCitation = 1_026
const keyGeographicType = 2_048
const keyGeographicCitation = 2_049
const keyGeodeticDatum = 2_050
const keyPrimeMeridian = 2_051
const keyGeographicLinearUnits = 2_052
const keyGeographicLinearUnitSize = 2_053
const keyAngularUnits = 2_054
const keyAngularUnitSize = 2_055
const keyEllipsoid = 2_056
const keySemiMajorAxis = 2_057
const keySemiMinorAxis = 2_058
const keyInverseFlattening = 2_059
const keyAzimuthUnits = 2_060
const keyPrimeMeridianLongitude = 2_061
const keyProjectedCrs = 3_072
const keyProjectedCitation = 3_073
const keyProjection = 3_074
const keyCoordinateTransform = 3_075
const keyProjectedLinearUnits = 3_076
const keyProjectedLinearUnitSize = 3_077
const keyVerticalCrs = 4_096
const keyVerticalCitation = 4_097
const keyVerticalDatum = 4_098
const keyVerticalUnits = 4_099

const geoKeyNames = new Map<number, string>([
  [keyModelType, 'GTModelTypeGeoKey'],
  [keyRasterType, 'GTRasterTypeGeoKey'],
  [keyModelCitation, 'GTCitationGeoKey'],
  [keyGeographicType, 'GeographicTypeGeoKey'],
  [keyGeographicCitation, 'GeogCitationGeoKey'],
  [keyGeodeticDatum, 'GeogGeodeticDatumGeoKey'],
  [keyPrimeMeridian, 'GeogPrimeMeridianGeoKey'],
  [keyGeographicLinearUnits, 'GeogLinearUnitsGeoKey'],
  [keyGeographicLinearUnitSize, 'GeogLinearUnitSizeGeoKey'],
  [keyAngularUnits, 'GeogAngularUnitsGeoKey'],
  [keyAngularUnitSize, 'GeogAngularUnitSizeGeoKey'],
  [keyEllipsoid, 'GeogEllipsoidGeoKey'],
  [keySemiMajorAxis, 'GeogSemiMajorAxisGeoKey'],
  [keySemiMinorAxis, 'GeogSemiMinorAxisGeoKey'],
  [keyInverseFlattening, 'GeogInvFlatteningGeoKey'],
  [keyAzimuthUnits, 'GeogAzimuthUnitsGeoKey'],
  [keyPrimeMeridianLongitude, 'GeogPrimeMeridianLongGeoKey'],
  [keyProjectedCrs, 'ProjectedCSTypeGeoKey'],
  [keyProjectedCitation, 'PCSCitationGeoKey'],
  [keyProjection, 'ProjectionGeoKey'],
  [keyCoordinateTransform, 'ProjCoordTransGeoKey'],
  [keyProjectedLinearUnits, 'ProjLinearUnitsGeoKey'],
  [keyProjectedLinearUnitSize, 'ProjLinearUnitSizeGeoKey'],
  [keyVerticalCrs, 'VerticalCSTypeGeoKey'],
  [keyVerticalCitation, 'VerticalCitationGeoKey'],
  [keyVerticalDatum, 'VerticalDatumGeoKey'],
  [keyVerticalUnits, 'VerticalUnitsGeoKey'],
])

export type GeoTiffRasterType = 'pixel-is-area' | 'pixel-is-point' | 'unspecified'

export interface GeoTiffPoint {
  readonly x: number
  readonly y: number
  readonly z: number
}

export interface GeoTiffBoundingBox {
  readonly minX: number
  readonly minY: number
  readonly maxX: number
  readonly maxY: number
}

export interface GeoTiffKey {
  readonly id: number
  readonly name?: string
  readonly recognized: boolean
  readonly location: number
  readonly count: number
  readonly offset: number
  readonly value: number | string | readonly number[] | null
  readonly unavailableReason?: string
}

export interface GeoTiffTiepoint {
  readonly raster: GeoTiffPoint
  readonly model: GeoTiffPoint
}

export type GeoTiffDiagnosticCode =
  | 'INCONSISTENT_TIEPOINT'
  | 'UNSUPPORTED_GCP_WARP'
  | 'UNSUPPORTED_PROJECTIVE_TRANSFORM'

export interface GeoTiffDiagnostic {
  readonly code: GeoTiffDiagnosticCode
  readonly severity: 'warning' | 'error'
  readonly message: string
  readonly tiepointIndex?: number
}

export interface GeoTiffGdalMetadataItem {
  readonly name: string
  readonly value: string
  readonly sample?: number
  readonly role?: string
  readonly domain?: string
}

export type GeoTiffNoData = number | string | readonly (number | string)[]

export interface GeoTiffModel {
  readonly kind: 'transformation' | 'tiepoint-scale'
  readonly matrix: readonly number[]
  pixelToModel(x: number, y: number, z?: number): GeoTiffPoint
}

export interface GeoTiffProfile {
  readonly directory: TiffDirectory
  readonly keys: ReadonlyMap<number, GeoTiffKey>
  readonly modelType?: number
  readonly rasterType: GeoTiffRasterType
  readonly projectedCrs?: number
  readonly geographicCrs?: number
  readonly verticalCrs?: number
  readonly verticalDatum?: number
  readonly verticalUnits?: number
  readonly modelCitation?: string
  readonly projectedCitation?: string
  readonly geographicCitation?: string
  readonly verticalCitation?: string
  readonly geodeticDatum?: number
  readonly primeMeridian?: number
  readonly geographicLinearUnits?: number
  readonly geographicLinearUnitSize?: number
  readonly angularUnits?: number
  readonly angularUnitSize?: number
  readonly ellipsoid?: number
  readonly semiMajorAxis?: number
  readonly semiMinorAxis?: number
  readonly inverseFlattening?: number
  readonly azimuthUnits?: number
  readonly primeMeridianLongitude?: number
  readonly projection?: number
  readonly coordinateTransform?: number
  readonly projectedLinearUnits?: number
  readonly projectedLinearUnitSize?: number
  readonly citation?: string
  readonly pixelScale?: GeoTiffPoint
  readonly tiepoints: readonly GeoTiffTiepoint[]
  readonly modelTransformation?: readonly number[]
  readonly diagnostics: readonly GeoTiffDiagnostic[]
  readonly model?: GeoTiffModel
  readonly origin?: GeoTiffPoint
  readonly resolution?: GeoTiffPoint
  readonly boundingBox?: GeoTiffBoundingBox
  readonly noData?: GeoTiffNoData
  readonly gdalMetadata: readonly GeoTiffGdalMetadataItem[]
}

const numbers = (value: TiffTagValue | undefined, label: string): readonly number[] | undefined => {
  if (value === undefined) return undefined
  if (value.kind !== 'numbers') throw invalidInput(`GeoTIFF ${label} must contain numeric values`)
  return value.values
}

const ascii = (value: TiffTagValue | undefined, label: string): string | undefined => {
  if (value === undefined) return undefined
  if (value.kind !== 'ascii') throw invalidInput(`GeoTIFF ${label} must contain ASCII text`)
  return value.value.replace(/\0+$/, '')
}

const finite = (value: number, label: string): number => {
  if (!Number.isFinite(value)) throw invalidInput(`GeoTIFF ${label} must be finite`)
  return value
}

const point = (x: number, y: number, z: number): GeoTiffPoint => Object.freeze({ x, y, z })

const transformationModel = (values: readonly number[]): GeoTiffModel => {
  if (values.length !== 16)
    throw invalidInput('GeoTIFF ModelTransformationTag must contain 16 values')
  const matrix = Object.freeze(values.map((value) => finite(value, 'transformation value')))
  return Object.freeze({
    kind: 'transformation' as const,
    matrix,
    pixelToModel: (x: number, y: number, z = 0): GeoTiffPoint => {
      finite(x, 'pixel x')
      finite(y, 'pixel y')
      finite(z, 'pixel z')
      const denominator =
        (matrix[12] ?? 0) * x + (matrix[13] ?? 0) * y + (matrix[14] ?? 0) * z + (matrix[15] ?? 0)
      if (!Number.isFinite(denominator) || denominator === 0) {
        throw invalidInput('GeoTIFF transformation produces an invalid homogeneous coordinate')
      }
      return point(
        ((matrix[0] ?? 0) * x + (matrix[1] ?? 0) * y + (matrix[2] ?? 0) * z + (matrix[3] ?? 0)) /
          denominator,
        ((matrix[4] ?? 0) * x + (matrix[5] ?? 0) * y + (matrix[6] ?? 0) * z + (matrix[7] ?? 0)) /
          denominator,
        ((matrix[8] ?? 0) * x + (matrix[9] ?? 0) * y + (matrix[10] ?? 0) * z + (matrix[11] ?? 0)) /
          denominator,
      )
    },
  })
}

const tiepointScaleModel = (
  scales: readonly number[],
  tiepoints: readonly GeoTiffTiepoint[],
): GeoTiffModel => {
  if (scales.length !== 3) throw invalidInput('GeoTIFF ModelPixelScaleTag must contain 3 values')
  const scaleX = finite(scales[0] ?? Number.NaN, 'x scale')
  const scaleY = finite(scales[1] ?? Number.NaN, 'y scale')
  const scaleZ = finite(scales[2] ?? Number.NaN, 'z scale')
  if (scaleX === 0 || scaleY === 0) throw invalidInput('GeoTIFF pixel scale must be non-zero')
  const first = tiepoints[0]
  if (first === undefined) throw invalidInput('GeoTIFF tiepoint-scale model has no tiepoint')
  const rasterX = first.raster.x
  const rasterY = first.raster.y
  const rasterZ = first.raster.z
  const modelX = first.model.x
  const modelY = first.model.y
  const modelZ = first.model.z
  const matrix = Object.freeze([
    scaleX,
    0,
    0,
    modelX - rasterX * scaleX,
    0,
    -scaleY,
    0,
    modelY + rasterY * scaleY,
    0,
    0,
    scaleZ,
    modelZ - rasterZ * scaleZ,
    0,
    0,
    0,
    1,
  ])
  const model = transformationModel(matrix)
  return Object.freeze({
    kind: 'tiepoint-scale' as const,
    matrix: model.matrix,
    pixelToModel: model.pixelToModel,
  })
}

const parseTiepoints = (values: readonly number[] | undefined): readonly GeoTiffTiepoint[] => {
  if (values === undefined) return Object.freeze([])
  if (values.length < 6 || values.length % 6 !== 0) {
    throw invalidInput('GeoTIFF ModelTiepointTag must contain complete six-value tiepoints')
  }
  return Object.freeze(
    Array.from({ length: values.length / 6 }, (_, index) => {
      const offset = index * 6
      return Object.freeze({
        raster: point(
          finite(values[offset] ?? Number.NaN, `tiepoint ${index} raster x`),
          finite(values[offset + 1] ?? Number.NaN, `tiepoint ${index} raster y`),
          finite(values[offset + 2] ?? Number.NaN, `tiepoint ${index} raster z`),
        ),
        model: point(
          finite(values[offset + 3] ?? Number.NaN, `tiepoint ${index} model x`),
          finite(values[offset + 4] ?? Number.NaN, `tiepoint ${index} model y`),
          finite(values[offset + 5] ?? Number.NaN, `tiepoint ${index} model z`),
        ),
      })
    }),
  )
}

const closeTiepointCoordinate = (expected: number, actual: number): boolean =>
  Math.abs(expected - actual) <= Math.max(1, Math.abs(expected), Math.abs(actual)) * 1e-9

const tiepointDiagnostics = (
  model: GeoTiffModel,
  tiepoints: readonly GeoTiffTiepoint[],
): readonly GeoTiffDiagnostic[] =>
  Object.freeze(
    tiepoints.flatMap((tiepoint, index) => {
      const expected = model.pixelToModel(tiepoint.raster.x, tiepoint.raster.y, tiepoint.raster.z)
      return closeTiepointCoordinate(expected.x, tiepoint.model.x) &&
        closeTiepointCoordinate(expected.y, tiepoint.model.y) &&
        closeTiepointCoordinate(expected.z, tiepoint.model.z)
        ? []
        : [
            Object.freeze({
              code: 'INCONSISTENT_TIEPOINT' as const,
              severity: 'error' as const,
              message: `GeoTIFF tiepoint ${index} is inconsistent with ModelPixelScaleTag and the first tiepoint.`,
              tiepointIndex: index,
            }),
          ]
    }),
  )

const parseGeoKeys = (
  directoryValues: readonly number[] | undefined,
  doubles: readonly number[] | undefined,
  asciiValues: string | undefined,
): ReadonlyMap<number, GeoTiffKey> => {
  if (directoryValues === undefined) return new Map()
  if (directoryValues.length < 4 || (directoryValues.length - 4) % 4 !== 0) {
    throw invalidInput('GeoTIFF GeoKeyDirectoryTag length is invalid')
  }
  const version = directoryValues[0]
  const revision = directoryValues[1]
  const minorRevision = directoryValues[2]
  const keyCount = directoryValues[3] ?? -1
  if (version !== 1 || revision !== 1 || (minorRevision !== 0 && minorRevision !== 1)) {
    throw unsupportedOperation(
      `GeoTIFF key directory version ${version}.${revision}.${minorRevision} is unsupported`,
    )
  }
  if (
    !Number.isSafeInteger(keyCount) ||
    keyCount < 0 ||
    directoryValues.length !== 4 + keyCount * 4
  ) {
    throw invalidInput('GeoTIFF GeoKeyDirectoryTag key count is invalid')
  }
  const keys = new Map<number, GeoTiffKey>()
  for (let index = 0; index < keyCount; index += 1) {
    const base = 4 + index * 4
    const id = directoryValues[base] ?? -1
    const location = directoryValues[base + 1] ?? -1
    const count = directoryValues[base + 2] ?? -1
    const offset = directoryValues[base + 3] ?? -1
    if (
      !Number.isSafeInteger(id) ||
      id < 1 ||
      id > 65_535 ||
      !Number.isSafeInteger(location) ||
      location < 0 ||
      location > 65_535 ||
      !Number.isSafeInteger(count) ||
      count < 1 ||
      !Number.isSafeInteger(offset) ||
      offset < 0
    ) {
      throw invalidInput('GeoTIFF GeoKey entry contains an invalid field')
    }
    if (keys.has(id)) throw invalidInput(`GeoTIFF GeoKey ${id} is repeated`)
    let value: number | string | readonly number[] | null
    let unavailableReason: string | undefined
    if (location === 0) {
      if (count !== 1 || offset > 65_535)
        throw invalidInput(`GeoTIFF inline GeoKey ${id} is invalid`)
      value = offset
    } else if (location === tagGeoKeyDirectory) {
      if (offset + count > directoryValues.length)
        throw invalidInput(`GeoTIFF GeoKey ${id} exceeds the key directory`)
      const selected = directoryValues.slice(offset, offset + count)
      value = selected.length === 1 ? (selected[0] ?? 0) : Object.freeze(selected)
    } else if (location === tagGeoDoubleParams) {
      if (doubles === undefined || offset + count > doubles.length)
        throw invalidInput(`GeoTIFF GeoKey ${id} exceeds GeoDoubleParamsTag`)
      const selected = doubles.slice(offset, offset + count)
      value = selected.length === 1 ? (selected[0] ?? 0) : Object.freeze(selected)
    } else if (location === tagGeoAsciiParams) {
      if (asciiValues === undefined || offset + count > asciiValues.length)
        throw invalidInput(`GeoTIFF GeoKey ${id} exceeds GeoAsciiParamsTag`)
      value = asciiValues.slice(offset, offset + count).replace(/\|$/, '')
    } else {
      if (geoKeyNames.has(id)) {
        throw unsupportedOperation(`GeoTIFF GeoKey ${id} references unsupported tag ${location}`)
      }
      value = null
      unavailableReason = `GeoKey references unsupported tag ${location}`
    }
    const name = geoKeyNames.get(id)
    keys.set(
      id,
      Object.freeze({
        id,
        ...(name === undefined ? {} : { name }),
        recognized: name !== undefined,
        location,
        count,
        offset,
        value,
        ...(unavailableReason === undefined ? {} : { unavailableReason }),
      }),
    )
  }
  return keys
}

const scalarKey = (keys: ReadonlyMap<number, GeoTiffKey>, id: number): number | undefined => {
  const value = keys.get(id)?.value
  return typeof value === 'number' ? value : undefined
}

const textKey = (keys: ReadonlyMap<number, GeoTiffKey>, id: number): string | undefined => {
  const value = keys.get(id)?.value
  return typeof value === 'string' ? value : undefined
}

const parseGdalMetadata = (xml: string | undefined): readonly GeoTiffGdalMetadataItem[] => {
  if (xml === undefined || xml.trim() === '') return Object.freeze([])
  const root = parseXmlDocument(xml, {
    maxDepth: 16,
    maxElements: 10_000,
    maxCharacters: 1_048_576,
  })
  if (xmlLocalName(root.name) !== 'GDALMetadata')
    throw invalidInput('TIFF GDAL_METADATA root element is invalid')
  return Object.freeze(
    xmlChildren(root, 'Item').map((item) => {
      const name = item.attributes.name
      if (name === undefined || name.length === 0)
        throw invalidInput('TIFF GDAL_METADATA Item name is missing')
      const sampleText = item.attributes.sample
      let sample: number | undefined
      if (sampleText !== undefined) {
        sample = Number(sampleText)
        if (!Number.isSafeInteger(sample) || sample < 0)
          throw invalidInput('TIFF GDAL_METADATA sample is invalid')
      }
      return Object.freeze({
        name,
        value: item.text,
        ...(sample === undefined ? {} : { sample }),
        ...(item.attributes.role === undefined ? {} : { role: item.attributes.role }),
        ...(item.attributes.domain === undefined ? {} : { domain: item.attributes.domain }),
      })
    }),
  )
}

const parseNoDataValue = (value: string): number | string => {
  const numeric = Number(value)
  return Number.isNaN(numeric) && value.toLowerCase() !== 'nan' ? value : numeric
}

const parseNoData = (raw: string | undefined): GeoTiffNoData | undefined => {
  if (raw === undefined) return undefined
  const value = raw.trim()
  if (value === '') return ''
  const components = value.split(/\s+/)
  if (components.length > 1) {
    const parsed = components.map(parseNoDataValue)
    if (parsed.every((entry) => typeof entry === 'number')) return Object.freeze(parsed)
  }
  return parseNoDataValue(value)
}

const boundingBox = (model: GeoTiffModel, width: number, height: number): GeoTiffBoundingBox => {
  const corners = [
    model.pixelToModel(0, 0),
    model.pixelToModel(width, 0),
    model.pixelToModel(0, height),
    model.pixelToModel(width, height),
  ]
  return Object.freeze({
    minX: Math.min(...corners.map((corner) => corner.x)),
    minY: Math.min(...corners.map((corner) => corner.y)),
    maxX: Math.max(...corners.map((corner) => corner.x)),
    maxY: Math.max(...corners.map((corner) => corner.y)),
  })
}

const modelResolution = (model: GeoTiffModel): GeoTiffPoint => {
  const matrix = model.matrix
  if (model.kind === 'tiepoint-scale') {
    return point(matrix[0] ?? 0, matrix[5] ?? 0, matrix[10] ?? 0)
  }
  if ((matrix[1] ?? 0) === 0 && (matrix[4] ?? 0) === 0) {
    return point(matrix[0] ?? 0, -(matrix[5] ?? 0), matrix[10] ?? 0)
  }
  return point(
    Math.hypot(matrix[0] ?? 0, matrix[4] ?? 0),
    -Math.hypot(matrix[1] ?? 0, matrix[5] ?? 0),
    matrix[10] ?? 0,
  )
}

export const openGeoTiffDirectory = async (
  directory: TiffDirectory,
  options: Readonly<TiffTagReadOptions> = {},
): Promise<GeoTiffProfile> => {
  const [
    rawScale,
    rawTiepoints,
    rawTransformation,
    rawKeyDirectory,
    rawDoubles,
    rawAscii,
    rawGdalMetadata,
    rawNoData,
  ] = await Promise.all([
    directory.getTag(tagModelPixelScale, options),
    directory.getTag(tagModelTiepoint, options),
    directory.getTag(tagModelTransformation, options),
    directory.getTag(tagGeoKeyDirectory, options),
    directory.getTag(tagGeoDoubleParams, options),
    directory.getTag(tagGeoAsciiParams, options),
    directory.getTag(tagGdalMetadata, options),
    directory.getTag(tagGdalNoData, options),
  ])
  const scales = numbers(rawScale, 'ModelPixelScaleTag')
  const tiepoints = parseTiepoints(numbers(rawTiepoints, 'ModelTiepointTag'))
  const transformation = numbers(rawTransformation, 'ModelTransformationTag')
  if (transformation !== undefined && (scales !== undefined || tiepoints.length > 0)) {
    throw invalidInput('GeoTIFF must not combine ModelTransformationTag with tiepoint-scale tags')
  }
  if (scales !== undefined && tiepoints.length === 0) {
    throw invalidInput('GeoTIFF ModelPixelScaleTag requires ModelTiepointTag')
  }
  const diagnostics: GeoTiffDiagnostic[] = []
  let model: GeoTiffModel | undefined
  if (transformation !== undefined) {
    model = transformationModel(transformation)
    const matrix = model.matrix
    if (matrix[12] !== 0 || matrix[13] !== 0 || matrix[15] === 0) {
      diagnostics.push(
        Object.freeze({
          code: 'UNSUPPORTED_PROJECTIVE_TRANSFORM',
          severity: 'error',
          message:
            'GeoTIFF ModelTransformationTag uses projective terms that cannot be represented as a pixel-to-world affine.',
        }),
      )
    }
  } else if (scales !== undefined) {
    const candidate = tiepointScaleModel(scales, tiepoints)
    const validation = tiepointDiagnostics(candidate, tiepoints)
    diagnostics.push(...validation)
    if (!validation.some(({ severity }) => severity === 'error')) model = candidate
  } else if (tiepoints.length > 0) {
    diagnostics.push(
      Object.freeze({
        code: 'UNSUPPORTED_GCP_WARP',
        severity: 'warning',
        message:
          'GeoTIFF tiepoints without a pixel scale are preserved as ground-control-point evidence; arbitrary GCP warping is not supported.',
      }),
    )
  }
  const keys = parseGeoKeys(
    numbers(rawKeyDirectory, 'GeoKeyDirectoryTag'),
    numbers(rawDoubles, 'GeoDoubleParamsTag'),
    ascii(rawAscii, 'GeoAsciiParamsTag'),
  )
  const rasterTypeValue = scalarKey(keys, keyRasterType)
  const rasterType: GeoTiffRasterType =
    rasterTypeValue === 1
      ? 'pixel-is-area'
      : rasterTypeValue === 2
        ? 'pixel-is-point'
        : 'unspecified'
  const origin = model?.pixelToModel(0, 0)
  const resolution = model === undefined ? undefined : modelResolution(model)
  const modelType = scalarKey(keys, keyModelType)
  const projectedCrs = scalarKey(keys, keyProjectedCrs)
  const geographicCrs = scalarKey(keys, keyGeographicType)
  const geodeticDatum = scalarKey(keys, keyGeodeticDatum)
  const primeMeridian = scalarKey(keys, keyPrimeMeridian)
  const geographicLinearUnits = scalarKey(keys, keyGeographicLinearUnits)
  const geographicLinearUnitSize = scalarKey(keys, keyGeographicLinearUnitSize)
  const angularUnits = scalarKey(keys, keyAngularUnits)
  const angularUnitSize = scalarKey(keys, keyAngularUnitSize)
  const ellipsoid = scalarKey(keys, keyEllipsoid)
  const semiMajorAxis = scalarKey(keys, keySemiMajorAxis)
  const semiMinorAxis = scalarKey(keys, keySemiMinorAxis)
  const inverseFlattening = scalarKey(keys, keyInverseFlattening)
  const azimuthUnits = scalarKey(keys, keyAzimuthUnits)
  const primeMeridianLongitude = scalarKey(keys, keyPrimeMeridianLongitude)
  const projection = scalarKey(keys, keyProjection)
  const coordinateTransform = scalarKey(keys, keyCoordinateTransform)
  const projectedLinearUnits = scalarKey(keys, keyProjectedLinearUnits)
  const projectedLinearUnitSize = scalarKey(keys, keyProjectedLinearUnitSize)
  const verticalCrs = scalarKey(keys, keyVerticalCrs)
  const verticalDatum = scalarKey(keys, keyVerticalDatum)
  const verticalUnits = scalarKey(keys, keyVerticalUnits)
  const modelCitation = textKey(keys, keyModelCitation)
  const projectedCitation = textKey(keys, keyProjectedCitation)
  const geographicCitation = textKey(keys, keyGeographicCitation)
  const verticalCitation = textKey(keys, keyVerticalCitation)
  const citation = projectedCitation ?? geographicCitation ?? modelCitation
  const bounds =
    model === undefined ? undefined : boundingBox(model, directory.width, directory.height)
  const noData = parseNoData(ascii(rawNoData, 'GDAL_NODATA'))
  return Object.freeze({
    directory,
    keys,
    rasterType,
    tiepoints,
    diagnostics: Object.freeze(diagnostics),
    gdalMetadata: parseGdalMetadata(ascii(rawGdalMetadata, 'GDAL_METADATA')),
    ...(modelType === undefined ? {} : { modelType }),
    ...(projectedCrs === undefined ? {} : { projectedCrs }),
    ...(geographicCrs === undefined ? {} : { geographicCrs }),
    ...(verticalCrs === undefined ? {} : { verticalCrs }),
    ...(verticalDatum === undefined ? {} : { verticalDatum }),
    ...(verticalUnits === undefined ? {} : { verticalUnits }),
    ...(modelCitation === undefined ? {} : { modelCitation }),
    ...(projectedCitation === undefined ? {} : { projectedCitation }),
    ...(geographicCitation === undefined ? {} : { geographicCitation }),
    ...(verticalCitation === undefined ? {} : { verticalCitation }),
    ...(geodeticDatum === undefined ? {} : { geodeticDatum }),
    ...(primeMeridian === undefined ? {} : { primeMeridian }),
    ...(geographicLinearUnits === undefined ? {} : { geographicLinearUnits }),
    ...(geographicLinearUnitSize === undefined ? {} : { geographicLinearUnitSize }),
    ...(angularUnits === undefined ? {} : { angularUnits }),
    ...(angularUnitSize === undefined ? {} : { angularUnitSize }),
    ...(ellipsoid === undefined ? {} : { ellipsoid }),
    ...(semiMajorAxis === undefined ? {} : { semiMajorAxis }),
    ...(semiMinorAxis === undefined ? {} : { semiMinorAxis }),
    ...(inverseFlattening === undefined ? {} : { inverseFlattening }),
    ...(azimuthUnits === undefined ? {} : { azimuthUnits }),
    ...(primeMeridianLongitude === undefined ? {} : { primeMeridianLongitude }),
    ...(projection === undefined ? {} : { projection }),
    ...(coordinateTransform === undefined ? {} : { coordinateTransform }),
    ...(projectedLinearUnits === undefined ? {} : { projectedLinearUnits }),
    ...(projectedLinearUnitSize === undefined ? {} : { projectedLinearUnitSize }),
    ...(citation === undefined ? {} : { citation }),
    ...(scales === undefined
      ? {}
      : {
          pixelScale: point(
            finite(scales[0] ?? Number.NaN, 'x scale'),
            finite(scales[1] ?? Number.NaN, 'y scale'),
            finite(scales[2] ?? Number.NaN, 'z scale'),
          ),
        }),
    ...(transformation === undefined
      ? {}
      : { modelTransformation: Object.freeze([...transformation]) }),
    ...(model === undefined ? {} : { model }),
    ...(origin === undefined ? {} : { origin }),
    ...(resolution === undefined ? {} : { resolution }),
    ...(bounds === undefined ? {} : { boundingBox: bounds }),
    ...(noData === undefined ? {} : { noData }),
  })
}

export const geoTiffProfile: TiffProfile<GeoTiffProfile> = Object.freeze({
  id: 'geotiff',
  priority: 100,
  detect: async ({ document }: Readonly<TiffProfileContext>) => {
    const directory = document.topLevelDirectories[0]
    if (!directory) return false
    const [keys, transformation, scale] = await Promise.all([
      directory.getTag(tagGeoKeyDirectory),
      directory.getTag(tagModelTransformation),
      directory.getTag(tagModelPixelScale),
    ])
    return keys !== undefined || transformation !== undefined || scale !== undefined
  },
  open: async ({ document }: Readonly<TiffProfileContext>) => {
    const directory = document.topLevelDirectories[0]
    if (!directory) throw invalidInput('GeoTIFF document has no top-level image')
    return openGeoTiffDirectory(directory)
  },
})
