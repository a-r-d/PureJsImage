import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { downloadPinnedFile } from '../lib/pinned-download.ts'
import { hdf5CorpusDirectory, hdf5CorpusPath, readHdf5CorpusManifest } from './corpus.ts'

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

const manifest = await readHdf5CorpusManifest()
await mkdir(hdf5CorpusDirectory, { recursive: true })
for (const fixture of manifest.fixtures) {
  const destination = hdf5CorpusPath(fixture.file)
  const existing = await readFile(destination).catch(() => undefined)
  if (
    existing !== undefined &&
    existing.byteLength === fixture.bytes &&
    sha256(existing) === fixture.sha256
  ) {
    console.log(`ok       ${fixture.file}`)
    continue
  }
  console.log(`download ${fixture.file}`)
  await downloadPinnedFile({
    allowedDirectory: hdf5CorpusDirectory,
    allowedHosts: new Set(['raw.githubusercontent.com']),
    destination,
    expectedSha256: fixture.sha256,
    maximumBytes: fixture.bytes,
    url: new URL(fixture.path, manifest.source.baseUrl).href,
  })
}
