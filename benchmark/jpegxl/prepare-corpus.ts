import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { jpegXlCorpus } from './corpus.ts'

const destination = join('benchmark', 'fixtures', 'jpegxl')
await mkdir(destination, { recursive: true })

for (const entry of jpegXlCorpus) {
  const response = await fetch(entry.source)
  if (!response.ok) throw new Error(`JPEG XL fixture ${entry.id} returned HTTP ${response.status}`)
  const data = new Uint8Array(await response.arrayBuffer())
  if (data.byteLength !== entry.bytes) {
    throw new Error(
      `JPEG XL fixture ${entry.id} has ${data.byteLength} bytes; expected ${entry.bytes}`,
    )
  }
  const digest = createHash('sha256').update(data).digest('hex')
  if (digest !== entry.sha256) {
    throw new Error(`JPEG XL fixture ${entry.id} checksum ${digest} does not match the manifest`)
  }
  await writeFile(join(destination, `${entry.id}.jxl`), data)
  console.log(`Prepared ${entry.id}: ${entry.width}x${entry.height}, ${entry.features.join(', ')}`)
}
