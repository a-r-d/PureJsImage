import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

const input = process.argv[2],
  directory = process.argv[3]
if (!input || !directory)
  throw new Error('Usage: measure-m7-native-curve.ts input.ppm output-directory')
const tools = '.tmp/jpegxl-oracles/libjxl-v0.12.0/source/build-pinned/tools'
const metrics = '.tmp/jpegxl-oracles/libjxl-v0.12.0/source/build-m7-metrics/tools'
const hash = async (path: string) =>
  createHash('sha256')
    .update(await readFile(path))
    .digest('hex')
const inputSha256 = await hash(input)
await mkdir(directory, { recursive: true })
const run = (tool: string, args: string[]): string => {
  const result = spawnSync(tool, args, { encoding: 'utf8', timeout: 300_000, maxBuffer: 1_000_000 })
  if (result.status !== 0) throw new Error(`${tool}: ${result.stderr}; ${result.error ?? ''}`)
  return result.stdout
}
const results: object[] = []
let failures = 0
for (const distance of [0.25, 0.5, 1, 2, 3, 5]) {
  try {
    const encoded = `${directory}/d${distance}.jxl`,
      decoded = `${directory}/d${distance}.ppm`
    run(`${tools}/cjxl`, [input, encoded, '-d', String(distance), '-e', '7', '--num_threads=1'])
    run(`${tools}/djxl`, [encoded, decoded, '--num_threads=1', '--bits_per_sample=8'])
    const ssimulacra2Text = run(`${metrics}/ssimulacra2`, [input, decoded])
    const butteraugliText = run(`${metrics}/butteraugli_main`, [input, decoded])
    const ssimulacra2 = Number.parseFloat(ssimulacra2Text),
      butteraugli = Number.parseFloat(butteraugliText)
    if (!Number.isFinite(ssimulacra2) || !Number.isFinite(butteraugli))
      throw new Error('Non-numeric quality metric')
    const bytes = await readFile(encoded)
    results.push({
      distance,
      effort: 7,
      status: 'measured',
      bytes: bytes.length,
      encodedSha256: createHash('sha256').update(bytes).digest('hex'),
      ssimulacra2,
      butteraugli,
      rawMetrics: { ssimulacra2Text, butteraugliText },
    })
    console.log(distance, bytes.length, ssimulacra2, butteraugli)
  } catch (error) {
    failures++
    results.push({ distance, effort: 7, status: 'failed', error: String(error) })
    console.error(distance, String(error))
  }
  await writeFile(
    `${directory}/report.json`,
    JSON.stringify(
      {
        schemaVersion: 1,
        inputSha256,
        failures,
        results,
        scope: 'Size/quality measurements; no timing claims.',
      },
      null,
      2,
    ) + '\n',
  )
}
await writeFile(
  `${directory}/tools.json`,
  JSON.stringify(
    {
      cjxl: await hash(`${tools}/cjxl`),
      djxl: await hash(`${tools}/djxl`),
      ssimulacra2: await hash(`${metrics}/ssimulacra2`),
      butteraugli: await hash(`${metrics}/butteraugli_main`),
    },
    null,
    2,
  ) + '\n',
)
if (failures) process.exitCode = 1
