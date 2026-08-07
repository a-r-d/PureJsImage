import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { avifCorpusDirectory, avifFixtures } from './corpus.ts'

const checksum = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')

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
  const response = await fetch(fixture.url, { redirect: 'follow' })
  if (!response.ok) throw new Error(`Failed to download ${fixture.file}: HTTP ${response.status}`)
  const data = new Uint8Array(await response.arrayBuffer())
  const actual = checksum(data)
  if (actual !== fixture.expected.sha256) {
    throw new Error(
      `${fixture.file} checksum mismatch: expected ${fixture.expected.sha256}, got ${actual}`,
    )
  }
  const temporary = `${path}.download`
  await writeFile(temporary, data)
  await rm(path, { force: true })
  await rename(temporary, path)
}
