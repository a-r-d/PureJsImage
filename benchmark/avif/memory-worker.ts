import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import { avifCodec } from '../../src/codecs/avif.ts'
import { pngCodec } from '../../src/codecs/png.ts'
import { createImageLibrary } from '../../src/image.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import type { ImageSink } from '../../src/sink.ts'
import { MemorySource } from '../../src/source.ts'
import type { AvifMemoryCase } from './memory-fixtures.ts'

interface MemorySnapshot {
  readonly arrayBuffersBytes: number
  readonly externalBytes: number
  readonly heapUsedBytes: number
  readonly rssBytes: number
}

const memorySnapshot = (): MemorySnapshot => {
  const usage = process.memoryUsage()
  return {
    rssBytes: usage.rss,
    heapUsedBytes: usage.heapUsed,
    externalBytes: usage.external,
    arrayBuffersBytes: usage.arrayBuffers,
  }
}

const maximumSnapshot = (left: MemorySnapshot, right: MemorySnapshot): MemorySnapshot => ({
  rssBytes: Math.max(left.rssBytes, right.rssBytes),
  heapUsedBytes: Math.max(left.heapUsedBytes, right.heapUsedBytes),
  externalBytes: Math.max(left.externalBytes, right.externalBytes),
  arrayBuffersBytes: Math.max(left.arrayBuffersBytes, right.arrayBuffersBytes),
})

const settle = async (): Promise<void> => {
  for (let pass = 0; pass < 5; pass += 1) {
    global.gc?.()
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
}

const isScenario = (value: unknown): value is AvifMemoryCase['scenario'] =>
  value === 'alpha' ||
  value === 'cdef' ||
  value === 'deblock' ||
  value === 'filtered-4k-multitile' ||
  value === 'downscale' ||
  value === 'grid' ||
  value === 'no-filters' ||
  value === 'restoration'

const parseCase = (value: unknown): AvifMemoryCase => {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('action' in value) ||
    (value.action !== 'decode' && value.action !== 'downscale') ||
    !('expectedHeight' in value) ||
    typeof value.expectedHeight !== 'number' ||
    !('expectedOutputSha256' in value) ||
    typeof value.expectedOutputSha256 !== 'string' ||
    !('expectedWidth' in value) ||
    typeof value.expectedWidth !== 'number' ||
    !('fileSha256' in value) ||
    typeof value.fileSha256 !== 'string' ||
    !('path' in value) ||
    typeof value.path !== 'string' ||
    !('scenario' in value) ||
    !isScenario(value.scenario)
  ) {
    throw new Error('Invalid AVIF memory case')
  }
  return {
    action: value.action,
    expectedHeight: value.expectedHeight,
    expectedOutputSha256: value.expectedOutputSha256,
    expectedWidth: value.expectedWidth,
    fileSha256: value.fileSha256,
    path: value.path,
    scenario: value.scenario,
  }
}

const serializedCase = process.argv[2]
if (!serializedCase) throw new Error('Usage: memory-worker.ts <serialized-case>')
const parsed: unknown = JSON.parse(serializedCase)
const fixture = parseCase(parsed)
const input = new Uint8Array(await readFile(fixture.path))
const images = createImageLibrary([avifCodec, pngCodec])

await settle()
const baseline = memorySnapshot()
const baselineMaximumRssBytes = process.resourceUsage().maxRSS * 1_024
if (baselineMaximumRssBytes > baseline.rssBytes + 64 * 1_024 ** 2) {
  throw new Error(
    'AVIF memory worker inherited a stale maximum RSS; launch it through run-memory.ts',
  )
}
let peakSampled = baseline
const recordMemory = (): void => {
  peakSampled = maximumSnapshot(peakSampled, memorySnapshot())
}
const startedAt = performance.now()
let outputBytes = 0
let outputSha256: string
if (fixture.action === 'decode') {
  const decoder = await avifCodec.createDecoder?.(new MemorySource(input), defaultImageLimits)
  if (!decoder) throw new Error('AVIF decoder is unavailable')
  if (decoder.width !== fixture.expectedWidth || decoder.height !== fixture.expectedHeight) {
    throw new Error(`Unexpected ${fixture.scenario} dimensions ${decoder.width}x${decoder.height}`)
  }
  recordMemory()
  const hash = createHash('sha256')
  for await (const block of decoder.decode()) {
    const bytes = block.data.subarray(0, block.stride * block.height)
    hash.update(bytes)
    outputBytes += bytes.byteLength
    recordMemory()
    block.release?.()
  }
  outputSha256 = hash.digest('hex')
} else {
  const chunks: Uint8Array[] = []
  const hash = createHash('sha256')
  const sink: ImageSink = {
    async write(chunk) {
      const owned = Uint8Array.from(chunk)
      chunks.push(owned)
      hash.update(owned)
      outputBytes += owned.byteLength
      recordMemory()
    },
    async close() {},
    async abort() {},
  }
  const image = await images.open(input)
  await image.resize({ width: fixture.expectedWidth }).png().toSink(sink)
  outputSha256 = hash.digest('hex')
  const output = new Uint8Array(outputBytes)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  const metadata = await pngCodec.metadata(new MemorySource(output), defaultImageLimits)
  if (metadata.width !== fixture.expectedWidth || metadata.height !== fixture.expectedHeight) {
    throw new Error(`Unexpected downscale dimensions ${metadata.width}x${metadata.height}`)
  }
  recordMemory()
}
const wallMilliseconds = performance.now() - startedAt
if (outputSha256 !== fixture.expectedOutputSha256) {
  throw new Error(
    `${fixture.scenario} output checksum changed: ${outputSha256}; expected ${fixture.expectedOutputSha256}`,
  )
}
const final = memorySnapshot()
peakSampled = maximumSnapshot(peakSampled, final)
const maximumRssBytes = process.resourceUsage().maxRSS * 1_024

console.log(
  JSON.stringify({
    scenario: fixture.scenario,
    action: fixture.action,
    dimensions: `${fixture.expectedWidth}x${fixture.expectedHeight}`,
    inputBytes: input.byteLength,
    outputBytes,
    outputSha256,
    sourceRgbaReferenceBytes:
      fixture.scenario === 'downscale'
        ? 1_204 * 800 * 4
        : fixture.expectedWidth * fixture.expectedHeight * 4,
    wallMilliseconds: Number(wallMilliseconds.toFixed(3)),
    baseline,
    peakSampled,
    final,
    maximumRssBytes,
    baselineMaximumRssBytes,
    peakRssDeltaBytes: Math.max(0, maximumRssBytes - baselineMaximumRssBytes),
    peakExternalDeltaBytes: Math.max(0, peakSampled.externalBytes - baseline.externalBytes),
    peakArrayBuffersDeltaBytes: Math.max(
      0,
      peakSampled.arrayBuffersBytes - baseline.arrayBuffersBytes,
    ),
  }),
)
