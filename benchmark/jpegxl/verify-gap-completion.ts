import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pixelStorage } from '../../src/pixel.ts'
import { verifyJpegXlSampleGaps } from '../../tests/helpers/jpegxl-gap-completion.ts'

const work = resolve('.tmp/jpegxl-gap-oracle')
await mkdir(work, { recursive: true })
const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null
const results: { id: string; inputSha256: string; expectedSha256: string; oracleSha256: string }[] =
  []
await verifyJpegXlSampleGaps(async (id, encoded, expected, decoder) => {
  const directory = `${work}/${id}`
  await mkdir(directory, { recursive: true })
  await writeFile(`${directory}/input.jxl`, encoded)
  execFileSync(
    'bun',
    [
      'benchmark/jpegxl/flush-progressive-oracle.ts',
      `${directory}/input.jxl`,
      directory,
      'native-planes-float32',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )
  const manifest: unknown = JSON.parse(await readFile(`${directory}/manifest.json`, 'utf8'))
  if (!record(manifest) || !Array.isArray(manifest.stages)) throw new Error('Missing oracle stages')
  const last: unknown = manifest.stages.at(-1)
  if (!record(last) || typeof last.file !== 'string' || typeof manifest.channels !== 'number')
    throw new Error('Invalid oracle stage')
  const raw = new Uint8Array(await readFile(`${directory}/${last.file}`))
  const reference = new DataView(raw.buffer),
    output = new DataView(expected.buffer)
  const storage = pixelStorage(decoder.pixelFormat)
  const expectedFloats = new Uint8Array(decoder.width * storage.channels * 4),
    floats = new DataView(expectedFloats.buffer)
  for (let pixel = 0; pixel < decoder.width; pixel++)
    for (let channel = 0; channel < storage.channels; channel++) {
      const value =
        storage.sampleType === 'floating-point'
          ? output.getFloat32((pixel * storage.channels + channel) * 4, false)
          : output.getUint32((pixel * storage.channels + channel) * 4, false) /
            (2 ** (decoder.execution?.sourceSampleBitDepths[0] ?? 31) - 1)
      floats.setFloat32((pixel * storage.channels + channel) * 4, value, false)
      const nativeChannel = manifest.channels === 2 ? (channel === 3 ? 1 : 0) : channel
      const actual = reference.getFloat32((pixel * manifest.channels + nativeChannel) * 4, false)
      if (Math.abs(actual - Math.fround(value)) > 0.00000012)
        throw new Error(
          `${id}: independent sample differs at ${pixel}/${channel}: ${actual}/${value}`,
        )
    }
  results.push({
    id,
    inputSha256: hash(encoded),
    expectedSha256: hash(expectedFloats),
    oracleSha256: hash(raw),
  })
})
await mkdir('benchmark/jpegxl/gap-completion', { recursive: true })
await writeFile(
  'benchmark/jpegxl/gap-completion/samples.json',
  `${JSON.stringify({ oracle: 'Pinned libjxl 0.12.0 C API FLOAT output in source color space with separate native extras', tolerance: 0.00000012, cases: results }, null, 2)}\n`,
)
console.log(`Verified ${results.length} mixed-alpha and wide-integer encodings against libjxl`)
