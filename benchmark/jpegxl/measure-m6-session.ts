/** Isolated cold/warm M6 measurements. No oracle pixel buffers are loaded in this process. */
import { reportRevision } from './report-provenance.ts'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { openJpegXlSession } from '../../src/jpegxl.ts'
import { jpegxlCodec } from '../../src/codecs/jpegxl.ts'
import { resolveLimits } from '../../src/limits.ts'
import { type ImageSource } from '../../src/source.ts'

const path = process.argv[2],
  mode = process.argv[3],
  temperature = process.argv[4]
if (
  !path ||
  !['preview', 'viewport', 'final'].includes(mode ?? '') ||
  !['cold', 'warm'].includes(temperature ?? '')
)
  throw new Error(
    'Usage: node --expose-gc measure-m6-session.ts INPUT preview|viewport|final cold|warm',
  )
const revision = reportRevision()
const input = new Uint8Array(await readFile(path))
const limits = resolveLimits({ maxDecodedBytes: 2_147_483_648, maxPixels: 100_000_000 })
const run = async () => {
  let requestedBytes = 0,
    reads = 0,
    outputBytes = 0,
    firstPixelMs: number | undefined
  const source: ImageSource = {
    size: input.length,
    async read(offset, length) {
      reads++
      requestedBytes += length
      return input.subarray(offset, offset + length)
    },
  }
  const hash = createHash('sha256')
  const started = performance.now()
  let peak: number | null = null
  if (mode === 'final') {
    const decoder = await jpegxlCodec.createDecoder?.(source, limits)
    if (!decoder) throw new Error('Missing JPEG XL decoder')
    for await (const block of decoder.decode({})) {
      firstPixelMs ??= performance.now() - started
      hash.update(block.data)
      outputBytes += block.data.length
      block.release?.()
    }
    if ('managedPeakBytes' in decoder && typeof decoder.managedPeakBytes === 'number')
      peak = decoder.managedPeakBytes
  } else {
    const session = await openJpegXlSession(source, { limits })
    try {
      const request =
        mode === 'preview'
          ? { until: 'dc' as const, scaleDenominator: 8 as const }
          : {
              region: {
                x: Math.floor(session.width / 3),
                y: Math.floor(session.height / 3),
                width: Math.floor(session.width / 4),
                height: Math.floor(session.height / 4),
              },
            }
      for await (const event of session.decode(request))
        if (event.type === 'block') {
          firstPixelMs ??= performance.now() - started
          hash.update(event.block.data)
          outputBytes += event.block.data.length
          event.block.release?.()
        }
      peak = session.managedPeakBytes
    } finally {
      await session.close()
    }
  }
  return {
    requestedBytes,
    reads,
    outputBytes,
    sha256: hash.digest('hex'),
    elapsedMs: performance.now() - started,
    firstPixelMs,
    managedPeakBytes: peak,
  }
}
if (temperature === 'warm') await run()
if (!globalThis.gc) throw new Error('Run isolated measurement with --expose-gc')
globalThis.gc()
await new Promise((resolve) => setTimeout(resolve, 0))
globalThis.gc()
const baselineMemory = process.memoryUsage()
try {
  const result = await run()
  console.log(
    JSON.stringify({
      revision,
      input: path,
      inputBytes: input.length,
      mode,
      temperature,
      baselineMemory,
      ...result,
      memoryAfter: process.memoryUsage(),
      absolutePeakRssBytes: process.resourceUsage().maxRSS * 1024,
    }),
  )
} catch (error) {
  console.log(
    JSON.stringify({
      revision,
      input: path,
      mode,
      temperature,
      error: String(error),
      baselineMemory,
      absolutePeakRssBytes: process.resourceUsage().maxRSS * 1024,
    }),
  )
  process.exitCode = 1
}
