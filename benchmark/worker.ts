import { readFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { allFixtures, fixturePath, readManifest } from './lib/corpus.ts'
import { validateExecution } from './lib/validate-output.ts'
import type { Engine } from './types.ts'
import { workflows } from './workflows.ts'

const readArgument = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}

const engineId = readArgument('engine')
const workflowId = readArgument('workflow')
const warmups = Number(readArgument('warmups') ?? 1)
const workflow = workflows.find((candidate) => candidate.id === workflowId)

if (!engineId || !workflow) {
  throw new Error(`Invalid worker arguments: engine=${engineId}, workflow=${workflowId}`)
}

if (engineId !== 'jimp' && engineId !== 'purejsimage') {
  throw new Error(`Unknown benchmark engine: ${engineId}`)
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null
}

const isEngine = (value: unknown): value is Engine => {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.version === 'string' &&
    typeof value.execute === 'function'
  )
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

for (let index = 0; index < warmups; index += 1) {
  const warmup = await engine.execute({ workflow, inputs })
  const validation = validateExecution({ workflow, execution: warmup })
  if (!validation.valid) {
    throw new Error(`Warmup output failed: ${validation.errors.join('; ')}`)
  }
}

global.gc?.()

process.send?.({
  type: 'ready',
  baselineMemory: process.memoryUsage(),
  engine: { id: engine.id, version: engine.version },
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
const validation = validateExecution({ workflow, execution })
const resourceUsage = process.resourceUsage()

process.send?.({
  type: 'result',
  result: {
    valid: validation.valid,
    errors: validation.errors,
    output: validation.output ?? validation.metadata,
    outputBytes: validation.outputBytes,
    wallMilliseconds,
    cpuMilliseconds: (cpu.user + cpu.system) / 1000,
    finalMemory: process.memoryUsage(),
    resourceMaxRssBytes: resourceUsage.maxRSS * 1024,
  },
})
