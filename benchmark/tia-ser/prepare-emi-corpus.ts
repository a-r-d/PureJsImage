import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { downloadPinnedFile } from '../lib/pinned-download.ts'
import {
  readTiaEmiCorpusManifest,
  tiaEmiCorpusDirectory,
  tiaEmiCorpusPath,
  type TiaEmiCorpusResource,
} from './emi-corpus.ts'

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const manifest = await readTiaEmiCorpusManifest()
await mkdir(tiaEmiCorpusDirectory, { recursive: true })

const prepare = async (resource: TiaEmiCorpusResource): Promise<void> => {
  const destination = tiaEmiCorpusPath(resource.file)
  const existing = await readFile(destination).catch(() => undefined)
  if (existing !== undefined && sha256(existing) === resource.sha256) {
    console.log(`ok       ${resource.file}`)
    return
  }
  await mkdir(dirname(destination), { recursive: true })
  console.log(`download ${resource.file}`)
  await downloadPinnedFile({
    allowedDirectory: dirname(destination),
    allowedHosts: new Set(['raw.githubusercontent.com']),
    destination,
    expectedSha256: resource.sha256,
    url: new URL(resource.file, manifest.source.baseUrl).href,
  })
}

for (const fixture of manifest.fixtures) {
  await prepare(fixture)
  for (const companion of fixture.companions) await prepare(companion)
}
