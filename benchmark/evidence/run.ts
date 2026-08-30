import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import {
  createEvidenceSession,
  instrumentImageSource,
  type EvidenceContext,
  type EvidenceMode,
} from '../../src/evidence.ts'
import { createImageLibrary } from '../../src/index.ts'
import { allCodecs } from '../../src/codec-entries/all.ts'
import {
  MemorySource,
  stableSourceBuffers,
  type ImageSource,
  type ImageSourceReadOptions,
} from '../../src/source.ts'
import { imageSourceIdentity } from '../../src/source-identity.ts'
import { HttpRangeSource } from '../../src/sources/http-range.ts'
import { encodeGsf } from '../../src/scientific/formats/gsf.ts'
import { gsfReader } from '../../src/scientific/readers/gsf.ts'
import { omeZarrReader } from '../../src/scientific/readers/ome-zarr.ts'
import { createOmeZarrHttpContext } from '../../src/scientific/ome-zarr-http.ts'
import { renderScientificPlane } from '../../src/scientific/public.ts'
import { ScientificReaderRegistry } from '../../src/scientific/reader.ts'
import { executeGraph, planGraph, type AnalysisGraph } from '../../src/analysis/index.ts'
import {
  createOperationDefinition,
  createOperationProvider,
  createOperationRegistry,
  createValueTypeDefinition,
  createValueTypeRegistry,
} from '../../src/operations/index.ts'

type BenchmarkMode = 'off' | EvidenceMode

interface WorkflowExecution {
  readonly outputHash: string
  readonly outputBytes: number
  readonly sourceReads: number
  readonly firstMeaningfulMilliseconds: number
}

interface WorkflowModeResult extends WorkflowExecution {
  readonly mode: BenchmarkMode
  readonly wallMilliseconds: number
  readonly eventCount: number
  readonly serializedReportBytes: number
  readonly retainedTraceBytes: number
  readonly droppedEvents: number
  readonly peakManagedBytes: number
  readonly retainedCacheBytes: number
  readonly rssBytes: number
  readonly externalBytes: number
  readonly arrayBufferBytes: number
  readonly wallSamplesMilliseconds: readonly number[]
  readonly firstMeaningfulSamplesMilliseconds: readonly number[]
}

interface WorkflowResult {
  readonly workload: string
  readonly modes: readonly WorkflowModeResult[]
}

class CountingMemorySource implements ImageSource {
  readonly [stableSourceBuffers] = true
  readonly #source: MemorySource
  reads = 0

  constructor(bytes: Uint8Array) {
    this.#source = new MemorySource(bytes)
  }

  get size(): number {
    return this.#source.size
  }

  [imageSourceIdentity]() {
    return this.#source[imageSourceIdentity]()
  }

  async read(
    offset: number,
    length: number,
    options: Readonly<ImageSourceReadOptions> = {},
  ): Promise<Uint8Array> {
    this.reads += 1
    return this.#source.read(offset, length, options)
  }
}

const images = createImageLibrary(allCodecs)
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

const runRaster = async (
  bytes: Uint8Array,
  evidence: EvidenceContext | undefined,
  operation: 'jpeg-resize' | 'png-resize' | 'tiff-viewport',
  started: number,
): Promise<WorkflowExecution> => {
  const raw = new CountingMemorySource(bytes)
  const source =
    evidence === undefined ? raw : instrumentImageSource(raw, evidence.child(operation))
  const image = await images.open(source)
  let output: Uint8Array
  if (operation === 'jpeg-resize') {
    output = await image
      .resize({ width: 480 })
      .jpeg({ quality: 80 })
      .toBuffer(evidence === undefined ? {} : { evidence })
  } else if (operation === 'png-resize') {
    output = await image
      .resize({ width: 320 })
      .png()
      .toBuffer(evidence === undefined ? {} : { evidence })
  } else {
    const metadata = await image.metadata()
    output = await image
      .crop({
        x: 0,
        y: 0,
        width: Math.min(metadata.width, 128),
        height: Math.min(metadata.height, 128),
      })
      .png()
      .toBuffer(evidence === undefined ? {} : { evidence })
  }
  return {
    outputHash: sha256(output),
    outputBytes: output.byteLength,
    sourceReads: raw.reads,
    firstMeaningfulMilliseconds: performance.now() - started,
  }
}

const scientificValues = Float32Array.from(
  { length: 128 * 96 },
  (_, index) => Math.sin(index / 23) * 10 + (index % 128) / 8,
)
const scientificFixture = encodeGsf({ width: 128, height: 96, values: scientificValues })

const runScientificPlane = async (
  evidence: EvidenceContext | undefined,
  started: number,
): Promise<WorkflowExecution> => {
  const raw = new CountingMemorySource(scientificFixture)
  const source =
    evidence === undefined ? raw : instrumentImageSource(raw, evidence.child('gsf-source'))
  const registry = new ScientificReaderRegistry([gsfReader])
  const document = await registry.open({
    primary: { id: 'surface.gsf', name: 'surface.gsf', source },
    readerId: gsfReader.descriptor.id,
    ...(evidence === undefined ? {} : { evidence }),
  })
  const dataset = await document.openDataset(document.datasets[0]?.id ?? 'surface')
  const rendered = await renderScientificPlane(dataset, {
    plane: { displayAxes: ['x', 'y'], fixedIndices: [] },
    range: { mode: 'dataset' },
    ...(evidence === undefined ? {} : { evidence }),
  })
  const hash = createHash('sha256')
  let outputBytes = 0
  let firstMeaningfulMilliseconds = 0
  for await (const block of rendered.pixels) {
    if (firstMeaningfulMilliseconds === 0) firstMeaningfulMilliseconds = performance.now() - started
    hash.update(block.data)
    outputBytes += block.data.byteLength
    block.release?.()
  }
  await document.close?.()
  return {
    outputHash: hash.digest('hex'),
    outputBytes,
    sourceReads: raw.reads,
    firstMeaningfulMilliseconds,
  }
}

const jsonBytes = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value))
const omeFiles: Readonly<Record<string, Uint8Array>> = Object.freeze({
  'zarr.json': jsonBytes({
    zarr_format: 3,
    node_type: 'group',
    attributes: {
      ome: {
        version: '0.5',
        multiscales: [
          {
            name: 'evidence-benchmark',
            axes: [
              { name: 'y', type: 'space' },
              { name: 'x', type: 'space' },
            ],
            datasets: [
              { path: '0', coordinateTransformations: [{ type: 'scale', scale: [1, 1] }] },
            ],
          },
        ],
      },
    },
  }),
  '0/zarr.json': jsonBytes({
    zarr_format: 3,
    node_type: 'array',
    shape: [64, 64],
    data_type: 'uint8',
    chunk_grid: { name: 'regular', configuration: { chunk_shape: [32, 32] } },
    chunk_key_encoding: { name: 'default', configuration: { separator: '/' } },
    fill_value: 0,
    codecs: [{ name: 'bytes', configuration: { endian: 'little' } }],
    dimension_names: ['y', 'x'],
    attributes: {},
  }),
  '0/c/0/0': Uint8Array.from({ length: 32 * 32 }, (_, index) => index & 0xff),
  '0/c/0/1': Uint8Array.from({ length: 32 * 32 }, (_, index) => (index * 3) & 0xff),
  '0/c/1/0': Uint8Array.from({ length: 32 * 32 }, (_, index) => (index * 5) & 0xff),
  '0/c/1/1': Uint8Array.from({ length: 32 * 32 }, (_, index) => (index * 7) & 0xff),
})

const omeFetch =
  (requests: { value: number }): typeof fetch =>
  async (input, init) => {
    requests.value += 1
    const url = new URL(String(input))
    const marker = '/sample.zarr/'
    const markerIndex = url.pathname.indexOf(marker)
    const name =
      markerIndex < 0 ? '' : decodeURIComponent(url.pathname.slice(markerIndex + marker.length))
    const bytes = omeFiles[name]
    if (bytes === undefined) return new Response(null, { status: 404 })
    if (init?.method === 'HEAD') {
      return new Response(null, {
        status: 200,
        headers: { 'content-length': String(bytes.byteLength) },
      })
    }
    const match = /^bytes=(\d+)-(\d+)$/u.exec(new Headers(init?.headers).get('range') ?? '')
    if (match === null) throw new Error('OME-Zarr benchmark request omitted Range')
    const start = Number(match[1])
    const end = Math.min(Number(match[2]), bytes.byteLength - 1)
    return new Response(bytes.slice(start, end + 1), {
      status: 206,
      headers: {
        'content-length': String(end - start + 1),
        'content-range': `bytes ${start}-${end}/${bytes.byteLength}`,
        etag: `"${name}-v1"`,
      },
    })
  }

const runOmeZarr = async (
  evidence: EvidenceContext | undefined,
  started: number,
): Promise<WorkflowExecution> => {
  const requests = { value: 0 }
  const context = await createOmeZarrHttpContext('https://evidence.test/sample.zarr/', {
    fetch: omeFetch(requests),
    blockBytes: 256,
    maxCacheBytesPerSource: 1_024,
    ...(evidence === undefined ? {} : { evidence }),
  })
  try {
    const document = await new ScientificReaderRegistry([omeZarrReader]).open(context)
    const dataset = await document.openDataset(document.datasets[0]?.id ?? '')
    const hash = createHash('sha256')
    let outputBytes = 0
    let firstMeaningfulMilliseconds = 0
    for await (const block of dataset.readPlane({
      displayAxes: ['x', 'y'],
      fixedIndices: [],
      x: 8,
      y: 8,
      width: 40,
      height: 40,
    })) {
      if (firstMeaningfulMilliseconds === 0)
        firstMeaningfulMilliseconds = performance.now() - started
      hash.update(block.data)
      outputBytes += block.data.byteLength
      block.release?.()
    }
    await document.close?.()
    return {
      outputHash: hash.digest('hex'),
      outputBytes,
      sourceReads: context.store.stats().rangeRequests,
      firstMeaningfulMilliseconds,
    }
  } finally {
    context.store.close()
  }
}

const numberType = createValueTypeDefinition({
  descriptor: { id: 'evidence.value.number', version: 1, title: 'Number' },
})
const multiply = createOperationDefinition({
  descriptor: {
    id: 'evidence.number.multiply',
    version: 1,
    title: 'Multiply',
    category: 'analysis',
    tags: [],
    inputs: [{ name: 'value', valueType: { id: 'evidence.value.number', version: 1 } }],
    outputs: [{ name: 'result', valueType: { id: 'evidence.value.number', version: 1 } }],
    parameters: {
      type: 'object',
      properties: { factor: { type: 'number', default: 2, finiteOnly: true } },
      closed: true,
    },
    execution: 'tile-local',
    reproducibility: { class: 'bit-exact' },
  },
  inferOutputShapes: () => ({
    valid: true,
    issues: Object.freeze([]),
    value: Object.freeze([Object.freeze({ kind: 'scalar' })]),
  }),
})
const analysisGraph: AnalysisGraph = {
  schemaVersion: 1,
  inputs: [{ name: 'source', valueType: { id: numberType.descriptor.id, version: 1 } }],
  nodes: [
    {
      id: 'multiply',
      operation: { id: multiply.descriptor.id, version: 1 },
      inputs: [{ port: 'value', source: { kind: 'input', input: 'source' } }],
      parameters: { factor: 6 },
    },
  ],
  outputs: [{ name: 'answer', source: { kind: 'node', nodeId: 'multiply', output: 'result' } }],
}
const analysisProvider = createOperationProvider({
  descriptor: {
    id: 'evidence.reference',
    version: 1,
    kind: 'reference',
    buildFingerprint: 'evidence-reference-build-1',
  },
  prepare: async () => [
    {
      descriptor: {
        operationId: multiply.descriptor.id,
        operationVersion: 1,
        implementationVersion: '1.0.0',
        bitExactConformance: true,
      },
      supportsPlan: () => true,
      estimatePlan: () => ({
        setupMilliseconds: 0,
        transferMilliseconds: 0,
        computeMilliseconds: 0,
        readbackMilliseconds: 0,
        retainedBytes: 8,
        peakWorkingBytes: 8,
        transferBytes: 0,
        outputBytes: 8,
        confidence: 1,
      }),
      async execute(request) {
        const value = request.inputs[0]
        const parameters = request.parameters
        const factor =
          parameters !== null && typeof parameters === 'object' && 'factor' in parameters
            ? parameters.factor
            : undefined
        if (typeof value !== 'number' || typeof factor !== 'number')
          throw new Error('Invalid evidence benchmark analysis input')
        return Object.freeze([Object.freeze({ value: value * factor, release(): void {} })])
      },
    },
  ],
})

const runAnalysis = async (
  evidence: EvidenceContext | undefined,
  started: number,
): Promise<WorkflowExecution> => {
  const plan = await planGraph({
    graph: analysisGraph,
    operations: createOperationRegistry([multiply]),
    valueTypes: createValueTypeRegistry([numberType]),
    providers: [analysisProvider],
    bindings: { source: { value: 7, characteristics: { kind: 'scalar' } } },
  })
  try {
    const result = await executeGraph({
      plan,
      library: { version: '0.17.0', buildFingerprint: 'execution-evidence-benchmark' },
      ...(evidence === undefined ? {} : { evidence }),
    }).result
    const output = new TextEncoder().encode(String(result.outputs.get('answer')))
    const firstMeaningfulMilliseconds = performance.now() - started
    await result.release()
    return {
      outputHash: sha256(output),
      outputBytes: output.byteLength,
      sourceReads: 0,
      firstMeaningfulMilliseconds,
    }
  } finally {
    await plan.dispose()
  }
}

type WorkflowRunner = (
  evidence: EvidenceContext | undefined,
  started: number,
) => Promise<WorkflowExecution>

const runWorkflowMode = async (
  mode: BenchmarkMode,
  runner: WorkflowRunner,
): Promise<WorkflowModeResult> => {
  const session = mode === 'off' ? undefined : createEvidenceSession({ mode })
  const started = performance.now()
  const execution = await runner(session?.context, started)
  const wallMilliseconds = performance.now() - started
  const report = session?.finalize()
  const memory = process.memoryUsage()
  return {
    mode,
    wallMilliseconds,
    ...execution,
    eventCount: report?.events?.length ?? 0,
    serializedReportBytes: report === undefined ? 0 : JSON.stringify(report).length,
    retainedTraceBytes: report?.collection.retainedEventBytes ?? 0,
    droppedEvents: report?.session.droppedEvents ?? 0,
    peakManagedBytes: report?.managedMemory.peakLiveBytes ?? 0,
    retainedCacheBytes: report?.managedMemory.retainedCacheBytes ?? 0,
    rssBytes: memory.rss,
    externalBytes: memory.external,
    arrayBufferBytes: memory.arrayBuffers,
    wallSamplesMilliseconds: Object.freeze([wallMilliseconds]),
    firstMeaningfulSamplesMilliseconds: Object.freeze([execution.firstMeaningfulMilliseconds]),
  }
}

const measureWorkflowMode = async (
  mode: BenchmarkMode,
  runner: WorkflowRunner,
): Promise<WorkflowModeResult> => {
  await runWorkflowMode(mode, runner)
  const trials: WorkflowModeResult[] = []
  for (let index = 0; index < 3; index += 1) trials.push(await runWorkflowMode(mode, runner))
  if (new Set(trials.map((trial) => trial.outputHash)).size !== 1)
    throw new Error(`${mode} evidence trials changed output bytes`)
  if (new Set(trials.map((trial) => trial.sourceReads)).size !== 1)
    throw new Error(`${mode} evidence trials changed source reads`)
  const selected = [...trials].sort(
    (left, right) => left.wallMilliseconds - right.wallMilliseconds,
  )[1]
  if (selected === undefined) throw new Error('Evidence benchmark median trial is unavailable')
  return Object.freeze({
    ...selected,
    wallSamplesMilliseconds: Object.freeze(trials.map((trial) => trial.wallMilliseconds)),
    firstMeaningfulSamplesMilliseconds: Object.freeze(
      trials.map((trial) => trial.firstMeaningfulMilliseconds),
    ),
  })
}

const jpegFixture = new Uint8Array(await readFile('benchmark/corpus/files/earthrise-2400x2400.jpg'))
const pngFixture = new Uint8Array(
  await readFile('benchmark/corpus/files/transparent-logo-1200x480.png'),
)
const tiffFixture = new Uint8Array(
  await readFile('tests/fixtures/cog/classic-deflate-rgb-nodata.tif'),
)
const workflows: readonly [string, WorkflowRunner][] = [
  ['jpeg-resize', (evidence, started) => runRaster(jpegFixture, evidence, 'jpeg-resize', started)],
  ['png-resize', (evidence, started) => runRaster(pngFixture, evidence, 'png-resize', started)],
  [
    'tiff-cog-viewport',
    (evidence, started) => runRaster(tiffFixture, evidence, 'tiff-viewport', started),
  ],
  ['ome-zarr-viewport', runOmeZarr],
  ['scientific-plane-render', runScientificPlane],
  ['analysis-graph-execution', runAnalysis],
]

const workflowResults: WorkflowResult[] = []
for (const [workload, runner] of workflows) {
  const modes: WorkflowModeResult[] = []
  for (const mode of ['off', 'summary', 'trace'] as const)
    modes.push(await measureWorkflowMode(mode, runner))
  if (new Set(modes.map((result) => result.outputHash)).size !== 1)
    throw new Error(`${workload} evidence modes changed output bytes`)
  if (new Set(modes.map((result) => result.outputBytes)).size !== 1)
    throw new Error(`${workload} evidence modes changed output size`)
  if (new Set(modes.map((result) => result.sourceReads)).size !== 1)
    throw new Error(`${workload} evidence modes changed source reads`)
  workflowResults.push(Object.freeze({ workload, modes: Object.freeze(modes) }))
}

interface RangeResult {
  readonly workload: string
  readonly policy: 'fixed' | 'adaptive'
  readonly wallMilliseconds: number
  readonly requests: number
  readonly logicalBytes: number
  readonly uniqueLogicalBytes: number
  readonly transferBytes: number
  readonly uniqueBytes: number
  readonly overfetchBytes: number
  readonly cacheHits: number
  readonly coalescedConsumers: number
  readonly abortedConsumers: number
  readonly firstPixelMilliseconds: number
  readonly viewportMilliseconds: number
  readonly outputHash: string
}

const rangeFixture = Uint8Array.from({ length: 1_048_576 }, (_, index) => (index * 31) & 0xff)
const delay = async (milliseconds: number): Promise<void> => {
  if (milliseconds <= 0) return
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}

const runRange = async (
  workload: string,
  policy: 'fixed' | 'adaptive',
  ranges: readonly { readonly offset: number; readonly length: number }[],
  latencyMilliseconds: number,
  bytesPerMillisecond: number,
  concurrent: boolean,
): Promise<RangeResult> => {
  const fetcher: typeof fetch = async (_input, init) => {
    const match = /^bytes=(\d+)-(\d+)$/u.exec(new Headers(init?.headers).get('range') ?? '')
    if (match === null) throw new Error('Range benchmark request omitted Range')
    const start = Number(match[1])
    const end = Number(match[2])
    const responseBytes = end - start + 1
    await delay(latencyMilliseconds + responseBytes / bytesPerMillisecond)
    return new Response(rangeFixture.slice(start, end + 1), {
      status: 206,
      headers: {
        'content-length': String(responseBytes),
        'content-range': `bytes ${start}-${end}/${rangeFixture.length}`,
        etag: '"evidence-fixture"',
      },
    })
  }
  const session = createEvidenceSession({ mode: 'summary' })
  const source = await HttpRangeSource.open(`https://example.test/${workload}`, {
    blockBytes: 16_384,
    maxCacheBytes: 131_072,
    fetch: fetcher,
    evidence: session.context,
    rangePolicy:
      policy === 'fixed' ? { kind: 'fixed' } : { kind: 'adaptive', maxBlockBytes: 65_536 },
  })
  const instrumented = instrumentImageSource(source, session.context)
  const started = performance.now()
  let firstPixelMilliseconds = 0
  const read = async (range: { readonly offset: number; readonly length: number }) => {
    const bytes = await instrumented.read(range.offset, range.length)
    if (firstPixelMilliseconds === 0) firstPixelMilliseconds = performance.now() - started
    return bytes
  }
  const outputs = concurrent
    ? await Promise.all(ranges.map((range) => read(range)))
    : await (async () => {
        const values: Uint8Array[] = []
        for (const range of ranges) values.push(await read(range))
        return values
      })()
  const viewportMilliseconds = performance.now() - started
  const hash = createHash('sha256')
  for (const output of outputs) hash.update(output)
  source.clearCache()
  const report = session.finalize()
  return {
    workload,
    policy,
    wallMilliseconds: viewportMilliseconds,
    requests: report.physicalTransfers.requestCount,
    logicalBytes: report.logicalReads.requestedBytes,
    uniqueLogicalBytes: report.logicalReads.uniqueBytes,
    transferBytes: report.physicalTransfers.transferBytes,
    uniqueBytes: report.physicalTransfers.uniqueBytes,
    overfetchBytes: report.physicalTransfers.overfetchBytes,
    cacheHits: report.physicalTransfers.cacheHits,
    coalescedConsumers: report.physicalTransfers.coalescedConsumers,
    abortedConsumers: report.physicalTransfers.abortedConsumers,
    firstPixelMilliseconds,
    viewportMilliseconds,
    outputHash: hash.digest('hex'),
  }
}

const sequentialMetadata = Array.from({ length: 12 }, (_, index) => ({
  offset: index * 4_096,
  length: 512,
}))
const sequential = Array.from({ length: 12 }, (_, index) => ({
  offset: index * 8_192,
  length: 8_192,
}))
const overlapping = Array.from({ length: 12 }, (_, index) => ({
  offset: index * 4_096,
  length: 12_288,
}))
const sparse = [0, 17, 41, 63, 5, 52].map((block) => ({
  offset: block * 16_384,
  length: 1_024,
}))
const viewportTiles = [0, 1, 8, 9, 16, 17, 24, 25].map((block) => ({
  offset: block * 16_384,
  length: 16_384,
}))
const rangeWorkloads = [
  ['low-latency-high-throughput', sequential, 0, 1_000_000, false],
  ['high-latency-high-throughput', sequential, 8, 1_000_000, false],
  ['high-latency-low-throughput', sequential, 8, 2_048, false],
  ['overlapping-concurrent-reads', overlapping, 6, 64_000, true],
  ['sparse-random-reads', sparse, 6, 8_192, false],
  ['sequential-metadata-reads', sequentialMetadata, 4, 64_000, false],
  ['viewport-tile-reads', viewportTiles, 6, 16_384, true],
] as const

const rangeResults: RangeResult[] = []
for (const [workload, ranges, latency, throughput, concurrent] of rangeWorkloads) {
  const fixed = await runRange(workload, 'fixed', ranges, latency, throughput, concurrent)
  const adaptive = await runRange(workload, 'adaptive', ranges, latency, throughput, concurrent)
  if (fixed.outputHash !== adaptive.outputHash)
    throw new Error(`${workload} policy output mismatch`)
  rangeResults.push(fixed, adaptive)
}

const result = Object.freeze({
  schemaVersion: 2,
  workflowResults: Object.freeze(workflowResults),
  rangeResults: Object.freeze(rangeResults),
})
await mkdir('benchmark/results', { recursive: true })
await writeFile('benchmark/results/execution-evidence.json', `${JSON.stringify(result, null, 2)}\n`)
console.log(JSON.stringify(result, null, 2))
