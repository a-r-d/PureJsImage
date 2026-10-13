import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { object, number, string } from '../comparison/model.ts'
import { oracle } from '../comparison/io.ts'
import { parsePreparedManifest } from './fixture-selection.ts'

const root = process.argv[2] ?? '.tmp/jpegxl-lossy-lab/transplant-20261013-v2'
const peers = '.tmp/jpegxl-lossy-lab/transplant-20261013'
const output = join(root, 'textures')
await mkdir(output, { recursive: true })
const manifest = parsePreparedManifest(
  JSON.parse(await readFile('.tmp/jpegxl-lossy-lab/corpus-512-v2/manifest.json', 'utf8')),
)
const inventory = object(JSON.parse(await readFile(join(peers, 'inventory.json'), 'utf8')))
if (!Array.isArray(inventory.rows)) throw new Error('Missing fresh peer inventory')
const rows = inventory.rows.map(object)
const comparisons = []
for (const id of ['im26-3304', 'im26-3312', 'im26-1020']) {
  const fixture = manifest.fixtures.find((f) => f.id === id && f.kind === 'lab')
  if (!fixture) throw new Error('Missing pinned texture')
  const ownDirectory = join(root, 'control', 'lab', 'transplant-control-purejsimage', `${id}-lab`)
  const ownBytes = (await readFile(join(ownDirectory, '3.jxl'))).length
  const candidates = rows
    .filter((r) => r.id === id)
    .sort(
      (a, b) =>
        Math.abs(Math.log(number(a.bytes) / ownBytes)) -
        Math.abs(Math.log(number(b.bytes) / ownBytes)),
    )
  const peer = candidates[0]
  if (!peer) throw new Error('Missing texture peer')
  const distance = number(peer.setting)
  const peerDecoded = join(output, `${id}-vips.png`)
  execFileSync(
    `${oracle}/djxl`,
    [
      join(peers, 'vips', id, `${distance}.jxl`),
      peerDecoded,
      '--num_threads=1',
      '--bits_per_sample=8',
    ],
    { stdio: 'ignore' },
  )
  const images = await Promise.all(
    [fixture.png, join(ownDirectory, '3.png'), peerDecoded].map(async (path) =>
      PNG.sync.read(await readFile(path)),
    ),
  )
  const original = images[0]
  if (!original || images.some((i) => i.width !== original.width || i.height !== original.height))
    throw new Error('Texture dimensions differ')
  const composite = new PNG({ width: original.width * 3, height: original.height })
  for (let i = 0; i < images.length; i++) {
    const image = images[i]
    if (!image) throw new Error('Missing texture pixels')
    for (let y = 0; y < image.height; y++)
      composite.data.set(
        image.data.subarray(y * image.width * 4, (y + 1) * image.width * 4),
        (y * composite.width + i * image.width) * 4,
      )
  }
  const path = join(output, `${id}-original-own-vips.png`)
  await writeFile(path, PNG.sync.write(composite))
  const decisions = object(
    JSON.parse(await readFile(join(peers, 'vips', id, `${distance}.decisions.json`), 'utf8')),
  )
  if (!Array.isArray(decisions.strategies)) throw new Error('Missing peer strategies')
  comparisons.push({
    id,
    image: path,
    order: ['original', 'own control', 'vips'],
    ownDistance: 3,
    ownBytes,
    vipsDistance: distance,
    vipsBytes: number(peer.bytes),
    differencePercent: 100 * (number(peer.bytes) / ownBytes - 1),
    strategies: [...new Set(decisions.strategies.map(number))].sort((a, b) => a - b),
    patches: number(peer.patches),
    dependencies: number(peer.dependencies),
    encodedSha256: string(peer.encodedSha256),
  })
}
await writeFile(join(output, 'comparisons.json'), `${JSON.stringify(comparisons, null, 2)}\n`)
console.log(JSON.stringify(comparisons, null, 2))
