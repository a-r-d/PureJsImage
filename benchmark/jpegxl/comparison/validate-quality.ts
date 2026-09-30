import { readFile } from 'node:fs/promises'
import { fixtures, hash, json, raw, root } from './io.ts'
import { lossyOutputStatus, number, object, string } from './model.ts'
import { pngPixels } from './validate.ts'

const reportPath = `${root}/results/quality.json`,
  bytes = await readFile(reportPath),
  report = object(JSON.parse(bytes.toString())),
  results = report.results,
  inputs = await fixtures(),
  rows = []
if (!Array.isArray(results)) throw new Error('Missing quality rows')
for (const value of results) {
  const result = object(value),
    fixture = inputs.find((f) => f.id === result.fixture)
  if (!fixture || !Array.isArray(result.points)) throw new Error('Missing fixture or points')
  const source = await raw(fixture)
  for (const value of result.points) {
    const point = object(value),
      path = string(point.artifact),
      encoded = await readFile(path),
      decodedPath = path.replace(/\.jxl$/, '.png'),
      decoded = await readFile(decodedPath)
    if (hash(encoded) !== point.artifactSha256 || hash(decoded) !== point.decodedSha256)
      throw new Error('Quality artifact identity changed')
    const actual = await pngPixels(decodedPath),
      shape =
        actual.width === source.width &&
        actual.height === source.height &&
        actual.channels === source.channels
    let maximumAlphaError = 0
    if (shape)
      for (let i = 3; i < source.data.length; i += 4)
        maximumAlphaError = Math.max(
          maximumAlphaError,
          Math.abs((actual.data[i] ?? 0) - (source.data[i] ?? 0)),
        )
    rows.push({
      subject: result.subject,
      fixture: fixture.id,
      setting: number(point.setting),
      artifact: path,
      artifactSha256: hash(encoded),
      status: lossyOutputStatus(shape, maximumAlphaError, result.subject === 'purejsimage'),
      exactAlphaRequired: result.subject === 'purejsimage',
      alphaPolicy:
        result.subject === 'purejsimage'
          ? 'Exact default alpha guarantee'
          : 'Public lossy defaults; alpha error retained and scored on black/white',
      shape,
      maximumAlphaError,
    })
  }
}
await json(`${root}/results/quality-correctness.json`, {
  schemaVersion: 1,
  date: new Date().toISOString(),
  sourceReport: reportPath,
  sourceReportSha256: hash(bytes),
  rows,
})
console.log(`Validated ${rows.length} existing scored artifacts; no new timings or encodes`)
