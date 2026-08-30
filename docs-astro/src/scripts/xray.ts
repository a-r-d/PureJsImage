import type {
  EvidenceLogicalReadEvent,
  EvidencePhysicalTransferEvent,
  ExecutionEvidenceReport,
} from '../../../src/evidence.ts'
import type { XrayRequest, XrayResponse } from './xray-types.ts'

const required = <T extends HTMLElement>(id: string): T => {
  const value = document.getElementById(id)
  if (value === null) throw new Error(`Missing #${id}`)
  return value as T
}

const file = required<HTMLInputElement>('xray-file')
const url = required<HTMLInputElement>('xray-url')
const openUrl = required<HTMLButtonElement>('xray-open-url')
const sample = required<HTMLButtonElement>('xray-sample')
const cancel = required<HTMLButtonElement>('xray-cancel')
const status = required<HTMLElement>('xray-status')
const summary = required<HTMLElement>('xray-summary')
const coverage = required<HTMLElement>('xray-coverage')
const plan = required<HTMLElement>('xray-plan')
const events = required<HTMLElement>('xray-events')
const memory = required<HTMLElement>('xray-memory')
const io = required<HTMLElement>('xray-io')
const measurement = required<HTMLElement>('xray-measurement')
const dependencySelect = required<HTMLSelectElement>('xray-dependency-select')
const dependency = required<HTMLElement>('xray-dependency')
const download = required<HTMLButtonElement>('xray-download')
const worker = new Worker(new URL('./xray-worker.js', import.meta.url), { type: 'module' })
let report: ExecutionEvidenceReport | undefined
const liveEvents: NonNullable<ExecutionEvidenceReport['events']>[number][] = []

const bytes = (value: number): string =>
  value < 1_024 ? `${value} B` : `${(value / 1_024).toFixed(1)} KiB`

const send = (request: XrayRequest): void => {
  report = undefined
  status.textContent = 'Inspecting structure and planning output in the browser worker…'
  summary.textContent = ''
  plan.textContent = ''
  events.textContent = ''
  memory.textContent = ''
  io.textContent = ''
  measurement.textContent = ''
  dependencySelect.replaceChildren(new Option('No dependency events'))
  dependencySelect.disabled = true
  dependency.textContent = 'No block or tile dependency was recorded.'
  liveEvents.length = 0
  cancel.disabled = false
  worker.postMessage(request)
}

file.addEventListener('change', () => {
  const selected = file.files?.[0]
  if (selected !== undefined) send({ type: 'open-local', file: selected })
})

sample.addEventListener('click', () => {
  void fetch('/assets/ome-zarr-open-graph.png')
    .then((response) => {
      if (!response.ok) throw new Error(`Safe sample returned HTTP ${response.status}`)
      return response.blob()
    })
    .then((blob) => {
      send({
        type: 'open-local',
        file: new File([blob], 'safe-sample.png', { type: 'image/png' }),
      })
    })
    .catch((cause: unknown) => {
      status.textContent = cause instanceof Error ? cause.message : String(cause)
    })
})

openUrl.addEventListener('click', () => {
  try {
    const parsed = new URL(url.value)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error()
    const omeZarr = /(?:\.zarr\/?|\/zarr\.json|\/\.zgroup|\/\.zattrs)$/iu.test(parsed.pathname)
    send({ type: omeZarr ? 'open-ome-zarr' : 'open-remote', url: parsed.href })
  } catch {
    status.textContent = 'Enter an HTTP or HTTPS URL. The server must allow CORS and byte ranges.'
  }
})

cancel.addEventListener('click', () => {
  worker.postMessage({ type: 'cancel' } satisfies XrayRequest)
})

worker.addEventListener('message', (event: MessageEvent<XrayResponse>) => {
  const message = event.data
  if (message.type === 'event') {
    liveEvents.push(message.event)
    if (liveEvents.length > 100) liveEvents.shift()
    events.textContent = JSON.stringify(liveEvents, null, 2)
    return
  }
  if (message.type === 'error') {
    status.textContent = message.message
    cancel.disabled = true
    return
  }
  report = message.report
  cancel.disabled = true
  status.textContent = `${message.metadata.format.toUpperCase()} ${message.metadata.width} × ${message.metadata.height}. ${message.decodedPreviewTile ? 'One bounded preview tile was decoded.' : 'Structural inspection completed without decoding pixels.'}`
  summary.textContent = `${message.source.kind} source · ${bytes(message.source.size)} · ${message.report.logicalReads.count} logical reads · ${message.report.physicalTransfers.requestCount} physical transfers`
  const fraction =
    message.source.size === 0
      ? 0
      : message.report.physicalTransfers.uniqueBytes / message.source.size
  coverage.style.width = `${Math.min(100, fraction * 100)}%`
  coverage.title = `${bytes(message.report.physicalTransfers.uniqueBytes)} unique physical source bytes`
  plan.textContent = JSON.stringify(message.plan, null, 2)
  events.textContent = JSON.stringify(message.report.events ?? [], null, 2)
  memory.textContent = `${bytes(message.report.managedMemory.peakLiveBytes)} peak PureJsImage-managed bytes · ${message.report.managedMemory.stillLiveLeases} live leases at finalization`
  io.textContent = `${message.report.logicalReads.count} logical reads · ${message.report.physicalTransfers.requestCount} physical transfers · ${message.report.physicalTransfers.cacheHits} cache hits · ${message.report.physicalTransfers.cacheMisses} cache misses · ${(message.report.events ?? []).filter((item) => item.type === 'cancellation').length} cancellations`
  measurement.textContent = `Logical unique coverage: ${message.report.logicalReads.uniqueBytesMeasurement}. Physical unique coverage: ${message.report.physicalTransfers.availability === 'unavailable' ? 'unavailable' : message.report.physicalTransfers.uniqueBytesMeasurement}. Working-memory classes in the plan are estimated.`
  const dependencies = message.report.dependencies
  if (dependencies.length > 0) {
    dependencySelect.replaceChildren(
      ...dependencies.map((item, index) => new Option(item.outputId, String(index))),
    )
    dependencySelect.disabled = false
    const explainDependency = (selectedIndex: number): void => {
      const selected = dependencies[selectedIndex]
      if (selected === undefined) {
        dependency.textContent = 'No dependency selected.'
        return
      }
      const selectedIds = new Set(selected.inputIds)
      const pending = [...selected.inputIds]
      while (pending.length > 0) {
        const inputId = pending.pop()
        if (inputId === undefined) break
        const upstream = dependencies.find((item) => item.outputId === inputId)
        if (upstream === undefined) continue
        for (const id of upstream.inputIds) {
          if (selectedIds.has(id)) continue
          selectedIds.add(id)
          pending.push(id)
        }
      }
      const logicalReads = (message.report.events ?? []).filter(
        (item): item is EvidenceLogicalReadEvent =>
          item.type === 'logical-read' && selectedIds.has(`logical-read:${item.id}`),
      )
      const physicalIds = new Set(logicalReads.flatMap((item) => item.physicalTransferIds ?? []))
      const physicalTransfers = (message.report.events ?? []).filter(
        (item): item is EvidencePhysicalTransferEvent =>
          item.type === 'physical-transfer' && physicalIds.has(`physical-transfer:${item.id}`),
      )
      const selectedBytes = physicalTransfers.reduce(
        (total, item) => total + Math.max(0, item.end - item.start),
        0,
      )
      const selectedFraction = message.source.size === 0 ? 0 : selectedBytes / message.source.size
      coverage.style.width = `${Math.min(100, selectedFraction * 100)}%`
      coverage.title = `${bytes(selectedBytes)} physical source bytes for ${selected.outputId}`
      dependency.textContent = JSON.stringify(
        { dependency: selected, logicalReads, physicalTransfers },
        null,
        2,
      )
    }
    explainDependency(0)
    dependencySelect.onchange = () => {
      explainDependency(Number(dependencySelect.value))
    }
  }
})

download.addEventListener('click', () => {
  if (report === undefined) return
  const link = document.createElement('a')
  link.href = URL.createObjectURL(
    new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }),
  )
  link.download = 'purejsimage-evidence.json'
  link.click()
  URL.revokeObjectURL(link.href)
})
