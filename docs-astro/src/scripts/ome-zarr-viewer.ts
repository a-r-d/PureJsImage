import type {
  OmeZarrChannelConfiguration,
  OmeZarrChannelHistogram,
  OmeZarrLevelMetadata,
  OmeZarrMetadata,
  OmeZarrRenderConfiguration,
  OmeZarrStats,
  OmeZarrWorkerRequest,
  OmeZarrWorkerResponse,
} from './ome-zarr-types.ts'

type ElementConstructor<ElementType extends Element> = new () => ElementType
const requiredElement = <ElementType extends Element>(
  id: string,
  Constructor: ElementConstructor<ElementType>,
): ElementType => {
  const candidate = document.getElementById(id)
  if (!(candidate instanceof Constructor))
    throw new Error(`OME-Zarr demo element #${id} is missing`)
  return candidate
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const parseChannelConfiguration = (entry: unknown): OmeZarrChannelConfiguration | undefined => {
  if (!isRecord(entry)) return undefined
  const coefficient = entry.coefficient === undefined ? 1 : entry.coefficient
  const inverted = entry.inverted === undefined ? false : entry.inverted
  if (
    typeof entry.index !== 'number' ||
    !Number.isSafeInteger(entry.index) ||
    typeof entry.enabled !== 'boolean' ||
    typeof entry.color !== 'number' ||
    !Number.isSafeInteger(entry.color) ||
    entry.color < 0 ||
    entry.color > 0xff_ffff ||
    typeof entry.minimum !== 'number' ||
    !Number.isFinite(entry.minimum) ||
    typeof entry.maximum !== 'number' ||
    !Number.isFinite(entry.maximum) ||
    typeof entry.gamma !== 'number' ||
    !Number.isFinite(entry.gamma) ||
    typeof coefficient !== 'number' ||
    !Number.isFinite(coefficient) ||
    typeof inverted !== 'boolean'
  ) {
    return undefined
  }
  return Object.freeze({
    index: entry.index,
    enabled: entry.enabled,
    color: entry.color,
    minimum: entry.minimum,
    maximum: entry.maximum,
    gamma: entry.gamma,
    coefficient,
    inverted,
  })
}

interface CachedTile {
  readonly key: string
  readonly generation: number
  readonly level: number
  readonly column: number
  readonly row: number
  readonly width: number
  readonly height: number
  readonly bitmap: ImageBitmap
}

interface RequestedTile {
  readonly requestId: number
  readonly key: string
  readonly generation: number
  readonly level: number
  readonly column: number
  readonly row: number
}

interface VisibleTile {
  readonly key: string
  readonly level: OmeZarrLevelMetadata
  readonly column: number
  readonly row: number
}

interface Point {
  readonly x: number
  readonly y: number
}

type RequestVisualState = 'pending' | 'decoded' | 'cancelled' | 'failed'
type LoadingPhase = 'opening' | 'viewport' | 'idle' | 'error'

interface RequestVisual {
  readonly requestId: number
  readonly label: string
  readonly started: number
  state: RequestVisualState
  milliseconds?: number
}

interface HistogramAggregate {
  bins: number[]
  minimum: number
  maximum: number
  finiteSamples: number
}

const canvas = requiredElement('ome-zarr-canvas', HTMLCanvasElement)
const context = canvas.getContext('2d', { alpha: false })
if (context === null) throw new Error('This browser does not provide a 2D canvas context')
const minimap = requiredElement('ome-zarr-minimap', HTMLCanvasElement)
const minimapContext = minimap.getContext('2d')
if (minimapContext === null) throw new Error('This browser does not provide a minimap context')
const histogramCanvas = requiredElement('ome-zarr-histogram', HTMLCanvasElement)
const histogramContext = histogramCanvas.getContext('2d')
if (histogramContext === null) throw new Error('This browser does not provide a histogram context')
const urlInput = requiredElement('ome-zarr-url', HTMLInputElement)
const openButton = requiredElement('ome-zarr-open', HTMLButtonElement)
const resetButton = requiredElement('ome-zarr-reset', HTMLButtonElement)
const fitButton = requiredElement('ome-zarr-fit', HTMLButtonElement)
const zoomInButton = requiredElement('ome-zarr-zoom-in', HTMLButtonElement)
const zoomOutButton = requiredElement('ome-zarr-zoom-out', HTMLButtonElement)
const fullscreenButton = requiredElement('ome-zarr-fullscreen', HTMLButtonElement)
const datasetSelect = requiredElement('ome-zarr-dataset', HTMLSelectElement)
const plateSummary = requiredElement('ome-zarr-plate-summary', HTMLElement)
const axisControls = requiredElement('ome-zarr-axis-controls', HTMLElement)
const channelControls = requiredElement('ome-zarr-channel-controls', HTMLElement)
const labelSelect = requiredElement('ome-zarr-label', HTMLSelectElement)
const labelOpacity = requiredElement('ome-zarr-label-opacity', HTMLInputElement)
const labelOpacityValue = requiredElement('ome-zarr-label-opacity-value', HTMLOutputElement)
const autoContrastButton = requiredElement('ome-zarr-auto-contrast', HTMLButtonElement)
const cursorReadout = requiredElement('ome-zarr-cursor-readout', HTMLElement)
const scaleElement = requiredElement('ome-zarr-scale', HTMLElement)
const scaleLine = scaleElement.querySelector('span')
const scaleOutput = scaleElement.querySelector('output')
if (!(scaleLine instanceof HTMLElement) || !(scaleOutput instanceof HTMLOutputElement)) {
  throw new Error('OME-Zarr scale bar is incomplete')
}
const statusElement = requiredElement('ome-zarr-status', HTMLElement)
const levelElement = requiredElement('ome-zarr-level-live', HTMLElement)
const requestStrip = requiredElement('ome-zarr-request-strip', HTMLElement)
const measuredBytesElement = requiredElement('ome-zarr-measured-bytes', HTMLElement)
const measuredFractionElement = requiredElement('ome-zarr-measured-fraction', HTMLElement)
const metadataSummaryElement = requiredElement('ome-zarr-metadata-summary', HTMLElement)
const canvasWrap = requiredElement('ome-zarr-canvas-wrap', HTMLElement)
const canvasPanel = canvasWrap.closest('.wsi-canvas-panel')
if (!(canvasPanel instanceof HTMLElement)) throw new Error('OME-Zarr canvas panel is missing')
const loadingElement = requiredElement('ome-zarr-loading', HTMLElement)
const loadingTitleElement = requiredElement('ome-zarr-loading-title', HTMLElement)
const loadingDetailElement = requiredElement('ome-zarr-loading-detail', HTMLElement)
const loadingProgressElement = requiredElement('ome-zarr-loading-progress', HTMLElement)
const loadingProgressBar = requiredElement('ome-zarr-loading-progress-bar', HTMLElement)

const factElements = {
  store: requiredElement('ome-zarr-stat-store', HTMLElement),
  version: requiredElement('ome-zarr-stat-version', HTMLElement),
  zarr: requiredElement('ome-zarr-stat-zarr', HTMLElement),
  size: requiredElement('ome-zarr-stat-size', HTMLElement),
  dimensions: requiredElement('ome-zarr-stat-dimensions', HTMLElement),
  axes: requiredElement('ome-zarr-stat-axes', HTMLElement),
  channels: requiredElement('ome-zarr-stat-channels', HTMLElement),
  levels: requiredElement('ome-zarr-stat-levels', HTMLElement),
  logicalChunk: requiredElement('ome-zarr-stat-logical-chunk', HTMLElement),
  shard: requiredElement('ome-zarr-stat-shard', HTMLElement),
  codecs: requiredElement('ome-zarr-stat-codecs', HTMLElement),
}

const statElements = {
  objectRequests: requiredElement('ome-zarr-stat-object-requests', HTMLElement),
  rangeRequests: requiredElement('ome-zarr-stat-range-requests', HTMLElement),
  bytes: requiredElement('ome-zarr-stat-bytes', HTMLElement),
  uniqueBytes: requiredElement('ome-zarr-stat-unique-bytes', HTMLElement),
  metadataBytes: requiredElement('ome-zarr-stat-metadata-bytes', HTMLElement),
  arrayBytes: requiredElement('ome-zarr-stat-array-bytes', HTMLElement),
  fraction: requiredElement('ome-zarr-stat-fraction', HTMLElement),
  decoded: requiredElement('ome-zarr-stat-decoded', HTMLElement),
  cancelled: requiredElement('ome-zarr-stat-cancelled', HTMLElement),
  failed: requiredElement('ome-zarr-stat-failed', HTMLElement),
  inFlight: requiredElement('ome-zarr-stat-in-flight', HTMLElement),
  decodeTime: requiredElement('ome-zarr-stat-decode-time', HTMLElement),
  cacheHits: requiredElement('ome-zarr-stat-cache-hits', HTMLElement),
  cacheResident: requiredElement('ome-zarr-stat-cache-resident', HTMLElement),
  sourceCacheHits: requiredElement('ome-zarr-stat-source-cache-hits', HTMLElement),
  sourceCacheResident: requiredElement('ome-zarr-stat-source-cache-resident', HTMLElement),
  coalesced: requiredElement('ome-zarr-stat-coalesced', HTMLElement),
  aborted: requiredElement('ome-zarr-stat-aborted', HTMLElement),
  objectsOpened: requiredElement('ome-zarr-stat-objects-opened', HTMLElement),
}

const sampleButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>('[data-ome-zarr-sample-url]'),
)
const worker = new Worker(new URL('./ome-zarr-worker.js', import.meta.url), { type: 'module' })
const cache = new Map<string, CachedTile>()
const pendingByKey = new Map<string, RequestedTile>()
const pendingById = new Map<number, RequestedTile>()
const failedKeys = new Set<string>()
const pointerPositions = new Map<number, Point>()
const requestVisuals: RequestVisual[] = []
const histograms = new Map<number, HistogramAggregate>()
const maximumCachedTiles = 192
const maximumRequestVisuals = 96
let metadata: OmeZarrMetadata | undefined
let configuration: OmeZarrRenderConfiguration | undefined
let generation = 1
const emptyStats = (): OmeZarrStats => ({
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
  viewportTilesDecoded: 0,
  viewportTilesCancelled: 0,
  viewportTilesFailed: 0,
  inFlightTileJobs: 0,
  decodeMillisecondsTotal: 0,
  lastDecodeMilliseconds: 0,
})
let stats = emptyStats()
let measurementEpoch = 0
let pendingResetEpoch: number | undefined
let cacheHits = 0
let previousVisibleKeys = new Set<string>()
let loadingVisibleKeys = new Set<string>()
let nextRequestId = 1
let centerX = 0
let centerY = 0
let zoom = 1
let fittedZoom = 1
let updateFrame: number | undefined
let requestStripFrame: number | undefined
let urlFrame: number | undefined
let configureTimer: number | undefined
let loadingPhase: LoadingPhase = 'opening'
let loadingMessage = 'Starting the worker and connecting to object storage…'
let loadingStartedAt = performance.now()
let restoringUrlState = true

const send = (message: OmeZarrWorkerRequest): void => worker.postMessage(message)
const tileKey = (level: number, column: number, row: number): string =>
  `${generation}:${level}:${column}:${row}`

const formatBytes = (bytes: number): string => {
  if (bytes < 1_024) return `${bytes.toLocaleString()} B`
  const units = ['KiB', 'MiB', 'GiB', 'TiB'] as const
  let value = bytes / 1_024
  let index = 0
  while (value >= 1_024 && index < units.length - 1) {
    value /= 1_024
    index += 1
  }
  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[index]}`
}

const loadingElapsed = (): string => {
  const seconds = Math.max(0, Math.floor((performance.now() - loadingStartedAt) / 1_000))
  return seconds === 0 ? 'just started' : `${seconds}s elapsed`
}

const setLoadingProgress = (ready: number, total: number): void => {
  if (total === 0) {
    loadingProgressElement.removeAttribute('aria-valuenow')
    loadingProgressElement.removeAttribute('aria-valuetext')
    loadingProgressElement.dataset.indeterminate = 'true'
    loadingProgressBar.style.width = ''
    return
  }
  const percent = Math.round((ready / total) * 100)
  delete loadingProgressElement.dataset.indeterminate
  loadingProgressElement.setAttribute('aria-valuemin', '0')
  loadingProgressElement.setAttribute('aria-valuemax', '100')
  loadingProgressElement.setAttribute('aria-valuenow', String(percent))
  loadingProgressElement.setAttribute('aria-valuetext', `${ready} of ${total} visible tiles ready`)
  loadingProgressBar.style.width = `${percent}%`
}

const showLoading = (): void => {
  loadingElement.hidden = false
  canvasWrap.setAttribute('aria-busy', 'true')
}

const hideLoading = (): void => {
  loadingElement.hidden = true
  canvasWrap.setAttribute('aria-busy', 'false')
}

const renderLoadingIndicator = (): void => {
  if (loadingPhase === 'error') return
  if (loadingPhase === 'idle') {
    hideLoading()
    return
  }
  showLoading()
  loadingElement.dataset.phase = loadingPhase
  if (loadingPhase === 'opening') {
    loadingTitleElement.textContent = 'Opening OME-Zarr store'
    loadingDetailElement.textContent = `${loadingMessage} · ${stats.objectRequests.toLocaleString()} objects checked · ${formatBytes(stats.bytesFetched)} fetched · ${loadingElapsed()}`
    setLoadingProgress(0, 0)
    return
  }
  let ready = 0
  let failed = 0
  for (const key of loadingVisibleKeys) {
    if (cache.has(key)) ready += 1
    else if (failedKeys.has(key)) failed += 1
  }
  const total = loadingVisibleKeys.size
  const remaining = Math.max(0, total - ready - failed)
  if (total > 0 && remaining === 0) {
    loadingPhase = 'idle'
    hideLoading()
    return
  }
  loadingElement.dataset.preview = ready > 0 ? 'true' : 'false'
  loadingTitleElement.textContent =
    ready === 0 ? 'Loading the first visible tiles' : 'Refining the viewport'
  loadingDetailElement.textContent = `${ready.toLocaleString()} of ${total.toLocaleString()} visible tiles ready · ${stats.inFlightTileJobs.toLocaleString()} jobs in flight · ${formatBytes(stats.bytesFetched)} fetched${failed === 0 ? '' : ` · ${failed} failed`}`
  setLoadingProgress(ready + failed, total)
}

const showLoadingError = (message: string): void => {
  loadingPhase = 'error'
  showLoading()
  canvasWrap.setAttribute('aria-busy', 'false')
  loadingElement.dataset.phase = 'error'
  loadingTitleElement.textContent = 'Could not load this OME-Zarr store'
  loadingDetailElement.textContent = message
  loadingProgressElement.hidden = true
}

const setViewerControlsEnabled = (enabled: boolean): void => {
  fitButton.disabled = !enabled
  zoomInButton.disabled = !enabled
  zoomOutButton.disabled = !enabled
  fullscreenButton.disabled = !enabled
  datasetSelect.disabled = !enabled
}

const fractionForBytes = (bytes: number, size: number): string =>
  size === 0 ? '0.000%' : `${((bytes / size) * 100).toFixed(3)}%`
const fractionText = (): string =>
  metadata?.publishedStoreBytes === undefined
    ? 'Total store size unknown'
    : fractionForBytes(stats.bytesFetched, metadata.publishedStoreBytes)

const renderStats = (): void => {
  statElements.objectRequests.textContent = stats.objectRequests.toLocaleString()
  statElements.rangeRequests.textContent = stats.rangeRequests.toLocaleString()
  statElements.bytes.textContent = formatBytes(stats.bytesFetched)
  statElements.uniqueBytes.textContent = formatBytes(stats.uniqueBytes)
  statElements.metadataBytes.textContent = formatBytes(stats.metadataBytesFetched)
  statElements.arrayBytes.textContent = formatBytes(stats.arrayBytesFetched)
  statElements.fraction.textContent = fractionText()
  statElements.decoded.textContent = stats.viewportTilesDecoded.toLocaleString()
  statElements.cancelled.textContent = stats.viewportTilesCancelled.toLocaleString()
  statElements.failed.textContent = stats.viewportTilesFailed.toLocaleString()
  statElements.inFlight.textContent = stats.inFlightTileJobs.toLocaleString()
  statElements.decodeTime.textContent = `${stats.lastDecodeMilliseconds.toFixed(1)} / ${stats.decodeMillisecondsTotal.toFixed(1)} ms`
  statElements.cacheHits.textContent = cacheHits.toLocaleString()
  statElements.cacheResident.textContent = `${cache.size.toLocaleString()} / ${maximumCachedTiles} tiles`
  statElements.sourceCacheHits.textContent = stats.sourceCacheHits.toLocaleString()
  statElements.sourceCacheResident.textContent = formatBytes(stats.sourceCacheBytes)
  statElements.coalesced.textContent = stats.coalescedConsumers.toLocaleString()
  statElements.aborted.textContent = stats.abortedConsumers.toLocaleString()
  statElements.objectsOpened.textContent = stats.objectsOpened.toLocaleString()
  measuredBytesElement.textContent = formatBytes(stats.bytesFetched)
  measuredFractionElement.textContent = fractionText()
  renderLoadingIndicator()
}

const updateRequestStrip = (): void => {
  requestStripFrame = undefined
  requestStrip.replaceChildren()
  for (const item of requestVisuals) {
    const marker = document.createElement('span')
    marker.className = `wsi-request-state ${item.state}`
    marker.textContent = item.label
    const timing = item.milliseconds === undefined ? '' : ` · ${item.milliseconds.toFixed(1)} ms`
    marker.title = `${item.label}: ${item.state}${timing}`
    marker.setAttribute('aria-label', marker.title)
    requestStrip.append(marker)
  }
  if (requestVisuals.length === 0) {
    const empty = document.createElement('span')
    empty.className = 'wsi-request-empty'
    empty.textContent = 'Viewport tile activity and timings will appear here.'
    requestStrip.append(empty)
  }
}

const scheduleRequestStripUpdate = (): void => {
  if (requestStripFrame === undefined) requestStripFrame = requestAnimationFrame(updateRequestStrip)
}

const addRequestVisual = (request: RequestedTile): void => {
  requestVisuals.push({
    requestId: request.requestId,
    label: `L${request.level} · ${request.column},${request.row}`,
    started: performance.now(),
    state: 'pending',
  })
  while (requestVisuals.length > maximumRequestVisuals) requestVisuals.shift()
  scheduleRequestStripUpdate()
}

const setRequestVisual = (
  requestId: number,
  state: RequestVisualState,
  milliseconds?: number,
): void => {
  const visual = requestVisuals.find((item) => item.requestId === requestId)
  if (visual !== undefined) {
    visual.state = state
    visual.milliseconds = milliseconds ?? performance.now() - visual.started
  }
  scheduleRequestStripUpdate()
}

const clearCache = (): void => {
  for (const tile of cache.values()) tile.bitmap.close()
  cache.clear()
}

const storeTile = (tile: CachedTile): void => {
  cache.get(tile.key)?.bitmap.close()
  cache.delete(tile.key)
  cache.set(tile.key, tile)
  while (cache.size > maximumCachedTiles) {
    const oldest = cache.entries().next().value
    if (oldest === undefined) break
    oldest[1].bitmap.close()
    cache.delete(oldest[0])
  }
}

const touchCachedTile = (key: string): CachedTile | undefined => {
  const tile = cache.get(key)
  if (tile === undefined) return undefined
  cache.delete(key)
  cache.set(key, tile)
  return tile
}

const canvasSize = (): Point => ({ x: canvas.clientWidth, y: canvas.clientHeight })
const resizeCanvas = (): void => {
  const size = canvasSize()
  const ratio = Math.max(1, window.devicePixelRatio || 1)
  const width = Math.max(1, Math.round(size.x * ratio))
  const height = Math.max(1, Math.round(size.y * ratio))
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0)
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
}

const clampViewport = (): void => {
  if (metadata === undefined) return
  const size = canvasSize()
  const halfWidth = size.x / (2 * zoom)
  const halfHeight = size.y / (2 * zoom)
  centerX =
    halfWidth * 2 >= metadata.width
      ? metadata.width / 2
      : Math.min(metadata.width - halfWidth, Math.max(halfWidth, centerX))
  centerY =
    halfHeight * 2 >= metadata.height
      ? metadata.height / 2
      : Math.min(metadata.height - halfHeight, Math.max(halfHeight, centerY))
}

const selectLevel = (): OmeZarrLevelMetadata | undefined => {
  if (metadata === undefined) return undefined
  const idealDownsample = 1 / zoom
  let chosen = metadata.levels[0]
  for (const level of metadata.levels) if (level.downsample <= idealDownsample) chosen = level
  return chosen
}

const visibleTiles = (level: OmeZarrLevelMetadata, padding: number): readonly VisibleTile[] => {
  const size = canvasSize()
  const halfWidth = size.x / (2 * zoom)
  const halfHeight = size.y / (2 * zoom)
  const left = Math.max(0, (centerX - halfWidth) / level.downsampleX)
  const top = Math.max(0, (centerY - halfHeight) / level.downsampleY)
  const right = Math.min(level.width, (centerX + halfWidth) / level.downsampleX)
  const bottom = Math.min(level.height, (centerY + halfHeight) / level.downsampleY)
  const maximumColumn = Math.max(0, Math.ceil(level.width / level.tileWidth) - 1)
  const maximumRow = Math.max(0, Math.ceil(level.height / level.tileHeight) - 1)
  const firstColumn = Math.max(0, Math.floor(left / level.tileWidth) - padding)
  const firstRow = Math.max(0, Math.floor(top / level.tileHeight) - padding)
  const lastColumn = Math.min(
    maximumColumn,
    Math.floor(Math.max(0, right - 1) / level.tileWidth) + padding,
  )
  const lastRow = Math.min(
    maximumRow,
    Math.floor(Math.max(0, bottom - 1) / level.tileHeight) + padding,
  )
  const tiles: VisibleTile[] = []
  for (let row = firstRow; row <= lastRow; row += 1) {
    for (let column = firstColumn; column <= lastColumn; column += 1) {
      tiles.push({ key: tileKey(level.index, column, row), level, column, row })
    }
  }
  return tiles
}

const drawTile = (tile: CachedTile, level: OmeZarrLevelMetadata): void => {
  const size = canvasSize()
  const x = (tile.column * level.tileWidth * level.downsampleX - centerX) * zoom + size.x / 2
  const y = (tile.row * level.tileHeight * level.downsampleY - centerY) * zoom + size.y / 2
  context.drawImage(
    tile.bitmap,
    x,
    y,
    tile.width * level.downsampleX * zoom + 0.5,
    tile.height * level.downsampleY * zoom + 0.5,
  )
}

const drawMinimap = (): void => {
  minimapContext.fillStyle = '#090d0a'
  minimapContext.fillRect(0, 0, minimap.width, minimap.height)
  if (metadata === undefined) return
  const level = metadata.levels.at(-1)
  if (level === undefined) return
  const fit = Math.min(minimap.width / metadata.width, minimap.height / metadata.height)
  const drawWidth = metadata.width * fit
  const drawHeight = metadata.height * fit
  const offsetX = (minimap.width - drawWidth) / 2
  const offsetY = (minimap.height - drawHeight) / 2
  for (let row = 0; row < Math.ceil(level.height / level.tileHeight); row += 1) {
    for (let column = 0; column < Math.ceil(level.width / level.tileWidth); column += 1) {
      const tile = cache.get(tileKey(level.index, column, row))
      if (tile === undefined) continue
      minimapContext.drawImage(
        tile.bitmap,
        offsetX + column * level.tileWidth * level.downsampleX * fit,
        offsetY + row * level.tileHeight * level.downsampleY * fit,
        tile.width * level.downsampleX * fit + 0.5,
        tile.height * level.downsampleY * fit + 0.5,
      )
    }
  }
  const size = canvasSize()
  const left = Math.max(0, centerX - size.x / (2 * zoom))
  const top = Math.max(0, centerY - size.y / (2 * zoom))
  const width = Math.min(metadata.width - left, size.x / zoom)
  const height = Math.min(metadata.height - top, size.y / zoom)
  minimapContext.strokeStyle = '#b7ed55'
  minimapContext.lineWidth = 2
  minimapContext.strokeRect(offsetX + left * fit, offsetY + top * fit, width * fit, height * fit)
}

const niceScale = (value: number): number => {
  const power = 10 ** Math.floor(Math.log10(value))
  const normalized = value / power
  const factor = normalized >= 5 ? 5 : normalized >= 2 ? 2 : 1
  return factor * power
}

const spatialDisplayAxes = (): {
  readonly horizontal: OmeZarrMetadata['axes'][number] | undefined
  readonly vertical: OmeZarrMetadata['axes'][number] | undefined
} => {
  const spatial = metadata?.axes.filter((axis) => axis.kind === 'space') ?? []
  const horizontal =
    spatial.find(
      (axis) => axis.id.toLowerCase() === 'x' || axis.name.trim().toLowerCase() === 'x',
    ) ?? spatial.at(-1)
  const vertical =
    spatial.find(
      (axis) => axis.id.toLowerCase() === 'y' || axis.name.trim().toLowerCase() === 'y',
    ) ?? spatial.at(-2)
  return { horizontal, vertical }
}

const renderScaleBar = (): void => {
  const { horizontal } = spatialDisplayAxes()
  if (
    horizontal?.coordinateType !== 'linear' ||
    horizontal.step === undefined ||
    horizontal.unit === undefined
  ) {
    scaleElement.hidden = true
    return
  }
  const targetUnits = (110 / zoom) * Math.abs(horizontal.step)
  const units = niceScale(targetUnits)
  const pixels = (units / Math.abs(horizontal.step)) * zoom
  scaleLine.style.width = `${pixels}px`
  scaleOutput.textContent = `${units.toLocaleString(undefined, { maximumFractionDigits: 3 })} ${horizontal.unit}`
  scaleElement.hidden = false
}

const draw = (): void => {
  resizeCanvas()
  const size = canvasSize()
  context.fillStyle = '#0b100d'
  context.fillRect(0, 0, size.x, size.y)
  if (metadata === undefined) return
  const chosen = selectLevel()
  if (chosen === undefined) return
  const drawLevels = metadata.levels.filter((level) => level.index >= chosen.index).reverse()
  for (const level of drawLevels) {
    for (const visible of visibleTiles(level, 0)) {
      const tile = touchCachedTile(visible.key)
      if (tile !== undefined) drawTile(tile, level)
    }
  }
  levelElement.textContent = `Level ${chosen.index} · ${chosen.downsample.toFixed(chosen.downsample % 1 === 0 ? 0 : 2)}× downsample · ${chosen.tileWidth} × ${chosen.tileHeight} viewport tiles`
  drawMinimap()
  renderScaleBar()
}

const requestTile = (tile: VisibleTile): void => {
  if (pendingResetEpoch !== undefined) return
  const request: RequestedTile = {
    requestId: nextRequestId,
    key: tile.key,
    generation,
    level: tile.level.index,
    column: tile.column,
    row: tile.row,
  }
  nextRequestId += 1
  pendingByKey.set(request.key, request)
  pendingById.set(request.requestId, request)
  addRequestVisual(request)
  send({
    type: 'tile',
    epoch: measurementEpoch,
    requestId: request.requestId,
    generation,
    level: request.level,
    column: request.column,
    row: request.row,
  })
}

const updateRequests = (): void => {
  if (metadata === undefined || configuration === undefined || pendingResetEpoch !== undefined)
    return
  const chosen = selectLevel()
  const coarsest = metadata.levels.at(-1)
  if (chosen === undefined || coarsest === undefined) return
  const primaryTiles = visibleTiles(chosen, 1)
  const visiblePrimaryTiles = visibleTiles(chosen, 0)
  const placeholderTiles = chosen.index === coarsest.index ? [] : visibleTiles(coarsest, 0)
  const desiredTiles = [...placeholderTiles, ...primaryTiles]
  const desiredKeys = new Set(desiredTiles.map((tile) => tile.key))
  loadingVisibleKeys = new Set(
    [...placeholderTiles, ...visiblePrimaryTiles].map((tile) => tile.key),
  )
  for (const request of pendingByKey.values()) {
    if (desiredKeys.has(request.key)) continue
    pendingByKey.delete(request.key)
    pendingById.delete(request.requestId)
    setRequestVisual(request.requestId, 'cancelled')
    send({ type: 'cancel', epoch: measurementEpoch, requestId: request.requestId })
  }
  for (const tile of desiredTiles) {
    const cached = cache.has(tile.key)
    if (cached && !previousVisibleKeys.has(tile.key)) cacheHits += 1
    if (!cached && !pendingByKey.has(tile.key) && !failedKeys.has(tile.key)) requestTile(tile)
  }
  previousVisibleKeys = desiredKeys
  loadingPhase = 'viewport'
  renderStats()
}

const update = (): void => {
  updateFrame = undefined
  clampViewport()
  draw()
  updateRequests()
  scheduleUrlUpdate()
}
const scheduleUpdate = (): void => {
  if (updateFrame === undefined) updateFrame = requestAnimationFrame(update)
}

const fitViewport = (): void => {
  if (metadata === undefined) return
  const size = canvasSize()
  fittedZoom = Math.min(size.x / metadata.width, size.y / metadata.height) * 0.94
  zoom = fittedZoom
  centerX = metadata.width / 2
  centerY = metadata.height / 2
  scheduleUpdate()
}

const setZoomAt = (nextZoom: number, screenX: number, screenY: number): void => {
  if (metadata === undefined) return
  const size = canvasSize()
  const bounded = Math.min(4, Math.max(fittedZoom * 0.75, nextZoom))
  const slideX = centerX + (screenX - size.x / 2) / zoom
  const slideY = centerY + (screenY - size.y / 2) / zoom
  centerX = slideX - (screenX - size.x / 2) / bounded
  centerY = slideY - (screenY - size.y / 2) / bounded
  zoom = bounded
  scheduleUpdate()
}

const pointerCentroid = (points: readonly Point[]): Point => ({
  x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
  y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
})
const pointerDistance = (points: readonly Point[]): number => {
  const first = points[0]
  const second = points[1]
  return first === undefined || second === undefined
    ? 0
    : Math.hypot(second.x - first.x, second.y - first.y)
}

const updateCursorReadout = (event: PointerEvent): void => {
  if (metadata === undefined) return
  const size = canvasSize()
  const x = centerX + (event.offsetX - size.x / 2) / zoom
  const y = centerY + (event.offsetY - size.y / 2) / zoom
  const ratio = Math.max(1, window.devicePixelRatio || 1)
  const sampleX = Math.min(canvas.width - 1, Math.max(0, Math.floor(event.offsetX * ratio)))
  const sampleY = Math.min(canvas.height - 1, Math.max(0, Math.floor(event.offsetY * ratio)))
  const rgb = context.getImageData(sampleX, sampleY, 1, 1).data
  cursorReadout.textContent = `X ${Math.round(x).toLocaleString()} · Y ${Math.round(y).toLocaleString()} · display RGB ${rgb[0] ?? 0}, ${rgb[1] ?? 0}, ${rgb[2] ?? 0}`
}

canvas.addEventListener('pointerdown', (event) => {
  canvas.setPointerCapture(event.pointerId)
  pointerPositions.set(event.pointerId, { x: event.offsetX, y: event.offsetY })
  canvas.classList.add('dragging')
})
canvas.addEventListener('pointermove', (event) => {
  updateCursorReadout(event)
  const previous = pointerPositions.get(event.pointerId)
  if (previous === undefined || metadata === undefined) return
  const before = [...pointerPositions.values()]
  pointerPositions.set(event.pointerId, { x: event.offsetX, y: event.offsetY })
  const after = [...pointerPositions.values()]
  if (before.length === 1) {
    centerX -= (event.offsetX - previous.x) / zoom
    centerY -= (event.offsetY - previous.y) / zoom
    scheduleUpdate()
    return
  }
  const beforeCenter = pointerCentroid(before)
  const afterCenter = pointerCentroid(after)
  centerX -= (afterCenter.x - beforeCenter.x) / zoom
  centerY -= (afterCenter.y - beforeCenter.y) / zoom
  const beforeDistance = pointerDistance(before)
  const afterDistance = pointerDistance(after)
  if (beforeDistance > 0 && afterDistance > 0)
    setZoomAt(zoom * (afterDistance / beforeDistance), afterCenter.x, afterCenter.y)
  else scheduleUpdate()
})
const releasePointer = (event: PointerEvent): void => {
  pointerPositions.delete(event.pointerId)
  if (pointerPositions.size === 0) canvas.classList.remove('dragging')
}
canvas.addEventListener('pointerup', releasePointer)
canvas.addEventListener('pointercancel', releasePointer)
canvas.addEventListener(
  'wheel',
  (event) => {
    event.preventDefault()
    setZoomAt(zoom * Math.exp(-event.deltaY * 0.0015), event.offsetX, event.offsetY)
  },
  { passive: false },
)

minimap.addEventListener('click', (event) => {
  if (metadata === undefined) return
  const bounds = minimap.getBoundingClientRect()
  const fit = Math.min(minimap.width / metadata.width, minimap.height / metadata.height)
  const offsetX = (minimap.width - metadata.width * fit) / 2
  const offsetY = (minimap.height - metadata.height * fit) / 2
  const x = ((event.clientX - bounds.left) / bounds.width) * minimap.width
  const y = ((event.clientY - bounds.top) / bounds.height) * minimap.height
  centerX = Math.min(metadata.width, Math.max(0, (x - offsetX) / fit))
  centerY = Math.min(metadata.height, Math.max(0, (y - offsetY) / fit))
  scheduleUpdate()
})

zoomInButton.addEventListener('click', () => {
  const size = canvasSize()
  setZoomAt(zoom * 1.8, size.x / 2, size.y / 2)
})
zoomOutButton.addEventListener('click', () => {
  const size = canvasSize()
  setZoomAt(zoom / 1.8, size.x / 2, size.y / 2)
})
fitButton.addEventListener('click', fitViewport)
fullscreenButton.addEventListener('click', () => {
  const transition =
    document.fullscreenElement === canvasPanel
      ? document.exitFullscreen()
      : canvasPanel.requestFullscreen()
  void transition.catch((cause: unknown) => {
    statusElement.textContent =
      cause instanceof Error ? cause.message : 'Full-screen mode is unavailable in this browser.'
    statusElement.dataset.error = 'true'
  })
})
document.addEventListener('fullscreenchange', () => {
  fullscreenButton.textContent =
    document.fullscreenElement === canvasPanel ? 'Exit full screen' : 'Full screen'
  scheduleUpdate()
})

const cancelAllRequests = (): void => {
  for (const request of pendingByKey.values()) {
    setRequestVisual(request.requestId, 'cancelled')
    send({ type: 'cancel', epoch: measurementEpoch, requestId: request.requestId })
  }
  pendingByKey.clear()
  pendingById.clear()
}

const invalidateRendering = (): void => {
  cancelAllRequests()
  clearCache()
  failedKeys.clear()
  previousVisibleKeys.clear()
  loadingVisibleKeys.clear()
  histograms.clear()
  renderHistogram()
  loadingPhase = 'viewport'
  loadingStartedAt = performance.now()
  renderLoadingIndicator()
}

const normalizedSampleUrl = (url: string): string =>
  new URL(url, window.location.href).href.replace(/\/+$/u, '')
const selectedSample = (url: string): HTMLButtonElement | undefined =>
  sampleButtons.find(
    (button) =>
      button.dataset.omeZarrSampleUrl !== undefined &&
      normalizedSampleUrl(button.dataset.omeZarrSampleUrl) === normalizedSampleUrl(url),
  )
const updateSelectedSample = (url: string): void => {
  const selected = selectedSample(url)
  for (const button of sampleButtons)
    button.setAttribute('aria-pressed', button === selected ? 'true' : 'false')
}

const scheduleUrlUpdate = (): void => {
  if (
    restoringUrlState ||
    urlFrame !== undefined ||
    metadata === undefined ||
    configuration === undefined
  )
    return
  urlFrame = requestAnimationFrame(() => {
    urlFrame = undefined
    const next = new URL(window.location.href)
    next.searchParams.set('url', metadata?.url ?? urlInput.value)
    next.searchParams.set('dataset', configuration?.datasetId ?? '')
    next.searchParams.set(
      'axes',
      JSON.stringify(
        Object.fromEntries(
          configuration?.fixedIndices.map((entry) => [entry.axisId, entry.index]) ?? [],
        ),
      ),
    )
    next.searchParams.set('channels', JSON.stringify(configuration?.channels ?? []))
    if (configuration?.label === undefined) {
      next.searchParams.delete('label')
      next.searchParams.delete('opacity')
    } else {
      next.searchParams.set('label', configuration.label.datasetId)
      next.searchParams.set('opacity', configuration.label.opacity.toFixed(2))
    }
    next.searchParams.set('cx', centerX.toFixed(2))
    next.searchParams.set('cy', centerY.toFixed(2))
    next.searchParams.set('zoom', zoom.toPrecision(6))
    next.searchParams.set('level', String(selectLevel()?.index ?? 0))
    window.history.replaceState(null, '', next)
  })
}

const renderHistogram = (): void => {
  histogramContext.clearRect(0, 0, histogramCanvas.width, histogramCanvas.height)
  histogramContext.fillStyle = '#090d0a'
  histogramContext.fillRect(0, 0, histogramCanvas.width, histogramCanvas.height)
  const active = configuration?.channels.filter((channel) => channel.enabled) ?? []
  for (const channel of active) {
    const aggregate = histograms.get(channel.index)
    if (aggregate === undefined) continue
    const maximum = Math.max(1, ...aggregate.bins)
    histogramContext.strokeStyle = `#${channel.color.toString(16).padStart(6, '0')}`
    histogramContext.globalAlpha = 0.72
    histogramContext.beginPath()
    for (const [index, count] of aggregate.bins.entries()) {
      const x = (index / Math.max(1, aggregate.bins.length - 1)) * histogramCanvas.width
      const y = histogramCanvas.height - (count / maximum) * (histogramCanvas.height - 5)
      if (index === 0) histogramContext.moveTo(x, y)
      else histogramContext.lineTo(x, y)
    }
    histogramContext.stroke()
  }
  histogramContext.globalAlpha = 1
  autoContrastButton.disabled = histograms.size === 0
}

const mergeHistograms = (updates: readonly OmeZarrChannelHistogram[]): void => {
  for (const update of updates) {
    let aggregate = histograms.get(update.channel)
    if (aggregate === undefined) {
      aggregate = {
        bins: new Array<number>(update.bins.length).fill(0),
        minimum: update.minimum,
        maximum: update.maximum,
        finiteSamples: 0,
      }
      histograms.set(update.channel, aggregate)
    }
    aggregate.minimum = Math.min(aggregate.minimum, update.minimum)
    aggregate.maximum = Math.max(aggregate.maximum, update.maximum)
    aggregate.finiteSamples += update.finiteSamples
    for (const [index, count] of update.bins.entries())
      aggregate.bins[index] = (aggregate.bins[index] ?? 0) + count
  }
  renderHistogram()
}

const colorHex = (color: number): string => `#${color.toString(16).padStart(6, '0')}`
const axisCoordinate = (axisId: string, index: number): string => {
  const axis = metadata?.axes.find((entry) => entry.id === axisId)
  if (axis === undefined) return String(index)
  if (axis.coordinateType === 'linear') {
    const value = (axis.origin ?? 0) + (axis.step ?? 1) * index
    return `${value.toLocaleString(undefined, { maximumFractionDigits: 4 })}${axis.unit === undefined ? '' : ` ${axis.unit}`}`
  }
  return String(axis.values?.[index] ?? index)
}

const requestConfiguration = (next: OmeZarrRenderConfiguration, delay = 0): void => {
  if (pendingResetEpoch !== undefined) return
  if (configureTimer !== undefined) window.clearTimeout(configureTimer)
  configureTimer = window.setTimeout(() => {
    configureTimer = undefined
    generation += 1
    const updated = { ...next, generation }
    configuration = updated
    invalidateRendering()
    send({ type: 'configure', epoch: measurementEpoch, configuration: updated })
    scheduleUrlUpdate()
  }, delay)
}

const renderControls = (): void => {
  if (metadata === undefined || configuration === undefined) return
  datasetSelect.replaceChildren()
  for (const entry of metadata.datasets.filter((candidate) => candidate.kind === 'image')) {
    const option = document.createElement('option')
    option.value = entry.id
    option.disabled = !entry.displayable
    option.selected = entry.id === metadata.datasetId
    const well = entry.wellPath === undefined ? '' : `${entry.wellPath} · `
    option.textContent = `${well}${entry.name}${entry.acquisition === undefined ? '' : ` · acquisition ${entry.acquisition}`}`
    datasetSelect.append(option)
  }
  datasetSelect.disabled = false
  plateSummary.textContent =
    metadata.plate === undefined
      ? `${metadata.datasets.filter((entry) => entry.kind === 'image').length} image dataset${metadata.datasets.filter((entry) => entry.kind === 'image').length === 1 ? '' : 's'}`
      : `${metadata.plate.name ?? 'Plate'} · ${metadata.plate.wellCount} wells`

  axisControls.replaceChildren()
  const selectedDisplayAxes = spatialDisplayAxes()
  const displayIds = new Set(
    [selectedDisplayAxes.horizontal?.id, selectedDisplayAxes.vertical?.id].filter(
      (id): id is string => id !== undefined,
    ),
  )
  const channelAxis = metadata.axes.find((axis) => axis.kind === 'channel')
  for (const axis of metadata.axes.filter(
    (entry) => !displayIds.has(entry.id) && entry.id !== channelAxis?.id && entry.length > 1,
  )) {
    const current = configuration.fixedIndices.find((entry) => entry.axisId === axis.id)?.index ?? 0
    const wrap = document.createElement('label')
    wrap.className = 'ome-zarr-axis-control'
    const name = document.createElement('span')
    name.textContent = axis.name
    const input = document.createElement('input')
    input.type = 'range'
    input.min = '0'
    input.max = String(axis.length - 1)
    input.step = '1'
    input.value = String(current)
    input.dataset.axisId = axis.id
    const output = document.createElement('output')
    output.textContent = `${current + 1}/${axis.length} · ${axisCoordinate(axis.id, current)}`
    input.addEventListener('input', () => {
      const index = Number(input.value)
      output.textContent = `${index + 1}/${axis.length} · ${axisCoordinate(axis.id, index)}`
    })
    input.addEventListener('change', () => {
      if (configuration === undefined) return
      const index = Number(input.value)
      requestConfiguration({
        ...configuration,
        fixedIndices: configuration.fixedIndices.map((entry) =>
          entry.axisId === axis.id ? { ...entry, index } : entry,
        ),
      })
    })
    wrap.append(name, input, output)
    axisControls.append(wrap)
  }
  if (axisControls.childElementCount === 0) {
    const empty = document.createElement('span')
    empty.textContent = 'This dataset has no additional navigable axes.'
    axisControls.append(empty)
  }

  channelControls.replaceChildren()
  for (const channel of configuration.channels) {
    const meta = metadata.channels[channel.index]
    if (meta === undefined) continue
    const row = document.createElement('div')
    row.className = 'ome-zarr-channel-control'
    const enabled = document.createElement('input')
    enabled.type = 'checkbox'
    enabled.checked = channel.enabled
    enabled.setAttribute('aria-label', `Show ${meta.name}`)
    const color = document.createElement('input')
    color.type = 'color'
    color.value = colorHex(channel.color)
    color.setAttribute('aria-label', `${meta.name} color`)
    const name = document.createElement('span')
    name.className = 'ome-zarr-channel-name'
    name.textContent = meta.name
    const minimum = document.createElement('input')
    minimum.type = 'number'
    minimum.value = String(channel.minimum)
    minimum.title = 'Display minimum'
    const maximum = document.createElement('input')
    maximum.type = 'number'
    maximum.value = String(channel.maximum)
    maximum.title = 'Display maximum'
    const gamma = document.createElement('input')
    gamma.type = 'number'
    gamma.min = '0.05'
    gamma.max = '10'
    gamma.step = '0.05'
    gamma.value = String(channel.gamma)
    gamma.title = 'Gamma'
    const commit = (): void => {
      if (configuration === undefined) return
      const nextChannel: OmeZarrChannelConfiguration = {
        index: channel.index,
        enabled: enabled.checked,
        color: Number.parseInt(color.value.slice(1), 16),
        minimum: Number(minimum.value),
        maximum: Number(maximum.value),
        gamma: Number(gamma.value),
        coefficient: channel.coefficient,
        inverted: channel.inverted,
      }
      const activeCount = configuration.channels.filter((entry) =>
        entry.index === channel.index ? nextChannel.enabled : entry.enabled,
      ).length
      if (
        activeCount < 1 ||
        activeCount > 3 ||
        !Number.isFinite(nextChannel.minimum) ||
        !Number.isFinite(nextChannel.maximum) ||
        nextChannel.maximum <= nextChannel.minimum ||
        !Number.isFinite(nextChannel.gamma) ||
        nextChannel.gamma < 0.05 ||
        nextChannel.gamma > 10
      ) {
        statusElement.textContent =
          'Keep one to three channels enabled, with maximum above minimum and gamma from 0.05 to 10.'
        statusElement.dataset.error = 'true'
        renderControls()
        return
      }
      delete statusElement.dataset.error
      requestConfiguration({
        ...configuration,
        channels: configuration.channels.map((entry) =>
          entry.index === channel.index ? nextChannel : entry,
        ),
      })
    }
    enabled.addEventListener('change', commit)
    color.addEventListener('change', commit)
    minimum.addEventListener('change', commit)
    maximum.addEventListener('change', commit)
    gamma.addEventListener('change', commit)
    row.append(enabled, color, name, minimum, maximum, gamma)
    channelControls.append(row)
  }

  labelSelect.replaceChildren()
  const none = document.createElement('option')
  none.value = ''
  none.textContent = metadata.labels.length === 0 ? 'None available' : 'None'
  labelSelect.append(none)
  for (const label of metadata.labels) {
    const option = document.createElement('option')
    option.value = label.datasetId
    option.textContent = label.compatible ? label.name : `${label.name} (incompatible geometry)`
    option.disabled = !label.compatible
    option.selected = configuration.label?.datasetId === label.datasetId
    labelSelect.append(option)
  }
  labelSelect.disabled = metadata.labels.every((label) => !label.compatible)
  labelOpacity.disabled = configuration.label === undefined
  labelOpacity.value = String(Math.round((configuration.label?.opacity ?? 0.45) * 100))
  labelOpacityValue.value = `${labelOpacity.value}%`
}

datasetSelect.addEventListener('change', () => {
  generation += 1
  invalidateRendering()
  send({
    type: 'select-dataset',
    epoch: measurementEpoch,
    datasetId: datasetSelect.value,
    generation,
  })
})
labelSelect.addEventListener('change', () => {
  if (configuration === undefined) return
  if (labelSelect.value.length === 0) {
    const { label: _label, ...withoutLabel } = configuration
    requestConfiguration(withoutLabel)
  } else {
    requestConfiguration({
      ...configuration,
      label: { datasetId: labelSelect.value, opacity: Number(labelOpacity.value) / 100 },
    })
  }
})
labelOpacity.addEventListener('input', () => {
  labelOpacityValue.value = `${labelOpacity.value}%`
  if (configuration?.label === undefined) return
  requestConfiguration(
    {
      ...configuration,
      label: { ...configuration.label, opacity: Number(labelOpacity.value) / 100 },
    },
    120,
  )
})
autoContrastButton.addEventListener('click', () => {
  if (configuration === undefined) return
  requestConfiguration({
    ...configuration,
    channels: configuration.channels.map((channel) => {
      const aggregate = histograms.get(channel.index)
      if (!channel.enabled || aggregate === undefined || aggregate.maximum <= aggregate.minimum)
        return channel
      return { ...channel, minimum: aggregate.minimum, maximum: aggregate.maximum }
    }),
  })
})

const formatShape = (shape: readonly number[]): string => shape.map(String).join(' × ')
const setMetadataFacts = (opened: OmeZarrMetadata): void => {
  const first = opened.levels[0]
  factElements.store.textContent = `${opened.name} · ${opened.datasetName}`
  factElements.version.textContent = `OME-NGFF ${opened.omeNgffVersion}`
  factElements.zarr.textContent = `Zarr v${opened.zarrFormat}`
  factElements.size.textContent =
    opened.publishedStoreBytes === undefined
      ? 'Total store size unknown'
      : `${formatBytes(opened.publishedStoreBytes)} (${opened.publishedStoreBytes.toLocaleString()} bytes, published)`
  factElements.dimensions.textContent = `${opened.width.toLocaleString()} × ${opened.height.toLocaleString()}`
  factElements.axes.textContent = opened.axes
    .map((axis) => `${axis.name}[${axis.length}]`)
    .join(', ')
  const active =
    configuration?.channels
      .filter((channel) => channel.enabled)
      .map((channel) => opened.channels[channel.index]?.name)
      .filter((name): name is string => name !== undefined) ?? []
  factElements.channels.textContent = active.join(', ')
  factElements.levels.textContent = `${opened.levels.length} (${opened.levels.map((level) => `${level.downsample.toFixed(level.downsample % 1 === 0 ? 0 : 2)}×`).join(', ')})`
  factElements.logicalChunk.textContent = first ? formatShape(first.logicalChunkShape) : 'Unknown'
  factElements.shard.textContent = first
    ? first.sharded
      ? `${formatShape(first.storageChunkShape)} · index ${first.shardIndexLocation ?? 'end'}`
      : 'Unsharded'
    : 'Unknown'
  factElements.codecs.textContent = first?.codecs.join(', ') ?? 'Unknown'
}

const numberParam = (name: string): number | undefined => {
  const raw = new URL(window.location.href).searchParams.get(name)
  if (raw === null || raw.trim().length === 0) return undefined
  const value = Number(raw)
  return Number.isFinite(value) ? value : undefined
}

const restoreConfigurationFromUrl = (): void => {
  if (!restoringUrlState || metadata === undefined || configuration === undefined) return
  const parameters = new URL(window.location.href).searchParams
  const desiredDataset = parameters.get('dataset')
  if (
    desiredDataset !== null &&
    desiredDataset !== metadata.datasetId &&
    metadata.datasets.some(
      (entry) => entry.id === desiredDataset && entry.kind === 'image' && entry.displayable,
    )
  ) {
    generation += 1
    invalidateRendering()
    send({ type: 'select-dataset', epoch: measurementEpoch, datasetId: desiredDataset, generation })
    return
  }
  let next = configuration
  const rawAxes = parameters.get('axes')
  if (rawAxes !== null) {
    try {
      const parsed: unknown = JSON.parse(rawAxes)
      if (isRecord(parsed)) {
        const record = parsed
        next = {
          ...next,
          fixedIndices: next.fixedIndices.map((entry) => {
            const value = record[entry.axisId]
            const axis = metadata?.axes.find((candidate) => candidate.id === entry.axisId)
            return typeof value === 'number' &&
              Number.isSafeInteger(value) &&
              value >= 0 &&
              value < (axis?.length ?? 0)
              ? { ...entry, index: value }
              : entry
          }),
        }
      }
    } catch {
      // Invalid optional viewer state is ignored; the store URL remains usable.
    }
  }
  const rawChannels = parameters.get('channels')
  if (rawChannels !== null) {
    try {
      const parsed: unknown = JSON.parse(rawChannels)
      if (Array.isArray(parsed) && parsed.length === next.channels.length) {
        const candidates = parsed
          .map(parseChannelConfiguration)
          .filter((entry): entry is OmeZarrChannelConfiguration => entry !== undefined)
        const enabled = candidates.filter((entry) => entry.enabled).length
        const expectedIndices = new Set(next.channels.map((entry) => entry.index))
        const candidateIndices = new Set(candidates.map((entry) => entry.index))
        if (
          candidates.length === next.channels.length &&
          candidateIndices.size === candidates.length &&
          [...candidateIndices].every((index) => expectedIndices.has(index)) &&
          enabled >= 1 &&
          enabled <= 3 &&
          candidates.every(
            (entry) =>
              entry.maximum > entry.minimum &&
              entry.gamma >= 0.05 &&
              entry.gamma <= 10 &&
              entry.coefficient >= 0,
          )
        )
          next = { ...next, channels: candidates }
      }
    } catch {
      // Ignore malformed optional channel state.
    }
  }
  const label = parameters.get('label')
  const opacity = numberParam('opacity') ?? 0.45
  if (
    label !== null &&
    metadata.labels.some((entry) => entry.datasetId === label && entry.compatible)
  ) {
    next = { ...next, label: { datasetId: label, opacity: Math.min(1, Math.max(0, opacity)) } }
  }
  const restoredCenterX = numberParam('cx')
  const restoredCenterY = numberParam('cy')
  const restoredZoom = numberParam('zoom')
  restoringUrlState = false
  if (restoredCenterX !== undefined) centerX = restoredCenterX
  if (restoredCenterY !== undefined) centerY = restoredCenterY
  if (restoredZoom !== undefined && restoredZoom > 0) {
    zoom = Math.min(4, Math.max(fittedZoom * 0.75, restoredZoom))
  }
  if (JSON.stringify(next) !== JSON.stringify(configuration)) requestConfiguration(next)
  else scheduleUpdate()
}

const openUrl = (): void => {
  const input = urlInput.value.trim()
  try {
    const parsed = new URL(input, window.location.href)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')
      throw new Error('Use an HTTP or HTTPS OME-Zarr URL')
    if (configureTimer !== undefined) {
      window.clearTimeout(configureTimer)
      configureTimer = undefined
    }
    if (urlFrame !== undefined) {
      cancelAnimationFrame(urlFrame)
      urlFrame = undefined
    }
    cancelAllRequests()
    measurementEpoch = Math.max(measurementEpoch, pendingResetEpoch ?? 0) + 1
    pendingResetEpoch = undefined
    clearCache()
    failedKeys.clear()
    previousVisibleKeys.clear()
    requestVisuals.length = 0
    scheduleRequestStripUpdate()
    histograms.clear()
    renderHistogram()
    cacheHits = 0
    stats = emptyStats()
    metadata = undefined
    configuration = undefined
    generation = 1
    loadingVisibleKeys.clear()
    loadingPhase = 'opening'
    loadingMessage = 'Connecting to object storage…'
    loadingStartedAt = performance.now()
    loadingProgressElement.hidden = false
    delete loadingElement.dataset.preview
    openButton.disabled = true
    openButton.textContent = 'Opening store…'
    openButton.setAttribute('aria-busy', 'true')
    resetButton.disabled = true
    setViewerControlsEnabled(false)
    delete statusElement.dataset.error
    statusElement.textContent = 'Opening the remote OME-Zarr store…'
    levelElement.textContent = 'Waiting for OME-Zarr metadata…'
    measuredBytesElement.textContent = 'Reading metadata'
    measuredFractionElement.textContent = 'Opening…'
    metadataSummaryElement.textContent = 'Metadata objects pending'
    renderLoadingIndicator()
    updateSelectedSample(parsed.href)
    const sample = selectedSample(parsed.href)
    const rawPublished = sample?.dataset.omeZarrPublishedBytes
    const parsedPublished = rawPublished === undefined ? undefined : Number(rawPublished)
    const publishedBytes =
      parsedPublished !== undefined && Number.isSafeInteger(parsedPublished) && parsedPublished > 0
        ? parsedPublished
        : undefined
    const nextUrl = new URL(window.location.href)
    nextUrl.searchParams.set('url', parsed.href)
    window.history.replaceState(null, '', nextUrl)
    send({
      type: 'open',
      epoch: measurementEpoch,
      url: parsed.href,
      ...(publishedBytes === undefined ? {} : { publishedStoreBytes: publishedBytes }),
    })
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Invalid OME-Zarr URL'
    openButton.disabled = false
    openButton.textContent = 'Open store'
    openButton.removeAttribute('aria-busy')
    statusElement.textContent = message
    statusElement.dataset.error = 'true'
    showLoadingError(message)
  }
}

openButton.addEventListener('click', () => {
  restoringUrlState = false
  openUrl()
})
urlInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    restoringUrlState = false
    openUrl()
  }
})
for (const button of sampleButtons) {
  button.addEventListener('click', () => {
    const sampleUrl = button.dataset.omeZarrSampleUrl
    if (sampleUrl === undefined) return
    restoringUrlState = false
    urlInput.value = sampleUrl
    openUrl()
  })
}
resetButton.addEventListener('click', () => {
  if (pendingResetEpoch !== undefined) return
  cancelAllRequests()
  cacheHits = 0
  requestVisuals.length = 0
  scheduleRequestStripUpdate()
  pendingResetEpoch = measurementEpoch + 1
  resetButton.disabled = true
  setViewerControlsEnabled(false)
  send({ type: 'reset', epoch: pendingResetEpoch })
})

const acceptMetadata = (
  opened: OmeZarrMetadata,
  configured: OmeZarrRenderConfiguration,
  fit: boolean,
): void => {
  metadata = opened
  configuration = configured
  generation = configured.generation
  setMetadataFacts(opened)
  renderControls()
  openButton.disabled = false
  openButton.textContent = 'Open store'
  openButton.removeAttribute('aria-busy')
  resetButton.disabled = false
  resetButton.dataset.measurementEpoch = String(measurementEpoch)
  setViewerControlsEnabled(true)
  loadingPhase = 'viewport'
  delete statusElement.dataset.error
  statusElement.textContent = `Viewing ${opened.datasetName}; requesting only visible logical chunks.`
  if (fit) fitViewport()
  else scheduleUpdate()
  restoreConfigurationFromUrl()
}

worker.onmessage = (event: MessageEvent<OmeZarrWorkerResponse>): void => {
  const message = event.data
  if (message.type === 'reset') {
    if (message.epoch !== pendingResetEpoch) return
    measurementEpoch = message.epoch
    pendingResetEpoch = undefined
    stats = message.stats
    resetButton.disabled = false
    resetButton.dataset.measurementEpoch = String(measurementEpoch)
    setViewerControlsEnabled(true)
    statusElement.textContent = 'Measurement counters reset. Move or zoom to start a new epoch.'
    renderStats()
    return
  }
  if (message.type === 'tile' && message.epoch !== measurementEpoch) {
    message.bitmap.close()
    return
  }
  if (message.epoch !== measurementEpoch || pendingResetEpoch !== undefined) return
  if (message.type === 'opening') {
    loadingMessage = message.message
    statusElement.textContent = message.message
    renderLoadingIndicator()
    return
  }
  if (message.type === 'opened') {
    stats = message.stats
    acceptMetadata(message.metadata, message.configuration, true)
    metadataSummaryElement.textContent = `${formatBytes(message.stats.metadataBytesFetched)} metadata · ${message.stats.objectRequests.toLocaleString()} HTTP object requests`
    renderStats()
    return
  }
  if (message.type === 'configured') {
    if (message.configuration.generation !== generation) return
    const datasetChanged = metadata?.datasetId !== message.metadata.datasetId
    stats = message.stats
    acceptMetadata(message.metadata, message.configuration, datasetChanged)
    renderStats()
    return
  }
  if (message.type === 'stats') {
    stats = message.stats
    renderStats()
    return
  }
  if (message.type === 'tile') {
    stats = message.stats
    const request = pendingById.get(message.requestId)
    pendingById.delete(message.requestId)
    if (request !== undefined) pendingByKey.delete(request.key)
    if (
      request === undefined ||
      message.generation !== generation ||
      !previousVisibleKeys.has(request.key)
    )
      message.bitmap.close()
    else {
      storeTile({
        key: request.key,
        generation,
        level: message.level,
        column: message.column,
        row: message.row,
        width: message.width,
        height: message.height,
        bitmap: message.bitmap,
      })
      mergeHistograms(message.histograms)
      setRequestVisual(message.requestId, 'decoded', message.decodeMilliseconds)
    }
    scheduleUpdate()
    renderStats()
    return
  }
  if (message.type === 'tile-cancelled') {
    stats = message.stats
    const request = pendingById.get(message.requestId)
    pendingById.delete(message.requestId)
    if (request !== undefined) pendingByKey.delete(request.key)
    setRequestVisual(message.requestId, 'cancelled')
    renderStats()
    return
  }
  if (message.generation !== undefined && message.generation !== generation) return
  openButton.disabled = false
  openButton.textContent = 'Open store'
  openButton.removeAttribute('aria-busy')
  if (message.requestId !== undefined) {
    const request = pendingById.get(message.requestId)
    pendingById.delete(message.requestId)
    if (request !== undefined) {
      pendingByKey.delete(request.key)
      failedKeys.add(request.key)
    }
    setRequestVisual(message.requestId, 'failed')
  }
  if (message.stats !== undefined) stats = message.stats
  statusElement.textContent = message.message
  statusElement.dataset.error = 'true'
  if (message.requestId === undefined) showLoadingError(message.message)
  renderStats()
}

worker.onerror = (event): void => {
  openButton.disabled = false
  openButton.textContent = 'Open store'
  openButton.removeAttribute('aria-busy')
  const message = event.message || 'OME-Zarr worker failed'
  statusElement.textContent = message
  statusElement.dataset.error = 'true'
  showLoadingError(message)
}

window.addEventListener('resize', scheduleUpdate)
window.setInterval(() => {
  if (pendingResetEpoch === undefined) send({ type: 'stats', epoch: measurementEpoch })
}, 250)
updateRequestStrip()
renderHistogram()
resizeCanvas()
const configuredUrl = new URL(window.location.href).searchParams.get('url')
if (configuredUrl !== null) urlInput.value = configuredUrl
window.pureJsImageOmeZarrReady = true
openUrl()

declare global {
  interface Window {
    pureJsImageOmeZarrReady?: boolean
  }
}
