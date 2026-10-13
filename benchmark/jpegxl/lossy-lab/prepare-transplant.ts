import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { initialize } from '../comparison/adapters.ts'
import { hash, work } from '../comparison/io.ts'
import { extractDecisions } from './decisions.ts'
import { parsePreparedManifest, selectPreparedFixtures } from './fixture-selection.ts'

const directory = process.argv[2] ?? '.tmp/jpegxl-lossy-lab/transplant-20261013'
const manifest = parsePreparedManifest(
  JSON.parse(await readFile('.tmp/jpegxl-lossy-lab/corpus-512-v2/manifest.json', 'utf8')),
)
const fixtures = selectPreparedFixtures(manifest, { mode: 'lab' }).fixtures
if (fixtures.length !== 64) throw new Error('Expected all 64 frozen development photos')
const settings = [0.45, 0.65, 0.9, 1.3, 1.85, 3, 3.8, 5.35, 7.5, 0.5, 1, 2, 4, 7]
await mkdir(directory, { recursive: true })
const adapter = await initialize(
  'vips',
  async (name) => Uint8Array.from(await readFile(`${work}/assets/${name}`)).buffer,
)
if (!adapter.encode) throw new Error('Vips encoder missing')
const encode = adapter.encode
const rows = []
for (const fixture of fixtures) {
  const input = await readFile(fixture.png)
  if (hash(input) !== fixture.fixtureSha256) throw new Error('Frozen crop changed')
  const image = PNG.sync.read(input)
  const pixels = {
    width: image.width,
    height: image.height,
    channels: 4,
    data: new Uint8Array(image.data),
    interpretation: 'srgb',
  }
  const output = join(directory, 'vips', fixture.id)
  await mkdir(output, { recursive: true })
  for (const setting of settings) {
    const started = performance.now()
    const result = await encode(pixels, { effort: 7, lossless: false, value: setting })
    const encodeMs = performance.now() - started
    if (result.kind !== 'jxl') throw new Error('Expected vips JXL')
    await writeFile(join(output, `${setting}.jxl`), result.bytes)
    const decisions = await extractDecisions(result.bytes)
    await writeFile(join(output, `${setting}.decisions.json`), JSON.stringify(decisions))
    rows.push({
      id: fixture.id,
      setting,
      fixtureSha256: fixture.fixtureSha256,
      encodedSha256: hash(result.bytes),
      bytes: result.bytes.length,
      encodeMs,
      strategies: [...new Set(decisions.strategies)],
      patches: decisions.patches.length,
      dependencies: decisions.dependencies.length,
      noise: decisions.noise !== null,
      splines: decisions.splines.length,
      gaborish: decisions.gaborish,
      epfIterations: decisions.epfIterations,
      xScale: decisions.xQuantizationScale,
      bScale: decisions.bQuantizationScale,
      globalScale: decisions.globalScale,
      quantDc: decisions.quantDc,
      dcQuantization: decisions.dcQuantization,
      customMatrices: decisions.quantizationTables
        .map((t, i) => (t === null ? -1 : i))
        .filter((i) => i >= 0),
    })
  }
  await writeFile(
    join(directory, 'inventory.json'),
    `${JSON.stringify(
      {
        peer: 'wasm-vips 0.0.19',
        effort: 7,
        settings,
        rows,
      },
      null,
      2,
    )}\n`,
  )
  console.log(`${fixture.id}: ${rows.length}/${fixtures.length * settings.length}`)
}
