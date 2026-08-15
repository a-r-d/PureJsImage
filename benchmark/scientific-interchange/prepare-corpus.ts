import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { downloadPinnedFile } from '../lib/pinned-download.ts'
import manifest from './corpus.json' with { type: 'json' }

const directory = 'benchmark/corpus/files/scientific-interchange'
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

await mkdir(directory, { recursive: true })
for (const fixture of manifest.downloads) {
  const destination = join(directory, fixture.file)
  const existing = await readFile(destination).catch(() => undefined)
  if (existing !== undefined && sha256(existing) === fixture.sha256) {
    console.log(`ok       ${fixture.file}`)
    continue
  }
  console.log(`download ${fixture.file}`)
  await downloadPinnedFile({
    allowedDirectory: directory,
    allowedHosts: new Set(['raw.githubusercontent.com']),
    destination,
    expectedSha256: fixture.sha256,
    url: fixture.url,
  })
}
