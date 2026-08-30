import type {
  FourDStemEvidenceSnapshot,
  FourDStemRenderedView,
  FourDStemWorkerRequest,
  FourDStemWorkerRoi,
} from './four-d-stem-types.ts'
import {
  isCurrentFourDStemWorkerResponseSequence,
  isFourDStemWorkerResponse,
} from './four-d-stem-types.ts'

type FourDStemRequestPayload = FourDStemWorkerRequest extends infer Request
  ? Request extends FourDStemWorkerRequest
    ? Omit<Request, 'version' | 'sequence'>
    : never
  : never

type ElementConstructor<ElementType extends Element> = { new (): ElementType }

const requiredElement = <ElementType extends Element>(
  id: string,
  Constructor: ElementConstructor<ElementType>,
): ElementType => {
  const value = document.getElementById(id)
  if (!(value instanceof Constructor)) throw new Error(`4D-STEM element #${id} is missing`)
  return value
}

const formatBytes = (bytes: number): string =>
  bytes < 1_024
    ? `${bytes} B`
    : bytes < 1_048_576
      ? `${(bytes / 1_024).toFixed(1)} KiB`
      : `${(bytes / 1_048_576).toFixed(2)} MiB`

const draw = (canvas: HTMLCanvasElement, view: FourDStemRenderedView): void => {
  canvas.width = view.width
  canvas.height = view.height
  const context = canvas.getContext('2d')
  if (context === null) throw new Error('Canvas 2D context is unavailable')
  context.putImageData(new ImageData(view.pixels, view.width, view.height), 0, 0)
}

const canvasPoint = (
  canvas: HTMLCanvasElement,
  event: PointerEvent,
): readonly [x: number, y: number] => {
  const bounds = canvas.getBoundingClientRect()
  return Object.freeze([
    Math.max(
      0,
      Math.min(canvas.width - 1, ((event.clientX - bounds.left) / bounds.width) * canvas.width),
    ),
    Math.max(
      0,
      Math.min(canvas.height - 1, ((event.clientY - bounds.top) / bounds.height) * canvas.height),
    ),
  ])
}

const roiFromDrag = (
  kind: string,
  start: readonly [number, number],
  end: readonly [number, number],
): FourDStemWorkerRoi => {
  if (kind === 'point') {
    return Object.freeze({ kind: 'point', x: Math.floor(end[0]), y: Math.floor(end[1]) })
  }
  if (kind === 'rectangle') {
    const x = Math.floor(Math.min(start[0], end[0]))
    const y = Math.floor(Math.min(start[1], end[1]))
    return Object.freeze({
      kind: 'rectangle',
      x,
      y,
      width: Math.max(1, Math.ceil(Math.max(start[0], end[0])) - x),
      height: Math.max(1, Math.ceil(Math.max(start[1], end[1])) - y),
    })
  }
  const radius = Math.max(0.75, Math.hypot(end[0] - start[0], end[1] - start[1]))
  if (kind === 'annulus') {
    return Object.freeze({
      kind: 'annulus',
      x: start[0],
      y: start[1],
      innerRadius: radius * 0.55,
      outerRadius: radius,
    })
  }
  return Object.freeze({ kind: 'circle', x: start[0], y: start[1], radius })
}

export const startFourDStemExplorer = (): void => {
  const navigation = requiredElement('stem-navigation', HTMLCanvasElement)
  const diffraction = requiredElement('stem-diffraction', HTMLCanvasElement)
  const loadFixture = requiredElement('stem-load-fixture', HTMLButtonElement)
  const mibInput = requiredElement('stem-mib-file', HTMLInputElement)
  const hdrInput = requiredElement('stem-hdr-file', HTMLInputElement)
  const openMib = requiredElement('stem-open-mib', HTMLButtonElement)
  const detectorShape = requiredElement('stem-detector-shape', HTMLSelectElement)
  const scanShape = requiredElement('stem-scan-shape', HTMLSelectElement)
  const detectorReduction = requiredElement('stem-detector-reduction', HTMLSelectElement)
  const scanReduction = requiredElement('stem-scan-reduction', HTMLSelectElement)
  const detectorX = requiredElement('stem-detector-x', HTMLInputElement)
  const detectorY = requiredElement('stem-detector-y', HTMLInputElement)
  const detectorInner = requiredElement('stem-detector-inner', HTMLInputElement)
  const detectorOuter = requiredElement('stem-detector-outer', HTMLInputElement)
  const applyDetectorRoi = requiredElement('stem-apply-detector-roi', HTMLButtonElement)
  const downloadNavigation = requiredElement('stem-download-navigation', HTMLButtonElement)
  const downloadDiffraction = requiredElement('stem-download-diffraction', HTMLButtonElement)
  const exportEvidence = requiredElement('stem-export-evidence', HTMLButtonElement)
  const viewZoom = requiredElement('stem-view-zoom', HTMLInputElement)
  const fitViews = requiredElement('stem-fit-views', HTMLButtonElement)
  const closeDataset = requiredElement('stem-close', HTMLButtonElement)
  const status = requiredElement('stem-status', HTMLElement)
  const sourceSummary = requiredElement('stem-source-summary', HTMLElement)
  const cursorSummary = requiredElement('stem-cursor-summary', HTMLElement)
  const navigationRange = requiredElement('stem-navigation-range', HTMLElement)
  const diffractionRange = requiredElement('stem-diffraction-range', HTMLElement)
  const evidenceReads = requiredElement('stem-evidence-reads', HTMLElement)
  const evidenceTransfers = requiredElement('stem-evidence-transfers', HTMLElement)
  const evidenceCache = requiredElement('stem-evidence-cache', HTMLElement)
  const evidenceBlocks = requiredElement('stem-evidence-blocks', HTMLElement)
  const evidenceMemory = requiredElement('stem-evidence-memory', HTMLElement)
  const evidenceCancellations = requiredElement('stem-evidence-cancellations', HTMLElement)
  const evidenceCoverage = requiredElement('stem-evidence-coverage', HTMLElement)
  const evidenceTiles = requiredElement('stem-evidence-tiles', HTMLElement)
  const evidenceLatency = requiredElement('stem-evidence-latency', HTMLElement)
  const evidenceOperation = requiredElement('stem-evidence-operation', HTMLElement)
  const evidenceProvider = requiredElement('stem-evidence-provider', HTMLElement)
  const evidenceTimeline = requiredElement('stem-evidence-timeline', HTMLOListElement)
  const worker = new Worker(new URL('./four-d-stem-worker.ts', import.meta.url), {
    type: 'module',
  })
  let sequence = 0
  let scanSize: readonly [number, number] = Object.freeze([1, 1])
  let cursor: readonly [number, number] = Object.freeze([0, 0])
  let latestEvidence: FourDStemEvidenceSnapshot | undefined
  let viewScale = 1
  let viewOffsetX = 0
  let viewOffsetY = 0
  let drag:
    | {
        readonly target: 'navigation' | 'diffraction'
        readonly start: readonly [number, number]
      }
    | undefined

  const nextSequence = (): number => {
    sequence += 1
    return sequence
  }

  const send = (request: FourDStemRequestPayload): void => {
    const message = { version: 1 as const, sequence: nextSequence(), ...request }
    status.textContent = 'Working locally in the dedicated worker…'
    worker.postMessage(message)
  }

  const evidence = (value: FourDStemEvidenceSnapshot): void => {
    latestEvidence = value
    evidenceCoverage.textContent = `${formatBytes(value.uniquePrimarySourceBytes)} unique MIB bytes of ${formatBytes(value.sourceBytes)} · ${value.logicalRanges.length} ranges · ${value.abortedReads} aborted reads`
    evidenceReads.textContent = `${value.logicalReads.toLocaleString()} reads · ${formatBytes(value.logicalBytes)}`
    evidenceTransfers.textContent =
      value.physicalTransfers === 0
        ? 'Local source · no network transfer'
        : `${value.physicalTransfers.toLocaleString()} requests · ${formatBytes(value.transferredBytes)}`
    evidenceCache.textContent = `${value.cacheHits.toLocaleString()} hits · ${value.cacheMisses.toLocaleString()} misses · ${value.coalescedConsumers.toLocaleString()} joined · ${value.cacheEvictions.toLocaleString()} evicted · ${formatBytes(value.retainedCacheBytes)} retained`
    evidenceBlocks.textContent = value.decodedBlocks.toLocaleString()
    evidenceMemory.textContent = `${formatBytes(value.liveManagedBytes)} live · ${formatBytes(value.peakManagedBytes)} peak`
    evidenceCancellations.textContent = value.cancellations.toLocaleString()
    evidenceTiles.textContent = `${value.decodedBlocks.toLocaleString()} decoded blocks · ${value.cacheAdmissions.toLocaleString()} cache admissions · ${formatBytes(value.sourceRetainedBytes)} source retained · ${formatBytes(value.derivedRetainedBytes)} derived retained`
    evidenceLatency.textContent =
      value.firstTileMilliseconds === null
        ? 'Not observed'
        : `${value.firstTileMilliseconds.toFixed(1)} ms`
    evidenceOperation.textContent = value.activeOperation
    evidenceProvider.textContent = value.provider
    evidenceTimeline.replaceChildren(
      ...value.timeline.map((entry) => {
        const item = document.createElement('li')
        item.textContent = `${(entry.timeMicroseconds / 1_000).toFixed(1)} ms · ${entry.type} · ${entry.label}`
        return item
      }),
    )
  }

  const rangeText = (view: FourDStemRenderedView): string =>
    `${view.range[0].toLocaleString(undefined, { maximumSignificantDigits: 6 })} to ${view.range[1].toLocaleString(undefined, { maximumSignificantDigits: 6 })}`

  worker.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (!isFourDStemWorkerResponse(event.data)) {
      status.textContent = 'The worker returned an invalid response. Reload the application.'
      return
    }
    const response = event.data
    if (!isCurrentFourDStemWorkerResponseSequence(response.sequence, sequence)) return
    if (response.type === 'error') {
      status.textContent = response.message
      return
    }
    if (response.type === 'closed') {
      navigation.getContext('2d')?.clearRect(0, 0, navigation.width, navigation.height)
      diffraction.getContext('2d')?.clearRect(0, 0, diffraction.width, diffraction.height)
      sourceSummary.textContent =
        'Dataset closed. Worker resources and retained tiles were released.'
      status.textContent = 'Closed. Load the fixture or a local MIB to continue.'
      return
    }
    if (response.type === 'opened') {
      scanSize = response.scanShape
      cursor = response.cursor
      draw(navigation, response.navigation)
      draw(diffraction, response.diffraction)
      sourceSummary.textContent = `${response.name} · ${response.reader} · ${response.sampleType} · scan ${response.scanShape[0]} × ${response.scanShape[1]} (${response.roles.navigationX}, ${response.roles.navigationY}) · detector ${response.detectorShape[0]} × ${response.detectorShape[1]} (${response.roles.detectorX}, ${response.roles.detectorY})`
      cursorSummary.textContent = `Scan ${cursor[0] + 1}, ${cursor[1] + 1}`
      navigationRange.textContent = rangeText(response.navigation)
      diffractionRange.textContent = rangeText(response.diffraction)
      evidence(response.evidence)
      status.textContent =
        'Ready. Drag on either view or click the navigation map to move the scan cursor.'
      return
    }
    if (response.type === 'rendered') {
      const canvas = response.target === 'navigation' ? navigation : diffraction
      draw(canvas, response.view)
      if (response.target === 'navigation') navigationRange.textContent = rangeText(response.view)
      else diffractionRange.textContent = rangeText(response.view)
      if (response.cursor !== undefined) {
        cursor = response.cursor
        cursorSummary.textContent = `Scan ${cursor[0] + 1}, ${cursor[1] + 1}`
      }
      evidence(response.evidence)
      status.textContent = 'Ready. The displayed result came from bounded worker reads and tiles.'
      return
    }
    if (response.type === 'evidence') evidence(response.evidence)
  })

  worker.addEventListener('error', () => {
    status.textContent = 'The worker stopped. Reload the page to restart it safely.'
  })

  loadFixture.addEventListener('click', () => send({ type: 'open-fixture' }))
  openMib.addEventListener('click', () => {
    const mib = mibInput.files?.[0]
    if (mib === undefined) {
      status.textContent = 'Choose a processed .mib file first.'
      return
    }
    const hdr = hdrInput.files?.[0]
    send({ type: 'open-mib', mib, ...(hdr === undefined ? {} : { hdr }) })
  })
  mibInput.addEventListener('change', () => {
    openMib.disabled = mibInput.files?.[0] === undefined
  })

  const numberValue = (input: HTMLInputElement): number => Number(input.value)
  applyDetectorRoi.addEventListener('click', () => {
    const x = numberValue(detectorX)
    const y = numberValue(detectorY)
    const innerRadius = numberValue(detectorInner)
    const outerRadius = numberValue(detectorOuter)
    const kind = detectorShape.value
    const roi: FourDStemWorkerRoi =
      kind === 'point'
        ? { kind: 'point', x: Math.floor(x), y: Math.floor(y) }
        : kind === 'rectangle'
          ? {
              kind: 'rectangle',
              x: x - outerRadius,
              y: y - outerRadius,
              width: outerRadius * 2,
              height: outerRadius * 2,
            }
          : kind === 'circle'
            ? { kind: 'circle', x, y, radius: outerRadius }
            : { kind: 'annulus', x, y, innerRadius, outerRadius }
    send({
      type: 'detector-roi',
      roi,
      reduction: detectorReduction.value === 'mean' ? 'mean' : 'sum',
    })
  })

  const downloadCanvas = (canvas: HTMLCanvasElement, name: string): void => {
    canvas.toBlob((blob) => {
      if (blob === null) {
        status.textContent = 'The browser could not encode this canvas as PNG.'
        return
      }
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = name
      link.click()
      URL.revokeObjectURL(url)
    }, 'image/png')
  }
  downloadNavigation.addEventListener('click', () =>
    downloadCanvas(navigation, 'purejsimage-4d-stem-navigation.png'),
  )
  downloadDiffraction.addEventListener('click', () =>
    downloadCanvas(diffraction, 'purejsimage-4d-stem-diffraction.png'),
  )
  exportEvidence.addEventListener('click', () => {
    if (latestEvidence === undefined) return
    const blob = new Blob([`${JSON.stringify(latestEvidence, null, 2)}\n`], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'purejsimage-4d-stem-evidence.json'
    link.click()
    URL.revokeObjectURL(url)
  })

  const applyViewScale = (): void => {
    for (const canvas of [navigation, diffraction]) {
      canvas.style.transform = `translate(${viewOffsetX}px, ${viewOffsetY}px) scale(${viewScale})`
      canvas.style.transformOrigin = 'center'
    }
  }
  for (const canvas of [navigation, diffraction]) {
    canvas.addEventListener('wheel', (event) => {
      event.preventDefault()
      viewScale = Math.max(0.5, Math.min(8, viewScale * (event.deltaY < 0 ? 1.15 : 1 / 1.15)))
      viewZoom.value = String(viewScale)
      applyViewScale()
    })
  }
  viewZoom.addEventListener('input', () => {
    viewScale = numberValue(viewZoom)
    applyViewScale()
  })
  fitViews.addEventListener('click', () => {
    viewScale = 1
    viewOffsetX = 0
    viewOffsetY = 0
    viewZoom.value = '1'
    applyViewScale()
  })
  closeDataset.addEventListener('click', () => send({ type: 'close' }))

  const pointerDown =
    (target: 'navigation' | 'diffraction', canvas: HTMLCanvasElement) =>
    (event: PointerEvent): void => {
      canvas.setPointerCapture(event.pointerId)
      drag = Object.freeze({ target, start: canvasPoint(canvas, event) })
    }
  const pointerUp =
    (target: 'navigation' | 'diffraction', canvas: HTMLCanvasElement) =>
    (event: PointerEvent): void => {
      if (drag?.target !== target) return
      const end = canvasPoint(canvas, event)
      const start = drag.start
      drag = undefined
      if (target === 'navigation' && Math.hypot(end[0] - start[0], end[1] - start[1]) < 0.75) {
        cursor = Object.freeze([Math.floor(end[0]), Math.floor(end[1])])
        send({ type: 'cursor', scanX: cursor[0], scanY: cursor[1] })
        return
      }
      const kind = target === 'navigation' ? scanShape.value : detectorShape.value
      const roi = roiFromDrag(kind, start, end)
      if (target === 'navigation') {
        if (roi.kind === 'annulus') return
        send({
          type: 'scan-roi',
          roi,
          reduction: scanReduction.value === 'sum' ? 'sum' : 'mean',
        })
      } else {
        send({
          type: 'detector-roi',
          roi,
          reduction: detectorReduction.value === 'mean' ? 'mean' : 'sum',
        })
      }
    }
  navigation.addEventListener('pointerdown', pointerDown('navigation', navigation))
  navigation.addEventListener('pointerup', pointerUp('navigation', navigation))
  diffraction.addEventListener('pointerdown', pointerDown('diffraction', diffraction))
  diffraction.addEventListener('pointerup', pointerUp('diffraction', diffraction))

  navigation.addEventListener('keydown', (event) => {
    if (event.shiftKey) {
      if (event.key === 'ArrowLeft') viewOffsetX -= 12
      else if (event.key === 'ArrowRight') viewOffsetX += 12
      else if (event.key === 'ArrowUp') viewOffsetY -= 12
      else if (event.key === 'ArrowDown') viewOffsetY += 12
      else return
      event.preventDefault()
      applyViewScale()
      return
    }
    let [x, y] = cursor
    if (event.key === 'ArrowLeft') x -= 1
    else if (event.key === 'ArrowRight') x += 1
    else if (event.key === 'ArrowUp') y -= 1
    else if (event.key === 'ArrowDown') y += 1
    else return
    event.preventDefault()
    cursor = Object.freeze([
      Math.max(0, Math.min(scanSize[0] - 1, x)),
      Math.max(0, Math.min(scanSize[1] - 1, y)),
    ])
    send({ type: 'cursor', scanX: cursor[0], scanY: cursor[1] })
  })

  window.addEventListener('beforeunload', () => {
    worker.postMessage({ version: 1, type: 'close', sequence: nextSequence() })
    worker.terminate()
  })

  send({ type: 'open-fixture' })
}
