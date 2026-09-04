import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'
import { decodeJpegCoefficientImage } from '../../../src/codecs/jpeg-baseline.ts'
import { decodeJpegXlJpegPixelImage } from '../../../src/codecs/jpegxl-jpeg-reconstruct-source.ts'
import { decodeJpegXlJpegPixels } from '../../../src/codecs/jpegxl-jpeg-pixels.ts'

// Compare the replaced component renderer on the same corrected coefficient input. The old
// renderer is still available for ordinary JPEG; failed JXL pixels are never a valid speed score.
if (process.argv[2] === '--worker') {
  const id = process.argv[3]
  const renderer = process.argv[4]
  const mode = process.argv[5]
  if (
    (id !== 'bench_oriented_brg' && id !== 'cafe') ||
    (renderer !== 'before' && renderer !== 'after')
  )
    throw new Error('Invalid worker case')
  const input = new Uint8Array(await readFile(`.tmp/jpegxl-conformance/testcases/${id}/input.jxl`))
  const reference = PNG.sync.read(await readFile(`.tmp/jpegxl-m4-color/conformance-${id}.png`))
  const run = async () => {
    const started = performance.now()
    const decoded = await decodeJpegXlJpegPixelImage(input)
    const region = { x: 0, y: 0, width: decoded.image.width, height: decoded.image.height }
    const blocks =
      renderer === 'before'
        ? decodeJpegCoefficientImage(decoded.image, region, 1)
        : decodeJpegXlJpegPixels(decoded.image, region, decoded.colorMaps)
    let maximumError = 0,
      squared = 0,
      samples = 0,
      rows = 0
    const digest = createHash('sha256')
    const peak = { ...process.memoryUsage() }
    for await (const block of blocks) {
      try {
        digest.update(block.data)
        rows += block.height
        for (let y = 0; y < block.height; y++)
          for (let x = 0; x < block.width; x++)
            for (let c = 0; c < 3; c++) {
              const sx = block.x + x,
                sy = block.y + y
              const destination =
                id === 'bench_oriented_brg'
                  ? (sx * reference.width + sy) * 4 + c
                  : (sy * reference.width + sx) * 4 + c
              const error = Math.abs(
                (block.data[y * block.stride + x * 3 + c] ?? 0) -
                  (reference.data[destination] ?? 0),
              )
              maximumError = Math.max(maximumError, error)
              squared += error * error
              samples++
            }
        const current = process.memoryUsage()
        for (const key of ['rss', 'heapUsed', 'external', 'arrayBuffers'] as const)
          peak[key] = Math.max(peak[key], current[key])
      } finally {
        block.release?.()
      }
    }
    const rmse = Math.sqrt(squared / samples)
    const correct = rows === decoded.image.height && maximumError <= 1 && rmse <= 0.55
    if (renderer === 'after' && !correct) throw new Error('New JPEG XL renderer failed its oracle')
    return {
      milliseconds: performance.now() - started,
      maximumError,
      rmse,
      correct,
      outputHash: digest.digest('hex'),
      peak,
    }
  }
  if (mode === 'warm') await run()
  if (!globalThis.gc) throw new Error('Worker needs --expose-gc')
  for (let i = 0; i < 3; i++) {
    globalThis.gc()
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  const baseline = process.memoryUsage()
  const result = await run()
  console.log(
    JSON.stringify({
      id,
      renderer,
      mode,
      inputHash: createHash('sha256').update(input).digest('hex'),
      baseline,
      ...result,
      absoluteProcessPeakRss: process.resourceUsage().maxRSS * 1024,
    }),
  )
} else {
  const results: unknown[] = []
  for (const id of ['bench_oriented_brg', 'cafe'])
    for (const renderer of ['before', 'after'])
      for (const mode of ['cold', 'warm']) {
        const result = spawnSync(
          process.execPath,
          ['--expose-gc', fileURLToPath(import.meta.url), '--worker', id, renderer, mode],
          { encoding: 'utf8' },
        )
        if (result.status !== 0) throw new Error(result.stderr)
        const value: unknown = JSON.parse(result.stdout)
        results.push(value)
      }
  await writeFile(
    'benchmark/jpegxl/production-program/m4-jpeg-render.json',
    `${JSON.stringify({ schemaVersion: 1, methodology: 'Isolated processes, one warmup for warm cases followed by three collections. Both renderers receive corrected identical coefficients. Timings include decode, row emission, and oracle comparison. Incorrect old JXL pixels are failed benchmark results, regardless of speed.', results }, null, 2)}\n`,
  )
  console.log('Eight JPEG-derived renderer comparisons completed; all new outputs pass the oracle')
}
