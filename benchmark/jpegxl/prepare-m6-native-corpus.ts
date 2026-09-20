import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import selection from './production-program/m6-native-sources.json' with { type: 'json' }

const directory = process.argv[2] ?? '.tmp/jpegxl-m6-native/encoded'
const encoder = '.tmp/jpegxl-oracles/libjxl-v0.12.0/source/build-pinned/tools/cjxl'
const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')
const encoderSha256 = sha256(await readFile(encoder))
if (encoderSha256 !== '5c9dd3d879b81545b77947f9a6f1f7a4e58bbe2e4f3c2a52ca70365544939762')
  throw new Error('The M6 corpus requires the pinned libjxl encoder')
if (sharp.versions.sharp !== '0.35.3') throw new Error('The M6 normalization requires sharp 0.35.3')
await mkdir(directory, { recursive: true })
const cases = []
for (const [index, entry] of selection.entries.entries()) {
  if (!/^[a-z0-9-]+$/u.test(entry.id)) throw new Error('Invalid case ID')
  const original = await readFile(entry.sourcePath)
  if (sha256(original) !== entry.sha256) throw new Error(`Original source changed: ${entry.id}`)
  const decoded = await sharp(original, { sequentialRead: true })
    .toColourspace('srgb')
    .removeAlpha()
    .raw({ depth: 'uchar' })
    .toBuffer({ resolveWithObject: true })
  if (
    decoded.info.width !== entry.width ||
    decoded.info.height !== entry.height ||
    decoded.info.channels !== 3
  )
    throw new Error(`Native dimensions or channel count changed: ${entry.id}`)
  const input = join(directory, `${entry.id}.ppm`)
  const normalized = Buffer.concat([
    Buffer.from(`P6\n${entry.width} ${entry.height}\n255\n`),
    decoded.data,
  ])
  await writeFile(input, normalized)
  const output = join(directory, `${entry.id}.jxl`)
  // Both the main image and the photograph keep their original dimensions. Half the cohort
  // uses an internal DC frame; two cases also permute physical section order around the center.
  const options = [
    '--modular=0',
    '--distance=1',
    '--effort=3',
    '--num_threads=1',
    '--progressive_ac',
    `--progressive_dc=${index % 2}`,
    '--patches=0',
    '--dots=0',
    `--group_order=${index % 5 === 0 ? 1 : 0}`,
  ]
  const result = spawnSync(encoder, [input, output, ...options], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`${entry.id}: ${result.stderr}`)
  const encoded = await readFile(output)
  cases.push({
    ...entry,
    normalizedPath: input,
    normalizedSha256: sha256(normalized),
    jxlPath: output,
    jxlSha256: sha256(encoded),
    jxlBytes: encoded.length,
    encoderOptions: options,
  })
  await writeFile(
    join(directory, 'manifest.json'),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        frozenAt: selection.frozenAt,
        selection: selection.selection,
        normalization:
          'Decode original JPEG raster to 8-bit sRGB PPM; no resize, crop or auto-orientation.',
        normalizationVersions: sharp.versions,
        encoderSha256,
        cases,
      },
      null,
      2,
    )}\n`,
  )
  console.log(`${entry.id}: ${entry.width}x${entry.height}, ${encoded.length} JPEG XL bytes`)
}
