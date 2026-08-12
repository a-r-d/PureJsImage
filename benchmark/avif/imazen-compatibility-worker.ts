import { createHash } from 'node:crypto'
import { open, readFile } from 'node:fs/promises'

import type { ImageMetadata } from '../../src/codec.ts'
import { avifCodec } from '../../src/codecs/avif.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { MemorySource } from '../../src/source.ts'

interface MemorySnapshot {
  readonly arrayBuffersBytes: number
  readonly externalBytes: number
  readonly heapUsedBytes: number
  readonly rssBytes: number
}

const memorySnapshot = (): MemorySnapshot => {
  const usage = process.memoryUsage()
  return {
    arrayBuffersBytes: usage.arrayBuffers,
    externalBytes: usage.external,
    heapUsedBytes: usage.heapUsed,
    rssBytes: usage.rss,
  }
}

const maximumSnapshot = (left: MemorySnapshot, right: MemorySnapshot): MemorySnapshot => ({
  arrayBuffersBytes: Math.max(left.arrayBuffersBytes, right.arrayBuffersBytes),
  externalBytes: Math.max(left.externalBytes, right.externalBytes),
  heapUsedBytes: Math.max(left.heapUsedBytes, right.heapUsedBytes),
  rssBytes: Math.max(left.rssBytes, right.rssBytes),
})

const settle = async (): Promise<void> => {
  for (let pass = 0; pass < 5; pass += 1) {
    global.gc?.()
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
}

const inputPath = process.argv[2]
const outputPath = process.argv[3]
if (!inputPath || !outputPath) {
  throw new Error('Usage: imazen-compatibility-worker.ts <input.avif> <output.rgba>')
}

let baseline = memorySnapshot()
let peakSampled = baseline
let metadata: ImageMetadata | undefined
const recordMemory = (): void => {
  peakSampled = maximumSnapshot(peakSampled, memorySnapshot())
}
const memoryResult = (): Readonly<Record<string, unknown>> => {
  recordMemory()
  return {
    baseline,
    peakSampled,
    peakRssBytes: peakSampled.rssBytes,
    peakRssDeltaBytes: Math.max(0, peakSampled.rssBytes - baseline.rssBytes),
    peakExternalDeltaBytes: Math.max(0, peakSampled.externalBytes - baseline.externalBytes),
    peakArrayBuffersDeltaBytes: Math.max(
      0,
      peakSampled.arrayBuffersBytes - baseline.arrayBuffersBytes,
    ),
  }
}

try {
  const input = new Uint8Array(await readFile(inputPath))
  await settle()
  baseline = memorySnapshot()
  peakSampled = baseline
  const startedAt = performance.now()
  const source = new MemorySource(input)
  metadata = await avifCodec.metadata(source, defaultImageLimits)
  recordMemory()
  const decoder = await avifCodec.createDecoder?.(source, defaultImageLimits)
  if (!decoder) throw new Error('AVIF decoder is unavailable')
  if (metadata.width !== decoder.width || metadata.height !== decoder.height) {
    throw new Error('AVIF metadata and decoder dimensions differ')
  }
  recordMemory()
  const output = await open(outputPath, 'w')
  const hash = createHash('sha256')
  let outputBytes = 0
  try {
    for await (const block of decoder.decode()) {
      if (block.format !== 'rgba8' || block.width !== decoder.width) {
        throw new Error(`Unexpected AVIF compatibility block ${block.format} ${block.width}`)
      }
      for (let row = 0; row < block.height; row += 1) {
        const pixels = block.data.subarray(row * block.stride, row * block.stride + block.width * 4)
        await output.write(pixels)
        hash.update(pixels)
        outputBytes += pixels.byteLength
      }
      recordMemory()
      block.release?.()
    }
  } finally {
    await output.close()
  }
  console.log(
    JSON.stringify({
      outcome: 'decoded',
      metadata,
      outputBytes,
      rgbaSha256: hash.digest('hex'),
      wallMilliseconds: Number((performance.now() - startedAt).toFixed(3)),
      memory: memoryResult(),
    }),
  )
} catch (error) {
  const code =
    typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
      ? error.code
      : 'UNEXPECTED_ERROR'
  const message = error instanceof Error ? error.message : String(error)
  console.log(
    JSON.stringify({
      outcome: 'error',
      code,
      message,
      ...(metadata === undefined ? {} : { metadata }),
      memory: memoryResult(),
    }),
  )
}
