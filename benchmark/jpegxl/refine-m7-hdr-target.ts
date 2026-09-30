/** Bounded manual HDR refinement on a frozen grid; never changes the encoder or drops a family. */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { m7ExpansionCases, m7ExpansionSplit } from './m7-expansion-selection.ts'
import { interpolateM7Quality } from './m7-quality-curves.ts'

const [baselineRunId, runId, targetText = '70'] = process.argv.slice(2)
const target = Number(targetText)
if (
  !baselineRunId ||
  !runId ||
  !/^[a-z0-9-]+$/u.test(baselineRunId) ||
  !/^[a-z0-9-]+$/u.test(runId) ||
  ![70, 80, 90].includes(target)
)
  throw new Error('Usage: refine-m7-hdr-target.ts frozen-grid-run-id unique-run-id 70|80|90')
const split = m7ExpansionSplit(process.env.PUREJSIMAGE_M7_EXPANSION_SPLIT)
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const record = (value: unknown): Record<string, unknown> => {
  if (!isRecord(value)) throw new Error('Expected record')
  return value
}
const finite = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Expected finite value')
  return value
}
interface Point {
  setting: number
  bytes: number
  score: number
  path: string
  reportSha256: string
}
const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const fingerprints = new Map<string, string>()
const load = async (
  id: string,
  engine: string,
  setting: number,
  control: boolean,
): Promise<Point> => {
  const selectedRun = control ? `${runId}-${engine}` : baselineRunId
  const path = `.tmp/jpegxl-m7/hdr-${split}-${selectedRun}/${id}/distance-${setting}/report.json`
  const bytes = await readFile(path)
  const report = record(JSON.parse(bytes.toString('utf8')))
  const protocol = record(report.protocol)
  if (protocol.id !== id || protocol.distance !== setting || protocol.split !== split)
    throw new Error('HDR refinement source or setting mismatch')
  const fingerprint = JSON.stringify([
    protocol.inputSha256,
    protocol.sourceSha256,
    protocol.sourceFiles,
    protocol.oracleFiles,
    protocol.mappingProtocolSha256,
  ])
  const prior = fingerprints.get(id)
  if (prior !== undefined && prior !== fingerprint)
    throw new Error('HDR refinement provenance changed')
  fingerprints.set(id, fingerprint)
  if (!Array.isArray(report.results)) throw new Error('Missing HDR points')
  const point = report.results.map(record).find((p) => p.engine === engine)
  if (!point || point.status !== 'measured' || !Array.isArray(point.displays))
    throw new Error('HDR point failed')
  const display = point.displays.map(record)[0]
  if (!display || display.headroom !== 1) throw new Error('Missing headroom-1 display')
  return {
    setting,
    bytes: finite(point.bytes),
    score: finite(display.ssimulacra2),
    path,
    reportSha256: hash(bytes),
  }
}
const frontier = (points: readonly Point[]): Point[] => {
  const sorted = [...points].sort((a, b) => b.score - a.score || a.bytes - b.bytes)
  let cheapest = Infinity
  return sorted
    .filter((point) => {
      if (point.bytes >= cheapest) return false
      cheapest = point.bytes
      return true
    })
    .reverse()
}
const bracket = (points: readonly Point[]): readonly [Point, Point] | undefined => {
  const curve = frontier(points)
  for (let i = 0; i + 1 < curve.length; i++) {
    const lo = curve[i],
      hi = curve[i + 1]
    if (lo && hi && lo.score <= target && hi.score >= target) return [lo, hi]
  }
  return undefined
}
const harnessSha256 = hash(await readFile(import.meta.filename))
const results: object[] = []
const ratios: number[] = [],
  upperBounds: number[] = []
const statistics = (values: readonly number[]) => {
  const ordered = [...values].sort((a, b) => a - b),
    n = ordered.length
  if (!n) return undefined
  return {
    median: ((ordered[Math.floor((n - 1) / 2)] ?? 0) + (ordered[Math.floor(n / 2)] ?? 0)) / 2,
    p90: ordered[Math.ceil(n * 0.9) - 1],
    worst: ordered.at(-1),
  }
}
for (const entry of m7ExpansionCases(split, 'hdr')) {
  const comparisons: {
    engine: string
    matchedBytes: number | undefined
    minimumBytes: number | undefined
    maximumBytes: number | undefined
    intervalWidth: number | undefined
    status: string
  }[] = []
  for (const engine of ['purejsimage', 'libjxl'] as const) {
    const points: Point[] = []
    for (const setting of [0.25, 0.5, 1, 2, 3, 5])
      points.push(await load(entry.id, engine, setting, false))
    let stop = 'search_limit'
    for (let attempt = 0; attempt < 4; attempt++) {
      const pair = bracket(points)
      if (!pair) {
        stop = 'unbracketed'
        break
      }
      const [low, high] = pair
      if (high.score - low.score <= 3) {
        stop = 'adequate_bracket'
        break
      }
      if (low.setting <= high.setting) {
        stop = 'nonmonotonic_setting_bracket'
        break
      }
      const fraction = Math.max(0.2, Math.min(0.8, (target - low.score) / (high.score - low.score)))
      const setting = Number((low.setting + fraction * (high.setting - low.setting)).toFixed(6))
      if (points.some((p) => p.setting === setting)) {
        stop = 'setting_resolution'
        break
      }
      let point: Point
      try {
        point = await load(entry.id, engine, setting, true)
      } catch (error) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
        const child = spawnSync(
          process.execPath,
          [
            'benchmark/jpegxl/evaluate-m7-hdr-development.ts',
            entry.id,
            String(setting),
            `${runId}-${engine}`,
            engine === 'libjxl' ? '--native-control' : '--own-control',
          ],
          { stdio: 'inherit' },
        )
        if (child.status !== 0) throw new Error(`HDR refinement failed: ${entry.id} ${engine}`)
        point = await load(entry.id, engine, setting, true)
      }
      points.push(point)
    }
    const pair = bracket(points)
    const intervalWidth = pair ? pair[1].score - pair[0].score : undefined
    if (intervalWidth !== undefined && intervalWidth <= 3) stop = 'adequate_bracket'
    const ordered = [...points].sort((a, b) => a.setting - b.setting)
    const nonmonotonic = ordered
      .filter((p, i) => i > 0 && p.score > (ordered[i - 1]?.score ?? Infinity))
      .map((p) => p.setting)
    const matchedBytes = interpolateM7Quality(points, target)
    comparisons.push({
      engine,
      matchedBytes,
      intervalWidth,
      status: stop,
      minimumBytes: pair?.[0].bytes,
      maximumBytes: pair?.[1].bytes,
    })
    results.push({
      id: entry.id,
      engine,
      target,
      domain: 'headroom-1',
      status: stop,
      intervalWidth,
      nonmonotonic,
      points,
      frontier: frontier(points),
      matchedBytes,
    })
  }
  const own = comparisons[0],
    native = comparisons[1]
  const ratio =
    own?.matchedBytes !== undefined && native?.matchedBytes !== undefined
      ? own.matchedBytes / native.matchedBytes
      : undefined
  const lowerBound =
    own?.minimumBytes !== undefined && native?.maximumBytes !== undefined
      ? own.minimumBytes / native.maximumBytes
      : undefined
  const upperBound =
    own?.maximumBytes !== undefined && native?.minimumBytes !== undefined
      ? own.maximumBytes / native.minimumBytes
      : undefined
  if (ratio !== undefined) ratios.push(ratio)
  if (upperBound !== undefined) upperBounds.push(upperBound)
  results.push({
    id: entry.id,
    comparison: true,
    target,
    ratio,
    lowerBound,
    upperBound,
    boundPolicy:
      'On each nondominated measured frontier, target bytes lie between the measured bracketing byte counts. Own-above-target bytes divided by reference-below-target bytes is a conservative upper bound. No extrapolation; a wide score interval remains unresolved for fine rate claims.',
    adequate: comparisons.every((c) => c.status === 'adequate_bracket'),
  })
  await writeFile(
    `.tmp/jpegxl-m7/hdr-refinement-${runId}.json`,
    `${JSON.stringify({ split, harnessSha256, summary: { matched: ratios.length, interpolated: statistics(ratios), conservativeUpper: statistics(upperBounds) }, baselineRunId, target, maximumNewPointsPerEngineAndFamily: 4, intervalWidthMaximum: 3, policy: 'Headroom-1 SSIMULACRA2; bounded measured refinement of every original family. Preserve grid results and all raw controls, nondominated points, nonmonotonicity and unresolved brackets. No extrapolation, codec changes, source exclusions or automatic promotion.', results }, null, 2)}\n`,
  )
}
