import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import sharp from 'sharp'
import { downloadPinnedFile } from '../../lib/pinned-download.ts'
import { m7DiagnosticCases, m7DiagnosticGeometry } from '../m7-diagnostic-cases.ts'
import corpus from '../production-program/m7-corpus-selection.json' with { type: 'json' }
import { fixtures, hash } from './io.ts'

// Restore only this comparison's imazen inputs. Never launch the 240-source qualification.
sharp.concurrency(1)
sharp.cache(false)
await mkdir('.tmp/jpegxl-m7/sources', { recursive: true })
for (const fixture of (await fixtures()).filter((f) => f.id.startsWith('im26-'))) {
  try {
    const existing = await readFile(fixture.source)
    if (hash(existing) !== fixture.sourceSha256)
      throw new Error(`Existing input changed: ${fixture.id}`)
    if (!process.argv.includes('--verify-normalization')) continue
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
  }
  const id = fixture.id.replace(/-(diagnostic|original)$/, ''),
    entry = corpus.cases.find((row) => row.id === id)
  if (!entry) throw new Error('Source missing from pinned catalog')
  const sourcePath = `.tmp/jpegxl-m7/sources/${id}.${entry.format}`
  let bytes: Uint8Array
  try {
    bytes = await readFile(sourcePath)
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    await downloadPinnedFile({
      allowedDirectory: '.tmp/jpegxl-m7/sources',
      allowedHosts: new Set(['codec-corpus.r2.imazen.org']),
      destination: sourcePath,
      expectedSha256: entry.sourceSha256,
      maximumBytes: entry.bytes,
      url: entry.sourceUrl,
    })
    bytes = await readFile(sourcePath)
  }
  if (hash(bytes) !== entry.sourceSha256) throw new Error('Original source identity changed')
  const normalized = await sharp(bytes)
    .withIccProfile('srgb')
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  if (
    normalized.info.width !== entry.width ||
    normalized.info.height !== entry.height ||
    normalized.info.channels !== 3
  )
    throw new Error('Normalization shape changed')
  let width = entry.width,
    height = entry.height,
    data = normalized.data
  if (fixture.scope === 'capped') {
    const diagnostic = m7DiagnosticCases.find((row) => row.id === id)
    if (!diagnostic) throw new Error('Missing diagnostic geometry')
    const geometry = m7DiagnosticGeometry(width, height, diagnostic.preparation),
      image = sharp(data, { raw: { width, height, channels: 3 } })
    data = await (diagnostic.preparation.kind === 'crop'
      ? image.extract(geometry)
      : image.resize(geometry.width, geometry.height, { kernel: 'lanczos3' })
    )
      .raw()
      .toBuffer()
    width = geometry.width
    height = geometry.height
  }
  const result = Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), data])
  if (hash(result) !== fixture.sourceSha256)
    throw new Error(
      `Normalization no longer reproduces pinned pixels for ${fixture.id}; preserve existing evidence and investigate tool versions`,
    )
  await mkdir(dirname(fixture.source), { recursive: true })
  await writeFile(fixture.source, result)
  console.log(`${fixture.id}: exact pinned input reproduced`)
}
