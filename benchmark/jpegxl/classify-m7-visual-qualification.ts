/** Classify final measured brackets without converting reference or sampling limits into passes. */
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import {
  type RecoveryPoint,
  recoveryBracket,
  recoveryMonotonicityViolations,
} from './m7-recovery-curves.ts'
import selection from './production-program/m7-corpus-selection.json' with { type: 'json' }

const [development, observed, output] = process.argv.slice(2)
if (!development || !observed || !output)
  throw new Error('Supply development directory, observed directory, output.json')
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const record = (value: unknown): Record<string, unknown> => {
  if (!isRecord(value)) throw new Error('Expected report object')
  return value
}
const finite = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error('Expected finite measurement')
  return value
}
const rows = []
const counts: Record<string, number> = {
  measured_adequate_bracket: 0,
  insufficient_sampling: 0,
  first_party_target_miss: 0,
  reference_target_not_reached_tested_configuration: 0,
  unsupported: 0,
  execution_or_correctness_failure: 0,
}
for (const entry of selection.cases) {
  const path = `${entry.split === 'development' ? development : observed}/${entry.id}/report.json`
  const bytes = await readFile(path)
  const report = record(JSON.parse(bytes.toString('utf8')))
  if (
    report.id !== entry.id ||
    report.sourceSha256 !== entry.sourceSha256 ||
    !Array.isArray(report.points)
  )
    throw new Error('Missing or changed source identity')
  const points = report.points.map(record)
  const curve = (engine: string): RecoveryPoint[] =>
    points
      .filter((point) => point.engine === engine && point.status === 'measured')
      .map((point) => ({
        setting: finite(point.setting),
        bytes: finite(point.bytes),
        score: finite(point.ssimulacra2),
      }))
  const firstParty = curve('purejsimage'),
    reference = curve('libjxl')
  for (const target of [70, 80, 90]) {
    const firstBracket = recoveryBracket(firstParty, target),
      referenceBracket = recoveryBracket(reference, target)
    const failed = points.some(
      (point) =>
        (point.engine === 'purejsimage' || point.engine === 'libjxl') && point.status === 'failed',
    )
    const firstMaximum = Math.max(...firstParty.map((point) => point.score)),
      referenceMaximum = Math.max(...reference.map((point) => point.score))
    const category =
      failed || firstParty.length === 0 || reference.length === 0
        ? 'execution_or_correctness_failure'
        : referenceMaximum < target
          ? 'reference_target_not_reached_tested_configuration'
          : firstMaximum < target
            ? 'first_party_target_miss'
            : !firstBracket ||
                !referenceBracket ||
                firstBracket.width > 3 ||
                referenceBracket.width > 3
              ? 'insufficient_sampling'
              : 'measured_adequate_bracket'
    counts[category] = (counts[category] ?? 0) + 1
    rows.push({
      split: entry.split,
      id: entry.id,
      target,
      category,
      firstParty: {
        maximum: firstMaximum,
        bracketWidth: firstBracket?.width ?? null,
        bracket: firstBracket ?? null,
        monotonicityViolations: recoveryMonotonicityViolations(firstParty),
      },
      reference: {
        maximum: referenceMaximum,
        bracketWidth: referenceBracket?.width ?? null,
        bracket: referenceBracket ?? null,
        monotonicityViolations: recoveryMonotonicityViolations(reference),
      },
      firstPartyAlsoBelowTarget: firstMaximum < target,
      inputPixelsSha256: report.normalizedSha256,
      rawReportPath: path,
      rawReportSha256: createHash('sha256').update(bytes).digest('hex'),
    })
  }
}
await writeFile(
  output,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      cases: selection.cases.length,
      targets: rows.length,
      policy:
        'Final approved six-point RGB8 grid, original family assignments. Three SSIMULACRA2 points is the existing diagnostic width for small rate decisions, not a new promotion gate. Reference-limited means only the tested configuration failed to reach the target. Historical floor controls remain separate. No missing or wide bracket becomes a comparison pass. No lossless points inserted.',
      counts,
      rows,
    },
    null,
    2,
  )}\n`,
)
console.log(counts)
