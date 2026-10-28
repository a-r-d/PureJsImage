/** Isolated diagnostic-kernel comparison. This does not time the encoder. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { PNG } from 'pngjs'
import { hash } from '../comparison/io.ts'
import { parsePreparedManifest } from './fixture-selection.ts'
import { displayLinearPlanes, downsampleDisplay } from './libjxl-display-loss.ts'
import { perceptualQuadraticMaps, preparePerceptualLinear } from './libjxl-perceptual-local-port.ts'
import { mixPerceptualScales, perceptualDirectionalMap } from './libjxl-perceptual-malta-port.ts'
import { localPerceptualMap, prepareLocalPerceptualReference } from './local-perceptual-region.ts'

const [root, id = 'im26-3012'] = process.argv.slice(2)
if (!root) throw new Error('Need output')
await mkdir(root, { recursive: true })
const manifest = parsePreparedManifest(
    JSON.parse(await readFile('.tmp/jpegxl-lossy-lab/corpus-512-v2/manifest.json', 'utf8')),
  ),
  fixture = manifest.fixtures.find(
    (f) => f.id === id && f.split === 'development' && f.kind === 'lab',
  )
if (!fixture || !manifest.screenIds.includes(id)) throw new Error('Need screen fixture')
const input = await readFile(fixture.png)
if (hash(input) !== fixture.fixtureSha256) throw new Error('Changed source')
const source = PNG.sync.read(input),
  decodedBytes = await readFile(
    `.tmp/jpegxl-lossy-lab/predictors-20261028/screen/${id}/changed.png`,
  ),
  decoded = PNG.sync.read(decodedBytes),
  width = source.width,
  height = source.height
if (width !== 512 || height !== 512 || decoded.width !== width || decoded.height !== height)
  throw new Error('Expected 512 crops')
function prepare(rgba: Uint8Array) {
  const rgb = displayLinearPlanes(rgba, width, height)
  return {
    fine: preparePerceptualLinear(rgb, width, height),
    half: preparePerceptualLinear(downsampleDisplay(rgb, width, height), width / 2, height / 2),
  }
}
const start = performance.now(),
  reference = prepare(source.data),
  fullPreparationMs = performance.now() - start
function full() {
  const trial = prepare(decoded.data),
    fine = perceptualDirectionalMap(
      reference.fine,
      trial.fine,
      perceptualQuadraticMaps(reference.fine, trial.fine).asymmetric,
    ),
    half = perceptualDirectionalMap(
      reference.half,
      trial.half,
      perceptualQuadraticMaps(reference.half, trial.half).asymmetric,
    )
  return mixPerceptualScales(fine, half, width, height)
}
const variants = [32, 192].map((size) => {
  const box = {
      x: Math.floor((width - size) / 2) + 1,
      y: Math.floor((height - size) / 2) + 1,
      width: size,
      height: size,
    },
    t = performance.now(),
    ref = prepareLocalPerceptualReference(source.data, width, height, box)
  return { size, box, reference: ref, preparationMs: performance.now() - t }
})
const expected = full()
for (const item of variants) localPerceptualMap(item.reference, decoded.data)
global.gc?.()
const samples: {
  trial: number
  fullMs: number
  locals: { size: number; ms: number; maximumError: number }[]
}[] = []
for (let trial = 0; trial < 11; trial++) {
  let fullMs = 0
  const locals: { size: number; ms: number; maximumError: number }[] = []
  const order = trial % 2 === 0 ? [0, 1, 2] : [2, 1, 0]
  for (const mode of order) {
    const t = performance.now()
    if (mode === 0) {
      const actual = full()
      fullMs = performance.now() - t
      if (actual.some((v, p) => v !== (expected[p] ?? 0)))
        throw new Error('Nondeterministic full map')
    } else {
      const item = variants[mode - 1]
      if (!item) throw new Error('Missing variant')
      const map = localPerceptualMap(item.reference, decoded.data),
        ms = performance.now() - t
      let maximumError = 0
      for (let y = 0; y < item.box.height; y++)
        for (let x = 0; x < item.box.width; x++)
          maximumError = Math.max(
            maximumError,
            Math.abs(
              (map[y * item.box.width + x] ?? 0) -
                (expected[(y + item.box.y) * width + x + item.box.x] ?? 0),
            ),
          )
      if (maximumError > 1e-10) throw new Error('Changed regional map')
      locals.push({ size: item.size, ms, maximumError })
    }
  }
  samples.push({ trial, fullMs, locals })
}
function median(v: number[]) {
  const sorted = v.slice().sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}
const summary = variants.map((v) => {
  const local = samples.map((s) => s.locals.find((l) => l.size === v.size)?.ms ?? Number.NaN),
    ratios = local.map((ms, i) => ms / (samples[i]?.fullMs ?? Number.NaN)),
    paired = median(ratios)
  return {
    size: v.size,
    crop: v.reference.crop,
    fullMedianMs: median(samples.map((s) => s.fullMs)),
    localMedianMs: median(local),
    pairedRatio: paired,
    ratioMad: median(ratios.map((r) => Math.abs(r - paired))),
    wins: ratios.filter((r) => r < 1).length,
    sourcePreparationMs: v.preparationMs,
  }
})
const sourceFiles = [
    'libjxl-perceptual-local-port.ts',
    'libjxl-perceptual-malta-port.ts',
    'libjxl-display-loss.ts',
    'local-perceptual-region.ts',
    'time-local-perceptual-region.ts',
  ],
  sources = {
    ...Object.fromEntries(
      await Promise.all(
        sourceFiles.map(async (f) => [f, hash(await readFile(`benchmark/jpegxl/lossy-lab/${f}`))]),
      ),
    ),
  }
await writeFile(
  `${root}/timing.json`,
  `${JSON.stringify({ id, inputHash: hash(input), decodedHash: hash(decodedBytes), node: process.version, sources, fullPreparationMs, samples, summary }, null, 2)}\n`,
)
console.log(JSON.stringify(summary))
