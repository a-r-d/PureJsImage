import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { PNG } from 'pngjs'
import { number, object } from '../comparison/model.ts'
import { parsePreparedManifest, selectPreparedFixtures } from './fixture-selection.ts'
import { frequencyBands, frequencyError } from './frequency-error.ts'
import { displayLinearPlanes, displayXyb } from './libjxl-display-loss.ts'

const [output] = process.argv.slice(2)
if (!output) throw new Error('Need output JSON path')
const manifest = parsePreparedManifest(
  JSON.parse(await readFile('.tmp/jpegxl-lossy-lab/corpus-512-v2/manifest.json', 'utf8')),
)
const selection = selectPreparedFixtures(manifest, { mode: 'lab' })
if (!selection.complete || selection.fixtures.length !== 64)
  throw new Error('Incomplete fixed development lab')
const root =
  '.tmp/jpegxl-lossy-lab/standalone-reconstruction-20261017/forward-lab/standalone-forward-all-purejsimage'
const rows: (ReturnType<typeof frequencyError> & {
  id: string
  distance: number
  bytes: number
  ssimulacra2: number
})[] = []
for (const fixture of selection.fixtures) {
  const sourceBytes = await readFile(fixture.png)
  if (createHash('sha256').update(sourceBytes).digest('hex') !== fixture.fixtureSha256)
    throw new Error('Source changed')
  const source = PNG.sync.read(sourceBytes),
    planes = displayXyb(displayLinearPlanes(source.data, source.width, source.height))
  const saved = object(JSON.parse(await readFile(`${root}/${fixture.id}-lab/result.json`, 'utf8')))
  if (
    saved.strategyPort !== 'standalone-forward-all' ||
    saved.fixtureSha256 !== fixture.fixtureSha256 ||
    !Array.isArray(saved.points) ||
    saved.points.length !== 9
  )
    throw new Error('Wrong retained results')
  for (const value of saved.points) {
    const point = object(value),
      distance = number(point.setting)
    const png = PNG.sync.read(await readFile(`${root}/${fixture.id}-lab/${distance}.png`))
    if (png.width !== source.width || png.height !== source.height)
      throw new Error('Output extent differs')
    rows.push({
      id: fixture.id,
      distance,
      bytes: number(point.bytes),
      ssimulacra2: number(point.ssimulacra2),
      ...frequencyError(
        planes,
        displayXyb(displayLinearPlanes(png.data, png.width, png.height)),
        png.width,
        png.height,
      ),
    })
  }
  console.log(fixture.id)
}
const summary = [...new Set(rows.map((r) => r.distance))]
  .sort((a, b) => a - b)
  .map((distance) => {
    const chosen = rows.filter((r) => r.distance === distance)
    const means = (key: keyof ReturnType<typeof frequencyError>) =>
      Array.from(
        { length: key === 'coefficientError' || key === 'coefficientSignal' ? 192 : 12 },
        (_, i) => chosen.reduce((sum, r) => sum + (r[key][i] ?? 0), 0) / chosen.length,
      )
    return {
      distance,
      count: chosen.length,
      error: means('error'),
      signal: means('signal'),
      lost: means('lost'),
      added: means('added'),
      coefficientError: means('coefficientError'),
      coefficientSignal: means('coefficientSignal'),
    }
  })
await writeFile(
  output,
  `${JSON.stringify({ base: 'bb43c721', channels: ['normalized X', 'Y', 'B-Y'], bands: frequencyBands, policy: 'Display-domain diagnostic. No peer decisions, native metric replacement or holdout reads.', summary, rows }, null, 2)}\n`,
)
