import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { object } from '../comparison/model.ts'
import { parsePoint, curveMatches } from './model.ts'
import { bdRate, summarizeBdRates, type BdRateResult, type QualityMetric } from './metrics.ts'

const [directory, referenceDirectory] = process.argv.slice(2)
if (!directory || !referenceDirectory)
  throw new Error('Usage: summarize-port.ts run-directory reference-engine-directory')
const summary = object(JSON.parse(await readFile(join(directory, 'summary.json'), 'utf8')))
if (typeof summary.variant !== 'string') throw new Error('Missing candidate variant')
const results = join(directory, `${summary.variant}-purejsimage`)
const comparisons: (BdRateResult & { id: string; metric: QualityMetric })[] = []
for (const id of await readdir(results)) {
  const candidate = object(JSON.parse(await readFile(join(results, id, 'result.json'), 'utf8')))
  const reference = object(
    JSON.parse(await readFile(join(referenceDirectory, id, 'result.json'), 'utf8')),
  )
  if (
    typeof reference.fixtureSha256 !== 'string' ||
    !curveMatches(candidate, reference.fixtureSha256, 'purejsimage', 4, 7) ||
    !Array.isArray(candidate.points) ||
    !Array.isArray(reference.points)
  )
    throw new Error(`Different inputs or incomplete curves: ${id}`)
  const own = candidate.points.map(parsePoint),
    peer = reference.points.map(parsePoint)
  if (own.length !== peer.length || own.some((p) => !peer.some((q) => q.setting === p.setting)))
    throw new Error(`Ladder differs: ${id}`)
  for (const metric of ['ssimulacra2', 'butteraugliNorm3', 'butteraugliMax'] as const) {
    const result = bdRate(
      own.map((p) => ({ bytes: p.bytes, quality: p[metric] })),
      peer.map((p) => ({ bytes: p.bytes, quality: p[metric] })),
      metric,
      metric === 'ssimulacra2'
        ? { minimum: 60, maximum: 90 }
        : metric === 'butteraugliMax'
          ? { minimum: 0.5, maximum: 3 }
          : undefined,
    )
    comparisons.push({ id, metric, ...result })
  }
}
const control = ['ssimulacra2', 'butteraugliNorm3', 'butteraugliMax'].map((metric) => {
  const rows = comparisons.filter((c) => c.metric === metric)
  return {
    metric,
    ...summarizeBdRates(rows.map((c) => c.percent)),
    fullBandCount: rows.filter((c) => c.coversRequiredRange).length,
  }
})
const report = {
  candidate: directory,
  reference: referenceDirectory,
  control,
  peers: summary.table,
  speedDiagnostic: summary.speed,
  comparisons,
  failures: summary.failures,
}
await writeFile(join(directory, 'against-control.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log(
  JSON.stringify(
    { control, peers: summary.table, speedDiagnostic: summary.speed, failures: summary.failures },
    null,
    2,
  ),
)
