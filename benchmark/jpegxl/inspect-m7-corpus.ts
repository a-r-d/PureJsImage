import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import sharp from 'sharp'
import selection from './production-program/m7-corpus-selection.json' with { type: 'json' }

// Inspect source properties without running codecs under evaluation or reading quality results.
const results: object[] = []
let failures = 0
for (const entry of selection.cases) {
  try {
    const bytes = await readFile(`.tmp/jpegxl-m7/sources/${entry.id}.${entry.format}`)
    if (
      bytes.length !== entry.bytes ||
      createHash('sha256').update(bytes).digest('hex') !== entry.sourceSha256
    )
      throw new Error('Source identity changed')
    const metadata = await sharp(bytes, { limitInputPixels: 30_000_000 }).metadata()
    if (metadata.width !== entry.width || metadata.height !== entry.height)
      throw new Error('Source dimensions differ from frozen metadata')
    const alpha = metadata.hasAlpha
      ? (await sharp(bytes).stats()).channels[metadata.channels - 1]
      : undefined
    results.push({
      id: entry.id,
      split: entry.split,
      sourceSha256: entry.sourceSha256,
      category: entry.category,
      width: metadata.width,
      height: metadata.height,
      depth: metadata.depth,
      bitsPerSample: metadata.bitsPerSample ?? null,
      space: metadata.space,
      channels: metadata.channels,
      hasAlpha: metadata.hasAlpha,
      ...(alpha ? { alphaMinimum: alpha.min, alphaMaximum: alpha.max } : {}),
      orientation: metadata.orientation ?? 1,
      iccSha256: metadata.icc ? createHash('sha256').update(metadata.icc).digest('hex') : null,
      status: 'inspected',
    })
  } catch (error) {
    failures++
    results.push({ id: entry.id, split: entry.split, status: 'failed', error: String(error) })
  }
}
await writeFile(
  '.tmp/jpegxl-m7/source-inventory.json',
  JSON.stringify({ schemaVersion: 1, failures, results }, null, 2) + '\n',
)
if (failures > 0) process.exitCode = 1
