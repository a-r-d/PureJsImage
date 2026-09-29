import { readdir, readFile } from 'node:fs/promises'
import { hash, json, root } from './io.ts'
import { object, string } from './model.ts'

const reports = []
for (const name of await readdir(`${root}/results`)) {
  if (!/^(main|compat|cold|repair)-.*\.json$/.test(name)) continue
  const path = `${root}/results/${name}`,
    bytes = await readFile(path),
    report = object(JSON.parse(bytes.toString())),
    rows = report.rows
  if (!Array.isArray(rows)) throw new Error('Missing rows')
  const amendments = []
  for (const value of rows) {
    const row = object(value),
      settings = object(row.settings)
    if (row.operation !== 'encode' || settings.lossless !== false || !row.validation) continue
    const validation = object(row.validation)
    if (typeof validation.alphaMaximumError !== 'number') continue
    const shapePassed = typeof row.detail === 'string' && row.detail.includes('shape true')
    if (!shapePassed) continue
    const exactAlphaRequired = row.subject === 'purejsimage',
      newStatus =
        exactAlphaRequired && validation.alphaMaximumError !== 0 ? 'incorrect output' : 'verified'
    amendments.push({
      key: string(row.key),
      originalStatus: row.status,
      status: newStatus,
      maximumAlphaError: validation.alphaMaximumError,
      exactAlphaRequired,
      detail:
        'Lossy public-default request: record alpha distortion, enforce exact alpha only where promised. All lossless samples and decode tolerances unchanged.',
    })
  }
  reports.push({ sourceReport: path, sourceReportSha256: hash(bytes), amendments })
}
await json(`${root}/results/validation-amendment.json`, {
  schemaVersion: 1,
  date: new Date().toISOString(),
  decision:
    'Comparison uses each public lossy default, including its alpha behavior. Exact default alpha is a PureJsImage guarantee; do not call another wrapper incorrect merely for lossy alpha it does not promise to preserve. Preserve every measured alpha error and black/white score. Historical timing values and original statuses are retained.',
  reports,
})
