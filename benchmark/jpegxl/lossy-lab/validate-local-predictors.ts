import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { PNG } from 'pngjs'
import { hash } from '../comparison/io.ts'
import { number, object } from '../comparison/model.ts'
import { parsePreparedManifest } from './fixture-selection.ts'
import {
  localErrorPredictors,
  predictionAgreement,
  predictorLuma,
} from './local-error-predictors.ts'

const [root, subset = 'screen'] = process.argv.slice(2)
if (!root || (subset !== 'screen' && subset !== 'validation'))
  throw new Error('Need output and screen|validation')
await mkdir(root, { recursive: true })
const manifest = parsePreparedManifest(
  JSON.parse(await readFile('.tmp/jpegxl-lossy-lab/corpus-512-v2/manifest.json', 'utf8')),
)
const fixtures = manifest.fixtures.filter(
  (f) =>
    f.split === 'development' &&
    f.kind === 'lab' &&
    manifest.screenIds.includes(f.id) === (subset === 'screen'),
)
if (fixtures.length !== (subset === 'screen' ? 16 : 48))
  throw new Error('Incomplete development selection')
const base =
  '.tmp/jpegxl-lossy-lab/standalone-reconstruction-20261017/forward-lab/standalone-forward-all-purejsimage'
const trial =
  '.tmp/jpegxl-lossy-lab/display-trace-20261028/rd25-filtered-lab/standalone-rd25-filtered-purejsimage'
async function metricPoints(path: string, sourceHash: string) {
  const result = object(JSON.parse(await readFile(`${path}/result.json`, 'utf8')))
  if (result.fixtureSha256 !== sourceHash || !Array.isArray(result.points))
    throw new Error('Result fixture mismatch')
  return result.points.map((p) => {
    const point = object(p)
    return {
      distance: number(point.setting),
      maximum: number(point.butteraugliMax),
      norm3: number(point.butteraugliNorm3),
      ssim: number(point.ssimulacra2),
    }
  })
}
interface PredictorRow {
  readonly id: string
  readonly distance: number
  readonly fixtureSha256: string
  readonly native: { maximum: number; norm3: number; ssim: number }
  readonly features: Record<string, { predicted: number; actual: number }>
}
const rows: PredictorRow[] = []
for (const fixture of fixtures) {
  const input = await readFile(fixture.png)
  if (hash(input) !== fixture.fixtureSha256) throw new Error('Changed source')
  const source = PNG.sync.read(input),
    a = `${base}/${fixture.id}-lab`,
    b = `${trial}/${fixture.id}-lab`,
    pointsA = await metricPoints(a, fixture.fixtureSha256),
    pointsB = await metricPoints(b, fixture.fixtureSha256)
  for (const distance of [1.3, 1.85, 3]) {
    const control = PNG.sync.read(await readFile(`${a}/${distance}.png`)),
      changed = PNG.sync.read(await readFile(`${b}/${distance}.png`)),
      metricA = pointsA.find((p) => p.distance === distance),
      metricB = pointsB.find((p) => p.distance === distance)
    if (
      !metricA ||
      !metricB ||
      control.width !== source.width ||
      control.height !== source.height ||
      changed.width !== source.width ||
      changed.height !== source.height
    )
      throw new Error('Missing comparable endpoints')
    const features: Record<string, { predicted: number; actual: number }> = {}
    for (const space of ['display', 'linear'] as const) {
      const reference = predictorLuma(source.data, space),
        decodedA = predictorLuma(control.data, space),
        decodedB = predictorLuma(changed.data, space)
      for (const size of [16, 32, 64]) {
        const old = localErrorPredictors(reference, decodedA, source.width, source.height, size),
          candidate = localErrorPredictors(reference, decodedB, source.width, source.height, size)
        for (const [name, scores] of Object.entries(old)) {
          const newer = candidate[name]
          if (!newer) throw new Error('Missing feature')
          for (const pool of ['maximum', 'norm3'] as const)
            features[`${space}-${size}-${name}-${pool}`] = {
              predicted: newer[pool] - scores[pool],
              actual: 100 * (metricB[pool] / metricA[pool] - 1),
            }
        }
      }
    }
    rows.push({
      id: fixture.id,
      distance,
      fixtureSha256: fixture.fixtureSha256,
      native: {
        maximum: 100 * (metricB.maximum / metricA.maximum - 1),
        norm3: 100 * (metricB.norm3 / metricA.norm3 - 1),
        ssim: metricB.ssim - metricA.ssim,
      },
      features,
    })
  }
  console.log(fixture.id)
}
const names = Object.keys(rows[0]?.features ?? {})
const summary = names.map((name) => {
  const pairs = rows.map((row) => {
    const feature = row.features[name]
    if (!feature) throw new Error('Missing feature row')
    return feature
  })
  return {
    name,
    all: predictionAgreement(pairs, 1e-6),
    material: predictionAgreement(pairs, 0.1),
    passing: (() => {
      const s = predictionAgreement(pairs, 0.1)
      return s.material >= 10 && (s.accuracy ?? 0) >= 0.8 && s.missedHarm === 0
    })(),
  }
})
await writeFile(
  `${root}/predictors.json`,
  `${JSON.stringify({ subset, rule: 'At least 10 changes above 0.1%, 80% sign accuracy, no native harm above 1% predicted safe. No fitted weights.', rows, summary }, null, 2)}\n`,
)
console.log(JSON.stringify(summary.filter((s) => s.passing)))
