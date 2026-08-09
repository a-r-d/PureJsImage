import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { jpegCodec } from '../../src/codec-entries/jpeg.ts'
import { pngCodec } from '../../src/codec-entries/png.ts'
import { webpCodec } from '../../src/codec-entries/webp.ts'
import { createImageLibrary, type ImageLibrary } from '../../src/image.ts'
import { createWasmJpegAcceleratorWithLoader } from '../../src/accelerators/wasm/jpeg.ts'

type EngineId = 'javascript' | 'wasm-jpeg'
type WorkflowId =
  | 'jpeg-resize-png'
  | 'jpeg-resize-webp'
  | 'png-resize-jpeg'
  | 'png-resize-webp'
  | 'jpeg-resize-3000-png'
  | 'jpeg-resize-3000-webp'
type OutputFormat = 'jpeg' | 'png' | 'webp'

interface Workflow {
  readonly input: 'tundra-4000x3000.jpg' | 'rgba-gradient-4000x3000.png'
  readonly output: OutputFormat
  readonly resizeWidth: 1024 | 3000
  readonly outputWidth: 1024 | 3000
  readonly outputHeight: 768 | 2250
}

interface MemorySnapshot {
  readonly rss: number
  readonly heapUsed: number
  readonly external: number
  readonly arrayBuffers: number
}

interface WasmSnapshot {
  readonly instantiations: number
  readonly moduleBytes: number
  readonly memoryBytes: number
  readonly readMs: number
  readonly instantiateMs: number
  readonly loadMs: number
}

interface WasmMeasurement extends WasmSnapshot {
  readonly loadedThisInvocation: boolean
}

interface BenchmarkResult {
  readonly engine: EngineId
  readonly workflow: WorkflowId
  readonly coldStart: boolean
  readonly containerId: string
  readonly invocation: number
  readonly moduleAgeMs: number
  readonly inputBytes: number
  readonly outputBytes: number
  readonly outputFormat: OutputFormat
  readonly outputWidth: number
  readonly outputHeight: number
  readonly outputSha256: string
  readonly inputReadMs: number
  readonly operationMs: number
  readonly validationMs: number
  readonly totalHandlerMs: number
  readonly memoryBefore: MemorySnapshot
  readonly memoryAfter: MemorySnapshot
  readonly wasm: WasmMeasurement
}

const workflows: Readonly<Record<WorkflowId, Workflow>> = {
  'jpeg-resize-png': {
    input: 'tundra-4000x3000.jpg',
    output: 'png',
    resizeWidth: 1024,
    outputWidth: 1024,
    outputHeight: 768,
  },
  'jpeg-resize-webp': {
    input: 'tundra-4000x3000.jpg',
    output: 'webp',
    resizeWidth: 1024,
    outputWidth: 1024,
    outputHeight: 768,
  },
  'png-resize-jpeg': {
    input: 'rgba-gradient-4000x3000.png',
    output: 'jpeg',
    resizeWidth: 1024,
    outputWidth: 1024,
    outputHeight: 768,
  },
  'png-resize-webp': {
    input: 'rgba-gradient-4000x3000.png',
    output: 'webp',
    resizeWidth: 1024,
    outputWidth: 1024,
    outputHeight: 768,
  },
  'jpeg-resize-3000-png': {
    input: 'tundra-4000x3000.jpg',
    output: 'png',
    resizeWidth: 3000,
    outputWidth: 3000,
    outputHeight: 2250,
  },
  'jpeg-resize-3000-webp': {
    input: 'tundra-4000x3000.jpg',
    output: 'webp',
    resizeWidth: 3000,
    outputWidth: 3000,
    outputHeight: 2250,
  },
}
const engineIds: Readonly<Record<EngineId, true>> = {
  javascript: true,
  'wasm-jpeg': true,
}

let wasmInstantiations = 0
let wasmModuleBytes = 0
let wasmReadMs = 0
let wasmInstantiateMs = 0
let wasmLoadMs = 0
let wasmMemory: WebAssembly.Memory | undefined
const wasmAccelerator = createWasmJpegAcceleratorWithLoader(
  async (): Promise<WebAssembly.Instance> => {
    const loadStart = performance.now()
    const readStart = performance.now()
    const bytes = await readFile(new URL('./jpeg-decoder.wasm', import.meta.url))
    wasmReadMs = performance.now() - readStart
    wasmModuleBytes = bytes.byteLength
    const instantiateStart = performance.now()
    const result = await WebAssembly.instantiate(bytes)
    wasmInstantiateMs = performance.now() - instantiateStart
    wasmLoadMs = performance.now() - loadStart
    const memory: unknown = result.instance.exports.memory
    if (!(memory instanceof WebAssembly.Memory)) {
      throw new Error('JPEG WASM memory export is unavailable')
    }
    wasmMemory = memory
    wasmInstantiations += 1
    return result.instance
  },
  { minimumPixels: 1 },
)
const codecs = [jpegCodec, pngCodec, webpCodec] as const
const imageLibraries: Readonly<Record<EngineId, ImageLibrary>> = {
  javascript: createImageLibrary(codecs),
  'wasm-jpeg': createImageLibrary({ codecs, accelerators: [wasmAccelerator] }),
}
const containerId = process.env.AWS_LAMBDA_LOG_STREAM_NAME ?? randomUUID()
const moduleLoadedAt = Date.now()
let invocationCount = 0

const isWorkflowId = (value: unknown): value is WorkflowId =>
  typeof value === 'string' && value in workflows

const isEngineId = (value: unknown): value is EngineId =>
  typeof value === 'string' && value in engineIds

const parseRequest = (event: unknown): { engine: EngineId; workflow: WorkflowId } => {
  if (
    typeof event !== 'object' ||
    event === null ||
    !('workflow' in event) ||
    !isWorkflowId(event.workflow)
  ) {
    throw new Error(`workflow must be one of: ${Object.keys(workflows).join(', ')}`)
  }
  const engine: unknown = 'engine' in event ? event.engine : 'javascript'
  if (!isEngineId(engine)) {
    throw new Error(`engine must be one of: ${Object.keys(engineIds).join(', ')}`)
  }
  return { engine, workflow: event.workflow }
}

const memorySnapshot = (): MemorySnapshot => {
  const usage = process.memoryUsage()
  return {
    rss: usage.rss,
    heapUsed: usage.heapUsed,
    external: usage.external,
    arrayBuffers: usage.arrayBuffers,
  }
}

const wasmSnapshot = (): WasmSnapshot => ({
  instantiations: wasmInstantiations,
  moduleBytes: wasmModuleBytes,
  memoryBytes: wasmMemory?.buffer.byteLength ?? 0,
  readMs: wasmReadMs,
  instantiateMs: wasmInstantiateMs,
  loadMs: wasmLoadMs,
})

const fixtureBucket = process.env.BENCHMARK_FIXTURE_BUCKET
const localFixtureDirectory = process.env.BENCHMARK_FIXTURE_DIRECTORY
const fixtureClient = fixtureBucket ? new S3Client({}) : undefined

const readFixture = async (file: Workflow['input']): Promise<Uint8Array> => {
  if (fixtureBucket && fixtureClient) {
    const response = await fixtureClient.send(
      new GetObjectCommand({ Bucket: fixtureBucket, Key: `fixtures/${file}` }),
    )
    if (!response.Body) throw new Error(`S3 fixture has no response body: ${file}`)
    return response.Body.transformToByteArray()
  }
  if (!localFixtureDirectory) {
    throw new Error('BENCHMARK_FIXTURE_BUCKET or BENCHMARK_FIXTURE_DIRECTORY is required')
  }
  return readFile(`${localFixtureDirectory}/${file}`)
}

export const handler = async (event: unknown): Promise<BenchmarkResult> => {
  const handlerStart = performance.now()
  const { engine, workflow: workflowId } = parseRequest(event)
  const Image = imageLibraries[engine]
  const workflow = workflows[workflowId]
  const coldStart = invocationCount === 0
  invocationCount += 1

  const readStart = performance.now()
  const input = await readFixture(workflow.input)
  const inputReadMs = performance.now() - readStart
  const memoryBefore = memorySnapshot()
  const wasmBefore = wasmSnapshot()

  const operationStart = performance.now()
  const image = (await Image.open(input)).resize({
    width: workflow.resizeWidth,
    withoutEnlargement: true,
  })
  let output: Uint8Array
  switch (workflow.output) {
    case 'jpeg':
      output = await image.encode('jpeg', { quality: 80, background: '#ffffff' }).toBuffer()
      break
    case 'png':
      output = await image.encode('png', { compressionLevel: 6 }).toBuffer()
      break
    case 'webp':
      output = await image.encode('webp', { quality: 80 }).toBuffer()
      break
  }
  const operationMs = performance.now() - operationStart

  const validationStart = performance.now()
  const outputMetadata = await (await Image.open(output)).metadata()
  if (outputMetadata.format !== workflow.output) {
    throw new Error(`Expected ${workflow.output} output, received ${outputMetadata.format}`)
  }
  if (
    outputMetadata.width !== workflow.outputWidth ||
    outputMetadata.height !== workflow.outputHeight
  ) {
    throw new Error(
      `Expected ${workflow.outputWidth}x${workflow.outputHeight} output, received ${outputMetadata.width}x${outputMetadata.height}`,
    )
  }
  const outputSha256 = createHash('sha256').update(output).digest('hex')
  const validationMs = performance.now() - validationStart
  const memoryAfter = memorySnapshot()
  const wasmAfter = wasmSnapshot()

  return {
    engine,
    workflow: workflowId,
    coldStart,
    containerId,
    invocation: invocationCount,
    moduleAgeMs: Date.now() - moduleLoadedAt,
    inputBytes: input.byteLength,
    outputBytes: output.byteLength,
    outputFormat: workflow.output,
    outputWidth: outputMetadata.width,
    outputHeight: outputMetadata.height,
    outputSha256,
    inputReadMs,
    operationMs,
    validationMs,
    totalHandlerMs: performance.now() - handlerStart,
    memoryBefore,
    memoryAfter,
    wasm: {
      ...wasmAfter,
      loadedThisInvocation: wasmAfter.instantiations > wasmBefore.instantiations,
    },
  }
}
