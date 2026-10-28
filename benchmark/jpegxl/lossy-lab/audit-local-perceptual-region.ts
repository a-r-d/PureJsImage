/** Fixed photographic windows for bounded-map fidelity; never selects native peaks. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { PNG } from 'pngjs'
import { hash } from '../comparison/io.ts'
import { parsePreparedManifest } from './fixture-selection.ts'
import { poolNativePerceptual } from './libjxl-perceptual-pool-port.ts'
import { predictionAgreement } from './local-error-predictors.ts'
import { localPerceptualMap, prepareLocalPerceptualReference } from './local-perceptual-region.ts'
import { readDistanceMap } from './local-rate-audit.ts'

const [root] = process.argv.slice(2)
if (!root) throw new Error('Need output directory')
await mkdir(root, { recursive: true })
const manifest = parsePreparedManifest(
  JSON.parse(await readFile('.tmp/jpegxl-lossy-lab/corpus-512-v2/manifest.json', 'utf8')),
)
const rows = []
for (const id of manifest.screenIds) {
  const fixture = manifest.fixtures.find(
    (f) => f.id === id && f.split === 'development' && f.kind === 'lab',
  )
  if (!fixture) throw new Error('Missing development fixture')
  const file = await readFile(fixture.png)
  if (hash(file) !== fixture.fixtureSha256) throw new Error('Changed source')
  const source = PNG.sync.read(file)
  if (source.width !== 512 || source.height !== 512)
    throw new Error('Fixed windows require 512 crops')
  for (const box of [
    { x: 0, y: 0, width: 32, height: 32 },
    { x: 239, y: 241, width: 32, height: 32 },
    { x: 480, y: 480, width: 32, height: 32 },
  ]) {
    const reference = prepareLocalPerceptualReference(source.data, 512, 512, box),
      points = []
    for (const name of ['control', 'changed']) {
      const path = `.tmp/jpegxl-lossy-lab/predictors-20261028/screen/${id}/${name}`,
        pngBytes = await readFile(`${path}.png`),
        png = PNG.sync.read(pngBytes),
        nativeBytes = await readFile(`${path}.pfm`),
        native = readDistanceMap(nativeBytes)
      if ([png, native].some((p) => p.width !== 512 || p.height !== 512))
        throw new Error('Mismatched image')
      const local = localPerceptualMap(reference, png.data),
        nativeWindow = new Float32Array(box.width * box.height)
      let maximumError = 0
      for (let y = 0; y < box.height; y++)
        for (let x = 0; x < box.width; x++) {
          const p = y * box.width + x,
            expected = native.values[(y + box.y) * 512 + x + box.x] ?? 0
          nativeWindow[p] = expected
          maximumError = Math.max(maximumError, Math.abs((local[p] ?? 0) - expected))
        }
      points.push({
        name,
        pngHash: hash(pngBytes),
        nativeHash: hash(nativeBytes),
        maximumError,
        score: poolNativePerceptual(local),
        native: poolNativePerceptual(nativeWindow),
      })
    }
    const a = points[0],
      b = points[1]
    if (!a || !b) throw new Error('Missing endpoints')
    rows.push({
      id,
      box,
      crop: reference.crop,
      points,
      maximum: {
        predicted: b.score.maximum - a.score.maximum,
        actual: 100 * (b.native.maximum / a.native.maximum - 1),
      },
      norm3: {
        predicted: b.score.norm3 - a.score.norm3,
        actual: 100 * (b.native.norm3 / a.native.norm3 - 1),
      },
    })
  }
  console.log(id)
}
await writeFile(
  `${root}/summary.json`,
  `${JSON.stringify(
    {
      rows,
      maximumPixelError: Math.max(...rows.flatMap((r) => r.points.map((p) => p.maximumError))),
      maximum: predictionAgreement(
        rows.map((r) => r.maximum),
        0.1,
      ),
      norm3: predictionAgreement(
        rows.map((r) => r.norm3),
        0.1,
      ),
    },
    null,
    2,
  )}\n`,
)
