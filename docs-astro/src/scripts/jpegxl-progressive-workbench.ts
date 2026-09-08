import {
  openJpegXlSession,
  type JpegXlSession,
  type JpegXlProgressiveRequest,
} from '../../../src/jpegxl.ts'
import { resolveLimits } from '../../../src/limits.ts'
import { createImageSource, type ImageSource } from '../../../src/source.ts'
import {
  imageSourceIdentity,
  inheritImageSourceIdentity,
} from '../../../src/source-identity-contract.ts'
import { HttpRangeSource } from '../../../src/sources/http-range.ts'

const input = (id: string): HTMLInputElement => {
  const value = document.getElementById(id)
  if (!(value instanceof HTMLInputElement)) throw new Error(`Missing ${id}`)
  return value
}
const element = (id: string): HTMLElement => {
  const value = document.getElementById(id)
  if (!value) throw new Error(`Missing ${id}`)
  return value
}
const canvas = element('jxl-progressive-canvas')
const map = element('jxl-range-map')
if (!(canvas instanceof HTMLCanvasElement) || !(map instanceof HTMLCanvasElement))
  throw new Error('Missing progressive canvases')
const context = canvas.getContext('2d'),
  mapContext = map.getContext('2d')
if (!context || !mapContext) throw new Error('Canvas 2D is unavailable')
const paint = (image: ImageData): void => {
  if (canvas.width !== image.width) canvas.width = image.width
  if (canvas.height !== image.height) canvas.height = image.height
  context.putImageData(image, 0, 0)
}
let lastComplete: ImageData | undefined
const status = element('jxl-progressive-status')
const metrics = element('jxl-progressive-metrics')
const limits = resolveLimits({
  maxInputBytes: 67_108_864,
  maxPixels: 50_000_000,
  maxDecodedBytes: 268_435_456,
})
let session: JpegXlSession | undefined
let remote: HttpRangeSource | undefined
let controller: AbortController | undefined
let logicalBytes = 0,
  localBytes = 0,
  sourceSize = 0
const ranges = new Uint32Array(256)
let lastKey = ''
let lastFile: File | undefined
let generation = 0
const drawRanges = (start: number, end: number): void => {
  if (sourceSize < 1) return
  const first = Math.floor((start / sourceSize) * ranges.length)
  const last = Math.min(ranges.length - 1, Math.floor(((end - 1) / sourceSize) * ranges.length))
  for (let index = first; index <= last; index++) ranges[index] = (ranges[index] ?? 0) + 1
  mapContext.clearRect(0, 0, map.width, map.height)
  for (let index = 0; index < ranges.length; index++) {
    mapContext.fillStyle = (ranges[index] ?? 0) > 1 ? '#b35a1d' : '#087e8b'
    if (ranges[index])
      mapContext.fillRect(
        (index * map.width) / ranges.length,
        0,
        map.width / ranges.length,
        map.height,
      )
  }
}
const open = async (signal: AbortSignal): Promise<void> => {
  const file = input('jxl-progressive-file').files?.[0]
  const url = input('jxl-progressive-url').value.trim()
  const key = file ? `${file.name}:${file.size}:${file.lastModified}` : url
  if (session && key === lastKey && file === lastFile) return
  await session?.close()
  session = undefined
  remote = undefined
  lastComplete = undefined
  ranges.fill(0)
  mapContext.clearRect(0, 0, map.width, map.height)
  logicalBytes = 0
  localBytes = 0
  sourceSize = 0
  let source: ImageSource
  if (file) source = await createImageSource(file, limits, { buffering: 'none' })
  else {
    if (!url) throw new Error('Choose a JPEG XL file or enter a Range URL')
    remote = await HttpRangeSource.open(new URL(url, location.href), {
      openSignal: signal,
      blockBytes: 4096,
      maxCacheBytes: 1_048_576,
      fetch: async (resource, options) => {
        const response = await fetch(resource, options)
        const extent = response.headers.get('Content-Range')?.match(/\/(\d+)$/)
        if (extent) sourceSize = Number(extent[1])
        const range = new Headers(options?.headers).get('Range')?.match(/^bytes=(\d+)-(\d+)$/)
        if (response.status === 206 && range) drawRanges(Number(range[1]), Number(range[2]) + 1)
        return response
      },
    })
    source = remote
  }
  sourceSize = source.size
  const observed: ImageSource = {
    size: source.size,
    [imageSourceIdentity]: () => inheritImageSourceIdentity(source),
    async read(offset, length, options) {
      logicalBytes += length
      const bytes = await source.read(offset, length, options)
      if (!remote) {
        localBytes += bytes.length
        drawRanges(offset, offset + bytes.length)
      }
      return bytes
    },
  }
  session = await openJpegXlSession(observed, { limits, maxCachedBytes: 16_777_216 })
  lastKey = key
  lastFile = file
}
const run = async (mode: 'native' | 'progressive' | 'viewport'): Promise<void> => {
  if (controller) return
  const requestGeneration = ++generation
  const operation = new AbortController()
  controller = operation
  const started = performance.now()
  let firstPixel: number | undefined
  try {
    status.textContent = 'Opening headers…'
    await open(operation.signal)
    if (operation.signal.aborted || requestGeneration !== generation)
      throw new DOMException('Cancelled', 'AbortError')
    if (!session) throw new Error('Session did not open')
    const scaleValue = Number(input('jxl-progressive-scale').value)
    if (scaleValue !== 1 && scaleValue !== 2 && scaleValue !== 4 && scaleValue !== 8)
      throw new Error('Scale must be 1, 2, 4 or 8')
    const displayWidth = session.orientation >= 5 ? session.height : session.width
    const displayHeight = session.orientation >= 5 ? session.width : session.height
    const fraction = 1 / Number(input('jxl-progressive-zoom').value)
    const width = Math.max(1, Math.floor(displayWidth * fraction)),
      height = Math.max(1, Math.floor(displayHeight * fraction))
    const x = Math.floor(((displayWidth - width) * Number(input('jxl-progressive-x').value)) / 100)
    const y = Math.floor(
      ((displayHeight - height) * Number(input('jxl-progressive-y').value)) / 100,
    )
    const request: JpegXlProgressiveRequest = {
      signal: operation.signal,
      coordinateSpace: 'display' as const,
      scaleDenominator: scaleValue,
      ...(mode === 'viewport' ? { region: { x, y, width, height } } : {}),
    }
    const events = mode === 'native' ? session.native(request) : session.progressive(request)
    let image: ImageData | undefined
    for await (const event of events) {
      if (requestGeneration !== generation) throw new DOMException('Superseded input', 'AbortError')
      if (event.type === 'stage-start') {
        if (event.stage.width * event.stage.height > 4_194_304)
          throw new Error('Display exceeds 4 megapixels. Increase the scale denominator or zoom.')
        image = context.createImageData(event.stage.width, event.stage.height)
        status.textContent = `${event.stage.kind}, completed passes ${event.stage.completedPasses}; native hint 1/${event.stage.intendedDownsampling}`
      } else if (event.type === 'block') {
        try {
          const block = event.block
          if (
            !image ||
            (block.format !== 'rgb8' && block.format !== 'rgba8' && block.format !== 'gray8')
          )
            throw new Error(
              'This progressive canvas requires 8-bit SDR output. Use the color-aware workbench above for other samples.',
            )
          if (
            block.colorSemantics?.transfer.kind !== 'srgb' ||
            block.colorSemantics.primaries !== 'srgb'
          )
            throw new Error(
              'This canvas requires sRGB sample semantics. Use the color-aware workbench above for conversion.',
            )
          const channels = block.format === 'gray8' ? 1 : block.format === 'rgb8' ? 3 : 4
          for (let row = 0; row < block.height; row++)
            for (let column = 0; column < block.width; column++) {
              const source = row * block.stride + column * channels,
                target = ((block.y + row) * image.width + block.x + column) * 4
              image.data[target] = block.data[source] ?? 0
              image.data[target + 1] = block.data[source + (channels === 1 ? 0 : 1)] ?? 0
              image.data[target + 2] = block.data[source + (channels === 1 ? 0 : 2)] ?? 0
              image.data[target + 3] = channels === 4 ? (block.data[source + 3] ?? 0) : 255
            }
          firstPixel ??= performance.now() - started
          if (block.y % 64 === 0) {
            paint(image)
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
          }
        } finally {
          event.block.release?.()
        }
      } else if (event.type === 'stage-complete') {
        if (image) {
          lastComplete = image
          paint(image)
        }
        metrics.textContent = JSON.stringify(
          {
            stage: event.stage.kind,
            completedPasses: event.stage.completedPasses,
            logicalRequestedBytes: logicalBytes,
            physicalReadBytes: remote?.stats.bytesFetched ?? localBytes,
            firstPixelMs: firstPixel,
            elapsedMs: performance.now() - started,
            managedPeakBytes: session.managedPeakBytes,
            sourceCacheBytes: remote?.stats.cacheBytes ?? 0,
            sessionCacheHits: session.sectionCacheHits,
            fullFrameFallback: event.stage.plan.fullFrameFallback,
            workingMemoryClass: event.stage.plan.workingMemoryClass,
            groups: event.stage.plan.groupIds.length,
            fallback: event.stage.plan.fallbackReasons,
          },
          null,
          2,
        )
        status.textContent = `${event.stage.kind} complete. Repeat or move the viewport to exercise cache reuse.`
      }
    }
  } catch (error) {
    if (requestGeneration === generation) {
      if (lastComplete) paint(lastComplete)
      status.textContent = error instanceof Error ? error.message : String(error)
    }
  } finally {
    controller = undefined
  }
}
for (const mode of ['native', 'progressive', 'viewport'] as const)
  element(`jxl-run-${mode}`).addEventListener('click', () => void run(mode))
element('jxl-progressive-cancel').addEventListener('click', () => controller?.abort())
const changedInput = (): void => {
  generation++
  lastKey = ''
  controller?.abort()
  status.textContent = 'Input changed. Choose an action to decode it.'
}
input('jxl-progressive-file').addEventListener('change', changedInput)
input('jxl-progressive-url').addEventListener('input', changedInput)
window.addEventListener('pagehide', () => {
  controller?.abort()
  void session?.close()
})
