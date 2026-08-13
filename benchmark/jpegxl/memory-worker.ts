import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { jpegxlCodec } from '../../src/codecs/jpegxl.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { MemorySource } from '../../src/source.ts'

interface MemorySnapshot {
  readonly arrayBuffersBytes: number
  readonly externalBytes: number
  readonly heapUsedBytes: number
  readonly rssBytes: number
}

const snapshot = (): MemorySnapshot => {
  const memory = process.memoryUsage()
  return {
    arrayBuffersBytes: memory.arrayBuffers,
    externalBytes: memory.external,
    heapUsedBytes: memory.heapUsed,
    rssBytes: memory.rss,
  }
}

const maximum = (left: MemorySnapshot, right: MemorySnapshot): MemorySnapshot => ({
  arrayBuffersBytes: Math.max(left.arrayBuffersBytes, right.arrayBuffersBytes),
  externalBytes: Math.max(left.externalBytes, right.externalBytes),
  heapUsedBytes: Math.max(left.heapUsedBytes, right.heapUsedBytes),
  rssBytes: Math.max(left.rssBytes, right.rssBytes),
})

const mode = process.argv[2]
if (mode !== 'crop' && mode !== 'full') throw new Error('Usage: memory-worker.ts <crop|full>')
const input = new Uint8Array(await readFile('tests/fixtures/jpegxl/permuted-large-gray8.jxl'))
const inputSha256 = createHash('sha256').update(input).digest('hex')
if (inputSha256 !== '23452102d25d7f58ff75e59691966ccfbefb986997289613230fd2a1a64b0b65') {
  throw new Error('JPEG XL memory fixture checksum changed')
}
const expected =
  mode === 'crop'
    ? {
        outputBytes: 4_096,
        outputSha256: '373b5353c7c035df56ee86a4527824220bf2b688f5144c54560734ea8e3be1c5',
      }
    : {
        outputBytes: 16_777_216,
        outputSha256: '8fff1a309e8b2f8677e0265bf4b41b29a4c81d3cd9dc3cbbe5c25a01e1a96aac',
      }
for (let turn = 0; turn < 5; turn += 1) {
  globalThis.gc?.()
  await new Promise<void>((resolve) => setImmediate(resolve))
}
const baseline = snapshot()
let peak = baseline
const startedAt = performance.now()
const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(input), defaultImageLimits)
if (!decoder) throw new Error('JPEG XL decoder is unavailable')
const request = mode === 'crop' ? { x: 2_030, y: 2_040, width: 64, height: 64 } : {}
const hash = createHash('sha256')
let outputBytes = 0
for await (const block of decoder.decode(request)) {
  hash.update(block.data)
  outputBytes += block.data.byteLength
  peak = maximum(peak, snapshot())
  block.release?.()
}
const outputSha256 = hash.digest('hex')
if (outputBytes !== expected.outputBytes || outputSha256 !== expected.outputSha256) {
  throw new Error(`JPEG XL ${mode} memory output does not match the pinned pixel oracle`)
}
const maximumRssBytes = process.resourceUsage().maxRSS * 1_024
console.log(
  JSON.stringify({
    mode,
    baseline,
    peak,
    maximumRssBytes,
    peakRssDeltaBytes: Math.max(0, maximumRssBytes - baseline.rssBytes),
    inputBytes: input.byteLength,
    outputBytes,
    outputSha256,
    wallMilliseconds: Number((performance.now() - startedAt).toFixed(3)),
  }),
)
