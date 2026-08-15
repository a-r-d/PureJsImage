import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { downloadPinnedFile } from '../lib/pinned-download.ts'
import { extractPinnedZipEntry } from '../lib/zip-entry.ts'
import {
  readVeloxEmdCorpusManifest,
  veloxEmdCorpusDirectory,
  veloxEmdCorpusPath,
} from './corpus.ts'

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const manifest = await readVeloxEmdCorpusManifest()
await mkdir(veloxEmdCorpusDirectory, { recursive: true })
for (const fixture of manifest.fixtures) {
  const destination = veloxEmdCorpusPath(fixture.file)
  const existing = await readFile(destination).catch(() => undefined)
  if (existing !== undefined && sha256(existing) === fixture.sha256) {
    console.log(`ok       ${fixture.file}`)
    continue
  }
  console.log(`download ${fixture.file}`)
  await downloadPinnedFile({
    allowedDirectory: veloxEmdCorpusDirectory,
    allowedHosts: new Set(['raw.githubusercontent.com']),
    destination,
    expectedSha256: fixture.sha256,
    url: new URL(fixture.file, manifest.source.baseUrl).href,
  })
}

for (const fixture of manifest.spectrumFixtures) {
  const destination = veloxEmdCorpusPath(fixture.file)
  const existing = await readFile(destination).catch(() => undefined)
  if (existing !== undefined && sha256(existing) === fixture.sha256) {
    console.log(`ok       ${fixture.file}`)
    continue
  }
  const archivePath = veloxEmdCorpusPath(fixture.archive)
  const archiveExisting = await readFile(archivePath).catch(() => undefined)
  if (archiveExisting === undefined || sha256(archiveExisting) !== fixture.archiveSha256) {
    console.log(`download ${fixture.archive}`)
    await downloadPinnedFile({
      allowedDirectory: veloxEmdCorpusDirectory,
      allowedHosts: new Set(['raw.githubusercontent.com']),
      destination: archivePath,
      expectedSha256: fixture.archiveSha256,
      maximumBytes: 16_777_216,
      url: new URL(fixture.archive, manifest.source.baseUrl).href,
    })
  }
  const archive = await readFile(archivePath)
  const extracted = extractPinnedZipEntry(archive, fixture.entry, 67_108_864)
  const extractedSha256 = sha256(extracted)
  if (extractedSha256 !== fixture.sha256) {
    throw new Error(
      `${fixture.file} checksum mismatch: expected ${fixture.sha256}, got ${extractedSha256}`,
    )
  }
  await writeFile(destination, extracted, { mode: 0o600 })
  console.log(`extract  ${fixture.file}`)
}
