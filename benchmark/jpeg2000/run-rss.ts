import { spawnSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

type Action = 'metadata' | 'resize-jpeg'
type Mode = 'cold' | 'warm'

const worker = fileURLToPath(new URL('./rss-worker.ts', import.meta.url))
const fixture = fileURLToPath(
  new URL('../corpus/files/jp2/wikimedia-blue-marble-openjpeg-lossless.jp2', import.meta.url),
)
const cases = [
  { action: 'metadata', mode: 'cold' },
  { action: 'metadata', mode: 'warm' },
  { action: 'resize-jpeg', mode: 'cold' },
  { action: 'resize-jpeg', mode: 'warm' },
] as const satisfies readonly { readonly action: Action; readonly mode: Mode }[]

const measurements: unknown[] = []
for (const measurement of cases) {
  const child = spawnSync(
    process.execPath,
    ['--expose-gc', worker, measurement.action, measurement.mode, fixture],
    {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      timeout: 120_000,
    },
  )
  if (child.error) throw child.error
  if (child.status !== 0) {
    throw new Error(
      `${measurement.action}/${measurement.mode} failed with status ${child.status}: ${child.stderr.trim()}`,
    )
  }
  const output = child.stdout.trim()
  if (!output) throw new Error(`${measurement.action}/${measurement.mode} produced no result`)
  const parsed: unknown = JSON.parse(output)
  measurements.push(parsed)
}

const report = {
  generatedAt: new Date().toISOString(),
  profile: 'jpeg2000-rss',
  fixture: 'wikimedia-blue-marble-openjpeg-lossless.jp2',
  dimensions: '1920x2172',
  isolatedProcessPerMeasurement: true,
  validation: { passed: true, outputRequired: true },
  notes: {
    maximumRss: 'Absolute process high-water mark; warm measurements include warmup.',
    baseline: 'Captured after five explicit GC and event-loop turns.',
    correctness: 'Metadata dimensions and independently decoded JPEG output are required.',
  },
  measurements,
}
const outputFlag = process.argv.indexOf('--output')
const requestedOutput = outputFlag === -1 ? undefined : process.argv[outputFlag + 1]
if (outputFlag !== -1 && !requestedOutput) throw new Error('--output requires a path')
const outputPath =
  requestedOutput ??
  `benchmark/results/jpeg2000-rss-${new Date().toISOString().replaceAll(/[:.]/gu, '-')}.json`
const serialized = `${JSON.stringify(report, undefined, 2)}\n`
await writeFile(outputPath, serialized)
await writeFile(
  outputPath.replace(/\.json$/u, '.md'),
  `# JPEG 2000 RSS benchmark\n\n- Generated: ${report.generatedAt}\n- Fixture: ${report.fixture} (${report.dimensions})\n- Validation: metadata and independent JPEG output validation passed\n- Result: ${outputPath}\n`,
)
console.log(`Wrote ${outputPath}`)
console.log(serialized.trim())
