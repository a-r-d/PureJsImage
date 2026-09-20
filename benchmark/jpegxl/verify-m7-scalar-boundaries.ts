import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createJpegXlModularEncoder } from '../../src/codecs/jpegxl-modular-encode.ts'
import { Uint8ArraySink } from '../../src/sink.ts'

const runId = process.argv[2] ?? '052'
if (!/^[a-z0-9-]+$/u.test(runId)) throw new Error('Specify a valid unique run identifier')
const output = `.tmp/jpegxl-m7/scalar-boundaries-${runId}`
await mkdir(output)
const native = '.tmp/jpegxl-oracles/libjxl-v0.12.0/source/build-pinned/tools/djxl'
const rust = '.tmp/jpegxl-oracles/jxl-rs-07ab48f/target/release/jxl_cli'
const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const results: object[] = []
for (const [width = 0, height = 0] of [
  [1023, 17],
  [1024, 17],
  [1025, 17],
  [2051, 17],
  [1031, 1],
  [1, 1031],
]) {
  const pixels = new Uint8Array(width * height * 6)
  for (let position = 0; position < width * height; position++) {
    for (let channel = 0; channel < 3; channel++) {
      const index = (position * (channel * 4 + 3) + (position >>> 6) * (channel * 7 + 1)) % 251
      const value = index * index + channel * 53
      pixels[position * 6 + channel * 2] = value >>> 8
      pixels[position * 6 + channel * 2 + 1] = value
    }
  }
  const sink = new Uint8ArraySink()
  const encoder = await createJpegXlModularEncoder(sink, {
    width,
    height,
    pixelFormat: 'rgb16',
    colorSemantics: {
      family: 'rgb',
      primaries: 'srgb',
      transfer: { kind: 'srgb' },
      matrix: 'identity',
      range: 'full',
      alpha: 'none',
      provenance: 'assumed-default',
      renderingIntent: 'relative',
    },
    options: { effort: 7 },
  })
  await encoder.write({
    x: 0,
    y: 0,
    width,
    height,
    format: 'rgb16',
    stride: width * 6,
    data: pixels,
  })
  await encoder.finish()
  const encoded = sink.toUint8Array()
  const file = `${output}/${width}x${height}.jxl`
  await writeFile(file, encoded)
  const oracles: object[] = []
  for (const [name, tool] of [
    ['native', native],
    ['rust', rust],
  ] as const) {
    const decoded = `${output}/${width}x${height}-${name}.ppm`
    const result = spawnSync(
      tool,
      name === 'native'
        ? [file, decoded, '--num_threads=1', '--bits_per_sample=16']
        : [file, decoded, '--num-threads', '1', '--data-type', 'u16'],
      { encoding: 'utf8', timeout: 60_000, maxBuffer: 1_048_576 },
    )
    if (result.status !== 0) throw new Error(`${name}: ${result.stderr}`)
    const bytes = await readFile(decoded)
    const header = /^P6\s+(\d+)\s+(\d+)\s+65535\s/u.exec(bytes.subarray(0, 100).toString('ascii'))
    if (
      !header ||
      Number(header[1]) !== width ||
      Number(header[2]) !== height ||
      hash(bytes.subarray(header[0].length)) !== hash(pixels)
    )
      throw new Error(`${name}: sample or extent mismatch`)
    oracles.push({ name, exact: true })
  }
  results.push({
    width,
    height,
    encodedBytes: encoded.length,
    encodedSha256: hash(encoded),
    sampleSha256: hash(pixels),
    oracles,
    groupSearchEvidence: 'groupSearchEvidence' in encoder ? encoder.groupSearchEvidence : null,
  })
}
await writeFile(
  `${output}/report.json`,
  JSON.stringify(
    {
      policy:
        'Generated boundary and narrow-image conformance, separate from real-image compression qualification.',
      sources: await Promise.all(
        ['jpegxl-modular-encode.ts', 'jpegxl-decode.ts'].map(async (name) => ({
          path: `src/codecs/${name}`,
          sha256: hash(await readFile(new URL(`../../src/codecs/${name}`, import.meta.url))),
        })),
      ),
      oracles: await Promise.all(
        [native, rust].map(async (path) => ({ path, sha256: hash(await readFile(path)) })),
      ),
      results,
    },
    null,
    2,
  ) + '\n',
)
console.log(JSON.stringify({ cases: results.length, independentlyExact: true }))
