import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  GetFunctionConfigurationCommand,
  InvokeCommand,
  LambdaClient,
  LogType,
  UpdateFunctionConfigurationCommand,
  waitUntilFunctionUpdatedV2,
} from '@aws-sdk/client-lambda'
import packageJson from '../../package.json' with { type: 'json' }

const workflowIds = [
  'jpeg-resize-png',
  'jpeg-resize-webp',
  'png-resize-jpeg',
  'png-resize-webp',
] as const
const memorySizes = [256, 512, 1024] as const

type WorkflowId = (typeof workflowIds)[number]
type Phase = 'cold' | 'warm'

interface MemorySnapshot {
  readonly rss: number
  readonly heapUsed: number
  readonly external: number
  readonly arrayBuffers: number
}

interface HandlerResult {
  readonly workflow: WorkflowId
  readonly coldStart: boolean
  readonly containerId: string
  readonly invocation: number
  readonly moduleAgeMs: number
  readonly inputBytes: number
  readonly outputBytes: number
  readonly outputFormat: string
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

interface AwsReport {
  readonly durationMs: number
  readonly billedDurationMs: number
  readonly memorySizeMb: number
  readonly maxMemoryUsedMb: number
  readonly initDurationMs: number | null
}

interface Sample {
  readonly memorySizeMb: number
  readonly workflow: WorkflowId
  readonly repetition: number
  readonly phase: Phase
  readonly handler: HandlerResult
  readonly report: AwsReport
}

interface InvocationMeasurement {
  readonly handler: HandlerResult
  readonly report: AwsReport
}

const workflowLookup: Readonly<Record<WorkflowId, true>> = {
  'jpeg-resize-png': true,
  'jpeg-resize-webp': true,
  'png-resize-jpeg': true,
  'png-resize-webp': true,
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const isMemorySnapshot = (value: unknown): value is MemorySnapshot => {
  return (
    typeof value === 'object' &&
    value !== null &&
    'rss' in value &&
    isFiniteNumber(value.rss) &&
    'heapUsed' in value &&
    isFiniteNumber(value.heapUsed) &&
    'external' in value &&
    isFiniteNumber(value.external) &&
    'arrayBuffers' in value &&
    isFiniteNumber(value.arrayBuffers)
  )
}

const isWorkflowId = (value: unknown): value is WorkflowId =>
  typeof value === 'string' && value in workflowLookup

const isHandlerResult = (value: unknown): value is HandlerResult => {
  return (
    typeof value === 'object' &&
    value !== null &&
    'workflow' in value &&
    isWorkflowId(value.workflow) &&
    'coldStart' in value &&
    typeof value.coldStart === 'boolean' &&
    'containerId' in value &&
    typeof value.containerId === 'string' &&
    'invocation' in value &&
    isFiniteNumber(value.invocation) &&
    'moduleAgeMs' in value &&
    isFiniteNumber(value.moduleAgeMs) &&
    'inputBytes' in value &&
    isFiniteNumber(value.inputBytes) &&
    'outputBytes' in value &&
    isFiniteNumber(value.outputBytes) &&
    'outputFormat' in value &&
    typeof value.outputFormat === 'string' &&
    'outputWidth' in value &&
    isFiniteNumber(value.outputWidth) &&
    'outputHeight' in value &&
    isFiniteNumber(value.outputHeight) &&
    'outputSha256' in value &&
    typeof value.outputSha256 === 'string' &&
    'inputReadMs' in value &&
    isFiniteNumber(value.inputReadMs) &&
    'operationMs' in value &&
    isFiniteNumber(value.operationMs) &&
    'validationMs' in value &&
    isFiniteNumber(value.validationMs) &&
    'totalHandlerMs' in value &&
    isFiniteNumber(value.totalHandlerMs) &&
    'memoryBefore' in value &&
    isMemorySnapshot(value.memoryBefore) &&
    'memoryAfter' in value &&
    isMemorySnapshot(value.memoryAfter)
  )
}

const parseHandlerResult = (value: unknown): HandlerResult => {
  if (!isHandlerResult(value)) throw new Error('Lambda response has an invalid result shape')
  return value
}

const parseAwsReport = (logResult: string | undefined): AwsReport => {
  if (!logResult) throw new Error('Lambda invocation did not return a log tail')
  const log = Buffer.from(logResult, 'base64').toString('utf8')
  const report = log.match(
    /REPORT[^\n]*Duration:\s*([\d.]+)\s*ms\s*Billed Duration:\s*(\d+)\s*ms\s*Memory Size:\s*(\d+)\s*MB\s*Max Memory Used:\s*(\d+)\s*MB(?:\s*Init Duration:\s*([\d.]+)\s*ms)?/,
  )
  if (!report) throw new Error(`Unable to parse Lambda REPORT line:\n${log}`)
  return {
    durationMs: Number(report[1]),
    billedDurationMs: Number(report[2]),
    memorySizeMb: Number(report[3]),
    maxMemoryUsedMb: Number(report[4]),
    initDurationMs: report[5] === undefined ? null : Number(report[5]),
  }
}

const invoke = async (
  client: LambdaClient,
  functionName: string,
  workflow: WorkflowId,
): Promise<InvocationMeasurement> => {
  const response = await client.send(
    new InvokeCommand({
      FunctionName: functionName,
      InvocationType: 'RequestResponse',
      LogType: LogType.Tail,
      Payload: new TextEncoder().encode(JSON.stringify({ workflow })),
    }),
  )
  const payloadText = new TextDecoder().decode(response.Payload)
  if (response.FunctionError) {
    throw new Error(`Lambda ${functionName} failed (${response.FunctionError}): ${payloadText}`)
  }
  let payload: unknown
  try {
    payload = JSON.parse(payloadText)
  } catch (error: unknown) {
    throw new Error(`Lambda ${functionName} returned invalid JSON: ${payloadText}`, {
      cause: error,
    })
  }
  return {
    handler: parseHandlerResult(payload),
    report: parseAwsReport(response.LogResult),
  }
}

const resetExecutionEnvironment = async (
  client: LambdaClient,
  functionName: string,
): Promise<void> => {
  const configuration = await client.send(
    new GetFunctionConfigurationCommand({ FunctionName: functionName }),
  )
  await client.send(
    new UpdateFunctionConfigurationCommand({
      FunctionName: functionName,
      Environment: {
        Variables: {
          ...configuration.Environment?.Variables,
          BENCHMARK_RUN_NONCE: randomUUID(),
        },
      },
    }),
  )
  const waiter = await waitUntilFunctionUpdatedV2(
    { client, maxWaitTime: 120, minDelay: 1, maxDelay: 5 },
    { FunctionName: functionName },
  )
  if (waiter.state !== 'SUCCESS') {
    throw new Error(`Lambda configuration update failed for ${functionName}: ${waiter.state}`)
  }
}

const argumentValue = (name: string): string | undefined => {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

const positiveIntegerArgument = (name: string, fallback: number): number => {
  const value = argumentValue(name)
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return parsed
}

const region = argumentValue('--region') ?? process.env.AWS_REGION ?? 'us-east-1'
const repeats = positiveIntegerArgument('--repeats', 3)
const date = new Date().toISOString().slice(0, 10)
const outputPrefix = argumentValue('--output') ?? `benchmark/results/aws-lambda-${date}`
const client = new LambdaClient({ region })
const samples: Sample[] = []

for (const memorySizeMb of memorySizes) {
  const functionName = `purejsimage-lambda-bench-${memorySizeMb}`
  for (const workflow of workflowIds) {
    for (let repetition = 1; repetition <= repeats; repetition += 1) {
      console.log(`${memorySizeMb} MiB ${workflow} repetition ${repetition}/${repeats}: resetting`)
      await resetExecutionEnvironment(client, functionName)
      const cold = await invoke(client, functionName, workflow)
      if (!cold.handler.coldStart || cold.report.initDurationMs === null) {
        throw new Error(`${functionName} did not produce a verified cold start for ${workflow}`)
      }
      samples.push({ memorySizeMb, workflow, repetition, phase: 'cold', ...cold })

      const warm = await invoke(client, functionName, workflow)
      if (warm.handler.coldStart || warm.handler.containerId !== cold.handler.containerId) {
        throw new Error(
          `${functionName} warm invocation did not reuse the cold execution environment`,
        )
      }
      if (warm.handler.outputSha256 !== cold.handler.outputSha256) {
        throw new Error(`${functionName} produced different cold and warm output for ${workflow}`)
      }
      samples.push({ memorySizeMb, workflow, repetition, phase: 'warm', ...warm })
      console.log(
        `  cold ${cold.report.durationMs.toFixed(1)} ms + init ${cold.report.initDurationMs.toFixed(1)} ms, warm ${warm.report.durationMs.toFixed(1)} ms, max ${cold.report.maxMemoryUsedMb} MiB`,
      )
    }
  }
}

const median = (values: readonly number[]): number => {
  if (values.length === 0) throw new Error('Cannot calculate a median without values')
  const sorted = [...values].sort((left, right) => left - right)
  const midpoint = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[midpoint] ?? 0
  return ((sorted[midpoint - 1] ?? 0) + (sorted[midpoint] ?? 0)) / 2
}

const rows: string[] = []
for (const memorySizeMb of memorySizes) {
  for (const workflow of workflowIds) {
    const matching = samples.filter(
      (sample) => sample.memorySizeMb === memorySizeMb && sample.workflow === workflow,
    )
    const cold = matching.filter((sample) => sample.phase === 'cold')
    const warm = matching.filter((sample) => sample.phase === 'warm')
    const coldInitMs = median(
      cold.map((sample) => {
        if (sample.report.initDurationMs === null)
          throw new Error('Cold sample has no init duration')
        return sample.report.initDurationMs
      }),
    )
    const coldDurationMs = median(cold.map((sample) => sample.report.durationMs))
    const coldTotalMs = median(
      cold.map((sample) => {
        if (sample.report.initDurationMs === null)
          throw new Error('Cold sample has no init duration')
        return sample.report.durationMs + sample.report.initDurationMs
      }),
    )
    const coldOperationMs = median(cold.map((sample) => sample.handler.operationMs))
    const warmDurationMs = median(warm.map((sample) => sample.report.durationMs))
    const warmOperationMs = median(warm.map((sample) => sample.handler.operationMs))
    const maxMemoryUsedMb = Math.max(...matching.map((sample) => sample.report.maxMemoryUsedMb))
    const outputBytes = median(matching.map((sample) => sample.handler.outputBytes))
    rows.push(
      `| ${memorySizeMb} | ${workflow} | ${coldInitMs.toFixed(1)} | ${coldDurationMs.toFixed(1)} | ${coldTotalMs.toFixed(1)} | ${coldOperationMs.toFixed(1)} | ${warmDurationMs.toFixed(1)} | ${warmOperationMs.toFixed(1)} | ${maxMemoryUsedMb} | ${Math.round(outputBytes).toLocaleString('en-US')} |`,
    )
  }
}

const measuredAt = new Date().toISOString()
const result = {
  schemaVersion: 1,
  measuredAt,
  region,
  runtime: 'nodejs22.x',
  architecture: 'x86_64',
  packageVersion: packageJson.version,
  repeats,
  memorySizesMb: memorySizes,
  workflows: workflowIds,
  methodology: {
    coldStart:
      'Update function environment with a unique nonce, wait for update, then invoke once.',
    warmStart:
      'Immediately invoke the same function and verify the Lambda log stream is unchanged.',
    operationTiming:
      'Input read and output metadata validation are excluded from handler operationMs.',
    awsTiming: 'AWS REPORT Duration and Init Duration are parsed from the synchronous log tail.',
  },
  samples,
}
const markdown = `# AWS Lambda benchmark — ${date}

Measured ${measuredAt} in \`${region}\` with Node.js 22 on x86_64. Each cell is the median of ${repeats} verified cold execution environments and ${repeats} immediately paired warm invocations. A configuration nonce forces each cold environment; the handler log stream verifies warm reuse.

Inputs are the pinned 4000x3000 JPEG and deterministic 4000x3000 RGBA PNG corpus fixtures. Each workflow resizes to 1024x768 and validates the encoded format and dimensions. Operation timing excludes fixture reads and output metadata validation; AWS duration includes the complete handler. Cold total is AWS Duration + Init Duration. Max memory is the largest AWS REPORT value across cold and warm samples.

| Memory MiB | Workflow | Cold init ms | Cold duration ms | Cold total ms | Cold operation ms | Warm duration ms | Warm operation ms | Max used MiB | Output bytes |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${rows.join('\n')}
`

await mkdir(dirname(outputPrefix), { recursive: true })
await Promise.all([
  writeFile(`${outputPrefix}.json`, `${JSON.stringify(result, null, 2)}\n`),
  writeFile(`${outputPrefix}.md`, markdown),
])
console.log(`Wrote ${outputPrefix}.json and ${outputPrefix}.md`)
