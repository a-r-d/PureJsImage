import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { downloadPinnedFile } from '../lib/pinned-download.ts'
import { readTiaSerCorpusManifest, tiaSerCorpusDirectory, tiaSerCorpusPath } from './corpus.ts'

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

const manifest = await readTiaSerCorpusManifest()
await mkdir(tiaSerCorpusDirectory, { recursive: true })
for (const fixture of manifest.fixtures) {
  const destination = tiaSerCorpusPath(fixture.file)
  const existing = await readFile(destination).catch(() => undefined)
  if (existing !== undefined && sha256(existing) === fixture.sha256) {
    console.log(`ok       ${fixture.file}`)
    continue
  }
  await mkdir(dirname(destination), { recursive: true })
  console.log(`download ${fixture.file}`)
  await downloadPinnedFile({
    allowedDirectory: tiaSerCorpusDirectory,
    allowedHosts: new Set(['raw.githubusercontent.com']),
    destination,
    expectedSha256: fixture.sha256,
    url: new URL(fixture.path, manifest.source.baseUrl).href,
  })
}
