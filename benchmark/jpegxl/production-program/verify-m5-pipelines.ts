import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { runJpegXlPipelines } from '../../../browser-tests/jpegxl-pipeline-harness.ts'
import { jpegCodec } from '../../../src/codecs/jpeg.ts'
import { jpegxlCodec } from '../../../src/codecs/jpegxl.ts'
import { pngCodec } from '../../../src/codecs/png.ts'
import { createImageLibrary } from '../../../src/index.ts'

const argument = (key: string): string | undefined => {
  const index = process.argv.indexOf(key)
  return index < 0 ? undefined : process.argv[index + 1]
}
const work = '.tmp/jpegxl-m5'
const hash = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')
const Image = createImageLibrary([jpegxlCodec, pngCodec, jpegCodec])
if (process.argv.includes('--worker')) {
  const input = argument('--input'),
    output = argument('--output')
  if (!input || !output) throw new Error('Missing worker input/output')
  const bytes = new Uint8Array(await readFile(input))
  const run = async () => {
    const started = performance.now()
    // Nearest preserves exact source sample positions; coefficient reduction would change this filter.
    const image = (await Image.open(bytes))
      .autoOrient()
      .resize({ width: 64, height: 48, fit: 'fill', kernel: 'nearest' })
      .png()
    const data = await image.toBuffer()
    return { data, milliseconds: performance.now() - started }
  }
  if (process.argv.includes('--warm')) await run()
  for (let i = 0; i < 3; i += 1) {
    globalThis.gc?.()
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  const baseline = process.memoryUsage()
  const result = await run()
  const memory = process.memoryUsage()
  await writeFile(output, result.data)
  console.log(
    JSON.stringify({
      milliseconds: result.milliseconds,
      baseline,
      memory,
      absolutePeakRss: process.resourceUsage().maxRSS * 1024,
      outputBytes: result.data.length,
      outputHash: hash(result.data),
    }),
  )
} else {
  await mkdir(work, { recursive: true })
  const workflows = await runJpegXlPipelines(
    async (name) => new Uint8Array(await readFile(`tests/fixtures/jpegxl/m4-color/${name}`)),
  )
  const tools = '.tmp/jpegxl-oracles/libjxl-v0.12.0/source/build-pinned/tools'
  const inputs = process.argv.includes('--large')
    ? [
        '.tmp/jpegxl-m3-common-static/coco-val2017-000000001000-libjxl-0.jxl',
        '.tmp/jpegxl-m3-common-static/coco-val2017-000000001000-libjxl-1.jxl',
      ]
    : [
        'benchmark/fixtures/jpegxl/generated-vardct-v0.12.0/rgb8-distance1-multi-group-progressive.jxl',
      ]
  inputs.push('benchmark/fixtures/jpegxl/jpeg-reconstruction-v0.12.0/baseline-yuv420.jxl')
  const measurements: unknown[] = []
  for (const [index, input] of inputs.entries()) {
    const referencePath = `${work}/reference-${index}.png`
    const oracle = spawnSync(
      `${tools}/djxl`,
      [input, referencePath, '--bits_per_sample=8', '--num_threads=1', '--quiet'],
      { encoding: 'utf8' },
    )
    if (oracle.status !== 0) throw new Error(oracle.stderr)
    const reference = await sharp(referencePath)
      .rotate()
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    for (const mode of ['cold', 'warm']) {
      const output = `${work}/output-${index}-${mode}.png`
      const child = spawnSync(
        process.execPath,
        [
          '--expose-gc',
          fileURLToPath(import.meta.url),
          '--worker',
          '--input',
          input,
          '--output',
          output,
          ...(mode === 'warm' ? ['--warm'] : []),
        ],
        { encoding: 'utf8' },
      )
      if (child.status !== 0) throw new Error(child.stderr)
      const measurement: unknown = JSON.parse(child.stdout)
      const actual = await sharp(output).removeAlpha().raw().toBuffer({ resolveWithObject: true })
      if (actual.info.width !== 64 || actual.info.height !== 48)
        throw new Error('Incorrect output dimensions')
      let maximumError = 0,
        squaredError = 0
      for (let y = 0; y < 48; y += 1)
        for (let x = 0; x < 64; x += 1) {
          const sx = Math.floor(((x + 0.5) * reference.info.width) / 64)
          const sy = Math.floor(((y + 0.5) * reference.info.height) / 48)
          for (let c = 0; c < 3; c += 1) {
            const error = Math.abs(
              (actual.data[(y * 64 + x) * 3 + c] ?? 0) -
                (reference.data[(sy * reference.info.width + sx) * 3 + c] ?? 0),
            )
            maximumError = Math.max(maximumError, error)
            squaredError += error * error
          }
        }
      const rmse = Math.sqrt(squaredError / (64 * 48 * 3))
      if (maximumError > 1 || rmse > 0.55)
        throw new Error(`${input} ${mode}: incorrect output (max ${maximumError}, RMSE ${rmse})`)
      measurements.push({
        input,
        sha256: hash(await readFile(input)),
        width: reference.info.width,
        height: reference.info.height,
        mode,
        maximumError,
        rmse,
        measurement,
      })
      console.log(`${input} ${mode}: oracle passed`)
    }
  }
  const output =
    argument('--output') ??
    `benchmark/jpegxl/production-program/m5-${process.argv.includes('--large') ? 'large-' : ''}pipelines.json`
  await writeFile(
    output,
    `${JSON.stringify({ schemaVersion: 1, methodology: '105 complete workflows across five encoders and three fits. Separate isolated cold and warm nearest-resize-to-PNG processes; djxl source pixels and libvips output decode. Warmup is followed by three GC cycles. RSS includes process/runtime; decoder VarDCT output is a full-frame fallback. Threshold max 1 and RMSE 0.55 is inherited from M3.', workflows, measurements, passed: true }, null, 2)}\n`,
  )
}
