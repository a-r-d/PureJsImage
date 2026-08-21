import type {
  GeoAnalysisKind,
  GeoDemoKind,
  GeoDemoLevel,
  GeoDemoMetadata,
  GeoDemoRegion,
  GeoDemoSelection,
  GeoDemoTelemetry,
  GeoDemoWorkerRequest,
  GeoDemoWorkerResponse,
} from './geo-showcase-types.ts'

const maximumViewportWidth = 512
const maximumViewportHeight = 384
const minimumViewportDimension = 4

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

const formatDisplayValue = (value: number): string => Number(value.toPrecision(4)).toLocaleString()

const analysisDisplayName = (analysis: GeoAnalysisKind): string => {
  if (analysis === 'normalized-difference') return 'Normalized difference'
  if (analysis === 'hillshade') return 'Hillshade'
  if (analysis === 'statistics') return 'Statistics'
  return 'Line profile'
}

const copyText = async (value: string): Promise<void> => {
  try {
    await navigator.clipboard.writeText(value)
    return
  } catch {
    const textarea = document.createElement('textarea')
    textarea.value = value
    textarea.readOnly = true
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.append(textarea)
    textarea.select()
    const copied = document.execCommand('copy')
    textarea.remove()
    if (!copied) throw new Error('Clipboard access is unavailable')
  }
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
  readonly canvasWrap: HTMLElement
  readonly loading: HTMLElement
  readonly loadingTitle: HTMLElement
  readonly loadingDetail: HTMLElement
  readonly loadingProgress: HTMLElement
  readonly loadingCancel: HTMLButtonElement
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
  canvasWrap: required(`${kind}-canvas-wrap`, HTMLElement),
  loading: required(`${kind}-loading`, HTMLElement),
  loadingTitle: required(`${kind}-loading-title`, HTMLElement),
  loadingDetail: required(`${kind}-loading-detail`, HTMLElement),
  loadingProgress: required(`${kind}-loading-progress`, HTMLElement),
  loadingCancel: required(`${kind}-loading-cancel`, HTMLButtonElement),
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

interface GeoPreset {
  readonly title: string
  readonly provider: string
  readonly initialLevelId?: string
  readonly initialMode?: 'grayscale' | 'rgb' | 'cir'
  readonly center: boolean
  readonly initialX?: number
  readonly initialY?: number
  readonly rgb?: readonly number[]
  readonly cir?: readonly number[]
  readonly normalizedDifferenceBands?: readonly [number, number]
  readonly terrainBand?: number
  readonly analysisContext?: string
  readonly attribution?: string
  readonly attributionUrl?: string
}

const bandMapping = (value: string | undefined): readonly number[] | undefined => {
  if (value === undefined) return undefined
  const bands = value.split(',').map(Number)
  return bands.length === 3 && bands.every((band) => Number.isSafeInteger(band) && band >= 0)
    ? bands
    : undefined
}

const bandPair = (value: string | undefined): readonly [number, number] | undefined => {
  if (value === undefined) return undefined
  const bands = value.split(',').map(Number)
  return bands.length === 2 && bands.every((band) => Number.isSafeInteger(band) && band >= 0)
    ? [bands[0] ?? 0, bands[1] ?? 0]
    : undefined
}

const bandIndex = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined
  const band = Number(value)
  return Number.isSafeInteger(band) && band >= 0 ? band : undefined
}

const presetFor = (button: HTMLButtonElement): GeoPreset => {
  const rgb = bandMapping(button.dataset.geoRgb)
  const cir = bandMapping(button.dataset.geoCir)
  const normalizedDifferenceBands = bandPair(button.dataset.geoNormalizedDifference)
  const terrainBand = bandIndex(button.dataset.geoTerrainBand)
  const initialX = bandIndex(button.dataset.geoInitialX)
  const initialY = bandIndex(button.dataset.geoInitialY)
  return {
    title: button.dataset.geoPresetTitle ?? button.textContent?.trim() ?? 'Geo raster',
    provider: button.dataset.geoPresetProvider ?? 'Custom source',
    ...(button.dataset.geoInitialLevel === undefined
      ? {}
      : { initialLevelId: button.dataset.geoInitialLevel }),
    ...(button.dataset.geoInitialMode === 'rgb' || button.dataset.geoInitialMode === 'cir'
      ? { initialMode: button.dataset.geoInitialMode }
      : {}),
    center: button.dataset.geoInitialRegion === 'center',
    ...(initialX === undefined ? {} : { initialX }),
    ...(initialY === undefined ? {} : { initialY }),
    ...(rgb === undefined ? {} : { rgb }),
    ...(cir === undefined ? {} : { cir }),
    ...(normalizedDifferenceBands === undefined ? {} : { normalizedDifferenceBands }),
    ...(terrainBand === undefined ? {} : { terrainBand }),
    ...(button.dataset.geoAnalysisContext === undefined
      ? {}
      : { analysisContext: button.dataset.geoAnalysisContext }),
    ...(button.dataset.geoAttribution === undefined
      ? {}
      : { attribution: button.dataset.geoAttribution }),
    ...(button.dataset.geoAttributionUrl === undefined
      ? {}
      : { attributionUrl: button.dataset.geoAttributionUrl }),
  }
}

const sameRegion = (left: GeoDemoRegion, right: GeoDemoRegion): boolean =>
  left.x === right.x &&
  left.y === right.y &&
  left.width === right.width &&
  left.height === right.height

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
  #preset: GeoPreset | undefined
  #loadingStartedAt = performance.now()
  #loadingDetail = ''
  #loadingTimer: number | undefined
  #loadingDelayTimer: number | undefined
  #lastTelemetry: GeoDemoTelemetry | undefined
  #displaySummary = 'Auto contrast pending'
  #visibleDataRegion: GeoDemoRegion | undefined
  #latestAnalysisRequest = 0
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
    this.worker.addEventListener('error', (event) => {
      this.#workerFailed(event.message)
    })
    this.worker.addEventListener('messageerror', () => {
      this.#workerFailed('The worker returned an unreadable message')
    })
    this.elements.open.addEventListener('click', () => this.open())
    this.elements.cancel.addEventListener('click', () => this.cancel())
    this.elements.loadingCancel.addEventListener('click', () => this.cancel())
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
        for (const candidate of this.elements.root.querySelectorAll<HTMLButtonElement>(
          '[data-geo-preset]',
        )) {
          candidate.setAttribute('aria-pressed', String(candidate === button))
        }
        this.open(presetFor(button))
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

  #workerFailed(detail: string): void {
    this.#setStatus(`Demo worker could not start. ${detail}`, 'error')
    this.#hideLoading()
    this.elements.open.disabled = false
    this.elements.cancel.disabled = true
    this.elements.root.dataset.worker = 'error'
  }

  #updateLoadingDetail(): void {
    const seconds = Math.max(0, Math.floor((performance.now() - this.#loadingStartedAt) / 1_000))
    const elapsed = seconds === 0 ? 'just started' : `${seconds}s elapsed`
    this.elements.loadingDetail.textContent = `${this.#loadingDetail} · ${elapsed}`
  }

  #showLoading(title: string, detail: string, preview = false): void {
    if (this.#loadingDelayTimer !== undefined) window.clearTimeout(this.#loadingDelayTimer)
    this.#loadingDelayTimer = undefined
    if (this.#loadingTimer !== undefined) window.clearInterval(this.#loadingTimer)
    this.#loadingStartedAt = performance.now()
    this.#loadingDetail = detail
    this.elements.loadingTitle.textContent = title
    this.elements.loading.hidden = false
    this.elements.loading.dataset.preview = String(preview)
    this.elements.loadingProgress.dataset.indeterminate = 'true'
    this.elements.loadingCancel.disabled = false
    this.elements.canvasWrap.setAttribute('aria-busy', 'true')
    this.#updateLoadingDetail()
    this.#loadingTimer = window.setInterval(() => this.#updateLoadingDetail(), 1_000)
  }

  #showLoadingAfterDelay(title: string, detail: string, preview = false): void {
    this.#hideLoading()
    this.#loadingDelayTimer = window.setTimeout(() => {
      this.#loadingDelayTimer = undefined
      this.#showLoading(title, detail, preview)
    }, 180)
  }

  #hideLoading(): void {
    if (this.#loadingDelayTimer !== undefined) window.clearTimeout(this.#loadingDelayTimer)
    this.#loadingDelayTimer = undefined
    if (this.#loadingTimer !== undefined) window.clearInterval(this.#loadingTimer)
    this.#loadingTimer = undefined
    this.elements.loading.hidden = true
    this.elements.loadingCancel.disabled = true
    this.elements.canvasWrap.setAttribute('aria-busy', 'false')
  }

  #updateAttribution(url: URL, preset: GeoPreset | undefined): void {
    const title = this.elements.root.querySelector<HTMLElement>('[data-geo-attribution-title]')
    const copy = this.elements.root.querySelector<HTMLElement>('[data-geo-attribution-copy]')
    const link = this.elements.root.querySelector<HTMLAnchorElement>('[data-geo-attribution-link]')
    if (title === null || copy === null || link === null) return
    title.textContent = preset === undefined ? 'Custom source' : 'Source'
    copy.textContent =
      preset?.attribution ??
      `${url.hostname}. Check the publisher's source and license terms before reuse.`
    link.href = preset?.attributionUrl ?? url.href
    link.textContent = preset === undefined ? 'Open source' : 'Source information'
  }

  open(preset?: GeoPreset): void {
    let url: URL
    try {
      url = new URL(this.elements.url.value, window.location.href)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error()
    } catch {
      this.#setStatus('Enter a valid HTTP or HTTPS source URL.', 'error')
      this.#hideLoading()
      return
    }
    this.#preset = preset
    const sourceTitle =
      preset?.title ?? new URL(url.href).pathname.split('/').filter(Boolean).pop() ?? 'Geo raster'
    const sourceProvider = preset?.provider ?? url.hostname
    for (const element of this.elements.root.querySelectorAll<HTMLElement>(
      '[data-geo-source-title]',
    )) {
      element.textContent = sourceTitle
    }
    for (const element of this.elements.root.querySelectorAll<HTMLElement>(
      '[data-geo-source-provider]',
    )) {
      element.textContent = sourceProvider
    }
    this.#updateAttribution(url, preset)
    updateAnalysisContext(this)
    this.#setStatus(`Opening ${sourceTitle} metadata…`, 'loading')
    this.#showLoading(
      `Opening ${sourceTitle}`,
      this.kind === 'cog'
        ? 'Connecting to object storage and reading bounded TIFF metadata'
        : 'Connecting to object storage and reading bounded Zarr metadata',
    )
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
    this.#showLoading(
      'Stopping the active read',
      'Cancelling source requests and discarding partial work',
      this.metadata !== undefined,
    )
    this.elements.loadingCancel.disabled = true
  }

  #opened(metadata: GeoDemoMetadata, telemetry: GeoDemoTelemetry): void {
    this.metadata = metadata
    this.#displaySummary = 'Auto contrast pending'
    this.#visibleDataRegion = undefined
    const bandAxis = metadata.axes.find((axis) => axis.kind === 'band')
    const bandCount = bandAxis?.length ?? metadata.bands.length
    const firstLevel =
      metadata.levels.find((level) => level.id === this.#preset?.initialLevelId) ??
      metadata.levels[0]
    if (firstLevel === undefined) throw new Error('Geo source has no resolution level')
    const mode = this.#preset?.initialMode ?? 'grayscale'
    const initialDisplayBands = this.#presetBands(mode)
    this.selection = {
      datasetId: metadata.datasetId,
      levelId: firstLevel.id,
      mode,
      band: 0,
      time: 0,
      vertical: 0,
      region: this.#regionFor(
        firstLevel,
        this.#preset?.center === true,
        this.#preset?.initialX,
        this.#preset?.initialY,
      ),
      ...(initialDisplayBands === undefined ? {} : { displayBands: initialDisplayBands }),
      ...(this.#preset?.normalizedDifferenceBands === undefined
        ? {}
        : { normalizedDifferenceBands: this.#preset.normalizedDifferenceBands }),
      ...(this.#preset?.terrainBand === undefined && bandCount !== 1
        ? {}
        : { terrainBand: this.#preset?.terrainBand ?? 0 }),
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
    this.elements.dataset.value = metadata.datasetId
    this.elements.level.value = firstLevel.id
    setOptions(
      this.elements.band,
      Array.from({ length: Math.max(1, bandCount) }, (_, index) => ({
        value: String(index),
        label: metadata.bands[index]?.name ?? `Band ${index + 1}`,
      })),
    )
    this.elements.band.value = '0'
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
    rgb.disabled =
      this.#preset?.rgb === undefined &&
      !(colors.has('red') && colors.has('green') && colors.has('blue'))
    cir.disabled =
      this.#preset?.cir === undefined &&
      !(colors.has('nir') && colors.has('red') && colors.has('green'))
    this.elements.mode.value = mode
    this.#facts(metadata)
    this.#updateViewportControls()
    this.#lastTelemetry = undefined
    this.#telemetry(telemetry)
    this.render(
      'Loading the first viewport',
      `Metadata ready after ${telemetry.metadataRequests.toLocaleString()} requests. Reading level ${firstLevel.id}`,
      true,
    )
    updateAnalysisContext(this)
    this.onState?.()
  }

  #presetBands(mode: 'grayscale' | 'rgb' | 'cir'): readonly number[] | undefined {
    if (mode === 'rgb') return this.#preset?.rgb
    if (mode === 'cir') return this.#preset?.cir
    return undefined
  }

  #regionFor(
    level: Readonly<{ width: number; height: number }>,
    center: boolean,
    initialX?: number,
    initialY?: number,
  ): GeoDemoRegion {
    const width = Math.min(maximumViewportWidth, level.width)
    const height = Math.min(maximumViewportHeight, level.height)
    return {
      x: Math.min(
        level.width - width,
        initialX ?? (center ? Math.max(0, Math.floor((level.width - width) / 2)) : 0),
      ),
      y: Math.min(
        level.height - height,
        initialY ?? (center ? Math.max(0, Math.floor((level.height - height) / 2)) : 0),
      ),
      width,
      height,
    }
  }

  #regionAtCenter(
    sourceLevel: GeoDemoLevel,
    sourceRegion: GeoDemoRegion,
    targetLevel: GeoDemoLevel,
    requestedWidth: number,
    requestedHeight: number,
  ): GeoDemoRegion {
    const width = Math.max(
      1,
      Math.min(maximumViewportWidth, targetLevel.width, Math.round(requestedWidth)),
    )
    const height = Math.max(
      1,
      Math.min(maximumViewportHeight, targetLevel.height, Math.round(requestedHeight)),
    )
    const normalizedCenterX = (sourceRegion.x + sourceRegion.width / 2) / sourceLevel.width
    const normalizedCenterY = (sourceRegion.y + sourceRegion.height / 2) / sourceLevel.height
    return {
      x: Math.max(
        0,
        Math.min(
          targetLevel.width - width,
          Math.round(normalizedCenterX * targetLevel.width - width / 2),
        ),
      ),
      y: Math.max(
        0,
        Math.min(
          targetLevel.height - height,
          Math.round(normalizedCenterY * targetLevel.height - height / 2),
        ),
      ),
      width,
      height,
    }
  }

  #zoomTarget(
    factor: number,
  ): { readonly level: GeoDemoLevel; readonly region: GeoDemoRegion } | undefined {
    const current = this.selection
    const levels = this.metadata?.levels
    if (current === undefined || levels === undefined) return undefined
    const currentIndex = levels.findIndex((entry) => entry.id === current.levelId)
    const currentLevel = levels[currentIndex]
    if (currentIndex < 0 || currentLevel === undefined) return undefined

    const adjacentIndex = factor < 1 ? currentIndex - 1 : currentIndex + 1
    const adjacentLevel = levels[adjacentIndex]
    const anchorRegion = factor < 1 ? (this.#visibleDataRegion ?? current.region) : current.region
    if (adjacentLevel !== undefined) {
      return {
        level: adjacentLevel,
        region: this.#regionAtCenter(
          currentLevel,
          anchorRegion,
          adjacentLevel,
          current.region.width,
          current.region.height,
        ),
      }
    }

    const width =
      factor < 1
        ? Math.max(minimumViewportDimension, Math.round(current.region.width * factor))
        : Math.min(maximumViewportWidth, Math.round(current.region.width * factor))
    const height =
      factor < 1
        ? Math.max(minimumViewportDimension, Math.round(current.region.height * factor))
        : Math.min(maximumViewportHeight, Math.round(current.region.height * factor))
    return {
      level: currentLevel,
      region: this.#regionAtCenter(currentLevel, anchorRegion, currentLevel, width, height),
    }
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
      viewport:
        this.selection === undefined
          ? undefined
          : `x ${this.selection.region.x.toLocaleString()} · y ${this.selection.region.y.toLocaleString()} · ${this.selection.region.width.toLocaleString()} × ${this.selection.region.height.toLocaleString()}`,
      display: this.#displaySummary,
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
    this.#lastTelemetry = value
  }

  render(
    title = 'Reading the selected viewport',
    detail = 'Requesting only the pixels needed for the visible region',
    showImmediately = false,
  ): void {
    if (this.selection === undefined) return
    this.#setStatus('Reading only the selected viewport…', 'loading')
    const region = this.selection.region
    const loadingDetail = `${detail} · ${region.width.toLocaleString()} × ${region.height.toLocaleString()} pixels`
    if (showImmediately) this.#showLoading(title, loadingDetail, this.metadata !== undefined)
    else this.#showLoadingAfterDelay(title, loadingDetail, this.metadata !== undefined)
    this.#latestPrimaryRequest = this.#send({ kind: 'render', selection: this.selection })
    this.onActivate?.(this)
  }

  #updateViewportControls(): void {
    const current = this.selection
    const level = this.metadata?.levels.find((entry) => entry.id === current?.levelId)
    if (current === undefined || level === undefined) return
    const atLeft = current.region.x === 0
    const atTop = current.region.y === 0
    const atRight = current.region.x + current.region.width === level.width
    const atBottom = current.region.y + current.region.height === level.height
    const boundaries: Readonly<Record<string, boolean>> = {
      left: atLeft,
      right: atRight,
      up: atTop,
      down: atBottom,
    }
    for (const button of this.elements.root.querySelectorAll<HTMLButtonElement>('[data-pan]')) {
      const direction = button.dataset.pan ?? ''
      button.disabled = boundaries[direction] === true
      button.title = button.disabled ? `${direction} edge reached` : `Pan ${direction}`
    }
    for (const button of this.elements.root.querySelectorAll<HTMLButtonElement>('[data-zoom]')) {
      const zoomingIn = button.dataset.zoom === 'in'
      const target = this.#zoomTarget(zoomingIn ? 0.5 : 2)
      const unchanged =
        target === undefined ||
        (target.level.id === current.levelId && sameRegion(target.region, current.region))
      button.disabled = unchanged
      button.title = button.disabled
        ? zoomingIn
          ? 'Maximum zoom reached'
          : 'Full overview is visible'
        : target?.level.id !== current.levelId
          ? `${zoomingIn ? 'Zoom in' : 'Zoom out'} with overview ${target?.level.id}`
          : zoomingIn
            ? 'Zoom in'
            : 'Zoom out'
    }
  }

  #applyRegion(
    region: GeoDemoRegion,
    noChangeMessage: string,
    levelId = this.selection?.levelId,
  ): boolean {
    const current = this.selection
    if (current === undefined || levelId === undefined) return false
    if (current.levelId === levelId && sameRegion(current.region, region)) {
      this.#setStatus(noChangeMessage, 'ready')
      this.#hideLoading()
      this.#updateViewportControls()
      return false
    }
    const levelChanged = current.levelId !== levelId
    this.selection = { ...current, levelId, region }
    this.elements.level.value = levelId
    if (this.metadata !== undefined) this.#facts(this.metadata)
    this.#updateViewportControls()
    setActiveAnalysis(undefined)
    this.render(
      levelChanged ? `Loading overview ${levelId}` : 'Reading the selected viewport',
      levelChanged
        ? 'Keeping the same map center while changing source resolution'
        : 'Requesting only the pixels needed for the visible region',
    )
    return true
  }

  analysisContext(): string {
    return (
      this.#preset?.analysisContext ??
      'Analysis uses the selected band. Normalized difference uses the first and third available bands.'
    )
  }

  canAnalyze(analysis: GeoAnalysisKind): boolean {
    if (this.selection === undefined || this.metadata === undefined) return false
    if (analysis !== 'normalized-difference') return true
    const bandAxis = this.metadata.axes.find((axis) => axis.kind === 'band')
    return (bandAxis?.length ?? this.metadata.bands.length) >= 2
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
      this.#visibleDataRegion = message.dataRegion
      const range = message.displayRanges[0]
      this.#displaySummary =
        message.noDataPixels === message.width * message.height
          ? 'No data in this viewport'
          : message.displayRanges.length === 1 && range !== undefined
            ? `Auto contrast ${formatDisplayValue(range[0])}–${formatDisplayValue(range[1])}${message.noDataPixels > 0 ? ` · ${message.noDataPixels.toLocaleString()} nodata hidden` : ''}`
            : `Auto contrast · ${message.displayRanges.length.toLocaleString()} bands`
      if (this.metadata !== undefined) this.#facts(this.metadata)
      const previousTelemetry = this.#lastTelemetry
      this.#telemetry(message.telemetry)
      const overview = this.selection?.levelId ?? '?'
      this.#setStatus(
        message.noDataPixels === message.width * message.height
          ? 'No raster data in this viewport. Pan or zoom out to find coverage.'
          : previousTelemetry !== undefined &&
              message.telemetry.dataRequests === previousTelemetry.dataRequests &&
              message.telemetry.transferredBytes === previousTelemetry.transferredBytes
            ? `Overview ${overview} ready from cache. No network transfer was needed.`
            : `Overview ${overview} ready at ${message.width.toLocaleString()} × ${message.height.toLocaleString()} pixels. Drag, use arrow keys, or zoom to continue.`,
        'ready',
      )
      this.#hideLoading()
      this.elements.open.disabled = false
      this.elements.cancel.disabled = true
      this.#updateViewportControls()
      this.onState?.()
    } else if (message.kind === 'analysis') {
      if (
        message.rgba !== undefined &&
        message.width !== undefined &&
        message.height !== undefined
      ) {
        this.#draw(message.width, message.height, message.rgba)
        this.#displaySummary = `${analysisDisplayName(message.analysis)} result`
        if (this.metadata !== undefined) this.#facts(this.metadata)
      }
      this.#telemetry(message.telemetry)
      required('geo-analysis-output', HTMLElement).textContent = message.summary
      this.#setStatus('Bounded analysis complete.', 'ready')
      setActiveAnalysis(message.analysis)
      this.#hideLoading()
    } else if (message.kind === 'sample') {
      this.elements.sample.textContent = `Pixel ${this.#lastPointer?.x.toFixed(1) ?? '?'}, ${this.#lastPointer?.y.toFixed(1) ?? '?'} · world ${message.world[0].toFixed(3)}, ${message.world[1].toFixed(3)} · sample ${message.values.map((value) => value.toFixed(3)).join(', ')}`
    } else if (message.kind === 'cancelled') {
      this.#setStatus('Request cancelled and partial work discarded.', 'idle')
      this.#hideLoading()
      this.elements.open.disabled = false
      this.elements.cancel.disabled = true
    } else if (message.kind === 'error') {
      this.#setStatus(message.message, 'error')
      if (message.requestId === this.#latestAnalysisRequest) {
        required('geo-analysis-output', HTMLElement).textContent =
          `Analysis could not run. ${message.message}`
        setActiveAnalysis(undefined)
      }
      this.#hideLoading()
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
      this.#showLoading(
        'Opening the selected dataset',
        'Reading its dimensions, axes, levels, and grid metadata',
        true,
      )
      this.#latestPrimaryRequest = this.#send({ kind: 'dataset', datasetId: select.value })
      return
    }
    const levelId = this.elements.level.value
    const level = metadata.levels.find((entry) => entry.id === levelId)
    if (level === undefined) return
    const levelChanged = levelId !== current.levelId
    const mode =
      this.elements.mode.value === 'rgb' || this.elements.mode.value === 'cir'
        ? this.elements.mode.value
        : 'grayscale'
    const mappedBands = this.#presetBands(mode)
    const { displayBands: previousDisplayBands, ...baseSelection } = current
    void previousDisplayBands
    this.selection = {
      ...baseSelection,
      levelId,
      band: Number(this.elements.band.value),
      time: Number(this.elements.time.value),
      vertical: Number(this.elements.vertical.value),
      mode,
      region: levelChanged
        ? this.#regionAtCenter(
            metadata.levels.find((entry) => entry.id === current.levelId) ?? level,
            current.region,
            level,
            current.region.width,
            current.region.height,
          )
        : current.region,
      ...(mappedBands === undefined ? {} : { displayBands: mappedBands }),
    }
    this.#facts(metadata)
    this.#updateViewportControls()
    setActiveAnalysis(undefined)
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
    const region = {
      ...current.region,
      x: Math.max(0, Math.min(level.width - current.region.width, current.region.x + dx)),
      y: Math.max(0, Math.min(level.height - current.region.height, current.region.y + dy)),
    }
    this.#applyRegion(region, `${direction} edge reached. The viewport is unchanged.`)
  }

  zoom(factor: number): void {
    const current = this.selection
    const target = this.#zoomTarget(factor)
    if (current === undefined || target === undefined) return
    this.#applyRegion(
      target.region,
      factor < 1
        ? 'Maximum zoom reached. The viewport is unchanged.'
        : 'The full overview is visible.',
      target.level.id,
    )
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
      const region = {
        ...this.selection.region,
        x: Math.max(
          0,
          Math.min(level.width - this.selection.region.width, this.#dragStart.region.x + dx),
        ),
        y: Math.max(
          0,
          Math.min(level.height - this.selection.region.height, this.#dragStart.region.y + dy),
        ),
      }
      this.#applyRegion(region, 'Viewport unchanged. Drag farther to move the raster.')
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
    setActiveAnalysis(analysis)
    this.#setStatus('Running bounded viewport analysis…', 'loading')
    this.#showLoading(
      'Analyzing the current viewport',
      'Processing the bounded visible region in the worker',
      true,
    )
    this.#latestPrimaryRequest = this.#send({
      kind: 'analyze',
      analysis,
      selection: this.selection,
    })
    this.#latestAnalysisRequest = this.#latestPrimaryRequest
  }

  close(): void {
    if (this.#sampleFrame !== undefined) window.cancelAnimationFrame(this.#sampleFrame)
    if (this.#loadingTimer !== undefined) window.clearInterval(this.#loadingTimer)
    if (this.#loadingDelayTimer !== undefined) window.clearTimeout(this.#loadingDelayTimer)
    this.#send({ kind: 'close' })
    this.worker.terminate()
    this.elements.root.dataset.worker = 'terminated'
  }
}

const analysisButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>('[data-geo-analysis]'),
)

const setActiveAnalysis = (analysis: GeoAnalysisKind | undefined): void => {
  for (const button of analysisButtons) {
    button.setAttribute('aria-pressed', String(button.dataset.geoAnalysis === analysis))
  }
}

const updateAnalysisContext = (lab: GeoLab): void => {
  required('geo-analysis-context', HTMLElement).textContent = lab.analysisContext()
  for (const button of analysisButtons) {
    const analysis = button.dataset.geoAnalysis
    if (
      analysis !== 'normalized-difference' &&
      analysis !== 'hillshade' &&
      analysis !== 'statistics' &&
      analysis !== 'line-profile'
    )
      continue
    button.disabled = !lab.canAnalyze(analysis)
    button.title = button.disabled
      ? analysis === 'normalized-difference'
        ? 'This source needs at least two bands'
        : 'Open a raster first'
      : ''
  }
}

const cog = new GeoLab('cog')
const geozarr = new GeoLab('geozarr')
let activeLab = cog
for (const lab of [cog, geozarr]) {
  lab.onActivate = (value) => {
    activeLab = value
    updateAnalysisContext(value)
  }
  lab.onState = () => {
    updateCode()
    updateAnalysisContext(lab)
  }
}

for (const button of analysisButtons) {
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
  const selectedSourceBands = selection?.displayBands ?? [selectedSourceBand]
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
    sourceBands: ${JSON.stringify(selectedSourceBands)},
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
import { createGeoTiffReader } from 'purejsimage/geo/readers/geotiff'

const controller = new AbortController()
const source = await HttpRangeSource.open(${JSON.stringify(sourceUrl)}, {
  allowHeadSizeFallback: true,
  openSignal: controller.signal,
  lifetimeSignal: controller.signal,
  maxCacheBytes: 4 * 1024 * 1024,
})
if (!source) throw new Error('COG not found')
const reader = createGeoTiffReader({ limits: { maxInputBytes: 256 * 1024 * 1024 } })
const document = await reader.open({ primary: { id: 'cog', source }, signal: controller.signal })

try {
  const summary = document.datasets[0]
  if (!summary) throw new Error('COG dataset missing')
  const dataset: GeoRasterDataset = await document.openDataset(summary.id)
  const view = dataset.createView({
    spatialDimensions: [dataset.descriptor.spatialDimensions.x.id, dataset.descriptor.spatialDimensions.y.id],
    nonSpatial: ${JSON.stringify(nonSpatial)}, sourceBands: ${JSON.stringify(selection?.displayBands ?? [sourceBand])}, levelId: ${JSON.stringify(selection?.levelId ?? '0')},
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
  const button = event.currentTarget
  if (!(button instanceof HTMLButtonElement)) return
  try {
    await copyText(codeText())
    button.textContent = 'Copied'
  } catch {
    const selection = window.getSelection()
    const range = document.createRange()
    range.selectNodeContents(code)
    selection?.removeAllRanges()
    selection?.addRange(range)
    button.textContent = 'Code selected'
  }
  window.setTimeout(() => {
    button.textContent = 'Copy'
  }, 1_200)
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

document.querySelector<HTMLButtonElement>('[data-geo-autoload]')?.click()

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
