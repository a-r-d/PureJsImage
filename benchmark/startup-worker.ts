import { readFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { allFixtures, fixturePath, readManifest } from './lib/corpus.ts'
import { validateExecution } from './lib/validate-output.ts'
import type { Engine, StartupOperationResult, Workflow } from './types.ts'
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

const runFirstOperation = async ({
  engine,
  workflow,
  input,
}: {
  engine: Engine
  workflow: Workflow
  input: Buffer
}): Promise<StartupOperationResult> => {
  const unsupported = await engine.unsupportedReason(workflow, [input])
  if (unsupported) return { status: 'unsupported', errors: [unsupported] }
  try {
    await engine.prepareInputs?.(workflow, [input])
    const startedAt = performance.now()
    const execution = await engine.execute({ workflow, inputs: [input] })
    const wallMilliseconds = performance.now() - startedAt
    const validation = await validateExecution({ workflow, execution })
    if (!validation.valid) return { status: 'invalid-output', errors: validation.errors }
    return { status: 'pass', wallMilliseconds, errors: [] }
  } catch (error) {
    return { status: 'error', errors: [error instanceof Error ? error.message : String(error)] }
  }
}

const engineId = readArgument('engine')
if (!engineId || !engineIds.has(engineId)) throw new Error(`Unknown startup engine: ${engineId}`)

const importStartedAt = performance.now()
const engineModule: unknown = await import(`./engines/${engineId}.ts`)
const importMilliseconds = performance.now() - importStartedAt
if (!isRecord(engineModule) || !isEngine(engineModule.engine)) {
  throw new Error(`Invalid benchmark engine module: ${engineId}`)
}
const engine = engineModule.engine
const rssAfterImportBytes = process.memoryUsage().rss

const metadataWorkflow = workflows.find((workflow) => workflow.id === 'metadata-jpeg-large')
const resizeWorkflow = workflows.find((workflow) => workflow.id === 'jpeg-resize-1200')
if (!metadataWorkflow || !resizeWorkflow) throw new Error('Startup workflows are missing')

const manifest = await readManifest()
const fixtures = new Map(allFixtures(manifest).map((fixture) => [fixture.id, fixture]))
const readWorkflowInput = async (workflow: Workflow): Promise<Buffer> => {
  if (workflow.batch) throw new Error('Startup operation cannot be a batch')
  const fixture = fixtures.get(workflow.input)
  if (!fixture) throw new Error(`Unknown startup fixture: ${workflow.input}`)
  return readFile(fixturePath(fixture))
}

const metadataInput = await readWorkflowInput(metadataWorkflow)
const resizeInput = await readWorkflowInput(resizeWorkflow)
const firstMetadata = await runFirstOperation({
  engine,
  workflow: metadataWorkflow,
  input: metadataInput,
})
const firstResize = await runFirstOperation({
  engine,
  workflow: resizeWorkflow,
  input: resizeInput,
})

process.send?.({
  type: 'startup-result',
  result: {
    engine: {
      id: engine.id,
      version: engine.version,
      kind: engine.kind,
      packageName: engine.packageName,
      ...(engine.packageNames ? { packageNames: engine.packageNames } : {}),
    },
    importMilliseconds,
    rssAfterImportBytes,
    firstMetadata,
    firstResize,
  },
})
