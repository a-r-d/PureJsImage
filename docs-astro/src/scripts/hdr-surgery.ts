import type { ExecutionEvidenceReport } from '../../../src/evidence.ts'
import type { GainMapImageInspection, GainMapTransformOperation } from '../../../src/hdr/index.ts'
import { isHdrSurgeryResponse, type HdrSurgeryRequest } from './hdr-surgery-types.ts'

const element = (id: string): HTMLElement => {
  const value = document.getElementById(id)
  if (!value) throw new Error(`Missing #${id}`)
  return value
}

const input = (id: string): HTMLInputElement => {
  const value = element(id)
  if (!(value instanceof HTMLInputElement)) throw new Error(`#${id} is not an input`)
  return value
}

const select = (id: string): HTMLSelectElement => {
  const value = element(id)
  if (!(value instanceof HTMLSelectElement)) throw new Error(`#${id} is not a select`)
  return value
}

const button = (id: string): HTMLButtonElement => {
  const value = element(id)
  if (!(value instanceof HTMLButtonElement)) throw new Error(`#${id} is not a button`)
  return value
}

const canvas = (id: string): HTMLCanvasElement => {
  const value = element(id)
  if (!(value instanceof HTMLCanvasElement)) throw new Error(`#${id} is not a canvas`)
  return value
}

const image = (id: string): HTMLImageElement => {
  const value = element(id)
  if (!(value instanceof HTMLImageElement)) throw new Error(`#${id} is not an image`)
  return value
}

const file = input('hdr-file')
const remoteUrl = input('hdr-url')
const boost = input('hdr-boost')
const boostValue = element('hdr-boost-value')
const metadataMode = select('hdr-metadata-mode')
const status = element('hdr-status')
const metadata = element('hdr-metadata')
const ranges = element('hdr-ranges')
const evidence = element('hdr-evidence')
const probe = element('hdr-probe')
const baseImage = image('hdr-base')
const gainImage = image('hdr-gain')
const nativeImage = image('hdr-native')
const adapted = canvas('hdr-adapted')
const falseColor = canvas('hdr-false-color')
const worker = new Worker(new URL('./hdr-surgery-worker.js', import.meta.url), { type: 'module' })

let generation = 0
let requestId = 0
let inspection: GainMapImageInspection | undefined
let report: ExecutionEvidenceReport | undefined
let linearRgb: Float32Array | undefined
let sourceName = 'sample'
let baseUrl: string | undefined
let gainUrl: string | undefined
let nativeUrl: string | undefined
let renderTimer: number | undefined
let autoOrient = false
let flipHorizontal = false
let flipVertical = false
let rotation: 0 | 90 | 180 | 270 = 0

const revoke = (value: string | undefined): void => {
  if (value) URL.revokeObjectURL(value)
}

const replaceImageUrl = (
  target: HTMLImageElement,
  kind: 'base' | 'gain' | 'native',
  bytes: ArrayBuffer,
): void => {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }))
  if (kind === 'base') {
    revoke(baseUrl)
    baseUrl = url
  } else if (kind === 'gain') {
    revoke(gainUrl)
    gainUrl = url
  } else {
    revoke(nativeUrl)
    nativeUrl = url
  }
  target.src = url
}

const draw = (
  target: HTMLCanvasElement,
  bytes: ArrayBuffer,
  width: number,
  height: number,
): void => {
  target.width = width
  target.height = height
  const context = target.getContext('2d')
  if (!context) throw new Error('Canvas 2D is unavailable')
  context.putImageData(new ImageData(new Uint8ClampedArray(bytes), width, height), 0, 0)
}

const setBusy = (message: string): void => {
  status.textContent = message
  button('hdr-cancel').disabled = false
  button('hdr-jpeg').disabled = true
  button('hdr-avif').disabled = true
}

const positiveInteger = (id: string): number | undefined => {
  const value = Number(input(id).value)
  return Number.isSafeInteger(value) && value > 0 ? value : undefined
}

const nonnegativeInteger = (id: string): number | undefined => {
  const value = Number(input(id).value)
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

const currentOperations = (): readonly GainMapTransformOperation[] => {
  if (!inspection) return []
  const operations: GainMapTransformOperation[] = []
  if (autoOrient) operations.push({ type: 'auto-orient' })
  const x = nonnegativeInteger('hdr-crop-x')
  const y = nonnegativeInteger('hdr-crop-y')
  const width = positiveInteger('hdr-crop-width')
  const height = positiveInteger('hdr-crop-height')
  if (x !== undefined && y !== undefined && width !== undefined && height !== undefined) {
    operations.push({ type: 'crop', x, y, width, height })
  }
  if (flipHorizontal) operations.push({ type: 'flip-horizontal' })
  if (flipVertical) operations.push({ type: 'flip-vertical' })
  if (rotation !== 0) operations.push({ type: 'rotate', degrees: rotation })
  const outputWidth = positiveInteger('hdr-output-width')
  const outputHeight = positiveInteger('hdr-output-height')
  const kernel = select('hdr-kernel').value
  if (
    outputWidth !== undefined &&
    outputHeight !== undefined &&
    (kernel === 'nearest' || kernel === 'bilinear' || kernel === 'lanczos3')
  ) {
    operations.push({ type: 'resize', width: outputWidth, height: outputHeight, kernel })
  }
  return Object.freeze(operations)
}

const nextIdentity = (): Pick<HdrSurgeryRequest, 'requestId' | 'generation'> => ({
  requestId: ++requestId,
  generation,
})

const openBytes = (name: string, bytes: ArrayBuffer): void => {
  generation += 1
  sourceName = name
  resetTransformState()
  setBusy(`Opening ${name} locally in the browser worker…`)
  const request: HdrSurgeryRequest = {
    type: 'open',
    ...nextIdentity(),
    name,
    bytes,
    displayBoost: Number(boost.value),
    operations: [],
  }
  worker.postMessage(request, [bytes])
}

const render = (): void => {
  if (!inspection) return
  setBusy(`Rendering ${Number(boost.value).toFixed(2)}× display boost…`)
  worker.postMessage({
    type: 'render',
    ...nextIdentity(),
    displayBoost: Number(boost.value),
    operations: currentOperations(),
  } satisfies HdrSurgeryRequest)
}

const scheduleRender = (): void => {
  if (renderTimer !== undefined) window.clearTimeout(renderTimer)
  setBusy('Transform queued for the local worker…')
  renderTimer = window.setTimeout(render, 120)
}

const resetTransformState = (): void => {
  autoOrient = false
  flipHorizontal = false
  flipVertical = false
  rotation = 0
  for (const id of ['hdr-auto-orient', 'hdr-flip-h', 'hdr-flip-v']) {
    button(id).setAttribute('aria-pressed', 'false')
  }
  button('hdr-rotate').textContent = 'Rotate 90°'
}

const openSample = (): void => {
  void fetch('/demo-data/hdr-surgery-synthetic-dual.jpg')
    .then((response) => {
      if (!response.ok) throw new Error(`Sample returned HTTP ${response.status}`)
      return response.arrayBuffer()
    })
    .then((bytes) => openBytes('hdr-surgery-synthetic-dual.jpg', bytes))
    .catch((cause: unknown) => {
      status.textContent = cause instanceof Error ? cause.message : String(cause)
    })
}

const updateRendered = (
  nextLinear: ArrayBuffer,
  preview: ArrayBuffer,
  color: ArrayBuffer,
  nextReport: ExecutionEvidenceReport,
): void => {
  if (!inspection) return
  const { width, height } = inspection.metadata.baseDimensions
  linearRgb = new Float32Array(nextLinear)
  draw(adapted, preview, width, height)
  draw(falseColor, color, width, height)
  report = nextReport
  evidence.textContent = JSON.stringify(nextReport, null, 2)
  status.textContent = `${sourceName}: software preview rendered at ${Number(boost.value).toFixed(2)}×. The canvas is tone mapped for SDR; linear values remain available to the pixel probe.`
  button('hdr-cancel').disabled = true
  button('hdr-jpeg').disabled = false
  button('hdr-avif').disabled = false
}

worker.addEventListener('message', (event: MessageEvent<unknown>) => {
  if (!isHdrSurgeryResponse(event.data)) return
  const message = event.data
  if (message.generation !== generation || message.requestId !== requestId) return
  if (message.type === 'error') {
    status.textContent = message.message
    button('hdr-cancel').disabled = true
    return
  }
  if (message.type === 'repacked') {
    replaceImageUrl(nativeImage, 'native', message.bytes)
    status.textContent = `${message.metadataMode} JPEG generated locally. The native image element may show HDR only when this browser, operating system, and display support it.`
    button('hdr-cancel').disabled = true
    button('hdr-jpeg').disabled = false
    button('hdr-avif').disabled = false
    return
  }
  if (message.type === 'avif') {
    const url = URL.createObjectURL(new Blob([message.bytes], { type: 'image/avif' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'purejsimage-hdr-surgery.avif'
    link.click()
    URL.revokeObjectURL(url)
    status.textContent = 'ISO gain-map AVIF generated locally.'
    button('hdr-cancel').disabled = true
    button('hdr-jpeg').disabled = false
    button('hdr-avif').disabled = false
    return
  }
  if (message.type === 'result') {
    inspection = message.inspection
    replaceImageUrl(baseImage, 'base', message.baseJpeg)
    replaceImageUrl(gainImage, 'gain', message.gainMapJpeg)
    metadata.textContent = JSON.stringify(message.inspection, null, 2)
    if (message.inspection.container === 'jpeg') {
      const total = message.inspection.gainMap.end
      const basePercent = (message.inspection.primary.end / total) * 100
      ranges.innerHTML = `<span class="range-base" style="width:${basePercent}%">SDR primary</span><span class="range-map" style="width:${100 - basePercent}%">gain map</span>`
    }
    const sourceDimensions = message.inspection.metadata.baseDimensions
    input('hdr-crop-x').value = '0'
    input('hdr-crop-y').value = '0'
    input('hdr-crop-width').value = String(sourceDimensions.width)
    input('hdr-crop-height').value = String(sourceDimensions.height)
    input('hdr-output-width').value = String(sourceDimensions.width)
    input('hdr-output-height').value = String(sourceDimensions.height)
  } else {
    inspection = message.inspection
    metadata.textContent = JSON.stringify(message.inspection, null, 2)
  }
  updateRendered(message.linearRgb, message.previewRgba, message.falseColorRgba, message.report)
})

file.addEventListener('change', () => {
  const selected = file.files?.[0]
  if (!selected) return
  void selected.arrayBuffer().then((bytes) => openBytes(selected.name, bytes))
})

button('hdr-open-url').addEventListener('click', () => {
  try {
    const parsed = new URL(remoteUrl.value)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error()
    setBusy('Fetching the remote image. The origin must permit CORS.')
    void fetch(parsed.href)
      .then((response) => {
        if (!response.ok) throw new Error(`Remote image returned HTTP ${response.status}`)
        return response.arrayBuffer()
      })
      .then((bytes) => openBytes(parsed.pathname.split('/').pop() || 'remote.jpg', bytes))
      .catch((cause: unknown) => {
        status.textContent = cause instanceof Error ? cause.message : String(cause)
      })
  } catch {
    status.textContent = 'Enter an HTTP or HTTPS URL whose server permits CORS.'
  }
})

boost.addEventListener('input', () => {
  boostValue.textContent = `${Number(boost.value).toFixed(2)}×`
  scheduleRender()
})

for (const id of [
  'hdr-crop-x',
  'hdr-crop-y',
  'hdr-crop-width',
  'hdr-crop-height',
  'hdr-output-width',
  'hdr-output-height',
]) {
  input(id).addEventListener('change', scheduleRender)
}
select('hdr-kernel').addEventListener('change', scheduleRender)

button('hdr-auto-orient').addEventListener('click', () => {
  autoOrient = !autoOrient
  button('hdr-auto-orient').setAttribute('aria-pressed', String(autoOrient))
  scheduleRender()
})

button('hdr-flip-h').addEventListener('click', () => {
  flipHorizontal = !flipHorizontal
  button('hdr-flip-h').setAttribute('aria-pressed', String(flipHorizontal))
  scheduleRender()
})

button('hdr-flip-v').addEventListener('click', () => {
  flipVertical = !flipVertical
  button('hdr-flip-v').setAttribute('aria-pressed', String(flipVertical))
  scheduleRender()
})

button('hdr-rotate').addEventListener('click', () => {
  rotation = rotation === 270 ? 0 : ((rotation + 90) as 90 | 180 | 270)
  button('hdr-rotate').textContent = rotation === 0 ? 'Rotate 90°' : `Rotation ${rotation}°`
  const width = input('hdr-output-width').value
  input('hdr-output-width').value = input('hdr-output-height').value
  input('hdr-output-height').value = width
  scheduleRender()
})

button('hdr-jpeg').addEventListener('click', () => {
  const value = metadataMode.value
  if (value !== 'dual' && value !== 'iso' && value !== 'ultra-hdr') {
    status.textContent = 'Choose a supported metadata mode.'
    return
  }
  setBusy('Transforming and encoding both JPEG renditions locally…')
  worker.postMessage({
    type: 'repack',
    ...nextIdentity(),
    metadataMode: value,
    operations: currentOperations(),
    baseQuality: Number(input('hdr-base-quality').value),
    gainMapQuality: Number(input('hdr-map-quality').value),
  } satisfies HdrSurgeryRequest)
})

button('hdr-avif').addEventListener('click', () => {
  setBusy('Encoding the constrained ISO gain-map AVIF locally…')
  worker.postMessage({
    type: 'avif',
    ...nextIdentity(),
    operations: currentOperations(),
  } satisfies HdrSurgeryRequest)
})

button('hdr-cancel').addEventListener('click', () => {
  worker.postMessage({ type: 'cancel', ...nextIdentity() } satisfies HdrSurgeryRequest)
  status.textContent = 'Operation cancelled.'
  button('hdr-cancel').disabled = true
})

button('hdr-reset').addEventListener('click', () => {
  worker.postMessage({ type: 'cancel', ...nextIdentity() } satisfies HdrSurgeryRequest)
  boost.value = '4'
  boostValue.textContent = '4.00×'
  resetTransformState()
  openSample()
})

button('hdr-export').addEventListener('click', () => {
  if (!report) return
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }),
  )
  const link = document.createElement('a')
  link.href = url
  link.download = 'purejsimage-hdr-surgery-evidence.json'
  link.click()
  URL.revokeObjectURL(url)
})

adapted.addEventListener('pointermove', (event) => {
  if (!inspection || !linearRgb) return
  const bounds = adapted.getBoundingClientRect()
  const x = Math.max(
    0,
    Math.min(
      adapted.width - 1,
      Math.floor(((event.clientX - bounds.left) * adapted.width) / bounds.width),
    ),
  )
  const y = Math.max(
    0,
    Math.min(
      adapted.height - 1,
      Math.floor(((event.clientY - bounds.top) * adapted.height) / bounds.height),
    ),
  )
  const offset = (y * adapted.width + x) * 3
  probe.textContent = `(${x}, ${y}) adapted linear RGB ${[
    linearRgb[offset] ?? 0,
    linearRgb[offset + 1] ?? 0,
    linearRgb[offset + 2] ?? 0,
  ]
    .map((value) => value.toFixed(4))
    .join(', ')}`
})

const highDynamicRange = window.matchMedia?.('(dynamic-range: high)').matches === true
element('hdr-display').textContent = highDynamicRange
  ? 'This browser reports a high-dynamic-range display.'
  : 'This browser does not report a high-dynamic-range display. Use the SDR and false-color previews.'

window.addEventListener('pagehide', () => {
  worker.terminate()
  revoke(baseUrl)
  revoke(gainUrl)
  revoke(nativeUrl)
})

resetTransformState()
openSample()
