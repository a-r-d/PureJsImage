import { readdir, readFile, writeFile } from 'node:fs/promises'
import { number, object, string } from '../comparison/model.ts'

const [root, output] = process.argv.slice(2)
if (!root || !output) throw new Error('Need trace directory and output JSON')
const groups = new Map<string, number[]>()
const effects: {
  mode: string
  id: string
  distance: number
  raw: number
  gab: number
  epf: number
  rgb: number
  bytes: number
  ssim: number
  ba: number
}[] = []
const sum = (v: unknown) => {
  if (!Array.isArray(v)) throw new Error('Missing array')
  return v.map(number).reduce((a, b) => a + b, 0)
}
const y = (v: unknown) => {
  if (!Array.isArray(v)) throw new Error('Missing array')
  return number(v[1])
}
for (const name of (await readdir(root)).sort()) {
  if (!name.endsWith('.json')) continue
  const data = object(JSON.parse(await readFile(`${root}/${name}`, 'utf8')))
  if (!Array.isArray(data.rows)) throw new Error('Missing rows')
  const rows = data.rows.map(object),
    control = rows[0]
  if (control?.mode !== 'standalone-forward-all') throw new Error('Missing control')
  for (const r of rows) {
    const epf = object(r.epf),
      round = object(r.displayRounding),
      point = object(r.point),
      basePoint = object(control.point)
    const mode = string(r.mode),
      key = `${data.distance}/${mode}`
    const values = [
      number(r.bytes),
      y(r.rawError),
      y(r.gaborishQuantError),
      y(r.preconditionBias),
      y(r.gaborishError),
      y(epf.after),
      y(epf.correction),
      y(epf.cross),
      sum(r.linearError),
      sum(round.before),
      sum(round.after),
      number(point.ssimulacra2),
      number(point.butteraugliNorm3),
    ]
    const totals = groups.get(key) ?? values.map(() => 0)
    for (let i = 0; i < values.length; i++) totals[i] = (totals[i] ?? 0) + (values[i] ?? 0)
    groups.set(key, totals)
    effects.push({
      mode,
      id: string(data.id),
      distance: number(data.distance),
      raw: y(r.rawError) / y(control.rawError) - 1,
      gab: y(r.gaborishError) / y(control.gaborishError) - 1,
      epf: y(epf.after) / y(object(control.epf).after) - 1,
      rgb: sum(round.after) / sum(object(control.displayRounding).after) - 1,
      bytes: number(r.bytes) / number(control.bytes) - 1,
      ssim: number(point.ssimulacra2) - number(basePoint.ssimulacra2),
      ba: number(point.butteraugliNorm3) / number(basePoint.butteraugliNorm3) - 1,
    })
  }
}
if (effects.length === 0) throw new Error('No trace rows')
const report = {
  points: effects.length,
  columns: [
    'bytes',
    'rawY',
    'gabQuantY',
    'preconditionBiasY',
    'gabY',
    'epfY',
    'epfCorrectionY',
    'epfCrossY',
    'linearRGB',
    'floatSrgb',
    'roundedSrgb',
    'ssim',
    'ba3',
  ],
  totals: Object.fromEntries(groups),
  effects,
}
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify({ ...report, effects: undefined }, null, 2))
for (const mode of new Set(effects.map((row) => row.mode))) {
  const rows = effects.filter((r) => r.mode === mode)
  console.log(
    JSON.stringify({
      mode,
      points: rows.length,
      rawBetter: rows.filter((r) => r.raw < 0).length,
      epfBetter: rows.filter((r) => r.epf < 0).length,
      rgbBetter: rows.filter((r) => r.rgb < 0).length,
      ssimBetter: rows.filter((r) => r.ssim > 0).length,
      baBetter: rows.filter((r) => r.ba < 0).length,
      meanBytes: (100 * rows.reduce((s, r) => s + r.bytes, 0)) / rows.length,
      meanSsim: rows.reduce((s, r) => s + r.ssim, 0) / rows.length,
    }),
  )
}
