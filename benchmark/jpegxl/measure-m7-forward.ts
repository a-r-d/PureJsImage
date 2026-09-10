import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { setImmediate } from 'node:timers/promises'
import { JpegXlEncoderMemory } from '../../src/codecs/jpegxl-encoder-memory.ts'
import { encodeJpegXlVarDct8Async } from '../../src/codecs/jpegxl-vardct-encode.ts'
import { Uint8ArraySink } from '../../src/sink.ts'

const inputPath = process.argv[2],
  outputPath = process.argv[3]
const distance = Number(process.argv[4] ?? 1)
const effort = Number(process.argv[5] ?? 3)
const progressive = process.argv[6] === 'progressive'
const warm = process.argv.includes('--warm')
if (effort !== 1 && effort !== 3 && effort !== 5 && effort !== 7) throw new Error('Invalid effort')
if (!inputPath || !outputPath || !globalThis.gc)
  throw new Error('Usage: node --expose-gc measure-m7-forward.ts input.ppm output.jxl distance')
const opened = performance.now()
const source = await readFile(inputPath)
const header = /^P6\n(\d+) (\d+)\n255\n/u.exec(source.subarray(0, 100).toString('ascii'))
if (!header) throw new Error('Expected canonical RGB8 PPM')
const width = Number(header[1]),
  height = Number(header[2])
const pixels = source.subarray(header[0].length)
if (!Number.isSafeInteger(width * height * 3) || pixels.length !== width * height * 3)
  throw new Error('Invalid input extent')
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const inputSha256 = hash(pixels)
const openMilliseconds = performance.now() - opened
globalThis.gc()
const beforeWarmup = process.memoryUsage()
const warmup = warm
  ? await (async () => {
      const memory = new JpegXlEncoderMemory(268_435_456)
      try {
        const parts = await encodeJpegXlVarDct8Async(
          pixels,
          width,
          height,
          distance,
          memory,
          () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
          3,
          effort,
          undefined,
          8,
          progressive,
        )
        const digest = createHash('sha256')
        for (const part of parts) digest.update(part)
        return { outputSha256: digest.digest('hex'), managedPeakBytes: memory.peakBytes }
      } finally {
        memory.close()
      }
    })()
  : null
if (warm) {
  for (let iteration = 0; iteration < 3; iteration++) {
    await setImmediate()
    globalThis.gc()
  }
}
const baselineMemory = process.memoryUsage()
if (warm && baselineMemory.arrayBuffers > beforeWarmup.arrayBuffers + 1024 * 1024)
  throw new Error('Core warmup retained source-sized arrays')
const memory = new JpegXlEncoderMemory(268_435_456)
const start = performance.now()
const parts = await encodeJpegXlVarDct8Async(
  pixels,
  width,
  height,
  distance,
  memory,
  () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
  3,
  effort,
  undefined,
  8,
  progressive,
)
const coreMilliseconds = performance.now() - start
const sink = new Uint8ArraySink()
for (const part of parts) await sink.write(part)
const encoded = sink.toUint8Array()
const encodeOutputMilliseconds = performance.now() - start
const managedPeakBytes = memory.peakBytes
memory.close()
const peakRssBytes = process.resourceUsage().maxRSS * 1024
const finalMemory = process.memoryUsage()
if (warmup && warmup.outputSha256 !== hash(encoded)) throw new Error('Core warmup output changed')
await writeFile(outputPath, encoded)
console.log(
  JSON.stringify({
    runtime: process.version,
    width,
    height,
    distance,
    effort,
    progressive,
    temperature: warm ? 'warm' : 'cold',
    beforeWarmup,
    warmup,
    inputSha256,
    outputSha256: hash(encoded),
    bytes: encoded.length,
    openMilliseconds,
    coreMilliseconds,
    encodeOutputMilliseconds,
    openEncodeOutputMilliseconds: openMilliseconds + encodeOutputMilliseconds,
    moduleReadySeconds: opened / 1000,
    peakRssBytes,
    baselineMemory,
    finalMemory,
    managedPeakBytes,
    managedLiveBytes: memory.liveBytes,
    scope:
      'Forward RGB8 core with borrowed input, DCT8, local CFL, adaptive quantization and explicit effort/pass selection. Public encoder input staging and pipeline conversion are separate; no quality promotion.',
    correctness: 'independent verification required after measurement',
  }),
)
