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
const keyGeographicType = 2_048
const keyGeographicCitation = 2_049
const keyProjectedCrs = 3_072
const keyProjectedCitation = 3_073

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
  readonly location: number
  readonly count: number
  readonly offset: number
  readonly value: number | string | readonly number[]
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
  readonly citation?: string
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
  tiepoints: readonly number[],
): GeoTiffModel => {
  if (scales.length !== 3) throw invalidInput('GeoTIFF ModelPixelScaleTag must contain 3 values')
  if (tiepoints.length < 6 || tiepoints.length % 6 !== 0) {
    throw invalidInput('GeoTIFF ModelTiepointTag must contain complete six-value tiepoints')
  }
  const scaleX = finite(scales[0] ?? Number.NaN, 'x scale')
  const scaleY = finite(scales[1] ?? Number.NaN, 'y scale')
  const scaleZ = finite(scales[2] ?? Number.NaN, 'z scale')
  if (scaleX === 0 || scaleY === 0) throw invalidInput('GeoTIFF pixel scale must be non-zero')
  const rasterX = finite(tiepoints[0] ?? Number.NaN, 'tiepoint raster x')
  const rasterY = finite(tiepoints[1] ?? Number.NaN, 'tiepoint raster y')
  const rasterZ = finite(tiepoints[2] ?? Number.NaN, 'tiepoint raster z')
  const modelX = finite(tiepoints[3] ?? Number.NaN, 'tiepoint model x')
  const modelY = finite(tiepoints[4] ?? Number.NaN, 'tiepoint model y')
  const modelZ = finite(tiepoints[5] ?? Number.NaN, 'tiepoint model z')
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
    let value: number | string | readonly number[]
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
      throw unsupportedOperation(`GeoTIFF GeoKey ${id} references unsupported tag ${location}`)
    }
    keys.set(id, Object.freeze({ id, location, count, offset, value }))
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
  const tiepoints = numbers(rawTiepoints, 'ModelTiepointTag')
  const transformation = numbers(rawTransformation, 'ModelTransformationTag')
  if (transformation !== undefined && (scales !== undefined || tiepoints !== undefined)) {
    throw invalidInput('GeoTIFF must not combine ModelTransformationTag with tiepoint-scale tags')
  }
  if ((scales === undefined) !== (tiepoints === undefined)) {
    throw invalidInput('GeoTIFF ModelPixelScaleTag and ModelTiepointTag must be provided together')
  }
  const model =
    transformation !== undefined
      ? transformationModel(transformation)
      : scales !== undefined && tiepoints !== undefined
        ? tiepointScaleModel(scales, tiepoints)
        : undefined
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
  const citation = textKey(keys, keyProjectedCitation) ?? textKey(keys, keyGeographicCitation)
  const bounds =
    model === undefined ? undefined : boundingBox(model, directory.width, directory.height)
  const noData = parseNoData(ascii(rawNoData, 'GDAL_NODATA'))
  return Object.freeze({
    directory,
    keys,
    rasterType,
    gdalMetadata: parseGdalMetadata(ascii(rawGdalMetadata, 'GDAL_METADATA')),
    ...(modelType === undefined ? {} : { modelType }),
    ...(projectedCrs === undefined ? {} : { projectedCrs }),
    ...(geographicCrs === undefined ? {} : { geographicCrs }),
    ...(citation === undefined ? {} : { citation }),
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
