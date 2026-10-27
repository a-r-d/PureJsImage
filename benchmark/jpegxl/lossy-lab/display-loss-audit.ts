/** Offline audit of saved development sharpness interventions. No encoder decisions or holdout reads. */
import { readFile, writeFile } from 'node:fs/promises'
import { PNG } from 'pngjs'
import { object, number } from '../comparison/model.ts'
import {
  displayLinearPlanes,
  displayLossPyramid,
  type DisplayPlanes,
} from './libjxl-display-loss.ts'
const [outputPath] = process.argv.slice(2)
if (!outputPath) throw new Error('Need output report path')
const root = '.tmp/jpegxl-lossy-lab/filter-loss-20261018'
interface AuditRow {
  x: number
  y: number
  actual: number
  predictions: Record<string, number>
  scaleDeltaRgb: number[]
  scaleDeltaXyb: number[]
}
function crop(planes: DisplayPlanes, width: number, x: number, y: number): DisplayPlanes {
  const result: DisplayPlanes = [
    new Float32Array(4096),
    new Float32Array(4096),
    new Float32Array(4096),
  ]
  for (let c = 0; c < 3; c++) {
    const from = planes[c],
      to = result[c]
    if (!from || !to) throw new Error('Missing crop plane')
    for (let row = 0; row < 64; row++)
      to.set(from.subarray((y + row) * width + x, (y + row) * width + x + 64), row * 64)
  }
  return result
}
const sum = (values: number[], count: number) => values.slice(0, count).reduce((a, b) => a + b, 0)
const cases = []
for (const name of ['region-audit-v2', 'texture-region-audit-v2']) {
  const directory = `${root}/${name}`,
    report = object(JSON.parse(await readFile(`${directory}/report.json`, 'utf8')))
  if (
    typeof report.inputPath !== 'string' ||
    !Array.isArray(report.rows) ||
    !report.inputPath.startsWith('.tmp/jpegxl-lossy-lab/corpus-512-v2/')
  )
    throw new Error('Invalid development audit')
  const source = PNG.sync.read(await readFile(report.inputPath)),
    control = PNG.sync.read(await readFile(`${directory}/control.png`))
  if (
    source.width !== 512 ||
    source.height !== 512 ||
    control.width !== 512 ||
    control.height !== 512
  )
    throw new Error('Expected fixed crop')
  const src = displayLinearPlanes(source.data, 512, 512),
    base = displayLinearPlanes(control.data, 512, 512)
  const baseRgb = displayLossPyramid(src, base, 512, 512, 'rgb'),
    baseXyb = displayLossPyramid(src, base, 512, 512, 'xyb')
  const blurModes = [
    { name: 'wideClamp', radius: 5, border: 'clamp' },
    { name: 'shortZero', radius: 3, border: 'zero' },
    { name: 'wideZero', radius: 5, border: 'zero' },
    { name: 'wideZeroFloat', radius: 5, border: 'zero', float32: true },
    { name: 'cosineZero', radius: 4, border: 'zero' },
    { name: 'cosineZeroFloat', radius: 4, border: 'zero', float32: true },
    { name: 'cosineZeroDouble', radius: 4, border: 'zero', moment64: true },
  ] as const
  const blurBase = blurModes.map((mode) =>
    sum(displayLossPyramid(src, base, 512, 512, 'rgb', 6, mode), 6),
  )
  const rows: AuditRow[] = []
  for (const value of report.rows) {
    const row = object(value),
      x = number(row.x),
      y = number(row.y),
      actual = number(row.ssimDelta)
    if (x % 128 !== 0 || y % 128 !== 0 || x < 0 || y < 0 || x > 384 || y > 384)
      throw new Error('Invalid fixed intervention')
    const png = PNG.sync.read(await readFile(`${directory}/${x / 64}-${y / 64}.png`))
    const out = displayLinearPlanes(png.data, 512, 512)
    const rgb = displayLossPyramid(src, out, 512, 512, 'rgb'),
      xyb = displayLossPyramid(src, out, 512, 512, 'xyb')
    const s = crop(src, 512, x, y),
      a = crop(base, 512, x, y),
      b = crop(out, 512, x, y)
    const full = object(row.full)
    const predictions = {
      oldFloatingPointwise: number(full.native4) - number(full.native7),
      oldFloatingGaussian: number(full.gaussian4) - number(full.gaussian7),
      displayRegionXyb3:
        sum(displayLossPyramid(s, a, 64, 64, 'xyb', 3), 3) -
        sum(displayLossPyramid(s, b, 64, 64, 'xyb', 3), 3),
      displayRegionRgb3:
        sum(displayLossPyramid(s, a, 64, 64, 'rgb', 3), 3) -
        sum(displayLossPyramid(s, b, 64, 64, 'rgb', 3), 3),
      displayFullXyb3: sum(baseXyb, 3) - sum(xyb, 3),
      displayFullXyb6: sum(baseXyb, 6) - sum(xyb, 6),
      displayFullRgb3: sum(baseRgb, 3) - sum(rgb, 3),
      displayFullRgb6: sum(baseRgb, 6) - sum(rgb, 6),
      ...Object.fromEntries(
        blurModes.map((mode, index) => [
          mode.name,
          (blurBase[index] ?? 0) - sum(displayLossPyramid(src, out, 512, 512, 'rgb', 6, mode), 6),
        ]),
      ),
    }
    rows.push({
      x,
      y,
      actual,
      predictions,
      scaleDeltaRgb: baseRgb.map((v, i) => v - (rgb[i] ?? 0)),
      scaleDeltaXyb: baseXyb.map((v, i) => v - (xyb[i] ?? 0)),
    })
  }
  const keys = Object.keys(rows[0]?.predictions ?? {})
  const summary = keys.map((model) => {
    const scores = rows.map((r) => ({
      actual: r.actual,
      predicted: r.predictions[model] ?? 0,
    }))
    return {
      model,
      correct: scores.filter((r) => Math.sign(r.actual) === Math.sign(r.predicted)).length,
      harmCorrect: scores.filter((r) => r.actual < 0 && r.predicted < 0).length,
      helpCorrect: scores.filter((r) => r.actual > 0 && r.predicted > 0).length,
    }
  })
  const result = {
    name,
    inputPath: report.inputPath,
    distance: report.distance,
    harmful: rows.filter((r) => r.actual < 0).length,
    helpful: rows.filter((r) => r.actual > 0).length,
    summary,
    rows,
  }
  cases.push(result)
  console.log(JSON.stringify({ name, summary }))
}
await writeFile(
  outputPath,
  `${JSON.stringify({ base: 'd9681032', nativePngInputs: true, holdoutOpened: false, policy: 'Offline sign diagnostic; Gaussian and floating point approximations remain. Not a quality or promotion result.', cases }, null, 2)}\n`,
)
