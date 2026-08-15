import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { downloadPinnedFile } from '../lib/pinned-download.ts'
import {
  digitalMicrographCorpusDirectory,
  digitalMicrographCorpusPath,
  readDigitalMicrographCorpusManifest,
} from './corpus.ts'

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

const manifest = await readDigitalMicrographCorpusManifest()
await mkdir(digitalMicrographCorpusDirectory, { recursive: true })
for (const fixture of manifest.fixtures) {
  const destination = digitalMicrographCorpusPath(fixture.file)
  const existing = await readFile(destination).catch(() => undefined)
  if (existing !== undefined && sha256(existing) === fixture.sha256) {
    console.log(`ok       ${fixture.file}`)
    continue
  }
  console.log(`download ${fixture.file}`)
  await downloadPinnedFile({
    allowedDirectory: digitalMicrographCorpusDirectory,
    allowedHosts: new Set(['raw.githubusercontent.com']),
    destination,
    expectedSha256: fixture.sha256,
    url: new URL(fixture.path, manifest.source.baseUrl).href,
  })
}
