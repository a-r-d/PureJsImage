import type {
  BrowserBenchmarkHarness,
  BrowserBenchmarkMeasurement,
  BrowserBenchmarkModule,
  BrowserBenchmarkReport,
} from './types.ts'

interface BenchmarkDefinition {
  readonly input: string
  readonly label: string
  readonly module: string
  readonly scope: BrowserBenchmarkMeasurement['scope']
}

const definitions: readonly BenchmarkDefinition[] = [
  {
    label: 'PureJsImage JPEG decode-resize-encode',
    module: '/purejsimage-jpeg.js',
    input: '/fixtures/benchmark-input.jpg',
    scope: 'complete-pipeline',
  },
  {
    label: 'PureJsImage PNG decode-resize-encode',
    module: '/purejsimage-png.js',
    input: '/fixtures/benchmark-input.png',
    scope: 'complete-pipeline',
  },
  {
    label: 'Native JPEG createImageBitmap-resize-encode',
    module: '/native-jpeg.js',
    input: '/fixtures/benchmark-input.jpg',
    scope: 'native-complete-pipeline',
  },
  {
    label: 'Native PNG createImageBitmap-resize-encode',
    module: '/native-png.js',
    input: '/fixtures/benchmark-input.png',
    scope: 'native-complete-pipeline',
  },
  {
    label: 'jSquash JPEG decode',
    module: '/jsquash-jpeg-decode.js',
    input: '/fixtures/benchmark-input.jpg',
    scope: 'codec-only',
  },
  {
    label: 'jSquash JPEG encode',
    module: '/jsquash-jpeg-encode.js',
    input: '/fixtures/benchmark-input.png',
    scope: 'codec-only',
  },
  {
    label: 'jSquash PNG decode',
    module: '/jsquash-png-decode.js',
    input: '/fixtures/benchmark-input.png',
    scope: 'codec-only',
  },
  {
    label: 'jSquash PNG encode',
    module: '/jsquash-png-encode.js',
    input: '/fixtures/benchmark-input.png',
    scope: 'codec-only',
  },
  {
    label: 'jSquash WebP decode',
    module: '/jsquash-webp-decode.js',
    input: '/fixtures/benchmark-input.webp',
    scope: 'codec-only',
  },
  {
    label: 'jSquash WebP encode',
    module: '/jsquash-webp-encode.js',
    input: '/fixtures/benchmark-input.png',
    scope: 'codec-only',
  },
]

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isBenchmarkModule = (value: unknown): value is BrowserBenchmarkModule =>
  isRecord(value) &&
  typeof value.prepare === 'function' &&
  typeof value.run === 'function' &&
  typeof value.verify === 'function'

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((left, right) => left - right)
  const value = sorted[Math.floor(sorted.length / 2)]
  if (value === undefined) throw new Error('Cannot calculate a median without samples')
  return value
}

const resourceBytes = (): { readonly javascript: number; readonly wasm: number } => {
  let javascript = 0
  let wasm = 0
  for (const entry of performance.getEntriesByType('resource')) {
    if (!(entry instanceof PerformanceResourceTiming)) continue
    const bytes = entry.decodedBodySize
    const pathname = new URL(entry.name).pathname
    if (pathname.endsWith('.js')) javascript += bytes
    if (pathname.endsWith('.wasm')) wasm += bytes
  }
  return { javascript, wasm }
}

const fetchInput = async (path: string): Promise<ArrayBuffer> => {
  const response = await fetch(path)
  if (!response.ok) throw new Error(`Benchmark input request failed: ${response.status} ${path}`)
  return response.arrayBuffer()
}

const warmRuns = 5

const runDefinition = async (
  definition: BenchmarkDefinition,
  input: ArrayBuffer,
  sequence: number,
): Promise<BrowserBenchmarkMeasurement> => {
  performance.clearResourceTimings()
  const initializationStarted = performance.now()
  const imported: unknown = await import(`${definition.module}?run=${sequence}`)
  const moduleInitializationMilliseconds = performance.now() - initializationStarted
  if (!isBenchmarkModule(imported)) {
    throw new Error(`${definition.module} does not implement the browser benchmark contract`)
  }
  await imported.prepare(input.slice(0))

  const firstStarted = performance.now()
  let outputBytes = await imported.run()
  const firstOperationMilliseconds = performance.now() - firstStarted

  const warm: number[] = []
  for (let run = 0; run < warmRuns; run += 1) {
    const started = performance.now()
    outputBytes = await imported.run()
    warm.push(performance.now() - started)
  }
  const correctness = await imported.verify()
  await new Promise((resolve) => setTimeout(resolve, 0))
  const loaded = resourceBytes()
  return {
    label: definition.label,
    scope: definition.scope,
    moduleInitializationMilliseconds,
    firstOperationMilliseconds,
    warmMedianMilliseconds: median(warm),
    outputBytes,
    correctness,
    javascriptBytesLoaded: loaded.javascript,
    wasmBytesLoaded: loaded.wasm,
  }
}

const run = async (): Promise<BrowserBenchmarkReport> => {
  const inputs = new Map<string, ArrayBuffer>()
  for (const definition of definitions) {
    if (!inputs.has(definition.input))
      inputs.set(definition.input, await fetchInput(definition.input))
  }
  const measurements: BrowserBenchmarkMeasurement[] = []
  for (let index = 0; index < definitions.length; index += 1) {
    const definition = definitions[index]
    if (!definition) throw new Error(`Missing benchmark definition ${index}`)
    const input = inputs.get(definition.input)
    if (!input) throw new Error(`Missing benchmark input ${definition.input}`)
    measurements.push(await runDefinition(definition, input, index))
  }
  return {
    browser: navigator.userAgent,
    generatedAt: new Date().toISOString(),
    warmRuns,
    note: 'PureJsImage and native rows are complete decode-resize-encode pipelines. jSquash rows measure codec-only decode or encode and are not complete pipeline comparisons. Browser memory is intentionally not reported.',
    measurements,
  }
}

const harness: BrowserBenchmarkHarness = Object.freeze({ run })
window.pureJsImageBrowserBenchmark = harness
