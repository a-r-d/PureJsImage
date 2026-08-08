import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import { executeScaledIdctResize, type ScaledIdctMode } from './scaled-idct.ts'

const [modeArgument, widthArgument, fixturePath] = process.argv.slice(2)
if ((modeArgument !== 'full' && modeArgument !== 'scaled') || !widthArgument || !fixturePath) {
  throw new Error('Usage: scaled-idct-worker.ts <full|scaled> <target-width> <fixture>')
}
const mode: ScaledIdctMode = modeArgument
const targetWidth = Number(widthArgument)
if (!Number.isSafeInteger(targetWidth) || targetWidth < 1) {
  throw new Error(`Invalid target width: ${widthArgument}`)
}
const input = await readFile(fixturePath)

const settle = async (): Promise<void> => {
  for (let pass = 0; pass < 5; pass += 1) {
    global.gc?.()
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
}

await executeScaledIdctResize(input, targetWidth, mode)
await settle()
const baselineRssBytes = process.memoryUsage().rss
const startedAt = performance.now()
const result = await executeScaledIdctResize(input, targetWidth, mode)
const wallMilliseconds = performance.now() - startedAt
const maximumRssBytes = process.resourceUsage().maxRSS * 1024

console.log(
  JSON.stringify({
    mode,
    targetWidth,
    width: result.width,
    height: result.height,
    sourceWidth: result.sourceWidth,
    sourceHeight: result.sourceHeight,
    sourcePixels: result.sourcePixels,
    scaleDenominator: result.scaleDenominator,
    decodedWidth: result.decodedWidth,
    decodedHeight: result.decodedHeight,
    decodedPixels: result.decodedPixels,
    decodedPixelsAvoided: result.sourcePixels - result.decodedPixels,
    decodedPixelsAvoidedPercent:
      ((result.sourcePixels - result.decodedPixels) / result.sourcePixels) * 100,
    outputBytes: result.data.byteLength,
    outputSha256: createHash('sha256').update(result.data).digest('hex'),
    wallMilliseconds,
    baselineRssBytes,
    maximumRssBytes,
    peakRssDeltaBytes: Math.max(0, maximumRssBytes - baselineRssBytes),
  }),
)
