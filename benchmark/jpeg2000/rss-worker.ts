import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import jpeg from 'jpeg-js'

import { jpegCodec } from '../../src/codecs/jpeg.ts'
import { jpeg2000Codec } from '../../src/codecs/jpeg2000.ts'
import { createImageLibrary } from '../../src/image.ts'

type Action = 'metadata' | 'resize-jpeg'
type Mode = 'cold' | 'warm'

const [actionArgument, modeArgument, path] = process.argv.slice(2)
if (
  (actionArgument !== 'metadata' && actionArgument !== 'resize-jpeg') ||
  (modeArgument !== 'cold' && modeArgument !== 'warm') ||
  !path
) {
  throw new Error('Usage: rss-worker.ts <metadata|resize-jpeg> <cold|warm> <fixture>')
}
const action: Action = actionArgument
const mode: Mode = modeArgument
const input = await readFile(path)
const images = createImageLibrary([jpeg2000Codec, jpegCodec])

interface ExecutionResult {
  readonly height: number
  readonly outputBytes: number
  readonly outputSha256?: string
  readonly width: number
}

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

const settle = async (): Promise<void> => {
  for (let pass = 0; pass < 5; pass += 1) {
    global.gc?.()
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
}

const execute = async (): Promise<ExecutionResult> => {
  const image = await images.open(input)
  if (action === 'metadata') {
    const metadata = await image.metadata()
    if (metadata.width !== 1920 || metadata.height !== 2172) {
      throw new Error(`Unexpected metadata dimensions ${metadata.width}x${metadata.height}`)
    }
    return { width: metadata.width, height: metadata.height, outputBytes: 0 }
  }

  const output = await image.resize({ width: 480 }).jpeg({ quality: 80 }).toBuffer()
  const decoded = jpeg.decode(output, {
    formatAsRGBA: false,
    tolerantDecoding: false,
    useTArray: true,
  })
  if (decoded.width !== 480 || decoded.height !== 543) {
    throw new Error(`Unexpected resized JPEG dimensions ${decoded.width}x${decoded.height}`)
  }
  return {
    width: decoded.width,
    height: decoded.height,
    outputBytes: output.byteLength,
    outputSha256: createHash('sha256').update(output).digest('hex'),
  }
}

await settle()
if (mode === 'warm') {
  await execute()
  await settle()
}
const baseline = memorySnapshot()
const start = performance.now()
const result = await execute()
const wallMilliseconds = performance.now() - start
const final = memorySnapshot()
const maximumRssBytes = process.resourceUsage().maxRSS * 1024
const maximumAllowedRssBytes = (action === 'metadata' ? 128 : 256) * 1024 ** 2
if (maximumRssBytes > maximumAllowedRssBytes) {
  throw new Error(`${action}/${mode} peak RSS ${maximumRssBytes} exceeds ${maximumAllowedRssBytes}`)
}
if (
  action === 'resize-jpeg' &&
  result.outputSha256 !== '53e1d505fb26697e9f91135ed973102cd4cb3f474dc9ef75404bd7233c1f3995'
) {
  throw new Error('Resized JPEG output differs from the pinned benchmark result')
}

console.log(
  JSON.stringify({
    action,
    mode,
    fixtureBytes: input.byteLength,
    wallMilliseconds: Number(wallMilliseconds.toFixed(3)),
    baseline,
    final,
    maximumRssBytes,
    maximumAllowedRssBytes,
    peakRssDeltaBytes: Math.max(0, maximumRssBytes - baseline.rssBytes),
    ...result,
  }),
)
