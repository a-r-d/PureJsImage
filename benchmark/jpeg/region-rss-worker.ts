import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import {
  decodeBaselineJpeg,
  type JpegDecodeMetrics,
  parseBaselineJpegSource,
} from '../../src/codecs/jpeg-baseline.ts'
import type { PixelBlock } from '../../src/pixel.ts'
import { MemorySource } from '../../src/source.ts'

type Mode = 'full' | 'region'
type ExecutionClass = 'cold' | 'warm'

const [modeArgument, executionArgument, inputPath] = process.argv.slice(2)
if (
  (modeArgument !== 'full' && modeArgument !== 'region') ||
  (executionArgument !== 'cold' && executionArgument !== 'warm') ||
  !inputPath
) {
  throw new Error('Usage: region-rss-worker.ts <full|region> <cold|warm> <input>')
}
const mode: Mode = modeArgument
const executionClass: ExecutionClass = executionArgument
const input = await readFile(inputPath)
const crop = Object.freeze({ x: 1_408, y: 1_024, width: 512, height: 384 })

const collectCrop = async (
  blocks: AsyncIterable<PixelBlock>,
  decodedRegion: Readonly<{ x: number; y: number; width: number; height: number }>,
): Promise<Uint8Array> => {
  const output = new Uint8Array(crop.width * crop.height * 3)
  let copiedRows = 0
  for await (const block of blocks) {
    const absoluteY = decodedRegion.y + block.y
    const firstY = Math.max(crop.y, absoluteY)
    const lastY = Math.min(crop.y + crop.height, absoluteY + block.height)
    if (firstY < lastY) {
      for (let y = firstY; y < lastY; y += 1) {
        const sourceOffset = (y - absoluteY) * block.stride + (crop.x - decodedRegion.x) * 3
        const targetOffset = (y - crop.y) * crop.width * 3
        output.set(block.data.subarray(sourceOffset, sourceOffset + crop.width * 3), targetOffset)
        copiedRows += 1
      }
    }
    block.release?.()
  }
  if (copiedRows !== crop.height) {
    throw new Error(`Region benchmark copied ${copiedRows} of ${crop.height} rows`)
  }
  return output
}

const execute = async (): Promise<Readonly<{ data: Uint8Array; metrics: JpegDecodeMetrics }>> => {
  const source = new MemorySource(input)
  const jpeg = await parseBaselineJpegSource(source)
  if (!jpeg) throw new Error('Region benchmark requires a baseline single-scan JPEG')
  const decodedRegion =
    mode === 'full' ? { x: 0, y: 0, width: jpeg.width, height: jpeg.height } : { ...crop }
  const metrics: JpegDecodeMetrics = {
    totalMcus: 0,
    entropyStartMcu: 0,
    entropyMcusDecoded: 0,
    blocksReconstructed: 0,
  }
  const data = await collectCrop(decodeBaselineJpeg(jpeg, decodedRegion, 1, metrics), decodedRegion)
  return { data, metrics }
}

const settle = async (): Promise<void> => {
  for (let pass = 0; pass < 5; pass += 1) {
    global.gc?.()
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
}

if (executionClass === 'warm') {
  await execute()
  await settle()
}
const baselineRssBytes = process.memoryUsage().rss
const startedAt = performance.now()
const result = await execute()
const wallMilliseconds = performance.now() - startedAt
const maximumRssBytes = process.resourceUsage().maxRSS * 1_024

console.log(
  JSON.stringify({
    mode,
    executionClass,
    wallMilliseconds,
    baselineRssBytes,
    maximumRssBytes,
    peakRssDeltaBytes: Math.max(0, maximumRssBytes - baselineRssBytes),
    inputBytes: input.byteLength,
    compressedBytesRetained: 65_536,
    outputBytes: result.data.byteLength,
    outputSha256: createHash('sha256').update(result.data).digest('hex'),
    ...result.metrics,
  }),
)
