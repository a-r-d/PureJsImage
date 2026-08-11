import type {
  WsiLevelMetadata,
  WsiMetadata,
  WsiStats,
  WsiWorkerRequest,
  WsiWorkerResponse,
} from './wsi-types.ts'

type ElementConstructor<ElementType extends Element> = new () => ElementType

const requiredElement = <ElementType extends Element>(
  id: string,
  Constructor: ElementConstructor<ElementType>,
): ElementType => {
  const candidate = document.getElementById(id)
  if (!(candidate instanceof Constructor)) throw new Error(`WSI demo element #${id} is missing`)
  return candidate
}

interface CachedTile {
  readonly key: string
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
  readonly level: number
  readonly column: number
  readonly row: number
}

interface VisibleTile {
  readonly key: string
  readonly level: WsiLevelMetadata
  readonly column: number
  readonly row: number
}

type RequestVisualState = 'pending' | 'decoded' | 'cancelled' | 'failed'

interface RequestVisual {
  readonly requestId: number
  readonly label: string
  state: RequestVisualState
}

interface Point {
  readonly x: number
  readonly y: number
}

const canvas = requiredElement('wsi-canvas', HTMLCanvasElement)
const context = canvas.getContext('2d', { alpha: false })
if (!context) throw new Error('This browser does not provide a 2D canvas context')
const urlInput = requiredElement('wsi-url', HTMLInputElement)
const openButton = requiredElement('wsi-open', HTMLButtonElement)
const resetButton = requiredElement('wsi-reset', HTMLButtonElement)
const fitButton = requiredElement('wsi-fit', HTMLButtonElement)
const zoomInButton = requiredElement('wsi-zoom-in', HTMLButtonElement)
const zoomOutButton = requiredElement('wsi-zoom-out', HTMLButtonElement)
const statusElement = requiredElement('wsi-status', HTMLElement)
const levelElement = requiredElement('wsi-level-live', HTMLElement)
const requestStrip = requiredElement('wsi-request-strip', HTMLElement)
const slideNameElement = requiredElement('wsi-stat-slide', HTMLElement)
const fileSizeElement = requiredElement('wsi-stat-size', HTMLElement)
const dimensionsElement = requiredElement('wsi-stat-dimensions', HTMLElement)
const levelsElement = requiredElement('wsi-stat-levels', HTMLElement)
const tileSizeElement = requiredElement('wsi-stat-tile-size', HTMLElement)
const requestsElement = requiredElement('wsi-stat-requests', HTMLElement)
const bytesElement = requiredElement('wsi-stat-bytes', HTMLElement)
const fractionElement = requiredElement('wsi-stat-fraction', HTMLElement)
const decodedElement = requiredElement('wsi-stat-decoded', HTMLElement)
const cancelledElement = requiredElement('wsi-stat-cancelled', HTMLElement)
const cacheHitsElement = requiredElement('wsi-stat-cache-hits', HTMLElement)
const cacheResidentElement = requiredElement('wsi-stat-cache-resident', HTMLElement)
const measuredBytesElement = requiredElement('wsi-measured-bytes', HTMLElement)
const measuredFractionElement = requiredElement('wsi-measured-fraction', HTMLElement)
const metadataSummaryElement = requiredElement('wsi-metadata-summary', HTMLElement)
const sampleButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>('[data-wsi-sample-url]'),
)

const worker = new Worker(new URL('./wsi-worker.js', import.meta.url), { type: 'module' })
const cache = new Map<string, CachedTile>()
const pendingByKey = new Map<string, RequestedTile>()
const pendingById = new Map<number, RequestedTile>()
const failedKeys = new Set<string>()
const pointerPositions = new Map<number, Point>()
const requestVisuals: RequestVisual[] = []
const maximumCachedTiles = 192
const maximumRequestVisuals = 32
let metadata: WsiMetadata | undefined
let stats: WsiStats = {
  requests: 0,
  bytesFetched: 0,
  sourceCacheBytes: 0,
  tilesDecoded: 0,
  tilesCancelled: 0,
}
let cacheHits = 0
let previousVisibleKeys = new Set<string>()
let nextRequestId = 1
let centerX = 0
let centerY = 0
let zoom = 1
let fittedZoom = 1
let updateFrame: number | undefined
let requestStripFrame: number | undefined

const send = (message: WsiWorkerRequest): void => worker.postMessage(message)
const tileKey = (level: number, column: number, row: number): string => `${level}:${column}:${row}`

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

const fractionForBytes = (bytes: number, size: number): string =>
  size === 0 ? '0.000%' : `${((bytes / size) * 100).toFixed(3)}%`

const fractionText = (): string => fractionForBytes(stats.bytesFetched, metadata?.size ?? 0)

const renderStats = (): void => {
  requestsElement.textContent = stats.requests.toLocaleString()
  bytesElement.textContent = formatBytes(stats.bytesFetched)
  fractionElement.textContent = fractionText()
  decodedElement.textContent = stats.tilesDecoded.toLocaleString()
  cancelledElement.textContent = stats.tilesCancelled.toLocaleString()
  cacheHitsElement.textContent = cacheHits.toLocaleString()
  cacheResidentElement.textContent = `${cache.size.toLocaleString()} tiles / ${formatBytes(stats.sourceCacheBytes)} source cache`
  measuredBytesElement.textContent = formatBytes(stats.bytesFetched)
  measuredFractionElement.textContent = fractionText()
}

const updateRequestStrip = (): void => {
  requestStripFrame = undefined
  requestStrip.replaceChildren()
  for (const item of requestVisuals) {
    const marker = document.createElement('span')
    marker.className = `wsi-request-state ${item.state}`
    marker.textContent = item.label
    marker.title = `${item.label}: ${item.state}`
    marker.setAttribute('aria-label', `${item.label}: ${item.state}`)
    requestStrip.append(marker)
  }
  if (requestVisuals.length === 0) {
    const empty = document.createElement('span')
    empty.className = 'wsi-request-empty'
    empty.textContent = 'Tile activity will appear here.'
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
    state: 'pending',
  })
  while (requestVisuals.length > maximumRequestVisuals) requestVisuals.shift()
  scheduleRequestStripUpdate()
}

const setRequestVisual = (requestId: number, state: RequestVisualState): void => {
  const visual = requestVisuals.find((item) => item.requestId === requestId)
  if (visual) visual.state = state
  scheduleRequestStripUpdate()
}

const clearCache = (): void => {
  for (const tile of cache.values()) tile.bitmap.close()
  cache.clear()
}

const storeTile = (tile: CachedTile): void => {
  const previous = cache.get(tile.key)
  previous?.bitmap.close()
  cache.delete(tile.key)
  cache.set(tile.key, tile)
  while (cache.size > maximumCachedTiles) {
    const oldest = cache.entries().next().value
    if (!oldest) break
    oldest[1].bitmap.close()
    cache.delete(oldest[0])
  }
}

const touchCachedTile = (key: string): CachedTile | undefined => {
  const tile = cache.get(key)
  if (!tile) return undefined
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
  if (!metadata) return
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

const selectLevel = (): WsiLevelMetadata | undefined => {
  if (!metadata) return undefined
  const idealDownsample = 1 / zoom
  let chosen = metadata.levels[0]
  for (const level of metadata.levels) {
    if (level.downsample <= idealDownsample) chosen = level
  }
  return chosen
}

const visibleTiles = (level: WsiLevelMetadata, padding: number): readonly VisibleTile[] => {
  const size = canvasSize()
  const halfWidth = size.x / (2 * zoom)
  const halfHeight = size.y / (2 * zoom)
  const left = Math.max(0, (centerX - halfWidth) / level.downsample)
  const top = Math.max(0, (centerY - halfHeight) / level.downsample)
  const right = Math.min(level.width, (centerX + halfWidth) / level.downsample)
  const bottom = Math.min(level.height, (centerY + halfHeight) / level.downsample)
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
      tiles.push({
        key: tileKey(level.index, column, row),
        level,
        column,
        row,
      })
    }
  }
  return tiles
}

const drawTile = (tile: CachedTile, level: WsiLevelMetadata): void => {
  const size = canvasSize()
  const scale = level.downsample * zoom
  const x = (tile.column * level.tileWidth * level.downsample - centerX) * zoom + size.x / 2
  const y = (tile.row * level.tileHeight * level.downsample - centerY) * zoom + size.y / 2
  context.drawImage(tile.bitmap, x, y, tile.width * scale + 0.5, tile.height * scale + 0.5)
}

const draw = (): void => {
  resizeCanvas()
  const size = canvasSize()
  context.fillStyle = '#0b100d'
  context.fillRect(0, 0, size.x, size.y)
  if (!metadata) return
  const chosen = selectLevel()
  if (!chosen) return
  const drawLevels = metadata.levels.filter((level) => level.index >= chosen.index).reverse()
  for (const level of drawLevels) {
    for (const visible of visibleTiles(level, 0)) {
      const tile = touchCachedTile(visible.key)
      if (tile) drawTile(tile, level)
    }
  }
  const effectiveMagnification = metadata.objectivePower
    ? Math.min(metadata.objectivePower, metadata.objectivePower * zoom)
    : undefined
  levelElement.textContent = `Level ${chosen.index} · ${chosen.downsample.toFixed(chosen.downsample % 1 === 0 ? 0 : 2)}× downsample${effectiveMagnification === undefined ? '' : ` · about ${effectiveMagnification.toFixed(1)}× on screen`}`
}

const requestTile = (tile: VisibleTile): void => {
  const request: RequestedTile = {
    requestId: nextRequestId,
    key: tile.key,
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
    requestId: request.requestId,
    level: request.level,
    column: request.column,
    row: request.row,
  })
}

const updateRequests = (): void => {
  if (!metadata) return
  const chosen = selectLevel()
  const coarsest = metadata.levels.at(-1)
  if (!chosen || !coarsest) return
  const primaryTiles = visibleTiles(chosen, 1)
  const placeholderTiles = chosen.index === coarsest.index ? [] : visibleTiles(coarsest, 0)
  const desiredTiles = [...placeholderTiles, ...primaryTiles]
  const desiredKeys = new Set(desiredTiles.map((tile) => tile.key))
  for (const request of pendingByKey.values()) {
    if (desiredKeys.has(request.key)) continue
    pendingByKey.delete(request.key)
    pendingById.delete(request.requestId)
    setRequestVisual(request.requestId, 'cancelled')
    send({ type: 'cancel', requestId: request.requestId })
  }
  for (const tile of desiredTiles) {
    const cached = cache.has(tile.key)
    if (cached && !previousVisibleKeys.has(tile.key)) cacheHits += 1
    if (!cached && !pendingByKey.has(tile.key) && !failedKeys.has(tile.key)) requestTile(tile)
  }
  previousVisibleKeys = desiredKeys
  renderStats()
}

const updateViewport = (): void => {
  updateFrame = undefined
  clampViewport()
  draw()
  updateRequests()
}

const scheduleViewportUpdate = (): void => {
  if (updateFrame === undefined) updateFrame = requestAnimationFrame(updateViewport)
}

const fitSlide = (): void => {
  if (!metadata) return
  const size = canvasSize()
  fittedZoom = Math.min(size.x / metadata.width, size.y / metadata.height) * 0.94
  zoom = fittedZoom
  centerX = metadata.width / 2
  centerY = metadata.height / 2
  scheduleViewportUpdate()
}

const setZoomAt = (nextZoom: number, screenX: number, screenY: number): void => {
  if (!metadata) return
  const size = canvasSize()
  const minimum = fittedZoom * 0.75
  const bounded = Math.min(4, Math.max(minimum, nextZoom))
  const slideX = centerX + (screenX - size.x / 2) / zoom
  const slideY = centerY + (screenY - size.y / 2) / zoom
  centerX = slideX - (screenX - size.x / 2) / bounded
  centerY = slideY - (screenY - size.y / 2) / bounded
  zoom = bounded
  scheduleViewportUpdate()
}

const pointerCentroid = (points: readonly Point[]): Point => ({
  x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
  y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
})

const pointerDistance = (points: readonly Point[]): number => {
  const first = points[0]
  const second = points[1]
  return first && second ? Math.hypot(second.x - first.x, second.y - first.y) : 0
}

canvas.addEventListener('pointerdown', (event) => {
  canvas.setPointerCapture(event.pointerId)
  pointerPositions.set(event.pointerId, { x: event.offsetX, y: event.offsetY })
  canvas.classList.add('dragging')
})

canvas.addEventListener('pointermove', (event) => {
  const previousPoint = pointerPositions.get(event.pointerId)
  if (!previousPoint || !metadata) return
  const before = [...pointerPositions.values()]
  pointerPositions.set(event.pointerId, { x: event.offsetX, y: event.offsetY })
  const after = [...pointerPositions.values()]
  if (after.length === 1) {
    centerX -= (event.offsetX - previousPoint.x) / zoom
    centerY -= (event.offsetY - previousPoint.y) / zoom
    scheduleViewportUpdate()
    return
  }
  const beforeCenter = pointerCentroid(before)
  const afterCenter = pointerCentroid(after)
  centerX -= (afterCenter.x - beforeCenter.x) / zoom
  centerY -= (afterCenter.y - beforeCenter.y) / zoom
  const beforeDistance = pointerDistance(before)
  const afterDistance = pointerDistance(after)
  if (beforeDistance > 0 && afterDistance > 0) {
    setZoomAt(zoom * (afterDistance / beforeDistance), afterCenter.x, afterCenter.y)
  } else {
    scheduleViewportUpdate()
  }
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

fitButton.addEventListener('click', fitSlide)
zoomInButton.addEventListener('click', () => {
  const size = canvasSize()
  setZoomAt(zoom * 1.8, size.x / 2, size.y / 2)
})
zoomOutButton.addEventListener('click', () => {
  const size = canvasSize()
  setZoomAt(zoom / 1.8, size.x / 2, size.y / 2)
})

const cancelAllRequests = (): void => {
  for (const request of pendingByKey.values())
    send({ type: 'cancel', requestId: request.requestId })
  pendingByKey.clear()
  pendingById.clear()
}

const updateSelectedSample = (url: string): void => {
  let href = ''
  try {
    href = new URL(url, window.location.href).href
  } catch {
    // An incomplete custom URL does not select a verified sample.
  }
  for (const button of sampleButtons) {
    const sampleUrl = button.dataset.wsiSampleUrl
    let sampleHref = ''
    if (sampleUrl !== undefined) {
      try {
        sampleHref = new URL(sampleUrl, window.location.href).href
      } catch {
        // A malformed data attribute cannot be the selected sample.
      }
    }
    button.setAttribute('aria-pressed', String(sampleHref !== '' && sampleHref === href))
  }
}

const openUrl = (): void => {
  const url = urlInput.value.trim()
  try {
    const parsed = new URL(url, window.location.href)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('Use an HTTP or HTTPS URL')
    }
    updateSelectedSample(parsed.href)
    cancelAllRequests()
    clearCache()
    failedKeys.clear()
    requestVisuals.length = 0
    previousVisibleKeys.clear()
    cacheHits = 0
    metadata = undefined
    openButton.disabled = true
    resetButton.disabled = true
    statusElement.textContent = 'Opening the original SVS with HTTP byte ranges…'
    measuredFractionElement.textContent = 'Opening…'
    measuredBytesElement.textContent = 'Reading metadata'
    metadataSummaryElement.textContent = 'Metadata ranges pending'
    updateRequestStrip()
    draw()
    send({ type: 'open', url: parsed.href })
  } catch (cause) {
    statusElement.textContent = cause instanceof Error ? cause.message : 'Invalid slide URL'
  }
}

openButton.addEventListener('click', openUrl)
for (const button of sampleButtons) {
  button.addEventListener('click', () => {
    const sampleUrl = button.dataset.wsiSampleUrl
    if (!sampleUrl) return
    urlInput.value = sampleUrl
    openUrl()
  })
}
urlInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') openUrl()
})
urlInput.addEventListener('input', () => updateSelectedSample(urlInput.value.trim()))
resetButton.addEventListener('click', () => {
  cacheHits = 0
  previousVisibleKeys.clear()
  requestVisuals.length = 0
  updateRequestStrip()
  send({ type: 'reset' })
  statusElement.textContent = 'Counters reset. Pan or zoom to measure new work.'
})

const setMetadata = (opened: WsiMetadata): void => {
  metadata = opened
  slideNameElement.textContent = opened.name
  fileSizeElement.textContent = `${formatBytes(opened.size)} (${opened.size.toLocaleString()} bytes)`
  dimensionsElement.textContent = `${opened.width.toLocaleString()} × ${opened.height.toLocaleString()} (${((opened.width * opened.height) / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 1 })} MP)`
  levelsElement.textContent = `${opened.levels.length} (${opened.levels.map((level) => level.downsample.toFixed(level.downsample % 1 === 0 ? 0 : 2)).join(', ')}×)`
  const first = opened.levels[0]
  tileSizeElement.textContent = first ? `${first.tileWidth} × ${first.tileHeight}` : 'Not available'
  openButton.disabled = false
  resetButton.disabled = false
  statusElement.textContent = `Opened ${opened.name} directly from static object storage.`
  fitSlide()
}

worker.onmessage = (event: MessageEvent<WsiWorkerResponse>): void => {
  const message = event.data
  if (message.type === 'opening') {
    statusElement.textContent = message.message
    return
  }
  if (message.type === 'opened') {
    stats = message.stats
    setMetadata(message.metadata)
    metadataSummaryElement.textContent = `${fractionForBytes(message.stats.bytesFetched, message.metadata.size)} · ${formatBytes(message.stats.bytesFetched)} metadata only`
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
    if (request) pendingByKey.delete(request.key)
    if (!request || !previousVisibleKeys.has(request.key)) {
      message.bitmap.close()
    } else {
      storeTile({
        key: request.key,
        level: message.level,
        column: message.column,
        row: message.row,
        width: message.width,
        height: message.height,
        bitmap: message.bitmap,
      })
      setRequestVisual(message.requestId, 'decoded')
      statusElement.textContent = `Decoded L${message.level} tile ${message.column},${message.row} in ${message.decodeMilliseconds.toFixed(1)} ms.`
    }
    scheduleViewportUpdate()
    renderStats()
    return
  }
  if (message.type === 'tile-cancelled') {
    stats = message.stats
    const request = pendingById.get(message.requestId)
    pendingById.delete(message.requestId)
    if (request) pendingByKey.delete(request.key)
    setRequestVisual(message.requestId, 'cancelled')
    renderStats()
    return
  }
  openButton.disabled = false
  if (message.requestId !== undefined) {
    const request = pendingById.get(message.requestId)
    pendingById.delete(message.requestId)
    if (request) {
      pendingByKey.delete(request.key)
      failedKeys.add(request.key)
    }
    setRequestVisual(message.requestId, 'failed')
  }
  if (message.stats) stats = message.stats
  statusElement.textContent = message.message
  renderStats()
}

worker.onerror = (event): void => {
  openButton.disabled = false
  statusElement.textContent = `Viewer worker failed: ${event.message}`
}

new ResizeObserver(() => scheduleViewportUpdate()).observe(canvas)
window.setInterval(() => send({ type: 'stats' }), 250)
updateRequestStrip()
renderStats()
const configuredUrl = new URL(window.location.href).searchParams.get('url')
if (configuredUrl) urlInput.value = new URL(configuredUrl, window.location.href).href
openUrl()

declare global {
  interface Window {
    pureJsImageWsiReady: boolean
  }
}

window.pureJsImageWsiReady = true
