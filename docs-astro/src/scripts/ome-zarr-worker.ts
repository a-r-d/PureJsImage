import { throwIfAborted } from '../../../src/abort.ts'
import { invalidInput, unsupportedOperation } from '../../../src/errors.ts'
import { rasterSampleBytes } from '../../../src/raster.ts'
import type {
  NormalizedScientificDatasetDescriptor,
  ScientificAxisDescriptor,
  ScientificDataset,
  ScientificMetadataObject,
} from '../../../src/scientific/dataset.ts'
import {
  createOmeZarrHttpContext,
  type OmeZarrHttpStore,
} from '../../../src/scientific/ome-zarr-http.ts'
import type {
  ScientificDatasetSummary,
  ScientificDocument,
} from '../../../src/scientific/reader.ts'
import { createOmeZarrReader } from '../../../src/scientific/readers/ome-zarr.ts'
import { readRasterSample } from '../../../src/scientific/samples.ts'
import {
  compositeOmeZarrSample,
  normalizeOmeZarrSample,
  omeZarrDefaultChannelColor,
  omeZarrDisplayRange,
  omeZarrLabelColor,
  overlayOmeZarrLabel,
} from './ome-zarr-render.ts'
import type {
  OmeZarrAxisMetadata,
  OmeZarrChannelConfiguration,
  OmeZarrChannelHistogram,
  OmeZarrChannelMetadata,
  OmeZarrDatasetMetadata,
  OmeZarrLabelColor,
  OmeZarrLabelMetadata,
  OmeZarrLevelMetadata,
  OmeZarrMetadata,
  OmeZarrRenderConfiguration,
  OmeZarrStats,
  OmeZarrWorkerRequest,
  OmeZarrWorkerResponse,
} from './ome-zarr-types.ts'

interface WorkerScope {
  onmessage: ((event: MessageEvent<OmeZarrWorkerRequest>) => void) | null
  postMessage(message: OmeZarrWorkerResponse, transfer?: readonly Transferable[]): void
}

interface TileJob {
  readonly requestId: number
  readonly generation: number
  readonly level: number
  readonly column: number
  readonly row: number
  readonly controller: AbortController
  readonly openSerial: number
}

interface DisplayAxes {
  readonly horizontal: ScientificAxisDescriptor
  readonly vertical: ScientificAxisDescriptor
  readonly channel?: ScientificAxisDescriptor
}

interface StorageLevel {
  readonly level: number
  readonly path: string
  readonly shape: readonly number[]
  readonly logicalChunkShape: readonly number[]
  readonly storageChunkShape: readonly number[]
  readonly sharded: boolean
  readonly codecs: readonly string[]
  readonly shardIndexLocation?: 'start' | 'end'
}

interface ActiveLabel {
  readonly dataset: ScientificDataset
  readonly axes: DisplayAxes
  readonly metadata: OmeZarrLabelMetadata
}

type UnknownRecord = Readonly<Record<string, unknown>>

const scope = globalThis as unknown as WorkerScope
const controllers = new Map<number, AbortController>()
const tileQueue: TileJob[] = []
const maximumConcurrentDecodes = 2
const maximumViewerTileDimension = 1_024
const maximumMixedChannels = 3
const histogramBins = 64
let activeDecodes = 0
let store: OmeZarrHttpStore | undefined
let document: ScientificDocument | undefined
let dataset: ScientificDataset | undefined
let activeLabel: ActiveLabel | undefined
let metadata: OmeZarrMetadata | undefined
let displayAxes: DisplayAxes | undefined
let configuration: OmeZarrRenderConfiguration | undefined
let storeUrl = ''
let publishedStoreBytes: number | undefined
let openSerial = 0
let configureSerial = 0
let viewportTilesDecoded = 0
let viewportTilesCancelled = 0
let viewportTilesFailed = 0
let decodeMillisecondsTotal = 0
let lastDecodeMilliseconds = 0

const post = (message: OmeZarrWorkerResponse, transfer: readonly Transferable[] = []): void => {
  scope.postMessage(message, transfer)
}

const errorMessage = (cause: unknown): string => {
  if (!(cause instanceof Error)) return 'Unknown OME-Zarr viewer error'
  const nested = cause.cause
  return nested instanceof Error ? `${cause.message}: ${nested.message}` : cause.message
}

const isAbortError = (cause: unknown): boolean =>
  cause instanceof Error && cause.name === 'AbortError'

const currentStats = (): OmeZarrStats => ({
  ...(store?.stats() ?? {
    objectRequests: 0,
    rangeRequests: 0,
    bytesFetched: 0,
    uniqueBytes: 0,
    metadataBytesFetched: 0,
    arrayBytesFetched: 0,
    sourceCacheHits: 0,
    sourceCacheBytes: 0,
    coalescedConsumers: 0,
    abortedConsumers: 0,
    objectsOpened: 0,
  }),
  viewportTilesDecoded,
  viewportTilesCancelled,
  viewportTilesFailed,
  inFlightTileJobs: controllers.size,
  decodeMillisecondsTotal,
  lastDecodeMilliseconds,
})

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const numberArray = (value: unknown, label: string): readonly number[] => {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((entry) => typeof entry !== 'number' || !Number.isSafeInteger(entry) || entry < 0)
  ) {
    throw invalidInput(`${label} is invalid`)
  }
  return Object.freeze(value.map(Number))
}

const stringArray = (value: unknown, label: string): readonly string[] => {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw invalidInput(`${label} is invalid`)
  }
  return Object.freeze([...value])
}

const storageLevels = (
  descriptor: NormalizedScientificDatasetDescriptor,
): readonly StorageLevel[] => {
  const value = descriptor.metadata?.omeZarrLevels
  if (!Array.isArray(value) || value.length !== descriptor.levels.length) {
    throw invalidInput('OME-Zarr storage layout metadata is missing')
  }
  return Object.freeze(
    value.map((entry, index) => {
      if (!isRecord(entry)) throw invalidInput(`OME-Zarr storage level ${index} is invalid`)
      const level = entry.level
      const path = entry.path
      const sharded = entry.sharded
      const shardIndexLocation = entry.shardIndexLocation
      if (
        typeof level !== 'number' ||
        level !== index ||
        typeof path !== 'string' ||
        typeof sharded !== 'boolean' ||
        (shardIndexLocation !== undefined &&
          shardIndexLocation !== 'start' &&
          shardIndexLocation !== 'end')
      ) {
        throw invalidInput(`OME-Zarr storage level ${index} is invalid`)
      }
      return Object.freeze({
        level,
        path,
        shape: numberArray(entry.shape, `OME-Zarr level ${index} shape`),
        logicalChunkShape: numberArray(
          entry.logicalChunkShape,
          `OME-Zarr level ${index} logical chunks`,
        ),
        storageChunkShape: numberArray(
          entry.storageChunkShape,
          `OME-Zarr level ${index} storage chunks`,
        ),
        sharded,
        codecs: stringArray(entry.codecs, `OME-Zarr level ${index} codecs`),
        ...(shardIndexLocation === undefined ? {} : { shardIndexLocation }),
      })
    }),
  )
}

const normalizedAxisName = (axis: ScientificAxisDescriptor): string =>
  (axis.name ?? axis.id).trim().toLowerCase()

const selectDisplayAxes = (descriptor: NormalizedScientificDatasetDescriptor): DisplayAxes => {
  const spatial = descriptor.axes.filter((axis) => axis.kind === 'space')
  const horizontal =
    spatial.find((axis) => normalizedAxisName(axis) === 'x' || axis.id.toLowerCase() === 'x') ??
    spatial.at(-1)
  const vertical =
    spatial.find((axis) => normalizedAxisName(axis) === 'y' || axis.id.toLowerCase() === 'y') ??
    spatial.at(-2)
  if (horizontal === undefined || vertical === undefined || horizontal.id === vertical.id) {
    throw unsupportedOperation('OME-Zarr viewer requires distinct x and y spatial axes')
  }
  const channel = descriptor.axes.find((axis) => axis.kind === 'channel')
  return { horizontal, vertical, ...(channel === undefined ? {} : { channel }) }
}

const isLabelDataset = (summary: ScientificDatasetSummary): boolean =>
  summary.descriptor.metadata?.kind === 'label'

const isDisplayable = (summary: ScientificDatasetSummary): boolean => {
  try {
    selectDisplayAxes(summary.descriptor)
    return summary.descriptor.levels.length > 0
  } catch {
    return false
  }
}

const selectInitialDataset = (opened: ScientificDocument): ScientificDatasetSummary => {
  const selected =
    opened.datasets.find((summary) => !isLabelDataset(summary) && isDisplayable(summary)) ??
    opened.datasets.find(isDisplayable)
  if (selected === undefined) {
    throw unsupportedOperation('This store has no image dataset with displayable x and y axes')
  }
  return selected
}

const axisLength = (
  descriptor: NormalizedScientificDatasetDescriptor,
  level: number,
  axisId: string,
): number => {
  const found = descriptor.levels[level]?.axisLengths.find((entry) => entry.axisId === axisId)
  if (found === undefined || found.length < 1) {
    throw invalidInput(`OME-Zarr level ${level} is missing axis ${axisId}`)
  }
  return found.length
}

const axisMetadata = (axis: ScientificAxisDescriptor): OmeZarrAxisMetadata => {
  const coordinates = axis.coordinates
  const shared = {
    id: axis.id,
    name: axis.name ?? axis.id,
    kind: axis.kind,
    length: axis.length,
    ...(axis.unit === undefined ? {} : { unit: axis.unit }),
    coordinateType: coordinates.type,
  }
  if (coordinates.type === 'linear') {
    return Object.freeze({ ...shared, origin: coordinates.origin, step: coordinates.step })
  }
  if (coordinates.type === 'lookup' || coordinates.type === 'labels') {
    return Object.freeze({ ...shared, values: Object.freeze([...coordinates.values]) })
  }
  return Object.freeze(shared)
}

const displayRange = (descriptor: NormalizedScientificDatasetDescriptor) =>
  omeZarrDisplayRange(descriptor.sampleType) ?? { minimum: 0, maximum: 1 }

const channelsFor = (
  descriptor: NormalizedScientificDatasetDescriptor,
  axes: DisplayAxes,
): readonly OmeZarrChannelMetadata[] => {
  const range = displayRange(descriptor)
  const count = axes.channel?.length ?? 1
  const display = isRecord(descriptor.metadata?.omeZarrDisplay)
    ? descriptor.metadata.omeZarrDisplay
    : undefined
  const authoredChannels = Array.isArray(display?.channels) ? display.channels : []
  return Object.freeze(
    Array.from({ length: count }, (_, index) => {
      const entry = axes.channel?.entries?.[index]
      const authored = isRecord(authoredChannels[index]) ? authoredChannels[index] : undefined
      const window = isRecord(authored?.window) ? authored.window : undefined
      const authoredStart =
        typeof window?.start === 'number' && Number.isFinite(window.start)
          ? window.start
          : undefined
      const authoredEnd =
        typeof window?.end === 'number' && Number.isFinite(window.end) ? window.end : undefined
      const useAuthoredWindow =
        authoredStart !== undefined && authoredEnd !== undefined && authoredEnd > authoredStart
      const minimum = useAuthoredWindow ? authoredStart : range.minimum
      const maximum = useAuthoredWindow ? authoredEnd : range.maximum
      return Object.freeze({
        index,
        id: entry?.id ?? (axes.channel === undefined ? 'value' : `channel-${index}`),
        name: entry?.name ?? (axes.channel === undefined ? 'Value' : `Channel ${index}`),
        color: entry?.color ?? omeZarrDefaultChannelColor(index, count),
        minimum,
        maximum,
        ...(typeof authored?.active === 'boolean' ? { active: authored.active } : {}),
        ...(typeof authored?.coefficient === 'number' && Number.isFinite(authored.coefficient)
          ? { coefficient: authored.coefficient }
          : {}),
        ...(typeof authored?.family === 'string' ? { family: authored.family } : {}),
        ...(typeof authored?.inverted === 'boolean' ? { inverted: authored.inverted } : {}),
      })
    }),
  )
}

const numericField = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined

const stringField = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined

const datasetCatalog = (opened: ScientificDocument): readonly OmeZarrDatasetMetadata[] =>
  Object.freeze(
    opened.datasets.map((summary) => {
      const metadata = summary.descriptor.metadata
      const well = isRecord(metadata?.well) ? metadata.well : undefined
      const imageLabel = isRecord(metadata?.imageLabel) ? metadata.imageLabel : undefined
      return Object.freeze({
        id: summary.id,
        name: summary.name,
        kind: isLabelDataset(summary) ? 'label' : 'image',
        displayable: isDisplayable(summary),
        ...(stringField(well?.path) === undefined ? {} : { wellPath: stringField(well?.path) }),
        ...(stringField(well?.field) === undefined ? {} : { field: stringField(well?.field) }),
        ...(numericField(well?.rowIndex) === undefined
          ? {}
          : { rowIndex: numericField(well?.rowIndex) }),
        ...(numericField(well?.columnIndex) === undefined
          ? {}
          : { columnIndex: numericField(well?.columnIndex) }),
        ...(numericField(well?.acquisition) === undefined
          ? {}
          : { acquisition: numericField(well?.acquisition) }),
        ...(stringField(imageLabel?.sourceImage) === undefined
          ? {}
          : { sourceImage: stringField(imageLabel?.sourceImage) }),
      }) as OmeZarrDatasetMetadata
    }),
  )

const labelColors = (
  metadata: ScientificMetadataObject | undefined,
): readonly OmeZarrLabelColor[] => {
  const imageLabel = isRecord(metadata?.imageLabel) ? metadata.imageLabel : undefined
  if (!Array.isArray(imageLabel?.colors)) return Object.freeze([])
  const colors: OmeZarrLabelColor[] = []
  for (const entry of imageLabel.colors) {
    if (!isRecord(entry) || typeof entry.value !== 'number' || !Array.isArray(entry.rgba)) continue
    if (entry.rgba.length !== 4 || entry.rgba.some((value) => typeof value !== 'number')) continue
    const rgba = entry.rgba as readonly number[]
    colors.push({
      value: entry.value,
      rgba: [rgba[0] ?? 0, rgba[1] ?? 0, rgba[2] ?? 0, rgba[3] ?? 255],
    })
  }
  return Object.freeze(colors)
}

const labelCompatible = (
  base: NormalizedScientificDatasetDescriptor,
  baseAxes: DisplayAxes,
  label: NormalizedScientificDatasetDescriptor,
): boolean => {
  try {
    const axes = selectDisplayAxes(label)
    return base.levels.every((_, level) => {
      const width = axisLength(base, level, baseAxes.horizontal.id)
      const height = axisLength(base, level, baseAxes.vertical.id)
      return label.levels.some(
        (_entry, labelLevel) =>
          axisLength(label, labelLevel, axes.horizontal.id) === width &&
          axisLength(label, labelLevel, axes.vertical.id) === height,
      )
    })
  } catch {
    return false
  }
}

const labelCatalog = (
  opened: ScientificDocument,
  base: NormalizedScientificDatasetDescriptor,
  axes: DisplayAxes,
): readonly OmeZarrLabelMetadata[] =>
  Object.freeze(
    opened.datasets.filter(isLabelDataset).map((summary) => {
      const imageLabel = isRecord(summary.descriptor.metadata?.imageLabel)
        ? summary.descriptor.metadata.imageLabel
        : undefined
      return Object.freeze({
        datasetId: summary.id,
        name: summary.name,
        ...(stringField(imageLabel?.sourceImage) === undefined
          ? {}
          : { sourceImage: stringField(imageLabel?.sourceImage) }),
        colors: labelColors(summary.descriptor.metadata),
        compatible: labelCompatible(base, axes, summary.descriptor),
      }) as OmeZarrLabelMetadata
    }),
  )

const storeName = (url: string): string => {
  const path = new URL(url).pathname.replace(/\/+$/u, '')
  return decodeURIComponent(path.slice(path.lastIndexOf('/') + 1)) || 'OME-Zarr store'
}

const buildMetadata = (
  datasetId: string,
  datasetName: string,
  descriptor: NormalizedScientificDatasetDescriptor,
  axes: DisplayAxes,
  opened: ScientificDocument,
): OmeZarrMetadata => {
  const storage = storageLevels(descriptor)
  const baseWidth = axisLength(descriptor, 0, axes.horizontal.id)
  const baseHeight = axisLength(descriptor, 0, axes.vertical.id)
  const horizontalIndex = descriptor.axes.findIndex((axis) => axis.id === axes.horizontal.id)
  const verticalIndex = descriptor.axes.findIndex((axis) => axis.id === axes.vertical.id)
  const levels: OmeZarrLevelMetadata[] = storage.map((entry, index) => {
    const width = axisLength(descriptor, index, axes.horizontal.id)
    const height = axisLength(descriptor, index, axes.vertical.id)
    const downsampleX = baseWidth / width
    const downsampleY = baseHeight / height
    const naturalWidth = entry.logicalChunkShape[horizontalIndex] ?? 0
    const naturalHeight = entry.logicalChunkShape[verticalIndex] ?? 0
    if (naturalWidth < 1 || naturalHeight < 1) {
      throw invalidInput(`OME-Zarr level ${index} has no displayable logical chunk size`)
    }
    return Object.freeze({
      index,
      path: entry.path,
      width,
      height,
      downsample: Math.max(downsampleX, downsampleY),
      downsampleX,
      downsampleY,
      tileWidth: Math.min(maximumViewerTileDimension, naturalWidth),
      tileHeight: Math.min(maximumViewerTileDimension, naturalHeight),
      logicalChunkShape: entry.logicalChunkShape,
      storageChunkShape: entry.storageChunkShape,
      sharded: entry.sharded,
      codecs: entry.codecs,
      ...(entry.shardIndexLocation === undefined
        ? {}
        : { shardIndexLocation: entry.shardIndexLocation }),
    })
  })
  const omeNgffVersion = opened.metadata.omeNgffVersion
  const zarrFormat = opened.metadata.zarrFormat
  if (typeof omeNgffVersion !== 'string' || typeof zarrFormat !== 'number') {
    throw invalidInput('OME-Zarr document version metadata is missing')
  }
  const plateValue = isRecord(opened.metadata.plate) ? opened.metadata.plate : undefined
  const wellCount = numericField(plateValue?.wellCount)
  const plateName = stringField(plateValue?.name)
  const display = isRecord(descriptor.metadata?.omeZarrDisplay)
    ? descriptor.metadata.omeZarrDisplay
    : undefined
  const rdefs = isRecord(display?.rdefs) ? display.rdefs : undefined
  const defaultT = numericField(rdefs?.defaultT)
  const defaultZ = numericField(rdefs?.defaultZ)
  const rawModel = rdefs?.model
  const model: 'color' | 'greyscale' | undefined =
    rawModel === 'color' || rawModel === 'greyscale' ? rawModel : undefined
  return Object.freeze({
    url: storeUrl,
    name: storeName(storeUrl),
    datasetId,
    datasetName,
    ...(publishedStoreBytes === undefined ? {} : { publishedStoreBytes }),
    width: baseWidth,
    height: baseHeight,
    axes: Object.freeze(descriptor.axes.map(axisMetadata)),
    channels: channelsFor(descriptor, axes),
    levels: Object.freeze(levels),
    datasets: datasetCatalog(opened),
    labels: labelCatalog(opened, descriptor, axes),
    ...(wellCount === undefined
      ? {}
      : {
          plate: {
            ...(plateName === undefined ? {} : { name: plateName }),
            wellCount,
          },
        }),
    omeNgffVersion,
    zarrFormat,
    sampleType: descriptor.sampleType,
    ...(defaultT === undefined && defaultZ === undefined && model === undefined
      ? {}
      : {
          displayDefaults: {
            ...(defaultT === undefined ? {} : { defaultT }),
            ...(defaultZ === undefined ? {} : { defaultZ }),
            ...(model === undefined ? {} : { model }),
          },
        }),
  })
}

const defaultConfiguration = (
  activeMetadata: OmeZarrMetadata,
  axes: DisplayAxes,
): OmeZarrRenderConfiguration => {
  const channelAxis = activeMetadata.axes.find((axis) => axis.kind === 'channel')
  const grayscale = activeMetadata.displayDefaults?.model === 'greyscale'
  let enabledChannels = 0
  const configuredChannels = activeMetadata.channels.map((channel) => {
    const enabled = (channel.active ?? true) && enabledChannels < maximumMixedChannels
    if (enabled) enabledChannels += 1
    return {
      index: channel.index,
      enabled,
      color: grayscale ? 0xffffff : channel.color,
      minimum: channel.minimum,
      maximum: channel.maximum,
      gamma: 1,
      coefficient: channel.coefficient ?? 1,
      inverted: channel.inverted ?? false,
    }
  })
  if (
    !configuredChannels.some((channel) => channel.enabled) &&
    configuredChannels[0] !== undefined
  ) {
    configuredChannels[0] = { ...configuredChannels[0], enabled: true }
  }
  return Object.freeze({
    generation: 1,
    datasetId: activeMetadata.datasetId,
    fixedIndices: Object.freeze(
      activeMetadata.axes
        .filter(
          (axis) =>
            axis.id !== axes.horizontal.id &&
            axis.id !== axes.vertical.id &&
            axis.id !== channelAxis?.id,
        )
        .map((axis) => ({
          axisId: axis.id,
          index:
            axis.id.toLowerCase() === 't'
              ? (activeMetadata.displayDefaults?.defaultT ?? 0)
              : axis.id.toLowerCase() === 'z'
                ? (activeMetadata.displayDefaults?.defaultZ ?? 0)
                : 0,
        })),
    ),
    channels: Object.freeze(configuredChannels.map((channel) => Object.freeze(channel))),
  })
}

const invalidateJobs = (): void => {
  for (const controller of controllers.values()) controller.abort()
  tileQueue.length = 0
  controllers.clear()
}

const closeCurrent = (): void => {
  invalidateJobs()
  controllers.clear()
  store?.close()
  document?.close?.()
  store = undefined
  document = undefined
  dataset = undefined
  activeLabel = undefined
  metadata = undefined
  displayAxes = undefined
  configuration = undefined
}

const openStore = async (url: string, nextPublishedStoreBytes?: number): Promise<void> => {
  openSerial += 1
  configureSerial += 1
  const serial = openSerial
  closeCurrent()
  viewportTilesDecoded = 0
  viewportTilesCancelled = 0
  viewportTilesFailed = 0
  decodeMillisecondsTotal = 0
  lastDecodeMilliseconds = 0
  storeUrl = url
  publishedStoreBytes =
    nextPublishedStoreBytes !== undefined &&
    Number.isSafeInteger(nextPublishedStoreBytes) &&
    nextPublishedStoreBytes > 0
      ? nextPublishedStoreBytes
      : undefined
  post({ type: 'opening', message: 'Reading OME-NGFF metadata and array layouts…' })
  let nextStore: OmeZarrHttpStore | undefined
  try {
    const context = await createOmeZarrHttpContext(url, {
      maxCacheBytesPerSource: 8_388_608,
      maxOpenSources: 8,
    })
    nextStore = context.store
    store = nextStore
    const reader = createOmeZarrReader({
      limits: { rowsPerBlock: 1_024 },
      metadataValidation: 'compatible',
    })
    const opened = await reader.open(context)
    const selected = selectInitialDataset(opened)
    const openedDataset = await opened.openDataset(
      selected.id,
      context.signal === undefined ? {} : { signal: context.signal },
    )
    const axes = selectDisplayAxes(openedDataset.descriptor)
    const openedMetadata = buildMetadata(
      selected.id,
      selected.name ?? selected.id,
      openedDataset.descriptor,
      axes,
      opened,
    )
    if (serial !== openSerial) {
      opened.close?.()
      nextStore.close()
      return
    }
    document = opened
    dataset = openedDataset
    displayAxes = axes
    metadata = openedMetadata
    configuration = defaultConfiguration(openedMetadata, axes)
    post({ type: 'opened', metadata: openedMetadata, configuration, stats: currentStats() })
  } catch (cause) {
    if (serial !== openSerial || isAbortError(cause)) return
    nextStore?.close()
    if (store === nextStore) store = undefined
    post({ type: 'error', message: errorMessage(cause), stats: currentStats() })
  }
}

const validateChannelConfiguration = (
  channel: OmeZarrChannelConfiguration,
  channelCount: number,
): void => {
  if (
    !Number.isSafeInteger(channel.index) ||
    channel.index < 0 ||
    channel.index >= channelCount ||
    !Number.isSafeInteger(channel.color) ||
    channel.color < 0 ||
    channel.color > 0xff_ffff ||
    !Number.isFinite(channel.minimum) ||
    !Number.isFinite(channel.maximum) ||
    channel.maximum <= channel.minimum ||
    !Number.isFinite(channel.gamma) ||
    channel.gamma < 0.05 ||
    channel.gamma > 10 ||
    !Number.isFinite(channel.coefficient) ||
    channel.coefficient < 0
  ) {
    throw invalidInput(`Channel ${channel.index} configuration is invalid`)
  }
}

const configureViewer = async (next: OmeZarrRenderConfiguration): Promise<void> => {
  const opened = document
  if (opened === undefined) throw invalidInput('Open a store before configuring the viewer')
  if (!Number.isSafeInteger(next.generation) || next.generation < 1) {
    throw invalidInput('Viewer generation is invalid')
  }
  configureSerial += 1
  const serial = configureSerial
  invalidateJobs()
  const summary = opened.datasets.find(
    (candidate) => candidate.id === next.datasetId && !isLabelDataset(candidate),
  )
  if (summary === undefined || !isDisplayable(summary)) {
    throw invalidInput(`OME-Zarr image dataset ${next.datasetId} is not displayable`)
  }
  const nextDataset = await opened.openDataset(summary.id)
  const axes = selectDisplayAxes(nextDataset.descriptor)
  const nextMetadata = buildMetadata(
    summary.id,
    summary.name ?? summary.id,
    nextDataset.descriptor,
    axes,
    opened,
  )
  const fixedByAxis = new Map(next.fixedIndices.map((entry) => [entry.axisId, entry.index]))
  const fixedAxes = nextDataset.descriptor.axes.filter(
    (axis) =>
      axis.id !== axes.horizontal.id &&
      axis.id !== axes.vertical.id &&
      axis.id !== axes.channel?.id,
  )
  if (fixedByAxis.size !== next.fixedIndices.length || fixedByAxis.size !== fixedAxes.length) {
    throw invalidInput('Fixed-axis configuration does not match this dataset')
  }
  for (const axis of fixedAxes) {
    const index = fixedByAxis.get(axis.id)
    if (index === undefined || !Number.isSafeInteger(index) || index < 0 || index >= axis.length) {
      throw invalidInput(`Axis ${axis.id} index is invalid`)
    }
  }
  if (next.channels.length !== nextMetadata.channels.length) {
    throw invalidInput('Channel configuration does not match this dataset')
  }
  const seenChannels = new Set<number>()
  let enabledChannels = 0
  for (const channel of next.channels) {
    validateChannelConfiguration(channel, nextMetadata.channels.length)
    if (seenChannels.has(channel.index)) throw invalidInput(`Channel ${channel.index} is repeated`)
    seenChannels.add(channel.index)
    if (channel.enabled) enabledChannels += 1
  }
  if (enabledChannels < 1 || enabledChannels > maximumMixedChannels) {
    throw invalidInput(`Enable between one and ${maximumMixedChannels} channels`)
  }
  let nextLabel: ActiveLabel | undefined
  if (next.label !== undefined) {
    if (!Number.isFinite(next.label.opacity) || next.label.opacity < 0 || next.label.opacity > 1) {
      throw invalidInput('Label opacity is invalid')
    }
    const labelMetadata = nextMetadata.labels.find(
      (candidate) => candidate.datasetId === next.label?.datasetId && candidate.compatible,
    )
    if (labelMetadata === undefined) throw invalidInput('Selected label overlay is not compatible')
    const labelDataset = await opened.openDataset(labelMetadata.datasetId)
    nextLabel = {
      dataset: labelDataset,
      axes: selectDisplayAxes(labelDataset.descriptor),
      metadata: labelMetadata,
    }
  }
  if (serial !== configureSerial) return
  dataset = nextDataset
  displayAxes = axes
  metadata = nextMetadata
  configuration = Object.freeze({
    ...next,
    fixedIndices: Object.freeze(next.fixedIndices.map((entry) => Object.freeze({ ...entry }))),
    channels: Object.freeze(next.channels.map((entry) => Object.freeze({ ...entry }))),
    ...(next.label === undefined ? {} : { label: Object.freeze({ ...next.label }) }),
  })
  activeLabel = nextLabel
  post({ type: 'configured', metadata: nextMetadata, configuration, stats: currentStats() })
}

const selectViewerDataset = async (datasetId: string, generation: number): Promise<void> => {
  const opened = document
  if (opened === undefined) throw invalidInput('Open a store before selecting a dataset')
  configureSerial += 1
  const serial = configureSerial
  invalidateJobs()
  const summary = opened.datasets.find(
    (candidate) => candidate.id === datasetId && !isLabelDataset(candidate),
  )
  if (summary === undefined || !isDisplayable(summary)) {
    throw invalidInput(`OME-Zarr image dataset ${datasetId} is not displayable`)
  }
  const selected = await opened.openDataset(summary.id)
  if (serial !== configureSerial) return
  const axes = selectDisplayAxes(selected.descriptor)
  const selectedMetadata = buildMetadata(
    summary.id,
    summary.name ?? summary.id,
    selected.descriptor,
    axes,
    opened,
  )
  const defaults = defaultConfiguration(selectedMetadata, axes)
  await configureViewer({ ...defaults, generation })
}

const histogramFor = (channel: OmeZarrChannelConfiguration): OmeZarrChannelHistogram => ({
  channel: channel.index,
  minimum: Number.POSITIVE_INFINITY,
  maximum: Number.NEGATIVE_INFINITY,
  finiteSamples: 0,
  bins: new Array<number>(histogramBins).fill(0),
})

const decodeChannel = async (
  activeDataset: ScientificDataset,
  activeMetadata: OmeZarrMetadata,
  axes: DisplayAxes,
  activeConfiguration: OmeZarrRenderConfiguration,
  channel: OmeZarrChannelConfiguration,
  level: number,
  x: number,
  y: number,
  width: number,
  height: number,
  rgba: Uint8ClampedArray,
  signal: AbortSignal,
): Promise<OmeZarrChannelHistogram> => {
  const sampleType = activeMetadata.sampleType
  const sampleBytes = rasterSampleBytes(sampleType)
  const histogram = histogramFor(channel)
  const bins = histogram.bins as number[]
  let minimum = Number.POSITIVE_INFINITY
  let maximum = Number.NEGATIVE_INFINITY
  let finiteSamples = 0
  const fixedIndices = activeDataset.descriptor.axes
    .filter((axis) => axis.id !== axes.horizontal.id && axis.id !== axes.vertical.id)
    .map((axis) => ({
      axisId: axis.id,
      index:
        axes.channel !== undefined && axis.id === axes.channel.id
          ? channel.index
          : (activeConfiguration.fixedIndices.find((entry) => entry.axisId === axis.id)?.index ??
            0),
    }))
  const color: readonly [number, number, number] = [
    (channel.color >>> 16) & 255,
    (channel.color >>> 8) & 255,
    channel.color & 255,
  ]
  for await (const block of activeDataset.readPlane({
    displayAxes: [axes.horizontal.id, axes.vertical.id],
    fixedIndices,
    resolutionLevel: level,
    x,
    y,
    width,
    height,
    signal,
  })) {
    try {
      throwIfAborted(signal)
      if (block.format.channels !== 1) {
        throw unsupportedOperation('OME-Zarr viewer expects scalar channel planes')
      }
      const view = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength)
      const localBlockX = block.x - x
      const localBlockY = block.y - y
      for (let blockY = 0; blockY < block.height; blockY += 1) {
        const localY = localBlockY + blockY
        for (let blockX = 0; blockX < block.width; blockX += 1) {
          const localX = localBlockX + blockX
          if (localX < 0 || localY < 0 || localX >= width || localY >= height) {
            throw invalidInput('OME-Zarr plane block lies outside the requested viewport tile')
          }
          const value = readRasterSample(
            block.data,
            view,
            blockY * block.stride + blockX * sampleBytes,
            sampleType,
          )
          if (Number.isFinite(value)) {
            minimum = Math.min(minimum, value)
            maximum = Math.max(maximum, value)
            finiteSamples += 1
            const normalized = Math.min(
              1,
              Math.max(0, (value - channel.minimum) / (channel.maximum - channel.minimum)),
            )
            const bin = Math.min(histogramBins - 1, Math.floor(normalized * histogramBins))
            bins[bin] = (bins[bin] ?? 0) + 1
          }
          const displayValue = normalizeOmeZarrSample(
            value,
            channel.minimum,
            channel.maximum,
            channel.gamma,
          )
          compositeOmeZarrSample(
            rgba,
            localY * width + localX,
            (channel.inverted ? 1 - displayValue : displayValue) * channel.coefficient,
            color,
          )
        }
      }
    } finally {
      block.release?.()
    }
  }
  return Object.freeze({
    channel: channel.index,
    minimum: finiteSamples === 0 ? channel.minimum : minimum,
    maximum: finiteSamples === 0 ? channel.maximum : maximum,
    finiteSamples,
    bins: Object.freeze(bins),
  })
}

const labelLevelFor = (label: ActiveLabel, width: number, height: number): number | undefined =>
  label.dataset.descriptor.levels.findIndex(
    (_entry, level) =>
      axisLength(label.dataset.descriptor, level, label.axes.horizontal.id) === width &&
      axisLength(label.dataset.descriptor, level, label.axes.vertical.id) === height,
  )

const decodeLabel = async (
  label: ActiveLabel,
  activeConfiguration: OmeZarrRenderConfiguration,
  opacity: number,
  baseLevel: OmeZarrLevelMetadata,
  x: number,
  y: number,
  width: number,
  height: number,
  rgba: Uint8ClampedArray,
  signal: AbortSignal,
): Promise<void> => {
  const level = labelLevelFor(label, baseLevel.width, baseLevel.height)
  if (level === undefined || level < 0) return
  const sampleType = label.dataset.descriptor.sampleType
  const sampleBytes = rasterSampleBytes(sampleType)
  const fixedIndices = label.dataset.descriptor.axes
    .filter((axis) => axis.id !== label.axes.horizontal.id && axis.id !== label.axes.vertical.id)
    .map((axis) => ({
      axisId: axis.id,
      index: Math.min(
        axis.length - 1,
        activeConfiguration.fixedIndices.find((entry) => entry.axisId === axis.id)?.index ?? 0,
      ),
    }))
  const colors = new Map(label.metadata.colors.map((entry) => [entry.value, entry.rgba] as const))
  for await (const block of label.dataset.readPlane({
    displayAxes: [label.axes.horizontal.id, label.axes.vertical.id],
    fixedIndices,
    resolutionLevel: level,
    x,
    y,
    width,
    height,
    signal,
  })) {
    try {
      throwIfAborted(signal)
      const view = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength)
      const localBlockX = block.x - x
      const localBlockY = block.y - y
      for (let blockY = 0; blockY < block.height; blockY += 1) {
        const localY = localBlockY + blockY
        for (let blockX = 0; blockX < block.width; blockX += 1) {
          const localX = localBlockX + blockX
          if (localX < 0 || localY < 0 || localX >= width || localY >= height) {
            throw invalidInput('OME-Zarr label block lies outside the requested viewport tile')
          }
          const value = readRasterSample(
            block.data,
            view,
            blockY * block.stride + blockX * sampleBytes,
            sampleType,
          )
          if (value === 0 || !Number.isSafeInteger(value)) continue
          const pixel = localY * width + localX
          overlayOmeZarrLabel(rgba, pixel, omeZarrLabelColor(value, colors), opacity)
        }
      }
    } finally {
      block.release?.()
    }
  }
}

const decodeTile = async (job: TileJob): Promise<void> => {
  const activeDataset = dataset
  const activeMetadata = metadata
  const axes = displayAxes
  const activeConfiguration = configuration
  const level = activeMetadata?.levels[job.level]
  if (
    activeDataset === undefined ||
    activeMetadata === undefined ||
    axes === undefined ||
    activeConfiguration === undefined ||
    !level ||
    job.generation !== activeConfiguration.generation
  ) {
    controllers.delete(job.requestId)
    post({
      type: 'tile-cancelled',
      requestId: job.requestId,
      generation: job.generation,
      stats: currentStats(),
    })
    return
  }
  const x = job.column * level.tileWidth
  const y = job.row * level.tileHeight
  const width = Math.min(level.tileWidth, level.width - x)
  const height = Math.min(level.tileHeight, level.height - y)
  if (width < 1 || height < 1) {
    controllers.delete(job.requestId)
    post({
      type: 'error',
      requestId: job.requestId,
      generation: job.generation,
      message: 'Viewport tile is outside the level',
    })
    return
  }
  const started = performance.now()
  try {
    throwIfAborted(job.controller.signal)
    const rgba = new Uint8ClampedArray(width * height * 4)
    for (let pixel = 0; pixel < width * height; pixel += 1) rgba[pixel * 4 + 3] = 255
    const histograms: OmeZarrChannelHistogram[] = []
    for (const channel of activeConfiguration.channels.filter((entry) => entry.enabled)) {
      histograms.push(
        await decodeChannel(
          activeDataset,
          activeMetadata,
          axes,
          activeConfiguration,
          channel,
          job.level,
          x,
          y,
          width,
          height,
          rgba,
          job.controller.signal,
        ),
      )
    }
    if (activeLabel !== undefined && activeConfiguration.label !== undefined) {
      await decodeLabel(
        activeLabel,
        activeConfiguration,
        activeConfiguration.label.opacity,
        level,
        x,
        y,
        width,
        height,
        rgba,
        job.controller.signal,
      )
    }
    throwIfAborted(job.controller.signal)
    const bitmap = await createImageBitmap(new ImageData(rgba, width, height))
    controllers.delete(job.requestId)
    if (
      job.openSerial !== openSerial ||
      job.generation !== configuration?.generation ||
      job.controller.signal.aborted
    ) {
      bitmap.close()
      return
    }
    lastDecodeMilliseconds = performance.now() - started
    decodeMillisecondsTotal += lastDecodeMilliseconds
    viewportTilesDecoded += 1
    post(
      {
        type: 'tile',
        requestId: job.requestId,
        generation: job.generation,
        level: job.level,
        column: job.column,
        row: job.row,
        width,
        height,
        decodeMilliseconds: lastDecodeMilliseconds,
        histograms: Object.freeze(histograms),
        bitmap,
        stats: currentStats(),
      },
      [bitmap],
    )
  } catch (cause) {
    controllers.delete(job.requestId)
    if (job.openSerial !== openSerial) return
    if (isAbortError(cause)) {
      viewportTilesCancelled += 1
      post({
        type: 'tile-cancelled',
        requestId: job.requestId,
        generation: job.generation,
        stats: currentStats(),
      })
      return
    }
    viewportTilesFailed += 1
    post({
      type: 'error',
      requestId: job.requestId,
      generation: job.generation,
      message: errorMessage(cause),
      stats: currentStats(),
    })
  }
}

const pumpTileQueue = (): void => {
  while (activeDecodes < maximumConcurrentDecodes && tileQueue.length > 0) {
    const job = tileQueue.shift()
    if (job === undefined) break
    activeDecodes += 1
    void decodeTile(job).finally(() => {
      activeDecodes -= 1
      pumpTileQueue()
    })
  }
}

scope.onmessage = (event): void => {
  const message = event.data
  if (message.type === 'open') {
    void openStore(message.url, message.publishedStoreBytes)
    return
  }
  if (message.type === 'configure') {
    void configureViewer(message.configuration).catch((cause: unknown) => {
      post({
        type: 'error',
        generation: message.configuration.generation,
        message: errorMessage(cause),
        stats: currentStats(),
      })
    })
    return
  }
  if (message.type === 'select-dataset') {
    void selectViewerDataset(message.datasetId, message.generation).catch((cause: unknown) => {
      post({
        type: 'error',
        generation: message.generation,
        message: errorMessage(cause),
        stats: currentStats(),
      })
    })
    return
  }
  if (message.type === 'tile') {
    const controller = new AbortController()
    controllers.set(message.requestId, controller)
    tileQueue.push({
      requestId: message.requestId,
      generation: message.generation,
      level: message.level,
      column: message.column,
      row: message.row,
      controller,
      openSerial,
    })
    pumpTileQueue()
    return
  }
  if (message.type === 'cancel') {
    controllers.get(message.requestId)?.abort()
    return
  }
  if (message.type === 'reset') {
    store?.resetStats()
    viewportTilesDecoded = 0
    viewportTilesCancelled = 0
    viewportTilesFailed = 0
    decodeMillisecondsTotal = 0
    lastDecodeMilliseconds = 0
    post({ type: 'stats', stats: currentStats() })
    return
  }
  post({ type: 'stats', stats: currentStats() })
}
