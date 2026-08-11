import { mkdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { downloadPinnedFile } from '../lib/pinned-download.ts'
import { jpegXlCorpus } from './corpus.ts'

const destination = join('benchmark', 'fixtures', 'jpegxl')
await mkdir(destination, { recursive: true })
const allowedHosts: ReadonlySet<string> = new Set(['raw.githubusercontent.com'])

for (const entry of jpegXlCorpus) {
  const fixturePath = join(destination, `${entry.id}.jxl`)
  await downloadPinnedFile({
    allowedDirectory: destination,
    allowedHosts,
    destination: fixturePath,
    expectedSha256: entry.sha256,
    maximumBytes: entry.bytes,
    url: entry.source,
  })
  const fixture = await stat(fixturePath)
  if (fixture.size !== entry.bytes) {
    throw new Error(
      `JPEG XL fixture ${entry.id} has ${fixture.size} bytes; expected ${entry.bytes}`,
    )
  }
  console.log(`Prepared ${entry.id}: ${entry.width}x${entry.height}, ${entry.features.join(', ')}`)
}
