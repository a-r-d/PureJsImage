/** Independent first-pass checks. Native djxl renders the selected pass at full dimensions. */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createJpegXlModularEncoder } from '../../src/codecs/jpegxl-modular-encode.ts'
import { openJpegXlSession } from '../../src/jpegxl.ts'
import { Uint8ArraySink } from '../../src/sink.ts'

if (process.argv.includes('--effort7') && process.argv.includes('--effort1'))
  throw new Error('Conflicting effort flags')
const effort = process.argv.includes('--effort7') ? 7 : process.argv.includes('--effort1') ? 1 : 3
const distance = process.argv.includes('--distance3') ? 3 : 1
const directory = `.tmp/jpegxl-m7/forward-stage-e${effort}${distance === 3 ? '-d3' : ''}-oracle`
await mkdir(directory, { recursive: true })
const results: object[] = []
for (const [width, height] of [
  [17, 13],
  [257, 33],
  [513, 257],
  [2051, 9],
] as const) {
  const pixels = Uint8Array.from(
    { length: width * height * 3 },
    (_, index) => (index * 13 + Math.floor(index / (width * 3)) * 7) & 255,
  )
  const sink = new Uint8ArraySink()
  const encoder = await createJpegXlModularEncoder(sink, {
    width,
    height,
    pixelFormat: 'rgb8',
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
    options: { mode: 'lossy', effort, distance, progressive: true },
  })
  await encoder.write({
    x: 0,
    y: 0,
    width,
    height,
    stride: width * 3,
    format: 'rgb8',
    data: pixels,
  })
  await encoder.finish()
  const encoded = sink.toUint8Array(),
    path = `${directory}/${width}x${height}`
  await writeFile(`${path}.jxl`, encoded)
  const native = spawnSync(
    '.tmp/jpegxl-oracles/libjxl-v0.12.0/source/build-pinned/tools/djxl',
    [`${path}.jxl`, `${path}.ppm`, '--downsampling=2', '--num_threads=1'],
    { encoding: 'utf8' },
  )
  if (native.status !== 0) throw new Error(native.stderr)
  const output = await readFile(`${path}.ppm`)
  const header = /^P6\s+(\d+)\s+(\d+)\s+255\s/u.exec(output.subarray(0, 100).toString('ascii'))
  if (
    !header ||
    Number(header[1]) !== width ||
    Number(header[2]) !== height ||
    output.length !== header[0].length + width * height * 3
  )
    throw new Error('Native stage raster extent mismatch')
  const expected = output.subarray(header[0].length)
  for (const scale of [1, 2] as const) {
    const session = await openJpegXlSession(encoded)
    let maximum = 0,
      squared = 0,
      samples = 0,
      completed = 0
    try {
      for await (const event of session.decode({ until: 1, scaleDenominator: scale })) {
        if (event.type === 'stage-complete') {
          if (event.stage.completedPasses !== 1) throw new Error('Unexpected progressive stage')
          completed++
        }
        if (event.type !== 'block') continue
        const block = event.block
        if (block.format !== 'rgb8') throw new Error('Unexpected progressive pixel format')
        for (let y = 0; y < block.height; y++)
          for (let x = 0; x < block.width; x++) {
            const sourceY = Math.min(height - 1, (block.y + y) * scale + Math.floor(scale / 2))
            const sourceX = Math.min(width - 1, (block.x + x) * scale + Math.floor(scale / 2))
            for (let channel = 0; channel < 3; channel++) {
              const error = Math.abs(
                (expected[(sourceY * width + sourceX) * 3 + channel] ?? 0) -
                  (block.data[y * block.stride + x * 3 + channel] ?? 0),
              )
              maximum = Math.max(maximum, error)
              squared += error * error
              samples++
            }
          }
        block.release?.()
      }
      const rmse = Math.sqrt(squared / samples)
      if (
        completed !== 1 ||
        samples !== Math.ceil(width / scale) * Math.ceil(height / scale) * 3 ||
        maximum > 2 ||
        rmse > 0.55
      )
        throw new Error(`Independent stage mismatch: ${maximum}, ${rmse}`)
      results.push({
        width,
        height,
        scale,
        maximum,
        rmse,
        samples,
        encodedSha256: createHash('sha256').update(encoded).digest('hex'),
        oracleSha256: createHash('sha256').update(expected).digest('hex'),
        sourceSectionBytes: session.sourceSectionBytes,
        encodedBytes: encoded.length,
      })
    } finally {
      await session.close()
    }
  }
}
await writeFile(
  `${directory}/report.json`,
  `${JSON.stringify({ scope: 'Generated SDR RGB first pass, full and center-sampled half resolution; native djxl downsampling=2. Final and HDR checks are separate.', results }, null, 2)}\n`,
)
console.log(`${results.length} independent first-pass comparisons passed`)
