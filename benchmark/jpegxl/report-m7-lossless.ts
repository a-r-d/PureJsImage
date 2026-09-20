import { readFile, writeFile } from 'node:fs/promises'

const directory = process.argv[2],
  output = process.argv[3]
if (!directory || !output) throw new Error('Usage: report-m7-lossless.ts run-directory output.json')
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const report: unknown = JSON.parse(await readFile(`${directory}/report.json`, 'utf8'))
const protocol: unknown = JSON.parse(await readFile(`${directory}/protocol.json`, 'utf8'))
if (
  !object(report) ||
  !Array.isArray(report.results) ||
  typeof report.expected !== 'number' ||
  !object(protocol)
)
  throw new Error('Invalid lossless report')
const ratios: number[] = [],
  categories = new Map<string, number[]>(),
  ids = new Set<string>()
let failed = 0
for (const value of report.results) {
  if (!object(value) || typeof value.id !== 'string' || ids.has(value.id))
    throw new Error('Invalid or duplicate result identity')
  ids.add(value.id)
  if (value.status !== 'verified') {
    failed++
    continue
  }
  if (
    typeof value.ratio !== 'number' ||
    !Number.isFinite(value.ratio) ||
    value.ratio <= 0 ||
    typeof value.pureBytes !== 'number' ||
    !Number.isSafeInteger(value.pureBytes) ||
    value.pureBytes <= 0 ||
    typeof value.nativeBytes !== 'number' ||
    !Number.isSafeInteger(value.nativeBytes) ||
    value.nativeBytes <= 0 ||
    value.ratio !== value.pureBytes / value.nativeBytes ||
    typeof value.category !== 'string' ||
    typeof value.normalizedHash !== 'string' ||
    !Array.isArray(value.oracles) ||
    value.oracles.length !== 2
  )
    throw new Error(`Invalid verified measurement ${value.id}`)
  const oracleNames = new Set<string>()
  for (const oracle of value.oracles) {
    if (
      !object(oracle) ||
      (oracle.oracle !== 'libjxl' && oracle.oracle !== 'jxl-rs') ||
      oracle.exact !== true ||
      oracle.decodedHash !== value.normalizedHash
    )
      throw new Error(`Invalid independent exactness evidence ${value.id}`)
    oracleNames.add(oracle.oracle)
  }
  if (oracleNames.size !== 2) throw new Error('Duplicate exactness oracle')
  ratios.push(value.ratio)
  const group = categories.get(value.category) ?? []
  group.push(value.ratio)
  categories.set(value.category, group)
}
const summarize = (values: number[]) => {
  values.sort((a, b) => a - b)
  const middle = Math.floor(values.length / 2)
  return {
    count: values.length,
    median:
      values.length === 0
        ? null
        : values.length % 2 === 1
          ? (values[middle] ?? null)
          : ((values[middle - 1] ?? 0) + (values[middle] ?? 0)) / 2,
    p90: values[Math.ceil(values.length * 0.9) - 1] ?? null,
    worst: values.at(-1) ?? null,
  }
}
const summary = summarize(ratios)
const complete = ids.size === report.expected && report.completed === report.expected
const sizeTargetsPassed =
  complete &&
  failed === 0 &&
  summary.median !== null &&
  summary.median <= 1.25 &&
  summary.p90 !== null &&
  summary.p90 <= 1.4 &&
  summary.worst !== null &&
  summary.worst <= 1.75
const result = {
  schemaVersion: 1,
  protocol,
  completed: ids.size,
  expected: report.expected,
  verified: ratios.length,
  failed,
  ratios: summary,
  sizeTargetsPassed,
  aggregation:
    'One image per vote; arithmetic midpoint median for even counts; nearest-rank p90; every failed case retained. Class summaries do not replace the complete-cohort result.',
  classes: [...categories]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, values]) => ({ category, ...summarize(values) })),
  promotionGatePassed: false,
  qualification:
    'This report checks only its declared cohort size and independent exactness. Separate held-out, high-depth/alpha, baseline-reduction, resource and performance evidence is required for full milestone qualification.',
  results: report.results,
}
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`)
console.log(
  JSON.stringify({ output, completed: ids.size, failed, ratios: summary, sizeTargetsPassed }),
)
