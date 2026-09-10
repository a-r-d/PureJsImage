import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import selection from './production-program/m7-corpus-selection.json' with { type: 'json' }

const directory = '.tmp/jpegxl-m7/sources'
await mkdir(directory, { recursive: true })
let next = 0
const failures: string[] = []
async function worker(): Promise<void> {
  for (;;) {
    const entry = selection.cases[next++]
    if (!entry) return
    const path = `${directory}/${entry.id}.${entry.format}`
    try {
      let bytes: Uint8Array
      try {
        bytes = await readFile(path)
      } catch (error) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
        const response = await fetch(entry.sourceUrl, { signal: AbortSignal.timeout(120_000) })
        if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)
        const chunks: Uint8Array[] = []
        let length = 0
        for await (const chunk of response.body) {
          length += chunk.length
          if (length > entry.bytes || length > 40_000_000)
            throw new Error('Source exceeds pinned size')
          chunks.push(chunk)
        }
        bytes = new Uint8Array(length)
        let offset = 0
        for (const chunk of chunks) {
          bytes.set(chunk, offset)
          offset += chunk.length
        }
        if (
          bytes.length !== entry.bytes ||
          createHash('sha256').update(bytes).digest('hex') !== entry.sourceSha256
        )
          throw new Error('Source checksum or size changed')
        await writeFile(`${path}.part`, bytes)
        await rename(`${path}.part`, path)
      }
      if (
        bytes.length !== entry.bytes ||
        createHash('sha256').update(bytes).digest('hex') !== entry.sourceSha256
      )
        throw new Error('Existing source checksum or size changed')
      console.log(entry.id, entry.split, 'verified')
    } catch (error) {
      failures.push(entry.id)
      console.error(entry.id, String(error))
    }
  }
}
await Promise.all([worker(), worker()])
if (failures.length) {
  console.error('Failed sources remain in the cohort:', failures)
  process.exitCode = 1
}
