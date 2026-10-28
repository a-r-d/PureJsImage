import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { PNG } from 'pngjs'
import { hash } from '../comparison/io.ts'
import { object, string } from '../comparison/model.ts'
import { parsePreparedManifest } from './fixture-selection.ts'
import { localWindowErrors, predictionAgreement, predictorLuma } from './local-error-predictors.ts'
import { type AuditWindow, readDistanceMap } from './local-rate-audit.ts'

const [root, rates] = process.argv.slice(2)
if (!root || !rates) throw new Error('Need fresh output and rate audit directory')
await mkdir(root, { recursive: true })
const manifest = parsePreparedManifest(
  JSON.parse(await readFile('.tmp/jpegxl-lossy-lab/corpus-512-v2/manifest.json', 'utf8')),
)
function localNative(values: Float32Array, width: number, box: AuditWindow) {
  let maximum = 0,
    sum = 0
  for (let y = box.y; y < box.y + box.height; y++)
    for (let x = box.x; x < box.x + box.width; x++) {
      const value = values[y * width + x] ?? 0
      maximum = Math.max(maximum, value)
      sum += value ** 3
    }
  return { maximum, norm3: Math.cbrt(sum / (box.width * box.height)) }
}
const rows = []
for (const path of [
  ...manifest.screenIds.map((id) => `${rates}/screen/${id}`),
  `${rates}/marginal`,
]) {
  const audit = object(JSON.parse(await readFile(`${path}/audit.json`, 'utf8'))),
    id = string(audit.id),
    fixture = manifest.fixtures.find(
      (f) => f.id === id && f.split === 'development' && f.kind === 'lab',
    )
  if (!fixture || !Array.isArray(audit.rows)) throw new Error('Missing development rows')
  const input = await readFile(fixture.png)
  if (hash(input) !== fixture.fixtureSha256) throw new Error('Changed source')
  const source = PNG.sync.read(input),
    control = PNG.sync.read(await readFile(`${path}/control.png`)),
    controlMap = readDistanceMap(await readFile(`${path}/control.pfm`))
  for (const raw of audit.rows) {
    const name = string(object(raw).name)
    if (name === 'control' || (path.endsWith('/marginal') && name === 'changed')) continue
    const changed = PNG.sync.read(await readFile(`${path}/${name}.png`)),
      changedMap = readDistanceMap(await readFile(`${path}/${name}.pfm`))
    if (
      [control, changed, controlMap, changedMap].some(
        (s) => s.width !== source.width || s.height !== source.height,
      )
    )
      throw new Error('Mismatched local dimensions')
    const byFeature: Record<string, { predicted: number; actual: number }[]> = {}
    const windows = []
    for (const space of ['display', 'linear'] as const) {
      const reference = predictorLuma(source.data, space),
        a = predictorLuma(control.data, space),
        b = predictorLuma(changed.data, space)
      for (const size of [16, 32])
        for (let y = 0; y <= source.height - size; y += size)
          for (let x = 0; x <= source.width - size; x += size) {
            const box = { x, y, width: size, height: size }
            let differs = false
            for (let yy = y; !differs && yy < y + size; yy++)
              for (let xx = x; xx < x + size; xx++) {
                const p = yy * source.width + xx
                if (
                  control.data[p * 4] !== changed.data[p * 4] ||
                  control.data[p * 4 + 1] !== changed.data[p * 4 + 1] ||
                  control.data[p * 4 + 2] !== changed.data[p * 4 + 2]
                ) {
                  differs = true
                  break
                }
              }
            if (!differs) continue
            const before = localWindowErrors(reference, a, source.width, source.height, box),
              after = localWindowErrors(reference, b, source.width, source.height, box),
              nativeA = localNative(controlMap.values, source.width, box),
              nativeB = localNative(changedMap.values, source.width, box)
            const delta = {
              maximum: nativeA.maximum ? 100 * (nativeB.maximum / nativeA.maximum - 1) : 0,
              norm3: nativeA.norm3 ? 100 * (nativeB.norm3 / nativeA.norm3 - 1) : 0,
            }
            for (const [i, feature] of [
              'rmse',
              'normalizedError',
              'normalizedGradient',
              'contrast',
            ].entries())
              for (const pool of ['maximum', 'norm3'] as const) {
                const key = `${space}-${size}-${feature}-${pool}`,
                  pairs = byFeature[key] ?? []
                pairs.push({ predicted: (after[i] ?? 0) - (before[i] ?? 0), actual: delta[pool] })
                byFeature[key] = pairs
              }
            windows.push({
              space,
              box,
              native: delta,
              predicted: after.map((v, i) => v - (before[i] ?? 0)),
            })
          }
    }
    rows.push({ id, name, windows, features: byFeature })
  }
  console.log(path)
}
const summary = []
for (const subset of ['screen', 'marginal'] as const) {
  const selected = rows.filter((r) => (r.name === 'changed') === (subset === 'screen')),
    names = [...new Set(selected.flatMap((r) => Object.keys(r.features)))]
  for (const name of names) {
    const pairs = selected.flatMap((r) => r.features[name] ?? [])
    summary.push({ subset, name, ...predictionAgreement(pairs, 0.1) })
  }
}
await writeFile(
  `${root}/local-patches.json`,
  `${JSON.stringify({ note: 'Fixed disjoint windows containing changed decoded pixels. Windows within an image and related coefficient subsets are correlated observations.', rows, summary }, null, 2)}\n`,
)
console.log(JSON.stringify(summary))
