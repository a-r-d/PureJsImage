import { createHash } from 'node:crypto'
import { open, readFile, rm } from 'node:fs/promises'
import { setImmediate } from 'node:timers/promises'
import { jpegxlCodec } from 'purejsimage/codecs/jpegxl'

const moduleReadyMilliseconds = performance.now()
const inputPath = process.argv[2],
  outputPath = process.argv[3]
const effort = Number(process.argv[4] ?? 1)
const temperature = process.argv[5] ?? 'cold'
if (
  !inputPath ||
  !outputPath ||
  (effort !== 1 && effort !== 3) ||
  (temperature !== 'cold' && temperature !== 'warm') ||
  !globalThis.gc
)
  throw new Error(
    'Usage: node --expose-gc measure-m7-forward-runtime.ts input.ppm output.jxl 1|3 cold|warm',
  )
const collect = async (): Promise<void> => {
  for (let iteration = 0; iteration < 3; iteration++) {
    await setImmediate()
    globalThis.gc?.()
  }
}
const once = async (path: string) => {
  const start = performance.now()
  const source = await readFile(inputPath)
  const header = /^P6\n(\d+) (\d+)\n255\n/u.exec(source.subarray(0, 100).toString('ascii'))
  if (!header) throw new Error('Expected canonical RGB8 PPM')
  const width = Number(header[1]),
    height = Number(header[2])
  const pixels = source.subarray(header[0].length)
  if (!Number.isSafeInteger(width * height * 3) || pixels.length !== width * height * 3)
    throw new Error('Input extent mismatch')
  const inputSha256 = createHash('sha256').update(pixels).digest('hex')
  const file = await open(path, 'w')
  const openMilliseconds = performance.now() - start
  let outputBytes = 0,
    firstOutputMilliseconds: number | null = null
  const digest = createHash('sha256')
  const encodeStart = performance.now()
  try {
    const encoder = await jpegxlCodec.createEncoder?.(
      {
        async write(bytes) {
          if (firstOutputMilliseconds === null)
            firstOutputMilliseconds = performance.now() - encodeStart
          digest.update(bytes)
          let offset = 0
          while (offset < bytes.length) {
            const result = await file.write(bytes, offset, bytes.length - offset)
            if (result.bytesWritten === 0) throw new Error('Output write made no progress')
            offset += result.bytesWritten
          }
          outputBytes += bytes.length
        },
        async close() {},
        async abort() {},
      },
      {
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
        options: { mode: 'lossy', effort, distance: 1, maxWorkingBytes: 256 * 1024 * 1024 },
      },
    )
    if (!encoder) throw new Error('Missing public JPEG XL encoder; build the package first')
    await encoder.write({
      x: 0,
      y: 0,
      width,
      height,
      format: 'rgb8',
      stride: width * 3,
      data: pixels,
    })
    const stagedMilliseconds = performance.now() - encodeStart
    const finishStart = performance.now()
    await encoder.finish()
    const finishAndOutputMilliseconds = performance.now() - finishStart
    await file.close()
    const totalMilliseconds = performance.now() - start
    if (
      !('managedPeakBytes' in encoder) ||
      typeof encoder.managedPeakBytes !== 'number' ||
      !('managedLiveBytes' in encoder) ||
      encoder.managedLiveBytes !== 0
    )
      throw new Error('Encoder allocation accounting did not close')
    return {
      width,
      height,
      inputSha256,
      outputSha256: digest.digest('hex'),
      bytes: outputBytes,
      openMilliseconds,
      stagedMilliseconds,
      firstOutputMilliseconds,
      finishAndOutputMilliseconds,
      totalMilliseconds,
      managedPeakBytes: encoder.managedPeakBytes,
      managedLiveBytes: encoder.managedLiveBytes,
      finalMemory: process.memoryUsage(),
      peakRssBytes: process.resourceUsage().maxRSS * 1024,
    }
  } finally {
    await file.close()
  }
}
await collect()
const beforeWarmup = process.memoryUsage()
let warmup: Awaited<ReturnType<typeof once>> | null = null
if (temperature === 'warm') {
  const path = `${outputPath}.warmup`
  warmup = await once(path)
  await rm(path)
  await collect()
}
const baselineMemory = process.memoryUsage()
if (temperature === 'warm' && baselineMemory.arrayBuffers > beforeWarmup.arrayBuffers + 1024 * 1024)
  throw new Error(
    `Warmup retained source/output arrays: before=${beforeWarmup.arrayBuffers}, after=${baselineMemory.arrayBuffers}`,
  )
const measured = await once(outputPath)
if (
  warmup &&
  (warmup.inputSha256 !== measured.inputSha256 || warmup.outputSha256 !== measured.outputSha256)
)
  throw new Error('Cold/warm output changed')
console.log(
  JSON.stringify({
    runtime: process.version,
    effort,
    temperature,
    moduleReadyMilliseconds,
    beforeWarmup,
    baselineMemory,
    warmup,
    measured,
    scope:
      'Public forward encoder, original RGB8 PPM open, input staging, cooperative encode and file sink output. No complete output concatenation. Finish includes encoding and file writes; isolated core is measured separately by measure-m7-forward.ts. Process startup is measured by the parent. File I/O does not include fsync. Cold/warm refer to process codec state, not OS page-cache eviction.',
    rssScope:
      'Absolute process peak, including warmup for warm processes; post-GC baseline is reported separately and warmup source/output array reclamation is checked.',
    correctness: 'Hash identity is checked across warmup; independent decoding remains required.',
  }),
)
