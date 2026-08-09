import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { jpegCodec } from '../../src/codecs/jpeg.ts'
import type { ImageSink } from '../../src/sink.ts'

const width = 2_048
const height = 1_536
const chunks: Uint8Array[] = []
const sink: ImageSink = {
  async write(chunk) {
    chunks.push(Uint8Array.from(chunk))
  },
  async close() {},
  async abort() {},
}
const encoder = await jpegCodec.createEncoder?.(sink, {
  width,
  height,
  pixelFormat: 'rgb8',
  options: { quality: 88, chromaSubsampling: '420', restartInterval: 4 },
})
if (!encoder) throw new Error('JPEG encoder is unavailable for region benchmark preparation')
const rowCount = 16
const rows = new Uint8Array(width * rowCount * 3)
for (let y = 0; y < height; y += rowCount) {
  const blockHeight = Math.min(rowCount, height - y)
  for (let row = 0; row < blockHeight; row += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (row * width + x) * 3
      rows[offset] = (x * 13 + (y + row) * 3) & 0xff
      rows[offset + 1] = (x * 5 + (y + row) * 11) & 0xff
      rows[offset + 2] = (x * 7 + (y + row) * 17) & 0xff
    }
  }
  await encoder.write({
    x: 0,
    y,
    width,
    height: blockHeight,
    stride: width * 3,
    format: 'rgb8',
    data: rows.subarray(0, width * blockHeight * 3),
  })
}
await encoder.finish()
const inputBytes = chunks.reduce((total, chunk) => total + chunk.byteLength, 0)
const input = new Uint8Array(inputBytes)
let inputOffset = 0
for (const chunk of chunks) {
  input.set(chunk, inputOffset)
  inputOffset += chunk.byteLength
}

const directory = await mkdtemp(join(tmpdir(), 'purejsimage-jpeg-region-'))
const inputPath = join(directory, 'restart.jpg')
const workerPath = fileURLToPath(new URL('./region-rss-worker.ts', import.meta.url))
try {
  await writeFile(inputPath, input)
  const results: unknown[] = []
  for (const executionClass of ['cold', 'warm'] as const) {
    for (const mode of ['full', 'region'] as const) {
      for (let run = 0; run < 3; run += 1) {
        const child = spawnSync(
          process.execPath,
          ['--expose-gc', workerPath, mode, executionClass, inputPath],
          { encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 120_000 },
        )
        if (child.error) throw child.error
        if (child.status !== 0) {
          throw new Error(
            `JPEG region ${mode}/${executionClass} worker failed: ${child.stderr.trim()}`,
          )
        }
        results.push(JSON.parse(child.stdout.trim()) as unknown)
      }
    }
  }
  const hashes = new Set(
    results.flatMap((result) =>
      typeof result === 'object' && result !== null && 'outputSha256' in result
        ? [String(result.outputSha256)]
        : [],
    ),
  )
  if (hashes.size !== 1) throw new Error('Full and region JPEG outputs differ')
  console.log(JSON.stringify({ dimensions: `${width}x${height}`, runs: results }, undefined, 2))
} finally {
  await rm(directory, { recursive: true, force: true })
}
