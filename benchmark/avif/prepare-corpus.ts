import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { downloadPinnedFile } from '../lib/pinned-download.ts'
import { avifCorpusDirectory, avifFixtures } from './corpus.ts'

const checksum = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')
const avifDownloadHosts: ReadonlySet<string> = new Set(['raw.githubusercontent.com'])

await mkdir(avifCorpusDirectory, { recursive: true })
for (const fixture of avifFixtures) {
  const path = join(avifCorpusDirectory, fixture.file)
  try {
    if (checksum(await readFile(path)) === fixture.expected.sha256) {
      console.log(`ok       ${fixture.file}`)
      continue
    }
  } catch {
    // Download below.
  }

  console.log(`download ${fixture.file}`)
  await downloadPinnedFile({
    allowedDirectory: avifCorpusDirectory,
    allowedHosts: avifDownloadHosts,
    destination: path,
    expectedSha256: fixture.expected.sha256,
    url: fixture.url,
  })
}
