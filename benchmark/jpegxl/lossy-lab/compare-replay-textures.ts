import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { oracle, hash } from '../comparison/io.ts'
import { extractDecisions } from './decisions.ts'
import { parsePreparedManifest } from './fixture-selection.ts'
import { assertTransplantDecisions, encodeTransplant, transplantOverrides } from './transplant.ts'

const root = process.argv[2] ?? '.tmp/jpegxl-lossy-lab/replay-textures-v2'
await mkdir(root, { recursive: true })
const manifest = parsePreparedManifest(
  JSON.parse(await readFile('.tmp/jpegxl-lossy-lab/corpus-512-v2/manifest.json', 'utf8')),
)
const rows = []
for (const id of ['im26-3304', 'im26-3312', 'im26-1020']) {
  const fixture = manifest.fixtures.find((f) => f.id === id && f.kind === 'lab')
  if (!fixture) throw new Error('Missing pinned texture')
  const peer = `.tmp/jpegxl-lossy-lab/transplant-20261013/vips/${id}/3.jxl`
  const d = await extractDecisions(await readFile(peer), true)
  const input = PNG.sync.read(await readFile(fixture.png))
  const overrides = transplantOverrides('all', d)
  const result = await encodeTransplant(
    new Uint8Array(input.data),
    input.width,
    input.height,
    3,
    overrides,
  )
  assertTransplantDecisions(overrides, await extractDecisions(result.bytes))
  const allJxl = join(root, `${id}-all.jxl`),
    allPng = join(root, `${id}-all.png`),
    vipsPng = join(root, `${id}-vips.png`)
  await writeFile(allJxl, result.bytes)
  for (const [source, output] of [
    [allJxl, allPng],
    [peer, vipsPng],
  ]) {
    if (!source || !output) throw new Error('Missing texture path')
    execFileSync(`${oracle}/djxl`, [source, output, '--num_threads=1', '--bits_per_sample=8'], {
      stdio: 'ignore',
    })
  }
  const controlBase = `.tmp/jpegxl-lossy-lab/transplant-20261013-v2/control/lab/transplant-control-purejsimage/${id}-lab/3`
  const strategyBase = `.tmp/jpegxl-lossy-lab/replay-v4/strategy/lab/force-strategy-purejsimage/${id}-lab/3`
  const images = await Promise.all(
    [fixture.png, `${controlBase}.png`, `${strategyBase}.png`, allPng, vipsPng].map(async (p) =>
      PNG.sync.read(await readFile(p)),
    ),
  )
  const composite = new PNG({ width: 512 * images.length, height: 512 })
  const contrast = new PNG({ width: 256 * images.length, height: 256 })
  const means = new Float64Array(3)
  for (let y = 128; y < 384; y++)
    for (let x = 128; x < 384; x++)
      for (let c = 0; c < 3; c++)
        means[c] = (means[c] ?? 0) + (input.data[(y * 512 + x) * 4 + c] ?? 0) / 65536
  for (let column = 0; column < images.length; column++) {
    const image = images[column]
    if (!image || image.width !== 512 || image.height !== 512)
      throw new Error('Texture dimensions changed')
    for (let y = 0; y < 512; y++)
      composite.data.set(
        image.data.subarray(y * 512 * 4, (y + 1) * 512 * 4),
        (y * composite.width + column * 512) * 4,
      )
    for (let y = 0; y < 256; y++)
      for (let x = 0; x < 256; x++)
        for (let c = 0; c < 4; c++)
          contrast.data[(y * contrast.width + column * 256 + x) * 4 + c] =
            c === 3
              ? 255
              : Math.max(
                  0,
                  Math.min(
                    255,
                    128 +
                      ((image.data[((y + 128) * 512 + x + 128) * 4 + c] ?? 0) - (means[c] ?? 0)) *
                        4,
                  ),
                )
  }
  const imagePath = join(root, `${id}-comparison.png`),
    contrastPath = join(root, `${id}-center-contrast.png`)
  await writeFile(imagePath, PNG.sync.write(composite))
  await writeFile(contrastPath, PNG.sync.write(contrast))
  rows.push({
    id,
    distance: 3,
    order: ['original', 'control', 'forced strategy', 'all maps', 'vips'],
    bytes: [
      null,
      (await readFile(`${controlBase}.jxl`)).length,
      (await readFile(`${strategyBase}.jxl`)).length,
      result.bytes.length,
      (await readFile(peer)).length,
    ],
    image: imagePath,
    contrastImage: contrastPath,
    contrast:
      'central 256x256 crop; original channel means mapped to 128, differences multiplied by four for visibility',
    allEncodedSha256: hash(result.bytes),
  })
}
await writeFile(join(root, 'comparisons.json'), `${JSON.stringify(rows, null, 2)}\n`)
console.log(JSON.stringify(rows, null, 2))
