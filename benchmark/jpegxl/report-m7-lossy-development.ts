import { readFile, writeFile } from 'node:fs/promises'
import { interpolateM7Quality, type M7QualityPoint } from './m7-quality-curves.ts'
import selection from './production-program/m7-corpus-selection.json' with { type: 'json' }

const directory = process.argv[2]
if (!directory) throw new Error('Usage: node report-m7-lossy-development.ts run-directory')
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const record = (value: unknown): Record<string, unknown> => {
  if (!isRecord(value)) throw new Error('Expected report object')
  return value
}
const finite = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error('Expected finite metric')
  return value
}
const protocol = record(JSON.parse(await readFile(`${directory}/protocol.json`, 'utf8')))
if (typeof protocol.sourceFingerprint !== 'string') throw new Error('Missing source fingerprint')
const split = protocol.split ?? 'development'
if (split !== 'development' && split !== 'holdout') throw new Error('Invalid report split')
const engines = ['purejsimage', 'libjxl', 'mozjpeg', 'webp', 'avif'] as const
type Engine = (typeof engines)[number]
interface MeasuredPoint {
  readonly engine: Engine
  readonly setting: number
  readonly bytes: number
  readonly ssimulacra2: number
  readonly butteraugli: number
}
const measuredPoint = (raw: unknown): MeasuredPoint => {
  const point = record(raw)
  const engine = engines.find((engine) => engine === point.engine)
  const bytes = finite(point.bytes)
  if (!engine || !Number.isSafeInteger(bytes) || bytes < 1)
    throw new Error('Invalid encoded curve point')
  return {
    engine,
    bytes,
    setting: finite(point.setting),
    ssimulacra2: finite(point.ssimulacra2),
    butteraugli: finite(point.butteraugli),
  }
}
const targets = [
  { metric: 'ssimulacra2', score: 70 },
  { metric: 'ssimulacra2', score: 80 },
  { metric: 'ssimulacra2', score: 90 },
  { metric: 'butteraugli', score: 1 },
  { metric: 'butteraugli', score: 2 },
] as const
const results: object[] = []
const comparisons: {
  id: string
  category: string
  metric: string
  score: number
  engine: Engine
  ratio: number
}[] = []
let complete = 0,
  missing = 0,
  failed = 0
for (const entry of selection.cases.filter((entry) => entry.split === split)) {
  let report: Record<string, unknown>
  try {
    report = record(JSON.parse(await readFile(`${directory}/${entry.id}/report.json`, 'utf8')))
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
    results.push({ id: entry.id, status: 'missing' })
    missing++
    continue
  }
  if (report.id !== entry.id || report.sourceFingerprint !== protocol.sourceFingerprint)
    throw new Error(`${entry.id}: mismatched report provenance`)
  if (report.status === 'failed') {
    results.push({ id: entry.id, status: 'failed', error: report.error })
    failed++
    continue
  }
  if (report.sourceSha256 !== entry.sourceSha256 || !Array.isArray(report.points))
    throw new Error(`${entry.id}: invalid source identity or points`)
  const points: MeasuredPoint[] = [],
    errors: Record<string, unknown>[] = [],
    keys = new Set<string>()
  for (const raw of report.points) {
    const point = record(raw)
    if (point.status === 'failed') {
      errors.push(point)
      continue
    }
    if (point.status !== 'measured') throw new Error(`${entry.id}: unknown measurement status`)
    const measured = measuredPoint(point),
      key = `${measured.engine}-${measured.setting}`
    if (keys.has(key)) throw new Error(`${entry.id}: duplicate curve coordinate`)
    const coordinates =
      measured.engine === 'purejsimage' || measured.engine === 'libjxl'
        ? [0.25, 0.5, 1, 2, 3, 5]
        : [40, 55, 70, 80, 90, 97]
    if (!coordinates.includes(measured.setting))
      throw new Error(`${entry.id}: coordinate is outside the frozen protocol`)
    keys.add(key)
    points.push(measured)
  }
  const completeCurve =
    errors.length === 0 &&
    engines.every((engine) => points.filter((point) => point.engine === engine).length === 6)
  if (completeCurve) complete++
  if (errors.length > 0) failed++
  const matches: object[] = []
  for (const target of targets) {
    const bytes: Partial<Record<Engine, number>> = {}
    for (const engine of engines) {
      const curve: M7QualityPoint[] = points
        .filter((point) => point.engine === engine)
        .map((point) => ({ bytes: point.bytes, score: point[target.metric] }))
      // A partial curve cannot stand in for the frozen six-coordinate curve.
      if (curve.length !== 6 || errors.some((error) => error.engine === engine)) continue
      const matched = interpolateM7Quality(curve, target.score, target.metric === 'ssimulacra2')
      if (matched !== undefined) bytes[engine] = matched
    }
    const ratios: Partial<Record<Engine, number>> = {}
    const own = bytes.purejsimage
    if (own !== undefined)
      for (const engine of engines) {
        const reference = bytes[engine]
        if (engine === 'purejsimage' || reference === undefined) continue
        ratios[engine] = own / reference
        comparisons.push({
          id: entry.id,
          category: entry.category,
          metric: target.metric,
          score: target.score,
          engine,
          ratio: own / reference,
        })
      }
    matches.push({
      ...target,
      interpolatedBytes: bytes,
      ratios,
      unbracketedOrIncomplete: engines.filter((engine) => bytes[engine] === undefined),
    })
  }
  results.push({
    id: entry.id,
    category: entry.category,
    status: completeCurve ? 'complete' : errors.length ? 'failed' : 'partial',
    measured: points.length,
    errors,
    matches,
  })
}
// The source taxonomy determines strata before the held-out lossy measurements.
// Museum artwork photographs stay in the photo cohort; difficult sources are not removed.
const photoCategories = [
  '1000-lilith-photos-general',
  '1200-lilith-interiors',
  '1400-lilith-nature',
  '1600-lilith-food',
  '2000-unsplash-people',
  '2400-unsplash-textures',
  '3000-art-institute-of-chicago-photos',
  '3300-met-museum-photos',
]
const selected = selection.cases.filter((entry) => entry.split === split)
const cohorts = [
  { name: 'all', categories: [...new Set(selected.map((entry) => entry.category))] },
  { name: 'photos', categories: photoCategories },
  ...[...new Set(selected.map((entry) => entry.category))].map((category) => ({
    name: category,
    categories: [category],
  })),
]
const summaries: object[] = []
const stratifiedSummaries: object[] = []
for (const cohort of cohorts) {
  const expected = selected.filter((entry) => cohort.categories.includes(entry.category)).length
  const measurements: object[] = []
  for (const target of targets)
    for (const engine of engines) {
      if (engine === 'purejsimage') continue
      const matches = comparisons
        .filter(
          (value) =>
            cohort.categories.includes(value.category) &&
            value.metric === target.metric &&
            value.score === target.score &&
            value.engine === engine,
        )
        .sort((a, b) => a.ratio - b.ratio)
      const count = matches.length
      if (count === 0) {
        measurements.push({ ...target, engine, matched: 0, missingOrUnbracketed: expected })
        continue
      }
      const lower = matches[Math.floor((count - 1) / 2)],
        upper = matches[Math.floor(count / 2)]
      if (!lower || !upper) throw new Error('Missing median measurements')
      measurements.push({
        ...target,
        engine,
        matched: count,
        missingOrUnbracketed: expected - count,
        medianRatio: (lower.ratio + upper.ratio) / 2,
        p90Ratio: matches[Math.ceil(count * 0.9) - 1]?.ratio,
        worst: matches.slice(-10).reverse(),
      })
    }
  if (cohort.name === 'all') summaries.push(...measurements)
  else stratifiedSummaries.push({ ...cohort, expected, summaries: measurements })
}
const summary = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  split,
  resolution: protocol.resolution ?? 'original',
  preprocessing: protocol.preprocessing,
  policy:
    'Frozen-split diagnostic. Each image has one vote per metric/band/comparator. Nearest-rank p90. Partial curves and unbracketed targets are missing, never passes. Holdout, transparency/HDR, metadata, defects and timing gates remain separate.',
  sourceFingerprint: protocol.sourceFingerprint,
  expected: 120,
  complete,
  missing,
  failed,
  stablePromotionGatePassed: false,
  summaries,
  stratifiedSummaries,
  results,
}
await writeFile(`${directory}/summary.json`, `${JSON.stringify(summary, null, 2)}\n`)
console.log(JSON.stringify({ complete, missing, failed, summaries }, null, 2))
