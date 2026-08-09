import { readFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { allFixtures, fixturePath, readManifest } from './lib/corpus.ts'
import { createQualityReference, measureQualityPsnr } from './lib/quality.ts'
import { validateExecution } from './lib/validate-output.ts'
import type { Engine, QualityPsnr, WorkerResult } from './types.ts'
import { workflows } from './workflows.ts'

const readArgument = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}

const engineIds = new Set([
  'image-js',
  'jimp',
  'jsquash',
  'purejsimage',
  'purejsimage-wasm',
  'purejsimage-experimental-heic',
  'sharp',
  'sharp-single-thread',
])

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null
}

const isEngine = (value: unknown): value is Engine => {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.version === 'string' &&
    (value.kind === 'native' ||
      value.kind === 'native-single-thread' ||
      value.kind === 'pure-javascript' ||
      value.kind === 'webassembly') &&
    typeof value.packageName === 'string' &&
    (value.packageNames === undefined ||
      (Array.isArray(value.packageNames) &&
        value.packageNames.every((name) => typeof name === 'string'))) &&
    (value.prepareInputs === undefined || typeof value.prepareInputs === 'function') &&
    typeof value.unsupportedReason === 'function' &&
    typeof value.execute === 'function'
  )
}

const sendResult = (result: WorkerResult): void => {
  process.send?.({ type: 'result', result })
}

const settleGarbage = async (): Promise<void> => {
  for (let pass = 0; pass < 3; pass += 1) {
    global.gc?.()
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
}

const main = async (): Promise<void> => {
  const engineId = readArgument('engine')
  const workflowId = readArgument('workflow')
  const warmups = Number(readArgument('warmups') ?? 1)
  const measureQuality = readArgument('quality') === 'true'
  const workflow = workflows.find((candidate) => candidate.id === workflowId)

  if (!engineId || !engineIds.has(engineId) || !workflow) {
    throw new Error(`Invalid worker arguments: engine=${engineId}, workflow=${workflowId}`)
  }

  const engineModule: unknown = await import(`./engines/${engineId}.ts`)
  if (!isRecord(engineModule) || !isEngine(engineModule.engine)) {
    throw new Error(`Invalid benchmark engine module: ${engineId}`)
  }
  const engine = engineModule.engine
  const manifest = await readManifest()
  const fixtures = new Map(allFixtures(manifest).map((fixture) => [fixture.id, fixture]))
  const inputIds = workflow.batch ? workflow.inputs : [workflow.input]
  const inputs = await Promise.all(
    inputIds.map(async (id) => {
      const fixture = fixtures.get(id)
      if (!fixture) throw new Error(`Unknown fixture: ${id}`)
      return readFile(fixturePath(fixture))
    }),
  )

  const unsupported = await engine.unsupportedReason(workflow, inputs)
  if (unsupported) {
    sendResult({ status: 'unsupported', errors: [unsupported] })
    return
  }

  await engine.prepareInputs?.(workflow, inputs)

  for (let index = 0; index < warmups; index += 1) {
    const warmup = await engine.execute({ workflow, inputs })
    const validation = await validateExecution({ workflow, execution: warmup })
    if (!validation.valid) {
      sendResult({
        status: 'invalid-output',
        errors: [`Warmup output failed: ${validation.errors.join('; ')}`],
      })
      return
    }
  }

  await settleGarbage()

  process.send?.({
    type: 'ready',
    baselineMemory: process.memoryUsage(),
    engine: {
      id: engine.id,
      version: engine.version,
      kind: engine.kind,
      packageName: engine.packageName,
      ...(engine.packageNames ? { packageNames: engine.packageNames } : {}),
    },
  })

  await new Promise<void>((resolve) => {
    process.once('message', (message: unknown) => {
      if (isRecord(message) && message.type === 'run') resolve()
    })
  })

  const cpuStart = process.cpuUsage()
  const startedAt = performance.now()
  const execution = await engine.execute({ workflow, inputs })
  const wallMilliseconds = performance.now() - startedAt
  const cpu = process.cpuUsage(cpuStart)
  const validation = await validateExecution({ workflow, execution })
  if (!validation.valid) {
    sendResult({ status: 'invalid-output', errors: validation.errors })
    return
  }
  const resourceUsage = process.resourceUsage()
  const finalMemory = process.memoryUsage()
  if (process.send) {
    await new Promise<void>((resolve) => {
      const acknowledgeMeasurement = (message: unknown): void => {
        if (!isRecord(message) || message.type !== 'measurement-acknowledged') return
        process.off('message', acknowledgeMeasurement)
        resolve()
      }
      process.on('message', acknowledgeMeasurement)
      process.send?.({ type: 'measurement-complete' })
    })
  }
  let qualityPsnrDb: QualityPsnr | undefined
  if (measureQuality && workflow.qualityReference) {
    if (workflow.batch || !execution.output) {
      throw new Error(`Quality-reference workflow ${workflow.id} did not produce one image`)
    }
    const input = inputs[0]
    if (!input) throw new Error(`Quality-reference workflow ${workflow.id} has no input`)
    const reference = createQualityReference(workflow, input)
    qualityPsnrDb = measureQualityPsnr(execution.output, reference)
  }
  sendResult({
    status: 'pass',
    errors: [],
    ...(validation.output || validation.metadata
      ? { output: validation.output ?? validation.metadata }
      : {}),
    outputBytes: validation.outputBytes,
    wallMilliseconds,
    cpuMilliseconds: (cpu.user + cpu.system) / 1000,
    finalMemory,
    resourceMaxRssBytes: resourceUsage.maxRSS * 1024,
    ...(qualityPsnrDb !== undefined ? { qualityPsnrDb } : {}),
  })
}

try {
  await main()
} catch (error) {
  sendResult({ status: 'error', errors: [error instanceof Error ? error.message : String(error)] })
}
