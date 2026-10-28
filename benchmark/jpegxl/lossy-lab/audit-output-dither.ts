/** Development-only comparison of rounded and dithered first-party reconstruction. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { PNG } from 'pngjs'
import { hash } from '../comparison/io.ts'
import { number, object } from '../comparison/model.ts'
import { decodeDisplayStages } from './display-error-trace.ts'
import { parsePreparedManifest } from './fixture-selection.ts'
import { displayLinearPlanes, downsampleDisplay } from './libjxl-display-loss.ts'
import { libjxlDitheredRgba } from './libjxl-output-dither-port.ts'
import { perceptualQuadraticMaps, preparePerceptualLinear } from './libjxl-perceptual-local-port.ts'
import { mixPerceptualScales, perceptualDirectionalMap } from './libjxl-perceptual-malta-port.ts'
import { poolNativePerceptual } from './libjxl-perceptual-pool-port.ts'
import { predictionAgreement } from './local-error-predictors.ts'
import { readDistanceMap } from './local-rate-audit.ts'

const [root, selection = 'rate'] = process.argv.slice(2)
if (!root || !['rate', 'rounding'].includes(selection))
  throw new Error('Need output and rate|rounding')
await mkdir(root, { recursive: true })
const manifest = parsePreparedManifest(
  JSON.parse(await readFile('.tmp/jpegxl-lossy-lab/corpus-512-v2/manifest.json', 'utf8')),
)
function prepare(bytes: Uint8Array, width: number, height: number) {
  const rgb = displayLinearPlanes(bytes, width, height)
  return {
    fine: preparePerceptualLinear(rgb, width, height),
    half: preparePerceptualLinear(
      downsampleDisplay(rgb, width, height),
      Math.ceil(width / 2),
      Math.ceil(height / 2),
    ),
  }
}
function score(
  source: ReturnType<typeof prepare>,
  rgba: Uint8Array,
  width: number,
  height: number,
) {
  const decoded = prepare(rgba, width, height),
    fine = perceptualDirectionalMap(
      source.fine,
      decoded.fine,
      perceptualQuadraticMaps(source.fine, decoded.fine).asymmetric,
    ),
    half = perceptualDirectionalMap(
      source.half,
      decoded.half,
      perceptualQuadraticMaps(source.half, decoded.half).asymmetric,
    )
  return poolNativePerceptual(mixPerceptualScales(fine, half, width, height))
}
function comparePixels(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) throw new Error('Pixel extent mismatch')
  let changed = 0,
    maxDelta = 0
  for (let p = 0; p < a.length; p++) {
    const delta = Math.abs((a[p] ?? 0) - (b[p] ?? 0))
    if (delta) changed++
    maxDelta = Math.max(maxDelta, delta)
  }
  return { changed, maxDelta, hash: hash(a) }
}
interface AuditRow {
  readonly id: string
  readonly distance: number
  readonly mode: string
  readonly points: readonly {
    base: string
    streamHash: string
    nativePngHash: string
    native: ReturnType<typeof poolNativePerceptual>
    rounded: {
      pixels: ReturnType<typeof comparePixels>
      score: ReturnType<typeof poolNativePerceptual>
    }
    dithered: {
      pixels: ReturnType<typeof comparePixels>
      score: ReturnType<typeof poolNativePerceptual>
    }
  }[]
  readonly features: Record<string, { predicted: number; actual: number }>
}
const rows: AuditRow[] = []
for (const id of manifest.screenIds) {
  const fixture = manifest.fixtures.find(
    (f) => f.id === id && f.kind === 'lab' && f.split === 'development',
  )
  if (!fixture) throw new Error('Missing development input')
  const file = await readFile(fixture.png)
  if (hash(file) !== fixture.fixtureSha256) throw new Error('Changed source')
  const png = PNG.sync.read(file),
    source = prepare(png.data, png.width, png.height)
  const cases =
    selection === 'rate'
      ? [{ distance: 1.85, mode: 'standalone-rd25-filtered' }]
      : [2, 4].flatMap((distance) =>
          ['standalone-round-low', 'standalone-round-guarded'].map((mode) => ({ distance, mode })),
        )
  async function point(distance: number, mode: string, trial: boolean) {
    const prior = '.tmp/jpegxl-lossy-lab/selected-20261028',
      label = trial ? mode : 'standalone-forward-all',
      directory = `${prior}/${label}-screen/${label}-purejsimage/${id}-lab`,
      base =
        selection === 'rate'
          ? `.tmp/jpegxl-lossy-lab/predictors-20261028/screen/${id}/${trial ? 'changed' : 'control'}`
          : `${directory}/${distance}`,
      stream = await readFile(`${base}.jxl`),
      nativePngBytes = await readFile(`${base}.png`),
      nativePng = PNG.sync.read(nativePngBytes),
      stages = await decodeDisplayStages(stream)
    if ([stages, nativePng].some((p) => p.width !== png.width || p.height !== png.height))
      throw new Error('Mismatched dimensions')
    let native: { maximum: number; norm3: number }
    if (selection === 'rate')
      native = poolNativePerceptual(readDistanceMap(await readFile(`${base}.pfm`)).values)
    else {
      const result = object(JSON.parse(await readFile(`${directory}/result.json`, 'utf8')))
      if (result.fixtureSha256 !== fixture?.fixtureSha256 || !Array.isArray(result.points))
        throw new Error('Native source mismatch')
      const p = result.points.map(object).find((p) => p.setting === distance)
      if (!p) throw new Error('Missing native point')
      native = { maximum: number(p.butteraugliMax), norm3: number(p.butteraugliNorm3) }
    }
    const rounded = new Uint8Array(png.width * png.height * 4)
    for (let p = 0; p < png.width * png.height; p++) {
      for (let c = 0; c < 3; c++)
        rounded[4 * p + c] = Math.round((stages.rounded[c]?.[p] ?? 0) * 255)
      rounded[4 * p + 3] = 255
    }
    const dithered = libjxlDitheredRgba(stages.srgb, png.width, png.height)
    return {
      base,
      streamHash: hash(stream),
      nativePngHash: hash(nativePngBytes),
      native,
      rounded: {
        pixels: comparePixels(rounded, nativePng.data),
        score: score(source, rounded, png.width, png.height),
      },
      dithered: {
        pixels: comparePixels(dithered, nativePng.data),
        score: score(source, dithered, png.width, png.height),
      },
    }
  }
  const cache = new Map<string, Awaited<ReturnType<typeof point>>>()
  for (const item of cases) {
    const points = []
    for (const trial of [false, true]) {
      const key = `${item.distance}-${trial ? item.mode : 'control'}`
      let value = cache.get(key)
      if (!value) {
        value = await point(item.distance, item.mode, trial)
        cache.set(key, value)
      }
      points.push(value)
    }
    const a = points[0],
      b = points[1]
    if (!a || !b) throw new Error('Missing pair')
    const features: Record<string, { predicted: number; actual: number }> = {}
    for (const mode of ['rounded', 'dithered'] as const)
      for (const metric of ['maximum', 'norm3'] as const)
        features[`${mode}-${metric}`] = {
          predicted: b[mode].score[metric] - a[mode].score[metric],
          actual: 100 * (b.native[metric] / a.native[metric] - 1),
        }
    const row = { id, ...item, points, features }
    rows.push(row)
    await writeFile(
      `${root}/${id}-${item.distance}-${item.mode}.json`,
      `${JSON.stringify(row, null, 2)}\n`,
    )
  }
  console.log(id)
}
const summary = Object.keys(rows[0]?.features ?? {}).map((name) => {
  const pairs = rows.map((row) => {
    const v = row.features[name]
    if (!v) throw new Error('Missing prediction')
    return v
  })
  return { name, all: predictionAgreement(pairs, 1e-6), material: predictionAgreement(pairs, 0.1) }
})
await writeFile(
  `${root}/summary.json`,
  `${JSON.stringify({ selection, rows, summary }, null, 2)}\n`,
)
console.log(JSON.stringify(summary))
