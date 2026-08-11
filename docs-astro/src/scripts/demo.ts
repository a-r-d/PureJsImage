import {
  BlobSource,
  createImageLibrary,
  ImageError,
  type Image,
  type ImageDecoder,
  type ImageMetadata,
  type PixelBlock,
} from '../../../src/browser.ts'
import { wasmJpegAccelerator } from '../../../src/accelerator-entries/wasm-jpeg-browser.ts'
import { allCodecs } from '../../../src/codec-entries/all.ts'
import { webpCodec } from '../../../src/codec-entries/webp.ts'
import { createTiffCodec } from '../../../src/codec-entries/tiff.ts'
import { normalizePixelBlocks } from '../../../src/pixel.ts'
import { openTiffDocument } from '../../../src/tiff/index.ts'
import type { TiffDirectory, TiffDocument } from '../../../src/tiff/types.ts'

type OutputFormat = 'bmp' | 'jpeg' | 'png' | 'tiff' | 'webp'
type LogLevel = 'detect' | 'error' | 'info' | 'metric' | 'plan' | 'success' | 'warning'
type DecodeMode = 'typescript' | 'wasm'
type DemoMode = 'convert' | 'view'

interface ViewerChoice {
  readonly directory: TiffDirectory
  readonly frame: number
  readonly resolutionLevel?: number
  readonly label: string
}

interface ViewerRegion {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly viewLeft: number
  readonly viewTop: number
}

interface ViewerSelectionBase {
  readonly file: File
  readonly width: number
  readonly height: number
}

interface TiffViewerSelection extends ViewerSelectionBase {
  readonly kind: 'tiff'
  readonly decoder: ImageDecoder
  readonly choice: ViewerChoice
  readonly document: TiffDocument
  readonly choices: readonly ViewerChoice[]
}

interface ImageViewerSelection extends ViewerSelectionBase {
  readonly kind: 'image'
  readonly image: Image
  readonly metadata: ImageMetadata
}

type ViewerSelection = TiffViewerSelection | ImageViewerSelection

interface LogEntry {
  readonly level: LogLevel
  readonly message: string
  readonly timestamp: string
}

interface ModeTimings {
  typescript?: number
  wasm?: number
}

type ElementConstructor<ElementType extends Element> = {
  new (): ElementType
}

const requiredElement = <ElementType extends Element>(
  id: string,
  Constructor: ElementConstructor<ElementType>,
): ElementType => {
  const candidate = document.getElementById(id)
  if (!(candidate instanceof Constructor)) throw new Error(`Demo element #${id} is missing`)
  return candidate
}

const viewModeButton = requiredElement('demo-mode-view', HTMLButtonElement)
const convertModeButton = requiredElement('demo-mode-convert', HTMLButtonElement)
const viewPanel = requiredElement('demo-view-panel', HTMLElement)
const convertPanel = requiredElement('demo-convert-panel', HTMLElement)
const fileInput = requiredElement('demo-file', HTMLInputElement)
const dropZone = requiredElement('demo-drop-zone', HTMLElement)
const sourcePanel = requiredElement('demo-source', HTMLElement)
const sourcePreview = requiredElement('demo-source-preview', HTMLImageElement)
const sourceFallback = requiredElement('demo-source-fallback', HTMLElement)
const sourceName = requiredElement('demo-source-name', HTMLElement)
const sourceDetails = requiredElement('demo-source-details', HTMLElement)
const sourceBadges = requiredElement('demo-source-badges', HTMLElement)
const conversionForm = requiredElement('demo-form', HTMLFormElement)
const controls = requiredElement('demo-controls', HTMLFieldSetElement)
const outputFormat = requiredElement('demo-output-format', HTMLSelectElement)
const qualityGroup = requiredElement('demo-quality-group', HTMLElement)
const qualityInput = requiredElement('demo-quality', HTMLInputElement)
const qualityValue = requiredElement('demo-quality-value', HTMLOutputElement)
const webpLosslessGroup = requiredElement('demo-webp-lossless-group', HTMLElement)
const webpLossless = requiredElement('demo-webp-lossless', HTMLInputElement)
const jpegProgressiveGroup = requiredElement('demo-jpeg-progressive-group', HTMLElement)
const jpegProgressive = requiredElement('demo-jpeg-progressive', HTMLInputElement)
const autoOrient = requiredElement('demo-auto-orient', HTMLInputElement)
const resizeEnabled = requiredElement('demo-resize-enabled', HTMLInputElement)
const resizeFields = requiredElement('demo-resize-fields', HTMLElement)
const resizeWidth = requiredElement('demo-resize-width', HTMLInputElement)
const resizeHeight = requiredElement('demo-resize-height', HTMLInputElement)
const rotation = requiredElement('demo-rotation', HTMLSelectElement)
const flipVertical = requiredElement('demo-flip', HTMLInputElement)
const flipHorizontal = requiredElement('demo-flop', HTMLInputElement)
const wasmEnabled = requiredElement('demo-wasm-enabled', HTMLInputElement)
const acceleratorStatus = requiredElement('demo-accelerator-status', HTMLElement)
const convertButton = requiredElement('demo-convert', HTMLButtonElement)
const convertLabel = requiredElement('demo-convert-label', HTMLElement)
const operationStatus = requiredElement('demo-operation-status', HTMLElement)
const resultPanel = requiredElement('demo-result', HTMLElement)
const resultPreview = requiredElement('demo-result-preview', HTMLImageElement)
const resultFallback = requiredElement('demo-result-fallback', HTMLElement)
const resultSummary = requiredElement('demo-result-summary', HTMLElement)
const downloadLink = requiredElement('demo-download', HTMLAnchorElement)
const elapsedMetric = requiredElement('demo-metric-elapsed', HTMLElement)
const providerMetric = requiredElement('demo-metric-provider', HTMLElement)
const comparisonMetric = requiredElement('demo-metric-comparison', HTMLElement)
const memoryMetric = requiredElement('demo-metric-memory', HTMLElement)
const knownBytesMetric = requiredElement('demo-metric-known-bytes', HTMLElement)
const outputBytesMetric = requiredElement('demo-metric-output', HTMLElement)
const logList = requiredElement('demo-log-list', HTMLOListElement)
const clearLogButton = requiredElement('demo-clear-log', HTMLButtonElement)
const copyLogButton = requiredElement('demo-copy-log', HTMLButtonElement)
const viewerName = requiredElement('demo-viewer-name', HTMLElement)
const viewerSubtitle = requiredElement('demo-viewer-subtitle', HTMLElement)
const viewerStage = requiredElement('demo-viewer-stage', HTMLElement)
const viewerCanvas = requiredElement('demo-viewer-canvas', HTMLCanvasElement)
const viewerEmpty = requiredElement('demo-viewer-empty', HTMLElement)
const viewerLoading = requiredElement('demo-viewer-loading', HTMLElement)
const viewerLoadingLabel = requiredElement('demo-viewer-loading-label', HTMLElement)
const viewerDirectory = requiredElement('demo-viewer-directory', HTMLSelectElement)
const viewerDimensions = requiredElement('demo-viewer-dimensions', HTMLElement)
const viewerCompression = requiredElement('demo-viewer-compression', HTMLElement)
const viewerSamples = requiredElement('demo-viewer-samples', HTMLElement)
const viewerStorage = requiredElement('demo-viewer-storage', HTMLElement)
const viewerStatus = requiredElement('demo-viewer-status', HTMLElement)
const viewerRegion = requiredElement('demo-viewer-region', HTMLElement)
const zoomOutButton = requiredElement('demo-zoom-out', HTMLButtonElement)
const zoomInButton = requiredElement('demo-zoom-in', HTMLButtonElement)
const zoomFitButton = requiredElement('demo-zoom-fit', HTMLButtonElement)
const zoomActualButton = requiredElement('demo-zoom-actual', HTMLButtonElement)
const panLeftButton = requiredElement('demo-pan-left', HTMLButtonElement)
const panUpButton = requiredElement('demo-pan-up', HTMLButtonElement)
const panDownButton = requiredElement('demo-pan-down', HTMLButtonElement)
const panRightButton = requiredElement('demo-pan-right', HTMLButtonElement)
const zoomValue = requiredElement('demo-zoom-value', HTMLOutputElement)
const saveClipButton = requiredElement('demo-save-clip', HTMLButtonElement)
const exampleStatus = requiredElement('demo-example-status', HTMLElement)
const sampleSearch = requiredElement('demo-sample-search', HTMLInputElement)
const sampleEmpty = requiredElement('demo-sample-empty', HTMLElement)
const sampleCards = Array.from(document.querySelectorAll<HTMLElement>('[data-demo-sample-card]'))
const exampleButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>('[data-demo-sample]'),
)
if (sampleCards.length === 0 || exampleButtons.length === 0) {
  throw new Error('Demo sample library is missing')
}

const demoCodecs = [
  ...allCodecs.filter((codec) => codec.format !== 'tiff'),
  createTiffCodec({ embeddedCodecs: [webpCodec] }),
]
const viewerImages = createImageLibrary(demoCodecs)
const referenceImages = createImageLibrary(demoCodecs)
const acceleratedImages = createImageLibrary({
  codecs: demoCodecs,
  accelerators: [wasmJpegAccelerator],
})
const sessionStartedAt = performance.now()
const logEntries: LogEntry[] = []
const comparisonTimings = new Map<string, ModeTimings>()
const maximumLogEntries = 200
const maximumComparisonEntries = 32
const demoLimits = Object.freeze({
  maxDecodedBytes: 268_435_456,
  maxFrames: 256,
  maxHeight: 65_536,
  maxInputBytes: 67_108_864,
  maxPixels: 67_108_864,
  maxWidth: 65_536,
})
const viewerLimits = Object.freeze({
  maxDecodedBytes: 268_435_456,
  maxFrames: 4_096,
  maxHeight: 500_000,
  maxInputBytes: 1_073_741_824,
  maxPixels: 100_000_000_000,
  maxWidth: 500_000,
})
const maximumClipPixels = 16_777_216
const maximumExampleBytes = 8_388_608

let selectedFile: File | undefined
let selectedImage: Image | undefined
let selectedMetadata: ImageMetadata | undefined
let sourceObjectUrl: string | undefined
let resultObjectUrl: string | undefined
let inspectionSequence = 0
let viewerSelection: ViewerSelection | undefined
let viewerZoom = 1
let viewerCenterX = 0
let viewerCenterY = 0
let viewerRenderSequence = 0
let viewerRenderFrame: number | undefined
let viewerRenderController: AbortController | undefined
let viewerClipUrl: string | undefined
let pointerDrag:
  | {
      readonly id: number
      readonly startCenterX: number
      readonly startCenterY: number
      readonly startX: number
      readonly startY: number
    }
  | undefined

const outputTypes: Readonly<
  Record<
    OutputFormat,
    { readonly extension: string; readonly label: string; readonly mime: string }
  >
> = Object.freeze({
  bmp: { extension: 'bmp', label: 'BMP', mime: 'image/bmp' },
  jpeg: { extension: 'jpg', label: 'JPEG', mime: 'image/jpeg' },
  png: { extension: 'png', label: 'PNG', mime: 'image/png' },
  tiff: { extension: 'tiff', label: 'TIFF', mime: 'image/tiff' },
  webp: { extension: 'webp', label: 'WebP', mime: 'image/webp' },
})

const formatBytes = (bytes: number): string => {
  if (bytes < 1_024) return `${bytes} B`
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KiB`
  return `${(bytes / 1_048_576).toFixed(bytes < 10_485_760 ? 2 : 1)} MiB`
}

const formatDuration = (milliseconds: number): string =>
  milliseconds < 1_000 ? `${milliseconds.toFixed(1)} ms` : `${(milliseconds / 1_000).toFixed(2)} s`

const logTimestamp = (): string => {
  const elapsed = performance.now() - sessionStartedAt
  const minutes = Math.floor(elapsed / 60_000)
  const seconds = Math.floor((elapsed % 60_000) / 1_000)
  const milliseconds = Math.floor(elapsed % 1_000)
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`
}

const addLog = (level: LogLevel, message: string): void => {
  const entry = Object.freeze({ level, message, timestamp: logTimestamp() })
  logEntries.push(entry)
  if (logEntries.length > maximumLogEntries) logEntries.shift()

  const row = document.createElement('li')
  row.dataset.level = level
  const timestamp = document.createElement('span')
  timestamp.className = 'demo-log-time'
  timestamp.textContent = entry.timestamp
  const label = document.createElement('span')
  label.className = 'demo-log-level'
  label.textContent = level.toUpperCase()
  const text = document.createElement('span')
  text.className = 'demo-log-message'
  text.textContent = message
  row.append(timestamp, label, text)
  logList.append(row)
  while (logList.children.length > maximumLogEntries) logList.firstElementChild?.remove()
  logList.scrollTop = logList.scrollHeight
}

const errorMessage = (error: unknown): string => {
  if (error instanceof ImageError) return `${error.code}: ${error.message}`
  if (error instanceof Error) return error.message
  return 'The operation failed with an unknown error'
}

const observedJsHeapBytes = (): number | undefined => {
  const candidate: unknown = performance
  if (typeof candidate !== 'object' || candidate === null || !('memory' in candidate)) {
    return undefined
  }
  const memory = candidate.memory
  if (
    typeof memory !== 'object' ||
    memory === null ||
    !('usedJSHeapSize' in memory) ||
    typeof memory.usedJSHeapSize !== 'number' ||
    !Number.isFinite(memory.usedJSHeapSize)
  ) {
    return undefined
  }
  return memory.usedJSHeapSize
}

const setImagePreview = (
  image: HTMLImageElement,
  fallback: HTMLElement,
  url: string,
  description: string,
): void => {
  image.hidden = false
  fallback.hidden = true
  image.alt = description
  image.src = url
}

sourcePreview.addEventListener('load', () => {
  sourcePreview.hidden = false
  sourceFallback.hidden = true
})
sourcePreview.addEventListener('error', () => {
  sourcePreview.hidden = true
  sourceFallback.hidden = false
  sourceFallback.textContent =
    'This browser cannot preview the source format, but PureJsImage can still inspect it.'
})
resultPreview.addEventListener('load', () => {
  resultPreview.hidden = false
  resultFallback.hidden = true
})
resultPreview.addEventListener('error', () => {
  resultPreview.hidden = true
  resultFallback.hidden = false
  resultFallback.textContent =
    'The conversion succeeded. This browser does not natively preview this output format.'
})

const revokeUrl = (url: string | undefined): void => {
  if (url !== undefined) URL.revokeObjectURL(url)
}

const resetResult = (): void => {
  revokeUrl(resultObjectUrl)
  resultObjectUrl = undefined
  resultPreview.removeAttribute('src')
  resultPanel.hidden = true
  downloadLink.removeAttribute('href')
  elapsedMetric.textContent = '—'
  providerMetric.textContent = '—'
  comparisonMetric.textContent = '—'
  memoryMetric.textContent = '—'
  knownBytesMetric.textContent = '—'
  outputBytesMetric.textContent = '—'
}

const outputFormatValue = (): OutputFormat => {
  const value = outputFormat.value
  if (
    value === 'bmp' ||
    value === 'jpeg' ||
    value === 'png' ||
    value === 'tiff' ||
    value === 'webp'
  ) {
    return value
  }
  throw new Error(`Unknown output format: ${value}`)
}

const recommendedOutput = (metadata: ImageMetadata): OutputFormat => {
  if (metadata.hasAlpha) return metadata.format === 'png' ? 'webp' : 'png'
  return metadata.format === 'jpeg' ? 'webp' : 'jpeg'
}

const updateOutputOptions = (): void => {
  const format = outputFormatValue()
  qualityGroup.hidden = format !== 'jpeg' && format !== 'webp'
  webpLosslessGroup.hidden = format !== 'webp'
  jpegProgressiveGroup.hidden = format !== 'jpeg'
  qualityInput.disabled = format === 'webp' && webpLossless.checked
}

const updateResizeFields = (): void => {
  resizeFields.hidden = !resizeEnabled.checked
  resizeWidth.disabled = !resizeEnabled.checked
  resizeHeight.disabled = !resizeEnabled.checked
}

const selectedDecodeMode = (): DecodeMode => (wasmEnabled.checked ? 'wasm' : 'typescript')

const updateAccelerationStatus = (): void => {
  const mode = selectedDecodeMode()
  convertLabel.textContent =
    mode === 'wasm' ? 'Convert with WASM enabled' : 'Convert with TypeScript'
  if (mode === 'typescript') {
    acceleratorStatus.textContent =
      'TypeScript reference selected. Run the same settings in both modes to compare complete pipeline time.'
    return
  }
  if (!selectedMetadata) {
    acceleratorStatus.textContent =
      'WASM is enabled. Eligible baseline JPEG decode will load the optional module only when conversion starts.'
    return
  }
  if (selectedMetadata.format !== 'jpeg') {
    acceleratorStatus.textContent =
      'WASM is enabled, but the current accelerator only handles JPEG decode. This input stays on TypeScript.'
    return
  }
  if (selectedMetadata.width * selectedMetadata.height < 1_000_000) {
    acceleratorStatus.textContent =
      'WASM is enabled, but this JPEG is below the production one-megapixel threshold and stays on TypeScript.'
    return
  }
  if (resizeEnabled.checked) {
    acceleratorStatus.textContent =
      'WASM is enabled. Resize planning may keep TypeScript when native scaled decode can do less work.'
    return
  }
  acceleratorStatus.textContent =
    'WASM is enabled. Eligible full-image baseline YCbCr JPEGs use it; unsupported syntax falls back safely.'
}

const createBadge = (label: string): HTMLElement => {
  const badge = document.createElement('span')
  badge.className = 'demo-badge'
  badge.textContent = label
  return badge
}

const countLabel = (metadata: ImageMetadata): string | undefined => {
  const count = metadata.frames
  if (count === undefined) return undefined
  const noun = metadata.format === 'jpeg' ? 'image' : 'frame'
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

const describeMetadata = (metadata: ImageMetadata): void => {
  const count = countLabel(metadata)
  sourceBadges.replaceChildren(
    createBadge(metadata.format.toUpperCase()),
    createBadge(metadata.hasAlpha ? 'Alpha' : 'Opaque'),
    createBadge(`${metadata.bitDepth ?? 8}-bit`),
    ...(count === undefined ? [] : [createBadge(count)]),
  )
}

const setMode = (mode: DemoMode): void => {
  const viewing = mode === 'view'
  viewModeButton.classList.toggle('active', viewing)
  convertModeButton.classList.toggle('active', !viewing)
  viewModeButton.setAttribute('aria-selected', String(viewing))
  convertModeButton.setAttribute('aria-selected', String(!viewing))
  viewPanel.hidden = !viewing
  convertPanel.hidden = viewing
  if (viewing && viewerSelection) {
    if (viewerCanvas.dataset.rendered !== 'true') fitViewer()
    scheduleViewerRender()
  }
}

const setViewerLoading = (visible: boolean, label = 'Rendering visible image region…'): void => {
  viewerLoading.hidden = !visible
  viewerLoadingLabel.textContent = label
}

const setViewerControls = (enabled: boolean, directoryEnabled = enabled): void => {
  viewerDirectory.disabled = !directoryEnabled
  zoomOutButton.disabled = !enabled
  zoomInButton.disabled = !enabled
  zoomFitButton.disabled = !enabled
  zoomActualButton.disabled = !enabled
  panLeftButton.disabled = !enabled
  panUpButton.disabled = !enabled
  panDownButton.disabled = !enabled
  panRightButton.disabled = !enabled
  saveClipButton.disabled = !enabled
}

const resetViewer = (): void => {
  viewerRenderSequence += 1
  viewerRenderController?.abort()
  viewerRenderController = undefined
  if (viewerRenderFrame !== undefined) cancelAnimationFrame(viewerRenderFrame)
  viewerRenderFrame = undefined
  viewerSelection = undefined
  pointerDrag = undefined
  viewerCanvas.hidden = true
  viewerCanvas.removeAttribute('data-rendered')
  viewerEmpty.hidden = false
  setViewerLoading(false)
  setViewerControls(false)
  viewerDirectory.replaceChildren(new Option('Choose an image first', ''))
  viewerName.textContent = 'Image viewport'
  viewerSubtitle.textContent = 'Choose any supported image'
  viewerDimensions.textContent = '—'
  viewerCompression.textContent = '—'
  viewerSamples.textContent = '—'
  viewerStorage.textContent = '—'
  viewerStatus.textContent = 'Waiting for a local image.'
  viewerRegion.textContent = 'No region selected'
  zoomValue.value = '—'
}

const tiffHeader = async (file: File): Promise<boolean> => {
  const bytes = new Uint8Array(await file.slice(0, 4).arrayBuffer())
  return (
    (bytes[0] === 0x49 &&
      bytes[1] === 0x49 &&
      ((bytes[2] === 0x2a && bytes[3] === 0) || (bytes[2] === 0x2b && bytes[3] === 0))) ||
    (bytes[0] === 0x4d &&
      bytes[1] === 0x4d &&
      ((bytes[2] === 0 && bytes[3] === 0x2a) || (bytes[2] === 0 && bytes[3] === 0x2b)))
  )
}

const compressionName = (compression: number): string => {
  const names: Readonly<Record<number, string>> = {
    1: 'Uncompressed',
    2: 'CCITT RLE',
    3: 'CCITT Group 3',
    4: 'CCITT Group 4',
    5: 'LZW',
    6: 'Old-style JPEG',
    7: 'JPEG',
    32773: 'PackBits',
    32946: 'Deflate',
    33003: 'Aperio JPEG 2000 YCbCr',
    33005: 'Aperio JPEG 2000 MCT',
    34676: 'SGILog',
    34677: 'SGILog24',
    34925: 'LZMA',
    50000: 'Zstandard',
    50001: 'WebP',
  }
  return names[compression] ?? `Tag ${compression}`
}

const viewerChoices = (document: TiffDocument): readonly ViewerChoice[] => {
  const choices: ViewerChoice[] = []
  document.topLevelDirectories.forEach((directory, frame) => {
    choices.push({
      directory,
      frame,
      label: `Image ${frame + 1} · ${directory.width.toLocaleString()} × ${directory.height.toLocaleString()}`,
    })
    directory.subIfds.forEach((child, childIndex) => {
      choices.push({
        directory: child,
        frame,
        resolutionLevel: childIndex + 1,
        label: `Image ${frame + 1} · reduced ${childIndex + 1} · ${child.width.toLocaleString()} × ${child.height.toLocaleString()}`,
      })
    })
  })
  return Object.freeze(choices)
}

const canvasMetrics = (): {
  readonly cssWidth: number
  readonly cssHeight: number
  readonly dpr: number
} => {
  const cssWidth = Math.max(1, viewerStage.clientWidth)
  const cssHeight = Math.max(1, viewerStage.clientHeight)
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const pixelWidth = Math.max(1, Math.round(cssWidth * dpr))
  const pixelHeight = Math.max(1, Math.round(cssHeight * dpr))
  if (viewerCanvas.width !== pixelWidth) viewerCanvas.width = pixelWidth
  if (viewerCanvas.height !== pixelHeight) viewerCanvas.height = pixelHeight
  return { cssWidth, cssHeight, dpr }
}

const minimumViewerZoom = (selection: ViewerSelection): number => {
  const { cssWidth, cssHeight } = canvasMetrics()
  return Math.max(
    0.000_01,
    Math.min((cssWidth * 0.96) / selection.width, (cssHeight * 0.96) / selection.height) / 8,
  )
}

const clampViewerCenter = (): void => {
  const selection = viewerSelection
  if (!selection) return
  const { cssWidth, cssHeight } = canvasMetrics()
  const halfWidth = cssWidth / (2 * viewerZoom)
  const halfHeight = cssHeight / (2 * viewerZoom)
  viewerCenterX =
    halfWidth >= selection.width / 2
      ? selection.width / 2
      : Math.max(halfWidth, Math.min(selection.width - halfWidth, viewerCenterX))
  viewerCenterY =
    halfHeight >= selection.height / 2
      ? selection.height / 2
      : Math.max(halfHeight, Math.min(selection.height - halfHeight, viewerCenterY))
}

const currentViewerRegion = (): ViewerRegion | undefined => {
  const selection = viewerSelection
  if (!selection) return undefined
  const { cssWidth, cssHeight } = canvasMetrics()
  const visibleWidth = cssWidth / viewerZoom
  const visibleHeight = cssHeight / viewerZoom
  const viewLeft = viewerCenterX - visibleWidth / 2
  const viewTop = viewerCenterY - visibleHeight / 2
  const x = Math.max(0, Math.floor(viewLeft))
  const y = Math.max(0, Math.floor(viewTop))
  const right = Math.min(selection.width, Math.ceil(viewLeft + visibleWidth))
  const bottom = Math.min(selection.height, Math.ceil(viewTop + visibleHeight))
  return {
    x,
    y,
    width: Math.max(1, right - x),
    height: Math.max(1, bottom - y),
    viewLeft,
    viewTop,
  }
}

const fitViewer = (): void => {
  const selection = viewerSelection
  if (!selection) return
  const { cssWidth, cssHeight } = canvasMetrics()
  viewerZoom = Math.min((cssWidth * 0.96) / selection.width, (cssHeight * 0.96) / selection.height)
  viewerCenterX = selection.width / 2
  viewerCenterY = selection.height / 2
}

const normalizedBlockImageData = (block: PixelBlock): ImageData => {
  const channels = block.format === 'gray8' ? 1 : block.format === 'rgb8' ? 3 : 4
  if (block.format !== 'gray8' && block.format !== 'rgb8' && block.format !== 'rgba8') {
    block.release?.()
    throw new Error(`Viewer cannot paint ${block.format} pixels`)
  }
  const rowBytes = block.width * channels
  const requiredBytes = block.stride * (block.height - 1) + rowBytes
  if (block.stride < rowBytes || block.data.byteLength < requiredBytes) {
    block.release?.()
    throw new Error('Viewer received a truncated pixel block')
  }
  const rgba = new Uint8ClampedArray(block.width * block.height * 4)
  for (let y = 0; y < block.height; y += 1) {
    let source = y * block.stride
    let target = y * block.width * 4
    for (let x = 0; x < block.width; x += 1) {
      if (channels === 1) {
        const gray = block.data[source] ?? 0
        rgba[target] = gray
        rgba[target + 1] = gray
        rgba[target + 2] = gray
        rgba[target + 3] = 255
      } else {
        rgba[target] = block.data[source] ?? 0
        rgba[target + 1] = block.data[source + 1] ?? 0
        rgba[target + 2] = block.data[source + 2] ?? 0
        rgba[target + 3] = channels === 4 ? (block.data[source + 3] ?? 0) : 255
      }
      source += channels
      target += 4
    }
  }
  block.release?.()
  return new ImageData(rgba, block.width, block.height)
}

const scratchCanvas = document.createElement('canvas')

const renderViewer = async (): Promise<void> => {
  const selection = viewerSelection
  if (!selection || viewPanel.hidden) return
  const sequence = ++viewerRenderSequence
  viewerRenderController?.abort()
  const controller = new AbortController()
  viewerRenderController = controller
  clampViewerCenter()
  const region = currentViewerRegion()
  if (!region) return
  const { dpr } = canvasMetrics()
  const context = viewerCanvas.getContext('2d', { alpha: false })
  if (!context) throw new Error('Canvas 2D rendering is unavailable')

  viewerStatus.textContent = 'Decoding the visible region…'
  viewerRegion.textContent = `${region.x.toLocaleString()}, ${region.y.toLocaleString()} · ${region.width.toLocaleString()} × ${region.height.toLocaleString()} px`
  zoomValue.value = `${Math.round(viewerZoom * 100)}%`
  const loadingTimer = window.setTimeout(() => {
    if (sequence === viewerRenderSequence) setViewerLoading(true)
  }, 120)
  const startedAt = performance.now()

  try {
    context.fillStyle = '#101411'
    context.fillRect(0, 0, viewerCanvas.width, viewerCanvas.height)
    context.imageSmoothingEnabled = viewerZoom < 1
    context.imageSmoothingQuality = 'high'
    if (selection.kind === 'tiff') {
      const blocks = normalizePixelBlocks(
        selection.decoder.decode({
          x: region.x,
          y: region.y,
          width: region.width,
          height: region.height,
          signal: controller.signal,
        }),
        selection.decoder.pixelFormat,
        { signal: controller.signal },
      )
      for await (const block of blocks) {
        if (sequence !== viewerRenderSequence) {
          block.release?.()
          return
        }
        const imageData = normalizedBlockImageData(block)
        if (scratchCanvas.width !== imageData.width) scratchCanvas.width = imageData.width
        if (scratchCanvas.height !== imageData.height) scratchCanvas.height = imageData.height
        const scratch = scratchCanvas.getContext('2d', { alpha: false })
        if (!scratch) throw new Error('Scratch canvas rendering is unavailable')
        scratch.putImageData(imageData, 0, 0)
        const sourceX = region.x + block.x
        const sourceY = region.y + block.y
        context.drawImage(
          scratchCanvas,
          (sourceX - region.viewLeft) * viewerZoom * dpr,
          (sourceY - region.viewTop) * viewerZoom * dpr,
          block.width * viewerZoom * dpr,
          block.height * viewerZoom * dpr,
        )
      }
    } else {
      const targetWidth = Math.max(
        1,
        Math.min(viewerCanvas.width, Math.round(region.width * viewerZoom * dpr)),
      )
      const targetHeight = Math.max(
        1,
        Math.min(viewerCanvas.height, Math.round(region.height * viewerZoom * dpr)),
      )
      const blob = await selection.image
        .crop({ x: region.x, y: region.y, width: region.width, height: region.height })
        .resize({ width: targetWidth, height: targetHeight, fit: 'fill' })
        .png()
        .toBlob({ signal: controller.signal })
      const bitmap = await createImageBitmap(blob)
      try {
        if (sequence !== viewerRenderSequence) return
        context.drawImage(
          bitmap,
          (region.x - region.viewLeft) * viewerZoom * dpr,
          (region.y - region.viewTop) * viewerZoom * dpr,
          region.width * viewerZoom * dpr,
          region.height * viewerZoom * dpr,
        )
      } finally {
        bitmap.close()
      }
    }
    if (sequence !== viewerRenderSequence) return
    const elapsed = performance.now() - startedAt
    viewerCanvas.hidden = false
    viewerCanvas.dataset.rendered = 'true'
    viewerEmpty.hidden = true
    viewerStatus.textContent = `Visible region rendered in ${formatDuration(elapsed)}. Drag to pan or scroll to zoom.`
    addLog(
      'metric',
      `${selection.kind === 'tiff' ? 'TIFF' : selection.metadata.format.toUpperCase()} viewport ${region.x},${region.y} ${region.width}×${region.height} rendered in ${formatDuration(elapsed)}.`,
    )
  } catch (error: unknown) {
    if (controller.signal.aborted || sequence !== viewerRenderSequence) return
    viewerStatus.textContent = errorMessage(error)
    addLog('error', `Viewer: ${errorMessage(error)}`)
  } finally {
    window.clearTimeout(loadingTimer)
    if (viewerRenderController === controller) viewerRenderController = undefined
    if (sequence === viewerRenderSequence) setViewerLoading(false)
  }
}

const scheduleViewerRender = (): void => {
  viewerRenderController?.abort()
  viewerRenderController = undefined
  if (viewerRenderFrame !== undefined) cancelAnimationFrame(viewerRenderFrame)
  viewerRenderFrame = requestAnimationFrame(() => {
    viewerRenderFrame = undefined
    void renderViewer()
  })
}

const zoomViewer = (factor: number, clientX?: number, clientY?: number): void => {
  const selection = viewerSelection
  if (!selection) return
  const bounds = viewerStage.getBoundingClientRect()
  const anchorX = clientX === undefined ? bounds.width / 2 : clientX - bounds.left
  const anchorY = clientY === undefined ? bounds.height / 2 : clientY - bounds.top
  const sourceX = viewerCenterX + (anchorX - bounds.width / 2) / viewerZoom
  const sourceY = viewerCenterY + (anchorY - bounds.height / 2) / viewerZoom
  const nextZoom = Math.max(minimumViewerZoom(selection), Math.min(32, viewerZoom * factor))
  viewerCenterX = sourceX - (anchorX - bounds.width / 2) / nextZoom
  viewerCenterY = sourceY - (anchorY - bounds.height / 2) / nextZoom
  viewerZoom = nextZoom
  clampViewerCenter()
  scheduleViewerRender()
}

const panViewer = (horizontal: number, vertical: number): void => {
  if (!viewerSelection) return
  const { cssWidth, cssHeight } = canvasMetrics()
  viewerCenterX += (horizontal * cssWidth) / viewerZoom / 8
  viewerCenterY += (vertical * cssHeight) / viewerZoom / 8
  clampViewerCenter()
  scheduleViewerRender()
}

const updateViewerFacts = (selection: ViewerSelection): void => {
  viewerName.textContent = selection.file.name
  viewerDimensions.textContent = `${selection.width.toLocaleString()} × ${selection.height.toLocaleString()}`
  if (selection.kind === 'image') {
    const count = countLabel(selection.metadata)
    viewerSubtitle.textContent = `${selection.metadata.format.toUpperCase()} · ${selection.metadata.mimeType}`
    viewerCompression.textContent = selection.metadata.format.toUpperCase()
    viewerSamples.textContent = `${selection.metadata.bitDepth ?? 8}-bit · ${selection.metadata.hasAlpha ? 'alpha' : 'opaque'}`
    viewerStorage.textContent = count ?? '1 image'
    return
  }
  const { directory } = selection.choice
  viewerSubtitle.textContent = `${selection.document.bigTiff ? 'BigTIFF' : 'Classic TIFF'} · ${selection.document.topLevelDirectories.length} top-level image${selection.document.topLevelDirectories.length === 1 ? '' : 's'}`
  viewerCompression.textContent = `TIFF · ${compressionName(directory.compression)}`
  viewerSamples.textContent = `${directory.samplesPerPixel} × ${directory.bitsPerSample.join('/')} bit · format ${directory.sampleFormats.join('/')}`
  viewerStorage.textContent = directory.tiled
    ? `Tiled ${directory.tileWidth ?? '?'} × ${directory.tileHeight ?? '?'} · ${directory.planar ? 'planar' : 'chunky'}`
    : `Stripped · ${directory.planar ? 'planar' : 'chunky'}`
}

const selectViewerChoice = async (index: number, renderImmediately: boolean): Promise<void> => {
  const current = viewerSelection
  if (current?.kind !== 'tiff') return
  const choice = current.choices[index]
  if (!choice) throw new Error('Selected TIFF image is unavailable')
  setViewerLoading(true, 'Preparing TIFF image…')
  const decoder = await choice.directory.createImageDecoder()
  const selection: TiffViewerSelection = {
    ...current,
    choice,
    decoder,
    width: choice.directory.width,
    height: choice.directory.height,
  }
  viewerSelection = selection
  viewerDirectory.value = String(index)
  updateViewerFacts(selection)
  fitViewer()
  setViewerLoading(false)
  addLog(
    'detect',
    `${choice.label}; ${compressionName(choice.directory.compression)}, ${decoder.pixelFormat}, ${choice.directory.tiled ? 'tiled' : 'stripped'}.`,
  )
  if (renderImmediately) await renderViewer()
  else scheduleViewerRender()
}

const prepareTiffViewer = async (file: File): Promise<void> => {
  setViewerLoading(true, 'Reading TIFF directory graph…')
  const document = await openTiffDocument(new BlobSource(file), {
    ...viewerLimits,
    embeddedCodecs: [webpCodec],
  })
  const choices = viewerChoices(document)
  const first = choices[0]
  if (!first) throw new Error('TIFF contains no displayable directories')
  const decoder = await first.directory.createImageDecoder()
  viewerSelection = {
    kind: 'tiff',
    choice: first,
    choices,
    decoder,
    document,
    file,
    width: first.directory.width,
    height: first.directory.height,
  }
  viewerDirectory.replaceChildren(
    ...choices.map((choice, index) => new Option(choice.label, String(index))),
  )
  setViewerControls(true)
  updateViewerFacts(viewerSelection)
  sourceDetails.textContent = `${first.directory.width.toLocaleString()} × ${first.directory.height.toLocaleString()} · ${formatBytes(file.size)} · ${choices.length} viewable image${choices.length === 1 ? '' : 's'}`
  sourceBadges.replaceChildren(
    createBadge(document.bigTiff ? 'BigTIFF' : 'TIFF'),
    createBadge(`${first.directory.bitsPerSample.join('/')}-bit`),
    createBadge(first.directory.tiled ? 'Tiled' : 'Stripped'),
    createBadge(
      `${document.topLevelDirectories.length} image${document.topLevelDirectories.length === 1 ? '' : 's'}`,
    ),
  )
  fitViewer()
  setViewerLoading(false)
  await renderViewer()
}

const prepareImageViewer = async (
  file: File,
  image: Image,
  metadata: ImageMetadata,
): Promise<void> => {
  setViewerLoading(true, `Preparing ${metadata.format.toUpperCase()} image…`)
  const selection: ImageViewerSelection = {
    kind: 'image',
    file,
    image,
    metadata,
    width: metadata.width,
    height: metadata.height,
  }
  viewerSelection = selection
  viewerDirectory.replaceChildren(
    new Option(
      `Image 1 · ${metadata.width.toLocaleString()} × ${metadata.height.toLocaleString()}`,
      '0',
    ),
  )
  setViewerControls(true, false)
  updateViewerFacts(selection)
  sourceDetails.textContent = `${metadata.width.toLocaleString()} × ${metadata.height.toLocaleString()} · ${metadata.mimeType} · ${formatBytes(file.size)}`
  describeMetadata(metadata)
  fitViewer()
  setViewerLoading(false)
  await renderViewer()
}

const saveVisibleClip = async (): Promise<void> => {
  const selection = viewerSelection
  const region = currentViewerRegion()
  if (!selection || !region) return
  const pixels = region.width * region.height
  if (!Number.isSafeInteger(pixels) || pixels > maximumClipPixels) {
    const message = `Visible clip is ${region.width.toLocaleString()}×${region.height.toLocaleString()} (${pixels.toLocaleString()} pixels). Zoom in until it is at most 16 megapixels.`
    viewerStatus.textContent = message
    addLog('warning', message)
    return
  }
  saveClipButton.disabled = true
  setViewerLoading(true, 'Encoding visible region as PNG…')
  const startedAt = performance.now()
  try {
    const image =
      selection.kind === 'tiff'
        ? await viewerImages.open(selection.file, {
            frame: selection.choice.frame,
            limits: viewerLimits,
            ...(selection.choice.resolutionLevel === undefined
              ? {}
              : { resolutionLevel: selection.choice.resolutionLevel }),
          })
        : selection.image
    const blob = await image
      .crop({ x: region.x, y: region.y, width: region.width, height: region.height })
      .png()
      .toBlob()
    revokeUrl(viewerClipUrl)
    viewerClipUrl = URL.createObjectURL(blob)
    const download = document.createElement('a')
    download.href = viewerClipUrl
    download.download = `${safeBaseName(selection.file.name)}-${region.x}-${region.y}-${region.width}x${region.height}.png`
    download.click()
    const elapsed = performance.now() - startedAt
    viewerStatus.textContent = `Saved ${region.width.toLocaleString()} × ${region.height.toLocaleString()} PNG clip (${formatBytes(blob.size)}) in ${formatDuration(elapsed)}.`
    addLog(
      'success',
      `PNG clip encoded and downloaded: ${region.width}×${region.height}, ${formatBytes(blob.size)}, ${formatDuration(elapsed)}.`,
    )
  } catch (error: unknown) {
    viewerStatus.textContent = errorMessage(error)
    addLog('error', `Clip export: ${errorMessage(error)}`)
  } finally {
    setViewerLoading(false)
    saveClipButton.disabled = false
  }
}

const inspectFile = async (file: File): Promise<void> => {
  const sequence = ++inspectionSequence
  selectedFile = undefined
  selectedImage = undefined
  selectedMetadata = undefined
  comparisonTimings.clear()
  controls.disabled = true
  convertButton.disabled = true
  operationStatus.textContent = 'Inspecting the file header…'
  resetResult()
  resetViewer()

  revokeUrl(sourceObjectUrl)
  sourceObjectUrl = URL.createObjectURL(file)
  setImagePreview(sourcePreview, sourceFallback, sourceObjectUrl, `Preview of ${file.name}`)
  sourcePanel.hidden = false
  sourceName.textContent = file.name
  sourceDetails.textContent = `${formatBytes(file.size)} · detecting from file bytes…`
  sourceBadges.replaceChildren(createBadge('Inspecting'))
  addLog('info', `Selected ${file.name} (${formatBytes(file.size)}). No bytes leave this browser.`)

  const isTiff = await tiffHeader(file)
  if (sequence !== inspectionSequence) return
  let viewerReady = false
  let viewerFailure: string | undefined
  if (isTiff) {
    try {
      await prepareTiffViewer(file)
      if (sequence !== inspectionSequence) return
      viewerReady = true
      addLog('success', 'TIFF document opened for bounded client-side viewport decoding.')
    } catch (error: unknown) {
      if (sequence !== inspectionSequence) return
      viewerFailure = errorMessage(error)
      resetViewer()
      addLog('warning', `TIFF viewer unavailable: ${viewerFailure}`)
    }
  }

  try {
    const image = await referenceImages.open(file, { limits: demoLimits })
    const metadata = await image.metadata()
    if (sequence !== inspectionSequence) return

    selectedFile = file
    selectedImage = image
    selectedMetadata = metadata
    if (!viewerReady) {
      await prepareImageViewer(file, image, metadata)
      if (sequence !== inspectionSequence) return
      viewerReady = true
      addLog('success', `${metadata.format.toUpperCase()} opened in the client-side viewer.`)
    }
    outputFormat.value = recommendedOutput(metadata)
    webpLossless.checked = metadata.hasAlpha
    updateOutputOptions()
    updateAccelerationStatus()
    resizeWidth.placeholder = String(Math.min(metadata.width, 1_600))
    resizeHeight.placeholder = String(Math.min(metadata.height, 1_600))
    addLog(
      'detect',
      `${metadata.format.toUpperCase()} detected from content: ${metadata.width}×${metadata.height}, ${metadata.hasAlpha ? 'alpha' : 'opaque'}, ${countLabel(metadata) ?? '1 image'}.`,
    )

    const multipleImages = (metadata.frames ?? 1) > 1
    controls.disabled = false
    convertButton.disabled = false
    if (multipleImages && metadata.format === 'jpeg') {
      operationStatus.textContent =
        'Ready. This MPF JPEG contains auxiliary images; conversion uses its supported primary image.'
      addLog(
        'warning',
        'MPF JPEG detected. Conversion uses the primary JPEG image; auxiliary images and gain maps are not preserved.',
      )
    } else if (multipleImages) {
      operationStatus.textContent =
        'Ready. Conversion uses the first image or frame; additional images are not included.'
      addLog(
        'warning',
        `${metadata.format.toUpperCase()} contains ${metadata.frames ?? 1} images or frames. Conversion uses the first image or frame.`,
      )
    } else {
      operationStatus.textContent = 'Viewer and conversion pipeline ready.'
    }
  } catch (error: unknown) {
    if (sequence !== inspectionSequence) return
    const conversionFailure = errorMessage(error)
    if (viewerReady) {
      operationStatus.textContent =
        'Viewer ready. Complete-image conversion is outside the public demo guardrails for this file.'
      addLog('warning', `Full conversion unavailable: ${conversionFailure}`)
      return
    }
    operationStatus.textContent = conversionFailure
    sourceBadges.replaceChildren(createBadge('Unsupported'))
    if (viewerFailure !== undefined) {
      viewerStatus.textContent = viewerFailure
      addLog('error', `Viewer: ${viewerFailure}`)
    }
    addLog('error', conversionFailure)
  }
}
const loadExample = async (button: HTMLButtonElement): Promise<void> => {
  const name = button.dataset.sampleName
  const url = button.dataset.sampleUrl
  const source = button.dataset.sampleSource ?? 'its public source'
  if (name === undefined || url === undefined) {
    exampleStatus.textContent = 'This example is missing its source information.'
    return
  }

  for (const candidate of exampleButtons) candidate.disabled = true
  button.classList.add('loading')
  button.setAttribute('aria-busy', 'true')
  exampleStatus.textContent = `Fetching ${name} directly from ${source}…`
  addLog('info', `Fetching public example ${name} from ${source} after explicit user selection.`)

  try {
    const response = await fetch(url, { mode: 'cors' })
    if (!response.ok) throw new Error(`Example request returned HTTP ${response.status}`)
    const contentLength = Number(response.headers.get('content-length'))
    if (
      !Number.isSafeInteger(contentLength) ||
      contentLength < 1 ||
      contentLength > maximumExampleBytes
    ) {
      throw new Error('Example size is missing or exceeds the 8 MiB demo limit')
    }
    const blob = await response.blob()
    if (blob.size !== contentLength || blob.size > maximumExampleBytes) {
      throw new Error('Example size changed while downloading')
    }

    await inspectFile(new File([blob], name, { type: blob.type }))
    if (viewerSelection === undefined) throw new Error('The example did not open in the viewer')
    exampleStatus.textContent = `${name} opened from ${source} (${formatBytes(blob.size)}).`
  } catch (error: unknown) {
    const message = errorMessage(error)
    exampleStatus.textContent = `${name} could not be loaded: ${message}`
    addLog('error', `Public example ${name}: ${message}`)
  } finally {
    button.classList.remove('loading')
    button.removeAttribute('aria-busy')
    for (const candidate of exampleButtons) candidate.disabled = false
  }
}

const filterSamples = (): void => {
  const query = sampleSearch.value.trim().toLowerCase()
  let visible = 0
  for (const card of sampleCards) {
    const searchable = `${card.dataset.sampleSearch ?? ''} ${card.textContent ?? ''}`.toLowerCase()
    card.hidden = query !== '' && !searchable.includes(query)
    if (!card.hidden) visible += 1
  }
  sampleEmpty.hidden = visible !== 0
  exampleStatus.textContent =
    query === ''
      ? `${sampleCards.length} public sample files. Open direct files here, or download larger datasets and drop them above.`
      : `${visible} sample${visible === 1 ? '' : 's'} match “${sampleSearch.value.trim()}”.`
}

const optionalDimension = (input: HTMLInputElement, label: string): number | undefined => {
  const text = input.value.trim()
  if (text === '') return undefined
  const value = Number(text)
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error(`${label} must be a positive integer`)
  return value
}

const safeBaseName = (name: string): string => {
  const withoutExtension = name.replace(/\.[^.]*$/, '')
  return (
    withoutExtension
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'image'
  )
}

const plannedPipeline = (
  sourceImage: Image,
): { readonly image: Image; readonly steps: readonly string[] } => {
  if (!selectedMetadata) throw new Error('Choose a supported image first')
  let image = sourceImage
  const steps: string[] = []

  if (autoOrient.checked) {
    image = image.autoOrient()
    steps.push('auto-orient')
  }
  if (flipHorizontal.checked) {
    image = image.flop()
    steps.push('flip horizontal')
  }
  if (flipVertical.checked) {
    image = image.flip()
    steps.push('flip vertical')
  }
  if (resizeEnabled.checked) {
    const width = optionalDimension(resizeWidth, 'Resize width')
    const height = optionalDimension(resizeHeight, 'Resize height')
    if (width === undefined && height === undefined) {
      throw new Error('Enter a resize width, height, or both')
    }
    if (width !== undefined && height !== undefined) {
      image = image.resize({
        fit: 'inside',
        height,
        kernel: 'lanczos3',
        width,
        withoutEnlargement: true,
      })
      steps.push(`resize inside ${width}×${height}`)
    } else if (width !== undefined) {
      image = image.resize({ kernel: 'lanczos3', width, withoutEnlargement: true })
      steps.push(`resize to ${width}px wide`)
    } else if (height !== undefined) {
      image = image.resize({ height, kernel: 'lanczos3', withoutEnlargement: true })
      steps.push(`resize to ${height}px tall`)
    }
  }

  const degrees = Number(rotation.value)
  if (degrees !== 0) {
    if (degrees !== 90 && degrees !== 180 && degrees !== 270) throw new Error('Rotation is invalid')
    image = image.rotate(degrees)
    steps.push(`rotate ${degrees}°`)
  }

  const format = outputFormatValue()
  const quality = Number(qualityInput.value)
  if (format === 'jpeg') {
    image = image.jpeg({ background: '#ffffff', progressive: jpegProgressive.checked, quality })
    steps.push(`${jpegProgressive.checked ? 'progressive ' : ''}JPEG quality ${quality}`)
  } else if (format === 'png') {
    image = image.png()
    steps.push('PNG')
  } else if (format === 'webp') {
    image = image.webp({ lossless: webpLossless.checked, quality })
    steps.push(webpLossless.checked ? 'lossless WebP' : `WebP quality ${quality}`)
  } else if (format === 'bmp') {
    image = image.bmp({ alpha: selectedMetadata.hasAlpha })
    steps.push(selectedMetadata.hasAlpha ? '32-bit BMP' : '24-bit BMP')
  } else {
    image = image.tiff({ compression: 'deflate', predictor: 'horizontal', layout: 'strips' })
    steps.push('Deflate TIFF')
  }
  return Object.freeze({ image, steps: Object.freeze(steps) })
}

const comparisonKey = (): string => {
  if (!selectedFile) throw new Error('Choose a supported image first')
  return JSON.stringify([
    selectedFile.name,
    selectedFile.size,
    selectedFile.lastModified,
    outputFormat.value,
    qualityInput.value,
    webpLossless.checked,
    jpegProgressive.checked,
    autoOrient.checked,
    resizeEnabled.checked,
    resizeWidth.value.trim(),
    resizeHeight.value.trim(),
    rotation.value,
    flipVertical.checked,
    flipHorizontal.checked,
  ])
}

const recordComparison = (key: string, mode: DecodeMode, milliseconds: number): string => {
  const timings = comparisonTimings.get(key) ?? {}
  timings[mode] = milliseconds
  comparisonTimings.set(key, timings)
  if (comparisonTimings.size > maximumComparisonEntries) {
    const oldest = comparisonTimings.keys().next().value
    if (typeof oldest === 'string') comparisonTimings.delete(oldest)
  }
  if (timings.typescript === undefined) return 'Run TypeScript to compare'
  if (timings.wasm === undefined) return 'Run WASM to compare'
  const difference = timings.typescript - timings.wasm
  if (Math.abs(difference) < 0.05) return 'Same measured time'
  const percent = (Math.abs(difference) / timings.typescript) * 100
  return difference > 0 ? `${percent.toFixed(1)}% faster` : `${percent.toFixed(1)}% slower`
}

const convert = async (): Promise<void> => {
  if (!selectedFile || !selectedImage || !selectedMetadata) return
  convertButton.disabled = true
  controls.disabled = true
  operationStatus.textContent = 'Converting in this browser…'
  resetResult()

  try {
    const mode = selectedDecodeMode()
    const library = mode === 'wasm' ? acceleratedImages : referenceImages
    const sourceImage =
      (selectedMetadata.frames ?? 1) > 1
        ? await library.open(selectedFile, { frame: 0, limits: demoLimits })
        : await library.open(selectedFile, { limits: demoLimits })
    const plan = plannedPipeline(sourceImage)
    const plannedMetadata = await plan.image.metadata()
    const key = comparisonKey()
    addLog('plan', plan.steps.join(' → '))
    addLog(
      'plan',
      mode === 'wasm'
        ? 'Rust/WASM JPEG acceleration enabled for this run; the selector may fall back when it cannot help.'
        : 'TypeScript reference selected for this run.',
    )
    addLog(
      'plan',
      `Planned output: ${plannedMetadata.width}×${plannedMetadata.height} ${plannedMetadata.format.toUpperCase()}.`,
    )

    const heapSamples: number[] = []
    const sampleHeap = (): void => {
      const bytes = observedJsHeapBytes()
      if (bytes !== undefined) heapSamples.push(bytes)
    }
    sampleHeap()
    const startedAt = performance.now()
    const blob = await plan.image.toBlob()
    const elapsed = performance.now() - startedAt
    sampleHeap()

    const verification = await (await referenceImages.open(blob, { limits: demoLimits })).metadata()
    sampleHeap()
    const maximumHeap = heapSamples.length > 0 ? Math.max(...heapSamples) : undefined
    const format = outputFormatValue()
    const outputType = outputTypes[format]
    const knownFileBytes = selectedFile.size + blob.size
    const comparison = recordComparison(key, mode, elapsed)

    revokeUrl(resultObjectUrl)
    resultObjectUrl = URL.createObjectURL(blob)
    setImagePreview(
      resultPreview,
      resultFallback,
      resultObjectUrl,
      `Converted ${outputType.label} preview`,
    )
    resultSummary.textContent = `${outputType.label} · ${verification.width.toLocaleString()} × ${verification.height.toLocaleString()} · ${formatBytes(blob.size)}`
    elapsedMetric.textContent = formatDuration(elapsed)
    providerMetric.textContent = mode === 'wasm' ? 'WASM enabled' : 'TypeScript'
    comparisonMetric.textContent = comparison
    memoryMetric.textContent = maximumHeap === undefined ? 'Not exposed' : formatBytes(maximumHeap)
    knownBytesMetric.textContent = formatBytes(knownFileBytes)
    outputBytesMetric.textContent = formatBytes(blob.size)
    downloadLink.href = resultObjectUrl
    downloadLink.download = `${safeBaseName(selectedFile.name)}-converted.${outputType.extension}`
    downloadLink.type = outputType.mime
    resultPanel.hidden = false
    operationStatus.textContent = 'Conversion complete. Preview or download the result.'

    addLog(
      'success',
      `${outputType.label} output validated as ${verification.width}×${verification.height} (${formatBytes(blob.size)}).`,
    )
    addLog('metric', `Conversion time: ${formatDuration(elapsed)}.`)
    addLog('metric', `Mode comparison: ${comparison}.`)
    addLog(
      'metric',
      maximumHeap === undefined
        ? 'Maximum observed JS heap: not exposed by this browser. This is not replaced with a guessed value.'
        : `Maximum observed JS heap: ${formatBytes(maximumHeap)} at operation checkpoints. This is a browser estimate, not process RSS.`,
    )
    addLog(
      'metric',
      `Known input + output file bytes: ${formatBytes(knownFileBytes)}. Codec scratch memory is not included in this figure.`,
    )
  } catch (error: unknown) {
    operationStatus.textContent = errorMessage(error)
    addLog('error', errorMessage(error))
  } finally {
    controls.disabled = false
    convertButton.disabled = false
  }
}

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.item(0)
  if (file) void inspectFile(file)
})
for (const button of exampleButtons) {
  button.addEventListener('click', () => void loadExample(button))
}
sampleSearch.addEventListener('input', filterSamples)
conversionForm.addEventListener('submit', (event) => event.preventDefault())

for (const eventName of ['dragenter', 'dragover'] as const) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault()
    dropZone.classList.add('dragging')
  })
}
for (const eventName of ['dragleave', 'drop'] as const) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault()
    dropZone.classList.remove('dragging')
  })
}
dropZone.addEventListener('drop', (event) => {
  const file = event.dataTransfer?.files.item(0)
  if (file) void inspectFile(file)
})

viewModeButton.addEventListener('click', () => setMode('view'))
convertModeButton.addEventListener('click', () => setMode('convert'))
viewerDirectory.addEventListener('change', () => {
  const index = Number(viewerDirectory.value)
  if (!Number.isSafeInteger(index) || index < 0) return
  void selectViewerChoice(index, false).catch((error: unknown) => {
    viewerStatus.textContent = errorMessage(error)
    addLog('error', `TIFF image selection: ${errorMessage(error)}`)
    setViewerLoading(false)
  })
})
zoomOutButton.addEventListener('click', () => zoomViewer(1 / 1.5))
zoomInButton.addEventListener('click', () => zoomViewer(1.5))
zoomFitButton.addEventListener('click', () => {
  fitViewer()
  scheduleViewerRender()
})
zoomActualButton.addEventListener('click', () => {
  if (!viewerSelection) return
  viewerZoom = 1
  clampViewerCenter()
  scheduleViewerRender()
})
panLeftButton.addEventListener('click', () => panViewer(-1, 0))
panUpButton.addEventListener('click', () => panViewer(0, -1))
panDownButton.addEventListener('click', () => panViewer(0, 1))
panRightButton.addEventListener('click', () => panViewer(1, 0))
saveClipButton.addEventListener('click', () => void saveVisibleClip())

viewerStage.addEventListener('wheel', (event) => {
  if (!viewerSelection) return
  event.preventDefault()
  zoomViewer(Math.exp(-event.deltaY * 0.0015), event.clientX, event.clientY)
})
viewerStage.addEventListener('pointerdown', (event) => {
  if (!viewerSelection || event.button !== 0) return
  pointerDrag = {
    id: event.pointerId,
    startCenterX: viewerCenterX,
    startCenterY: viewerCenterY,
    startX: event.clientX,
    startY: event.clientY,
  }
  viewerStage.setPointerCapture(event.pointerId)
  viewerStage.classList.add('dragging')
})
viewerStage.addEventListener('pointermove', (event) => {
  const drag = pointerDrag
  if (!drag || drag.id !== event.pointerId) return
  viewerCenterX = drag.startCenterX - (event.clientX - drag.startX) / viewerZoom
  viewerCenterY = drag.startCenterY - (event.clientY - drag.startY) / viewerZoom
  clampViewerCenter()
  scheduleViewerRender()
})
const finishPointerDrag = (event: PointerEvent): void => {
  if (!pointerDrag || pointerDrag.id !== event.pointerId) return
  pointerDrag = undefined
  viewerStage.classList.remove('dragging')
  if (viewerStage.hasPointerCapture(event.pointerId))
    viewerStage.releasePointerCapture(event.pointerId)
}
viewerStage.addEventListener('pointerup', finishPointerDrag)
viewerStage.addEventListener('pointercancel', finishPointerDrag)
new ResizeObserver(() => {
  if (viewerSelection && !viewPanel.hidden) scheduleViewerRender()
}).observe(viewerStage)

outputFormat.addEventListener('change', updateOutputOptions)
webpLossless.addEventListener('change', updateOutputOptions)
qualityInput.addEventListener('input', () => {
  qualityValue.value = qualityInput.value
})
resizeEnabled.addEventListener('change', updateResizeFields)
resizeEnabled.addEventListener('change', updateAccelerationStatus)
wasmEnabled.addEventListener('change', () => {
  resetResult()
  updateAccelerationStatus()
  operationStatus.textContent = wasmEnabled.checked
    ? 'WASM enabled. Convert with the same settings to compare against TypeScript.'
    : 'TypeScript selected. Convert with the same settings to compare against WASM.'
})
convertButton.addEventListener('click', () => void convert())
clearLogButton.addEventListener('click', () => {
  logEntries.length = 0
  logList.replaceChildren()
  addLog('info', 'Log cleared. Files still remain entirely in this browser.')
})
copyLogButton.addEventListener('click', async () => {
  const text = logEntries
    .map((entry) => `[${entry.timestamp}] ${entry.level.toUpperCase()} ${entry.message}`)
    .join('\n')
  try {
    await navigator.clipboard.writeText(text)
    copyLogButton.textContent = 'Copied'
    window.setTimeout(() => {
      copyLogButton.textContent = 'Copy log'
    }, 1_400)
  } catch (error: unknown) {
    addLog('warning', `Clipboard access failed: ${errorMessage(error)}`)
  }
})

window.addEventListener('beforeunload', () => {
  revokeUrl(sourceObjectUrl)
  revokeUrl(resultObjectUrl)
  revokeUrl(viewerClipUrl)
})

updateOutputOptions()
updateResizeFields()
updateAccelerationStatus()
resetViewer()
setMode('view')
addLog('info', `PureJsImage loaded with ${referenceImages.formats().length} first-party codecs.`)
addLog(
  'info',
  'Viewer guardrails: 1 GiB local TIFF input, 500,000-pixel dimensions, bounded viewport rows, and 16-megapixel PNG clips. Complete conversion remains capped at 64 MiB input and 64 megapixels.',
)

declare global {
  interface Window {
    pureJsImageDemoReady: boolean
  }
}

window.pureJsImageDemoReady = true
