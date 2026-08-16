import { type Source as CogSource, Tiff } from '@cogeotiff/core'
import * as cornerstone from '@cornerstonejs/core'
import * as niftiVolumeLoader from '@cornerstonejs/nifti-volume-loader'
import { readImage, setPipelinesBaseUrl } from '@itk-wasm/image-io'
import { Niivue } from '@niivue/niivue'
import { loadOmeTiff } from '@vivjs/loaders'
import { fromUrl } from 'geotiff'
import OpenSeadragon from 'openseadragon'
import type { RasterSampleType } from '../../src/raster.ts'
import {
  createScientificLibrary,
  renderScientificPlane,
  type ScientificDataset,
  type ScientificDocument,
  type ScientificPlaneSelection,
  type ScientificReader,
  sliceScientificVolume,
  supportsScientificPlaneRead,
} from '../../src/scientific/index.ts'
import { niftiReader } from '../../src/scientific/readers/nifti.ts'
import { tiffReader } from '../../src/scientific/readers/tiff.ts'
import { HttpRangeSource } from '../../src/sources/http-range.ts'
import { viewerEngines, viewerLatencyProfiles, viewerWorkloads } from './config.ts'
import type {
  ViewerBenchmarkHarness,
  ViewerBenchmarkProfile,
  ViewerBenchmarkReport,
  ViewerBenchmarkRunOptions,
  ViewerBenchmarkSample,
  ViewerBrowser,
  ViewerCacheMode,
  ViewerCorrectnessMetrics,
  ViewerDataMetrics,
  ViewerEngineId,
  ViewerEngineMetadata,
  ViewerLatencyMetrics,
  ViewerLatencyProfile,
  ViewerMemoryMetrics,
  ViewerRenderingMetrics,
  ViewerServerRequestLog,
  ViewerStartupMetrics,
  ViewerStatus,
  ViewerWorkloadId,
  ViewerWorkloadMetadata,
} from './types.ts'

const outputWidth = 256
const outputHeight = 192
const defaultLatencyProfile = viewerLatencyProfiles[0] ?? 0
const defaultCacheMode: ViewerCacheMode = 'immutable'

interface SidecarState {
  readonly offsets: readonly number[]
  readonly bytes: number
  readonly generationMilliseconds: number
}

interface OperationOutput {
  readonly outputBytes: number
  readonly canvas: HTMLCanvasElement | null
  readonly firstDecodedAt: number | null
  readonly firstVisibleAt: number | null
  readonly stableViewportAt: number | null
  readonly completeInteractionAt: number | null
  readonly hiddenDtypeConversion: boolean
  readonly note?: string
}

interface PreparedEngine {
  run(workload: ViewerWorkloadMetadata): Promise<OperationOutput>
  close?(): void | Promise<void>
}

interface ViewerRunContext {
  readonly phase: 'cold' | 'warm'
  readonly browser: ViewerBrowser
  readonly latencyMilliseconds: ViewerLatencyProfile
  readonly cacheMode: ViewerCacheMode
  readonly throughputBytesPerSecond: number | null
  readonly dataUrl: (fixture: string) => string
  readonly sidecar: SidecarState | undefined
}

interface MeasurementState {
  readonly startedAt: number
  readonly startup: ViewerStartupMetrics
  readonly longTaskCount: () => number
  readonly stopLongTasks: () => void
}

class UnsupportedViewerCase extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsupportedViewerCase'
  }
}

const errorMessage = (cause: unknown): string => {
  if (cause instanceof Error) return cause.message
  if (typeof cause === 'string') return cause
  return 'Unknown browser viewer error'
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const numeric = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const byteLengthOf = (value: unknown): number => {
  if (value instanceof ArrayBuffer) return value.byteLength
  if (ArrayBuffer.isView(value)) return value.byteLength
  return 0
}

const numberAt = (value: unknown, index: number): number => {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return 0
  const item = Reflect.get(value, index)
  if (typeof item === 'number') return Number.isFinite(item) ? item : 0
  if (typeof item === 'bigint') return Number(item)
  return 0
}

const hashText = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

const canvasHash = async (canvas: HTMLCanvasElement | null): Promise<string | null> =>
  canvas === null ? null : hashText(canvas.toDataURL('image/png'))

const viewerMount = (): HTMLDivElement => {
  const element = document.getElementById('viewer-mount')
  if (!(element instanceof HTMLDivElement)) throw new Error('Viewer mount element is missing')
  return element
}

const newCanvas = (): HTMLCanvasElement => {
  const mount = viewerMount()
  mount.replaceChildren()
  const canvas = document.createElement('canvas')
  canvas.width = outputWidth
  canvas.height = outputHeight
  canvas.setAttribute('aria-label', 'Scientific viewer benchmark output')
  mount.append(canvas)
  return canvas
}

const stableFrames = async (): Promise<number> => {
  const started = performance.now()
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve())
    })
  })
  return performance.now() - started
}

const renderNumericData = (
  data: unknown,
  sourceWidth: number,
  sourceHeight: number,
  channels = 1,
): HTMLCanvasElement => {
  const canvas = newCanvas()
  const context = canvas.getContext('2d')
  if (context === null) throw new Error('Canvas 2D context is unavailable')
  const sampleCount = Math.max(1, sourceWidth * sourceHeight * channels)
  let minimum = Number.POSITIVE_INFINITY
  let maximum = Number.NEGATIVE_INFINITY
  const scanCount = Math.min(sampleCount, 4_096)
  for (let index = 0; index < scanCount; index += 1) {
    const sample = numberAt(data, index)
    if (Number.isFinite(sample)) {
      minimum = Math.min(minimum, sample)
      maximum = Math.max(maximum, sample)
    }
  }
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) {
    minimum = 0
    maximum = 1
  }
  if (minimum === maximum) maximum = minimum + 1
  const output = context.createImageData(outputWidth, outputHeight)
  for (let y = 0; y < outputHeight; y += 1) {
    const sourceY = Math.min(sourceHeight - 1, Math.floor((y * sourceHeight) / outputHeight))
    for (let x = 0; x < outputWidth; x += 1) {
      const sourceX = Math.min(sourceWidth - 1, Math.floor((x * sourceWidth) / outputWidth))
      const sourceIndex = (sourceY * sourceWidth + sourceX) * channels
      const red = numberAt(data, sourceIndex)
      const green = channels > 1 ? numberAt(data, sourceIndex + 1) : red
      const blue = channels > 2 ? numberAt(data, sourceIndex + 2) : red
      const outputOffset = (y * outputWidth + x) * 4
      const scale = (sample: number): number =>
        Math.max(0, Math.min(255, Math.round(((sample - minimum) / (maximum - minimum)) * 255)))
      output.data[outputOffset] = scale(red)
      output.data[outputOffset + 1] = scale(green)
      output.data[outputOffset + 2] = scale(blue)
      output.data[outputOffset + 3] = 255
    }
  }
  context.putImageData(output, 0, 0)
  return canvas
}

const renderScientific = async (
  dataset: ScientificDataset,
  selection: ScientificPlaneSelection,
): Promise<{
  readonly canvas: HTMLCanvasElement
  readonly outputBytes: number
  readonly firstDecodedAt: number
}> => {
  const started = performance.now()
  const rendered = await renderScientificPlane(dataset, {
    plane: selection,
    range: { mode: 'percentile', low: 1, high: 99, maxSamples: 4_096 },
    palette: 'grayscale',
  })
  const rgb = new Uint8Array(rendered.width * rendered.height * 3)
  let firstDecodedAt: number | null = null
  for await (const block of rendered.pixels) {
    firstDecodedAt ??= performance.now() - started
    for (let row = 0; row < block.height; row += 1) {
      const sourceOffset = row * block.stride
      const destinationOffset = ((block.y + row) * rendered.width + block.x) * 3
      rgb.set(block.data.subarray(sourceOffset, sourceOffset + block.width * 3), destinationOffset)
    }
    block.release?.()
  }
  const canvas = renderNumericData(rgb, rendered.width, rendered.height, 3)
  return {
    canvas,
    outputBytes: rgb.byteLength,
    firstDecodedAt: firstDecodedAt ?? performance.now() - started,
  }
}

const renderScientificComponentSample = (
  view: DataView,
  offset: number,
  sampleType: RasterSampleType,
): number => {
  if (sampleType === 'uint8') return view.getUint8(offset)
  if (sampleType === 'uint16') return view.getUint16(offset, false)
  if (sampleType === 'uint32') return view.getUint32(offset, false)
  if (sampleType === 'uint64')
    return view.getUint32(offset, false) * 4_294_967_296 + view.getUint32(offset + 4, false)
  if (sampleType === 'int8') return view.getInt8(offset)
  if (sampleType === 'int16') return view.getInt16(offset, false)
  if (sampleType === 'int32') return view.getInt32(offset, false)
  if (sampleType === 'float32') return view.getFloat32(offset, false)
  if (sampleType === 'float64') return view.getFloat64(offset, false)
  throw new UnsupportedViewerCase(
    `PureJsImage viewer rendering does not support ${sampleType} RGB samples`,
  )
}

const renderScientificDataset = async (
  dataset: ScientificDataset,
  selection: ScientificPlaneSelection,
): Promise<{
  readonly canvas: HTMLCanvasElement
  readonly outputBytes: number
  readonly firstDecodedAt: number
}> => {
  if (dataset.descriptor.components.length === 1) return renderScientific(dataset, selection)
  const channels = dataset.descriptor.components.length
  if (channels !== 3 && channels !== 4) {
    throw new UnsupportedViewerCase(
      `PureJsImage viewer rendering supports scalar, RGB, and RGBA datasets; received ${channels} components`,
    )
  }
  const width =
    dataset.descriptor.axes.find((axis) => axis.id === selection.displayAxes[0])?.length ?? 0
  const height =
    dataset.descriptor.axes.find((axis) => axis.id === selection.displayAxes[1])?.length ?? 0
  if (width < 1 || height < 1)
    throw new Error('PureJsImage viewer received an empty multichannel plane')
  const output = new Float64Array(width * height * channels)
  const sampleBytes =
    dataset.descriptor.sampleType === 'uint8' || dataset.descriptor.sampleType === 'int8'
      ? 1
      : dataset.descriptor.sampleType === 'uint16' ||
          dataset.descriptor.sampleType === 'int16' ||
          dataset.descriptor.sampleType === 'float16'
        ? 2
        : dataset.descriptor.sampleType === 'uint32' ||
            dataset.descriptor.sampleType === 'int32' ||
            dataset.descriptor.sampleType === 'float32'
          ? 4
          : 8
  const started = performance.now()
  let firstDecodedAt: number | null = null
  for await (const block of dataset.readPlane(selection)) {
    firstDecodedAt ??= performance.now() - started
    if (block.format.channels !== channels) {
      block.release?.()
      throw new Error(
        `PureJsImage viewer received ${block.format.channels} channels for a ${channels}-component dataset`,
      )
    }
    const view = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength)
    const planeStride = block.planeStride ?? block.stride * block.height
    for (let row = 0; row < block.height; row += 1) {
      for (let column = 0; column < block.width; column += 1) {
        for (let channel = 0; channel < channels; channel += 1) {
          const sampleOffset = block.format.planar
            ? channel * planeStride + row * block.stride + column * sampleBytes
            : row * block.stride + (column * channels + channel) * sampleBytes
          const outputOffset = ((block.y + row) * width + block.x + column) * channels + channel
          output[outputOffset] = renderScientificComponentSample(
            view,
            sampleOffset,
            dataset.descriptor.sampleType,
          )
        }
      }
    }
    block.release?.()
  }
  const canvas = renderNumericData(output, width, height, channels)
  return {
    canvas,
    outputBytes: output.byteLength,
    firstDecodedAt: firstDecodedAt ?? performance.now() - started,
  }
}

const outputFromCanvas = async (options: {
  readonly canvas: HTMLCanvasElement
  readonly outputBytes: number
  readonly startedAt: number
  readonly firstDecodedAt?: number | null
  readonly completeInteractionAt?: number | null
  readonly hiddenDtypeConversion?: boolean
}): Promise<OperationOutput> => {
  const firstVisibleAt = performance.now() - options.startedAt
  const stableMilliseconds = await stableFrames()
  return {
    outputBytes: options.outputBytes,
    canvas: options.canvas,
    firstDecodedAt: options.firstDecodedAt ?? firstVisibleAt,
    firstVisibleAt,
    stableViewportAt: firstVisibleAt + stableMilliseconds,
    completeInteractionAt: options.completeInteractionAt ?? firstVisibleAt + stableMilliseconds,
    hiddenDtypeConversion: options.hiddenDtypeConversion ?? false,
  }
}

const metadataOutput = (bytes: number, startedAt: number, note?: string): OperationOutput => ({
  outputBytes: bytes,
  canvas: null,
  firstDecodedAt: performance.now() - startedAt,
  firstVisibleAt: null,
  stableViewportAt: null,
  completeInteractionAt: performance.now() - startedAt,
  hiddenDtypeConversion: false,
  ...(note === undefined ? {} : { note }),
})

const waitForMeasurement = (): MeasurementState => {
  const startedAt = performance.now()
  let longTasks = 0
  let observer: PerformanceObserver | undefined
  try {
    const supportedEntryTypes: unknown = Reflect.get(PerformanceObserver, 'supportedEntryTypes')
    if (
      Array.isArray(supportedEntryTypes) &&
      supportedEntryTypes.some((entry) => entry === 'longtask')
    ) {
      observer = new PerformanceObserver((entries) => {
        longTasks += entries.getEntries().length
      })
      observer.observe({ type: 'longtask', buffered: true })
    }
  } catch {
    observer = undefined
  }
  const startup: ViewerStartupMetrics = {
    downloadedJavaScriptBytes: 0,
    downloadedWasmBytes: 0,
    importAndParseMilliseconds: 0,
    initializationMilliseconds: 0,
    workerCreationMilliseconds: 0,
    webglInitializationMilliseconds: 0,
    webgpuInitializationMilliseconds: 0,
  }
  const stopLongTasks = (): void => observer?.disconnect()
  const state: MeasurementState = {
    startedAt,
    startup,
    longTaskCount: () => longTasks,
    stopLongTasks,
  }
  return state
}

const startupMetrics = (
  state: MeasurementState,
  initializationMilliseconds: number,
): ViewerStartupMetrics => {
  const entries = performance.getEntriesByType('resource')
  let downloadedJavaScriptBytes = 0
  let downloadedWasmBytes = 0
  for (const entry of entries) {
    if (!(entry instanceof PerformanceResourceTiming)) continue
    const bytes = entry.transferSize || entry.encodedBodySize || 0
    if (entry.name.endsWith('.wasm') || entry.name.includes('.wasm?')) downloadedWasmBytes += bytes
    if (entry.name.endsWith('.js') || entry.name.includes('.js?'))
      downloadedJavaScriptBytes += bytes
  }
  return Object.freeze({
    ...state.startup,
    downloadedJavaScriptBytes,
    downloadedWasmBytes,
    importAndParseMilliseconds: initializationMilliseconds,
    initializationMilliseconds,
  })
}

const dataUrl = (
  fixture: string,
  latencyMilliseconds: number,
  phase: 'cold' | 'warm',
  requestedCacheMode: ViewerCacheMode,
  throughputBytesPerSecond: number | null,
): string => {
  const url = new URL(`/data/${fixture}`, window.location.href)
  url.searchParams.set('latencyMs', String(latencyMilliseconds))
  url.searchParams.set('cacheMode', phase === 'cold' ? 'no-store' : requestedCacheMode)
  if (throughputBytesPerSecond !== null) {
    url.searchParams.set('throughputBytesPerSecond', String(throughputBytesPerSecond))
  }
  return url.href
}

const resetServer = async (): Promise<void> => {
  const response = await fetch('/__viewer/reset', { method: 'POST', cache: 'no-store' })
  if (!response.ok) throw new Error(`Viewer request log reset failed with ${response.status}`)
}

const isRequestLog = (value: unknown): value is ViewerServerRequestLog =>
  isRecord(value) &&
  numeric(value.id) &&
  typeof value.method === 'string' &&
  typeof value.pathname === 'string' &&
  (typeof value.fixtureId === 'string' || value.fixtureId === null) &&
  (typeof value.rangeStart === 'number' || value.rangeStart === null) &&
  (typeof value.rangeEnd === 'number' || value.rangeEnd === null) &&
  numeric(value.requestedBytes) &&
  numeric(value.returnedBytes) &&
  (value.cacheMode === 'no-store' ||
    value.cacheMode === 'revalidate' ||
    value.cacheMode === 'immutable') &&
  numeric(value.latencyMilliseconds) &&
  (typeof value.throughputBytesPerSecond === 'number' || value.throughputBytesPerSecond === null) &&
  typeof value.aborted === 'boolean'

const requestLogs = async (): Promise<readonly ViewerServerRequestLog[]> => {
  const response = await fetch('/__viewer/requests', { cache: 'no-store' })
  if (!response.ok) throw new Error(`Viewer request log fetch failed with ${response.status}`)
  const value: unknown = await response.json()
  if (!Array.isArray(value) || !value.every(isRequestLog))
    throw new Error('Viewer request log has an invalid shape')
  return value
}

const dataMetrics = (
  logs: readonly ViewerServerRequestLog[],
  fixture: string,
): ViewerDataMetrics => {
  const relevant = logs.filter(
    (entry) => entry.fixtureId !== null && entry.pathname === `/data/${fixture}`,
  )
  const intervals: Array<readonly [number, number]> = []
  let returnedBytes = 0
  let largestRequest = 0
  let abortedRequests = 0
  for (const entry of relevant) {
    returnedBytes += entry.returnedBytes
    largestRequest = Math.max(largestRequest, entry.returnedBytes)
    if (entry.aborted) abortedRequests += 1
    if (entry.rangeStart !== null && entry.rangeEnd !== null) {
      intervals.push([entry.rangeStart, entry.rangeEnd + 1])
    } else if (entry.returnedBytes > 0) {
      intervals.push([0, entry.returnedBytes])
    }
  }
  intervals.sort((left, right) => left[0] - right[0])
  let uniqueBytes = 0
  let current: readonly [number, number] | undefined
  for (const interval of intervals) {
    if (current === undefined) {
      current = interval
      continue
    }
    if (interval[0] <= current[1]) {
      current = [current[0], Math.max(current[1], interval[1])]
    } else {
      uniqueBytes += current[1] - current[0]
      current = interval
    }
  }
  if (current !== undefined) uniqueBytes += current[1] - current[0]
  return Object.freeze({
    requests: relevant.length,
    returnedBytes,
    uniqueBytes,
    largestRequest,
    overfetchBytes: Math.max(0, returnedBytes - uniqueBytes),
    abortedRequests,
    cacheHitsObservable: null,
  })
}

const memoryMetrics = (): ViewerMemoryMetrics => {
  const performanceMemory = Reflect.get(performance, 'memory')
  const jsHeapUsedBytes =
    isRecord(performanceMemory) && numeric(performanceMemory.usedJSHeapSize)
      ? performanceMemory.usedJSHeapSize
      : null
  return Object.freeze({
    jsHeapUsedBytes,
    workerHeapUsedBytes: null,
    domBytes: null,
    arrayBufferBytes: null,
    gpuBytesClaimed: null,
    note: 'Browser-exposed JS heap only; GPU, DOM, and worker memory were not universally observable.',
  })
}

const renderingMetrics = async (
  output: OperationOutput,
  longTasks: number,
): Promise<ViewerRenderingMetrics> => {
  const hash = await canvasHash(output.canvas)
  const frameTimesMilliseconds: number[] = []
  let previous = performance.now()
  await new Promise<void>((resolve) => {
    let frames = 0
    const frame = (timestamp: number): void => {
      frameTimesMilliseconds.push(timestamp - previous)
      previous = timestamp
      frames += 1
      if (frames >= 6) resolve()
      else requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  })
  return Object.freeze({
    frameTimesMilliseconds: Object.freeze(frameTimesMilliseconds),
    longTasks,
    droppedOrLateFrames: frameTimesMilliseconds.filter((value) => value > 25).length,
    textureBytesAllocatedOrUploaded: null,
    canvasWidth: output.canvas?.width ?? 0,
    canvasHeight: output.canvas?.height ?? 0,
    framebufferHash: hash,
  })
}

const statusForError = (cause: unknown): readonly [ViewerStatus, string] => {
  const message = errorMessage(cause)
  if (
    cause instanceof UnsupportedViewerCase ||
    /unsupported|not supported|requires|not prepared|not implemented/iu.test(message)
  ) {
    return ['unsupported', message]
  }
  return ['error', message]
}

const finiteDimension = (value: number): boolean => Number.isSafeInteger(value) && value > 0

const correctnessMetrics = async (
  output: OperationOutput,
  workload: ViewerWorkloadMetadata,
  referenceHash: string | null,
  status: ViewerStatus,
): Promise<ViewerCorrectnessMetrics | null> => {
  if (output.canvas === null) return null
  const hash = await canvasHash(output.canvas)
  const passed =
    status === 'supported' &&
    finiteDimension(output.canvas.width) &&
    finiteDimension(output.canvas.height) &&
    output.outputBytes > 0 &&
    (referenceHash === null || referenceHash === hash)
  return Object.freeze({
    outputCanvasDimensions: [output.canvas.width, output.canvas.height] as const,
    screenshotOrFramebufferHash: hash,
    referenceHash,
    mismatchFraction: referenceHash === null ? null : referenceHash === hash ? 0 : 1,
    tolerance: 0,
    logicalChannel: workload.logicalSelection.includes('C1') ? 'C1' : 'C0',
    logicalZ: workload.logicalSelection.includes('Z1') ? 1 : 0,
    logicalT: workload.logicalSelection.includes('T1') ? 1 : 0,
    logicalLevel: workload.logicalSelection.includes('level 1') ? 1 : 0,
    logicalRegion: [0, 0, outputWidth, outputHeight] as const,
    transferFunction:
      workload.family === 'volume-viewers' ? 'native-display-or-engine-default' : 'grayscale',
    implicitChannelSumming: false,
    implicitFrameSumming: false,
    hiddenDtypeConversion: output.hiddenDtypeConversion,
    unsupportedCaseVisible: status !== 'supported',
    passed,
  })
}

const fixedIndicesFor = (
  dataset: ScientificDataset,
  displayAxes: readonly [string, string],
): ScientificPlaneSelection => ({
  displayAxes,
  fixedIndices: dataset.descriptor.axes
    .filter((axis) => !displayAxes.includes(axis.id))
    .map((axis) => ({ axisId: axis.id, index: 0 })),
})

const spatialAxes = (dataset: ScientificDataset): readonly [string, string, string] => {
  const axes = dataset.descriptor.axes.filter((axis) => axis.kind === 'space')
  const selected = axes.length >= 3 ? axes.slice(0, 3).map((axis) => axis.id) : ['x', 'y', 'z']
  return [selected[0] ?? 'x', selected[1] ?? 'y', selected[2] ?? 'z']
}

const volumeSelection = (
  dataset: ScientificDataset,
  workload: ViewerWorkloadId,
): ScientificPlaneSelection => {
  const [x, y, z] = spatialAxes(dataset)
  const displayAxes: readonly [string, string] =
    workload === 'first-sagittal-slice'
      ? [y, z]
      : workload === 'first-coronal-slice'
        ? [x, z]
        : [x, y]
  return fixedIndicesFor(dataset, displayAxes)
}

const openRemoteDocument = async (
  fixture: string,
  reader: ScientificReader,
  url: string,
): Promise<{ readonly document: ScientificDocument; readonly dataset: ScientificDataset }> => {
  const source = await HttpRangeSource.open(url, { blockBytes: 4_096, maxCacheBytes: 32_768 })
  const library = createScientificLibrary({ readers: [reader] })
  const document = await library.open({
    primary: { id: fixture, name: fixture, source },
    readerId: reader.descriptor.id,
  })
  const summary = document.datasets[0]
  if (summary === undefined)
    throw new Error(`Scientific fixture ${fixture} did not expose a dataset`)
  const dataset = await document.openDataset(summary.id)
  return { document, dataset }
}

const buildIfdSidecar = async (url: string): Promise<SidecarState> => {
  const started = performance.now()
  const response = await fetch(url, { headers: { range: 'bytes=0-4095' }, cache: 'no-store' })
  if (response.status !== 206) throw new Error(`OME-TIFF sidecar probe returned ${response.status}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength < 8) throw new Error('OME-TIFF sidecar probe was truncated')
  const littleEndian = bytes[0] === 0x49 && bytes[1] === 0x49
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const version = view.getUint16(2, littleEndian)
  const offset =
    version === 43 ? Number(view.getBigUint64(8, littleEndian)) : view.getUint32(4, littleEndian)
  const offsets: number[] = []
  let current = offset
  for (let index = 0; index < 64 && current > 0 && current + 2 <= bytes.byteLength; index += 1) {
    offsets.push(current)
    const entryCount =
      version === 43
        ? Number(view.getBigUint64(current, littleEndian))
        : view.getUint16(current, littleEndian)
    const entryBytes = version === 43 ? 20 : 12
    const nextOffsetPosition = current + (version === 43 ? 8 : 2) + entryCount * entryBytes
    if (nextOffsetPosition + (version === 43 ? 8 : 4) > bytes.byteLength) break
    current =
      version === 43
        ? Number(view.getBigUint64(nextOffsetPosition, littleEndian))
        : view.getUint32(nextOffsetPosition, littleEndian)
  }
  const sidecarBytes = new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, offsets }))
  return Object.freeze({
    offsets: Object.freeze(offsets),
    bytes: sidecarBytes.byteLength,
    generationMilliseconds: performance.now() - started,
  })
}

const geoTiffEngine = async (url: string, cogFallback = false): Promise<PreparedEngine> => {
  const tiff = await fromUrl(url)
  const image = await tiff.getImage()
  return {
    async run(workload) {
      const startedAt = performance.now()
      const width = image.getWidth()
      const height = image.getHeight()
      if (workload.id === 'metadata-ready' || workload.id === 'metadata-ready-cog') {
        return metadataOutput(width * height, startedAt, `${width}x${height}`)
      }
      if (cogFallback) {
        throw new UnsupportedViewerCase(
          'The tracked COG fixture is an ordinary striped TIFF, not an exact tiled COG',
        )
      }
      if (workload.id === 'random-tile-sequence' && !image.isTiled) {
        throw new UnsupportedViewerCase('The generated OME-TIFF has no native tile grid')
      }
      const readWidth = Math.max(1, Math.min(width, outputWidth))
      const readHeight = Math.max(1, Math.min(height, outputHeight))
      const raster = await image.readRasters({
        window: [0, 0, readWidth, readHeight],
        width: readWidth,
        height: readHeight,
        interleave: true,
      })
      const channels = image.getSamplesPerPixel()
      const canvas = renderNumericData(raster, readWidth, readHeight, channels)
      return outputFromCanvas({ canvas, outputBytes: byteLengthOf(raster), startedAt })
    },
  }
}

const vivLoaderEngine = async (
  url: string,
  indexed: boolean,
  sidecar: SidecarState | undefined,
): Promise<PreparedEngine> => {
  const loaded = indexed
    ? await loadOmeTiff(url, { offsets: [...(sidecar?.offsets ?? [])] })
    : await loadOmeTiff(url)
  const source = loaded.data[0]
  if (source === undefined) throw new Error('Viv did not expose an OME-TIFF pixel source')
  return {
    async run(workload) {
      const startedAt = performance.now()
      if (workload.id === 'metadata-ready') {
        return metadataOutput(JSON.stringify(loaded.metadata).length, startedAt)
      }
      const selection = {
        c: workload.id === 'channel-toggle' ? 1 : 0,
        z: workload.id === 'z-change' ? 1 : 0,
        t: workload.id === 't-change' ? 1 : 0,
      }
      const shapeLength = (label: 'c' | 't' | 'x' | 'y' | 'z'): number => {
        const index = source.labels.indexOf(label)
        return index < 0 ? 1 : (source.shape[index] ?? 0)
      }
      if (
        (workload.id === 'fixed-multichannel-viewport' || workload.id === 'channel-toggle') &&
        shapeLength('c') <= 1
      ) {
        throw new UnsupportedViewerCase(
          `${workload.id} requires at least two OME-TIFF channels in the fixture`,
        )
      }
      if (workload.id === 'random-tile-sequence') {
        const tileCount =
          Math.ceil(shapeLength('x') / source.tileSize) *
          Math.ceil(shapeLength('y') / source.tileSize)
        if (tileCount < 2)
          throw new UnsupportedViewerCase('The generated OME-TIFF has only one native tile')
      }
      if (
        (selection.z > 0 && shapeLength('z') <= selection.z) ||
        (selection.t > 0 && shapeLength('t') <= selection.t)
      ) {
        throw new UnsupportedViewerCase(
          `${workload.id} is outside the generated OME-TIFF Z/T extent`,
        )
      }
      const tileCoordinates: readonly (readonly [number, number])[] =
        workload.id === 'random-tile-sequence'
          ? [
              [0, 0],
              [1, 0],
              [0, 1],
              [1, 1],
            ]
          : [[0, 0]]
      let tile = await source.getTile({
        x: tileCoordinates[0]?.[0] ?? 0,
        y: tileCoordinates[0]?.[1] ?? 0,
        selection,
      })
      let outputBytes = byteLengthOf(tile.data)
      for (const [x, y] of tileCoordinates.slice(1)) {
        tile = await source.getTile({ x, y, selection })
        outputBytes += byteLengthOf(tile.data)
      }
      const canvas = renderNumericData(tile.data, tile.width, tile.height)
      return outputFromCanvas({ canvas, outputBytes, startedAt })
    },
  }
}

const vivFullEngine = async (url: string): Promise<PreparedEngine> => {
  const [{ Deck, OrthographicView }, { MultiscaleImageLayer }] = await Promise.all([
    import('@deck.gl/core'),
    import('@hms-dbmi/viv'),
  ])
  const loaded = await loadOmeTiff(url)
  const source = loaded.data[0]
  if (source === undefined)
    throw new Error('Viv full viewer did not expose an OME-TIFF pixel source')
  const canvas = newCanvas()
  const layerLoaders = loaded.data.map((pixelSource) => ({
    dtype: pixelSource.dtype,
    tileSize: pixelSource.tileSize,
    shape: pixelSource.shape,
    labels: pixelSource.labels,
    meta: pixelSource.meta ?? {},
    getRaster: pixelSource.getRaster.bind(pixelSource),
    getTile: pixelSource.getTile.bind(pixelSource),
    onTileError: pixelSource.onTileError.bind(pixelSource),
  }))
  const layer = new MultiscaleImageLayer({
    id: 'viv-full-layer',
    loader: layerLoaders,
    selections: [{ c: 0, z: 0, t: 0 }],
    dtype: source.dtype,
    contrastLimits: [[0, 255]],
    channelsVisible: [true],
    maxRequests: 4,
  })
  const deck = new Deck({
    canvas,
    controller: false,
    views: new OrthographicView({ id: 'viv-full-view' }),
    width: outputWidth,
    height: outputHeight,
    initialViewState: {
      target: [1, 1, 0],
      zoom: Math.log2(
        Math.min(
          outputWidth / (source.shape[source.labels.indexOf('x')] ?? 1),
          outputHeight / (source.shape[source.labels.indexOf('y')] ?? 1),
        ),
      ),
    },
    layers: [layer],
  })
  return {
    async run(workload) {
      const startedAt = performance.now()
      const shapeLength = (label: 'c' | 't' | 'z'): number => {
        const index = source.labels.indexOf(label)
        return index < 0 ? 1 : (source.shape[index] ?? 0)
      }
      if (
        (workload.id === 'fixed-multichannel-viewport' || workload.id === 'channel-toggle') &&
        shapeLength('c') <= 1
      ) {
        throw new UnsupportedViewerCase(
          `${workload.id} requires at least two OME-TIFF channels in the fixture`,
        )
      }
      if (workload.id === 'channel-toggle') {
        deck.setProps({
          layers: [
            new MultiscaleImageLayer({
              id: 'viv-full-layer',
              loader: layerLoaders,
              selections: [{ c: 1, z: 0, t: 0 }],
              dtype: source.dtype,
              contrastLimits: [[0, 255]],
              channelsVisible: [false],
              maxRequests: 4,
            }),
          ],
        })
      }
      if (workload.id === 'z-change' || workload.id === 't-change') {
        throw new UnsupportedViewerCase(`${workload.id} is outside the generated OME-TIFF extent`)
      }
      if (workload.id === 'zoom-level-transition' && loaded.data.length < 2) {
        throw new UnsupportedViewerCase('The generated OME-TIFF has no overview level')
      }
      await stableFrames()
      return outputFromCanvas({
        canvas,
        outputBytes: source.shape.reduce((total, value) => total * value, 1),
        startedAt,
      })
    },
    close() {
      deck.finalize()
    },
  }
}

const pureJsVolumeEngine = async (url: string): Promise<PreparedEngine> => {
  const opened = await openRemoteDocument('nifti-volume', niftiReader, url)
  const { document, dataset } = opened
  return {
    async run(workload) {
      const startedAt = performance.now()
      if (workload.id === 'overlay-switch') {
        throw new UnsupportedViewerCase('PureJsImage has no overlay volume in the shared fixture')
      }
      if (workload.id === 'window-level-change') {
        throw new UnsupportedViewerCase(
          'PureJsImage volume rendering has no window/level adapter yet',
        )
      }
      if (workload.id === 'scroll-100-slices') {
        const [x, y, z] = spatialAxes(dataset)
        let last:
          | {
              readonly canvas: HTMLCanvasElement
              readonly outputBytes: number
              readonly firstDecodedAt: number
            }
          | undefined
        const zAxis = dataset.descriptor.axes.find((axis) => axis.id === z)
        const count = Math.min(100, zAxis?.length ?? 1)
        for (let index = 0; index < count; index += 1) {
          const sliced = sliceScientificVolume(dataset, {
            displayAxes: [x, y],
            fixedIndices: [{ axisId: z, index }],
          })
          last = await renderScientific(sliced, fixedIndicesFor(sliced, [x, y]))
        }
        if (last === undefined) throw new Error('Volume scroll produced no slice')
        return outputFromCanvas({
          canvas: last.canvas,
          outputBytes: last.outputBytes * count,
          startedAt,
          firstDecodedAt: last.firstDecodedAt,
        })
      }
      const selection = volumeSelection(dataset, workload.id)
      if (!supportsScientificPlaneRead(dataset.descriptor, selection.displayAxes)) {
        throw new UnsupportedViewerCase(
          `PureJsImage NIfTI viewer adapter currently supports only the axial x/y plane; ${selection.displayAxes.join('/')} is unavailable`,
        )
      }
      const sliced = sliceScientificVolume(dataset, selection)
      const rendered = await renderScientific(
        sliced,
        fixedIndicesFor(sliced, selection.displayAxes),
      )
      return outputFromCanvas({
        canvas: rendered.canvas,
        outputBytes: rendered.outputBytes,
        startedAt,
        firstDecodedAt: rendered.firstDecodedAt,
      })
    },
    close() {
      void document.close?.()
    },
  }
}

const niivueEngine = async (url: string): Promise<PreparedEngine> => {
  const canvas = newCanvas()
  const viewer = new Niivue()
  await viewer.attachToCanvas(canvas)
  await viewer.addVolumeFromUrl({ url, name: 'shared-volume.nii' })
  return {
    async run(workload) {
      const startedAt = performance.now()
      if (workload.id === 'overlay-switch') {
        throw new UnsupportedViewerCase('NiiVue overlay workload requires a second volume fixture')
      }
      if (workload.id === 'scroll-100-slices') {
        throw new UnsupportedViewerCase(
          'NiiVue slice-scroll adapter is not deterministic in this harness',
        )
      }
      if (workload.id === 'first-sagittal-slice') viewer.setSliceType(viewer.sliceTypeSagittal)
      else if (workload.id === 'first-coronal-slice') viewer.setSliceType(viewer.sliceTypeCoronal)
      else viewer.setSliceType(viewer.sliceTypeAxial)
      if (workload.id === 'window-level-change') {
        const volume = viewer.volumes[0]
        if (volume !== undefined) {
          volume.cal_min = -160
          volume.cal_max = 240
          viewer.updateGLVolume()
        }
      }
      viewer.drawScene()
      return outputFromCanvas({ canvas, outputBytes: 1, startedAt })
    },
    close() {
      viewer.cleanup()
    },
  }
}

let cornerstoneReady = false

const cornerstoneEngine = async (url: string): Promise<PreparedEngine> => {
  if (!cornerstoneReady) {
    cornerstone.init()
    niftiVolumeLoader.init()
    cornerstone.imageLoader.registerImageLoader(
      'nifti',
      niftiVolumeLoader.cornerstoneNiftiImageLoader,
    )
    cornerstoneReady = true
  }
  const imageIds = await niftiVolumeLoader.createNiftiImageIdsAndCacheMetadata({ url })
  const volumeId = `nifti:${url}`
  const volume = await cornerstone.volumeLoader.createAndCacheVolumeFromImages(volumeId, imageIds)
  const element = document.createElement('div')
  element.style.width = `${outputWidth}px`
  element.style.height = `${outputHeight}px`
  viewerMount().replaceChildren(element)
  const renderingEngine = new cornerstone.RenderingEngine(`viewer-${Date.now()}`)
  renderingEngine.enableElement({
    element,
    viewportId: 'viewer',
    type: cornerstone.Enums.ViewportType.ORTHOGRAPHIC,
    defaultOptions: { orientation: cornerstone.Enums.OrientationAxis.AXIAL },
  })
  await cornerstone.setVolumesForViewports(
    renderingEngine,
    [{ volumeId: volume.volumeId }],
    ['viewer'],
  )
  renderingEngine.render()
  return {
    async run(workload) {
      const startedAt = performance.now()
      const viewport = renderingEngine.getViewport<cornerstone.VolumeViewport>('viewer')
      if (workload.id === 'first-sagittal-slice') {
        viewport.setOrientation(cornerstone.Enums.OrientationAxis.SAGITTAL)
      } else if (workload.id === 'first-coronal-slice') {
        viewport.setOrientation(cornerstone.Enums.OrientationAxis.CORONAL)
      } else {
        viewport.setOrientation(cornerstone.Enums.OrientationAxis.AXIAL)
      }
      if (workload.id === 'window-level-change') {
        viewport.setProperties({ voiRange: { lower: -400, upper: 400 } })
      }
      if (workload.id === 'overlay-switch') {
        throw new UnsupportedViewerCase(
          'Cornerstone overlay workload requires a second volume fixture',
        )
      }
      if (workload.id === 'scroll-100-slices') {
        throw new UnsupportedViewerCase(
          'Cornerstone slice-scroll adapter is not deterministic in this harness',
        )
      }
      renderingEngine.render()
      const outputCanvas = element.querySelector('canvas')
      if (!(outputCanvas instanceof HTMLCanvasElement))
        throw new Error('Cornerstone did not create a viewport canvas')
      return outputFromCanvas({ canvas: outputCanvas, outputBytes: 1, startedAt })
    },
    close() {
      renderingEngine.destroy()
    },
  }
}

const itkVolumeEngine = async (url: string): Promise<PreparedEngine> => {
  setPipelinesBaseUrl(new URL('/itk-pipelines/', window.location.href))
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) throw new Error(`ITK-Wasm volume fetch returned ${response.status}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  const result = await readImage(new File([bytes], 'volume.nii'), { webWorker: false })
  const data = result.image.data
  if (data === null) throw new Error('ITK-Wasm returned no image data')
  const sizeX = result.image.size[0] ?? 1
  const sizeY = result.image.size[1] ?? 1
  return {
    async run(workload) {
      const startedAt = performance.now()
      if (workload.id === 'overlay-switch')
        throw new UnsupportedViewerCase('ITK-Wasm overlay requires a second image')
      if (workload.id !== 'open-volume' && workload.id !== 'first-axial-slice') {
        throw new UnsupportedViewerCase(
          `ITK-Wasm minimal renderer does not implement ${workload.id} in this lane`,
        )
      }
      const canvas = renderNumericData(data, sizeX, sizeY)
      return outputFromCanvas({
        canvas,
        outputBytes: byteLengthOf(data),
        startedAt,
        hiddenDtypeConversion: false,
      })
    },
  }
}

const pureJsTiffEngine = async (url: string, exactCogFixture = false): Promise<PreparedEngine> => {
  const opened = await openRemoteDocument('cog', tiffReader, url)
  const { document, dataset } = opened
  return {
    async run(workload) {
      const startedAt = performance.now()
      if (workload.id === 'metadata-ready-cog')
        return metadataOutput(JSON.stringify(dataset.descriptor).length, startedAt)
      if (!exactCogFixture) {
        throw new UnsupportedViewerCase(
          'The tracked COG fixture is an ordinary striped TIFF, not an exact tiled COG',
        )
      }
      const rendered = await renderScientificDataset(dataset, fixedIndicesFor(dataset, ['x', 'y']))
      return outputFromCanvas({
        canvas: rendered.canvas,
        outputBytes: rendered.outputBytes,
        startedAt,
        firstDecodedAt: rendered.firstDecodedAt,
      })
    },
    close() {
      void document.close?.()
    },
  }
}

const cogSource = (url: string): CogSource => ({
  url: new URL(url),
  fetch: async (offset, length, options) => {
    const requestedLength = length ?? 16_384
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(requestedLength) ||
      requestedLength < 1
    ) {
      throw new Error('COG source received an invalid byte request')
    }
    const end = offset + requestedLength - 1
    const response = await fetch(url, {
      headers: { range: `bytes=${offset}-${end}` },
      ...(options?.signal === undefined ? {} : { signal: options.signal }),
    })
    if (response.status !== 206)
      throw new Error(`COG source range request returned ${response.status}`)
    return response.arrayBuffer()
  },
})

const cogeotiffEngine = async (url: string): Promise<PreparedEngine> => {
  const tiff = await Tiff.create(cogSource(url), { defaultReadSize: 16_384 })
  const image = tiff.images[0]
  if (image === undefined) throw new Error('cogeotiff did not expose an image')
  await image.init()
  return {
    async run(workload) {
      const startedAt = performance.now()
      if (workload.id === 'metadata-ready-cog') {
        return metadataOutput(
          image.size.width * image.size.height,
          startedAt,
          `${image.size.width}x${image.size.height}`,
        )
      }
      if (!image.isTiled())
        throw new UnsupportedViewerCase('The fallback TIFF is striped, not a tiled COG')
      const tile = await image.getTile(0, 0)
      if (tile === null) throw new Error('cogeotiff returned an empty first tile')
      const canvas = renderNumericData(
        new Uint8Array(tile.bytes),
        image.tileSize.width,
        image.tileSize.height,
      )
      return outputFromCanvas({ canvas, outputBytes: tile.bytes.byteLength, startedAt })
    },
  }
}

const openSeadragonEngine = async (url: string): Promise<PreparedEngine> => {
  const tileEndpoint = new URL('/tiles/cog/{z}/{x}_{y}.png', window.location.href).href
  const preparedTileSource: OpenSeadragon.TileSourceOptions = {
    width: outputWidth,
    height: outputHeight,
    tileSize: 256,
    url: tileEndpoint,
  }
  void preparedTileSource
  void OpenSeadragon
  void url
  throw new UnsupportedViewerCase(
    'OpenSeadragon requires the same prepared tile endpoint; no prepared COG tile endpoint is present',
  )
}

const engineFixture = (engine: ViewerEngineMetadata): string => {
  if (engine.family === 'ome-tiff-loaders' || engine.family === 'ome-tiff-viewers')
    return 'ome-tiff'
  if (engine.family === 'volume-viewers') return 'nifti'
  return 'cog'
}

const prepareEngine = async (
  engine: ViewerEngineMetadata,
  context: ViewerRunContext,
): Promise<PreparedEngine> => {
  const url = context.dataUrl(engineFixture(engine))
  switch (engine.id) {
    case 'geotiff-direct':
      return geoTiffEngine(url)
    case 'viv-loaders-ome-tiff':
      return vivLoaderEngine(url, false, undefined)
    case 'viv-loaders-indexed-ome-tiff':
      return vivLoaderEngine(url, true, context.sidecar)
    case 'viv-full':
      return vivFullEngine(url)
    case 'purejsimage-volume':
      return pureJsVolumeEngine(url)
    case 'niivue':
      return niivueEngine(url)
    case 'cornerstone3d':
      return cornerstoneEngine(url)
    case 'itk-wasm-volume':
      return itkVolumeEngine(url)
    case 'purejsimage-cog':
      return pureJsTiffEngine(url, false)
    case 'geotiff-cog':
      return geoTiffEngine(url, true)
    case 'cogeotiff':
      return cogeotiffEngine(url)
    case 'openseadragon':
      return openSeadragonEngine(url)
  }
}

const smokeWorkloadIds: ReadonlySet<ViewerWorkloadId> = new Set([
  'metadata-ready',
  'first-native-tile',
  'selected-zct-plane',
  'fixed-multichannel-viewport',
  'channel-toggle',
  'zoom-level-transition',
  'open-volume',
  'first-axial-slice',
  'first-sagittal-slice',
  'first-coronal-slice',
  'window-level-change',
  'metadata-ready-cog',
  'first-tile-cog',
  'viewport-1024-cog',
])

const profileFamilies = (
  profile: ViewerBenchmarkProfile,
): ReadonlySet<ViewerEngineMetadata['family']> => {
  if (profile === 'ome-tiff') return new Set(['ome-tiff-loaders', 'ome-tiff-viewers'])
  if (profile === 'volumes') return new Set(['volume-viewers'])
  if (profile === 'cog') return new Set(['cog-viewers'])
  return new Set(['ome-tiff-loaders', 'ome-tiff-viewers', 'volume-viewers', 'cog-viewers'])
}

const selectedWorkloads = (profile: ViewerBenchmarkProfile): readonly ViewerWorkloadMetadata[] => {
  const families = profileFamilies(profile)
  return viewerWorkloads.filter(
    (workload) =>
      families.has(workload.family) && (profile !== 'smoke' || smokeWorkloadIds.has(workload.id)),
  )
}

const selectedEngines = (profile: ViewerBenchmarkProfile): readonly ViewerEngineMetadata[] => {
  const families = profileFamilies(profile)
  return viewerEngines.filter((engine) => families.has(engine.family))
}

const relevantWorkload = (
  engine: ViewerEngineMetadata,
  workload: ViewerWorkloadMetadata,
): boolean => {
  if (engine.family === 'ome-tiff-loaders') return workload.family === 'ome-tiff-loaders'
  if (engine.family === 'ome-tiff-viewers') return workload.family === 'ome-tiff-viewers'
  if (engine.family === 'volume-viewers') return workload.family === 'volume-viewers'
  return workload.family === 'cog-viewers'
}

const emptyRenderingMetrics = (): ViewerRenderingMetrics =>
  Object.freeze({
    frameTimesMilliseconds: Object.freeze([]),
    longTasks: 0,
    droppedOrLateFrames: 0,
    textureBytesAllocatedOrUploaded: null,
    canvasWidth: 0,
    canvasHeight: 0,
    framebufferHash: null,
  })

const sharedRasterReferenceEngines: ReadonlySet<ViewerEngineId> = new Set([
  'geotiff-direct',
  'viv-loaders-ome-tiff',
  'viv-loaders-indexed-ome-tiff',
  'purejsimage-cog',
  'geotiff-cog',
])

const measureSample = async (options: {
  readonly engine: ViewerEngineMetadata
  readonly workload: ViewerWorkloadMetadata
  readonly context: ViewerRunContext
  readonly prepared: PreparedEngine | undefined
  readonly onPrepared?: (prepared: PreparedEngine) => void
  readonly referenceHashes: Map<ViewerWorkloadId, string>
}): Promise<ViewerBenchmarkSample> => {
  await resetServer()
  const measurement = waitForMeasurement()
  let prepared = options.prepared
  let output: OperationOutput | undefined
  let status: ViewerStatus = 'supported'
  let statusReason: string | null = null
  try {
    const initializationStarted = performance.now()
    if (prepared === undefined) {
      prepared = await prepareEngine(options.engine, options.context)
      options.onPrepared?.(prepared)
    }
    const initializationMilliseconds = performance.now() - initializationStarted
    output = await prepared.run(options.workload)
    if (
      output.outputBytes < 1 ||
      (options.workload.layer !== 'loader-only' && output.canvas === null)
    ) {
      status = 'invalid-output'
      statusReason = 'The engine completed without a non-empty output for the requested workload'
    }
    const startup = startupMetrics(measurement, initializationMilliseconds)
    const logs = await requestLogs()
    const data = dataMetrics(logs, engineFixture(options.engine))
    const latency: ViewerLatencyMetrics = Object.freeze({
      metadataReadyMilliseconds: options.workload.id.startsWith('metadata')
        ? output.firstDecodedAt
        : null,
      firstDecodedTileMilliseconds:
        options.workload.id.includes('tile') || options.workload.id.includes('slice')
          ? output.firstDecodedAt
          : null,
      firstVisiblePixelsMilliseconds: output.firstVisibleAt,
      stableCompletedViewportMilliseconds: output.stableViewportAt,
      completeInteractionMilliseconds: output.completeInteractionAt,
    })
    const rendering =
      output.canvas === null
        ? emptyRenderingMetrics()
        : await renderingMetrics(output, measurement.longTaskCount())
    const outputHash = await canvasHash(output.canvas)
    const hasSharedRasterReference =
      outputHash !== null && sharedRasterReferenceEngines.has(options.engine.id)
    const referenceHash = hasSharedRasterReference
      ? (options.referenceHashes.get(options.workload.id) ?? outputHash)
      : null
    if (hasSharedRasterReference && !options.referenceHashes.has(options.workload.id)) {
      options.referenceHashes.set(options.workload.id, outputHash)
    }
    const correctness = await correctnessMetrics(output, options.workload, referenceHash, status)
    return Object.freeze({
      browser: options.context.browser,
      phase: options.context.phase,
      latencyProfileMilliseconds: options.context.latencyMilliseconds,
      engine: options.engine,
      workload: options.workload,
      status,
      statusReason,
      startup,
      data,
      latency,
      rendering,
      memory: memoryMetrics(),
      correctness,
      sidecar:
        options.engine.id !== 'viv-loaders-indexed-ome-tiff' ||
        options.context.sidecar === undefined
          ? Object.freeze({
              bytes: 0,
              indexGenerationMilliseconds: 0,
              indexGenerationOccurred: false,
              source: 'not-applicable' as const,
            })
          : Object.freeze({
              bytes: options.context.sidecar.bytes,
              indexGenerationMilliseconds: options.context.sidecar.generationMilliseconds,
              indexGenerationOccurred: true,
              source: 'generated-before-timing' as const,
            }),
    })
  } catch (cause) {
    const [failedStatus, reason] = statusForError(cause)
    status = failedStatus
    statusReason = reason
    const startup = startupMetrics(measurement, performance.now() - measurement.startedAt)
    const logs = await requestLogs().catch(() => [])
    const data = dataMetrics(logs, engineFixture(options.engine))
    return Object.freeze({
      browser: options.context.browser,
      phase: options.context.phase,
      latencyProfileMilliseconds: options.context.latencyMilliseconds,
      engine: options.engine,
      workload: options.workload,
      status,
      statusReason,
      startup,
      data,
      latency: Object.freeze({
        metadataReadyMilliseconds: null,
        firstDecodedTileMilliseconds: null,
        firstVisiblePixelsMilliseconds: null,
        stableCompletedViewportMilliseconds: null,
        completeInteractionMilliseconds: null,
      }),
      rendering: emptyRenderingMetrics(),
      memory: memoryMetrics(),
      correctness: null,
      sidecar:
        options.engine.id !== 'viv-loaders-indexed-ome-tiff' ||
        options.context.sidecar === undefined
          ? Object.freeze({
              bytes: 0,
              indexGenerationMilliseconds: 0,
              indexGenerationOccurred: false,
              source: 'not-applicable' as const,
            })
          : Object.freeze({
              bytes: options.context.sidecar.bytes,
              indexGenerationMilliseconds: options.context.sidecar.generationMilliseconds,
              indexGenerationOccurred: true,
              source: 'generated-before-timing' as const,
            }),
    })
  } finally {
    measurement.stopLongTasks()
  }
}

const runViewerBenchmark = async (
  options: ViewerBenchmarkRunOptions,
): Promise<ViewerBenchmarkReport> => {
  const profile = options.profile ?? 'smoke'
  const latencyMilliseconds: ViewerLatencyProfile =
    options.latencyProfileMilliseconds ?? defaultLatencyProfile
  const requestedCacheMode = options.cacheMode ?? defaultCacheMode
  if (
    requestedCacheMode !== 'no-store' &&
    requestedCacheMode !== 'revalidate' &&
    requestedCacheMode !== 'immutable'
  ) {
    throw new Error(`Unknown viewer cache mode ${String(requestedCacheMode)}`)
  }
  const throughputBytesPerSecond = options.throughputBytesPerSecond ?? null
  if (
    throughputBytesPerSecond !== null &&
    (!Number.isFinite(throughputBytesPerSecond) || throughputBytesPerSecond <= 0)
  ) {
    throw new Error('Viewer throughputBytesPerSecond must be positive when provided')
  }
  const engines = selectedEngines(profile)
  const workloads = selectedWorkloads(profile)
  const sidecarUrl = dataUrl(
    'ome-tiff',
    latencyMilliseconds,
    options.phase,
    requestedCacheMode,
    throughputBytesPerSecond,
  )
  const indexedEngineSelected = engines.some(
    (engine) => engine.id === 'viv-loaders-indexed-ome-tiff',
  )
  const sidecar = indexedEngineSelected ? await buildIfdSidecar(sidecarUrl) : undefined
  const context: ViewerRunContext = {
    phase: options.phase,
    browser: options.browser ?? 'chromium',
    latencyMilliseconds,
    cacheMode: requestedCacheMode,
    throughputBytesPerSecond,
    dataUrl: (fixture) =>
      dataUrl(
        fixture,
        latencyMilliseconds,
        options.phase,
        requestedCacheMode,
        throughputBytesPerSecond,
      ),
    sidecar,
  }
  const preparedEngines = new Map<ViewerEngineId, PreparedEngine>()
  const referenceHashes = new Map<ViewerWorkloadId, string>()
  const samples: ViewerBenchmarkSample[] = []
  for (const engine of engines) {
    for (const workload of workloads) {
      if (!relevantWorkload(engine, workload)) continue
      let prepared = preparedEngines.get(engine.id)
      if (options.phase === 'warm' && prepared === undefined) {
        try {
          prepared = await prepareEngine(engine, context)
          preparedEngines.set(engine.id, prepared)
        } catch {
          prepared = undefined
        }
      }
      const sample = await measureSample({
        engine,
        workload,
        context,
        prepared,
        onPrepared: (created) => preparedEngines.set(engine.id, created),
        referenceHashes,
      })
      samples.push(sample)
    }
  }
  for (const prepared of preparedEngines.values()) {
    try {
      await prepared.close?.()
    } catch (cause) {
      console.warn(`Viewer engine cleanup failed: ${errorMessage(cause)}`)
    }
  }
  return Object.freeze({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    scope: 'all' as const,
    browser: options.browser ?? 'chromium',
    userAgent: navigator.userAgent,
    phase: options.phase,
    latencyProfileMilliseconds: latencyMilliseconds,
    cacheMode: requestedCacheMode,
    throughputBytesPerSecond,
    coldDefinition:
      'A fresh Playwright browser context; each engine initializes once on its first workload, and no-store fixture responses are used.',
    warmDefinition:
      'The same browser context retains browser HTTP cache and a reusable engine instance.',
    notes: Object.freeze([
      'This lane is separate from low-level scientific-reader scores and has no universal score.',
      'Loader-only samples do not instantiate deck.gl or a complete viewer.',
      'OME-TIFF indexed samples use an IFD offset sidecar generated before timing; sidecar bytes and generation time are reported separately.',
      'The current COG endpoint is a tracked ordinary TIFF fallback, not a prepared Cloud-Optimized GeoTIFF. COG claims remain unsupported until an exact tiled COG fixture is added.',
      'NIfTI is the shared volume workload. NRRD and MetaImage endpoints are exposed for future exact-support rows and are not silently counted as equivalent.',
      `Requested latency profile: ${latencyMilliseconds} ms; server supports 0, 5, 25, and 100 ms profiles.`,
      `Cold requests force no-store; warm requests use the ${requestedCacheMode} cache profile. Throughput is ${throughputBytesPerSecond === null ? 'unlimited' : `${throughputBytesPerSecond} bytes/s`}.`,
    ]),
    engines,
    workloads,
    samples: Object.freeze(samples),
  })
}

const harness: ViewerBenchmarkHarness = Object.freeze({ run: runViewerBenchmark })

window.pureJsImageViewerBenchmark = harness

export { runViewerBenchmark }
