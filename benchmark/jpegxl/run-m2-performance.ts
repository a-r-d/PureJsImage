import { spawnSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { jpegxlCodec } from '../../src/codecs/jpegxl.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import type { ImageSink } from '../../src/sink.ts'

class CountingSink implements ImageSink {
  bytes = 0
  writes = 0

  async write(data: Uint8Array): Promise<void> {
    this.bytes += data.byteLength
    this.writes += 1
  }

  async close(): Promise<void> {}

  async abort(): Promise<void> {}
}

const width = 6_000
const height = 4_000
const channels = 3
const pixels = new Uint8Array(width * height * channels)
for (let y = 0; y < height; y += 1) {
  for (let x = 0; x < width; x += 1) {
    const offset = (y * width + x) * channels
    pixels[offset] = (x + y) & 255
    pixels[offset + 1] = (x * 3 + (y >>> 2)) & 255
    pixels[offset + 2] = ((x >>> 2) + y * 5) & 255
  }
}

const sink = new CountingSink()
const encoder = await jpegxlCodec.createEncoder?.(sink, {
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
  options: { mode: 'lossless', effort: 1, container: true },
  limits: { ...defaultImageLimits, maxDecodedBytes: width * height * 4 },
})
if (!encoder) throw new Error('JPEG XL encoder is unavailable')
const started = performance.now()
await encoder.write({
  x: 0,
  y: 0,
  width,
  height,
  stride: width * channels,
  format: 'rgb8',
  data: pixels,
})
await encoder.finish()
const milliseconds = performance.now() - started
const managedPeakBytes =
  'managedPeakBytes' in encoder && typeof encoder.managedPeakBytes === 'number'
    ? encoder.managedPeakBytes
    : null
const report = {
  schemaVersion: 1,
  revision: spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim(),
  workload: 'deterministic-rgb8-24mp',
  width,
  height,
  effort: 1,
  milliseconds,
  outputBytes: sink.bytes,
  sinkWrites: sink.writes,
  managedPeakBytes,
  gates: {
    under15Seconds: milliseconds <= 15_000,
    sectionedSink: sink.writes > 1,
    managedPeakReported: managedPeakBytes !== null,
  },
}
if (!Object.values(report.gates).every(Boolean)) {
  throw new Error(`JPEG XL M2 24 MP performance gate failed: ${JSON.stringify(report.gates)}`)
}
const outputIndex = process.argv.indexOf('--output')
const output = outputIndex < 0 ? undefined : process.argv[outputIndex + 1]
if (outputIndex >= 0 && !output) throw new Error('--output requires a path')
if (output) await writeFile(output, `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, null, 2))
