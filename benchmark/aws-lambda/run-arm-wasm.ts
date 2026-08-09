import { randomUUID } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { brotliCompressSync, gzipSync } from 'node:zlib'
import {
  GetFunctionConfigurationCommand,
  InvokeCommand,
  LambdaClient,
  LogType,
  UpdateFunctionConfigurationCommand,
  waitUntilFunctionUpdatedV2,
} from '@aws-sdk/client-lambda'
import packageJson from '../../package.json' with { type: 'json' }

const architectureWorkflows = [
  'jpeg-resize-png',
  'jpeg-resize-webp',
  'png-resize-jpeg',
  'png-resize-webp',
] as const
const wasmWorkflows = ['jpeg-resize-3000-png', 'jpeg-resize-3000-webp'] as const
const workflowLookup = {
  'jpeg-resize-png': true,
  'jpeg-resize-webp': true,
  'png-resize-jpeg': true,
  'png-resize-webp': true,
  'jpeg-resize-3000-png': true,
  'jpeg-resize-3000-webp': true,
} as const
const engineLookup = { javascript: true, 'wasm-jpeg': true } as const
const targets = [
  {
    architecture: 'x86_64',
    functionName: 'purejsimage-lambda-bench-512',
    memorySizeMb: 512,
  },
  {
    architecture: 'arm64',
    functionName: 'purejsimage-lambda-bench-arm64-512',
    memorySizeMb: 512,
  },
] as const

type Architecture = (typeof targets)[number]['architecture']
type WorkflowId = keyof typeof workflowLookup
type EngineId = keyof typeof engineLookup
type Phase = 'cold' | 'warm'
type Suite = 'architecture' | 'wasm'

interface BenchmarkCase {
  readonly suite: Suite
  readonly engine: EngineId
  readonly workflow: WorkflowId
}

interface MemorySnapshot {
  readonly rss: number
  readonly heapUsed: number
  readonly external: number
  readonly arrayBuffers: number
}

interface WasmMeasurement {
  readonly instantiations: number
  readonly moduleBytes: number
  readonly memoryBytes: number
  readonly readMs: number
  readonly instantiateMs: number
  readonly loadMs: number
  readonly loadedThisInvocation: boolean
}

interface HandlerResult {
  readonly engine: EngineId
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
  readonly wasm: WasmMeasurement
}

interface AwsReport {
  readonly durationMs: number
  readonly billedDurationMs: number
  readonly memorySizeMb: number
  readonly maxMemoryUsedMb: number
  readonly initDurationMs: number | null
}

interface Sample {
  readonly architecture: Architecture
  readonly functionName: string
  readonly memorySizeMb: number
  readonly suite: Suite
  readonly engine: EngineId
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

interface Summary {
  readonly coldInitMs: number
  readonly coldDurationMs: number
  readonly coldTotalMs: number
  readonly coldOperationMs: number
  readonly warmDurationMs: number
  readonly warmOperationMs: number
  readonly maxMemoryUsedMb: number
  readonly outputBytes: number
  readonly wasmLoadMs: number
  readonly wasmMemoryBytes: number
}

const benchmarkCases: readonly BenchmarkCase[] = [
  ...architectureWorkflows.map(
    (workflow): BenchmarkCase => ({ suite: 'architecture', engine: 'javascript', workflow }),
  ),
  ...wasmWorkflows.flatMap((workflow): readonly BenchmarkCase[] => [
    { suite: 'wasm', engine: 'javascript', workflow },
    { suite: 'wasm', engine: 'wasm-jpeg', workflow },
  ]),
]

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

const isWasmMeasurement = (value: unknown): value is WasmMeasurement => {
  return (
    typeof value === 'object' &&
    value !== null &&
    'instantiations' in value &&
    isFiniteNumber(value.instantiations) &&
    'moduleBytes' in value &&
    isFiniteNumber(value.moduleBytes) &&
    'memoryBytes' in value &&
    isFiniteNumber(value.memoryBytes) &&
    'readMs' in value &&
    isFiniteNumber(value.readMs) &&
    'instantiateMs' in value &&
    isFiniteNumber(value.instantiateMs) &&
    'loadMs' in value &&
    isFiniteNumber(value.loadMs) &&
    'loadedThisInvocation' in value &&
    typeof value.loadedThisInvocation === 'boolean'
  )
}

const isWorkflowId = (value: unknown): value is WorkflowId =>
  typeof value === 'string' && value in workflowLookup

const isEngineId = (value: unknown): value is EngineId =>
  typeof value === 'string' && value in engineLookup

const isHandlerResult = (value: unknown): value is HandlerResult => {
  return (
    typeof value === 'object' &&
    value !== null &&
    'engine' in value &&
    isEngineId(value.engine) &&
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
    isMemorySnapshot(value.memoryAfter) &&
    'wasm' in value &&
    isWasmMeasurement(value.wasm)
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
  benchmarkCase: BenchmarkCase,
): Promise<InvocationMeasurement> => {
  const response = await client.send(
    new InvokeCommand({
      FunctionName: functionName,
      InvocationType: 'RequestResponse',
      LogType: LogType.Tail,
      Payload: new TextEncoder().encode(
        JSON.stringify({ engine: benchmarkCase.engine, workflow: benchmarkCase.workflow }),
      ),
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

const median = (values: readonly number[]): number => {
  if (values.length === 0) throw new Error('Cannot calculate a median without values')
  const sorted = [...values].sort((left, right) => left - right)
  const midpoint = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[midpoint] ?? 0
  return ((sorted[midpoint - 1] ?? 0) + (sorted[midpoint] ?? 0)) / 2
}

const summarize = (matching: readonly Sample[]): Summary => {
  const cold = matching.filter((sample) => sample.phase === 'cold')
  const warm = matching.filter((sample) => sample.phase === 'warm')
  return {
    coldInitMs: median(
      cold.map((sample) => {
        if (sample.report.initDurationMs === null)
          throw new Error('Cold sample has no init duration')
        return sample.report.initDurationMs
      }),
    ),
    coldDurationMs: median(cold.map((sample) => sample.report.durationMs)),
    coldTotalMs: median(
      cold.map((sample) => {
        if (sample.report.initDurationMs === null)
          throw new Error('Cold sample has no init duration')
        return sample.report.durationMs + sample.report.initDurationMs
      }),
    ),
    coldOperationMs: median(cold.map((sample) => sample.handler.operationMs)),
    warmDurationMs: median(warm.map((sample) => sample.report.durationMs)),
    warmOperationMs: median(warm.map((sample) => sample.handler.operationMs)),
    maxMemoryUsedMb: Math.max(...matching.map((sample) => sample.report.maxMemoryUsedMb)),
    outputBytes: median(matching.map((sample) => sample.handler.outputBytes)),
    wasmLoadMs: median(cold.map((sample) => sample.handler.wasm.loadMs)),
    wasmMemoryBytes: Math.max(...matching.map((sample) => sample.handler.wasm.memoryBytes), 0),
  }
}

const region = argumentValue('--region') ?? process.env.AWS_REGION ?? 'us-east-1'
const repeats = positiveIntegerArgument('--repeats', 3)
const date = new Date().toISOString().slice(0, 10)
const outputPrefix = argumentValue('--output') ?? `benchmark/results/aws-lambda-arm-wasm-${date}`
const client = new LambdaClient({ region })
const runTarget = async (target: (typeof targets)[number]): Promise<Sample[]> => {
  const targetSamples: Sample[] = []

  for (const benchmarkCase of benchmarkCases) {
    for (let repetition = 1; repetition <= repeats; repetition += 1) {
      console.log(
        `${target.architecture} ${benchmarkCase.engine} ${benchmarkCase.workflow} repetition ${repetition}/${repeats}: resetting`,
      )
      await resetExecutionEnvironment(client, target.functionName)
      const cold = await invoke(client, target.functionName, benchmarkCase)
      if (!cold.handler.coldStart || cold.report.initDurationMs === null) {
        throw new Error(
          `${target.functionName} did not produce a verified cold start for ${benchmarkCase.workflow}`,
        )
      }
      if (
        cold.handler.engine !== benchmarkCase.engine ||
        cold.handler.workflow !== benchmarkCase.workflow
      ) {
        throw new Error(`${target.functionName} returned the wrong benchmark case`)
      }
      if (benchmarkCase.engine === 'wasm-jpeg') {
        if (
          !cold.handler.wasm.loadedThisInvocation ||
          cold.handler.wasm.instantiations !== 1 ||
          cold.handler.wasm.moduleBytes === 0 ||
          cold.handler.wasm.memoryBytes === 0
        ) {
          throw new Error(`${target.functionName} did not exercise the JPEG WASM accelerator`)
        }
      } else if (cold.handler.wasm.instantiations !== 0) {
        throw new Error(`${target.functionName} loaded JPEG WASM during the JavaScript control`)
      }
      targetSamples.push({
        architecture: target.architecture,
        functionName: target.functionName,
        memorySizeMb: target.memorySizeMb,
        ...benchmarkCase,
        repetition,
        phase: 'cold',
        ...cold,
      })

      const warm = await invoke(client, target.functionName, benchmarkCase)
      if (warm.handler.coldStart || warm.handler.containerId !== cold.handler.containerId) {
        throw new Error(
          `${target.functionName} warm invocation did not reuse the cold execution environment`,
        )
      }
      if (warm.handler.outputSha256 !== cold.handler.outputSha256) {
        throw new Error(
          `${target.functionName} produced different cold and warm output for ${benchmarkCase.workflow}`,
        )
      }
      if (
        benchmarkCase.engine === 'wasm-jpeg' &&
        (warm.handler.wasm.loadedThisInvocation || warm.handler.wasm.instantiations !== 1)
      ) {
        throw new Error(`${target.functionName} did not reuse the cached JPEG WASM instance`)
      }
      targetSamples.push({
        architecture: target.architecture,
        functionName: target.functionName,
        memorySizeMb: target.memorySizeMb,
        ...benchmarkCase,
        repetition,
        phase: 'warm',
        ...warm,
      })
      console.log(
        `  cold ${cold.report.durationMs.toFixed(1)} ms + init ${cold.report.initDurationMs.toFixed(1)} ms, warm ${warm.report.durationMs.toFixed(1)} ms, max ${Math.max(cold.report.maxMemoryUsedMb, warm.report.maxMemoryUsedMb)} MiB`,
      )
    }
  }

  return targetSamples
}

const [x86Samples, arm64Samples] = await Promise.all([runTarget(targets[0]), runTarget(targets[1])])
const samples = [...x86Samples, ...arm64Samples]

for (const workflow of [...architectureWorkflows, ...wasmWorkflows]) {
  const hashes = new Set(
    samples
      .filter((sample) => sample.workflow === workflow)
      .map((sample) => sample.handler.outputSha256),
  )
  if (hashes.size !== 1) {
    throw new Error(`${workflow} output differed across architectures or engines`)
  }
}

const architectureRows: string[] = []
for (const workflow of architectureWorkflows) {
  const x86 = summarize(
    samples.filter(
      (sample) =>
        sample.architecture === 'x86_64' &&
        sample.engine === 'javascript' &&
        sample.workflow === workflow,
    ),
  )
  const arm = summarize(
    samples.filter(
      (sample) =>
        sample.architecture === 'arm64' &&
        sample.engine === 'javascript' &&
        sample.workflow === workflow,
    ),
  )
  architectureRows.push(
    `| ${workflow} | ${x86.coldTotalMs.toFixed(1)} | ${arm.coldTotalMs.toFixed(1)} | ${x86.warmOperationMs.toFixed(1)} | ${arm.warmOperationMs.toFixed(1)} | ${x86.maxMemoryUsedMb} | ${arm.maxMemoryUsedMb} |`,
  )
}

const wasmRows: string[] = []
for (const target of targets) {
  for (const workflow of wasmWorkflows) {
    for (const engine of ['javascript', 'wasm-jpeg'] as const) {
      const summary = summarize(
        samples.filter(
          (sample) =>
            sample.architecture === target.architecture &&
            sample.engine === engine &&
            sample.workflow === workflow,
        ),
      )
      wasmRows.push(
        `| ${target.architecture} | ${workflow} | ${engine} | ${summary.coldTotalMs.toFixed(1)} | ${summary.coldOperationMs.toFixed(1)} | ${summary.warmOperationMs.toFixed(1)} | ${summary.maxMemoryUsedMb} | ${summary.wasmLoadMs.toFixed(2)} | ${(summary.wasmMemoryBytes / 1_048_576).toFixed(1)} |`,
      )
    }
  }
}

const wasmArtifact = await readFile(
  new URL('../../src/accelerator-entries/jpeg-decoder.wasm', import.meta.url),
)
const [codeZipStat, jpegFixtureStat, pngFixtureStat] = await Promise.all([
  stat(new URL('./.asset.zip', import.meta.url)),
  stat(new URL('../corpus/files/tundra-4000x3000.jpg', import.meta.url)),
  stat(new URL('../corpus/files/rgba-gradient-4000x3000.png', import.meta.url)),
])
const fixtureObjectBytes = jpegFixtureStat.size + pngFixtureStat.size
const measuredAt = new Date().toISOString()
const result = {
  schemaVersion: 1,
  measuredAt,
  region,
  runtime: 'nodejs22.x',
  packageVersion: packageJson.version,
  repeats,
  memorySizeMb: 512,
  architectures: targets.map((target) => target.architecture),
  benchmarkCases,
  wasmArtifact: {
    bytes: wasmArtifact.byteLength,
    gzipBytes: gzipSync(wasmArtifact).byteLength,
    brotliBytes: brotliCompressSync(wasmArtifact).byteLength,
  },
  deploymentArtifacts: {
    codeZipBytes: codeZipStat.size,
    fixtureObjectBytes,
    fixturesEmbeddedInCode: false,
  },
  methodology: {
    coldStart:
      'Update function environment with a unique nonce, wait for update, then invoke once.',
    warmStart:
      'Immediately invoke the same function and verify the Lambda log stream is unchanged.',
    wasmSelection:
      'The 3000px JPEG workflows require full-resolution decode. WASM samples are accepted only when the loader instantiates exactly once and the warm invocation reuses it.',
    outputParity:
      'Every workflow must produce one SHA-256 across cold and warm invocations, both architectures, and both engines where applicable.',
    operationTiming:
      'Input read and output metadata validation are excluded from handler operationMs. WASM input and row-copy overhead remains inside operationMs.',
    awsTiming: 'AWS REPORT Duration and Init Duration are parsed from the synchronous log tail.',
  },
  samples,
}
const markdown = `# AWS Lambda ARM64 and JPEG WASM experiment — ${date}

Measured ${measuredAt} in \`${region}\` with Node.js 22 at 512 MiB. Each cell is the median of ${repeats} verified cold execution environments and ${repeats} immediately paired warm invocations. The x86_64 and ARM64 functions use the same JavaScript bundle and WebAssembly module.

The architecture comparison uses the pinned 4000x3000 JPEG and deterministic 4000x3000 RGBA PNG fixtures, resized to 1024x768. The WASM experiment resizes the JPEG to 3000x2250 so the planner requests full-resolution decode and the JPEG accelerator is eligible. A WASM sample is rejected unless the module instantiates exactly once during the cold operation and is reused by the paired warm operation. All accepted outputs have identical SHA-256 values across architectures and engines.

JPEG WASM artifact: ${wasmArtifact.byteLength.toLocaleString('en-US')} bytes raw, ${gzipSync(wasmArtifact).byteLength.toLocaleString('en-US')} bytes gzip, ${brotliCompressSync(wasmArtifact).byteLength.toLocaleString('en-US')} bytes Brotli.

The deployed code ZIP was ${codeZipStat.size.toLocaleString('en-US')} bytes. The ${fixtureObjectBytes.toLocaleString('en-US')} bytes of pinned input fixtures were staged as separate S3 objects, fetched before \`operationMs\`, and deleted with the benchmark stack.

## Architecture comparison — JavaScript reference

| Workflow | x86 cold total ms | ARM cold total ms | x86 warm operation ms | ARM warm operation ms | x86 max MiB | ARM max MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
${architectureRows.join('\n')}

## JPEG WASM experiment — full-resolution decode

| Architecture | Workflow | Engine | Cold total ms | Cold operation ms | Warm operation ms | Max used MiB | WASM load ms | WASM memory MiB |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
${wasmRows.join('\n')}

Operation timing includes all JS/WASM input and output copies. AWS duration includes fixture reads, operation, and output validation. Cold total is AWS Duration + Init Duration. Maximum memory is the largest AWS REPORT value across cold and warm samples.
`

await mkdir(dirname(outputPrefix), { recursive: true })
await Promise.all([
  writeFile(`${outputPrefix}.json`, `${JSON.stringify(result, null, 2)}\n`),
  writeFile(`${outputPrefix}.md`, markdown),
])
console.log(`Wrote ${outputPrefix}.json and ${outputPrefix}.md`)
