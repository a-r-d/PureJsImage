import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import manifest from './production-program/corpora/jpeg-archive-coco-val2017.json' with {
  type: 'json',
}
import { reportArgument } from './report-provenance.ts'

const directory = reportArgument('--output-dir', '.tmp/jpegxl-m1-coco')
await mkdir(join(directory, 'val2017'), { recursive: true })
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
for (const entry of manifest.cases) {
  if (
    !/^val2017\/\d+\.jpg$/.test(entry.sourcePath) ||
    !/^[0-9a-f]{64}$/.test(entry.sha256) ||
    entry.bytes < 1
  )
    throw new Error('Invalid pinned COCO entry')
  const path = join(directory, entry.sourcePath)
  let existing: Uint8Array | undefined
  try {
    existing = await readFile(path)
  } catch (error) {
    if (
      typeof error !== 'object' ||
      error === null ||
      !('code' in error) ||
      error.code !== 'ENOENT'
    )
      throw error
  }
  if (existing && existing.length === entry.bytes && hash(existing) === entry.sha256) continue
  // The dataset's custom image hostname has a mismatched TLS certificate.
  const response = await fetch(
    `https://s3.amazonaws.com/images.cocodataset.org/${entry.sourcePath}`,
  )
  if (!response.ok || !response.body) throw new Error(`${entry.id}: HTTP ${response.status}`)
  const bytes = new Uint8Array(entry.bytes)
  let offset = 0
  for await (const chunk of response.body) {
    if (offset + chunk.byteLength > bytes.byteLength)
      throw new Error(`${entry.id}: download exceeds pinned length`)
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  if (offset !== entry.bytes || hash(bytes) !== entry.sha256)
    throw new Error(`${entry.id}: checksum mismatch`)
  await writeFile(path, bytes)
}
console.log(`Verified all ${manifest.cases.length} pinned COCO sources; no selection performed`)
