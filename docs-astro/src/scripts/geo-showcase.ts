import type {
  GeoAnalysisKind,
  GeoDemoKind,
  GeoDemoMetadata,
  GeoDemoRegion,
  GeoDemoSelection,
  GeoDemoTelemetry,
  GeoDemoWorkerRequest,
  GeoDemoWorkerResponse,
} from './geo-showcase-types.ts'

type ElementConstructor<ElementType extends Element> = new () => ElementType
const required = <ElementType extends Element>(
  id: string,
  Constructor: ElementConstructor<ElementType>,
): ElementType => {
  const value = document.getElementById(id)
  if (!(value instanceof Constructor)) throw new Error(`Geo showcase element #${id} is missing`)
  return value
}

const text = (value: unknown): string => {
  if (typeof value === 'number') return Number.isFinite(value) ? value.toLocaleString() : 'n/a'
  if (Array.isArray(value)) return value.join(', ')
  return value === undefined || value === null || value === '' ? 'n/a' : String(value)
}

const formatBytes = (value: number): string => {
  if (value < 1_024) return `${value} B`
  if (value < 1_024 * 1_024) return `${(value / 1_024).toFixed(1)} KiB`
  return `${(value / (1_024 * 1_024)).toFixed(2)} MiB`
}

const copyText = async (value: string): Promise<void> => {
  await navigator.clipboard.writeText(value)
}

interface LabElements {
  readonly root: HTMLElement
  readonly url: HTMLInputElement
  readonly open: HTMLButtonElement
  readonly cancel: HTMLButtonElement
  readonly canvas: HTMLCanvasElement
  readonly status: HTMLElement
  readonly dataset: HTMLSelectElement
  readonly level: HTMLSelectElement
  readonly band: HTMLSelectElement
  readonly time: HTMLSelectElement
  readonly vertical: HTMLSelectElement
  readonly mode: HTMLSelectElement
  readonly sample: HTMLElement
}

type WorkerCommand =
  | { readonly kind: 'open'; readonly sourceKind: GeoDemoKind; readonly url: string }
  | { readonly kind: 'render'; readonly selection: GeoDemoSelection }
  | { readonly kind: 'dataset'; readonly datasetId: string }
  | {
      readonly kind: 'analyze'
      readonly analysis: GeoAnalysisKind
      readonly selection: GeoDemoSelection
    }
  | {
      readonly kind: 'sample'
      readonly selection: GeoDemoSelection
      readonly x: number
      readonly y: number
    }
  | { readonly kind: 'cancel' }
  | { readonly kind: 'close' }

const labElements = (kind: GeoDemoKind): LabElements => ({
  root: required(`${kind}-lab`, HTMLElement),
  url: required(`${kind}-url`, HTMLInputElement),
  open: required(`${kind}-open`, HTMLButtonElement),
  cancel: required(`${kind}-cancel`, HTMLButtonElement),
  canvas: required(`${kind}-canvas`, HTMLCanvasElement),
  status: required(`${kind}-status`, HTMLElement),
  dataset: required(`${kind}-dataset`, HTMLSelectElement),
  level: required(`${kind}-level`, HTMLSelectElement),
  band: required(`${kind}-band`, HTMLSelectElement),
  time: required(`${kind}-time`, HTMLSelectElement),
  vertical: required(`${kind}-vertical`, HTMLSelectElement),
  mode: required(`${kind}-mode`, HTMLSelectElement),
  sample: required(`${kind}-sample`, HTMLElement),
})

const setOptions = (
  select: HTMLSelectElement,
  options: readonly { readonly value: string; readonly label: string }[],
): void => {
  select.replaceChildren(
    ...options.map(({ value, label }) => {
      const option = document.createElement('option')
      option.value = value
      option.textContent = label
      return option
    }),
  )
  select.disabled = options.length < 2
}

class GeoLab {
  readonly kind: GeoDemoKind
  readonly elements: LabElements
  readonly worker: Worker
  metadata?: GeoDemoMetadata
  selection?: GeoDemoSelection
  #requestId = 0
  #latestPrimaryRequest = 0
  #latestSampleRequest = 0
  #sampleFrame: number | undefined
  #dragStart:
    | { readonly clientX: number; readonly clientY: number; readonly region: GeoDemoRegion }
    | undefined
  onActivate?: (lab: GeoLab) => void
  onState?: () => void

  constructor(kind: GeoDemoKind) {
    this.kind = kind
    this.elements = labElements(kind)
    this.worker = new Worker(new URL('./geo-showcase-worker.js', import.meta.url), {
      type: 'module',
    })
    this.worker.addEventListener('message', (event: MessageEvent<GeoDemoWorkerResponse>) => {
      this.#receive(event.data)
    })
    this.elements.open.addEventListener('click', () => this.open())
    this.elements.cancel.addEventListener('click', () => this.cancel())
    this.elements.url.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') this.open()
    })
    for (const select of [
      this.elements.dataset,
      this.elements.level,
      this.elements.band,
      this.elements.time,
      this.elements.vertical,
      this.elements.mode,
    ]) {
      select.addEventListener('change', () => this.#selectionChanged(select))
    }
    for (const button of this.elements.root.querySelectorAll<HTMLButtonElement>('[data-pan]')) {
      button.addEventListener('click', () => this.pan(button.dataset.pan ?? ''))
    }
    for (const button of this.elements.root.querySelectorAll<HTMLButtonElement>('[data-zoom]')) {
      button.addEventListener('click', () => this.zoom(button.dataset.zoom === 'in' ? 0.5 : 2))
    }
    for (const button of this.elements.root.querySelectorAll<HTMLButtonElement>(
      '[data-geo-preset]',
    )) {
      button.addEventListener('click', () => {
        const url = button.dataset.geoPreset
        if (url !== undefined) this.elements.url.value = new URL(url, window.location.href).href
        this.open()
      })
    }
    this.elements.canvas.addEventListener('pointerdown', (event) => this.#startDrag(event))
    this.elements.canvas.addEventListener('pointermove', (event) => this.#pointerMove(event))
    this.elements.canvas.addEventListener('pointerup', (event) => this.#endDrag(event))
    this.elements.canvas.addEventListener('pointercancel', () => {
      this.#dragStart = undefined
    })
    this.elements.canvas.addEventListener('keydown', (event) => this.#key(event))
  }

  #send(message: WorkerCommand): number {
    this.#requestId += 1
    const request: GeoDemoWorkerRequest = { ...message, requestId: this.#requestId }
    this.worker.postMessage(request)
    return this.#requestId
  }

  #setStatus(message: string, state: 'idle' | 'loading' | 'ready' | 'error' = 'idle'): void {
    this.elements.status.textContent = message
    this.elements.status.dataset.state = state
    this.elements.root.dataset.state = state
  }

  open(): void {
    let url: URL
    try {
      url = new URL(this.elements.url.value, window.location.href)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error()
    } catch {
      this.#setStatus('Enter a valid HTTP or HTTPS source URL.', 'error')
      return
    }
    this.#setStatus(`Opening ${this.kind === 'cog' ? 'GeoTIFF' : 'GeoZarr'} metadata…`, 'loading')
    this.elements.open.disabled = true
    this.elements.cancel.disabled = false
    this.#latestPrimaryRequest = this.#send({
      kind: 'open',
      sourceKind: this.kind,
      url: url.href,
    })
    this.onActivate?.(this)
  }

  cancel(): void {
    this.#latestPrimaryRequest = this.#send({ kind: 'cancel' })
    this.#setStatus('Cancelling the active request…', 'loading')
  }

  #opened(metadata: GeoDemoMetadata, telemetry: GeoDemoTelemetry): void {
    this.metadata = metadata
    const firstLevel = metadata.levels[0]
    if (firstLevel === undefined) throw new Error('Geo source has no resolution level')
    this.selection = {
      datasetId: metadata.datasetId,
      levelId: firstLevel.id,
      mode: 'grayscale',
      band: 0,
      time: 0,
      vertical: 0,
      region: {
        x: 0,
        y: 0,
        width: Math.min(512, firstLevel.width),
        height: Math.min(320, firstLevel.height),
      },
    }
    setOptions(
      this.elements.dataset,
      metadata.datasets.map((dataset) => ({ value: dataset.id, label: dataset.title })),
    )
    setOptions(
      this.elements.level,
      metadata.levels.map((level, index) => ({
        value: level.id,
        label: `${index}: ${level.width} × ${level.height}`,
      })),
    )
    const bandAxis = metadata.axes.find((axis) => axis.kind === 'band')
    const bandCount = bandAxis?.length ?? metadata.bands.length
    setOptions(
      this.elements.band,
      Array.from({ length: Math.max(1, bandCount) }, (_, index) => ({
        value: String(index),
        label: metadata.bands[index]?.name ?? `Band ${index + 1}`,
      })),
    )
    this.#axisOptions('time', this.elements.time)
    const vertical = metadata.axes.find((axis) => axis.kind === 'vertical' || axis.kind === 'depth')
    setOptions(
      this.elements.vertical,
      Array.from({ length: vertical?.length ?? 1 }, (_, index) => ({
        value: String(index),
        label: vertical === undefined ? 'Not present' : `${vertical.id} ${index}`,
      })),
    )
    const colors = new Set(metadata.bands.map((band) => band.color))
    const rgb = this.elements.mode.querySelector<HTMLOptionElement>('option[value="rgb"]')
    const cir = this.elements.mode.querySelector<HTMLOptionElement>('option[value="cir"]')
    if (rgb === null || cir === null) throw new Error('Geo mapping options are incomplete')
    rgb.disabled = !(colors.has('red') && colors.has('green') && colors.has('blue'))
    cir.disabled = !(colors.has('nir') && colors.has('red') && colors.has('green'))
    this.#facts(metadata)
    this.#telemetry(telemetry)
    this.#setStatus('Metadata validated. Reading the first bounded viewport…', 'loading')
    this.render()
    this.onState?.()
  }

  #axisOptions(kind: string, select: HTMLSelectElement): void {
    const axis = this.metadata?.axes.find((entry) => entry.kind === kind)
    setOptions(
      select,
      Array.from({ length: axis?.length ?? 1 }, (_, index) => ({
        value: String(index),
        label: axis === undefined ? 'Not present' : `${axis.id} ${index}`,
      })),
    )
  }

  #facts(metadata: GeoDemoMetadata): void {
    const activeLevel =
      metadata.levels.find((level) => level.id === this.selection?.levelId) ?? metadata.levels[0]
    const values: Readonly<Record<string, unknown>> = {
      format: metadata.format,
      container: metadata.container,
      byteOrder: metadata.byteOrder,
      dimensions: `${metadata.width.toLocaleString()} × ${metadata.height.toLocaleString()}`,
      tileDimensions: metadata.tileDimensions,
      compression: activeLevel?.compression,
      sampleType: metadata.sampleType,
      crs: metadata.crs,
      affine: activeLevel?.affine,
      bounds: metadata.bounds,
      registration: metadata.registration,
      levels: metadata.levels.length,
      activeLevel:
        activeLevel === undefined
          ? undefined
          : `${activeLevel.id}: ${activeLevel.width.toLocaleString()} × ${activeLevel.height.toLocaleString()}`,
      zarrVersion: metadata.zarrVersion,
      conventions: metadata.conventions?.join('\n'),
      axes: metadata.axes.map((axis) => `${axis.id}:${axis.length}`).join(', '),
      chunkShape: activeLevel?.chunkShape,
      shardShape: activeLevel?.outerShardShape,
      codecs: metadata.codecs?.join(', '),
    }
    for (const element of this.elements.root.querySelectorAll<HTMLElement>('[data-geo-fact]')) {
      element.textContent = text(values[element.dataset.geoFact ?? ''])
    }
  }

  #telemetry(value: GeoDemoTelemetry): void {
    const values: Readonly<Record<string, string>> = {
      metadataRequests: value.metadataRequests.toLocaleString(),
      dataRequests: value.dataRequests.toLocaleString(),
      transferredBytes: formatBytes(value.transferredBytes),
      uniqueBytes: formatBytes(value.uniqueBytes),
      cacheHits: value.cacheHits.toLocaleString(),
      coalesced: value.coalesced.toLocaleString(),
      cancelled: value.cancelled.toLocaleString(),
      percentage:
        value.sourceBytes === undefined
          ? 'n/a'
          : `${((value.uniqueBytes / value.sourceBytes) * 100).toFixed(2)}%`,
    }
    for (const element of this.elements.root.querySelectorAll<HTMLElement>(
      '[data-geo-telemetry]',
    )) {
      element.textContent = values[element.dataset.geoTelemetry ?? ''] ?? 'n/a'
    }
  }

  render(): void {
    if (this.selection === undefined) return
    this.#setStatus('Reading only the selected viewport…', 'loading')
    this.#latestPrimaryRequest = this.#send({ kind: 'render', selection: this.selection })
    this.onActivate?.(this)
  }

  #draw(width: number, height: number, rgba: Uint8ClampedArray): void {
    this.elements.canvas.width = width
    this.elements.canvas.height = height
    const context = this.elements.canvas.getContext('2d', { alpha: false })
    if (context === null) throw new Error('Canvas 2D rendering is unavailable')
    context.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0)
  }

  #receive(message: GeoDemoWorkerResponse): void {
    if (message.kind === 'sample') {
      if (
        message.requestId !== this.#latestSampleRequest ||
        message.requestId < this.#latestPrimaryRequest
      )
        return
    } else if (message.requestId < this.#latestPrimaryRequest) {
      return
    }
    if (message.kind === 'opened') this.#opened(message.metadata, message.telemetry)
    else if (message.kind === 'frame') {
      this.#draw(message.width, message.height, message.rgba)
      this.#telemetry(message.telemetry)
      this.#setStatus(
        'Viewport ready. Drag, use arrow keys, or zoom to request another bounded region.',
        'ready',
      )
      this.elements.open.disabled = false
      this.elements.cancel.disabled = true
      this.onState?.()
    } else if (message.kind === 'analysis') {
      if (
        message.rgba !== undefined &&
        message.width !== undefined &&
        message.height !== undefined
      ) {
        this.#draw(message.width, message.height, message.rgba)
      }
      this.#telemetry(message.telemetry)
      required('geo-analysis-output', HTMLElement).textContent = message.summary
      this.#setStatus('Bounded analysis complete.', 'ready')
    } else if (message.kind === 'sample') {
      this.elements.sample.textContent = `Pixel ${this.#lastPointer?.x.toFixed(1) ?? '?'}, ${this.#lastPointer?.y.toFixed(1) ?? '?'} · world ${message.world[0].toFixed(3)}, ${message.world[1].toFixed(3)} · sample ${message.values.map((value) => value.toFixed(3)).join(', ')}`
    } else if (message.kind === 'cancelled') {
      this.#setStatus('Request cancelled and partial work discarded.', 'idle')
      this.elements.open.disabled = false
      this.elements.cancel.disabled = true
    } else if (message.kind === 'error') {
      this.#setStatus(message.message, 'error')
      this.elements.open.disabled = false
      this.elements.cancel.disabled = true
    } else {
      this.elements.root.dataset.worker = 'closed'
    }
  }

  #selectionChanged(select: HTMLSelectElement): void {
    const current = this.selection
    const metadata = this.metadata
    if (current === undefined || metadata === undefined) return
    if (select === this.elements.dataset && select.value !== current.datasetId) {
      this.#setStatus('Opening the selected dataset metadata…', 'loading')
      this.#latestPrimaryRequest = this.#send({ kind: 'dataset', datasetId: select.value })
      return
    }
    const levelId = this.elements.level.value
    const level = metadata.levels.find((entry) => entry.id === levelId)
    if (level === undefined) return
    const levelChanged = levelId !== current.levelId
    this.selection = {
      ...current,
      levelId,
      band: Number(this.elements.band.value),
      time: Number(this.elements.time.value),
      vertical: Number(this.elements.vertical.value),
      mode:
        this.elements.mode.value === 'rgb' || this.elements.mode.value === 'cir'
          ? this.elements.mode.value
          : 'grayscale',
      region: levelChanged
        ? { x: 0, y: 0, width: Math.min(512, level.width), height: Math.min(320, level.height) }
        : current.region,
    }
    this.#facts(metadata)
    this.render()
  }

  pan(direction: string): void {
    const current = this.selection
    const level = this.metadata?.levels.find((entry) => entry.id === current?.levelId)
    if (current === undefined || level === undefined) return
    const stepX = Math.max(1, Math.floor(current.region.width / 4))
    const stepY = Math.max(1, Math.floor(current.region.height / 4))
    const dx = direction === 'left' ? -stepX : direction === 'right' ? stepX : 0
    const dy = direction === 'up' ? -stepY : direction === 'down' ? stepY : 0
    this.selection = {
      ...current,
      region: {
        ...current.region,
        x: Math.max(0, Math.min(level.width - current.region.width, current.region.x + dx)),
        y: Math.max(0, Math.min(level.height - current.region.height, current.region.y + dy)),
      },
    }
    this.render()
  }

  zoom(factor: number): void {
    const current = this.selection
    const level = this.metadata?.levels.find((entry) => entry.id === current?.levelId)
    if (current === undefined || level === undefined) return
    const width = Math.max(4, Math.min(level.width, Math.round(current.region.width * factor)))
    const height = Math.max(4, Math.min(level.height, Math.round(current.region.height * factor)))
    const centerX = current.region.x + current.region.width / 2
    const centerY = current.region.y + current.region.height / 2
    this.selection = {
      ...current,
      region: {
        x: Math.max(0, Math.min(level.width - width, Math.round(centerX - width / 2))),
        y: Math.max(0, Math.min(level.height - height, Math.round(centerY - height / 2))),
        width,
        height,
      },
    }
    this.render()
  }

  #startDrag(event: PointerEvent): void {
    if (this.selection === undefined) return
    this.elements.canvas.setPointerCapture(event.pointerId)
    this.#dragStart = {
      clientX: event.clientX,
      clientY: event.clientY,
      region: this.selection.region,
    }
    this.onActivate?.(this)
  }

  #endDrag(event: PointerEvent): void {
    if (this.#dragStart === undefined || this.selection === undefined) return
    const scaleX = this.selection.region.width / Math.max(1, this.elements.canvas.clientWidth)
    const scaleY = this.selection.region.height / Math.max(1, this.elements.canvas.clientHeight)
    const dx = Math.round((this.#dragStart.clientX - event.clientX) * scaleX)
    const dy = Math.round((this.#dragStart.clientY - event.clientY) * scaleY)
    const level = this.metadata?.levels.find((entry) => entry.id === this.selection?.levelId)
    if (level !== undefined) {
      this.selection = {
        ...this.selection,
        region: {
          ...this.selection.region,
          x: Math.max(
            0,
            Math.min(level.width - this.selection.region.width, this.#dragStart.region.x + dx),
          ),
          y: Math.max(
            0,
            Math.min(level.height - this.selection.region.height, this.#dragStart.region.y + dy),
          ),
        },
      }
      this.render()
    }
    this.#dragStart = undefined
  }

  #lastPointer?: { readonly x: number; readonly y: number }
  #pointerMove(event: PointerEvent): void {
    const selection = this.selection
    if (selection === undefined || this.#dragStart !== undefined) return
    const rectangle = this.elements.canvas.getBoundingClientRect()
    const x =
      selection.region.x +
      ((event.clientX - rectangle.left) / rectangle.width) * selection.region.width
    const y =
      selection.region.y +
      ((event.clientY - rectangle.top) / rectangle.height) * selection.region.height
    this.#lastPointer = { x, y }
    if (this.#sampleFrame !== undefined) return
    this.#sampleFrame = window.requestAnimationFrame(() => {
      this.#sampleFrame = undefined
      const pointer = this.#lastPointer
      const current = this.selection
      if (pointer === undefined || current === undefined) return
      this.#latestSampleRequest = this.#send({
        kind: 'sample',
        selection: current,
        x: pointer.x,
        y: pointer.y,
      })
    })
  }

  #key(event: KeyboardEvent): void {
    const directions: Readonly<Record<string, string>> = {
      ArrowLeft: 'left',
      ArrowRight: 'right',
      ArrowUp: 'up',
      ArrowDown: 'down',
    }
    const direction = directions[event.key]
    if (direction !== undefined) {
      event.preventDefault()
      this.pan(direction)
    } else if (event.key === '+' || event.key === '=') {
      event.preventDefault()
      this.zoom(0.5)
    } else if (event.key === '-') {
      event.preventDefault()
      this.zoom(2)
    }
  }

  analyze(analysis: GeoAnalysisKind): void {
    if (this.selection === undefined) {
      required('geo-analysis-output', HTMLElement).textContent = 'Open a source first.'
      return
    }
    required('geo-analysis-output', HTMLElement).textContent = 'Running bounded analysis…'
    this.#latestPrimaryRequest = this.#send({
      kind: 'analyze',
      analysis,
      selection: this.selection,
    })
  }

  close(): void {
    if (this.#sampleFrame !== undefined) window.cancelAnimationFrame(this.#sampleFrame)
    this.#send({ kind: 'close' })
    this.worker.terminate()
    this.elements.root.dataset.worker = 'terminated'
  }
}

const cog = new GeoLab('cog')
const geozarr = new GeoLab('geozarr')
let activeLab = cog
for (const lab of [cog, geozarr]) {
  lab.onActivate = (value) => {
    activeLab = value
  }
  lab.onState = () => updateCode()
}

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-geo-analysis]')) {
  button.addEventListener('click', () => {
    const analysis = button.dataset.geoAnalysis
    if (
      analysis === 'normalized-difference' ||
      analysis === 'hillshade' ||
      analysis === 'statistics' ||
      analysis === 'line-profile'
    ) {
      activeLab.analyze(analysis)
    }
  })
}

const code = required('geo-code', HTMLElement)
const codeText = (): string => {
  const lab = activeLab
  const selection = lab.selection
  const sourceUrl = lab.metadata?.sourceUrl ?? lab.elements.url.value
  const nonSpatial = (lab.metadata?.axes ?? []).map((axis) => ({
    kind: 'index' as const,
    axisId: axis.id,
    index:
      axis.kind === 'time'
        ? (selection?.time ?? 0)
        : axis.kind === 'band'
          ? (selection?.band ?? 0)
          : axis.kind === 'vertical' || axis.kind === 'depth'
            ? (selection?.vertical ?? 0)
            : 0,
  }))
  const sourceBand = lab.metadata?.bands[selection?.band ?? 0]?.index ?? 0
  const selectedSourceBand = lab.metadata?.axes.some((axis) => axis.kind === 'band')
    ? 0
    : sourceBand
  if (lab.kind === 'geozarr') {
    return `import type { GeoRasterDataset } from 'purejsimage/geo'
import { openGeoZarrHttp } from 'purejsimage/geo/readers/geozarr'

const controller = new AbortController()
const document = await openGeoZarrHttp(${JSON.stringify(sourceUrl)}, {
  signal: controller.signal,
  limits: { maxRegionBytes: 8 * 1024 * 1024 },
})

try {
  const dataset: GeoRasterDataset = await document.openDataset(${JSON.stringify(selection?.datasetId ?? 'multiscales')})
  const view = dataset.createView({
    spatialDimensions: [dataset.descriptor.spatialDimensions.x.id, dataset.descriptor.spatialDimensions.y.id],
    nonSpatial: ${JSON.stringify(nonSpatial)},
    sourceBands: [${selectedSourceBand}],
    levelId: ${JSON.stringify(selection?.levelId ?? '0')},
  })
  for await (const tile of view.readPixelRegion({
    region: ${JSON.stringify(selection?.region ?? { x: 0, y: 0, width: 256, height: 256 })},
    signal: controller.signal,
  })) {
    console.log(tile)
    tile.release()
  }
} finally {
  await document.close?.()
}`
  }
  return `import type { GeoRasterDataset } from 'purejsimage/geo'
import { HttpRangeSource } from 'purejsimage/geo/browser'
import { geoTiffReader } from 'purejsimage/geo/readers/geotiff'

const controller = new AbortController()
const source = await HttpRangeSource.open(${JSON.stringify(sourceUrl)}, {
  openSignal: controller.signal,
  lifetimeSignal: controller.signal,
  maxCacheBytes: 4 * 1024 * 1024,
})
if (!source) throw new Error('COG not found')
const document = await geoTiffReader.open({ primary: { id: 'cog', source }, signal: controller.signal })

try {
  const summary = document.datasets[0]
  if (!summary) throw new Error('COG dataset missing')
  const dataset: GeoRasterDataset = await document.openDataset(summary.id)
  const view = dataset.createView({
    spatialDimensions: [dataset.descriptor.spatialDimensions.x.id, dataset.descriptor.spatialDimensions.y.id],
    nonSpatial: ${JSON.stringify(nonSpatial)}, sourceBands: [${sourceBand}], levelId: ${JSON.stringify(selection?.levelId ?? '0')},
  })
  for await (const tile of view.readPixelRegion({ region: ${JSON.stringify(selection?.region ?? { x: 0, y: 0, width: 256, height: 256 })}, signal: controller.signal })) {
    console.log(tile)
    tile.release()
  }
} finally {
  await document.close?.()
  controller.abort()
}`
}

const updateCode = (): void => {
  code.textContent = codeText()
}
updateCode()
required('geo-copy-code', HTMLButtonElement).addEventListener('click', async (event) => {
  await copyText(codeText())
  const button = event.currentTarget
  if (button instanceof HTMLButtonElement) {
    button.textContent = 'Copied'
    window.setTimeout(() => {
      button.textContent = 'Copy TypeScript'
    }, 1_200)
  }
})

const matrixRows = Array.from(
  document.querySelectorAll<HTMLTableRowElement>('[data-geo-format-row]'),
)
const matrixFilters = Array.from(
  document.querySelectorAll<HTMLSelectElement>('[data-geo-matrix-filter]'),
)
const filterMatrix = (): void => {
  for (const row of matrixRows) {
    const values = new Set((row.dataset.capabilities ?? '').split(' '))
    const format = row.dataset.format ?? ''
    row.hidden = matrixFilters.some((filter) => {
      const value = filter.value
      if (value === '') return false
      return filter.dataset.geoMatrixFilter === 'format' ? format !== value : !values.has(value)
    })
  }
  required('geo-matrix-count', HTMLElement).textContent =
    `${matrixRows.filter((row) => !row.hidden).length} formats shown`
}
for (const filter of matrixFilters) filter.addEventListener('change', filterMatrix)
filterMatrix()

window.addEventListener(
  'pagehide',
  () => {
    cog.close()
    geozarr.close()
    document.documentElement.dataset.geoWorkers = 'terminated'
  },
  { once: true },
)

declare global {
  interface Window {
    pureJsImageGeoReady?: boolean
  }
}
window.pureJsImageGeoReady = true
