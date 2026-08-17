import { type AbortOptions, throwIfAborted } from '../../abort.ts'
import { ImageError, invalidInput, limitExceeded, unsupportedOperation } from '../../errors.ts'
import type { RasterBlock } from '../../raster.ts'
import { rasterSampleBytes } from '../../raster.ts'
import { MemorySource } from '../../source.ts'
import type {
  NormalizedScientificDatasetDescriptor,
  ScientificAxisCoordinates,
  ScientificAxisDescriptor,
  ScientificAxisKind,
  ScientificCalibrationEvidence,
  ScientificComponentDescriptor,
  ScientificDataset,
  ScientificMetadataObject,
  ScientificPlaneReadRequest,
  ScientificResolutionLevel,
} from '../dataset.ts'
import {
  normalizeScientificDatasetDescriptor,
  normalizeScientificMetadataObject,
  normalizeScientificPlaneReadRequest,
} from '../dataset.ts'
import type {
  ScientificCompanionRequest,
  ScientificCompanionResolver,
  ScientificDocument,
  ScientificOpenContext,
  ScientificReaderDescriptor,
} from '../reader.ts'
import {
  createScientificDatasetIdentity,
  identifyScientificDataset,
  normalizeScientificRelativeName,
} from '../reader.ts'
import {
  createZarrStore,
  parseZarrNodeJson,
  readZarrJsonBytes,
  type ZarrArrayMetadata,
  type ZarrStore,
  type ZarrStoreLimits,
} from './zarr.ts'
import { openZipArchive, type ZipArchive, type ZipLimits } from './zip.ts'

export interface OmeZarrLimits extends ZarrStoreLimits {
  readonly maxMultiscales: number
  readonly maxDatasets: number
  readonly maxLevels: number
  readonly maxRegionBytes: number
  readonly rowsPerBlock: number
  readonly zip?: ZipLimits
}

export interface OmeZarrOpenOptions {
  readonly context: Readonly<ScientificOpenContext>
  readonly descriptor: ScientificReaderDescriptor
  readonly limits: Readonly<OmeZarrLimits>
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const requiredString = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.length === 0) {
    throw invalidInput(`${label} must be a non-empty string`)
  }
  return value
}

const finiteNumber = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw invalidInput(`${label} must be a finite number`)
  }
  return value
}

const axisKind = (type: string | undefined): ScientificAxisKind => {
  if (type === 'space') return 'space'
  if (type === 'time') return 'time'
  if (type === 'channel') return 'channel'
  return 'other'
}

interface LinearTransform {
  readonly origin: number[]
  readonly step: number[]
}

const identityTransform = (rank: number): LinearTransform => ({
  origin: Array.from({ length: rank }, () => 0),
  step: Array.from({ length: rank }, () => 1),
})

const applyTransform = (
  current: LinearTransform,
  value: unknown,
  rank: number,
): LinearTransform => {
  if (!isRecord(value)) throw invalidInput('OME-Zarr coordinate transformation is invalid')
  const type = requiredString(value.type, 'OME-Zarr coordinate transformation type')
  if (type === 'scale') {
    const scale = value.scale
    if (!Array.isArray(scale) || scale.length !== rank) {
      throw invalidInput('OME-Zarr scale transformation rank is invalid')
    }
    return {
      origin: current.origin.map((origin, index) => origin * finiteNumber(scale[index], 'scale')),
      step: current.step.map((step, index) => step * finiteNumber(scale[index], 'scale')),
    }
  }
  if (type === 'translation') {
    const translation = value.translation
    if (!Array.isArray(translation) || translation.length !== rank) {
      throw invalidInput('OME-Zarr translation transformation rank is invalid')
    }
    return {
      origin: current.origin.map(
        (origin, index) => origin + finiteNumber(translation[index], 'translation'),
      ),
      step: current.step.slice(),
    }
  }
  throw unsupportedOperation(`OME-Zarr coordinate transformation ${type} is unsupported`)
}

const parseRestrictedTransforms = (
  values: unknown,
  rank: number,
  label: string,
): LinearTransform => {
  if (values === undefined) {
    throw invalidInput(`${label} must include exactly one scale transformation`)
  }
  if (!Array.isArray(values) || values.length === 0) {
    throw invalidInput(`${label} must be a non-empty array`)
  }
  let scaleCount = 0
  let translationCount = 0
  let current = identityTransform(rank)
  for (const [index, entry] of values.entries()) {
    if (!isRecord(entry)) throw invalidInput(`${label}[${index}] is invalid`)
    const type = requiredString(entry.type, `${label}[${index}].type`)
    if (type === 'identity') {
      throw invalidInput(`${label} must not contain identity transformations`)
    }
    if (type === 'scale') {
      if (scaleCount !== 0 || translationCount !== 0) {
        throw invalidInput(`${label} must contain exactly one scale before any translation`)
      }
      scaleCount += 1
      current = applyTransform(current, entry, rank)
      continue
    }
    if (type === 'translation') {
      if (scaleCount !== 1 || translationCount !== 0) {
        throw invalidInput(`${label} translation must follow a single scale`)
      }
      translationCount += 1
      current = applyTransform(current, entry, rank)
      continue
    }
    throw unsupportedOperation(`OME-Zarr coordinate transformation ${type} is unsupported`)
  }
  if (scaleCount !== 1) {
    throw invalidInput(`${label} must include exactly one scale transformation`)
  }
  if (translationCount > 1) {
    throw invalidInput(`${label} may include at most one translation`)
  }
  return current
}

const composeTransforms = (values: unknown, rank: number, extra: unknown): LinearTransform => {
  const dataset = parseRestrictedTransforms(
    values,
    rank,
    'OME-Zarr dataset coordinateTransformations',
  )
  if (extra === undefined) return dataset
  const shared = parseRestrictedTransforms(
    extra,
    rank,
    'OME-Zarr multiscale coordinateTransformations',
  )
  return {
    origin: dataset.origin.map(
      (origin, index) => origin * (shared.step[index] ?? 1) + (shared.origin[index] ?? 0),
    ),
    step: dataset.step.map((step, index) => step * (shared.step[index] ?? 1)),
  }
}

interface ParsedAxis {
  readonly id: string
  readonly name: string
  readonly kind: ScientificAxisKind
  readonly unit?: string
}

const parseAxes = (value: unknown): readonly ParsedAxis[] => {
  if (!Array.isArray(value) || value.length === 0) {
    throw invalidInput('OME-Zarr multiscale axes are missing')
  }
  if (value.length < 2 || value.length > 5) {
    throw invalidInput('OME-Zarr multiscale rank must be between 2 and 5')
  }
  const seenIds = new Set<string>()
  const seenNames = new Set<string>()
  return Object.freeze(
    value.map((entry, index) => {
      if (!isRecord(entry)) throw invalidInput(`OME-Zarr axis ${index} is invalid`)
      const name = requiredString(entry.name, `OME-Zarr axis[${index}].name`)
      if (seenNames.has(name)) throw invalidInput(`OME-Zarr axis ${name} is repeated`)
      seenNames.add(name)
      const id = name.toLowerCase()
      if (seenIds.has(id)) throw invalidInput(`OME-Zarr axis ${id} is repeated`)
      seenIds.add(id)
      const type =
        entry.type === undefined
          ? undefined
          : requiredString(entry.type, `OME-Zarr axis[${index}].type`)
      const unit =
        entry.unit === undefined
          ? undefined
          : requiredString(entry.unit, `OME-Zarr axis[${index}].unit`)
      return Object.freeze({
        id,
        name,
        kind: axisKind(type),
        ...(unit === undefined ? {} : { unit }),
      })
    }),
  )
}

interface ChannelEntry {
  readonly name?: string
  readonly color?: number
}

const parseHexColor = (value: string): number | undefined => {
  const match = value.match(/^#?([0-9a-fA-F]{6})$/u)
  if (match === null) return undefined
  return Number.parseInt(match[1] ?? '', 16)
}

const parseOmeroChannels = (value: unknown): readonly ChannelEntry[] | undefined => {
  if (!isRecord(value) || !Array.isArray(value.channels)) return undefined
  return Object.freeze(
    value.channels.map((channel, index) => {
      if (!isRecord(channel)) throw invalidInput(`OME-Zarr omero.channels[${index}] is invalid`)
      const name =
        channel.label === undefined
          ? undefined
          : requiredString(channel.label, `OME-Zarr omero.channels[${index}].label`)
      const color =
        typeof channel.color === 'number' && Number.isSafeInteger(channel.color)
          ? channel.color & 0xff_ffff
          : typeof channel.color === 'string'
            ? parseHexColor(channel.color)
            : undefined
      return Object.freeze({
        ...(name === undefined ? {} : { name }),
        ...(color === undefined ? {} : { color }),
      })
    }),
  )
}

interface ParsedLevel {
  readonly path: string
  readonly array: ZarrArrayMetadata
  readonly transform: LinearTransform
}

interface ParsedMultiscale {
  readonly name: string
  readonly version: string
  readonly axes: readonly ParsedAxis[]
  readonly levels: readonly ParsedLevel[]
  readonly channels: readonly ChannelEntry[] | undefined
  readonly extraMetadata?: ScientificMetadataObject
}

const trimTrailingSlashes = (value: string): string => value.replace(/\/+$/u, '')

const joinZarrPath = (base: string, child: string): string => {
  const relative = normalizeScientificRelativeName(trimTrailingSlashes(child))
  return base.length === 0 ? relative : normalizeScientificRelativeName(`${base}/${relative}`)
}

const packDisplayOrder = (
  packed: Uint8Array,
  blockShape: readonly number[],
  horizontal: number,
  vertical: number,
  sampleBytes: number,
): Uint8Array => {
  const width = blockShape[horizontal] ?? 0
  const height = blockShape[vertical] ?? 0
  const output = new Uint8Array(width * height * sampleBytes)
  const strides = new Array<number>(blockShape.length)
  let stride = 1
  for (let axis = blockShape.length - 1; axis >= 0; axis -= 1) {
    strides[axis] = stride
    stride *= blockShape[axis] ?? 1
  }
  const horizontalStride = strides[horizontal] ?? 0
  const verticalStride = strides[vertical] ?? 0
  for (let y = 0; y < height; y += 1) {
    const rowSource = y * verticalStride
    const rowDest = y * width
    for (let x = 0; x < width; x += 1) {
      const sourceOffset = (rowSource + x * horizontalStride) * sampleBytes
      const destOffset = (rowDest + x) * sampleBytes
      output.set(packed.subarray(sourceOffset, sourceOffset + sampleBytes), destOffset)
    }
  }
  return output
}

const displayOrderIsPacked = (blockShape: readonly number[], horizontal: number): boolean => {
  for (let axis = horizontal + 1; axis < blockShape.length; axis += 1) {
    if ((blockShape[axis] ?? 1) > 1) return false
  }
  return true
}

const parseMultiscale = async (
  value: unknown,
  store: ZarrStore,
  limits: Readonly<OmeZarrLimits>,
  version: string,
  signal: AbortSignal | undefined,
  basePath: string,
): Promise<ParsedMultiscale> => {
  if (!isRecord(value)) throw invalidInput('OME-Zarr multiscale entry is invalid')
  const axes = parseAxes(value.axes)
  if (axes.length > limits.maxDimensions) {
    throw limitExceeded(`OME-Zarr axis count exceeds ${limits.maxDimensions}`)
  }
  if (!Array.isArray(value.datasets) || value.datasets.length === 0) {
    throw invalidInput('OME-Zarr multiscale datasets are missing')
  }
  if (value.datasets.length > limits.maxLevels) {
    throw limitExceeded(`OME-Zarr resolution levels exceed ${limits.maxLevels}`)
  }
  const levels: ParsedLevel[] = []
  for (const dataset of value.datasets) {
    if (!isRecord(dataset)) throw invalidInput('OME-Zarr multiscale dataset is invalid')
    const path = joinZarrPath(basePath, requiredString(dataset.path, 'OME-Zarr dataset path'))
    const array = await store.openArray(path, signal)
    if (array.shape.length !== axes.length) {
      throw invalidInput(`OME-Zarr array ${path} rank does not match the multiscale axes`)
    }
    if (store.format === 3) {
      if (array.dimensionNames === undefined) {
        throw invalidInput(`OME-Zarr array ${path} is missing dimension_names`)
      }
      if (
        array.dimensionNames.length !== axes.length ||
        array.dimensionNames.some((dimension, axisIndex) => dimension !== axes[axisIndex]?.name)
      ) {
        throw invalidInput(
          `OME-Zarr array ${path} dimension_names do not match the multiscale axes`,
        )
      }
    }
    const transform = composeTransforms(
      dataset.coordinateTransformations,
      axes.length,
      value.coordinateTransformations,
    )
    levels.push(Object.freeze({ path, array, transform }))
  }
  const first = levels[0]
  if (first === undefined) throw invalidInput('OME-Zarr multiscale has no datasets')
  for (const level of levels) {
    if (level.array.dataType !== first.array.dataType) {
      throw invalidInput('OME-Zarr resolution levels must share one sample type')
    }
    if (level.array.fill.kind !== first.array.fill.kind) {
      throw invalidInput('OME-Zarr resolution levels must share fill semantics')
    }
    const firstFill = first.array.fill
    const levelFill = level.array.fill
    if (
      firstFill.kind === 'defined' &&
      levelFill.kind === 'defined' &&
      (firstFill.bytes.byteLength !== levelFill.bytes.byteLength ||
        firstFill.bytes.some((byte, index) => byte !== (levelFill.bytes[index] ?? 0)))
    ) {
      throw invalidInput('OME-Zarr resolution levels must share one fill value')
    }
    if (
      store.format === 3 &&
      level.array.dimensionNames?.join('\0') !== first.array.dimensionNames?.join('\0')
    ) {
      throw invalidInput('OME-Zarr resolution levels must share dimension_names')
    }
  }
  for (let index = 1; index < levels.length; index += 1) {
    const previous = levels[index - 1]
    const current = levels[index]
    if (previous === undefined || current === undefined) continue
    for (let axis = 0; axis < first.array.shape.length; axis += 1) {
      if ((current.array.shape[axis] ?? 0) > (previous.array.shape[axis] ?? 0)) {
        throw invalidInput(
          'OME-Zarr resolution levels must be ordered from highest to lowest resolution',
        )
      }
    }
  }
  const name =
    value.name === undefined ? 'image' : requiredString(value.name, 'OME-Zarr multiscale name')
  return Object.freeze({
    name,
    version,
    axes,
    levels: Object.freeze(levels),
    channels: undefined,
  })
}

const hasNgffSurface = (value: Readonly<Record<string, unknown>>): boolean =>
  Array.isArray(value.multiscales) ||
  Array.isArray(value.labels) ||
  isRecord(value.plate) ||
  isRecord(value.well) ||
  isRecord(value['image-label'])

const bioformatsLayout = (value: Readonly<Record<string, unknown>>): number | undefined => {
  const raw = value['bioformats2raw.layout']
  const numeric =
    typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.trim()) : Number.NaN
  if (Number.isSafeInteger(numeric) && numeric > 0) return numeric
  return undefined
}

const parseOmeAttributes = (
  attributes: Readonly<Record<string, unknown>>,
  expectedFormat: 2 | 3,
  expectedVersion?: string,
): { readonly version: string; readonly ome: Readonly<Record<string, unknown>> } => {
  const nested = attributes.ome
  if (nested !== undefined && !isRecord(nested)) {
    throw invalidInput('OME-Zarr attributes.ome must be an object')
  }
  let parsed: { readonly version: string; readonly ome: Readonly<Record<string, unknown>> }
  if (isRecord(nested)) {
    if (nested.version === undefined) {
      throw invalidInput('OME-Zarr version is missing')
    }
    const version = requiredString(nested.version, 'OME-Zarr version')
    if (version !== '0.5') {
      throw unsupportedOperation(`OME-NGFF ${version} under attributes.ome is unsupported`)
    }
    if (expectedFormat !== 3) {
      throw invalidInput('OME-NGFF 0.5 requires a Zarr v3 store')
    }
    parsed = { version, ome: nested }
  } else if (hasNgffSurface(attributes) || bioformatsLayout(attributes) !== undefined) {
    const first = Array.isArray(attributes.multiscales) ? attributes.multiscales[0] : undefined
    const version =
      isRecord(first) && first.version !== undefined
        ? requiredString(first.version, 'OME-Zarr multiscale version')
        : '0.4'
    if (hasNgffSurface(attributes) && version !== '0.4') {
      throw unsupportedOperation(`OME-NGFF ${version} on Zarr v2 attributes is unsupported`)
    }
    if (expectedFormat !== 2) {
      throw invalidInput('OME-NGFF 0.4 requires a Zarr v2 store')
    }
    parsed = { version, ome: attributes }
  } else {
    throw invalidInput('OME-Zarr group is missing NGFF 0.4 or 0.5 image, label, or plate metadata')
  }
  if (expectedVersion !== undefined && parsed.version !== expectedVersion) {
    throw invalidInput(
      `OME-NGFF ${parsed.version} does not match document version ${expectedVersion}`,
    )
  }
  return parsed
}

const integerInRange = (value: unknown, min: number, max: number, label: string): number => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw invalidInput(`${label} must be an integer from ${min} to ${max}`)
  }
  return value
}

const safeNonNegativeInteger = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw invalidInput(`${label} must be a non-negative integer`)
  }
  return value
}

const labelValueRange = (sampleType: string): { readonly min: number; readonly max: number } => {
  if (sampleType === 'uint8') return { min: 0, max: 255 }
  if (sampleType === 'int8') return { min: -128, max: 127 }
  if (sampleType === 'uint16') return { min: 0, max: 65_535 }
  if (sampleType === 'int16') return { min: -32_768, max: 32_767 }
  if (sampleType === 'uint32') return { min: 0, max: 4_294_967_295 }
  if (sampleType === 'int32') return { min: -2_147_483_648, max: 2_147_483_647 }
  if (sampleType === 'uint64') return { min: 0, max: Number.MAX_SAFE_INTEGER }
  throw invalidInput(`OME-Zarr label sample type ${sampleType} is unsupported`)
}

const normalizeLabelSourcePath = (value: string): string => {
  if (
    value.length === 0 ||
    value.includes('\\') ||
    value.includes('\0') ||
    value.startsWith('/') ||
    /^[a-z][a-z0-9+.-]*:/i.test(value)
  ) {
    throw invalidInput('OME-Zarr image-label.source.image must be a relative path')
  }
  const parts = value.split('/')
  const body = value.endsWith('/') ? parts.slice(0, -1) : parts
  if (body.length === 0 || body.some((part) => part.length === 0)) {
    throw invalidInput('OME-Zarr image-label.source.image is not a normalized relative path')
  }
  return value
}

const parseImageLabel = (
  value: unknown,
  sampleType: string,
): ScientificMetadataObject | undefined => {
  if (!isRecord(value)) return undefined
  if (sampleType.startsWith('float')) {
    throw invalidInput('OME-Zarr label datasets cannot use a floating-point sample type')
  }
  const colors = Array.isArray(value.colors)
    ? value.colors.map((entry, index) => {
        if (!isRecord(entry)) throw invalidInput(`OME-Zarr image-label.colors[${index}] is invalid`)
        const range = labelValueRange(sampleType)
        const labelValue = integerInRange(
          entry['label-value'],
          range.min,
          range.max,
          `OME-Zarr image-label.colors[${index}].label-value`,
        )
        const rgba = entry.rgba
        if (!Array.isArray(rgba) || rgba.length !== 4) {
          throw invalidInput(`OME-Zarr image-label.colors[${index}].rgba must have 4 components`)
        }
        return Object.freeze({
          value: labelValue,
          rgba: Object.freeze(
            rgba.map((component, channel) => integerInRange(component, 0, 255, `rgba[${channel}]`)),
          ),
        })
      })
    : undefined
  const source = isRecord(value.source)
    ? normalizeLabelSourcePath(
        requiredString(value.source.image, 'OME-Zarr image-label.source.image'),
      )
    : undefined
  return normalizeScientificMetadataObject({
    ...(colors === undefined ? {} : { colors }),
    ...(source === undefined ? {} : { sourceImage: source }),
  })
}

const namedEntries = (value: unknown, label: string): readonly string[] => {
  if (!Array.isArray(value) || value.length === 0) {
    throw invalidInput(`${label} must be a non-empty array`)
  }
  return Object.freeze(
    value.map((entry, index) => {
      if (!isRecord(entry)) throw invalidInput(`${label}[${index}] is invalid`)
      return requiredString(entry.name, `${label}[${index}].name`)
    }),
  )
}

const parseAcquisitionIds = (value: unknown): ReadonlySet<number> | undefined => {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw invalidInput('OME-Zarr plate.acquisitions must be an array')
  const ids = new Set<number>()
  for (const [index, entry] of value.entries()) {
    if (!isRecord(entry)) throw invalidInput(`OME-Zarr plate.acquisitions[${index}] is invalid`)
    const id = safeNonNegativeInteger(entry.id, `OME-Zarr plate.acquisitions[${index}].id`)
    if (ids.has(id)) throw invalidInput(`OME-Zarr plate acquisition ${id} is repeated`)
    ids.add(id)
  }
  return ids
}

const parsePlateWells = (
  plate: Readonly<Record<string, unknown>>,
): readonly {
  readonly path: string
  readonly rowIndex: number
  readonly columnIndex: number
}[] => {
  const rows = namedEntries(plate.rows, 'OME-Zarr plate.rows')
  const columns = namedEntries(plate.columns, 'OME-Zarr plate.columns')
  const wells = plate.wells
  if (!Array.isArray(wells) || wells.length === 0) {
    throw invalidInput('OME-Zarr plate has no wells')
  }
  const seen = new Set<string>()
  return Object.freeze(
    wells.map((entry, index) => {
      if (!isRecord(entry)) throw invalidInput(`OME-Zarr plate.wells[${index}] is invalid`)
      const rowIndex = safeNonNegativeInteger(
        entry.rowIndex,
        `OME-Zarr plate.wells[${index}].rowIndex`,
      )
      const columnIndex = safeNonNegativeInteger(
        entry.columnIndex,
        `OME-Zarr plate.wells[${index}].columnIndex`,
      )
      if (rowIndex >= rows.length || columnIndex >= columns.length) {
        throw invalidInput(`OME-Zarr plate.wells[${index}] is outside the declared plate`)
      }
      const path = normalizeScientificRelativeName(
        trimTrailingSlashes(requiredString(entry.path, `OME-Zarr plate.wells[${index}].path`)),
      )
      const expected = `${rows[rowIndex]}/${columns[columnIndex]}`
      if (path !== expected) {
        throw invalidInput(`OME-Zarr plate.wells[${index}].path ${path} does not match ${expected}`)
      }
      if (seen.has(path)) throw invalidInput(`OME-Zarr plate well path ${path} is repeated`)
      seen.add(path)
      return Object.freeze({ path, rowIndex, columnIndex })
    }),
  )
}

const parseWellImages = (
  well: Readonly<Record<string, unknown>>,
  wellPath: string,
  acquisitions: ReadonlySet<number> | undefined,
): readonly { readonly path: string; readonly acquisition?: number }[] => {
  const images = well.images
  if (!Array.isArray(images) || images.length === 0) {
    throw invalidInput(`OME-Zarr well ${wellPath} has no images`)
  }
  const seen = new Set<string>()
  return Object.freeze(
    images.map((image, index) => {
      if (!isRecord(image))
        throw invalidInput(`OME-Zarr well ${wellPath} image ${index} is invalid`)
      const path = normalizeScientificRelativeName(
        trimTrailingSlashes(requiredString(image.path, `OME-Zarr well ${wellPath} image path`)),
      )
      if (seen.has(path)) {
        throw invalidInput(`OME-Zarr well ${wellPath} image path ${path} is repeated`)
      }
      seen.add(path)
      if (image.acquisition === undefined) return Object.freeze({ path })
      const acquisition = safeNonNegativeInteger(
        image.acquisition,
        `OME-Zarr well ${wellPath} image acquisition`,
      )
      if (acquisitions !== undefined && !acquisitions.has(acquisition)) {
        throw invalidInput(
          `OME-Zarr well ${wellPath} image acquisition ${acquisition} is not declared`,
        )
      }
      return Object.freeze({ path, acquisition })
    }),
  )
}

const recognizedOmeAttributes = (attributes: Readonly<Record<string, unknown>>): boolean =>
  attributes.ome !== undefined ||
  hasNgffSurface(attributes) ||
  bioformatsLayout(attributes) !== undefined

const isAbortError = (error: unknown): boolean =>
  (typeof DOMException !== 'undefined' &&
    error instanceof DOMException &&
    error.name === 'AbortError') ||
  (error instanceof Error && error.name === 'AbortError')

const zarrMetadataKey = (path: string, format: 2 | 3, kind: 'array' | 'group'): string => {
  if (format === 3) return path.length === 0 ? 'zarr.json' : `${path}/zarr.json`
  const name = kind === 'array' ? '.zarray' : '.zgroup'
  return path.length === 0 ? name : `${path}/${name}`
}

const zarrAttributesKey = (path: string): string =>
  path.length === 0 ? '.zattrs' : `${path}/.zattrs`

const datasetIdentityPaths = (parsed: ParsedMultiscale, format: 2 | 3): readonly string[] => {
  const paths: string[] = [zarrMetadataKey('', format, 'group')]
  if (format === 2) paths.push(zarrAttributesKey(''))
  const first = parsed.levels[0]
  if (first !== undefined) {
    const slash = first.path.lastIndexOf('/')
    const groupPath = slash < 0 ? '' : first.path.slice(0, slash)
    if (groupPath.length > 0) {
      paths.push(zarrMetadataKey(groupPath, format, 'group'))
      if (format === 2) paths.push(zarrAttributesKey(groupPath))
    }
  }
  for (const level of parsed.levels) {
    paths.push(zarrMetadataKey(level.path, format, 'array'))
    if (format === 2) paths.push(zarrAttributesKey(level.path))
  }
  return Object.freeze(paths)
}

const coordinatesFor = (transform: LinearTransform, axis: number): ScientificAxisCoordinates =>
  Object.freeze({
    type: 'linear',
    origin: transform.origin[axis] ?? 0,
    step: transform.step[axis] ?? 1,
  })

const calibrationFor = (resourceId: string, axisId: string): ScientificCalibrationEvidence =>
  Object.freeze({
    kind: 'embedded',
    resourceId,
    locator: `ome:multiscales/axes/${axisId}`,
  })

class OmeZarrDataset implements ScientificDataset {
  readonly descriptor: NormalizedScientificDatasetDescriptor
  readonly #store: ZarrStore
  readonly #levels: readonly ParsedLevel[]
  readonly #axisIds: readonly string[]
  readonly #limits: Readonly<OmeZarrLimits>

  constructor(
    store: ZarrStore,
    parsed: ParsedMultiscale,
    limits: Readonly<OmeZarrLimits>,
    resourceId: string,
  ) {
    this.#store = store
    this.#levels = parsed.levels
    this.#axisIds = parsed.axes.map((axis) => axis.id)
    this.#limits = limits
    const base = parsed.levels[0]
    if (base === undefined) throw invalidInput('OME-Zarr multiscale has no datasets')
    const channelAxis = parsed.axes.findIndex((axis) => axis.kind === 'channel')
    const axes: ScientificAxisDescriptor[] = parsed.axes.map((axis, index) =>
      Object.freeze({
        id: axis.id,
        name: axis.name,
        kind: axis.kind,
        length: base.array.shape[index] ?? 0,
        ...(axis.unit === undefined ? {} : { unit: axis.unit }),
        coordinates: coordinatesFor(base.transform, index),
        calibration: calibrationFor(resourceId, axis.id),
        ...(index === channelAxis && parsed.channels !== undefined
          ? {
              entries: Object.freeze(
                parsed.channels.map((channel, channelIndex) =>
                  Object.freeze({
                    id: `channel-${channelIndex}`,
                    ...(channel.name === undefined ? {} : { name: channel.name }),
                    ...(channel.color === undefined ? {} : { color: channel.color }),
                  }),
                ),
              ),
            }
          : {}),
      }),
    )
    const levels: ScientificResolutionLevel[] = parsed.levels.map((level, index) =>
      Object.freeze({
        level: index,
        axisLengths: Object.freeze(
          parsed.axes.map((axis, axisIndex) =>
            Object.freeze({ axisId: axis.id, length: level.array.shape[axisIndex] ?? 0 }),
          ),
        ),
        axisCoordinates: Object.freeze(
          parsed.axes.map((axis, axisIndex) =>
            Object.freeze({
              axisId: axis.id,
              coordinates: coordinatesFor(level.transform, axisIndex),
            }),
          ),
        ),
      }),
    )
    const components: readonly ScientificComponentDescriptor[] = Object.freeze([
      Object.freeze({ id: 'value', name: 'Value', kind: 'scalar' as const }),
    ])
    const fill = base.array.fill
    this.descriptor = normalizeScientificDatasetDescriptor({
      schemaVersion: 1,
      axes: Object.freeze(axes),
      sampleType: base.array.dataType,
      components,
      levels: Object.freeze(levels),
      ...(fill.kind === 'defined' && fill.numeric !== undefined
        ? { noDataValue: fill.numeric }
        : {}),
      metadata: normalizeScientificMetadataObject({
        omeNgffVersion: parsed.version,
        zarrFormat: store.format,
        path: base.path,
        ...(parsed.extraMetadata ?? {}),
      }),
      capabilities: {
        regionReads: true,
        resolutionLevels: parsed.levels.length > 1,
        planeReads: { kind: 'any-axis-pair' },
      },
    })
  }

  async *readPlane(request: Readonly<ScientificPlaneReadRequest>): AsyncIterable<RasterBlock> {
    const selected = normalizeScientificPlaneReadRequest(this.descriptor, request)
    const level = this.#levels[selected.resolutionLevel]
    if (level === undefined) throw invalidInput('OME-Zarr resolution level is missing')
    const horizontal = this.#axisIds.indexOf(selected.displayAxes[0] ?? '')
    const vertical = this.#axisIds.indexOf(selected.displayAxes[1] ?? '')
    if (horizontal < 0 || vertical < 0) throw invalidInput('OME-Zarr display axes are invalid')
    const start = level.array.shape.map(() => 0)
    const shape = level.array.shape.map(() => 1)
    for (const fixed of selected.fixedIndices) {
      const axis = this.#axisIds.indexOf(fixed.axisId)
      if (axis < 0) throw invalidInput(`OME-Zarr fixed axis ${fixed.axisId} is unknown`)
      start[axis] = fixed.index
    }
    start[horizontal] = selected.x
    start[vertical] = selected.y
    shape[horizontal] = selected.width
    const sampleBytes = rasterSampleBytes(level.array.dataType)
    const rowBytes = selected.width * sampleBytes
    if (rowBytes > this.#limits.maxRegionBytes) {
      throw limitExceeded('OME-Zarr row exceeds maxRegionBytes')
    }
    const blockRows = Math.max(
      1,
      Math.min(this.#limits.rowsPerBlock, Math.floor(this.#limits.maxRegionBytes / rowBytes)),
    )
    const format = Object.freeze({
      sampleType: level.array.dataType,
      channels: 1,
      planar: false,
    })
    for (let localY = 0; localY < selected.height; localY += blockRows) {
      throwIfAborted(selected.signal)
      const height = Math.min(blockRows, selected.height - localY)
      const blockStart = start.slice()
      const blockShape = shape.slice()
      blockStart[vertical] = selected.y + localY
      blockShape[vertical] = height
      const packed = await this.#store.readRegion(
        level.array,
        blockStart,
        blockShape,
        selected.signal,
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
        format,
        data,
        release() {
          data.fill(0)
        },
      })
    }
  }
}

const looksLikeZip = (bytes: Uint8Array): boolean =>
  bytes.byteLength >= 4 &&
  bytes[0] === 0x50 &&
  bytes[1] === 0x4b &&
  ((bytes[2] === 0x03 && bytes[3] === 0x04) ||
    (bytes[2] === 0x05 && bytes[3] === 0x06) ||
    (bytes[2] === 0x06 && bytes[3] === 0x06))

const zipNameHint = (name: string | undefined): boolean => {
  const lower = name?.toLowerCase() ?? ''
  return lower.endsWith('.ozx') || lower.endsWith('.zip') || lower.endsWith('.zarr')
}

const zipPrefixIsIgnored = (prefix: string): boolean => {
  const lower = prefix.toLowerCase()
  return lower === '__macosx' || lower.startsWith('__macosx/')
}

const zipEntryDirectory = (path: string): string => {
  const slash = path.lastIndexOf('/')
  return slash < 0 ? '' : path.slice(0, slash)
}

const zipPreferredMetadataKey = (archive: ZipArchive, prefix: string): string | undefined => {
  const lead = prefix.length === 0 ? '' : `${prefix}/`
  if (archive.get(`${lead}zarr.json`) !== undefined) return `${lead}zarr.json`
  if (archive.get(`${lead}.zgroup`) !== undefined) return `${lead}.zgroup`
  if (archive.get(`${lead}.zattrs`) !== undefined) return `${lead}.zattrs`
  return undefined
}

const zipRootMetadataKey = (archive: ZipArchive): string | undefined => {
  const top = zipPreferredMetadataKey(archive, '')
  if (top !== undefined) return top
  const prefixes = new Set<string>()
  for (const entry of archive.entries) {
    const slash = entry.path.lastIndexOf('/')
    const name = slash < 0 ? entry.path : entry.path.slice(slash + 1)
    if (name === 'zarr.json' || name === '.zgroup' || name === '.zattrs') {
      const directory = zipEntryDirectory(entry.path)
      if (!zipPrefixIsIgnored(directory)) prefixes.add(directory)
    }
  }
  const outermost = [...prefixes].filter(
    (prefix) => ![...prefixes].some((other) => other !== prefix && prefix.startsWith(`${other}/`)),
  )
  if (outermost.length !== 1) return undefined
  const prefix = outermost[0]
  return prefix === undefined ? undefined : zipPreferredMetadataKey(archive, prefix)
}

const createZipCompanionResolver = (archive: ZipArchive): ScientificCompanionResolver =>
  Object.freeze({
    async resolve(
      request: Readonly<ScientificCompanionRequest>,
      options: Readonly<AbortOptions> = {},
    ) {
      const requested = request.kind === 'relative-name' ? request.name : request.relativeName
      if (requested === undefined) return undefined
      const name = normalizeScientificRelativeName(requested)
      const entry = archive.get(name)
      if (entry === undefined) return undefined
      const source =
        entry.compression === 'stored'
          ? await archive.openStored(name, options)
          : new MemorySource(await archive.read(name, options))
      return Object.freeze({ id: name, name, source })
    },
  })

const openZipRoot = async (
  context: Readonly<ScientificOpenContext>,
  limits: Readonly<OmeZarrLimits>,
): Promise<{ readonly json: unknown; readonly store: ZarrStore }> => {
  const archive = await openZipArchive(context.primary.source, limits.zip ?? {}, context.signal)
  const rootKey = zipRootMetadataKey(archive)
  if (rootKey === undefined) {
    throw invalidInput(
      'OME-Zarr ZIP archive is missing a unique root zarr.json or .zgroup metadata',
    )
  }
  const entry = archive.get(rootKey)
  if (entry !== undefined && entry.uncompressedBytes > limits.maxMetadataBytes) {
    throw limitExceeded(`OME-Zarr root metadata exceeds ${limits.maxMetadataBytes} bytes`)
  }
  const json = readZarrJsonBytes(
    await archive.read(rootKey, context.signal === undefined ? {} : { signal: context.signal }),
  )
  if (json === undefined) throw invalidInput('OME-Zarr ZIP root metadata is not valid JSON')
  const node = parseZarrNodeJson(json)
  const format: 2 | 3 = node?.format === 2 ? 2 : 3
  return {
    json,
    store: createZarrStore(createZipCompanionResolver(archive), rootKey, limits, format, {
      identityKind: 'archive',
      archiveResource: context.primary,
    }),
  }
}

const probeJson = (json: unknown): { readonly confidence: number; readonly reason?: string } => {
  const node = parseZarrNodeJson(json)
  if (node === undefined) return { confidence: 0 }
  if (node.format === 2) {
    if (node.nodeType === 'array') {
      return { confidence: 0, reason: 'Zarr v2 array is not an OME-Zarr root' }
    }
    if (isRecord(json) && hasNgffSurface(json)) {
      return { confidence: 0.95, reason: 'OME-NGFF 0.4 Zarr v2 attributes' }
    }
    if (isRecord(json) && bioformatsLayout(json) !== undefined) {
      return { confidence: 0.9, reason: 'bioformats2raw Zarr v2 layout root' }
    }
    return { confidence: 0.75, reason: 'Zarr v2 group; NGFF 0.4 attributes are resolved on open' }
  }
  if (node.nodeType !== 'group' || !isRecord(json)) {
    return { confidence: 0, reason: 'Zarr v3 metadata without an OME-NGFF group' }
  }
  const attributes = isRecord(json.attributes) ? json.attributes : undefined
  const ome = attributes === undefined ? undefined : attributes.ome
  const layout =
    (isRecord(ome) ? bioformatsLayout(ome) : undefined) ??
    (attributes === undefined ? undefined : bioformatsLayout(attributes))
  if (!isRecord(ome)) {
    if (layout !== undefined) {
      return { confidence: 0.85, reason: 'bioformats2raw Zarr v3 layout root' }
    }
    return { confidence: 0, reason: 'Zarr v3 group without OME attributes' }
  }
  if (ome.version === '0.5' && hasNgffSurface(ome)) {
    return { confidence: 0.95, reason: 'OME-NGFF 0.5 Zarr v3 group' }
  }
  if (layout !== undefined) {
    return { confidence: 0.9, reason: 'bioformats2raw OME-NGFF 0.5 layout root' }
  }
  return { confidence: 0.7, reason: 'Zarr v3 group with OME attributes' }
}

export const probeOmeZarr = async (
  context: Readonly<ScientificOpenContext>,
  maxBytes: number,
  zipLimits: Readonly<ZipLimits> = {},
): Promise<{ readonly confidence: number; readonly reason?: string }> => {
  const size = Math.min(context.primary.source.size, maxBytes)
  if (size < 2) return { confidence: 0 }
  const bytes = await context.primary.source.read(0, size, {
    ...(context.signal === undefined ? {} : { signal: context.signal }),
  })
  if (looksLikeZip(bytes)) {
    if (!zipNameHint(context.primary.name)) {
      return { confidence: 0, reason: 'ZIP bytes without an OME-Zarr name hint' }
    }
    try {
      const archive = await openZipArchive(context.primary.source, zipLimits, context.signal)
      const rootKey = zipRootMetadataKey(archive)
      if (rootKey === undefined) {
        return { confidence: 0, reason: 'ZIP archive is not a Zarr store root' }
      }
      const entry = archive.get(rootKey)
      if (entry !== undefined && entry.uncompressedBytes > maxBytes) {
        return { confidence: 0, reason: 'OME-Zarr ZIP root metadata exceeds the probe budget' }
      }
      const json = readZarrJsonBytes(
        await archive.read(rootKey, context.signal === undefined ? {} : { signal: context.signal }),
      )
      return probeJson(json)
    } catch (error) {
      if (isAbortError(error)) throw error
      if (error instanceof ImageError && error.code === 'LIMIT_EXCEEDED') throw error
      if (
        error instanceof ImageError &&
        (error.code === 'INVALID_INPUT' ||
          error.code === 'TRUNCATED_INPUT' ||
          error.code === 'UNSUPPORTED_FORMAT' ||
          error.code === 'UNSUPPORTED_OPERATION')
      ) {
        return { confidence: 0, reason: 'ZIP bytes are not a readable OME-Zarr store' }
      }
      throw error
    }
  }
  return probeJson(readZarrJsonBytes(bytes))
}

export const openOmeZarr = async (
  options: Readonly<OmeZarrOpenOptions>,
): Promise<ScientificDocument> => {
  const { context, descriptor, limits } = options
  const prefix = await context.primary.source.read(0, Math.min(context.primary.source.size, 4), {
    ...(context.signal === undefined ? {} : { signal: context.signal }),
  })
  let json: unknown
  let store: ZarrStore
  let storeKind: 'directory' | 'zip' = 'directory'
  if (looksLikeZip(prefix)) {
    const opened = await openZipRoot(context, limits)
    json = opened.json
    store = opened.store
    storeKind = 'zip'
  } else {
    if (context.companions === undefined) {
      throw invalidInput('OME-Zarr requires a companion resolver for store members')
    }
    json = await readPrimaryJson(context, limits.maxMetadataBytes)
    const node = parseZarrNodeJson(json)
    store = createZarrStore(
      context.companions,
      context.primary.name,
      limits,
      node?.format === 2 ? 2 : 3,
      { identityKind: 'session' },
    )
  }
  if (!isRecord(json)) throw invalidInput('OME-Zarr root metadata is not an object')
  const format: 2 | 3 = parseZarrNodeJson(json)?.format === 2 ? 2 : 3
  const attributes =
    format === 3
      ? isRecord(json.attributes)
        ? json.attributes
        : {}
      : hasNgffSurface(json) || bioformatsLayout(json) !== undefined
        ? json
        : ((await store.readJsonOptional('.zattrs', context.signal)) ?? {})
  let version = format === 3 ? '0.5' : '0.4'
  let ome: Readonly<Record<string, unknown>> = {}
  if (isRecord(attributes) && recognizedOmeAttributes(attributes)) {
    const parsed = parseOmeAttributes(attributes, format)
    version = parsed.version
    ome = parsed.ome
  }
  const collected: {
    readonly id: string
    readonly name: string
    readonly parsed: ParsedMultiscale
  }[] = []
  const usedIds = new Set<string>()
  const addCollected = (id: string, name: string, parsed: ParsedMultiscale): void => {
    if (usedIds.has(id)) throw invalidInput(`OME-Zarr dataset id ${id} is repeated`)
    if (collected.length >= limits.maxDatasets) {
      throw limitExceeded(`OME-Zarr dataset count exceeds ${limits.maxDatasets}`)
    }
    usedIds.add(id)
    collected.push({ id, name, parsed })
  }
  const openGroupIfPresent = async (path: string) => {
    const key =
      store.format === 3
        ? path.length === 0
          ? 'zarr.json'
          : `${path}/zarr.json`
        : path.length === 0
          ? '.zgroup'
          : `${path}/.zgroup`
    const json = await store.readJsonOptional(key, context.signal)
    if (json === undefined) return undefined
    if (parseZarrNodeJson(json)?.nodeType === 'array') return undefined
    return store.openGroup(path, context.signal)
  }
  const omeFromGroup = (
    groupAttributes: Readonly<Record<string, unknown>>,
  ): { readonly version: string; readonly ome: Readonly<Record<string, unknown>> } =>
    parseOmeAttributes(groupAttributes, store.format, version)
  const addMultiscales = async (
    entries: unknown,
    basePath: string,
    idFor: (index: number, name: string) => string,
    extraMetadata: ScientificMetadataObject | undefined,
    channels: ReturnType<typeof parseOmeroChannels>,
    imageLabelValue?: unknown,
  ): Promise<void> => {
    if (!Array.isArray(entries) || entries.length === 0) {
      throw invalidInput('OME-Zarr group has no multiscales')
    }
    if (entries.length > limits.maxMultiscales) {
      throw limitExceeded(`OME-Zarr multiscale count exceeds ${limits.maxMultiscales}`)
    }
    for (const [index, entry] of entries.entries()) {
      const parsed = await parseMultiscale(entry, store, limits, version, context.signal, basePath)
      let metadata = extraMetadata
      if (extraMetadata?.kind === 'label') {
        const sampleType = parsed.levels[0]?.array.dataType ?? 'uint8'
        if (sampleType.startsWith('float')) {
          throw invalidInput('OME-Zarr label datasets cannot use a floating-point sample type')
        }
        const imageLabel = parseImageLabel(imageLabelValue, sampleType)
        metadata = normalizeScientificMetadataObject({
          kind: 'label',
          ...(imageLabel === undefined ? {} : { imageLabel }),
        })
      }
      addCollected(
        idFor(index, parsed.name),
        parsed.name,
        Object.freeze({
          ...parsed,
          channels,
          ...(metadata === undefined ? {} : { extraMetadata: metadata }),
        }),
      )
    }
  }
  const addLabelEntries = async (indexPath: string, listed: unknown): Promise<void> => {
    if (!Array.isArray(listed)) return
    for (const [index, entry] of listed.entries()) {
      const name = requiredString(entry, `OME-Zarr labels[${index}]`)
      const labelPath = joinZarrPath(indexPath, name)
      const labelGroup = await store.openGroup(labelPath, context.signal)
      const labelOme = omeFromGroup(labelGroup.attributes).ome
      await addMultiscales(
        labelOme.multiscales,
        labelPath,
        () => (indexPath.length === 0 ? joinZarrPath('labels', name) : labelPath),
        normalizeScientificMetadataObject({ kind: 'label' }),
        undefined,
        labelOme['image-label'],
      )
    }
  }
  const addLabelSibling = async (basePath: string): Promise<void> => {
    const labelsPath = joinZarrPath(basePath, 'labels')
    const group = await openGroupIfPresent(labelsPath)
    if (group === undefined) return
    await addLabelEntries(labelsPath, omeFromGroup(group.attributes).ome.labels)
  }
  const addWellImages = async (
    wellPath: string,
    well: Readonly<Record<string, unknown>>,
    rowIndex: number | undefined,
    columnIndex: number | undefined,
    acquisitions: ReadonlySet<number> | undefined,
  ): Promise<void> => {
    const images = parseWellImages(well, wellPath, acquisitions)
    for (const image of images) {
      const fieldPath = joinZarrPath(wellPath, image.path)
      const fieldGroup = await store.openGroup(fieldPath, context.signal)
      const fieldOme = omeFromGroup(fieldGroup.attributes).ome
      await addMultiscales(
        fieldOme.multiscales,
        fieldPath,
        () => fieldPath,
        normalizeScientificMetadataObject({
          kind: 'image',
          well: {
            path: wellPath,
            field: fieldPath,
            ...(rowIndex === undefined ? {} : { rowIndex }),
            ...(columnIndex === undefined ? {} : { columnIndex }),
            ...(image.acquisition === undefined ? {} : { acquisition: image.acquisition }),
          },
        }),
        parseOmeroChannels(fieldOme.omero),
      )
      await addLabelSibling(fieldPath)
    }
  }

  const rootLayout =
    bioformatsLayout(ome) ?? (isRecord(attributes) ? bioformatsLayout(attributes) : undefined)
  if (Array.isArray(ome.multiscales) && ome.multiscales.length > 0) {
    await addMultiscales(
      ome.multiscales,
      '',
      (index) =>
        ome.multiscales !== undefined &&
        Array.isArray(ome.multiscales) &&
        ome.multiscales.length === 1
          ? 'image'
          : `image-${index}`,
      normalizeScientificMetadataObject({ kind: 'image' }),
      parseOmeroChannels(ome.omero),
    )
    await addLabelSibling('')
  }
  if (
    Array.isArray(ome.labels) &&
    !Array.isArray(ome.multiscales) &&
    !isRecord(ome.plate) &&
    !isRecord(ome.well) &&
    rootLayout === undefined
  ) {
    await addLabelEntries('', ome.labels)
  }
  if (isRecord(ome.plate)) {
    const acquisitions = parseAcquisitionIds(ome.plate.acquisitions)
    for (const wellEntry of parsePlateWells(ome.plate)) {
      const wellGroup = await store.openGroup(wellEntry.path, context.signal)
      const wellOme = omeFromGroup(wellGroup.attributes).ome
      if (!isRecord(wellOme.well)) {
        throw invalidInput(`OME-Zarr well ${wellEntry.path} is missing well metadata`)
      }
      await addWellImages(
        wellEntry.path,
        wellOme.well,
        wellEntry.rowIndex,
        wellEntry.columnIndex,
        acquisitions,
      )
    }
  } else if (isRecord(ome.well)) {
    await addWellImages('', ome.well, undefined, undefined, undefined)
  }
  let seriesCount = 0
  if (collected.length === 0) {
    for (let index = 0; index < limits.maxDatasets; index += 1) {
      const path = String(index)
      const group = await openGroupIfPresent(path)
      if (group === undefined) break
      let seriesOme: Readonly<Record<string, unknown>>
      try {
        seriesOme = omeFromGroup(group.attributes).ome
      } catch (error) {
        if (rootLayout !== undefined || recognizedOmeAttributes(group.attributes)) throw error
        break
      }
      if (!Array.isArray(seriesOme.multiscales) || seriesOme.multiscales.length === 0) {
        if (rootLayout !== undefined) {
          throw invalidInput(`OME-Zarr bioformats2raw series ${path} is missing multiscales`)
        }
        break
      }
      seriesCount += 1
      await addMultiscales(
        seriesOme.multiscales,
        path,
        () => path,
        normalizeScientificMetadataObject({ kind: 'image', series: index }),
        parseOmeroChannels(seriesOme.omero),
      )
      await addLabelSibling(path)
    }
    if (seriesCount === limits.maxDatasets) {
      const extra = await openGroupIfPresent(String(limits.maxDatasets))
      if (extra !== undefined) {
        throw limitExceeded(`OME-Zarr dataset count exceeds ${limits.maxDatasets}`)
      }
    }
  }
  if (collected.length === 0) {
    throw invalidInput('OME-Zarr group has no image, label, or plate datasets')
  }

  const datasets: {
    readonly id: string
    readonly name: string
    readonly dataset: ScientificDataset
    readonly identity: Awaited<ReturnType<typeof createScientificDatasetIdentity>>
  }[] = []
  const summaries: ScientificDocument['datasets'][number][] = []
  for (const entry of collected) {
    const dataset = new OmeZarrDataset(store, entry.parsed, limits, context.primary.id)
    const identity = await createScientificDatasetIdentity({
      reader: descriptor,
      datasetId: entry.id,
      resources: await store.identityResources(
        datasetIdentityPaths(entry.parsed, store.format),
        context.signal,
      ),
    })
    datasets.push({
      id: entry.id,
      name: entry.name,
      dataset: identifyScientificDataset(dataset, identity),
      identity,
    })
    summaries.push(
      Object.freeze({
        id: entry.id,
        name: entry.name,
        descriptor: dataset.descriptor,
        identity,
      }),
    )
  }
  const ignored = [ome.tables === undefined ? undefined : 'tables'].filter(
    (entry): entry is string => entry !== undefined,
  )
  const metadata: ScientificMetadataObject = normalizeScientificMetadataObject({
    omeNgffVersion: version,
    zarrFormat: format,
    store: storeKind,
    ...(rootLayout === undefined ? {} : { bioformats2rawLayout: rootLayout }),
    ...(seriesCount === 0 ? {} : { seriesCount }),
    ...(isRecord(ome.plate)
      ? {
          plate: {
            ...(typeof ome.plate.name === 'string' ? { name: ome.plate.name } : {}),
            wellCount: Array.isArray(ome.plate.wells) ? ome.plate.wells.length : 0,
          },
        }
      : {}),
    ...(ignored.length === 0 ? {} : { ignoredSurfaces: ignored }),
  })
  return Object.freeze({
    reader: Object.freeze({ id: descriptor.id, version: descriptor.version }),
    format: descriptor.format,
    metadata,
    datasets: Object.freeze(summaries),
    async openDataset(id: string) {
      const found = datasets.find((entry) => entry.id === id)
      if (found === undefined) throw invalidInput(`OME-Zarr dataset ${id} is not in this document`)
      return found.dataset
    },
  })
}

const readPrimaryJson = async (
  context: Readonly<ScientificOpenContext>,
  maxBytes: number,
): Promise<unknown> => {
  if (context.primary.source.size > maxBytes) {
    throw limitExceeded(`OME-Zarr root metadata exceeds ${maxBytes} bytes`)
  }
  const bytes = await context.primary.source.read(0, context.primary.source.size, {
    ...(context.signal === undefined ? {} : { signal: context.signal }),
  })
  const json = readZarrJsonBytes(bytes)
  if (json === undefined) throw invalidInput('OME-Zarr root metadata is not valid JSON')
  return json
}
