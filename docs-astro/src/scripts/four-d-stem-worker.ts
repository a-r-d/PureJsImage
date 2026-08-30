import { createGeneratedFourDStemFixture } from '../../../benchmark/four-d-stem/generated-fixture.ts'
import {
  createFourDStemAnalysisBundle,
  fourDStemOperationParameters,
  inferFourDStemAxisRoles,
  scanDiffractionReductionOperationId,
  virtualDetectorMapOperationId,
  type DetectorRoi,
  type FourDStemAxisRoles,
  type NavigationRoi,
} from '../../../src/analysis/four-d-stem.ts'
import {
  createAnalysisController,
  scientificDatasetCharacteristics,
} from '../../../src/analysis/index.ts'
import type { AnalysisExecutionResult, AnalysisGraph } from '../../../src/analysis/index.ts'
import { scientificDatasetValueTypeId } from '../../../src/analysis/index.ts'
import { createTileRuntime, type TileRuntime } from '../../../src/analysis/runtime.ts'
import {
  createEvidenceSession,
  instrumentImageSource,
  type EvidenceEvent,
  type EvidenceSession,
} from '../../../src/evidence.ts'
import type {
  ScientificDataset,
  ScientificDocument,
  ScientificResource,
} from '../../../src/scientific/index.ts'
import { renderScientificPlane } from '../../../src/scientific/render.ts'
import { ScientificReaderRegistry } from '../../../src/scientific/reader.ts'
import { mibReader } from '../../../src/scientific/readers/mib.ts'
import { BlobSource, MemorySource } from '../../../src/source.ts'
import type {
  FourDStemEvidenceSnapshot,
  FourDStemRenderedView,
  FourDStemWorkerRequest,
  FourDStemWorkerResponse,
} from './four-d-stem-types.ts'

interface WorkerScope {
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void
  postMessage(
    message: FourDStemWorkerResponse,
    options: { readonly transfer: readonly Transferable[] },
  ): void
}

interface WorkerState {
  readonly name: string
  readonly dataset: ScientificDataset
  readonly document: ScientificDocument
  readonly runtime: TileRuntime
  readonly controller: ReturnType<typeof createAnalysisController>
  readonly evidence: EvidenceSession
  readonly unsubscribe: () => void
  readonly roles: FourDStemAxisRoles
  readonly sourceBytes: number
}

interface MutableEvidence {
  logicalReads: number
  logicalBytes: number
  logicalRanges: { start: number; end: number }[]
  abortedReads: number
  physicalTransfers: number
  transferredBytes: number
  coalescedConsumers: number
  cacheHits: number
  cacheMisses: number
  cacheEvictions: number
  decodedBlocks: number
  cancellations: number
  liveManagedBytes: number
  peakManagedBytes: number
  activeOperation: string
  provider: string
  timeline: { timeMicroseconds: number; type: string; label: string }[]
}

const scope = self as unknown as WorkerScope
let state: WorkerState | undefined
let activeAbort: AbortController | undefined
let primarySourceScopeId: number | undefined
let cursor: readonly [number, number] = Object.freeze([3, 2])
let latestSequence = 0
const emptyEvidence = (): MutableEvidence => ({
  logicalReads: 0,
  logicalBytes: 0,
  logicalRanges: [],
  abortedReads: 0,
  physicalTransfers: 0,
  transferredBytes: 0,
  coalescedConsumers: 0,
  cacheHits: 0,
  cacheMisses: 0,
  cacheEvictions: 0,
  decodedBlocks: 0,
  cancellations: 0,
  liveManagedBytes: 0,
  peakManagedBytes: 0,
  activeOperation: 'scientific-document-open',
  provider: 'Not selected',
  timeline: [],
})
let evidenceState = emptyEvidence()

const post = (message: FourDStemWorkerResponse, transfer: readonly Transferable[] = []): void => {
  scope.postMessage(message, { transfer })
}

const uniquePrimarySourceBytes = (): number =>
  evidenceState.logicalRanges.reduce((total, range) => total + range.end - range.start, 0)

const snapshot = (): FourDStemEvidenceSnapshot => {
  const metrics = state?.runtime.metrics()
  return Object.freeze({
    sourceBytes: state?.sourceBytes ?? 0,
    logicalReads: evidenceState.logicalReads,
    logicalBytes: evidenceState.logicalBytes,
    uniquePrimarySourceBytes: uniquePrimarySourceBytes(),
    logicalRanges: Object.freeze(
      evidenceState.logicalRanges.map((range) => Object.freeze({ ...range })),
    ),
    abortedReads: evidenceState.abortedReads,
    physicalTransfers: evidenceState.physicalTransfers,
    transferredBytes: evidenceState.transferredBytes,
    coalescedConsumers: evidenceState.coalescedConsumers,
    cacheHits: evidenceState.cacheHits,
    cacheMisses: evidenceState.cacheMisses,
    cacheEvictions: evidenceState.cacheEvictions,
    retainedCacheBytes: metrics?.cache.currentBytes ?? 0,
    decodedBlocks: evidenceState.decodedBlocks,
    cacheAdmissions: metrics?.cache.admissions ?? 0,
    sourceRetainedBytes: metrics?.cache.sourceRetainedBytes ?? 0,
    derivedRetainedBytes: metrics?.cache.derivedRetainedBytes ?? 0,
    cancellations: evidenceState.cancellations,
    liveManagedBytes: evidenceState.liveManagedBytes,
    peakManagedBytes: evidenceState.peakManagedBytes,
    firstTileMilliseconds: metrics?.timeToFirstCompletedTileMilliseconds ?? null,
    activeOperation: evidenceState.activeOperation,
    provider: evidenceState.provider,
    timeline: Object.freeze(evidenceState.timeline.map((entry) => Object.freeze({ ...entry }))),
  })
}

const resetEvidence = (): void => {
  evidenceState = emptyEvidence()
}

const addLogicalRange = (start: number, end: number): void => {
  if (end <= start) return
  const ranges = [...evidenceState.logicalRanges, { start, end }].sort(
    (left, right) => left.start - right.start,
  )
  const merged: { start: number; end: number }[] = []
  for (const range of ranges) {
    const previous = merged.at(-1)
    if (previous === undefined || range.start > previous.end) merged.push({ ...range })
    else previous.end = Math.max(previous.end, range.end)
  }
  evidenceState.logicalRanges = merged
}

const timeline = (event: EvidenceEvent, label: string): void => {
  evidenceState.timeline.push({
    timeMicroseconds: event.timeMicroseconds,
    type: event.type,
    label,
  })
  if (evidenceState.timeline.length > 24) evidenceState.timeline.shift()
}

const observeEvidence = (event: EvidenceEvent): void => {
  if (event.type === 'logical-read') {
    evidenceState.logicalReads += 1
    evidenceState.logicalBytes += event.returnedBytes
    if (event.scopeId === primarySourceScopeId) {
      addLogicalRange(event.offset, event.offset + event.returnedBytes)
    }
    if (event.outcome === 'aborted') evidenceState.abortedReads += 1
    timeline(event, `${event.offset}..${event.offset + event.returnedBytes}`)
  } else if (event.type === 'physical-transfer') {
    evidenceState.physicalTransfers += 1
    evidenceState.transferredBytes += event.transferredBytes
    timeline(event, `${event.start}..${event.end}`)
  } else if (event.type === 'cache') {
    if (event.action === 'hit') evidenceState.cacheHits += 1
    if (event.action === 'miss') evidenceState.cacheMisses += 1
    if (event.action === 'join') evidenceState.coalescedConsumers += 1
    if (event.action === 'evict') evidenceState.cacheEvictions += 1
    timeline(event, event.action)
  } else if (event.type === 'block' && event.stage === 'decoded') {
    evidenceState.decodedBlocks += 1
    timeline(event, event.blockId)
  } else if (event.type === 'cancellation') {
    evidenceState.cancellations += 1
    timeline(event, event.target)
  } else if (event.type === 'allocation') {
    evidenceState.liveManagedBytes += event.bytes
    evidenceState.peakManagedBytes = Math.max(
      evidenceState.peakManagedBytes,
      evidenceState.liveManagedBytes,
    )
  } else if (event.type === 'release') {
    evidenceState.liveManagedBytes = Math.max(0, evidenceState.liveManagedBytes - event.bytes)
  } else if (event.type === 'operation') {
    evidenceState.activeOperation = `${event.operationId} · ${event.phase}`
    timeline(event, evidenceState.activeOperation)
  } else if (event.type === 'provider') {
    evidenceState.provider = `${event.providerId}@${event.semanticVersion}`
    timeline(event, evidenceState.provider)
  }
}

const cleanup = async (): Promise<void> => {
  const previous = state
  state = undefined
  if (previous === undefined) return
  previous.unsubscribe()
  await previous.runtime.clear()
  await previous.document.close?.()
  previous.evidence.finalize('complete')
}

const coalesceInteraction = async (signal: AbortSignal): Promise<void> => {
  await new Promise<void>((resolve) => setTimeout(resolve, 8))
  signal.throwIfAborted()
}

const createState = async (
  name: string,
  mib: Uint8Array<ArrayBuffer> | File,
  hdr: Uint8Array<ArrayBuffer> | File | undefined,
  signal: AbortSignal,
): Promise<WorkerState> => {
  await cleanup()
  resetEvidence()
  const evidence = createEvidenceSession({
    mode: 'trace',
    limits: { maxEvents: 4_000, maxSerializedBytes: 1_048_576, maxSourceRanges: 2_000 },
  })
  const primarySource = mib instanceof File ? new BlobSource(mib) : new MemorySource(mib)
  const primaryEvidence = evidence.context.child('mib-source')
  primarySourceScopeId = primaryEvidence.scopeId
  const unsubscribe = evidence.subscribe(observeEvidence)
  const primary: ScientificResource = Object.freeze({
    id: 'mib',
    name,
    source: instrumentImageSource(primarySource, primaryEvidence),
  })
  const companion =
    hdr === undefined
      ? undefined
      : Object.freeze({
          id: 'hdr',
          name: name.replace(/\.mib$/iu, '.hdr'),
          source: instrumentImageSource(
            hdr instanceof File ? new BlobSource(hdr) : new MemorySource(hdr),
            evidence.context.child('mib-hdr-source'),
          ),
        })
  let openedDocument: ScientificDocument | undefined
  let openedRuntime: TileRuntime | undefined
  try {
    const document = await new ScientificReaderRegistry([mibReader]).open({
      primary,
      ...(companion === undefined
        ? {}
        : {
            companions: {
              async resolve() {
                return companion
              },
            },
          }),
      readerId: mibReader.descriptor.id,
      signal,
      evidence: evidence.context.child('scientific-reader'),
    })
    openedDocument = document
    const dataset = await document.openDataset('diffraction', { signal })
    const inferred = inferFourDStemAxisRoles(dataset.descriptor)
    if (inferred.status !== 'recognized') throw new Error(inferred.reason)
    const runtime = createTileRuntime({
      evidence: evidence.context.child('tile-runtime'),
      metrics: true,
      limits: {
        maxCacheBytes: 32 * 1_048_576,
        maxTileBytes: 4 * 1_048_576,
        maxInFlightBytes: 16 * 1_048_576,
        maxTotalManagedBytes: 64 * 1_048_576,
      },
    })
    openedRuntime = runtime
    const bundle = createFourDStemAnalysisBundle({
      runtime,
      tileWidth: 32,
      tileHeight: 32,
      sessionId: `four-d-stem-worker-${Date.now()}`,
    })
    const controller = createAnalysisController({
      ...bundle,
      library: { version: '0.17.0', buildFingerprint: 'docs-four-d-stem-worker-v1' },
    })
    return Object.freeze({
      name,
      dataset,
      document,
      runtime,
      controller,
      evidence,
      unsubscribe,
      roles: inferred.roles,
      sourceBytes: primarySource.size,
    })
  } catch (error) {
    unsubscribe()
    await openedRuntime?.clear()
    await openedDocument?.close?.()
    evidence.finalize(signal.aborted ? 'cancelled' : 'failed')
    throw error
  }
}

const isDataset = (value: unknown): value is ScientificDataset =>
  value !== null &&
  typeof value === 'object' &&
  'descriptor' in value &&
  'readPlane' in value &&
  typeof value.readPlane === 'function'

const executeDerived = async (
  active: WorkerState,
  operationId: string,
  roi: DetectorRoi | NavigationRoi,
  reduction: 'sum' | 'mean',
  signal: AbortSignal,
): Promise<{
  readonly dataset: ScientificDataset
  readonly execution: AnalysisExecutionResult
}> => {
  const graph: AnalysisGraph = {
    schemaVersion: 1,
    inputs: [{ name: 'source', valueType: { id: scientificDatasetValueTypeId, version: 1 } }],
    nodes: [
      {
        id: 'reduction',
        operation: { id: operationId, version: 1 },
        inputs: [{ port: 'dataset', source: { kind: 'input', input: 'source' } }],
        parameters: fourDStemOperationParameters({ roles: active.roles, roi, reduction }),
      },
    ],
    outputs: [
      { name: 'dataset', source: { kind: 'node', nodeId: 'reduction', output: 'dataset' } },
    ],
  }
  const plan = await active.controller.planGraph(graph, {
    bindings: {
      source: {
        value: active.dataset,
        characteristics: scientificDatasetCharacteristics(active.dataset),
      },
    },
    policy: {
      mode: 'pinned',
      providerId: 'purejsimage.analysis.four-d-stem.reference',
      providerVersion: 1,
    },
    signal,
  })
  active.evidence.context.provider({
    operationId,
    semanticVersion: 1,
    providerId: 'purejsimage.analysis.four-d-stem.reference',
    buildFingerprint: 'typescript-4d-stem-reference-v1',
    reproducibilityClass: 'tolerance-based',
  })
  const execution = await active.controller.executeGraph(plan, { signal }).result
  const dataset = execution.outputs.get('dataset')
  if (!isDataset(dataset)) {
    await execution.release()
    throw new Error('4D-STEM analysis did not return a scientific dataset')
  }
  return Object.freeze({ dataset, execution })
}

const render = async (
  dataset: ScientificDataset,
  displayAxes: readonly [string, string],
  fixedIndices: readonly { readonly axisId: string; readonly index: number }[],
  signal: AbortSignal,
  evidence: EvidenceSession,
): Promise<FourDStemRenderedView> => {
  const rendered = await renderScientificPlane(dataset, {
    plane: { displayAxes, fixedIndices, signal },
    range: { mode: 'percentile', low: 1, high: 99, maxSamples: 65_536 },
    palette: 'magma',
    scale: 'sqrt',
    evidence: evidence.context.child('display-render'),
  })
  const pixels = new Uint8ClampedArray(rendered.width * rendered.height * 4)
  for await (const block of rendered.pixels) {
    try {
      for (let y = 0; y < block.height; y += 1) {
        for (let x = 0; x < block.width; x += 1) {
          const sourceOffset = y * block.stride + x * 3
          const targetOffset =
            ((block.y - rendered.y + y) * rendered.width + block.x - rendered.x + x) * 4
          pixels[targetOffset] = block.data[sourceOffset] ?? 0
          pixels[targetOffset + 1] = block.data[sourceOffset + 1] ?? 0
          pixels[targetOffset + 2] = block.data[sourceOffset + 2] ?? 0
          pixels[targetOffset + 3] = 255
        }
      }
    } finally {
      block.release?.()
    }
  }
  return Object.freeze({
    width: rendered.width,
    height: rendered.height,
    pixels,
    range: Object.freeze([rendered.range.min, rendered.range.max] as const),
  })
}

const diffraction = (active: WorkerState, signal: AbortSignal): Promise<FourDStemRenderedView> =>
  render(
    active.dataset,
    [active.roles.detectorX, active.roles.detectorY],
    [
      { axisId: active.roles.navigationX, index: cursor[0] },
      { axisId: active.roles.navigationY, index: cursor[1] },
    ],
    signal,
    active.evidence,
  )

const navigation = async (
  active: WorkerState,
  roi: DetectorRoi,
  reduction: 'sum' | 'mean',
  signal: AbortSignal,
): Promise<FourDStemRenderedView> => {
  const derived = await executeDerived(
    active,
    virtualDetectorMapOperationId,
    roi,
    reduction,
    signal,
  )
  try {
    return await render(
      derived.dataset,
      [active.roles.navigationX, active.roles.navigationY],
      [],
      signal,
      active.evidence,
    )
  } finally {
    await derived.execution.release()
  }
}

const reducedDiffraction = async (
  active: WorkerState,
  roi: NavigationRoi,
  reduction: 'sum' | 'mean',
  signal: AbortSignal,
): Promise<FourDStemRenderedView> => {
  const derived = await executeDerived(
    active,
    scanDiffractionReductionOperationId,
    roi,
    reduction,
    signal,
  )
  try {
    return await render(
      derived.dataset,
      [active.roles.detectorX, active.roles.detectorY],
      [],
      signal,
      active.evidence,
    )
  } finally {
    await derived.execution.release()
  }
}

const isRequest = (value: unknown): value is FourDStemWorkerRequest => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  if (
    !('version' in value) ||
    value.version !== 1 ||
    !('type' in value) ||
    typeof value.type !== 'string'
  )
    return false
  if (
    !('sequence' in value) ||
    typeof value.sequence !== 'number' ||
    !Number.isSafeInteger(value.sequence)
  )
    return false
  if (value.type === 'open-fixture' || value.type === 'cancel' || value.type === 'close')
    return true
  if (value.type === 'open-mib') {
    return (
      'mib' in value &&
      value.mib instanceof File &&
      (!('hdr' in value) || value.hdr instanceof File)
    )
  }
  if (value.type === 'cursor') {
    return (
      'scanX' in value &&
      typeof value.scanX === 'number' &&
      Number.isSafeInteger(value.scanX) &&
      'scanY' in value &&
      typeof value.scanY === 'number' &&
      Number.isSafeInteger(value.scanY)
    )
  }
  const validRoi = (roi: unknown, allowAnnulus: boolean): boolean => {
    if (roi === null || typeof roi !== 'object' || Array.isArray(roi)) return false
    if (!('kind' in roi) || typeof roi.kind !== 'string') return false
    if (!('x' in roi) || typeof roi.x !== 'number' || !Number.isFinite(roi.x)) return false
    if (!('y' in roi) || typeof roi.y !== 'number' || !Number.isFinite(roi.y)) return false
    if (roi.kind === 'point') return true
    if (roi.kind === 'rectangle') {
      return (
        'width' in roi &&
        typeof roi.width === 'number' &&
        Number.isFinite(roi.width) &&
        roi.width > 0 &&
        'height' in roi &&
        typeof roi.height === 'number' &&
        Number.isFinite(roi.height) &&
        roi.height > 0
      )
    }
    if (roi.kind === 'circle') {
      return (
        'radius' in roi &&
        typeof roi.radius === 'number' &&
        Number.isFinite(roi.radius) &&
        roi.radius > 0
      )
    }
    return (
      allowAnnulus &&
      roi.kind === 'annulus' &&
      'innerRadius' in roi &&
      typeof roi.innerRadius === 'number' &&
      Number.isFinite(roi.innerRadius) &&
      roi.innerRadius >= 0 &&
      'outerRadius' in roi &&
      typeof roi.outerRadius === 'number' &&
      Number.isFinite(roi.outerRadius) &&
      roi.outerRadius > roi.innerRadius
    )
  }
  if (value.type === 'detector-roi' || value.type === 'scan-roi') {
    return (
      'reduction' in value &&
      (value.reduction === 'sum' || value.reduction === 'mean') &&
      'roi' in value &&
      validRoi(value.roi, value.type === 'detector-roi')
    )
  }
  return false
}

scope.addEventListener('message', (event: MessageEvent<unknown>) => {
  if (!isRequest(event.data)) {
    post({
      version: 1,
      type: 'error',
      sequence: latestSequence,
      message: 'Invalid worker request',
      recoverable: true,
    })
    return
  }
  const request = event.data
  latestSequence = Math.max(latestSequence, request.sequence)
  if (request.type === 'cancel') {
    if (activeAbort !== undefined) {
      activeAbort.abort(new DOMException('4D-STEM request cancelled', 'AbortError'))
      state?.evidence.context.cancellation('4d-stem-request')
    }
    return
  }
  if (request.type === 'close') {
    if (activeAbort !== undefined) {
      activeAbort.abort(new DOMException('4D-STEM worker closed', 'AbortError'))
      state?.evidence.context.cancellation('close-4d-stem-worker')
      activeAbort = undefined
    }
    void cleanup().then(() => post({ version: 1, type: 'closed', sequence: request.sequence }))
    return
  }
  if (activeAbort !== undefined) {
    activeAbort.abort(new DOMException('Superseded by a newer 4D-STEM request', 'AbortError'))
    state?.evidence.context.cancellation('stale-4d-stem-request')
  }
  const abort = new AbortController()
  activeAbort = abort
  void (async () => {
    try {
      if (request.type === 'open-fixture' || request.type === 'open-mib') {
        if (request.type === 'open-fixture') {
          const fixture = createGeneratedFourDStemFixture()
          state = await createState('Generated 4D-STEM MIB', fixture.mib, fixture.hdr, abort.signal)
        } else {
          state = await createState(request.mib.name, request.mib, request.hdr, abort.signal)
        }
        cursor = Object.freeze([3, 2] as const)
        const navigationView = await navigation(
          state,
          { kind: 'annulus', x: 8.5, y: 7.5, innerRadius: 3.5, outerRadius: 6 },
          'sum',
          abort.signal,
        )
        const diffractionView = await diffraction(state, abort.signal)
        const scanX = state.dataset.descriptor.axes.find(
          (axis) => axis.id === state?.roles.navigationX,
        )
        const scanY = state.dataset.descriptor.axes.find(
          (axis) => axis.id === state?.roles.navigationY,
        )
        const kx = state.dataset.descriptor.axes.find((axis) => axis.id === state?.roles.detectorX)
        const ky = state.dataset.descriptor.axes.find((axis) => axis.id === state?.roles.detectorY)
        if (scanX === undefined || scanY === undefined || kx === undefined || ky === undefined) {
          throw new Error('Dataset does not expose scanX, scanY, kx, and ky axes')
        }
        post(
          {
            version: 1,
            type: 'opened',
            sequence: request.sequence,
            name: state.name,
            reader: `${state.document.reader.id}@${state.document.reader.version}`,
            sampleType: state.dataset.descriptor.sampleType,
            scanShape: [scanX.length, scanY.length],
            detectorShape: [kx.length, ky.length],
            roles: state.roles,
            cursor,
            navigation: navigationView,
            diffraction: diffractionView,
            evidence: snapshot(),
          },
          [navigationView.pixels.buffer, diffractionView.pixels.buffer],
        )
        return
      }
      const active = state
      if (active === undefined) throw new Error('Open a 4D-STEM dataset first')
      await coalesceInteraction(abort.signal)
      if (request.type === 'cursor') {
        const scanX = active.dataset.descriptor.axes.find(
          (axis) => axis.id === active.roles.navigationX,
        )
        const scanY = active.dataset.descriptor.axes.find(
          (axis) => axis.id === active.roles.navigationY,
        )
        if (
          scanX === undefined ||
          scanY === undefined ||
          !Number.isSafeInteger(request.scanX) ||
          !Number.isSafeInteger(request.scanY) ||
          request.scanX < 0 ||
          request.scanY < 0 ||
          request.scanX >= scanX.length ||
          request.scanY >= scanY.length
        ) {
          throw new Error('Scan cursor is outside the navigation plane')
        }
        cursor = Object.freeze([request.scanX, request.scanY] as const)
        const view = await diffraction(active, abort.signal)
        post(
          {
            version: 1,
            type: 'rendered',
            sequence: request.sequence,
            target: 'diffraction',
            view,
            cursor,
            evidence: snapshot(),
          },
          [view.pixels.buffer],
        )
        return
      }
      const view =
        request.type === 'detector-roi'
          ? await navigation(active, request.roi, request.reduction, abort.signal)
          : await reducedDiffraction(active, request.roi, request.reduction, abort.signal)
      post(
        {
          version: 1,
          type: 'rendered',
          sequence: request.sequence,
          target: request.type === 'detector-roi' ? 'navigation' : 'diffraction',
          view,
          evidence: snapshot(),
        },
        [view.pixels.buffer],
      )
    } catch (error) {
      if (abort.signal.aborted) return
      post({
        version: 1,
        type: 'error',
        sequence: request.sequence,
        message: error instanceof Error ? error.message : 'Unknown 4D-STEM worker error',
        recoverable: state !== undefined,
      })
    } finally {
      if (activeAbort === abort) activeAbort = undefined
    }
  })()
})
