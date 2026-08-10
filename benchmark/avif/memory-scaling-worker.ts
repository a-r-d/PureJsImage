import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import { av1ObuType } from '../../src/codecs/av1.ts'
import { parseAv1Frame } from '../../src/codecs/av1-frame.ts'
import { av1ToRgbaRegion, decodeRestrictedAv1Intra } from '../../src/codecs/av1-intra.ts'
import { avifCodec, inspectAvifBitstreams } from '../../src/codecs/avif.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { MemorySource } from '../../src/source.ts'

interface MemorySnapshot {
  readonly arrayBuffersBytes: number
  readonly externalBytes: number
  readonly heapUsedBytes: number
  readonly rssBytes: number
}

const snapshot = (): MemorySnapshot => {
  const usage = process.memoryUsage()
  return {
    arrayBuffersBytes: usage.arrayBuffers,
    externalBytes: usage.external,
    heapUsedBytes: usage.heapUsed,
    rssBytes: usage.rss,
  }
}

const maximum = (left: MemorySnapshot, right: MemorySnapshot): MemorySnapshot => ({
  arrayBuffersBytes: Math.max(left.arrayBuffersBytes, right.arrayBuffersBytes),
  externalBytes: Math.max(left.externalBytes, right.externalBytes),
  heapUsedBytes: Math.max(left.heapUsedBytes, right.heapUsedBytes),
  rssBytes: Math.max(left.rssBytes, right.rssBytes),
})

const [path, widthText, heightText, expectedSha256, mode] = process.argv.slice(2)
const width = Number(widthText)
const height = Number(heightText)
const validMode =
  mode === 'bounded' || mode === 'full' || mode === 'bounded-scaled' || mode === 'full-scaled'
if (
  !path ||
  !expectedSha256 ||
  !validMode ||
  !Number.isSafeInteger(width) ||
  !Number.isSafeInteger(height)
) {
  throw new Error(
    'Usage: memory-scaling-worker.ts <path> <width> <height> <sha256> <bounded|full|bounded-scaled|full-scaled>',
  )
}

const input = new Uint8Array(await readFile(path))
for (let pass = 0; pass < 5; pass += 1) {
  global.gc?.()
  await new Promise<void>((resolve) => setImmediate(resolve))
}
let peak = snapshot()
const baseline = peak
const baselineMaximumRssBytes = process.resourceUsage().maxRSS * 1_024
if (baselineMaximumRssBytes > baseline.rssBytes + 64 * 1_024 ** 2) {
  throw new Error(
    'AVIF memory worker inherited a stale maximum RSS; launch it through run-memory-scaling.ts',
  )
}
const record = (): void => {
  peak = maximum(peak, snapshot())
}
const hash = createHash('sha256')
const startedAt = performance.now()
const scaled = mode === 'bounded-scaled' || mode === 'full-scaled'
const bounded = mode === 'bounded' || mode === 'bounded-scaled'
const scaleDenominator = scaled ? 4 : 1
const outputWidth = Math.ceil(width / scaleDenominator)
const outputHeight = Math.ceil(height / scaleDenominator)
if (bounded) {
  const decoder = await avifCodec.createDecoder?.(new MemorySource(input), defaultImageLimits)
  if (!decoder) throw new Error('AVIF decoder is unavailable')
  record()
  for await (const block of decoder.decode(
    scaled
      ? { width: outputWidth, height: outputHeight, scaleDenominator: 4 }
      : { width: outputWidth, height: outputHeight },
  )) {
    hash.update(block.data.subarray(0, block.stride * block.height))
    record()
  }
} else {
  const inspection = await inspectAvifBitstreams(new MemorySource(input))
  const coded = inspection.codedImages[0]
  const frameObu = coded?.obus.find((obu) => obu.type === av1ObuType.frame)
  if (!coded || !frameObu) throw new Error('AVIF scaling fixture has no coded frame')
  const frame = decodeRestrictedAv1Intra(
    coded.sequence,
    parseAv1Frame(coded.sequence, frameObu.payload),
  )
  record()
  for (let y = 0; y < outputHeight; y += 32) {
    const rows = Math.min(32, outputHeight - y)
    hash.update(
      av1ToRgbaRegion(
        coded.sequence,
        frame,
        { x: 0, y: y * scaleDenominator, width: outputWidth, height: rows },
        inspection.nclx,
        scaleDenominator === 4 ? 4 : 1,
      ),
    )
    record()
  }
}
const actualSha256 = hash.digest('hex')
if (actualSha256 !== expectedSha256) {
  throw new Error(`${mode} output checksum changed: ${actualSha256}`)
}
const maximumRssBytes = process.resourceUsage().maxRSS * 1_024
console.log(
  JSON.stringify({
    mode,
    dimensions: `${width}x${height}`,
    pixels: width * height,
    inputBytes: input.byteLength,
    outputSha256: actualSha256,
    wallMilliseconds: Number((performance.now() - startedAt).toFixed(3)),
    maximumRssBytes,
    baselineMaximumRssBytes,
    peakRssDeltaBytes: Math.max(0, maximumRssBytes - baselineMaximumRssBytes),
    peakExternalDeltaBytes: Math.max(0, peak.externalBytes - baseline.externalBytes),
    peakArrayBuffersDeltaBytes: Math.max(0, peak.arrayBuffersBytes - baseline.arrayBuffersBytes),
  }),
)
