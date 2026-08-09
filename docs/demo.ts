import { createImageLibrary, ImageError, type Image, type ImageMetadata } from '../src/browser.ts'
import { allCodecs } from '../src/codec-entries/all.ts'

type OutputFormat = 'bmp' | 'jpeg' | 'png' | 'tiff' | 'webp'
type LogLevel = 'detect' | 'error' | 'info' | 'metric' | 'plan' | 'success' | 'warning'

interface LogEntry {
  readonly level: LogLevel
  readonly message: string
  readonly timestamp: string
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
const convertButton = requiredElement('demo-convert', HTMLButtonElement)
const operationStatus = requiredElement('demo-operation-status', HTMLElement)
const resultPanel = requiredElement('demo-result', HTMLElement)
const resultPreview = requiredElement('demo-result-preview', HTMLImageElement)
const resultFallback = requiredElement('demo-result-fallback', HTMLElement)
const resultSummary = requiredElement('demo-result-summary', HTMLElement)
const downloadLink = requiredElement('demo-download', HTMLAnchorElement)
const elapsedMetric = requiredElement('demo-metric-elapsed', HTMLElement)
const memoryMetric = requiredElement('demo-metric-memory', HTMLElement)
const knownBytesMetric = requiredElement('demo-metric-known-bytes', HTMLElement)
const outputBytesMetric = requiredElement('demo-metric-output', HTMLElement)
const logList = requiredElement('demo-log-list', HTMLOListElement)
const clearLogButton = requiredElement('demo-clear-log', HTMLButtonElement)
const copyLogButton = requiredElement('demo-copy-log', HTMLButtonElement)

const images = createImageLibrary(allCodecs)
const sessionStartedAt = performance.now()
const logEntries: LogEntry[] = []
const maximumLogEntries = 200
const demoLimits = Object.freeze({
  maxDecodedBytes: 268_435_456,
  maxFrames: 256,
  maxHeight: 65_536,
  maxInputBytes: 67_108_864,
  maxPixels: 67_108_864,
  maxWidth: 65_536,
})

let selectedFile: File | undefined
let selectedImage: Image | undefined
let selectedMetadata: ImageMetadata | undefined
let sourceObjectUrl: string | undefined
let resultObjectUrl: string | undefined
let inspectionSequence = 0

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

const createBadge = (label: string): HTMLElement => {
  const badge = document.createElement('span')
  badge.className = 'demo-badge'
  badge.textContent = label
  return badge
}

const describeMetadata = (metadata: ImageMetadata): void => {
  sourceBadges.replaceChildren(
    createBadge(metadata.format.toUpperCase()),
    createBadge(metadata.hasAlpha ? 'Alpha' : 'Opaque'),
    createBadge(`${metadata.bitDepth ?? 8}-bit`),
    ...(metadata.frames !== undefined
      ? [createBadge(`${metadata.frames} frame${metadata.frames === 1 ? '' : 's'}`)]
      : []),
  )
}

const inspectFile = async (file: File): Promise<void> => {
  const sequence = ++inspectionSequence
  selectedFile = undefined
  selectedImage = undefined
  selectedMetadata = undefined
  controls.disabled = true
  convertButton.disabled = true
  operationStatus.textContent = 'Inspecting the file header…'
  resetResult()

  revokeUrl(sourceObjectUrl)
  sourceObjectUrl = URL.createObjectURL(file)
  setImagePreview(sourcePreview, sourceFallback, sourceObjectUrl, `Preview of ${file.name}`)
  sourcePanel.hidden = false
  sourceName.textContent = file.name
  sourceDetails.textContent = `${formatBytes(file.size)} · detecting from file bytes…`
  sourceBadges.replaceChildren(createBadge('Inspecting'))
  addLog('info', `Selected ${file.name} (${formatBytes(file.size)}). No bytes leave this browser.`)

  try {
    const image = await images.open(file, { limits: demoLimits })
    const metadata = await image.metadata()
    if (sequence !== inspectionSequence) return

    selectedFile = file
    selectedImage = image
    selectedMetadata = metadata
    sourceDetails.textContent = `${metadata.width.toLocaleString()} × ${metadata.height.toLocaleString()} · ${metadata.mimeType} · ${formatBytes(file.size)}`
    describeMetadata(metadata)
    outputFormat.value = recommendedOutput(metadata)
    webpLossless.checked = metadata.hasAlpha
    updateOutputOptions()
    resizeWidth.placeholder = String(Math.min(metadata.width, 1_600))
    resizeHeight.placeholder = String(Math.min(metadata.height, 1_600))
    addLog(
      'detect',
      `${metadata.format.toUpperCase()} detected from content: ${metadata.width}×${metadata.height}, ${metadata.hasAlpha ? 'alpha' : 'opaque'}, ${metadata.frames ?? 1} frame(s).`,
    )

    if ((metadata.frames ?? 1) > 1) {
      operationStatus.textContent =
        'Animated input detected. This demo refuses to silently convert only the first frame.'
      addLog(
        'warning',
        'Multi-frame conversion is unavailable; no static first-frame output will be emitted.',
      )
      return
    }

    controls.disabled = false
    convertButton.disabled = false
    operationStatus.textContent = `Ready. Choose an output format and optional transforms.`
  } catch (error: unknown) {
    if (sequence !== inspectionSequence) return
    operationStatus.textContent = errorMessage(error)
    sourceBadges.replaceChildren(createBadge('Unsupported'))
    addLog('error', errorMessage(error))
  }
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

const plannedPipeline = (): { readonly image: Image; readonly steps: readonly string[] } => {
  if (!selectedImage || !selectedMetadata) throw new Error('Choose a supported image first')
  let image = selectedImage
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
    image = image.tiff({ compression: 'none' })
    steps.push('uncompressed TIFF')
  }
  return Object.freeze({ image, steps: Object.freeze(steps) })
}

const convert = async (): Promise<void> => {
  if (!selectedFile || !selectedImage || !selectedMetadata) return
  convertButton.disabled = true
  controls.disabled = true
  operationStatus.textContent = 'Converting in this browser…'
  resetResult()

  try {
    const plan = plannedPipeline()
    const plannedMetadata = await plan.image.metadata()
    addLog('plan', plan.steps.join(' → '))
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

    const verification = await (await images.open(blob, { limits: demoLimits })).metadata()
    sampleHeap()
    const maximumHeap = heapSamples.length > 0 ? Math.max(...heapSamples) : undefined
    const format = outputFormatValue()
    const outputType = outputTypes[format]
    const knownFileBytes = selectedFile.size + blob.size

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

outputFormat.addEventListener('change', updateOutputOptions)
webpLossless.addEventListener('change', updateOutputOptions)
qualityInput.addEventListener('input', () => {
  qualityValue.value = qualityInput.value
})
resizeEnabled.addEventListener('change', updateResizeFields)
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
})

updateOutputOptions()
updateResizeFields()
addLog('info', `PureJsImage loaded with ${images.formats().length} first-party codecs.`)
addLog(
  'info',
  'Demo guardrails: 64 MiB input, 64 megapixels, 256 MiB worst-case decoded bytes, single-frame output.',
)

declare global {
  interface Window {
    pureJsImageDemoReady: boolean
  }
}

window.pureJsImageDemoReady = true
