import { throwIfAborted } from '../abort.ts'
import { invalidInput, unsupportedOperation } from '../errors.ts'
import type { RasterBlock } from '../raster.ts'
import type {
  MultidimensionalRasterDataset,
  PhysicalPixelSize,
  RasterChannelInfo,
  RasterPlaneRequest,
} from './legacy-dataset.ts'
import type {
  NormalizedScientificDatasetDescriptor,
  ScientificAxisDescriptor,
  ScientificAxisEntryDescriptor,
  ScientificComponentDescriptor,
  ScientificDataset,
  ScientificMetadataObject,
  ScientificMetadataValue,
  ScientificPlaneReadRequest,
  ScientificResolutionLevel,
} from './dataset.ts'
import {
  normalizeScientificDatasetDescriptor,
  normalizeScientificPlaneReadRequest,
} from './dataset.ts'

const xAxisId = 'x'
const yAxisId = 'y'
const zAxisId = 'z'
const channelAxisId = 'channel'
const timeAxisId = 'time'
const legacyMetadataKey = 'purejsimage:multidimensional-raster-dataset'

export interface MultidimensionalRasterAdapterOptions {
  /** Known pyramid geometry. Omit when the fixed-axis reader exposes only level zero metadata. */
  readonly levels?: readonly ScientificResolutionLevel[]
  /** Whether the fixed-axis reader supports rectangular region reads. Defaults to true. */
  readonly regionReads?: boolean
  /** Singleton legacy dimensions that still carry format-level meaning. */
  readonly semanticSingletonAxes?: readonly ('z' | 'channel' | 'time')[]
}

type ScientificDatasetInput = MultidimensionalRasterDataset | ScientificDataset

export const isScientificDataset = (
  dataset: ScientificDatasetInput,
): dataset is ScientificDataset => 'descriptor' in dataset

const positiveDimension = (value: number, label: string): number => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw invalidInput(`${label} must be a positive safe integer`)
  }
  return value
}

const channelEntry = (channel: RasterChannelInfo): ScientificAxisEntryDescriptor =>
  Object.freeze({
    ...(channel.id === undefined ? {} : { id: channel.id }),
    ...(channel.name === undefined ? {} : { name: channel.name }),
    ...(channel.unit === undefined ? {} : { unit: channel.unit }),
    ...(channel.color === undefined ? {} : { color: channel.color }),
    ...(channel.spectral === undefined
      ? {}
      : {
          spectral: Object.freeze({
            center: channel.spectral.center,
            ...(channel.spectral.unit === undefined ? {} : { unit: channel.spectral.unit }),
            ...(channel.spectral.fwhm === undefined ? {} : { fwhm: channel.spectral.fwhm }),
          }),
        }),
  })

const channelModel = (dataset: MultidimensionalRasterDataset) => {
  if (dataset.channels.length < 1) {
    throw invalidInput('Fixed-axis scientific dataset must declare at least one logical channel')
  }
  const samplesPerPixel = positiveDimension(
    dataset.channels[0]?.samplesPerPixel ?? 0,
    'Fixed-axis channel samplesPerPixel',
  )
  let totalSamples = 0
  for (const channel of dataset.channels) {
    if (channel.samplesPerPixel !== samplesPerPixel) {
      throw unsupportedOperation(
        'Channels with different samplesPerPixel values cannot be represented by one scientific component set',
      )
    }
    totalSamples += positiveDimension(channel.samplesPerPixel, 'Fixed-axis channel samplesPerPixel')
  }
  if (!Number.isSafeInteger(totalSamples) || totalSamples !== dataset.sizeC) {
    throw invalidInput('Fixed-axis channel samplesPerPixel values must total sizeC')
  }
  return Object.freeze({ samplesPerPixel, logicalChannels: dataset.channels.length })
}

const calibratedAxis = (
  id: string,
  name: string,
  length: number,
  physicalSize: PhysicalPixelSize | undefined,
  origin: PhysicalPixelSize | undefined,
): ScientificAxisDescriptor => {
  const unitsMatch =
    physicalSize?.unit === undefined ||
    origin?.unit === undefined ||
    physicalSize.unit === origin.unit
  const finite =
    (physicalSize === undefined || Number.isFinite(physicalSize.value)) &&
    (origin === undefined || Number.isFinite(origin.value))
  const canUseLinear =
    finite &&
    unitsMatch &&
    physicalSize?.value !== 0 &&
    (physicalSize !== undefined || origin !== undefined)
  const unit = unitsMatch ? (physicalSize?.unit ?? origin?.unit) : undefined
  return Object.freeze({
    id,
    name,
    kind: 'space',
    length,
    coordinates: canUseLinear
      ? Object.freeze({
          type: 'linear',
          origin: origin?.value ?? 0,
          step: physicalSize?.value ?? 1,
        })
      : Object.freeze({ type: 'index' }),
    ...(unit === undefined ? {} : { unit }),
  })
}

const channelAxis = (
  dataset: MultidimensionalRasterDataset,
  logicalChannels: number,
): ScientificAxisDescriptor => {
  const entries = Object.freeze(dataset.channels.map(channelEntry))
  const spectral = entries.every((entry) => entry.spectral !== undefined)
  const spectralUnits = new Set(entries.map((entry) => entry.spectral?.unit))
  const comparableSpectralCoordinates = spectral && spectralUnits.size === 1
  const names = entries.map((entry) => entry.name)
  const allNamed = names.every((name) => name !== undefined)
  const coordinates = comparableSpectralCoordinates
    ? Object.freeze({
        type: 'lookup' as const,
        values: Object.freeze(entries.map((entry) => entry.spectral?.center ?? 0)),
      })
    : allNamed
      ? Object.freeze({
          type: 'labels' as const,
          values: Object.freeze(names.map((name) => name ?? '')),
        })
      : Object.freeze({ type: 'index' as const })
  const unit = comparableSpectralCoordinates ? entries[0]?.spectral?.unit : undefined
  return Object.freeze({
    id: channelAxisId,
    name: spectral ? 'Spectral channel' : 'Channel',
    kind: spectral ? 'spectral' : 'channel',
    length: logicalChannels,
    coordinates,
    entries,
    ...(unit === undefined ? {} : { unit }),
  })
}

const components = (
  samplesPerPixel: number,
  channels: readonly RasterChannelInfo[],
): readonly ScientificComponentDescriptor[] => {
  const sharedUnit =
    channels.length > 0 && channels.every((channel) => channel.unit === channels[0]?.unit)
      ? channels[0]?.unit
      : undefined
  const kinds =
    samplesPerPixel === 3
      ? (['red', 'green', 'blue'] as const)
      : samplesPerPixel === 4
        ? (['red', 'green', 'blue', 'alpha'] as const)
        : undefined
  return Object.freeze(
    Array.from({ length: samplesPerPixel }, (_, index) =>
      Object.freeze({
        id: samplesPerPixel === 1 ? 'value' : `component-${index}`,
        kind: kinds?.[index] ?? (samplesPerPixel === 1 ? 'scalar' : 'vector'),
        ...(sharedUnit === undefined ? {} : { unit: sharedUnit }),
      }),
    ),
  )
}

const physicalMetadata = (value: PhysicalPixelSize): ScientificMetadataObject =>
  Object.freeze({
    value: value.value,
    ...(value.unit === undefined ? {} : { unit: value.unit }),
  })

const stringMetadata = (value: Readonly<Record<string, string>>): ScientificMetadataObject => {
  const output: { [key: string]: string } = {}
  for (const [key, entry] of Object.entries(value)) {
    Object.defineProperty(output, key, {
      configurable: false,
      enumerable: true,
      value: entry,
      writable: false,
    })
  }
  return Object.freeze(output)
}

const channelMetadata = (channel: RasterChannelInfo): ScientificMetadataObject =>
  Object.freeze({
    samplesPerPixel: channel.samplesPerPixel,
    ...(channel.id === undefined ? {} : { id: channel.id }),
    ...(channel.name === undefined ? {} : { name: channel.name }),
    ...(channel.unit === undefined ? {} : { unit: channel.unit }),
    ...(channel.color === undefined ? {} : { color: channel.color }),
    ...(channel.spectral === undefined
      ? {}
      : {
          spectral: Object.freeze({
            center: channel.spectral.center,
            ...(channel.spectral.unit === undefined ? {} : { unit: channel.spectral.unit }),
            ...(channel.spectral.fwhm === undefined ? {} : { fwhm: channel.spectral.fwhm }),
          }),
        }),
  })

const legacyMetadata = (dataset: MultidimensionalRasterDataset): ScientificMetadataObject => {
  const compatibility: ScientificMetadataObject = Object.freeze({
    schemaVersion: 1,
    dimensionOrder: dataset.dimensionOrder,
    channels: Object.freeze(dataset.channels.map(channelMetadata)),
    ...(dataset.metadata === undefined ? {} : { sourceMetadata: stringMetadata(dataset.metadata) }),
    ...(dataset.physicalSizeX === undefined
      ? {}
      : { physicalSizeX: physicalMetadata(dataset.physicalSizeX) }),
    ...(dataset.physicalSizeY === undefined
      ? {}
      : { physicalSizeY: physicalMetadata(dataset.physicalSizeY) }),
    ...(dataset.physicalSizeZ === undefined
      ? {}
      : { physicalSizeZ: physicalMetadata(dataset.physicalSizeZ) }),
    ...(dataset.originX === undefined ? {} : { originX: physicalMetadata(dataset.originX) }),
    ...(dataset.originY === undefined ? {} : { originY: physicalMetadata(dataset.originY) }),
    ...(dataset.originZ === undefined ? {} : { originZ: physicalMetadata(dataset.originZ) }),
  })
  return Object.freeze({
    [legacyMetadataKey]: compatibility,
  })
}

const fixedIndex = (
  request: ReturnType<typeof normalizeScientificPlaneReadRequest>,
  axisId: string,
): number => request.fixedIndices.find((selection) => selection.axisId === axisId)?.index ?? 0

class FixedAxisScientificDataset implements ScientificDataset {
  readonly descriptor: NormalizedScientificDatasetDescriptor
  readonly source: MultidimensionalRasterDataset
  readonly #samplesPerPixel: number

  constructor(
    source: MultidimensionalRasterDataset,
    options: Readonly<MultidimensionalRasterAdapterOptions>,
  ) {
    this.source = source
    const sizeX = positiveDimension(source.sizeX, 'Fixed-axis sizeX')
    const sizeY = positiveDimension(source.sizeY, 'Fixed-axis sizeY')
    const sizeZ = positiveDimension(source.sizeZ, 'Fixed-axis sizeZ')
    positiveDimension(source.sizeC, 'Fixed-axis sizeC')
    const sizeT = positiveDimension(source.sizeT, 'Fixed-axis sizeT')
    const model = channelModel(source)
    this.#samplesPerPixel = model.samplesPerPixel
    const semanticSingletonAxes = new Set(options.semanticSingletonAxes)
    const axes: ScientificAxisDescriptor[] = [
      calibratedAxis(xAxisId, 'X', sizeX, source.physicalSizeX, source.originX),
      calibratedAxis(yAxisId, 'Y', sizeY, source.physicalSizeY, source.originY),
    ]
    if (sizeZ > 1 || semanticSingletonAxes.has(zAxisId)) {
      axes.push(calibratedAxis(zAxisId, 'Z', sizeZ, source.physicalSizeZ, source.originZ))
    }
    if (model.logicalChannels > 1 || semanticSingletonAxes.has(channelAxisId)) {
      axes.push(channelAxis(source, model.logicalChannels))
    }
    if (sizeT > 1 || semanticSingletonAxes.has(timeAxisId)) {
      axes.push(
        Object.freeze({
          id: timeAxisId,
          name: 'Time',
          kind: 'time' as const,
          length: sizeT,
          coordinates: Object.freeze({ type: 'index' as const }),
        }),
      )
    }
    const frozenAxes = Object.freeze(axes)
    const includedAxisIds = new Set(frozenAxes.map((axis) => axis.id))
    const levels = options.levels?.map((level) =>
      Object.freeze({
        level: level.level,
        axisLengths: Object.freeze(
          level.axisLengths.filter((entry) => includedAxisIds.has(entry.axisId)),
        ),
      }),
    )
    this.descriptor = normalizeScientificDatasetDescriptor({
      schemaVersion: 1,
      axes: frozenAxes,
      sampleType: source.sampleType,
      components: components(model.samplesPerPixel, source.channels),
      ...(levels === undefined ? {} : { levels }),
      ...(source.noDataValue === undefined ? {} : { noDataValue: source.noDataValue }),
      metadata: legacyMetadata(source),
      capabilities: {
        regionReads: options.regionReads ?? true,
        resolutionLevels: levels !== undefined && levels.length > 1,
        planeReads: { kind: 'ordered-axis-pairs', pairs: [[xAxisId, yAxisId]] },
      },
    })
  }

  async *readPlane(request: Readonly<ScientificPlaneReadRequest>): AsyncIterable<RasterBlock> {
    const normalized = normalizeScientificPlaneReadRequest(this.descriptor, request)
    if (normalized.displayAxes[0] !== xAxisId || normalized.displayAxes[1] !== yAxisId) {
      throw unsupportedOperation('The fixed-axis adapter can display only the x/y plane')
    }
    const logicalChannel = fixedIndex(normalized, channelAxisId)
    const firstSample = logicalChannel * this.#samplesPerPixel
    const channelSelection =
      this.#samplesPerPixel === 1
        ? firstSample
        : Object.freeze(
            Array.from({ length: this.#samplesPerPixel }, (_, index) => firstSample + index),
          )
    const legacyRequest: RasterPlaneRequest = {
      z: fixedIndex(normalized, zAxisId),
      c: channelSelection,
      t: fixedIndex(normalized, timeAxisId),
      resolutionLevel: normalized.resolutionLevel,
      x: normalized.x,
      y: normalized.y,
      width: normalized.width,
      height: normalized.height,
      ...(normalized.signal === undefined ? {} : { signal: normalized.signal }),
    }
    throwIfAborted(normalized.signal)
    for await (const block of this.source.readPlane(legacyRequest)) {
      throwIfAborted(normalized.signal)
      yield block
    }
  }
}

/** Adapt a fixed XYZCT dataset without changing or materializing its lazy blocks. */
export const toScientificDataset = (
  dataset: MultidimensionalRasterDataset,
  options: Readonly<MultidimensionalRasterAdapterOptions> = {},
): ScientificDataset => new FixedAxisScientificDataset(dataset, options)

const axisById = (
  descriptor: NormalizedScientificDatasetDescriptor,
  id: string,
): ScientificAxisDescriptor | undefined => descriptor.axes.find((axis) => axis.id === id)

const ensureLegacyAxes = (descriptor: NormalizedScientificDatasetDescriptor): void => {
  const allowed = new Set([xAxisId, yAxisId, zAxisId, channelAxisId, timeAxisId])
  const unknown = descriptor.axes.find((axis) => !allowed.has(axis.id))
  if (unknown !== undefined) {
    throw unsupportedOperation(
      `Scientific axis ${unknown.id} cannot be relabeled or flattened into fixed XYZCT dimensions`,
    )
  }
  const x = axisById(descriptor, xAxisId)
  const y = axisById(descriptor, yAxisId)
  if (x?.kind !== 'space' || y?.kind !== 'space') {
    throw unsupportedOperation('Legacy adaptation requires explicit spatial x and y axes')
  }
  const z = axisById(descriptor, zAxisId)
  const channel = axisById(descriptor, channelAxisId)
  const time = axisById(descriptor, timeAxisId)
  if (z !== undefined && z.kind !== 'space') {
    throw unsupportedOperation('Legacy z must be a spatial axis')
  }
  if (channel !== undefined && channel.kind !== 'channel' && channel.kind !== 'spectral') {
    throw unsupportedOperation('Legacy channel must be a channel or spectral axis')
  }
  if (time !== undefined && time.kind !== 'time') {
    throw unsupportedOperation('Legacy time must be a time axis')
  }
  if (descriptor.components.length !== 1) {
    throw unsupportedOperation(
      'A fixed-axis view cannot select one component from a multi-component labeled sample',
    )
  }
}

const physicalSize = (axis: ScientificAxisDescriptor | undefined): PhysicalPixelSize | undefined =>
  axis?.coordinates.type === 'linear'
    ? Object.freeze({
        value: axis.coordinates.step,
        ...(axis.unit === undefined ? {} : { unit: axis.unit }),
      })
    : undefined

const physicalOrigin = (
  axis: ScientificAxisDescriptor | undefined,
): PhysicalPixelSize | undefined =>
  axis?.coordinates.type === 'linear'
    ? Object.freeze({
        value: axis.coordinates.origin,
        ...(axis.unit === undefined ? {} : { unit: axis.unit }),
      })
    : undefined

const legacyChannels = (
  axis: ScientificAxisDescriptor | undefined,
  samplesPerPixel: number,
): readonly RasterChannelInfo[] => {
  const length = axis?.length ?? 1
  return Object.freeze(
    Array.from({ length }, (_, index) => {
      const entry = axis?.entries?.[index]
      return Object.freeze({
        samplesPerPixel,
        ...(entry?.id === undefined ? {} : { id: entry.id }),
        ...(entry?.name === undefined ? {} : { name: entry.name }),
        ...(entry?.unit === undefined ? {} : { unit: entry.unit }),
        ...(entry?.color === undefined ? {} : { color: entry.color }),
        ...(entry?.spectral === undefined ? {} : { spectral: entry.spectral }),
      })
    }),
  )
}

const isMetadataArray = (
  value: ScientificMetadataValue | undefined,
): value is readonly ScientificMetadataValue[] => Array.isArray(value)

const metadataObject = (
  value: ScientificMetadataValue | undefined,
): ScientificMetadataObject | undefined =>
  value !== null && typeof value === 'object' && !isMetadataArray(value) ? value : undefined

const compatibilityMetadata = (
  descriptor: NormalizedScientificDatasetDescriptor,
): ScientificMetadataObject | undefined => metadataObject(descriptor.metadata?.[legacyMetadataKey])

const compatibilityPhysical = (
  compatibility: ScientificMetadataObject | undefined,
  key: string,
): PhysicalPixelSize | undefined => {
  const raw = compatibility?.[key]
  if (raw === undefined) return undefined
  const value = metadataObject(raw)
  if (
    value === undefined ||
    typeof value.value !== 'number' ||
    !Number.isFinite(value.value) ||
    (value.unit !== undefined && typeof value.unit !== 'string')
  ) {
    throw unsupportedOperation(`Legacy ${key} metadata is malformed`)
  }
  return Object.freeze({
    value: value.value,
    ...(value.unit === undefined ? {} : { unit: value.unit }),
  })
}

const compatibilityChannel = (value: ScientificMetadataValue, index: number): RasterChannelInfo => {
  const input = metadataObject(value)
  if (input === undefined || typeof input.samplesPerPixel !== 'number') {
    throw unsupportedOperation(`Legacy channel metadata ${index} is malformed`)
  }
  const samplesPerPixel = positiveDimension(
    input.samplesPerPixel,
    `Legacy channel metadata ${index}.samplesPerPixel`,
  )
  if (input.id !== undefined && typeof input.id !== 'string') {
    throw unsupportedOperation(`Legacy channel metadata ${index}.id is malformed`)
  }
  if (input.name !== undefined && typeof input.name !== 'string') {
    throw unsupportedOperation(`Legacy channel metadata ${index}.name is malformed`)
  }
  if (input.unit !== undefined && typeof input.unit !== 'string') {
    throw unsupportedOperation(`Legacy channel metadata ${index}.unit is malformed`)
  }
  if (input.color !== undefined && typeof input.color !== 'number') {
    throw unsupportedOperation(`Legacy channel metadata ${index}.color is malformed`)
  }
  const spectralInput = metadataObject(input.spectral)
  if (input.spectral !== undefined && spectralInput === undefined) {
    throw unsupportedOperation(`Legacy channel metadata ${index}.spectral is malformed`)
  }
  const spectralCenter = spectralInput?.center
  if (spectralInput !== undefined && typeof spectralCenter !== 'number') {
    throw unsupportedOperation(`Legacy channel metadata ${index}.spectral.center is malformed`)
  }
  if (spectralInput?.unit !== undefined && typeof spectralInput.unit !== 'string') {
    throw unsupportedOperation(`Legacy channel metadata ${index}.spectral.unit is malformed`)
  }
  if (spectralInput?.fwhm !== undefined && typeof spectralInput.fwhm !== 'number') {
    throw unsupportedOperation(`Legacy channel metadata ${index}.spectral.fwhm is malformed`)
  }
  let spectral: RasterChannelInfo['spectral'] | undefined
  if (spectralInput !== undefined && typeof spectralCenter === 'number') {
    spectral = Object.freeze({
      center: spectralCenter,
      ...(spectralInput.unit === undefined ? {} : { unit: spectralInput.unit }),
      ...(spectralInput.fwhm === undefined ? {} : { fwhm: spectralInput.fwhm }),
    })
  }
  return Object.freeze({
    samplesPerPixel,
    ...(input.id === undefined ? {} : { id: input.id }),
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.unit === undefined ? {} : { unit: input.unit }),
    ...(input.color === undefined ? {} : { color: input.color }),
    ...(spectral === undefined ? {} : { spectral }),
  })
}

const compatibilityChannels = (
  compatibility: ScientificMetadataObject | undefined,
  sizeC: number,
): readonly RasterChannelInfo[] | undefined => {
  const input = compatibility?.channels
  if (input === undefined) return undefined
  if (!Array.isArray(input)) throw unsupportedOperation('Legacy channel metadata is malformed')
  const channels = Object.freeze(input.map(compatibilityChannel))
  const total = channels.reduce((sum, channel) => sum + channel.samplesPerPixel, 0)
  if (total !== sizeC) {
    throw unsupportedOperation('Legacy channel metadata does not match the labeled channel axis')
  }
  return channels
}

const sourceMetadata = (
  descriptor: NormalizedScientificDatasetDescriptor,
): Readonly<Record<string, string>> | undefined => {
  if (descriptor.metadata === undefined) return undefined
  const container = descriptor.metadata?.[legacyMetadataKey]
  let value: unknown = descriptor.metadata
  if (container !== undefined) {
    if (Object.keys(descriptor.metadata).length !== 1) {
      throw unsupportedOperation('Legacy adaptation cannot discard additional scientific metadata')
    }
    if (container === null || typeof container !== 'object' || Array.isArray(container)) {
      throw unsupportedOperation('Legacy compatibility metadata is malformed')
    }
    if (!('sourceMetadata' in container)) return undefined
    value = container.sourceMetadata
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw unsupportedOperation('Legacy metadata must be a flat string record')
  }
  const output: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== 'string') {
      throw unsupportedOperation('Legacy metadata must be a flat string record')
    }
    Object.defineProperty(output, key, {
      configurable: false,
      enumerable: true,
      value: entry,
      writable: false,
    })
  }
  return Object.freeze(output)
}

class ScientificFixedAxisDataset implements MultidimensionalRasterDataset {
  readonly sizeX: number
  readonly sizeY: number
  readonly sizeZ: number
  readonly sizeC: number
  readonly sizeT: number
  readonly sampleType
  readonly dimensionOrder: string
  readonly channels: readonly RasterChannelInfo[]
  readonly physicalSizeX?: PhysicalPixelSize
  readonly physicalSizeY?: PhysicalPixelSize
  readonly physicalSizeZ?: PhysicalPixelSize
  readonly originX?: PhysicalPixelSize
  readonly originY?: PhysicalPixelSize
  readonly originZ?: PhysicalPixelSize
  readonly noDataValue?: number
  readonly metadata?: Readonly<Record<string, string>>
  readonly #source: ScientificDataset

  constructor(source: ScientificDataset) {
    ensureLegacyAxes(source.descriptor)
    this.#source = source
    const x = axisById(source.descriptor, xAxisId)
    const y = axisById(source.descriptor, yAxisId)
    const z = axisById(source.descriptor, zAxisId)
    const channel = axisById(source.descriptor, channelAxisId)
    const time = axisById(source.descriptor, timeAxisId)
    const compatibility = compatibilityMetadata(source.descriptor)
    this.sizeX = x?.length ?? 0
    this.sizeY = y?.length ?? 0
    this.sizeZ = z?.length ?? 1
    this.sizeC = channel?.length ?? 1
    this.sizeT = time?.length ?? 1
    this.sampleType = source.descriptor.sampleType
    if (
      compatibility?.dimensionOrder !== undefined &&
      typeof compatibility.dimensionOrder !== 'string'
    ) {
      throw unsupportedOperation('Legacy dimensionOrder metadata is malformed')
    }
    this.dimensionOrder = compatibility?.dimensionOrder ?? 'XYZCT'
    this.channels =
      compatibilityChannels(compatibility, this.sizeC) ??
      legacyChannels(channel, source.descriptor.components.length)
    const physicalX = compatibilityPhysical(compatibility, 'physicalSizeX') ?? physicalSize(x)
    const physicalY = compatibilityPhysical(compatibility, 'physicalSizeY') ?? physicalSize(y)
    const physicalZ = compatibilityPhysical(compatibility, 'physicalSizeZ') ?? physicalSize(z)
    const originX = compatibilityPhysical(compatibility, 'originX') ?? physicalOrigin(x)
    const originY = compatibilityPhysical(compatibility, 'originY') ?? physicalOrigin(y)
    const originZ = compatibilityPhysical(compatibility, 'originZ') ?? physicalOrigin(z)
    const noDataValue = source.descriptor.noDataValue
    const metadata = sourceMetadata(source.descriptor)
    if (physicalX !== undefined) this.physicalSizeX = physicalX
    if (physicalY !== undefined) this.physicalSizeY = physicalY
    if (physicalZ !== undefined) this.physicalSizeZ = physicalZ
    if (originX !== undefined) this.originX = originX
    if (originY !== undefined) this.originY = originY
    if (originZ !== undefined) this.originZ = originZ
    if (noDataValue !== undefined) this.noDataValue = noDataValue
    if (metadata !== undefined) this.metadata = metadata
  }

  async *readPlane(options: Readonly<RasterPlaneRequest>): AsyncIterable<RasterBlock> {
    const zAxis = axisById(this.#source.descriptor, zAxisId)
    const channelAxis = axisById(this.#source.descriptor, channelAxisId)
    const timeAxis = axisById(this.#source.descriptor, timeAxisId)
    if (zAxis === undefined && options.z !== 0) {
      throw invalidInput('Legacy z selection is outside the singleton labeled dimension')
    }
    if (timeAxis === undefined && options.t !== 0) {
      throw invalidInput('Legacy time selection is outside the singleton labeled dimension')
    }
    if (options.c === undefined && this.sizeC > 1) {
      throw unsupportedOperation('A labeled-axis read requires one explicit legacy channel')
    }
    const selectedChannels =
      options.c === undefined ? [0] : typeof options.c === 'number' ? [options.c] : [...options.c]
    if (selectedChannels.length !== 1) {
      throw unsupportedOperation(
        'A labeled-axis dataset can expose only one fixed channel per read',
      )
    }
    const c = selectedChannels[0]
    if (!Number.isSafeInteger(c) || c === undefined || c < 0 || c >= this.sizeC) {
      throw invalidInput('Legacy channel selection is outside the labeled channel axis')
    }
    const fixedIndices = [
      { axisId: zAxisId, index: options.z },
      { axisId: channelAxisId, index: c },
      { axisId: timeAxisId, index: options.t },
    ].filter((selection) =>
      selection.axisId === zAxisId
        ? zAxis !== undefined
        : selection.axisId === channelAxisId
          ? channelAxis !== undefined
          : timeAxis !== undefined,
    )
    yield* this.#source.readPlane({
      displayAxes: [xAxisId, yAxisId],
      fixedIndices,
      ...(options.resolutionLevel === undefined
        ? {}
        : { resolutionLevel: options.resolutionLevel }),
      ...(options.x === undefined ? {} : { x: options.x }),
      ...(options.y === undefined ? {} : { y: options.y }),
      ...(options.width === undefined ? {} : { width: options.width }),
      ...(options.height === undefined ? {} : { height: options.height }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
  }
}

/** Adapt only labeled-axis datasets that truthfully fit the fixed XYZCT model. */
export const toMultidimensionalRasterDataset = (
  dataset: ScientificDataset,
): MultidimensionalRasterDataset =>
  dataset instanceof FixedAxisScientificDataset
    ? dataset.source
    : new ScientificFixedAxisDataset(dataset)
