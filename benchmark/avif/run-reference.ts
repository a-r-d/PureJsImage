import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import os from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  avifCorpusDirectory,
  avifCorpusLicense,
  avifCorpusRevision,
  avifFixtures,
} from './corpus.ts'

type Action = 'pure-metadata' | 'reference-decode' | 'reference-metadata'

interface Result {
  readonly ok: boolean
  readonly action: Action
  readonly fixture: string
  readonly error?: string
  readonly width?: number
  readonly height?: number
  readonly outputBytes?: number
  readonly bitDepth?: number
  readonly chromaSubsampling?: '400' | '420' | '422' | '444'
  readonly codecProfile?: number
  readonly hasAlpha?: boolean
  readonly wallMilliseconds: number
  readonly cpuMilliseconds?: number
  readonly baselineRssBytes: number
  readonly maxRssBytes: number
  readonly peakRssDeltaBytes: number
  readonly compatibilityShim: boolean
}

const directory = dirname(fileURLToPath(import.meta.url))
const worker = join(directory, 'reference-worker.ts')
const resultsDirectory = join(dirname(directory), 'results')
const date = new Intl.DateTimeFormat('sv-SE', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date())
const outputBase = join(resultsDirectory, `avif-research-baseline-${date}`)
const actions: readonly Action[] = ['pure-metadata', 'reference-metadata', 'reference-decode']

const runWorker = (action: Action, path: string): Promise<unknown> =>
  new Promise<unknown>((resolve, reject) => {
    const child = spawn(process.execPath, ['--expose-gc', worker, action, path], {
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    })
    let stderr = ''
    let result: unknown
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('message', (message: unknown) => {
      result = message
    })
    const timeout = setTimeout(() => child.kill('SIGKILL'), 60_000)
    child.on('error', reject)
    child.on('exit', (code, signal) => {
      clearTimeout(timeout)
      if (code === 0 && result !== undefined) resolve(result)
      else reject(new Error(`worker exited with ${code ?? signal}: ${stderr.trim()}`))
    })
  })

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const parseResult = (value: unknown, fixture: string): Result => {
  if (
    !isRecord(value) ||
    typeof value.ok !== 'boolean' ||
    typeof value.action !== 'string' ||
    typeof value.wallMilliseconds !== 'number' ||
    typeof value.baselineRssBytes !== 'number' ||
    typeof value.maxRssBytes !== 'number' ||
    typeof value.peakRssDeltaBytes !== 'number' ||
    typeof value.compatibilityShim !== 'boolean'
  ) {
    throw new Error(`Invalid AVIF benchmark worker result for ${fixture}`)
  }
  return { ...(value as Omit<Result, 'fixture'>), fixture }
}

const results: Result[] = []
for (const fixture of avifFixtures) {
  for (const action of actions) {
    process.stdout.write(`${action.padEnd(20)} ${fixture.file}\n`)
    try {
      const workerResult = await runWorker(action, join(avifCorpusDirectory, fixture.file))
      const result = parseResult(workerResult, fixture.id)
      if (!result.ok) {
        results.push(result)
        continue
      }
      const expected = fixture.expected
      const fields =
        action === 'reference-decode'
          ? (['width', 'height'] as const)
          : ([
              'width',
              'height',
              'bitDepth',
              'chromaSubsampling',
              'codecProfile',
              'hasAlpha',
            ] as const)
      const errors = fields.flatMap((field) =>
        result[field] === expected[field]
          ? []
          : [`${field}: expected ${expected[field]}, got ${result[field]}`],
      )
      results.push(
        errors.length === 0
          ? result
          : {
              ...result,
              ok: false,
              error: errors.join('; '),
            },
      )
    } catch (error) {
      results.push({
        ok: false,
        action,
        fixture: fixture.id,
        error: error instanceof Error ? error.message : String(error),
        wallMilliseconds: 0,
        baselineRssBytes: 0,
        maxRssBytes: 0,
        peakRssDeltaBytes: 0,
        compatibilityShim: action !== 'pure-metadata',
      })
    }
  }
}

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((left, right) => left - right)
  const value = sorted[Math.floor(sorted.length / 2)]
  if (value === undefined) throw new Error('Cannot calculate median of an empty set')
  return value
}
const mib = (bytes: number): string => (bytes / 1024 / 1024).toFixed(1)
const actionName = (action: Action): string =>
  action === 'pure-metadata'
    ? 'PureJsImage metadata'
    : action === 'reference-metadata'
      ? 'ts-avif metadata'
      : 'ts-avif full decode'

const table = actions.map((action) => {
  const selected = results.filter((result) => result.action === action)
  const passed = selected.filter((result) => result.ok)
  return {
    action,
    passed: passed.length,
    total: selected.length,
    medianWallMilliseconds: median(selected.map((result) => result.wallMilliseconds)),
    medianMaxRssBytes: median(selected.map((result) => result.maxRssBytes)),
    maximumMaxRssBytes: Math.max(...selected.map((result) => result.maxRssBytes)),
    medianPeakRssDeltaBytes: median(selected.map((result) => result.peakRssDeltaBytes)),
  }
})

const report = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  environment: {
    platform: process.platform,
    architecture: process.arch,
    node: process.version,
    cpu: os.cpus()[0]?.model,
  },
  corpus: {
    repository: 'AOMediaCodec/libavif',
    revision: avifCorpusRevision,
    license: avifCorpusLicense,
    fixtures: avifFixtures.length,
  },
  reference: {
    package: '@stacksjs/ts-avif',
    version: '0.1.3',
    node24CompatibilityShim: results.some((result) => result.compatibilityShim),
  },
  summary: table,
  results,
}

const failures = results.filter((result) => !result.ok)
const markdown = `# AVIF research baseline — ${date}

This development-only baseline compares the first-party PureJsImage container metadata path with
\`@stacksjs/ts-avif@0.1.3\` across ${avifFixtures.length} checksum-pinned fixtures from libavif revision
\`${avifCorpusRevision}\`. The corpus is BSD-2-Clause licensed and covers 8/10/12-bit data,
monochrome/4:2:0/4:2:2/4:4:4 signaling, profiles 0-2, alpha, HDR, grids, progressive items,
extended \`pixi\`, tiny images, and animated files.

The published ts-avif package does not import on Node ${process.versions.node} without a development-only
\`Uint8Array.fromBase64\` shim. The benchmark supplies that shim before importing the package. PureJsImage
does not need it.

| Action | Metadata/decode compatibility | Median wall | Median peak RSS | Maximum peak RSS | Median measured RSS delta |
| --- | ---: | ---: | ---: | ---: | ---: |
${table
  .map(
    (row) =>
      `| ${actionName(row.action)} | ${row.passed}/${row.total} | ${row.medianWallMilliseconds.toFixed(2)} ms | ${mib(row.medianMaxRssBytes)} MiB | ${mib(row.maximumMaxRssBytes)} MiB | ${mib(row.medianPeakRssDeltaBytes)} MiB |`,
  )
  .join('\n')}

Peak RSS is the child process resource maximum. The delta subtracts RSS after fixture loading, package
import, and forced garbage collection; it is directional because \`ru_maxrss\` can include an earlier
startup/import peak. Each action and fixture runs in a fresh process.

## Compatibility failures

${
  failures.length === 0
    ? 'None.'
    : failures
        .map((failure) => `- ${failure.action} / ${failure.fixture}: ${failure.error}`)
        .join('\n')
}
`

await writeFile(`${outputBase}.json`, `${JSON.stringify(report, null, 2)}\n`)
await writeFile(`${outputBase}.md`, markdown)
console.log(`Wrote ${outputBase}.json`)
console.log(`Wrote ${outputBase}.md`)
