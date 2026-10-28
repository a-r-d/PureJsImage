/** Native-map fidelity check on cached development interventions. Never reads holdout. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { PNG } from 'pngjs'
import { hash } from '../comparison/io.ts'
import { object, string } from '../comparison/model.ts'
import { parsePreparedManifest } from './fixture-selection.ts'
import { displayLinearPlanes, downsampleDisplay } from './libjxl-display-loss.ts'
import { perceptualQuadraticMaps, preparePerceptualLinear } from './libjxl-perceptual-local-port.ts'
import { mixPerceptualScales, perceptualDirectionalMap } from './libjxl-perceptual-malta-port.ts'
import { poolNativePerceptual } from './libjxl-perceptual-pool-port.ts'
import { readDistanceMap } from './local-rate-audit.ts'

const [root, rates, selection = 'screen'] = process.argv.slice(2)
if (!root || !rates || !['screen', 'marginal'].includes(selection))
  throw new Error('Need output, rate-audit root and screen|marginal')
await mkdir(root, { recursive: true })
const manifest = parsePreparedManifest(
  JSON.parse(await readFile('.tmp/jpegxl-lossy-lab/corpus-512-v2/manifest.json', 'utf8')),
)
function prepare(png: PNG) {
  const rgb = displayLinearPlanes(png.data, png.width, png.height)
  return {
    fine: preparePerceptualLinear(rgb, png.width, png.height),
    half: preparePerceptualLinear(
      downsampleDisplay(rgb, png.width, png.height),
      Math.ceil(png.width / 2),
      Math.ceil(png.height / 2),
    ),
  }
}
function distance(source: ReturnType<typeof prepare>, decoded: ReturnType<typeof prepare>) {
  const fine = perceptualDirectionalMap(
      source.fine,
      decoded.fine,
      perceptualQuadraticMaps(source.fine, decoded.fine).asymmetric,
    ),
    half = perceptualDirectionalMap(
      source.half,
      decoded.half,
      perceptualQuadraticMaps(source.half, decoded.half).asymmetric,
    )
  return mixPerceptualScales(fine, half, source.fine.width, source.fine.height)
}
const rows = []
for (const path of selection === 'screen'
  ? manifest.screenIds.map((id) => `${rates}/screen/${id}`)
  : [`${rates}/marginal`]) {
  const audit = object(JSON.parse(await readFile(`${path}/audit.json`, 'utf8'))),
    id = string(audit.id),
    fixture = manifest.fixtures.find(
      (f) => f.id === id && f.split === 'development' && f.kind === 'lab',
    )
  if (!fixture || !Array.isArray(audit.rows)) throw new Error('Missing development audit')
  const input = await readFile(fixture.png)
  if (hash(input) !== fixture.fixtureSha256) throw new Error('Changed input')
  const png = PNG.sync.read(input),
    source = prepare(png)
  for (const raw of audit.rows) {
    const name = string(object(raw).name),
      bytes = await readFile(`${path}/${name}.png`),
      decoded = PNG.sync.read(bytes),
      nativeBytes = await readFile(`${path}/${name}.pfm`),
      native = readDistanceMap(nativeBytes)
    if ([decoded, native].some((p) => p.width !== png.width || p.height !== png.height))
      throw new Error('Map dimensions differ')
    const start = performance.now(),
      map = distance(source, prepare(decoded)),
      elapsedMs = performance.now() - start
    let squared = 0,
      maximumError = 0
    for (let p = 0; p < map.length; p++) {
      const error = (map[p] ?? 0) - (native.values[p] ?? 0)
      squared += error * error
      maximumError = Math.max(maximumError, Math.abs(error))
    }
    const row = {
      id,
      name,
      sourceHash: fixture.fixtureSha256,
      pngHash: hash(bytes),
      nativeMapHash: hash(nativeBytes),
      maximumError,
      rmse: Math.sqrt(squared / map.length),
      predicted: poolNativePerceptual(map),
      native: poolNativePerceptual(native.values),
      elapsedMs,
    }
    rows.push(row)
    await writeFile(`${root}/${id}-${name}.json`, `${JSON.stringify(row, null, 2)}\n`)
  }
  console.log(id)
}
await writeFile(
  `${root}/maps.json`,
  `${JSON.stringify(
    {
      selection,
      rows,
      maximumPixelError: Math.max(...rows.map((r) => r.maximumError)),
      maximumRmse: Math.max(...rows.map((r) => r.rmse)),
      maximumScoreError: Math.max(
        ...rows.map((r) => Math.abs(r.predicted.maximum - r.native.maximum)),
      ),
      maximumNormError: Math.max(...rows.map((r) => Math.abs(r.predicted.norm3 - r.native.norm3))),
    },
    null,
    2,
  )}\n`,
)
