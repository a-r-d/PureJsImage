import { createHash } from 'node:crypto'
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import selection from './production-program/m7-corpus-selection.json' with { type: 'json' }

const [baseDirectory, publicReportPath, outputDirectory] = process.argv.slice(2)
if (!baseDirectory || !publicReportPath || !outputDirectory)
  throw new Error('Specify base quality directory, public selector report and output directory')
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const record = (value: unknown): Record<string, unknown> => {
  if (!isRecord(value)) throw new Error('Expected report object')
  return value
}
const array = (value: unknown): readonly unknown[] => {
  if (!Array.isArray(value)) throw new Error('Expected report array')
  return value
}
const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const baseProtocolBytes = await readFile(`${baseDirectory}/protocol.json`)
const publicBytes = await readFile(publicReportPath)
const baseProtocol = record(JSON.parse(baseProtocolBytes.toString('utf8')))
const publicReport = record(JSON.parse(publicBytes.toString('utf8')))
const split = baseProtocol.split
if (split !== 'development' && split !== 'holdout') throw new Error('Invalid base split')
const cases = selection.cases.filter((entry) => entry.split === split)
if (cases.length !== 120 || baseProtocol.resolution !== '2mp')
  throw new Error('Overlay requires a complete approved 2 MP split')
const publicPoints = array(publicReport.results).map(record)
const selectedIds = new Set<string>()
for (const point of publicPoints) {
  if (point.status !== 'measured' || point.engine !== 'purejsimage')
    throw new Error('Public selector report has an unmeasured point')
  if (typeof point.id !== 'string' || !selection.cases.some((entry) => entry.id === point.id))
    throw new Error('Public selector source is outside the frozen corpus')
  if (cases.some((entry) => entry.id === point.id)) selectedIds.add(point.id)
}
if (selectedIds.size !== (split === 'development' ? 4 : 2))
  throw new Error('Public selector overlay has incomplete source coverage')
await mkdir(outputDirectory)
await writeFile(`${outputDirectory}/protocol.json`, baseProtocolBytes)
const overlays: object[] = []
for (const entry of cases) {
  const source = `${baseDirectory}/${entry.id}`
  if (!selectedIds.has(entry.id)) {
    await symlink(resolve(source), `${outputDirectory}/${entry.id}`, 'dir')
    continue
  }
  const report = record(JSON.parse(await readFile(`${source}/report.json`, 'utf8')))
  if (
    report.id !== entry.id ||
    report.sourceSha256 !== entry.sourceSha256 ||
    report.sourceFingerprint !== baseProtocol.sourceFingerprint ||
    !Array.isArray(report.points)
  )
    throw new Error(`Base report identity mismatch: ${entry.id}`)
  const points = array(report.points).map(record)
  const replacements = publicPoints.filter((point) => point.id === entry.id)
  if (
    replacements.length !== 2 ||
    ![2, 3].every((distance) => replacements.some((point) => point.distance === distance))
  )
    throw new Error(`Public selector coordinates are incomplete: ${entry.id}`)
  for (const replacement of replacements) {
    if (
      replacement.inputPixelsSha256 !== report.normalizedSha256 ||
      replacement.width !== report.width ||
      replacement.height !== report.height ||
      typeof replacement.distance !== 'number' ||
      typeof replacement.bytes !== 'number' ||
      typeof replacement.encodedSha256 !== 'string' ||
      typeof replacement.decodedSha256 !== 'string' ||
      typeof replacement.ssimulacra2 !== 'number' ||
      typeof replacement.butteraugli !== 'number' ||
      typeof replacement.independentMaximum !== 'number' ||
      replacement.independentMaximum > 2
    )
      throw new Error(`Public selector provenance or decoding mismatch: ${entry.id}`)
    const index = points.findIndex(
      (point) => point.engine === 'purejsimage' && point.setting === replacement.distance,
    )
    if (index < 0) throw new Error(`Missing base coordinate: ${entry.id}`)
    points[index] = {
      engine: 'purejsimage',
      setting: replacement.distance,
      status: 'measured',
      bytes: replacement.bytes,
      encodedSha256: replacement.encodedSha256,
      decodedSha256: replacement.decodedSha256,
      ssimulacra2: replacement.ssimulacra2,
      butteraugli: replacement.butteraugli,
      maximumIndependentDifference: replacement.independentMaximum,
      ownVerification: replacement.ownVerification,
      frames: replacement.frames,
      publicSelectorEvidence: { reportPath: publicReportPath, reportSha256: hash(publicBytes) },
    }
  }
  await mkdir(`${outputDirectory}/${entry.id}`)
  await writeFile(
    `${outputDirectory}/${entry.id}/report.json`,
    `${JSON.stringify({ ...report, points }, null, 2)}\n`,
  )
  overlays.push({ id: entry.id, coordinates: replacements.map((point) => point.distance) })
}
await writeFile(
  `${outputDirectory}/overlay-evidence.json`,
  `${JSON.stringify(
    {
      split,
      baseDirectory,
      baseProtocolSha256: hash(baseProtocolBytes),
      publicReportPath,
      publicReportSha256: hash(publicBytes),
      overlays,
    },
    null,
    2,
  )}\n`,
)
console.log(JSON.stringify({ split, cases: cases.length, overlays: overlays.length }))
