import type { PixelBlock } from '../../../src/pixel.ts'
import { defaultAperioSvsLimits, openAperioSvs } from '../../../src/pathology/aperio-svs.ts'
import type { WholeSlideImage, WholeSlideLevel } from '../../../src/pathology/whole-slide.ts'
import { HttpRangeSource } from '../../../src/sources/http-range.ts'
import { openTiffDocument } from '../../../src/tiff/index.ts'
import type {
  WsiLevelMetadata,
  WsiMetadata,
  WsiStats,
  WsiWorkerRequest,
  WsiWorkerResponse,
} from './wsi-types.ts'

interface WorkerScope {
  onmessage: ((event: MessageEvent<WsiWorkerRequest>) => void) | null
  postMessage(message: WsiWorkerResponse, transfer?: readonly Transferable[]): void
}

interface TileJob {
  readonly requestId: number
  readonly level: number
  readonly column: number
  readonly row: number
  readonly controller: AbortController
}

const scope = globalThis as unknown as WorkerScope
const controllers = new Map<number, AbortController>()
const tileQueue: TileJob[] = []
const maximumConcurrentDecodes = 4
let activeDecodes = 0
let source: HttpRangeSource | undefined
let slide: WholeSlideImage | undefined
let openController: AbortController | undefined
let openSerial = 0
let sourceBaseline = { requests: 0, bytesFetched: 0 }
let tilesDecoded = 0
let tilesCancelled = 0

const errorMessage = (cause: unknown): string => {
  if (!(cause instanceof Error)) return 'Unknown whole-slide viewer error'
  const nested = cause.cause
  return nested instanceof Error ? `${cause.message}: ${nested.message}` : cause.message
}

const isAbortError = (cause: unknown): boolean =>
  cause instanceof Error && cause.name === 'AbortError'

const currentStats = (): WsiStats => {
  const raw = source?.stats ?? { requests: 0, bytesFetched: 0, cacheBytes: 0 }
  return {
    requests: Math.max(0, raw.requests - sourceBaseline.requests),
    bytesFetched: Math.max(0, raw.bytesFetched - sourceBaseline.bytesFetched),
    sourceCacheBytes: raw.cacheBytes,
    tilesDecoded,
    tilesCancelled,
  }
}

const post = (message: WsiWorkerResponse, transfer: readonly Transferable[] = []): void => {
  scope.postMessage(message, transfer)
}

const levelMetadata = (level: WholeSlideLevel): WsiLevelMetadata => {
  if (level.tileWidth === undefined || level.tileHeight === undefined) {
    throw new Error(`Aperio pyramid level ${level.index} is not tiled`)
  }
  return {
    index: level.index,
    width: level.width,
    height: level.height,
    downsample: level.downsample,
    tileWidth: level.tileWidth,
    tileHeight: level.tileHeight,
  }
}

const slideName = (url: string, properties: Readonly<Record<string, string>>): string => {
  const propertyName = properties['aperio.Filename']
  if (propertyName) return `${propertyName}.svs`
  const pathname = new URL(url).pathname
  return decodeURIComponent(pathname.slice(pathname.lastIndexOf('/') + 1)) || 'Aperio slide'
}

const openSlide = async (url: string): Promise<void> => {
  openSerial += 1
  const serial = openSerial
  openController?.abort()
  const controller = new AbortController()
  openController = controller
  for (const controller of controllers.values()) controller.abort()
  controllers.clear()
  tileQueue.length = 0
  source = undefined
  slide = undefined
  sourceBaseline = { requests: 0, bytesFetched: 0 }
  tilesDecoded = 0
  tilesCancelled = 0
  post({ type: 'opening', message: 'Reading the remote TIFF directory with byte ranges…' })
  try {
    const openedSource = await HttpRangeSource.open(url, {
      blockBytes: 65_536,
      maxCacheBytes: 1_048_576,
      openSignal: controller.signal,
    })
    const document = await openTiffDocument(openedSource, {
      maxInputBytes: defaultAperioSvsLimits.maxSourceBytes,
      maxWidth: defaultAperioSvsLimits.maxWidth,
      maxHeight: defaultAperioSvsLimits.maxHeight,
      maxPixels: defaultAperioSvsLimits.maxWidth * defaultAperioSvsLimits.maxHeight,
      maxFrames: defaultAperioSvsLimits.maxDirectories,
      maxDecodedBytes: defaultAperioSvsLimits.maxRegionDecodedBytes,
      signal: controller.signal,
    })
    const openedSlide = await openAperioSvs(document, {
      signal: controller.signal,
      limits: defaultAperioSvsLimits,
    })
    if (serial !== openSerial) return
    const levels = openedSlide.levels.map(levelMetadata)
    source = openedSource
    slide = openedSlide
    const metadata: WsiMetadata = {
      url,
      name: slideName(url, openedSlide.properties),
      size: openedSource.size,
      width: openedSlide.width,
      height: openedSlide.height,
      levels,
      associatedImages: openedSlide.associatedImages.map(({ id, label, width, height }) => ({
        id,
        label,
        width,
        height,
      })),
      properties: openedSlide.properties,
      ...(openedSlide.micronsPerPixel === undefined
        ? {}
        : { micronsPerPixel: openedSlide.micronsPerPixel }),
      ...(openedSlide.objectivePower === undefined
        ? {}
        : { objectivePower: openedSlide.objectivePower }),
    }
    post({ type: 'opened', metadata, stats: currentStats() })
  } catch (cause) {
    if (serial !== openSerial || isAbortError(cause)) return
    post({ type: 'error', message: errorMessage(cause) })
  }
}

const copyBlock = (
  target: Uint8ClampedArray,
  targetWidth: number,
  targetHeight: number,
  originX: number,
  originY: number,
  block: PixelBlock,
): void => {
  const localX = block.x - originX
  const localY = block.y - originY
  if (
    localX < 0 ||
    localY < 0 ||
    localX + block.width > targetWidth ||
    localY + block.height > targetHeight
  ) {
    throw new Error('Decoded tile block lies outside its requested tile')
  }
  if (block.format !== 'rgb8' && block.format !== 'rgba8' && block.format !== 'gray8') {
    throw new Error(`The WSI demo cannot display ${block.format} tile pixels`)
  }
  const channels = block.format === 'rgba8' ? 4 : block.format === 'rgb8' ? 3 : 1
  for (let row = 0; row < block.height; row += 1) {
    let input = row * block.stride
    let output = ((localY + row) * targetWidth + localX) * 4
    for (let column = 0; column < block.width; column += 1) {
      const red = block.data[input] ?? 0
      const green = channels === 1 ? red : (block.data[input + 1] ?? 0)
      const blue = channels === 1 ? red : (block.data[input + 2] ?? 0)
      target[output] = red
      target[output + 1] = green
      target[output + 2] = blue
      target[output + 3] = channels === 4 ? (block.data[input + 3] ?? 255) : 255
      input += channels
      output += 4
    }
  }
}

const decodeTile = async (
  requestId: number,
  levelIndex: number,
  column: number,
  row: number,
  controller: AbortController,
): Promise<void> => {
  const activeSlide = slide
  const activeSource = source
  const level = activeSlide?.levels[levelIndex]
  if (!activeSlide || !activeSource || !level) {
    controllers.delete(requestId)
    post({ type: 'error', requestId, message: 'Open a slide before requesting tiles' })
    return
  }
  if (level.tileWidth === undefined || level.tileHeight === undefined) {
    controllers.delete(requestId)
    post({ type: 'error', requestId, message: `Level ${levelIndex} is not tiled` })
    return
  }
  const width = Math.min(level.tileWidth, level.width - column * level.tileWidth)
  const height = Math.min(level.tileHeight, level.height - row * level.tileHeight)
  if (width < 1 || height < 1) {
    controllers.delete(requestId)
    post({ type: 'error', requestId, message: 'Requested tile is outside the pyramid level' })
    return
  }
  const started = performance.now()
  try {
    const rgba = new Uint8ClampedArray(width * height * 4)
    for await (const block of level.tile(column, row, { signal: controller.signal })) {
      try {
        // Region decoders report block coordinates relative to the requested tile.
        copyBlock(rgba, width, height, 0, 0, block)
      } finally {
        block.release?.()
      }
    }
    const bitmap = await createImageBitmap(new ImageData(rgba, width, height))
    controllers.delete(requestId)
    tilesDecoded += 1
    post(
      {
        type: 'tile',
        requestId,
        level: levelIndex,
        column,
        row,
        width,
        height,
        decodeMilliseconds: performance.now() - started,
        bitmap,
        stats: currentStats(),
      },
      [bitmap],
    )
  } catch (cause) {
    controllers.delete(requestId)
    if (isAbortError(cause)) {
      post({ type: 'tile-cancelled', requestId, stats: currentStats() })
      return
    }
    post({ type: 'error', requestId, message: errorMessage(cause), stats: currentStats() })
  }
}

const pumpTileQueue = (): void => {
  while (activeDecodes < maximumConcurrentDecodes) {
    const job = tileQueue.shift()
    if (!job) return
    activeDecodes += 1
    void decodeTile(job.requestId, job.level, job.column, job.row, job.controller).finally(() => {
      activeDecodes -= 1
      pumpTileQueue()
    })
  }
}

scope.onmessage = (event): void => {
  const message = event.data
  if (message.type === 'open') {
    void openSlide(message.url)
    return
  }
  if (message.type === 'tile') {
    const controller = new AbortController()
    controllers.set(message.requestId, controller)
    tileQueue.push({
      requestId: message.requestId,
      level: message.level,
      column: message.column,
      row: message.row,
      controller,
    })
    pumpTileQueue()
    return
  }
  if (message.type === 'cancel') {
    const controller = controllers.get(message.requestId)
    if (controller && !controller.signal.aborted) {
      tilesCancelled += 1
      controller.abort()
    }
    return
  }
  if (message.type === 'reset') {
    const raw = source?.stats
    sourceBaseline = {
      requests: raw?.requests ?? 0,
      bytesFetched: raw?.bytesFetched ?? 0,
    }
    tilesDecoded = 0
    tilesCancelled = 0
    post({ type: 'stats', stats: currentStats() })
    return
  }
  post({ type: 'stats', stats: currentStats() })
}
