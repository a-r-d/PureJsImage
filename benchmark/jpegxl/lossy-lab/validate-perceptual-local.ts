import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { PNG } from 'pngjs'
import { hash } from '../comparison/io.ts'
import { number, object } from '../comparison/model.ts'
import { parsePreparedManifest } from './fixture-selection.ts'
import { displayLinearPlanes, downsampleDisplay } from './libjxl-display-loss.ts'
import {
  perceptualQuadraticMaps,
  poolPerceptualMap,
  preparePerceptualImage,
  preparePerceptualLinear,
} from './libjxl-perceptual-local-port.ts'
import { mixPerceptualScales, perceptualDirectionalMap } from './libjxl-perceptual-malta-port.ts'
import { poolNativePerceptual } from './libjxl-perceptual-pool-port.ts'
import { predictionAgreement } from './local-error-predictors.ts'

const [root, selection = 'screen', components = 'quadratic', aggregation = 'l3'] =
  process.argv.slice(2)
if (
  !root ||
  (selection !== 'screen' && selection !== 'validation') ||
  (components !== 'quadratic' && components !== 'directional') ||
  (aggregation !== 'l3' && aggregation !== 'native')
)
  throw new Error('Need output and screen|validation and quadratic|directional and l3|native')
const poolMap = aggregation === 'native' ? poolNativePerceptual : poolPerceptualMap
await mkdir(root, { recursive: true })
const manifest = parsePreparedManifest(
  JSON.parse(await readFile('.tmp/jpegxl-lossy-lab/corpus-512-v2/manifest.json', 'utf8')),
)
const fixtures = manifest.fixtures.filter(
  (f) =>
    f.split === 'development' &&
    f.kind === 'lab' &&
    manifest.screenIds.includes(f.id) === (selection === 'screen'),
)
if (fixtures.length !== (selection === 'screen' ? 16 : 48))
  throw new Error('Incomplete development input')
const prior = '.tmp/jpegxl-lossy-lab/selected-20261028',
  fullControl =
    '.tmp/jpegxl-lossy-lab/standalone-reconstruction-20261017/forward-lab/standalone-forward-all-purejsimage',
  fullTrial =
    '.tmp/jpegxl-lossy-lab/display-trace-20261028/rd25-filtered-lab/standalone-rd25-filtered-purejsimage'
async function native(path: string, distance: number, sourceHash: string) {
  const result = object(JSON.parse(await readFile(`${path}/result.json`, 'utf8')))
  if (result.fixtureSha256 !== sourceHash || !Array.isArray(result.points))
    throw new Error('Metric source mismatch')
  const point = result.points.map(object).find((p) => p.setting === distance)
  if (!point) throw new Error('Missing native point')
  return {
    maximum: number(point.butteraugliMax),
    norm3: number(point.butteraugliNorm3),
    ssim: number(point.ssimulacra2),
  }
}
interface AuditRow {
  readonly id: string
  readonly distance: number
  readonly mode: string
  readonly sourceHash: string
  readonly controlPngHash: string
  readonly trialPngHash: string
  readonly features: Record<
    string,
    {
      predicted: number
      actual: number
      before: number
      after: number
      nativeBefore: number
      nativeAfter: number
    }
  >
}
function prepare(rgba: Uint8Array, width: number, height: number) {
  return {
    full: preparePerceptualImage(rgba, width, height),
    half:
      components === 'directional'
        ? preparePerceptualLinear(
            downsampleDisplay(displayLinearPlanes(rgba, width, height), width, height),
            Math.ceil(width / 2),
            Math.ceil(height / 2),
          )
        : undefined,
  }
}
function maps(reference: ReturnType<typeof prepare>, decoded: ReturnType<typeof prepare>) {
  const base = perceptualQuadraticMaps(reference.full, decoded.full),
    result: Record<string, Float64Array> = { ...base }
  if (reference.half && decoded.half) {
    const fine = perceptualDirectionalMap(reference.full, decoded.full, base.asymmetric),
      halfBase = perceptualQuadraticMaps(reference.half, decoded.half),
      half = perceptualDirectionalMap(reference.half, decoded.half, halfBase.asymmetric)
    result.directional = fine
    result.multiscale = mixPerceptualScales(fine, half, reference.full.width, reference.full.height)
  }
  return result
}
const rows: AuditRow[] = []
for (const fixture of fixtures) {
  const input = await readFile(fixture.png)
  if (hash(input) !== fixture.fixtureSha256) throw new Error('Source changed')
  const png = PNG.sync.read(input),
    reference = prepare(png.data, png.width, png.height)
  const cases =
    selection === 'screen'
      ? [
          ...[2, 4].flatMap((distance) =>
            ['standalone-round-guarded', 'standalone-round-low'].map((mode) => ({
              distance,
              mode,
              control: `${prior}/standalone-forward-all-screen/standalone-forward-all-purejsimage`,
              trial: `${prior}/${mode}-screen/${mode}-purejsimage`,
            })),
          ),
          {
            distance: 1.85,
            mode: 'standalone-rd25-filtered',
            control: fullControl,
            trial: fullTrial,
          },
        ]
      : [1.3, 1.85, 3].map((distance) => ({
          distance,
          mode: 'standalone-rd25-filtered',
          control: fullControl,
          trial: fullTrial,
        }))
  for (const item of cases) {
    const a = `${item.control}/${fixture.id}-lab`,
      b = `${item.trial}/${fixture.id}-lab`,
      metricA = await native(a, item.distance, fixture.fixtureSha256),
      metricB = await native(b, item.distance, fixture.fixtureSha256),
      fileA = await readFile(`${a}/${item.distance}.png`),
      fileB = await readFile(`${b}/${item.distance}.png`),
      pngA = PNG.sync.read(fileA),
      pngB = PNG.sync.read(fileB)
    if ([pngA, pngB].some((p) => p.width !== png.width || p.height !== png.height))
      throw new Error('Mismatched decoded dimensions')
    const old = maps(reference, prepare(pngA.data, png.width, png.height)),
      changed = maps(reference, prepare(pngB.data, png.width, png.height)),
      features: AuditRow['features'] = {}
    for (const name of Object.keys(old)) {
      const oldMap = old[name],
        newMap = changed[name]
      if (!oldMap || !newMap) throw new Error('Missing component map')
      const before = poolMap(oldMap),
        after = poolMap(newMap)
      for (const pool of ['maximum', 'norm3'] as const)
        features[`${name}-${pool}`] = {
          predicted: after[pool] - before[pool],
          actual: 100 * (metricB[pool] / metricA[pool] - 1),
          before: before[pool],
          after: after[pool],
          nativeBefore: metricA[pool],
          nativeAfter: metricB[pool],
        }
    }
    const row = {
      id: fixture.id,
      distance: item.distance,
      mode: item.mode,
      sourceHash: fixture.fixtureSha256,
      controlPngHash: hash(fileA),
      trialPngHash: hash(fileB),
      features,
    }
    rows.push(row)
    await writeFile(
      `${root}/${fixture.id}-${item.distance}-${item.mode}.json`,
      `${JSON.stringify(row, null, 2)}\n`,
    )
  }
  console.log(fixture.id)
}
const summary = []
for (const mode of ['all', ...new Set(rows.map((r) => r.mode))]) {
  const selected = rows.filter((r) => mode === 'all' || r.mode === mode)
  for (const name of Object.keys(rows[0]?.features ?? {})) {
    const pairs = selected.map((r) => {
      const value = r.features[name]
      if (!value) throw new Error('Missing prediction')
      return value
    })
    summary.push({
      mode,
      name,
      all: predictionAgreement(pairs, 1e-6),
      material: predictionAgreement(pairs, 0.1),
    })
  }
}
await writeFile(
  `${root}/summary.json`,
  `${JSON.stringify({ selection, components, aggregation, rows, summary }, null, 2)}\n`,
)
console.log(JSON.stringify(summary.filter((r) => r.mode === 'all')))
