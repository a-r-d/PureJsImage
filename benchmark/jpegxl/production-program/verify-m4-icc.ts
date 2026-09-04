import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { jpegxlCodec } from '../../../src/codecs/jpegxl.ts'
import { defaultImageLimits } from '../../../src/limits.ts'
import { MemorySource } from '../../../src/source.ts'

const validator =
  process.argv[2] ??
  '/tmp/purejsimage-iccdev-v2.3.2.3/out/purejsimage/Tools/IccDumpProfile/iccDumpProfile'
const root = '.tmp/jpegxl-conformance/testcases'
const work = '.tmp/jpegxl-m4-icc'
await mkdir(work, { recursive: true })
const results = []
for (const id of ['bench_oriented_brg', 'cafe', 'grayscale', 'grayscale_jpeg']) {
  const input = new Uint8Array(await readFile(`${root}/${id}/input.jxl`))
  const metadata = await jpegxlCodec.preservedMetadata?.(
    new MemorySource(input),
    defaultImageLimits,
    { exif: false, icc: true },
  )
  if (!metadata?.icc) throw new Error(`${id} profile is missing`)
  const path = `${work}/${id}.icc`
  await writeFile(path, metadata.icc)
  const oraclePath = `${work}/${id}-oracle.icc`
  const decode = spawnSync(
    '.tmp/jpegxl-oracles/libjxl-v0.12.0/source/build-pinned/tools/djxl',
    [
      `${root}/${id}/input.jxl`,
      `${work}/${id}.png`,
      `--orig_icc_out=${oraclePath}`,
      '--num_threads=1',
    ],
    { encoding: 'utf8' },
  )
  if (decode.status !== 0) throw new Error(decode.stderr)
  const oracle = await readFile(oraclePath)
  if (!oracle.equals(metadata.icc)) throw new Error(`${id} reconstructed profile differs from djxl`)
  const validation = spawnSync(validator, ['-v', path], { encoding: 'utf8' })
  if (validation.error || validation.signal) throw new Error(`ICC validator failed for ${id}`)
  const report = validation.stdout.split('Validation Report')[1]?.trim()
  if (!report) throw new Error('ICC validation report missing')
  const findings = report
    .split('\n')
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.startsWith('Warning') ||
        line.startsWith('NonCompliant') ||
        line.startsWith('Critical'),
    )
  const expectedWarning =
    id === 'cafe'
      ? 'Bad Profile ID'
      : id === 'bench_oriented_brg'
        ? 'Profile ID'
        : 'OutputTag exclusion'
  if (
    findings.some((line) => line.startsWith('Critical')) ||
    (findings.length > 0 && !findings.every((line) => line.includes(expectedWarning)))
  )
    throw new Error(`${id}: unexpected profile finding: ${findings.join('; ')}`)
  results.push({
    id,
    profileBytes: metadata.icc.length,
    sha256: createHash('sha256').update(metadata.icc).digest('hex'),
    exactDjxlProfile: true,
    validatorExitCode: validation.status,
    findings,
    policy:
      id === 'cafe'
        ? 'Source profile has an invalid checksum ID; bytes are preserved exactly. Structural validity and supported color transforms are checked separately.'
        : 'Source profile warnings are retained in the report; no profile bytes enter evidence.',
  })
}
const lcms = spawnSync(
  '/usr/bin/transicc',
  ['-v1', '-n', `-i${work}/bench_oriented_brg.icc`, '-o*sRGB'],
  { input: '0 0 0\n255 0 0\n0 255 0\n0 0 255\n64 128 192\n', encoding: 'utf8' },
)
if (lcms.status !== 0) throw new Error(lcms.stderr)
const samples = lcms.stdout.trim().split(/\s+/).map(Number)
const expected = [0, 0, 0, 0, 0, 255, 255, 0, 0, 0, 255, 0, 128, 192, 64]
if (
  samples.length !== 15 ||
  samples.some(
    (value, index) =>
      !Number.isFinite(value) ||
      Math.abs(Math.round(Math.max(0, Math.min(255, value))) - (expected[index] ?? 0)) > 1,
  )
)
  throw new Error('Little CMS probe changed')
await writeFile(
  'benchmark/jpegxl/production-program/m4-icc-validation.json',
  `${JSON.stringify({ schemaVersion: 1, validator: 'ICC iccDEV v2.3.2.3, revision 9f1707e', littleCms: '2.16', littleCmsSamples: samples, littleCmsMaximumRoundedSampleError: 1, results }, null, 2)}\n`,
)
console.log(
  'Four profiles match djxl exactly; ICC validator findings classified and Little CMS conversion verified',
)
