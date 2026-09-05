import { spawnSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import sharp from 'sharp'
import current from './m5-large-pipelines.json' with { type: 'json' }

const baseRoot = process.argv[2]
if (!baseRoot)
  throw new Error('Supply an archive of a57fbd5 with the M5 worker and dev node_modules available')
const results: unknown[] = []
for (const [index, entry] of current.measurements.entries()) {
  const output = `.tmp/jpegxl-m5/base-${index}.png`
  const worker = spawnSync(
    process.execPath,
    [
      '--expose-gc',
      `${baseRoot}/benchmark/jpegxl/production-program/verify-m5-pipelines.ts`,
      '--worker',
      '--input',
      entry.input,
      '--output',
      output,
      ...(entry.mode === 'warm' ? ['--warm'] : []),
    ],
    { encoding: 'utf8' },
  )
  if (worker.status !== 0) throw new Error(worker.stderr)
  const before: unknown = JSON.parse(worker.stdout)
  const first = await sharp(output).removeAlpha().raw().toBuffer()
  const second = await sharp(`.tmp/jpegxl-m5/output-${Math.floor(index / 2)}-${entry.mode}.png`)
    .removeAlpha()
    .raw()
    .toBuffer()
  let maximumDifference = 0
  if (first.length !== second.length) throw new Error('Baseline output dimensions differ')
  for (let i = 0; i < first.length; i += 1)
    maximumDifference = Math.max(maximumDifference, Math.abs((first[i] ?? 0) - (second[i] ?? 0)))
  // The pre-M5 JPEG-derived nearest path incorrectly selected reduced DCT. Keep it as a failed baseline.
  const knownNearestFailure = entry.width === 320 && maximumDifference > 1
  if (maximumDifference > 1 && !knownNearestFailure)
    throw new Error('Unexpected baseline pixel difference')
  results.push({
    input: entry.input,
    mode: entry.mode,
    sha256: entry.sha256,
    baselineCorrect: !knownNearestFailure,
    maximumDifference,
    before,
    after: entry.measurement,
  })
}
await writeFile(
  'benchmark/jpegxl/production-program/m5-before-after.json',
  `${JSON.stringify({ schemaVersion: 1, baseRevision: 'a57fbd548c1317af457636a2ddad4563e8bad330', methodology: 'Single isolated cold and warm executions per input. Both use the same worker and nearest resize to 64x48 PNG. Timings are snapshots, not an optimization claim. Invalid baseline JPEG-derived nearest pixels do not count as a speed advantage.', results }, null, 2)}\n`,
)
