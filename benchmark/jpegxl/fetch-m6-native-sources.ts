/** Download missing frozen originals. Existing files must match their recorded checksum. */
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import sources from './production-program/m6-native-sources.json' with { type: 'json' }
const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
for (const entry of sources.entries) {
  try {
    const existing = await readFile(entry.sourcePath)
    if (hash(existing) !== entry.sha256) throw new Error(`Existing original differs: ${entry.id}`)
    console.log(`${entry.id}: existing original verified`)
    continue
  } catch (error) {
    if (
      typeof error !== 'object' ||
      error === null ||
      !('code' in error) ||
      error.code !== 'ENOENT'
    )
      throw error
  }
  const response = await fetch(entry.sourceUrl, {
    headers: { 'User-Agent': 'PureJsImage-M6-fixture-preparation' },
    signal: AbortSignal.timeout(60_000),
  })
  if (!response.ok || !response.body) throw new Error(`${entry.id}: HTTP ${response.status}`)
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      length += next.value.length
      if (length > 67_108_864) throw new Error(`${entry.id}: original exceeds the download bound`)
      chunks.push(next.value)
    }
  } finally {
    await reader.cancel()
    reader.releaseLock()
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  if (hash(bytes) !== entry.sha256)
    throw new Error(`${entry.id}: downloaded original differs from the frozen checksum`)
  await mkdir(dirname(entry.sourcePath), { recursive: true })
  await writeFile(entry.sourcePath, bytes)
  console.log(`${entry.id}: original downloaded and verified`)
}
