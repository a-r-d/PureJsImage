/** Join fixed-development loss and public-metric audits without changing quality gates. */
import { readFile, writeFile } from 'node:fs/promises'
import { number, object } from '../comparison/model.ts'
const [root, output] = process.argv.slice(2)
if (!root || !output) throw new Error('Need audit root and output path')
function objects(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error('Expected array')
  return value.map(object)
}
const losses = object(JSON.parse(await readFile(`${root}/double-audit.json`, 'utf8')))
const replay = object(JSON.parse(await readFile(`${root}/replay/report.json`, 'utf8')))
const cases = []
for (const loss of objects(losses.cases)) {
  const match = objects(replay.cases).find((r) => r.name === loss.name)
  if (!match) throw new Error('Missing replay case')
  const orientations = objects(match.rows)
  const rows = objects(loss.rows).map((row) => {
    const x = number(row.x),
      y = number(row.y)
    const deltas = orientations.map((orientation) => {
      const change = objects(orientation.changes).find((r) => r.x === x && r.y === y)
      if (!change) throw new Error('Missing replay intervention')
      return { kind: orientation.kind, delta: number(change.delta) }
    })
    const min = Math.min(...deltas.map((r) => r.delta)),
      max = Math.max(...deltas.map((r) => r.delta))
    return {
      x,
      y,
      actual: number(row.actual),
      stable: min > 0 || max < 0,
      min,
      max,
      mean: deltas.reduce((s, r) => s + r.delta, 0) / deltas.length,
      predictions: object(row.predictions),
      deltas,
    }
  })
  const keys = Object.keys(rows[0]?.predictions ?? {})
  const summary = keys.map((model) => ({
    model,
    originalCorrect: rows.filter(
      (r) => Math.sign(number(r.predictions[model])) === Math.sign(r.actual),
    ).length,
    stableCorrect: rows.filter(
      (r) => r.stable && Math.sign(number(r.predictions[model])) === Math.sign(r.actual),
    ).length,
    meanCorrect: rows.filter((r) => Math.sign(number(r.predictions[model])) === Math.sign(r.mean))
      .length,
  }))
  const result = {
    name: loss.name,
    inputPath: loss.inputPath,
    distance: loss.distance,
    stable: rows.filter((r) => r.stable).length,
    total: rows.length,
    orientations: orientations.map(({ changes: _changes, ...rest }) => rest),
    summary,
    rows,
  }
  cases.push(result)
  console.log(JSON.stringify({ ...result, rows: undefined }))
}
await writeFile(
  output,
  `${JSON.stringify(
    {
      base: 'd9681032f5388c35edd32f6f5ebd53429a86fb6b',
      holdoutOpened: false,
      policy: 'Diagnostic only. Orientation mean is not a replacement metric or promotion result.',
      cases,
      group128: object(JSON.parse(await readFile(`${root}/group128/report.json`, 'utf8'))),
      uniform512: object(JSON.parse(await readFile(`${root}/uniform512/report.json`, 'utf8'))),
    },
    null,
    2,
  )}\n`,
)
