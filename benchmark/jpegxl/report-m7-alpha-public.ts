import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { m7ExpansionCases, m7ExpansionSplit } from './m7-expansion-selection.ts'

const split = m7ExpansionSplit(process.env.PUREJSIMAGE_M7_EXPANSION_SPLIT)
const runId = process.argv[2]
const baselineRunId = process.argv[3]
if (
  !runId ||
  !baselineRunId ||
  !/^[a-z0-9-]+$/u.test(runId) ||
  !/^[a-z0-9-]+$/u.test(baselineRunId)
)
  throw new Error('Specify public run ID and unchanged direct-VarDCT baseline ID')
const root = `.tmp/jpegxl-m7/alpha-public-${split}-${runId}`
const baselineRoot = `.tmp/jpegxl-m7/alpha-${split}-${baselineRunId}`
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const record = (value: unknown): Record<string, unknown> => {
  if (!isRecord(value)) throw new Error('Expected record')
  return value
}
const points = (value: unknown): readonly Record<string, unknown>[] => {
  if (!Array.isArray(value)) throw new Error('Missing points')
  return value.map(record)
}
const hash = (value: Uint8Array): string => createHash('sha256').update(value).digest('hex')
const publicProtocolBytes = await readFile(`${root}/protocol.json`)
const publicProtocol = record(JSON.parse(publicProtocolBytes.toString('utf8')))
if (publicProtocol.split !== split || publicProtocol.ownEncoderPath !== 'public lossy selector')
  throw new Error('Unexpected alpha public encoder path')
const results: object[] = []
let modularPoints = 0,
  vardctPoints = 0,
  failures = 0
for (const entry of m7ExpansionCases(split, 'png')) {
  const source = await readFile(`.tmp/jpegxl-m7/sources/${entry.id}.png`)
  if (hash(source) !== entry.sourceSha256) throw new Error(`Source changed: ${entry.id}`)
  const pixels = await readFile(`.tmp/jpegxl-m7/expansion-inputs/${entry.id}/input.rgba8`)
  const visibleExactPixels = Uint8Array.from(pixels)
  for (let offset = 0; offset < visibleExactPixels.length; offset += 4)
    if (visibleExactPixels[offset + 3] === 0) visibleExactPixels.fill(0, offset, offset + 3)
  const visibleExactSha256 = hash(visibleExactPixels)
  const report = record(JSON.parse(await readFile(`${root}/${entry.id}/report.json`, 'utf8')))
  const baseline = record(
    JSON.parse(await readFile(`${baselineRoot}/${entry.id}/report.json`, 'utf8')),
  )
  if (
    report.id !== entry.id ||
    baseline.id !== entry.id ||
    report.sourceSha256 !== entry.sourceSha256
  )
    throw new Error(`Alpha report identity mismatch: ${entry.id}`)
  const current = points(report.points)
  const old = points(baseline.points)
  const own = current.filter((point) => point.engine === 'purejsimage')
  if (own.length !== 6) throw new Error(`Incomplete public alpha curve: ${entry.id}`)
  const choices: object[] = []
  for (const point of own) {
    const setting = point.setting
    const prior = old.find((row) => row.engine === 'purejsimage' && row.setting === setting)
    if (!prior || point.status !== 'measured' || prior.status !== 'measured') {
      failures++
      continue
    }
    if (
      typeof point.bytes !== 'number' ||
      typeof prior.bytes !== 'number' ||
      typeof point.encodedSha256 !== 'string' ||
      typeof prior.encodedSha256 !== 'string' ||
      point.alphaMaximumError !== 0 ||
      typeof point.independentMaximum !== 'number' ||
      point.independentMaximum > 1 ||
      typeof point.ownMaximum !== 'number' ||
      point.ownMaximum > 2
    )
      throw new Error(`Alpha correctness failure: ${entry.id} at ${setting}`)
    if (point.streamEncoding === 'modular') {
      modularPoints++
      if (point.bytes * 20 > prior.bytes * 19 || point.decodedSha256 !== visibleExactSha256)
        throw new Error(
          `Modular fallback changed visible pixels or missed size guard: ${entry.id} at ${setting}`,
        )
    } else if (point.streamEncoding === 'vardct') {
      vardctPoints++
      if (point.encodedSha256 !== prior.encodedSha256)
        throw new Error(`Direct VarDCT output changed unexpectedly: ${entry.id} at ${setting}`)
    } else throw new Error(`Unknown public alpha stream type: ${entry.id}`)
    choices.push({
      setting,
      encoding: point.streamEncoding,
      bytes: point.bytes,
      directBytes: prior.bytes,
      encodedSha256: point.encodedSha256,
      decodedSha256: point.decodedSha256,
      independentMaximum: point.independentMaximum,
      ownMaximum: point.ownMaximum,
      alphaMaximumError: point.alphaMaximumError,
      composites: point.composites,
    })
  }
  results.push({
    id: entry.id,
    sourceSha256: entry.sourceSha256,
    pixelsSha256: hash(pixels),
    visibleExactSha256,
    choices,
  })
}
if (failures) throw new Error(`${failures} public alpha points failed`)
const summary = {
  split,
  policy:
    'Modular selections preserve alpha and visible RGB exactly; RGB under zero alpha may be canonicalized only in lossy mode. They are reported separately and never inserted into VarDCT lossy-only matched-quality curves. Inspected observed families are regression evidence.',
  publicProtocolSha256: hash(publicProtocolBytes),
  baselineRunId,
  expectedSources: 6,
  expectedOwnPoints: 36,
  modularPoints,
  vardctPoints,
  failures,
  results,
  stablePromotionGatePassed: false,
}
await writeFile(`${root}/summary.json`, `${JSON.stringify(summary, null, 2)}\n`)
console.log(JSON.stringify({ split, modularPoints, vardctPoints, failures }))
