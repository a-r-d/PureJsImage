import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { downloadPinnedFile } from '../lib/pinned-download.ts'
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
        await downloadPinnedFile({
          allowedDirectory: directory,
          allowedHosts: new Set(['codec-corpus.r2.imazen.org']),
          destination: path,
          expectedSha256: entry.sourceSha256,
          maximumBytes: Math.min(entry.bytes, 40_000_000),
          url: entry.sourceUrl,
        })
        bytes = await readFile(path)
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
