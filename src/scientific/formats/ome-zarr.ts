import { type AbortOptions, throwIfAborted } from '../../abort.ts'
import { invalidInput, limitExceeded, unsupportedOperation } from '../../errors.ts'
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

const inferAxisKindFromName = (name: string): ScientificAxisKind => {
  const lower = name.toLowerCase()
  if (lower === 't' || lower === 'time') return 'time'
  if (lower === 'c' || lower === 'channel') return 'channel'
  if (lower === 'x' || lower === 'y' || lower === 'z') return 'space'
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

interface ResolvedTransform {
  readonly transform: LinearTransform
  readonly parameterPath?: string
}

const halfFloat = (bits: number): number => {
  const sign = (bits & 0x8000) === 0 ? 1 : -1
  const exponent = (bits >>> 10) & 0x1f
  const fraction = bits & 0x03ff
  if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024)
  if (exponent === 0x1f) return fraction === 0 ? sign * Number.POSITIVE_INFINITY : Number.NaN
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024)
}

const transformSample = (bytes: Uint8Array, offset: number, type: string): number => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (type === 'uint8') return view.getUint8(offset)
  if (type === 'int8') return view.getInt8(offset)
  if (type === 'uint16') return view.getUint16(offset)
  if (type === 'int16') return view.getInt16(offset)
  if (type === 'uint32') return view.getUint32(offset)
  if (type === 'int32') return view.getInt32(offset)
  if (type === 'float16') return halfFloat(view.getUint16(offset))
  if (type === 'float32') return view.getFloat32(offset)
  if (type === 'float64') return view.getFloat64(offset)
  if (type === 'uint64') {
    const value = view.getBigUint64(offset)
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw invalidInput('OME-Zarr transform value cannot be represented exactly as a number')
    }
    return Number(value)
  }
  if (type === 'int64') {
    const value = view.getBigInt64(offset)
    if (value < BigInt(Number.MIN_SAFE_INTEGER) || value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw invalidInput('OME-Zarr transform value cannot be represented exactly as a number')
    }
    return Number(value)
  }
  throw invalidInput(`OME-Zarr transform array data type ${type} is unsupported`)
}

const resolveTransformValues = async (
  value: Readonly<Record<string, unknown>>,
  field: 'scale' | 'translation',
  rank: number,
  store: ZarrStore,
  basePath: string,
  signal: AbortSignal | undefined,
): Promise<{ readonly values: readonly number[]; readonly parameterPath?: string }> => {
  const inline = value[field]
  const rawPath = value.path
  if ((inline === undefined) === (rawPath === undefined)) {
    throw invalidInput(
      `OME-Zarr ${field} transformation must contain exactly one of ${field} or path`,
    )
  }
  if (inline !== undefined) {
    if (!Array.isArray(inline) || inline.length !== rank) {
      throw invalidInput(`OME-Zarr ${field} transformation rank is invalid`)
    }
    return {
      values: Object.freeze(
        inline.map((entry) => finiteNumber(entry, `OME-Zarr ${field} transformation value`)),
      ),
    }
  }
  const parameterPath = joinZarrPath(
    basePath,
    requiredString(rawPath, `OME-Zarr ${field} transformation path`),
  )
  const array = await store.openArray(parameterPath, signal)
  if (array.shape.length !== 1 || array.shape[0] !== rank) {
    throw invalidInput(
      `OME-Zarr ${field} transform array ${parameterPath} must have shape [${rank}]`,
    )
  }
  const bytes = await store.readRegion(array, [0], [rank], signal)
  const sampleBytes = rasterSampleBytes(array.dataType)
  const values = Array.from({ length: rank }, (_unused, index) => {
    const number = transformSample(bytes, index * sampleBytes, array.dataType)
    if (!Number.isFinite(number)) {
      throw invalidInput(`OME-Zarr ${field} transform array contains a non-finite value`)
    }
    return number
  })
  return { values: Object.freeze(values), parameterPath }
}

const applyTransform = async (
  current: LinearTransform,
  value: unknown,
  rank: number,
  store: ZarrStore,
  basePath: string,
  signal: AbortSignal | undefined,
): Promise<ResolvedTransform> => {
  if (!isRecord(value)) throw invalidInput('OME-Zarr coordinate transformation is invalid')
  const type = requiredString(value.type, 'OME-Zarr coordinate transformation type')
  if (type === 'scale') {
    const resolved = await resolveTransformValues(value, 'scale', rank, store, basePath, signal)
    return {
      transform: {
        origin: current.origin.map((origin, index) => origin * (resolved.values[index] ?? 1)),
        step: current.step.map((step, index) => step * (resolved.values[index] ?? 1)),
      },
      ...(resolved.parameterPath === undefined ? {} : { parameterPath: resolved.parameterPath }),
    }
  }
  if (type === 'translation') {
    const resolved = await resolveTransformValues(
      value,
      'translation',
      rank,
      store,
      basePath,
      signal,
    )
    return {
      transform: {
        origin: current.origin.map((origin, index) => origin + (resolved.values[index] ?? 0)),
        step: current.step.slice(),
      },
      ...(resolved.parameterPath === undefined ? {} : { parameterPath: resolved.parameterPath }),
    }
  }
  throw unsupportedOperation(`OME-Zarr coordinate transformation ${type} is unsupported`)
}

const parseRestrictedTransforms = async (
  values: unknown,
  rank: number,
  label: string,
  store: ZarrStore,
  basePath: string,
  signal: AbortSignal | undefined,
): Promise<{ readonly transform: LinearTransform; readonly parameterPaths: readonly string[] }> => {
  if (values === undefined) {
    throw invalidInput(`${label} must include exactly one scale transformation`)
  }
  if (!Array.isArray(values) || values.length === 0) {
    throw invalidInput(`${label} must be a non-empty array`)
  }
  let scaleCount = 0
  let translationCount = 0
  let current = identityTransform(rank)
  const parameterPaths: string[] = []
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
      const applied = await applyTransform(current, entry, rank, store, basePath, signal)
      current = applied.transform
      if (applied.parameterPath !== undefined) parameterPaths.push(applied.parameterPath)
      continue
    }
    if (type === 'translation') {
      if (scaleCount !== 1 || translationCount !== 0) {
        throw invalidInput(`${label} translation must follow a single scale`)
      }
      translationCount += 1
      const applied = await applyTransform(current, entry, rank, store, basePath, signal)
      current = applied.transform
      if (applied.parameterPath !== undefined) parameterPaths.push(applied.parameterPath)
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
  return { transform: current, parameterPaths: Object.freeze(parameterPaths) }
}

const composeTransforms = async (
  values: unknown,
  rank: number,
  extra: unknown,
  store: ZarrStore,
  basePath: string,
  signal: AbortSignal | undefined,
): Promise<{ readonly transform: LinearTransform; readonly parameterPaths: readonly string[] }> => {
  const dataset = await parseRestrictedTransforms(
    values,
    rank,
    'OME-Zarr dataset coordinateTransformations',
    store,
    basePath,
    signal,
  )
  if (extra === undefined) return dataset
  const shared = await parseRestrictedTransforms(
    extra,
    rank,
    'OME-Zarr multiscale coordinateTransformations',
    store,
    basePath,
    signal,
  )
  return {
    transform: {
      origin: dataset.transform.origin.map(
        (origin, index) =>
          origin * (shared.transform.step[index] ?? 1) + (shared.transform.origin[index] ?? 0),
      ),
      step: dataset.transform.step.map((step, index) => step * (shared.transform.step[index] ?? 1)),
    },
    parameterPaths: Object.freeze([...dataset.parameterPaths, ...shared.parameterPaths]),
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
  const axes = Object.freeze(
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
        kind: type === undefined ? inferAxisKindFromName(name) : axisKind(type),
        ...(unit === undefined ? {} : { unit }),
      })
    }),
  )
  const roles = axes.map((axis) =>
    axis.kind === 'time' ? 'time' : axis.kind === 'space' ? 'space' : 'channel-or-custom',
  )
  const timeCount = roles.filter((role) => role === 'time').length
  const customCount = roles.filter((role) => role === 'channel-or-custom').length
  const spaceCount = roles.filter((role) => role === 'space').length
  if (timeCount > 1) throw invalidInput('OME-Zarr multiscale may include at most one time axis')
  if (customCount > 1) {
    throw invalidInput('OME-Zarr multiscale may include at most one channel or custom axis')
  }
  if (spaceCount < 2 || spaceCount > 3) {
    throw invalidInput('OME-Zarr multiscale must include 2 or 3 spatial axes')
  }
  const expected = [
    ...Array.from({ length: timeCount }, () => 'time' as const),
    ...Array.from({ length: customCount }, () => 'channel-or-custom' as const),
    ...Array.from({ length: spaceCount }, () => 'space' as const),
  ]
  if (roles.some((role, index) => role !== expected[index])) {
    throw invalidInput(
      'OME-Zarr axes must be ordered as time, then channel or custom, then spatial axes',
    )
  }
  return axes
}

export interface OmeZarrDisplayWindowMetadata {
  readonly min: number
  readonly max: number
  readonly start: number
  readonly end: number
}

export interface OmeZarrDisplayChannelMetadata {
  readonly active?: boolean
  readonly coefficient?: number
  readonly color?: number
  readonly family?: string
  readonly inverted?: boolean
  readonly label?: string
  readonly window?: OmeZarrDisplayWindowMetadata
}

export interface OmeZarrDisplayDefaultsMetadata {
  readonly defaultT?: number
  readonly defaultZ?: number
  readonly model?: 'color' | 'greyscale'
}

export interface OmeZarrDisplayMetadata {
  readonly channels: readonly OmeZarrDisplayChannelMetadata[]
  readonly rdefs?: OmeZarrDisplayDefaultsMetadata
}

interface ChannelEntry extends OmeZarrDisplayChannelMetadata {
  readonly name?: string
}

interface ParsedOmero {
  readonly channels: readonly ChannelEntry[]
  readonly display: OmeZarrDisplayMetadata
}

const parseOmeroColor = (value: unknown, label: string): number => {
  if (typeof value === 'string') {
    if (!/^[0-9a-fA-F]{6}$/u.test(value)) {
      throw invalidInput(`${label} must be exactly six hexadecimal digits`)
    }
    return Number.parseInt(value, 16)
  }
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0 || value > 0xff_ffff) {
      throw invalidInput(`${label} must be an integer from 0 through 0xffffff`)
    }
    return value
  }
  throw invalidInput(`${label} is invalid`)
}

const optionalBoolean = (value: unknown, label: string): boolean | undefined => {
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') throw invalidInput(`${label} must be a boolean`)
  return value
}

const optionalFiniteNumber = (value: unknown, label: string): number | undefined =>
  value === undefined ? undefined : finiteNumber(value, label)

const parseOmeroWindow = (
  value: unknown,
  label: string,
  required: boolean,
): OmeZarrDisplayWindowMetadata | undefined => {
  if (value === undefined) {
    if (required) throw invalidInput(`${label} must be present`)
    return undefined
  }
  if (!isRecord(value)) throw invalidInput(`${label} must be an object`)
  const min = finiteNumber(value.min, `${label}.min`)
  const max = finiteNumber(value.max, `${label}.max`)
  const start = finiteNumber(value.start, `${label}.start`)
  const end = finiteNumber(value.end, `${label}.end`)
  return Object.freeze({ min, max, start, end })
}

const parseOmeroRdefs = (value: unknown): OmeZarrDisplayDefaultsMetadata | undefined => {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw invalidInput('OME-Zarr omero.rdefs must be an object')
  const defaultT =
    value.defaultT === undefined
      ? undefined
      : safeNonNegativeInteger(value.defaultT, 'OME-Zarr omero.rdefs.defaultT')
  const defaultZ =
    value.defaultZ === undefined
      ? undefined
      : safeNonNegativeInteger(value.defaultZ, 'OME-Zarr omero.rdefs.defaultZ')
  const model = value.model
  if (model !== undefined && model !== 'color' && model !== 'greyscale') {
    throw invalidInput('OME-Zarr omero.rdefs.model must be color or greyscale')
  }
  return Object.freeze({
    ...(defaultT === undefined ? {} : { defaultT }),
    ...(defaultZ === undefined ? {} : { defaultZ }),
    ...(model === undefined ? {} : { model }),
  })
}

const parseOmero = (value: unknown, version: string): ParsedOmero | undefined => {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw invalidInput('OME-Zarr omero must be an object')
  if (value.channels === undefined) {
    throw invalidInput('OME-Zarr omero.channels must be present')
  }
  if (!Array.isArray(value.channels)) {
    throw invalidInput('OME-Zarr omero.channels must be an array')
  }
  const channels = Object.freeze(
    value.channels.map((channel, index) => {
      if (!isRecord(channel)) throw invalidInput(`OME-Zarr omero.channels[${index}] is invalid`)
      const label =
        channel.label === undefined
          ? undefined
          : requiredString(channel.label, `OME-Zarr omero.channels[${index}].label`)
      if (version === '0.5' && channel.color === undefined) {
        throw invalidInput(`OME-Zarr omero.channels[${index}].color must be present`)
      }
      if (version === '0.5' && typeof channel.color !== 'string') {
        throw invalidInput(
          `OME-Zarr omero.channels[${index}].color must be exactly six hexadecimal digits`,
        )
      }
      const color =
        channel.color === undefined
          ? undefined
          : parseOmeroColor(channel.color, `OME-Zarr omero.channels[${index}].color`)
      const active = optionalBoolean(channel.active, `OME-Zarr omero.channels[${index}].active`)
      const coefficient = optionalFiniteNumber(
        channel.coefficient,
        `OME-Zarr omero.channels[${index}].coefficient`,
      )
      const family =
        channel.family === undefined
          ? undefined
          : requiredString(channel.family, `OME-Zarr omero.channels[${index}].family`)
      const inverted = optionalBoolean(
        channel.inverted,
        `OME-Zarr omero.channels[${index}].inverted`,
      )
      const window = parseOmeroWindow(
        channel.window,
        `OME-Zarr omero.channels[${index}].window`,
        version === '0.5',
      )
      return Object.freeze({
        ...(active === undefined ? {} : { active }),
        ...(coefficient === undefined ? {} : { coefficient }),
        ...(color === undefined ? {} : { color }),
        ...(family === undefined ? {} : { family }),
        ...(inverted === undefined ? {} : { inverted }),
        ...(label === undefined ? {} : { label, name: label }),
        ...(window === undefined ? {} : { window }),
      })
    }),
  )
  const rdefs = parseOmeroRdefs(value.rdefs)
  const displayChannels = Object.freeze(
    channels.map(({ name: _name, ...channel }) => Object.freeze(channel)),
  )
  return Object.freeze({
    channels,
    display: Object.freeze({
      channels: displayChannels,
      ...(rdefs === undefined ? {} : { rdefs }),
    }),
  })
}

const assertOmeroChannelCount = (
  channels: readonly ChannelEntry[] | undefined,
  axes: readonly ParsedAxis[],
  shape: readonly number[],
): void => {
  if (channels === undefined) return
  const channelIndex = axes.findIndex((axis) => axis.kind === 'channel')
  if (channelIndex >= 0) {
    const length = shape[channelIndex] ?? 0
    if (channels.length !== length) {
      throw invalidInput(
        `OME-Zarr omero.channels length ${channels.length} does not match channel axis length ${length}`,
      )
    }
    return
  }
  if (channels.length > 1) {
    throw invalidInput('OME-Zarr omero.channels must match the channel-axis length')
  }
}

const assertOmeroDefaults = (
  rdefs: Readonly<OmeZarrDisplayDefaultsMetadata> | undefined,
  axes: readonly ParsedAxis[],
  shape: readonly number[],
): void => {
  if (rdefs === undefined) return
  for (const [axisName, index] of [
    ['t', rdefs.defaultT],
    ['z', rdefs.defaultZ],
  ] as const) {
    if (index === undefined) continue
    const axis = axes.findIndex((entry) => entry.id === axisName)
    if (axis < 0) {
      if (index !== 0) {
        throw invalidInput(
          `OME-Zarr omero.rdefs.default${axisName.toUpperCase()} requires a ${axisName} axis`,
        )
      }
      continue
    }
    if (index >= (shape[axis] ?? 0)) {
      throw invalidInput(
        `OME-Zarr omero.rdefs.default${axisName.toUpperCase()} is outside the ${axisName} axis`,
      )
    }
  }
}

interface ParsedLevel {
  readonly path: string
  readonly array: ZarrArrayMetadata
  readonly transform: LinearTransform
  readonly transformParameterPaths: readonly string[]
}

interface ParsedMultiscale {
  readonly name: string
  readonly version: string
  readonly axes: readonly ParsedAxis[]
  readonly levels: readonly ParsedLevel[]
  readonly channels: readonly ChannelEntry[] | undefined
  readonly generationType?: string
  readonly generationMetadata?: ScientificMetadataObject
  readonly extraMetadata?: ScientificMetadataObject
  readonly metadataPath: string
  readonly metadataRelative: string
  readonly multiscaleIndex: number
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

const groupMetadataRelative = (format: 2 | 3, basePath: string): string =>
  format === 3
    ? basePath.length === 0
      ? 'zarr.json'
      : `${basePath}/zarr.json`
    : basePath.length === 0
      ? '.zattrs'
      : `${basePath}/.zattrs`

const groupMetadataPath = (store: ZarrStore, basePath: string): string => {
  const relative = groupMetadataRelative(store.format, basePath)
  return store.prefix.length === 0 ? relative : `${store.prefix}/${relative}`
}

const parseMultiscale = async (
  value: unknown,
  store: ZarrStore,
  limits: Readonly<OmeZarrLimits>,
  version: string,
  signal: AbortSignal | undefined,
  basePath: string,
  multiscaleIndex: number,
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
    const transform = await composeTransforms(
      dataset.coordinateTransformations,
      axes.length,
      value.coordinateTransformations,
      store,
      basePath,
      signal,
    )
    levels.push(
      Object.freeze({
        path,
        array,
        transform: transform.transform,
        transformParameterPaths: transform.parameterPaths,
      }),
    )
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
    value.name === undefined || value.name === ''
      ? 'image'
      : requiredString(value.name, 'OME-Zarr multiscale name')
  const generationType =
    value.type === undefined
      ? undefined
      : requiredString(value.type, 'OME-Zarr multiscale generation type')
  if (value.metadata !== undefined && !isRecord(value.metadata)) {
    throw invalidInput('OME-Zarr multiscale generation metadata must be an object')
  }
  const generationMetadata = isRecord(value.metadata)
    ? normalizeScientificMetadataObject(value.metadata)
    : undefined
  return Object.freeze({
    name,
    version,
    axes,
    levels: Object.freeze(levels),
    channels: undefined,
    ...(generationType === undefined ? {} : { generationType }),
    ...(generationMetadata === undefined ? {} : { generationMetadata }),
    metadataPath: groupMetadataPath(store, basePath),
    metadataRelative: groupMetadataRelative(store.format, basePath),
    multiscaleIndex,
  })
}

const hasNgffSurface = (value: Readonly<Record<string, unknown>>): boolean =>
  Array.isArray(value.multiscales) ||
  Array.isArray(value.labels) ||
  isRecord(value.plate) ||
  isRecord(value.well) ||
  isRecord(value['image-label'])

type BioformatsLayout =
  | { readonly kind: 'absent' }
  | { readonly kind: 'valid'; readonly value: 3 }
  | { readonly kind: 'invalid'; readonly raw: unknown }

const parseBioformatsLayout = (value: Readonly<Record<string, unknown>>): BioformatsLayout => {
  if (!('bioformats2raw.layout' in value)) return { kind: 'absent' }
  const raw = value['bioformats2raw.layout']
  if (raw === 3 || raw === '3') return { kind: 'valid', value: 3 }
  return { kind: 'invalid', raw }
}

const validBioformatsLayout = (value: Readonly<Record<string, unknown>>): 3 | undefined => {
  const parsed = parseBioformatsLayout(value)
  return parsed.kind === 'valid' ? parsed.value : undefined
}

const rejectInvalidBioformatsLayout = (value: Readonly<Record<string, unknown>>): void => {
  if (parseBioformatsLayout(value).kind === 'invalid') {
    throw invalidInput('OME-Zarr bioformats2raw.layout must be 3')
  }
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
    rejectInvalidBioformatsLayout(nested)
    parsed = { version, ome: nested }
  } else if (hasNgffSurface(attributes) || parseBioformatsLayout(attributes).kind !== 'absent') {
    rejectInvalidBioformatsLayout(attributes)
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
  if (sampleType === 'int64') return { min: Number.MIN_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER }
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
  relatedImage?: { readonly datasetId: string; readonly levelCount: number },
): ScientificMetadataObject | undefined => {
  if (!isRecord(value)) return undefined
  if (sampleType.startsWith('float')) {
    throw invalidInput('OME-Zarr label datasets cannot use a floating-point sample type')
  }
  const seenLabelValues = new Set<number>()
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
        if (seenLabelValues.has(labelValue)) {
          throw invalidInput(`OME-Zarr image-label.colors label-value ${labelValue} is repeated`)
        }
        seenLabelValues.add(labelValue)
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
  if (value.colors !== undefined && colors === undefined) {
    throw invalidInput('OME-Zarr image-label.colors must be an array')
  }
  if (colors !== undefined && colors.length === 0) {
    throw invalidInput('OME-Zarr image-label.colors must not be empty')
  }
  const seenPropertyValues = new Set<number>()
  const properties = Array.isArray(value.properties)
    ? value.properties.map((entry, index) => {
        if (!isRecord(entry)) {
          throw invalidInput(`OME-Zarr image-label.properties[${index}] is invalid`)
        }
        const range = labelValueRange(sampleType)
        const labelValue = integerInRange(
          entry['label-value'],
          range.min,
          range.max,
          `OME-Zarr image-label.properties[${index}].label-value`,
        )
        if (seenPropertyValues.has(labelValue)) {
          throw invalidInput(
            `OME-Zarr image-label.properties label-value ${labelValue} is repeated`,
          )
        }
        seenPropertyValues.add(labelValue)
        const { 'label-value': _labelValue, ...metadata } = entry
        return normalizeScientificMetadataObject({ value: labelValue, metadata })
      })
    : undefined
  if (value.properties !== undefined && properties === undefined) {
    throw invalidInput('OME-Zarr image-label.properties must be an array')
  }
  if (properties !== undefined && properties.length === 0) {
    throw invalidInput('OME-Zarr image-label.properties must not be empty')
  }
  const authoredSource = isRecord(value.source)
    ? value.source.image === undefined
      ? undefined
      : normalizeLabelSourcePath(
          requiredString(value.source.image, 'OME-Zarr image-label.source.image'),
        )
    : undefined
  if (value.source !== undefined && !isRecord(value.source)) {
    throw invalidInput('OME-Zarr image-label.source must be an object')
  }
  const source = authoredSource ?? (relatedImage === undefined ? undefined : '../../')
  const version =
    value.version === undefined
      ? undefined
      : requiredString(value.version, 'OME-Zarr image-label.version')
  return normalizeScientificMetadataObject({
    ...(version === undefined ? {} : { version }),
    ...(colors === undefined ? {} : { colors }),
    ...(properties === undefined ? {} : { properties }),
    ...(source === undefined
      ? {}
      : {
          sourceImage: source,
          source: {
            image: source,
            relation: 'derived-from',
            ...(relatedImage === undefined || (source !== '../../' && source !== '../..')
              ? {}
              : { datasetId: relatedImage.datasetId }),
          },
        }),
  })
}

const namedEntries = (value: unknown, label: string): readonly string[] => {
  if (!Array.isArray(value) || value.length === 0) {
    throw invalidInput(`${label} must be a non-empty array`)
  }
  const seen = new Set<string>()
  return Object.freeze(
    value.map((entry, index) => {
      if (!isRecord(entry)) throw invalidInput(`${label}[${index}] is invalid`)
      const name = requiredString(entry.name, `${label}[${index}].name`)
      if (!/^[a-z0-9]+$/iu.test(name)) {
        throw invalidInput(`${label}[${index}].name must contain only alphanumeric characters`)
      }
      if (seen.has(name)) throw invalidInput(`${label} name ${name} is repeated`)
      seen.add(name)
      return name
    }),
  )
}

export interface OmeZarrPlateAcquisitionMetadata {
  readonly id: number
  readonly name?: string
  readonly maximumFieldCount?: number
  readonly description?: string
  readonly startTime?: number
  readonly endTime?: number
}

interface ParsedAcquisitions {
  readonly ids: ReadonlySet<number>
  readonly metadata: readonly OmeZarrPlateAcquisitionMetadata[]
}

const parseAcquisitions = (value: unknown): ParsedAcquisitions | undefined => {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw invalidInput('OME-Zarr plate.acquisitions must be an array')
  const ids = new Set<number>()
  const metadata = value.map((entry, index) => {
    if (!isRecord(entry)) throw invalidInput(`OME-Zarr plate.acquisitions[${index}] is invalid`)
    const id = safeNonNegativeInteger(entry.id, `OME-Zarr plate.acquisitions[${index}].id`)
    if (ids.has(id)) throw invalidInput(`OME-Zarr plate acquisition ${id} is repeated`)
    ids.add(id)
    const name =
      entry.name === undefined
        ? undefined
        : requiredString(entry.name, `OME-Zarr plate.acquisitions[${index}].name`)
    const maximumFieldCount =
      entry.maximumfieldcount === undefined
        ? undefined
        : safeNonNegativeInteger(
            entry.maximumfieldcount,
            `OME-Zarr plate.acquisitions[${index}].maximumfieldcount`,
          )
    if (maximumFieldCount === 0) {
      throw invalidInput(`OME-Zarr plate.acquisitions[${index}].maximumfieldcount must be positive`)
    }
    const description =
      entry.description === undefined
        ? undefined
        : requiredString(entry.description, `OME-Zarr plate.acquisitions[${index}].description`)
    const startTime =
      entry.starttime === undefined
        ? undefined
        : safeNonNegativeInteger(entry.starttime, `OME-Zarr plate.acquisitions[${index}].starttime`)
    const endTime =
      entry.endtime === undefined
        ? undefined
        : safeNonNegativeInteger(entry.endtime, `OME-Zarr plate.acquisitions[${index}].endtime`)
    if (startTime !== undefined && endTime !== undefined && startTime > endTime) {
      throw invalidInput(`OME-Zarr plate.acquisitions[${index}] ends before it starts`)
    }
    return Object.freeze({
      id,
      ...(name === undefined ? {} : { name }),
      ...(maximumFieldCount === undefined ? {} : { maximumFieldCount }),
      ...(description === undefined ? {} : { description }),
      ...(startTime === undefined ? {} : { startTime }),
      ...(endTime === undefined ? {} : { endTime }),
    })
  })
  return Object.freeze({ ids, metadata: Object.freeze(metadata) })
}

interface ParsedPlateMetadata {
  readonly acquisitions?: ParsedAcquisitions
  readonly metadata: ScientificMetadataObject
}

const parsePlateMetadata = (
  plate: Readonly<Record<string, unknown>>,
  documentVersion: string,
): ParsedPlateMetadata => {
  const acquisitions = parseAcquisitions(plate.acquisitions)
  const name =
    plate.name === undefined ? undefined : requiredString(plate.name, 'OME-Zarr plate.name')
  const fieldCount =
    plate.field_count === undefined
      ? undefined
      : safeNonNegativeInteger(plate.field_count, 'OME-Zarr plate.field_count')
  if (fieldCount === 0) throw invalidInput('OME-Zarr plate.field_count must be positive')
  if (documentVersion === '0.5' && plate.version === undefined) {
    throw invalidInput('OME-Zarr plate.version must be present')
  }
  const version =
    plate.version === undefined
      ? undefined
      : requiredString(plate.version, 'OME-Zarr plate.version')
  if (version !== undefined && version !== documentVersion) {
    throw invalidInput(
      `OME-Zarr plate.version ${version} does not match document version ${documentVersion}`,
    )
  }
  const rows = namedEntries(plate.rows, 'OME-Zarr plate.rows')
  const columns = namedEntries(plate.columns, 'OME-Zarr plate.columns')
  return Object.freeze({
    ...(acquisitions === undefined ? {} : { acquisitions }),
    metadata: normalizeScientificMetadataObject({
      ...(name === undefined ? {} : { name }),
      ...(fieldCount === undefined ? {} : { fieldCount }),
      ...(version === undefined ? {} : { version }),
      rows,
      columns,
      ...(acquisitions === undefined ? {} : { acquisitions: acquisitions.metadata }),
      wellCount: Array.isArray(plate.wells) ? plate.wells.length : 0,
    }),
  })
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

const validateTransformMetadata = (values: unknown, rank: number, label: string): void => {
  if (!Array.isArray(values) || values.length === 0) {
    throw invalidInput(`${label} must be a non-empty array`)
  }
  let scaleCount = 0
  let translationCount = 0
  for (const [index, entry] of values.entries()) {
    if (!isRecord(entry)) throw invalidInput(`${label}[${index}] is invalid`)
    const type = requiredString(entry.type, `${label}[${index}].type`)
    if (type !== 'scale' && type !== 'translation') {
      throw unsupportedOperation(`OME-Zarr coordinate transformation ${type} is unsupported`)
    }
    const field = type
    const inline = entry[field]
    const path = entry.path
    if ((inline === undefined) === (path === undefined)) {
      throw invalidInput(`${label}[${index}] must contain exactly one of ${field} or path`)
    }
    if (inline !== undefined) {
      if (!Array.isArray(inline) || inline.length !== rank) {
        throw invalidInput(`${label}[${index}] rank is invalid`)
      }
      for (const value of inline) finiteNumber(value, `${label}[${index}] value`)
    } else {
      normalizeScientificRelativeName(requiredString(path, `${label}[${index}].path`))
    }
    if (type === 'scale') {
      if (scaleCount !== 0 || translationCount !== 0) {
        throw invalidInput(`${label} must contain exactly one scale before any translation`)
      }
      scaleCount += 1
    } else {
      if (scaleCount !== 1 || translationCount !== 0) {
        throw invalidInput(`${label} translation must follow a single scale`)
      }
      translationCount += 1
    }
  }
  if (scaleCount !== 1) throw invalidInput(`${label} must include exactly one scale transformation`)
}

const validateMultiscaleMetadata = (value: unknown, index: number): void => {
  if (!isRecord(value)) throw invalidInput(`OME-Zarr multiscales[${index}] is invalid`)
  const axes = parseAxes(value.axes)
  if (!Array.isArray(value.datasets) || value.datasets.length === 0) {
    throw invalidInput(`OME-Zarr multiscales[${index}].datasets must be a non-empty array`)
  }
  const paths = new Set<string>()
  for (const [datasetIndex, dataset] of value.datasets.entries()) {
    if (!isRecord(dataset)) {
      throw invalidInput(`OME-Zarr multiscales[${index}].datasets[${datasetIndex}] is invalid`)
    }
    const path = normalizeScientificRelativeName(
      requiredString(dataset.path, `OME-Zarr multiscales[${index}].datasets[${datasetIndex}].path`),
    )
    if (paths.has(path)) throw invalidInput(`OME-Zarr multiscale dataset path ${path} is repeated`)
    paths.add(path)
    validateTransformMetadata(
      dataset.coordinateTransformations,
      axes.length,
      `OME-Zarr multiscales[${index}].datasets[${datasetIndex}].coordinateTransformations`,
    )
  }
  if (value.coordinateTransformations !== undefined) {
    validateTransformMetadata(
      value.coordinateTransformations,
      axes.length,
      `OME-Zarr multiscales[${index}].coordinateTransformations`,
    )
  }
  if (value.name !== undefined) requiredString(value.name, `OME-Zarr multiscales[${index}].name`)
  if (value.type !== undefined) requiredString(value.type, `OME-Zarr multiscales[${index}].type`)
  if (value.metadata !== undefined && !isRecord(value.metadata)) {
    throw invalidInput(`OME-Zarr multiscales[${index}].metadata must be an object`)
  }
}

/** Validate finalized OME-Zarr 0.5 attributes without requiring array payloads. */
export const validateOmeZarr05Attributes = (attributes: unknown): void => {
  if (!isRecord(attributes)) throw invalidInput('OME-Zarr attributes must be an object')
  const { ome } = parseOmeAttributes(attributes, 3)
  if (Array.isArray(ome.multiscales)) {
    if (ome.multiscales.length === 0) throw invalidInput('OME-Zarr multiscales must not be empty')
    for (const [index, multiscale] of ome.multiscales.entries()) {
      validateMultiscaleMetadata(multiscale, index)
    }
    parseOmero(ome.omero, '0.5')
  } else if (ome.omero !== undefined) {
    throw invalidInput('OME-Zarr omero metadata requires multiscales')
  }
  if (isRecord(ome.plate)) {
    parsePlateMetadata(ome.plate, '0.5')
    parsePlateWells(ome.plate)
  }
  if (isRecord(ome.well)) parseWellImages(ome.well, '', undefined)
  if (ome.labels !== undefined) {
    if (!Array.isArray(ome.labels)) throw invalidInput('OME-Zarr labels must be an array')
    const seen = new Set<string>()
    for (const [index, entry] of ome.labels.entries()) {
      const path = normalizeScientificRelativeName(
        requiredString(entry, `OME-Zarr labels[${index}]`),
      )
      if (seen.has(path)) throw invalidInput(`OME-Zarr label path ${path} is repeated`)
      seen.add(path)
    }
  }
  if (ome['image-label'] !== undefined) parseImageLabel(ome['image-label'], 'uint8')
  if (
    !Array.isArray(ome.multiscales) &&
    !isRecord(ome.plate) &&
    !isRecord(ome.well) &&
    !Array.isArray(ome.labels) &&
    !isRecord(ome['image-label']) &&
    validBioformatsLayout(ome) === undefined &&
    !Array.isArray(ome.series)
  ) {
    throw invalidInput('OME-Zarr attributes contain no supported 0.5 metadata surface')
  }
}

const recognizedOmeAttributes = (attributes: Readonly<Record<string, unknown>>): boolean =>
  attributes.ome !== undefined ||
  hasNgffSurface(attributes) ||
  parseBioformatsLayout(attributes).kind !== 'absent'

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
    for (const parameterPath of level.transformParameterPaths) {
      paths.push(zarrMetadataKey(parameterPath, format, 'array'))
      if (format === 2) paths.push(zarrAttributesKey(parameterPath))
    }
  }
  return Object.freeze(paths)
}

const coordinatesFor = (transform: LinearTransform, axis: number): ScientificAxisCoordinates =>
  Object.freeze({
    type: 'linear',
    origin: transform.origin[axis] ?? 0,
    step: transform.step[axis] ?? 1,
  })

const calibrationFor = (resourceId: string, locator: string): ScientificCalibrationEvidence =>
  Object.freeze({
    kind: 'embedded',
    resourceId,
    locator,
  })

const hexFromBytes = (bytes: Uint8Array): string => {
  let hex = ''
  for (let index = 0; index < bytes.byteLength; index += 1) {
    hex += (bytes[index] ?? 0).toString(16).padStart(2, '0')
  }
  return hex
}

const zarrFillMetadata = (fill: ZarrArrayMetadata['fill']): ScientificMetadataObject => {
  if (fill.kind !== 'defined') return normalizeScientificMetadataObject({ kind: 'undefined' })
  const numeric = fill.numeric
  return normalizeScientificMetadataObject({
    kind: 'defined',
    bytes: hexFromBytes(fill.bytes),
    ...(numeric !== undefined && Number.isFinite(numeric) ? { numeric } : {}),
    ...(numeric !== undefined && Number.isNaN(numeric) ? { value: 'NaN' } : {}),
    ...(numeric === Number.POSITIVE_INFINITY ? { value: 'Infinity' } : {}),
    ...(numeric === Number.NEGATIVE_INFINITY ? { value: '-Infinity' } : {}),
  })
}

export interface OmeZarrLevelStorageMetadata {
  readonly level: number
  readonly path: string
  readonly shape: readonly number[]
  readonly logicalChunkShape: readonly number[]
  readonly storageChunkShape: readonly number[]
  readonly sharded: boolean
  readonly codecs: readonly string[]
  readonly shardIndexLocation?: 'start' | 'end'
}

const numericTuple = (value: unknown, label: string, rank: number): readonly number[] => {
  if (
    !Array.isArray(value) ||
    value.length !== rank ||
    value.some((entry) => typeof entry !== 'number' || !Number.isSafeInteger(entry) || entry < 1)
  ) {
    throw invalidInput(`${label} is invalid`)
  }
  return Object.freeze(value.map((entry) => Number(entry)))
}

const storageMetadataForLevel = (
  level: Readonly<ParsedLevel>,
  index: number,
): OmeZarrLevelStorageMetadata => {
  const sharding = level.array.codecs.find((codec) => codec.name === 'sharding_indexed')
  if (sharding === undefined) {
    return Object.freeze({
      level: index,
      path: level.path,
      shape: Object.freeze([...level.array.shape]),
      logicalChunkShape: Object.freeze([...level.array.chunkShape]),
      storageChunkShape: Object.freeze([...level.array.chunkShape]),
      sharded: false,
      codecs: Object.freeze(level.array.codecs.map((codec) => codec.name)),
    })
  }
  const innerCodecs = Array.isArray(sharding.configuration.codecs)
    ? sharding.configuration.codecs
        .map((codec) =>
          typeof codec === 'object' && codec !== null && 'name' in codec
            ? Reflect.get(codec, 'name')
            : undefined,
        )
        .filter((name): name is string => typeof name === 'string')
    : []
  const indexCodecs = Array.isArray(sharding.configuration.index_codecs)
    ? sharding.configuration.index_codecs
        .map((codec) =>
          typeof codec === 'object' && codec !== null && 'name' in codec
            ? Reflect.get(codec, 'name')
            : undefined,
        )
        .filter((name): name is string => typeof name === 'string')
    : []
  const location = sharding.configuration.index_location ?? 'end'
  if (location !== 'start' && location !== 'end') {
    throw invalidInput('OME-Zarr shard index location is invalid')
  }
  return Object.freeze({
    level: index,
    path: level.path,
    shape: Object.freeze([...level.array.shape]),
    logicalChunkShape: numericTuple(
      sharding.configuration.chunk_shape,
      'OME-Zarr logical chunk shape',
      level.array.shape.length,
    ),
    storageChunkShape: Object.freeze([...level.array.chunkShape]),
    sharded: true,
    codecs: Object.freeze([sharding.name, ...new Set([...innerCodecs, ...indexCodecs])]),
    shardIndexLocation: location,
  })
}

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
    calibrationResourceId: string,
  ) {
    this.#store = store
    this.#levels = parsed.levels
    this.#axisIds = parsed.axes.map((axis) => axis.id)
    this.#limits = limits
    const base = parsed.levels[0]
    if (base === undefined) throw invalidInput('OME-Zarr multiscale has no datasets')
    const resourceId = calibrationResourceId
    const channelAxis = parsed.axes.findIndex((axis) => axis.kind === 'channel')
    const axes: ScientificAxisDescriptor[] = parsed.axes.map((axis, index) =>
      Object.freeze({
        id: axis.id,
        name: axis.name,
        kind: axis.kind,
        length: base.array.shape[index] ?? 0,
        ...(axis.unit === undefined ? {} : { unit: axis.unit }),
        coordinates: coordinatesFor(base.transform, index),
        calibration: calibrationFor(
          resourceId,
          store.identityKind === 'archive'
            ? `${parsed.metadataPath}#ome:multiscales/${parsed.multiscaleIndex}/axes/${index}`
            : `ome:multiscales/${parsed.multiscaleIndex}/axes/${index}`,
        ),
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
      metadata: normalizeScientificMetadataObject({
        omeNgffVersion: parsed.version,
        zarrFormat: store.format,
        path: base.path,
        omeZarrLevels: parsed.levels.map(storageMetadataForLevel),
        ...(parsed.generationType === undefined
          ? {}
          : { omeZarrMultiscaleType: parsed.generationType }),
        ...(parsed.generationMetadata === undefined
          ? {}
          : { omeZarrMultiscaleMetadata: parsed.generationMetadata }),
        zarrFill: zarrFillMetadata(fill),
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
    const session = this.#store.createReadSession()
    try {
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
          session,
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
    } finally {
      session.release()
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

const omeZarrZipNameHint = (name: string | undefined): boolean => {
  const lower = name?.toLowerCase() ?? ''
  return (
    lower.endsWith('.ozx') ||
    lower.endsWith('.ome.zarr') ||
    lower.endsWith('.zarr.zip') ||
    lower.endsWith('.ome.zarr.zip') ||
    (lower.endsWith('.zarr') && !lower.endsWith('.zip'))
  )
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

const zipMemberIsMetadata = (name: string): boolean =>
  /(?:^|\/)(?:zarr\.json|\.zgroup|\.zattrs|\.zarray)$/u.test(name)

const createZipCompanionResolver = (
  archive: ZipArchive,
  limits: Readonly<OmeZarrLimits>,
): ScientificCompanionResolver =>
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
      const metadata = zipMemberIsMetadata(name)
      const limit = metadata ? limits.maxMetadataBytes : limits.maxChunkBytes
      const label = metadata ? 'maxMetadataBytes' : 'maxChunkBytes'
      if (entry.uncompressedBytes > limit) {
        throw limitExceeded(`OME-Zarr ZIP member ${name} exceeds ${label}`)
      }
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
    store: createZarrStore(createZipCompanionResolver(archive, limits), rootKey, limits, format, {
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
    if (isRecord(json)) {
      const layout = parseBioformatsLayout(json)
      if (layout.kind === 'invalid') {
        return { confidence: 0, reason: 'bioformats2raw.layout must be 3' }
      }
      if (layout.kind === 'valid') {
        return { confidence: 0.9, reason: 'bioformats2raw Zarr v2 layout root' }
      }
    }
    return { confidence: 0, reason: 'Zarr v2 group without NGFF 0.4 attributes' }
  }
  if (node.nodeType !== 'group' || !isRecord(json)) {
    return { confidence: 0, reason: 'Zarr v3 metadata without an OME-NGFF group' }
  }
  const attributes = isRecord(json.attributes) ? json.attributes : undefined
  const ome = attributes === undefined ? undefined : attributes.ome
  const layoutSource = isRecord(ome) ? ome : attributes
  const layout =
    layoutSource === undefined ? { kind: 'absent' as const } : parseBioformatsLayout(layoutSource)
  if (layout.kind === 'invalid') {
    return { confidence: 0, reason: 'bioformats2raw.layout must be 3' }
  }
  if (!isRecord(ome)) {
    if (layout.kind === 'valid') {
      return { confidence: 0.85, reason: 'bioformats2raw Zarr v3 layout root' }
    }
    return { confidence: 0, reason: 'Zarr v3 group without OME attributes' }
  }
  if (ome.version === '0.5' && hasNgffSurface(ome)) {
    return { confidence: 0.95, reason: 'OME-NGFF 0.5 Zarr v3 group' }
  }
  if (layout.kind === 'valid') {
    return { confidence: 0.9, reason: 'bioformats2raw OME-NGFF 0.5 layout root' }
  }
  return { confidence: 0, reason: 'Zarr v3 OME attributes lack an NGFF surface' }
}

const siblingZattrsName = (primaryName: string | undefined): string => {
  const name = primaryName ?? '.zgroup'
  if (name === '.zgroup') return '.zattrs'
  if (name.endsWith('/.zgroup')) return `${name.slice(0, -'.zgroup'.length)}.zattrs`
  if (name === '.zattrs' || name.endsWith('/.zattrs')) return name
  return '.zattrs'
}

const probeSiblingZattrs = async (
  context: Readonly<ScientificOpenContext>,
  maxBytes: number,
): Promise<unknown> => {
  if (context.companions === undefined) return undefined
  throwIfAborted(context.signal)
  const name = siblingZattrsName(context.primary.name)
  const resource = await context.companions.resolve(
    { kind: 'relative-name', name },
    context.signal === undefined ? {} : { signal: context.signal },
  )
  if (resource === undefined) return undefined
  if (resource.source.size > maxBytes || resource.source.size === 0) return undefined
  throwIfAborted(context.signal)
  return readZarrJsonBytes(
    await resource.source.read(0, resource.source.size, {
      ...(context.signal === undefined ? {} : { signal: context.signal }),
    }),
  )
}

export const probeOmeZarr = async (
  context: Readonly<ScientificOpenContext>,
  maxBytes: number,
): Promise<{ readonly confidence: number; readonly reason?: string }> => {
  const size = Math.min(context.primary.source.size, maxBytes)
  if (size < 2) return { confidence: 0 }
  const bytes = await context.primary.source.read(0, size, {
    ...(context.signal === undefined ? {} : { signal: context.signal }),
  })
  if (looksLikeZip(bytes)) {
    if (!omeZarrZipNameHint(context.primary.name)) {
      return { confidence: 0, reason: 'ZIP bytes without an OME-Zarr name hint' }
    }
    return {
      confidence: 0.9,
      reason: 'OME-Zarr ZIP name and local-file magic',
    }
  }
  const json = readZarrJsonBytes(bytes)
  const probed = probeJson(json)
  if (probed.confidence > 0) return probed
  const node = parseZarrNodeJson(json)
  if (node?.format !== 2 || node.nodeType !== 'group') {
    return probed.reason === undefined
      ? { confidence: 0, reason: probed.reason ?? 'Not an OME-Zarr root' }
      : probed
  }
  const attrs = await probeSiblingZattrs(context, maxBytes)
  if (!isRecord(attrs)) {
    return { confidence: 0, reason: 'Zarr v2 group without NGFF 0.4 attributes' }
  }
  const fromAttrs = probeJson(attrs)
  if (fromAttrs.confidence > 0) return fromAttrs
  return {
    confidence: 0,
    reason: fromAttrs.reason ?? 'Zarr v2 attributes are not OME-NGFF 0.4',
  }
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
      : hasNgffSurface(json) || parseBioformatsLayout(json).kind !== 'absent'
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
    omero: ParsedOmero | undefined,
    imageLabelValue?: unknown,
    relatedImage?: { readonly datasetId: string; readonly levelCount: number },
  ): Promise<readonly { readonly datasetId: string; readonly levelCount: number }[]> => {
    if (!Array.isArray(entries) || entries.length === 0) {
      throw invalidInput('OME-Zarr group has no multiscales')
    }
    if (entries.length > limits.maxMultiscales) {
      throw limitExceeded(`OME-Zarr multiscale count exceeds ${limits.maxMultiscales}`)
    }
    const added: { readonly datasetId: string; readonly levelCount: number }[] = []
    for (const [index, entry] of entries.entries()) {
      const parsed = await parseMultiscale(
        entry,
        store,
        limits,
        version,
        context.signal,
        basePath,
        index,
      )
      const shape = parsed.levels[0]?.array.shape ?? []
      if (
        version === '0.5' &&
        relatedImage !== undefined &&
        parsed.levels.length !== relatedImage.levelCount
      ) {
        throw invalidInput(
          `OME-Zarr label pyramid has ${parsed.levels.length} levels but associated image ${relatedImage.datasetId} has ${relatedImage.levelCount}`,
        )
      }
      assertOmeroChannelCount(omero?.channels, parsed.axes, shape)
      assertOmeroDefaults(omero?.display.rdefs, parsed.axes, shape)
      let metadata =
        extraMetadata === undefined && omero === undefined
          ? undefined
          : normalizeScientificMetadataObject({
              ...(extraMetadata ?? {}),
              ...(omero === undefined ? {} : { omeZarrDisplay: omero.display }),
            })
      if (extraMetadata?.kind === 'label') {
        const sampleType = parsed.levels[0]?.array.dataType ?? 'uint8'
        if (sampleType.startsWith('float')) {
          throw invalidInput('OME-Zarr label datasets cannot use a floating-point sample type')
        }
        const imageLabel = parseImageLabel(imageLabelValue, sampleType, relatedImage)
        metadata = normalizeScientificMetadataObject({
          kind: 'label',
          ...(imageLabel === undefined ? {} : { imageLabel }),
        })
      }
      const datasetId = idFor(index, parsed.name)
      addCollected(
        datasetId,
        parsed.name,
        Object.freeze({
          ...parsed,
          channels: omero?.channels,
          ...(metadata === undefined ? {} : { extraMetadata: metadata }),
        }),
      )
      added.push(Object.freeze({ datasetId, levelCount: parsed.levels.length }))
    }
    return Object.freeze(added)
  }
  const addLabelEntries = async (
    indexPath: string,
    listed: unknown,
    relatedImage?: { readonly datasetId: string; readonly levelCount: number },
  ): Promise<void> => {
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
        relatedImage,
      )
    }
  }
  const addLabelSibling = async (
    basePath: string,
    addedImages: readonly { readonly datasetId: string; readonly levelCount: number }[],
  ): Promise<void> => {
    const labelsPath = joinZarrPath(basePath, 'labels')
    const group = await openGroupIfPresent(labelsPath)
    if (group === undefined) return
    await addLabelEntries(
      labelsPath,
      omeFromGroup(group.attributes).ome.labels,
      addedImages.length === 1 ? addedImages[0] : undefined,
    )
  }
  const addWellImages = async (
    wellPath: string,
    well: Readonly<Record<string, unknown>>,
    rowIndex: number | undefined,
    columnIndex: number | undefined,
    acquisitions: ReadonlySet<number> | undefined,
  ): Promise<void> => {
    const images = parseWellImages(well, wellPath, acquisitions)
    const wellVersion =
      well.version === undefined
        ? undefined
        : requiredString(well.version, `OME-Zarr well ${wellPath} version`)
    for (const image of images) {
      const fieldPath = joinZarrPath(wellPath, image.path)
      const fieldGroup = await store.openGroup(fieldPath, context.signal)
      const fieldOme = omeFromGroup(fieldGroup.attributes).ome
      const addedImages = await addMultiscales(
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
            ...(wellVersion === undefined ? {} : { version: wellVersion }),
            ...(image.acquisition === undefined ? {} : { acquisition: image.acquisition }),
          },
        }),
        parseOmero(fieldOme.omero, version),
      )
      await addLabelSibling(fieldPath, addedImages)
    }
  }

  const rootLayout =
    validBioformatsLayout(ome) ??
    (isRecord(attributes) ? validBioformatsLayout(attributes) : undefined)
  const parsedPlate = isRecord(ome.plate) ? parsePlateMetadata(ome.plate, version) : undefined
  if (Array.isArray(ome.multiscales) && ome.multiscales.length > 0) {
    const addedImages = await addMultiscales(
      ome.multiscales,
      '',
      (index) =>
        ome.multiscales !== undefined &&
        Array.isArray(ome.multiscales) &&
        ome.multiscales.length === 1
          ? 'image'
          : `image-${index}`,
      normalizeScientificMetadataObject({ kind: 'image' }),
      parseOmero(ome.omero, version),
    )
    await addLabelSibling('', addedImages)
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
        parsedPlate?.acquisitions?.ids,
      )
    }
  } else if (isRecord(ome.well)) {
    await addWellImages('', ome.well, undefined, undefined, undefined)
  }
  let explicitSeries: readonly string[] | undefined
  if (rootLayout !== undefined) {
    const omeGroup = await openGroupIfPresent('OME')
    if (omeGroup !== undefined) {
      const omeMetadata = omeFromGroup(omeGroup.attributes).ome
      if (omeMetadata.series !== undefined) {
        if (!Array.isArray(omeMetadata.series) || omeMetadata.series.length === 0) {
          throw invalidInput('OME-Zarr OME.series must be a non-empty array')
        }
        if (omeMetadata.series.length > limits.maxDatasets) {
          throw limitExceeded(`OME-Zarr dataset count exceeds ${limits.maxDatasets}`)
        }
        const seen = new Set<string>()
        explicitSeries = Object.freeze(
          omeMetadata.series.map((entry, index) => {
            const path = normalizeScientificRelativeName(
              trimTrailingSlashes(requiredString(entry, `OME-Zarr OME.series[${index}]`)),
            )
            if (seen.has(path)) throw invalidInput(`OME-Zarr OME.series path ${path} is repeated`)
            seen.add(path)
            return path
          }),
        )
      }
    }
  }
  let seriesCount = 0
  if (collected.length === 0) {
    const candidates =
      explicitSeries ??
      Array.from({ length: limits.maxDatasets }, (_unused, index) => String(index))
    for (const [index, path] of candidates.entries()) {
      const group = await openGroupIfPresent(path)
      if (group === undefined) {
        if (explicitSeries !== undefined) {
          throw invalidInput(`OME-Zarr OME.series group ${path} was not found`)
        }
        break
      }
      let seriesOme: Readonly<Record<string, unknown>>
      try {
        seriesOme = omeFromGroup(group.attributes).ome
      } catch (error) {
        if (rootLayout !== undefined || recognizedOmeAttributes(group.attributes)) throw error
        if (explicitSeries !== undefined) {
          throw invalidInput(`OME-Zarr OME.series group ${path} has no OME-Zarr metadata`)
        }
        break
      }
      if (!Array.isArray(seriesOme.multiscales) || seriesOme.multiscales.length === 0) {
        if (rootLayout !== undefined) {
          throw invalidInput(`OME-Zarr bioformats2raw series ${path} is missing multiscales`)
        }
        if (explicitSeries !== undefined) {
          throw invalidInput(`OME-Zarr bioformats2raw series ${path} is missing multiscales`)
        }
        break
      }
      seriesCount += 1
      const addedImages = await addMultiscales(
        seriesOme.multiscales,
        path,
        () => path,
        normalizeScientificMetadataObject({ kind: 'image', series: index }),
        parseOmero(seriesOme.omero, version),
      )
      await addLabelSibling(path, addedImages)
    }
    if (explicitSeries === undefined && seriesCount === limits.maxDatasets) {
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
    const resolvedMetadata =
      store.identityKind === 'archive'
        ? undefined
        : await store.resolve(entry.parsed.metadataRelative, context.signal)
    const dataset = new OmeZarrDataset(
      store,
      entry.parsed,
      limits,
      store.identityKind === 'archive'
        ? context.primary.id
        : (resolvedMetadata?.id ?? entry.parsed.metadataPath),
    )
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
    ...(parsedPlate === undefined ? {} : { plate: parsedPlate.metadata }),
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
