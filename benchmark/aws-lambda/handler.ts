import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { createImageLibrary } from '../../src/image.ts'
import { jpegCodec } from '../../src/codec-entries/jpeg.ts'
import { pngCodec } from '../../src/codec-entries/png.ts'
import { webpCodec } from '../../src/codec-entries/webp.ts'

const Image = createImageLibrary([jpegCodec, pngCodec, webpCodec])
const containerId = process.env.AWS_LAMBDA_LOG_STREAM_NAME ?? randomUUID()
const moduleLoadedAt = Date.now()
let invocationCount = 0

type WorkflowId = 'jpeg-resize-png' | 'jpeg-resize-webp' | 'png-resize-jpeg' | 'png-resize-webp'

type OutputFormat = 'jpeg' | 'png' | 'webp'

interface Workflow {
  readonly input: 'tundra-4000x3000.jpg' | 'rgba-gradient-4000x3000.png'
  readonly output: OutputFormat
}

interface MemorySnapshot {
  readonly rss: number
  readonly heapUsed: number
  readonly external: number
  readonly arrayBuffers: number
}

interface BenchmarkResult {
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
}

const workflows: Readonly<Record<WorkflowId, Workflow>> = {
  'jpeg-resize-png': { input: 'tundra-4000x3000.jpg', output: 'png' },
  'jpeg-resize-webp': { input: 'tundra-4000x3000.jpg', output: 'webp' },
  'png-resize-jpeg': { input: 'rgba-gradient-4000x3000.png', output: 'jpeg' },
  'png-resize-webp': { input: 'rgba-gradient-4000x3000.png', output: 'webp' },
}

const isWorkflowId = (value: unknown): value is WorkflowId =>
  typeof value === 'string' && value in workflows

const parseWorkflow = (event: unknown): WorkflowId => {
  if (
    typeof event !== 'object' ||
    event === null ||
    !('workflow' in event) ||
    !isWorkflowId(event.workflow)
  ) {
    throw new Error(`workflow must be one of: ${Object.keys(workflows).join(', ')}`)
  }
  return event.workflow
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

export const handler = async (event: unknown): Promise<BenchmarkResult> => {
  const handlerStart = performance.now()
  const workflowId = parseWorkflow(event)
  const workflow = workflows[workflowId]
  const coldStart = invocationCount === 0
  invocationCount += 1

  const readStart = performance.now()
  const input = await readFile(new URL(`./fixtures/${workflow.input}`, import.meta.url))
  const inputReadMs = performance.now() - readStart
  const memoryBefore = memorySnapshot()

  const operationStart = performance.now()
  const image = (await Image.open(input)).resize({ width: 1024, withoutEnlargement: true })
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
  if (outputMetadata.width !== 1024 || outputMetadata.height !== 768) {
    throw new Error(
      `Expected 1024x768 output, received ${outputMetadata.width}x${outputMetadata.height}`,
    )
  }
  const outputSha256 = createHash('sha256').update(output).digest('hex')
  const validationMs = performance.now() - validationStart
  const memoryAfter = memorySnapshot()

  return {
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
  }
}
