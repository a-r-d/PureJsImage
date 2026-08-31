import { spawnSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'

const workloads = [
  'inspect-24mp',
  'extract-base-24mp',
  'extract-map-24mp',
  'render-12mp-1x',
  'render-12mp-2x',
  'render-12mp-8x',
  'transform-render-24mp',
  'geometry-coprime-density',
  'geometry-resize-density',
  'crop-resize-24mp',
  'quarter-resize-24mp',
  'jpeg-reencode',
  'bit-preserving-repack',
  'avif-generic-decode',
  'avif-gain-map-encode',
  'evidence-off',
  'evidence-summary',
  'evidence-trace',
  'ordinary-jpeg',
  'ordinary-avif',
] as const

const selected = process.argv.includes('--quick')
  ? workloads.filter((item) =>
      [
        'inspect-24mp',
        'render-12mp-2x',
        'bit-preserving-repack',
        'avif-generic-decode',
        'avif-gain-map-encode',
      ].includes(item),
    )
  : workloads

const run = (workload: string): unknown => {
  const result = spawnSync(
    process.execPath,
    ['--expose-gc', 'benchmark/hdr-surgery/worker.ts', workload],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  )
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${workload} failed: ${result.stderr.trim()}`)
  try {
    return JSON.parse(result.stdout.trim())
  } catch (error) {
    throw new Error(`${workload} returned invalid JSON: ${String(error)}`)
  }
}

const results: unknown[] = []
for (const workload of selected) {
  const result =
    workload === 'transform-render-24mp'
      ? (() => {
          const repetitions = [run(workload), run(workload), run(workload)] as Array<
            Readonly<Record<string, unknown>>
          >
          repetitions.sort((left, right) => Number(left.wallMs) - Number(right.wallMs))
          const median = repetitions[1]
          if (median === undefined) throw new Error('Missing transformed-render median result')
          return { ...median, medianWallMs: median.wallMs, repetitions: repetitions.length }
        })()
      : run(workload)
  results.push(result)
  console.log(JSON.stringify(result))
}

const report = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  isolatedProcessPerWorkload: true,
  fixtureManifest: 'benchmark/hdr-surgery/fixture-manifest.json',
  results,
}
await mkdir('.tmp/hdr-surgery', { recursive: true })
await writeFile('.tmp/hdr-surgery/latest.json', `${JSON.stringify(report, null, 2)}\n`)
console.log('JSON: .tmp/hdr-surgery/latest.json')
