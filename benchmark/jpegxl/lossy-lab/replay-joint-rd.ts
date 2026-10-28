/** Offline joint-RD ranking on previously encoded development interventions. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { PNG } from 'pngjs'
import { hash } from '../comparison/io.ts'
import { number, object, string } from '../comparison/model.ts'
import { decodeDisplayStages } from './display-error-trace.ts'
import { parsePreparedManifest } from './fixture-selection.ts'
import { displayLinearPlanes, downsampleDisplay } from './libjxl-display-loss.ts'
import { libjxlDitheredRgba } from './libjxl-output-dither-port.ts'
import { perceptualQuadraticMaps, preparePerceptualLinear } from './libjxl-perceptual-local-port.ts'
import { mixPerceptualScales, perceptualDirectionalMap } from './libjxl-perceptual-malta-port.ts'
import { poolNativePerceptual } from './libjxl-perceptual-pool-port.ts'

const [root] = process.argv.slice(2)
if (!root) throw new Error('Need output directory')
await mkdir(root, { recursive: true })
const directory = '.tmp/jpegxl-lossy-lab/predictors-20261028/marginal',
  audit = object(JSON.parse(await readFile(`${directory}/audit.json`, 'utf8'))),
  manifest = parsePreparedManifest(
    JSON.parse(await readFile('.tmp/jpegxl-lossy-lab/corpus-512-v2/manifest.json', 'utf8')),
  ),
  id = string(audit.id),
  fixture = manifest.fixtures.find(
    (f) => f.id === id && f.split === 'development' && f.kind === 'lab',
  )
if (!fixture || !manifest.screenIds.includes(id) || !Array.isArray(audit.rows))
  throw new Error('Missing screen fixture')
const sourceBytes = await readFile(fixture.png)
if (hash(sourceBytes) !== fixture.fixtureSha256 || audit.fixtureSha256 !== fixture.fixtureSha256)
  throw new Error('Changed source')
const sourcePng = PNG.sync.read(sourceBytes),
  width = sourcePng.width,
  height = sourcePng.height
function prepare(rgba: Uint8Array) {
  const rgb = displayLinearPlanes(rgba, width, height)
  return {
    fine: preparePerceptualLinear(rgb, width, height),
    half: preparePerceptualLinear(
      downsampleDisplay(rgb, width, height),
      Math.ceil(width / 2),
      Math.ceil(height / 2),
    ),
  }
}
const reference = prepare(sourcePng.data)
interface Candidate {
  readonly name: string
  readonly bytes: number
  readonly colorBits: number
  readonly hash: string
  readonly predicted: ReturnType<typeof poolNativePerceptual>
  readonly native: ReturnType<typeof poolNativePerceptual>
  readonly nativeSsim: number
}
const candidates: Candidate[] = []
for (const raw of audit.rows) {
  const row = object(raw),
    name = string(row.name),
    stream = await readFile(`${directory}/${name}.jxl`),
    expected = string(row.hash)
  if (hash(stream) !== expected || stream.length !== number(object(row.cost).bytes))
    throw new Error('Serialized cost/hash mismatch')
  const stages = await decodeDisplayStages(stream)
  if (stages.width !== width || stages.height !== height)
    throw new Error('Reconstruction dimensions differ')
  const decoded = prepare(libjxlDitheredRgba(stages.srgb, width, height)),
    fine = perceptualDirectionalMap(
      reference.fine,
      decoded.fine,
      perceptualQuadraticMaps(reference.fine, decoded.fine).asymmetric,
    ),
    half = perceptualDirectionalMap(
      reference.half,
      decoded.half,
      perceptualQuadraticMaps(reference.half, decoded.half).asymmetric,
    ),
    predicted = poolNativePerceptual(mixPerceptualScales(fine, half, width, height)),
    ba = object(row.ba),
    candidate = {
      name,
      bytes: stream.length,
      colorBits: number(row.colorBits),
      hash: expected,
      predicted,
      native: { maximum: number(ba.max), norm3: number(ba.norm3) },
      nativeSsim: number(row.ssim),
    }
  candidates.push(candidate)
  await writeFile(`${root}/${name}.json`, `${JSON.stringify(candidate, null, 2)}\n`)
  console.log(name)
}
const control = candidates.find((c) => c.name === 'control')
if (!control || candidates.length !== 47) throw new Error('Incomplete intervention cohort')
function cost(candidate: Candidate, lambda: number, metric: 'predicted' | 'native') {
  if (!control) throw new Error('Missing control')
  const before = control[metric],
    after = candidate[metric]
  if (
    [before.maximum, before.norm3, after.maximum, after.norm3, candidate.bytes, control.bytes].some(
      (v) => !Number.isFinite(v) || v <= 0,
    )
  )
    throw new Error('Invalid RD input')
  return (
    Math.log(candidate.bytes / control.bytes) +
    lambda * 0.5 * (Math.log(after.maximum / before.maximum) + Math.log(after.norm3 / before.norm3))
  )
}
const decisions = []
for (const lambda of [0.5, 1, 2, 4]) {
  let chosen = control,
    chosenCost = 0
  // Only our reconstruction scores and actual serialized bytes determine the choice.
  for (const candidate of candidates) {
    const value = cost(candidate, lambda, 'predicted')
    if (value < chosenCost - 1e-9) {
      chosen = candidate
      chosenCost = value
    }
  }
  // Native labels are consulted only after selection, to measure ranking regret.
  let oracle = control,
    oracleCost = 0
  for (const candidate of candidates) {
    const value = cost(candidate, lambda, 'native')
    if (value < oracleCost - 1e-9) {
      oracle = candidate
      oracleCost = value
    }
  }
  decisions.push({
    lambda,
    chosen: chosen.name,
    oracle: oracle.name,
    predictedCost: chosenCost,
    nativeCost: cost(chosen, lambda, 'native'),
    regret: cost(chosen, lambda, 'native') - oracleCost,
    bytesSaved: control.bytes - chosen.bytes,
    colorBitsSaved: control.colorBits - chosen.colorBits,
    nativeMaximumPercent: 100 * (chosen.native.maximum / control.native.maximum - 1),
    nativeNorm3Percent: 100 * (chosen.native.norm3 / control.native.norm3 - 1),
    nativeSsimDelta: chosen.nativeSsim - control.nativeSsim,
  })
}
await writeFile(
  `${root}/summary.json`,
  `${JSON.stringify({ id, distance: number(audit.distance), inputHash: hash(sourceBytes), formula: 'log(bytes/controlBytes) + lambda * mean(log(max/controlMax), log(norm3/controlNorm3))', candidates, decisions }, null, 2)}\n`,
)
console.log(JSON.stringify(decisions))
