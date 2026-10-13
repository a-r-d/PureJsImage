import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { hash } from '../comparison/io.ts'
import { parsePreparedManifest, selectPreparedFixtures } from './fixture-selection.ts'

const root = process.argv[2] ?? '.tmp/jpegxl-lossy-lab/transplant-20261013-v2'
const peers = '.tmp/jpegxl-lossy-lab/transplant-20261013'
const manifest = parsePreparedManifest(
  JSON.parse(await readFile('.tmp/jpegxl-lossy-lab/corpus-512-v2/manifest.json', 'utf8')),
)
const fixtures = selectPreparedFixtures(manifest, { mode: 'lab' }).fixtures
const distances = [0.45, 0.65, 0.9, 1.3, 1.85, 3, 3.8, 5.35, 7.5]
let equal = 0,
  different = 0,
  peerEqual = 0,
  peerDifferent = 0
const details = []
for (const fixture of fixtures)
  for (const distance of distances) {
    const own = join(
      root,
      'control',
      'lab',
      'transplant-control-purejsimage',
      `${fixture.id}-lab`,
      `${distance}.jxl`,
    )
    const production = join(
      '.tmp/jpegxl-lossy-lab/final-promoted-photos',
      'final-promoted-purejsimage',
      `${fixture.id}-lab`,
      `${distance}.jxl`,
    )
    const [a, b, freshPeer, cachedPeer] = await Promise.all([
      readFile(own),
      readFile(production),
      readFile(join(peers, 'vips', fixture.id, `${distance}.jxl`)),
      readFile(
        join(
          '.tmp/jpegxl-lossy-lab/peer-cache/vips-0.0.19-curve',
          fixture.fixtureSha256,
          `${distance}.jxl`,
        ),
      ),
    ])
    if (hash(a) === hash(b)) equal++
    else {
      different++
      details.push({ id: fixture.id, distance, ownBytes: a.length, productionBytes: b.length })
    }
    if (hash(freshPeer) === hash(cachedPeer)) peerEqual++
    else peerDifferent++
  }
await writeFile(
  join(root, 'control-public-audit.json'),
  JSON.stringify({ equal, different, details }, null, 2),
)
await writeFile(
  join(peers, 'peer-cache-audit.json'),
  JSON.stringify({ equal: peerEqual, different: peerDifferent, missing: 0 }, null, 2),
)
if (different || peerDifferent)
  throw new Error('Transplant baseline identity changed; inspect the audit before reusing scores')
console.log(`${equal} identical control files; ${peerEqual} identical peer files`)
