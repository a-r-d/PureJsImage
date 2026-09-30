/** Read-only classification of the retained M7 RGB8 curves and supplementary endpoints. */
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import {
  recoveryBracket,
  recoveryFrontier,
  recoveryMonotonicityViolations,
  type RecoveryPoint,
} from './m7-recovery-curves.ts'
import artifacts from './production-program/m7-prompt2-artifacts.json' with { type: 'json' }
import ceiling from './production-program/m7-prompt10-native-ceiling.json' with { type: 'json' }
import lowEndpoints from './production-program/m7-prompt11-low-endpoints.json' with { type: 'json' }
import development from './production-program/m7-prompt9-quality-development.json' with {
  type: 'json',
}
import holdout from './production-program/m7-prompt9-quality-holdout.json' with { type: 'json' }

const output = process.argv[2]
if (!output)
  throw new Error(
    'Usage: node benchmark/jpegxl/classify-m7-recovery.ts output.json [maximum-score-width]',
  )
const maximumWidth = Number(process.argv[3] ?? 3)
if (!Number.isFinite(maximumWidth) || maximumWidth <= 0 || maximumWidth > 10)
  throw new Error('Maximum score interval width must be in (0, 10]')
const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const object = (value: unknown): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('Expected object')
  return value as Record<string, unknown>
}
const numeric = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error('Expected finite number')
  return value
}
const text = (value: unknown): string => {
  if (typeof value !== 'string') throw new Error('Expected string')
  return value
}
const sha256 = async (path: string): Promise<string> => hash(await readFile(path))
type Engine = 'purejsimage' | 'libjxl'
interface ScoredPoint extends RecoveryPoint {
  readonly engine: Engine
  readonly source: string
  readonly encodedSha256: string
}
const scoredPoint = (value: unknown, source: string): ScoredPoint | undefined => {
  const row = object(value)
  if (row.engine !== 'purejsimage' && row.engine !== 'libjxl') return undefined
  if (row.status !== undefined && row.status !== 'measured') return undefined
  if (row.ssimulacra2 === undefined) return undefined
  return {
    engine: row.engine,
    setting: numeric(row.setting ?? row.distance),
    bytes: numeric(row.bytes),
    score: numeric(row.ssimulacra2),
    encodedSha256: text(row.encodedSha256),
    source,
  }
}
const rawCases = new Map<string, { points: ScoredPoint[]; failed: boolean; inputSha256: string }>()
for (const summary of [development, holdout]) {
  const split = summary.split
  for (const item of summary.results) {
    const key = `${split}/${item.id}`
    const expected = artifacts.cases.find((row) => row.split === split && row.id === item.id)
    if (!expected || item.status !== 'complete' || item.errors.length)
      throw new Error(`Incomplete approved case ${key}`)
    const path = `${summary.qualificationOverlay.completeRawCaseDirectory}/${item.id}/report.json`
    const raw = object(JSON.parse(await readFile(path, 'utf8')) as unknown)
    if (raw.normalizedSha256 !== expected.normalizedSha256 || raw.id !== item.id)
      throw new Error(`Normalized source identity mismatch ${key}`)
    const entries = raw.points
    if (!Array.isArray(entries)) throw new Error(`Missing raw points ${key}`)
    const points = entries
      .map((entry: unknown) => scoredPoint(entry, 'approved-2mp'))
      .filter((point): point is ScoredPoint => point !== undefined)
    rawCases.set(key, {
      points,
      failed: entries.some((entry: unknown) => object(entry).status === 'failed'),
      inputSha256: expected.normalizedSha256,
    })
  }
}
if (rawCases.size !== 240) throw new Error(`Expected 240 approved cases, found ${rawCases.size}`)

for (const entry of lowEndpoints.results) {
  const key = `${entry.split}/${entry.id}`
  const item = rawCases.get(key)
  if (!item || entry.inputPixelsSha256 !== item.inputSha256)
    throw new Error(`Low endpoint source mismatch ${key}`)
  const point = scoredPoint(entry, 'supplementary-low')
  if (point) item.points.push(point)
}
for (const entry of ceiling.results) {
  const key = `${entry.split}/${entry.id}`
  const item = rawCases.get(key)
  if (!item || entry.inputPixelsSha256 !== item.inputSha256)
    throw new Error(`High endpoint source mismatch ${key}`)
  item.points.push({
    engine: 'libjxl',
    setting: entry.distance,
    bytes: entry.bytes,
    score: entry.ssimulacra2,
    encodedSha256: entry.encodedSha256,
    source: 'supplementary-high',
  })
}
const counts: Record<string, number> = {}
const rows = []
for (const [key, item] of rawCases) {
  const [split, id] = key.split('/')
  for (const target of [70, 80, 90]) {
    const first = item.points.filter((point) => point.engine === 'purejsimage')
    const native = item.points.filter((point) => point.engine === 'libjxl')
    const ownBracket = recoveryBracket(first, target)
    const nativeBracket = recoveryBracket(native, target)
    const highControl = ceiling.results.find((entry) => entry.split === split && entry.id === id)
    const referenceFloorMiss =
      target === 90 && highControl !== undefined && highControl.ssimulacra2 < target
    const ownAtFloor = first.find((point) => point.setting === 0.25)
    const firstPartyMiss =
      ownAtFloor !== undefined &&
      ownAtFloor.score < target &&
      first.every((point) => point.score < target)
    const category = item.failed
      ? 'execution_or_correctness_failure'
      : first.length === 0 || native.length === 0
        ? 'unsupported'
        : referenceFloorMiss
          ? 'reference_target_not_reached'
          : firstPartyMiss
            ? 'first_party_target_miss'
            : !ownBracket ||
                !nativeBracket ||
                ownBracket.width > maximumWidth ||
                nativeBracket.width > maximumWidth
              ? 'insufficient_sampling'
              : 'measured_adequate_bracket'
    counts[category] = (counts[category] ?? 0) + 1
    rows.push({
      split,
      id,
      target,
      category,
      inputPixelsSha256: item.inputSha256,
      rawCasePath: `.tmp/jpegxl-m7/prompt9-qualified-complete-${split}/${id}/report.json`,
      firstParty: {
        measured: first.length,
        minimum: Math.min(...first.map((point) => point.score)),
        maximum: Math.max(...first.map((point) => point.score)),
        bracketWidth: ownBracket?.width ?? null,
        monotonicityViolations: recoveryMonotonicityViolations(first),
        frontierPoints: recoveryFrontier(first).length,
      },
      reference: {
        measured: native.length,
        minimum: Math.min(...native.map((point) => point.score)),
        maximum: Math.max(...native.map((point) => point.score)),
        bracketWidth: nativeBracket?.width ?? null,
        monotonicityViolations: recoveryMonotonicityViolations(native),
        frontierPoints: recoveryFrontier(native).length,
      },
    })
  }
}
const sourceReports = await Promise.all(
  [
    'm7-prompt9-quality-development.json',
    'm7-prompt9-quality-holdout.json',
    'm7-prompt10-native-ceiling.json',
    'm7-prompt11-low-endpoints.json',
    'm7-prompt2-artifacts.json',
  ].map(async (name) => ({
    path: `benchmark/jpegxl/production-program/${name}`,
    sha256: await sha256(`benchmark/jpegxl/production-program/${name}`),
  })),
)
const report = {
  schemaVersion: 1,
  policy:
    'RGB8 original protocol scores. Supplementary endpoints retain approved pixels and splits. Width is SSIMULACRA2 score points on the measured nondominated frontier. A reference-limit category is neither a PureJsImage failure nor a comparison pass. No ratio is inferred from a missing or wide bracket.',
  maximumWidth,
  cases: rawCases.size,
  targets: rows.length,
  counts,
  sourceReports,
  rows,
}
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify({ cases: rawCases.size, targets: rows.length, counts }))
