/** Recheck the ten RGB8 high-band controls without changing the frozen metric protocol. */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import sharp from 'sharp'
import ceiling from './production-program/m7-prompt10-native-ceiling.json' with { type: 'json' }
import corpus from './production-program/m7-corpus-selection.json' with { type: 'json' }

const directory = '.tmp/jpegxl-m7/recovery-ceiling-controls-v2'
const native = '.tmp/jpegxl-oracles/libjxl-v0.12.0/source/build-pinned/tools'
const rust = '.tmp/jpegxl-oracles/jxl-rs-07ab48f/target/release/jxl_cli'
const metric = '.tmp/jpegxl-oracles/libjxl-v0.12.0/source/build-m7-metrics/tools/ssimulacra2'
const output = process.argv[2]
if (!output)
  throw new Error('Usage: node benchmark/jpegxl/audit-m7-ceiling-controls.ts output.json')
await mkdir(directory, { recursive: true })
const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const run = (path: string, args: readonly string[]): string => {
  const result = spawnSync(path, args, {
    encoding: 'utf8',
    timeout: 600_000,
    maxBuffer: 4 * 1024 * 1024,
  })
  if (result.status !== 0) throw new Error(`${path}: ${result.stderr}; ${result.error ?? ''}`)
  return result.stdout
}
const ppm = (bytes: Uint8Array): { width: number; height: number; pixels: Uint8Array } => {
  const match = /^P6\s+(\d+)\s+(\d+)\s+255\s/u.exec(
    new TextDecoder().decode(bytes.subarray(0, 100)),
  )
  if (!match) throw new Error('Not RGB8 PPM')
  const width = Number(match[1]),
    height = Number(match[2]),
    pixels = bytes.subarray(match[0].length)
  if (pixels.length !== width * height * 3) throw new Error('PPM extent mismatch')
  return { width, height, pixels }
}
const score = (original: string, rendered: string): number => {
  const result = Number.parseFloat(run(metric, [original, rendered]))
  if (!Number.isFinite(result)) throw new Error('Nonfinite metric')
  return result
}
const controls = []
for (const entry of ceiling.results.filter((point) => point.ssimulacra2 < 90)) {
  const selection = corpus.cases.find((row) => row.id === entry.id && row.split === entry.split)
  if (!selection || selection.sourceSha256 !== entry.sourceSha256)
    throw new Error(`Frozen source selection mismatch ${entry.id}`)
  const originalPath = `.tmp/jpegxl-m7/sources/${entry.id}.${selection.format}`
  if (hash(await readFile(originalPath)) !== selection.sourceSha256)
    throw new Error(`Original source hash mismatch ${entry.id}`)
  const originalMetadata = await sharp(originalPath).metadata()
  if (originalMetadata.width !== selection.width || originalMetadata.height !== selection.height)
    throw new Error(`Original source geometry mismatch ${entry.id}`)
  const source = ppm(await readFile(entry.inputPath))
  const decoded = ppm(await readFile(entry.nativeDecodedPath))
  const stream = await readFile(entry.artifactPath)
  if (
    source.width !== decoded.width ||
    source.height !== decoded.height ||
    hash(source.pixels) !== entry.inputPixelsSha256 ||
    hash(decoded.pixels) !== entry.decodedSha256 ||
    hash(stream) !== entry.encodedSha256
  )
    throw new Error(`Frozen control identity mismatch ${entry.id}`)
  const selfScore = score(entry.inputPath, entry.inputPath)
  const lossyRgb8Score = score(entry.inputPath, entry.nativeDecodedPath)
  if (selfScore !== 100 || Math.abs(lossyRgb8Score - entry.ssimulacra2) > 0.00001)
    throw new Error(`Frozen RGB8 score changed ${entry.id}`)
  controls.push({
    split: entry.split,
    id: entry.id,
    inputPixelsSha256: entry.inputPixelsSha256,
    encodedSha256: entry.encodedSha256,
    decodedSha256: entry.decodedSha256,
    width: source.width,
    height: source.height,
    channels: 3,
    bitDepth: 8,
    originalSourcePath: originalPath,
    originalSourceSha256: selection.sourceSha256,
    originalWidth: originalMetadata.width,
    originalHeight: originalMetadata.height,
    originalColorSpace: originalMetadata.space,
    originalHasEmbeddedProfile: originalMetadata.hasProfile,
    originalStoredOrientation: originalMetadata.orientation ?? null,
    sourceRendering: 'normalized RGB8 PPM from approved sRGB and stored-orientation preprocessing',
    selfScore,
    lossyRgb8Score,
  })
}
if (controls.length !== 10) throw new Error('Expected ten RGB8 below-90 controls')
const representative = ceiling.results.find(
  (entry) => entry.id === 'im26-6834' && entry.split === 'development',
)
if (!representative) throw new Error('Missing representative source')
const lossless = `${directory}/im26-6834-lossless.jxl`
const decoded8 = `${directory}/im26-6834-lossless.ppm`
const decodedRust = `${directory}/im26-6834-lossless-rust.ppm`
const decodedPng8 = `${directory}/im26-6834-lossless8.png`
const decodedPng16 = `${directory}/im26-6834-lossless16.png`
const lossyPng16 = `${directory}/im26-6834-lossy16.png`
run(`${native}/cjxl`, [
  representative.inputPath,
  lossless,
  '-d',
  '0',
  '-e',
  '7',
  '--num_threads=1',
  '--container=0',
])
run(`${native}/djxl`, [lossless, decoded8, '--num_threads=1', '--bits_per_sample=8'])
run(rust, [lossless, decodedRust, '--num-threads', '1', '--data-type', 'u8'])
run(`${native}/djxl`, [lossless, decodedPng8, '--num_threads=1', '--bits_per_sample=8'])
run(`${native}/djxl`, [lossless, decodedPng16, '--num_threads=1', '--bits_per_sample=16'])
run(`${native}/djxl`, [
  representative.artifactPath,
  lossyPng16,
  '--num_threads=1',
  '--bits_per_sample=16',
])
const inputPixels = ppm(await readFile(representative.inputPath)).pixels
const nativePixels = ppm(await readFile(decoded8)).pixels
const rustPixels = ppm(await readFile(decodedRust)).pixels
if (hash(inputPixels) !== hash(nativePixels) || hash(inputPixels) !== hash(rustPixels))
  throw new Error('Pixel-lossless independent control changed RGB8 samples')
const png16Bytes = await readFile(decodedPng16)
if (png16Bytes[24] !== 16 || png16Bytes[25] !== 2)
  throw new Error('Unexpected PNG16 depth or color type')
const raw16 = await sharp(decodedPng16).raw({ depth: 'ushort' }).toBuffer()
const values = new Uint16Array(raw16.buffer, raw16.byteOffset, raw16.byteLength / 2)
let maximumStoredSample = 0
for (const value of values) maximumStoredSample = Math.max(maximumStoredSample, value)
const precisionControl = {
  id: representative.id,
  losslessEncodedSha256: hash(await readFile(lossless)),
  losslessNativeDecodedSha256: hash(nativePixels),
  losslessRustDecodedSha256: hash(rustPixels),
  inputPixelsSha256: hash(inputPixels),
  sourceSelfScore: score(representative.inputPath, representative.inputPath),
  losslessPpm8Score: score(representative.inputPath, decoded8),
  losslessPng8Score: score(representative.inputPath, decodedPng8),
  losslessPng16Score: score(representative.inputPath, decodedPng16),
  lossyPpm8Score: score(representative.inputPath, representative.nativeDecodedPath),
  lossyPng16Score: score(representative.inputPath, lossyPng16),
  png16DeclaredBitDepth: png16Bytes[24],
  png16MaximumStoredSample: maximumStoredSample,
  png16ControlConclusion:
    'The 16-bit PNG route does not score the pixel-identical lossless control as 100. It is not a valid replacement for the frozen RGB8 comparison.',
}
const tools = await Promise.all(
  [`${native}/cjxl`, `${native}/djxl`, rust, metric].map(async (path) => ({
    path,
    sha256: hash(await readFile(path)),
  })),
)
const report = {
  schemaVersion: 1,
  inputReportPath: 'benchmark/jpegxl/production-program/m7-prompt10-native-ceiling.json',
  inputReportSha256: hash(
    await readFile('benchmark/jpegxl/production-program/m7-prompt10-native-ceiling.json'),
  ),
  policy:
    'Original RGB8 PPM protocol retained. PNG output precision is only a diagnostic; an alternative protocol would require new versioning and equal application to both encoders.',
  tools,
  sharpVersion: sharp.versions,
  controls,
  precisionControl,
  conclusion:
    'Ten pinned native effort-7 distance-0.05 streams remain below SSIMULACRA2 90 in the original RGB8 pipeline. The finding is specific to the tested settings and rendering pipeline, not a JPEG XL format limitation.',
}
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify({ controls: controls.length, representative: precisionControl }))
