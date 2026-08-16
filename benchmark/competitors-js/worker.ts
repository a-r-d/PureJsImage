import { prepareScientificFixture } from '../scientific-readers/catalog.ts'
import {
  scientificCompetitorEngineById,
  scientificCompetitorWorkloadById,
} from '../scientific-readers/competitors.ts'
import type {
  ScientificCompetitorRun,
  ScientificCompetitorStatus,
} from '../scientific-readers/competitor-types.ts'
import {
  emptyCorrectness,
  now,
  NodeSourceTracker,
  type NodeCompetitorAdapter,
  type NodeCompetitorExecution,
} from './node-common.ts'

export interface ScientificCompetitorWorkerOutput {
  readonly status: ScientificCompetitorStatus
  readonly statusReason: string | null
  readonly moduleImportMilliseconds: number
  readonly wasmInitializationMilliseconds: number
  readonly fixtureId: string
  readonly fixtureSha256: string
  readonly fixtureSizeBytes: number
  readonly run: ScientificCompetitorRun
}

const argument = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const emitOutput = (output: ScientificCompetitorWorkerOutput): void => {
  if (process.send !== undefined) {
    process.send({ type: 'result', result: output }, () => {
      if (process.disconnect !== undefined) process.disconnect()
    })
    return
  }
  process.stdout.write(JSON.stringify(output))
}

const emptyRun = (status: ScientificCompetitorStatus, reason: string): ScientificCompetitorRun => ({
  status,
  statusReason: reason,
  stages: {
    moduleImportMilliseconds: 0,
    wasmInitializationMilliseconds: 0,
    inputCopyMilliseconds: 0,
    inputBridgeMilliseconds: 0,
    openMilliseconds: 0,
    hierarchyMilliseconds: 0,
    readMilliseconds: 0,
    outputTransferMilliseconds: 0,
    closeAndCleanupMilliseconds: 0,
    firstUsableDataMilliseconds: null,
    totalWallMilliseconds: 0,
  },
  peakRssBytes: process.memoryUsage().rss,
  baselineRssBytes: process.memoryUsage().rss,
  peakHeapUsedBytes: process.memoryUsage().heapUsed,
  peakExternalBytes: process.memoryUsage().external,
  peakArrayBufferBytes: process.memoryUsage().arrayBuffers,
  source: {
    requestCount: 0,
    requestedBytes: 0,
    returnedBytes: 0,
    uniqueBytesTouched: 0,
    completeInputRead: false,
    requiredInputCopyBytes: 0,
    sourceInstrumentation: 'complete-buffer',
  },
  correctness: emptyCorrectness(),
})

const loadAdapter = async (engineId: string): Promise<NodeCompetitorAdapter> => {
  switch (engineId) {
    case 'geotiff':
      return (await import('./node-geotiff.ts')).adapter
    case 'tiff':
      return (await import('./node-tiff.ts')).adapter
    case 'utif2':
      return (await import('./node-utif2.ts')).adapter
    case 'image-js':
      return (await import('./node-image-js.ts')).adapter
    case 'nifti-reader-js':
      return (await import('./node-nifti.ts')).adapter
    case 'npyjs':
      return (await import('./node-npy.ts')).adapter
    case 'jsfive':
      return (await import('./node-jsfive.ts')).adapter
    case 'h5wasm':
      return (await import('./node-h5wasm.ts')).adapter
    case 'itk-wasm-image-io':
      return (await import('./node-itk.ts')).adapter
    default:
      throw new Error(`No Node adapter is registered for ${engineId}`)
  }
}

const validateOutput = (
  workload: NonNullable<ReturnType<typeof scientificCompetitorWorkloadById.get>>,
  execution: NodeCompetitorExecution,
): void => {
  const { correctness } = execution
  if (workload.operation === 'metadata' || workload.operation === 'hierarchy') {
    if (correctness.shape === null && correctness.sampleCount === null) {
      throw new Error(`No metadata or hierarchy output was returned for ${workload.id}`)
    }
    return
  }
  if (
    correctness.sampleSha256 === null ||
    correctness.sampleCount === null ||
    correctness.sampleCount < 1
  ) {
    throw new Error(`No native samples were returned for ${workload.id}`)
  }
  if (workload.expectedShape !== undefined) {
    const actual = correctness.shape
    if (
      actual === null ||
      actual.length !== workload.expectedShape.length ||
      actual.some((value, index) => value !== workload.expectedShape?.[index])
    ) {
      throw new Error(
        `Unexpected shape for ${workload.id}: ${JSON.stringify(actual)} expected ${JSON.stringify(workload.expectedShape)}`,
      )
    }
  }
}

const main = async (): Promise<void> => {
  const engineId = argument('engine')
  const workloadId = argument('workload')
  if (engineId === undefined || workloadId === undefined)
    throw new Error('worker needs --engine and --workload')
  const engine = scientificCompetitorEngineById.get(engineId)
  const workload = scientificCompetitorWorkloadById.get(workloadId)
  if (engine === undefined || workload === undefined)
    throw new Error(`Unknown competitor request ${engineId}/${workloadId}`)
  const fixture = await prepareScientificFixture(workload.fixtureId)
  const moduleStarted = now()
  const adapter = await loadAdapter(engine.id)
  const moduleImportMilliseconds = now() - moduleStarted
  const wasmInitializationMilliseconds = await adapter.initialize()
  const source = new NodeSourceTracker(fixture)
  const baseline = process.memoryUsage()
  const started = now()
  let execution: NodeCompetitorExecution | null = null
  try {
    execution = await adapter.run({ fixture, workload, source })
    validateOutput(workload, execution)
    const cleanupStarted = now()
    await execution.cleanup()
    const closeAndCleanupMilliseconds = now() - cleanupStarted
    const memory = process.memoryUsage()
    const stages = {
      ...execution.stages,
      moduleImportMilliseconds,
      wasmInitializationMilliseconds,
      closeAndCleanupMilliseconds,
      totalWallMilliseconds: now() - started,
    }
    const run: ScientificCompetitorRun = {
      status: 'supported',
      statusReason: null,
      stages,
      peakRssBytes: memory.rss,
      baselineRssBytes: baseline.rss,
      peakHeapUsedBytes: memory.heapUsed,
      peakExternalBytes: memory.external,
      peakArrayBufferBytes: memory.arrayBuffers,
      source: source.metrics(execution.sourceInstrumentation),
      correctness: execution.correctness,
    }
    const output: ScientificCompetitorWorkerOutput = {
      status: 'supported',
      statusReason: null,
      moduleImportMilliseconds,
      wasmInitializationMilliseconds,
      fixtureId: fixture.id,
      fixtureSha256: fixture.sha256,
      fixtureSizeBytes: fixture.resources.reduce(
        (total, resource) => total + resource.sizeBytes,
        0,
      ),
      run,
    }
    emitOutput(output)
    return
  } catch (error) {
    if (execution !== null) {
      try {
        await execution.cleanup()
      } catch {
        // Preserve the original adapter failure in the worker result.
      }
    }
    const reason = errorMessage(error)
    const status: ScientificCompetitorStatus = reason.includes('unsupported')
      ? 'unsupported'
      : 'error'
    const output: ScientificCompetitorWorkerOutput = {
      status,
      statusReason: reason,
      moduleImportMilliseconds,
      wasmInitializationMilliseconds,
      fixtureId: fixture.id,
      fixtureSha256: fixture.sha256,
      fixtureSizeBytes: fixture.resources.reduce(
        (total, resource) => total + resource.sizeBytes,
        0,
      ),
      run: emptyRun(status, reason),
    }
    emitOutput(output)
  }
}

await main()
