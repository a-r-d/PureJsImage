import { readFile } from 'node:fs/promises'

type Action = 'pure-metadata' | 'reference-decode' | 'reference-metadata'

const [actionArgument, path] = process.argv.slice(2)
const actions: ReadonlySet<string> = new Set([
  'pure-metadata',
  'reference-decode',
  'reference-metadata',
])
if (!actionArgument || !actions.has(actionArgument) || !path) {
  throw new Error('Usage: reference-worker.ts <action> <fixture>')
}
const action = actionArgument as Action
const input = await readFile(path)

interface Output {
  readonly width: number
  readonly height: number
  readonly outputBytes: number
  readonly bitDepth?: number
  readonly chromaSubsampling?: '400' | '420' | '422' | '444'
  readonly codecProfile?: number
  readonly hasAlpha?: boolean
}

let execute: () => Promise<Output>
if (action === 'pure-metadata') {
  const { Image } = await import('../../src/index.ts')
  execute = async () => {
    const metadata = await (await Image.open(input)).metadata()
    return {
      width: metadata.width,
      height: metadata.height,
      outputBytes: 0,
      hasAlpha: metadata.hasAlpha,
      ...(metadata.bitDepth !== undefined ? { bitDepth: metadata.bitDepth } : {}),
      ...(metadata.chromaSubsampling !== undefined
        ? { chromaSubsampling: metadata.chromaSubsampling }
        : {}),
      ...(metadata.codecProfile !== undefined ? { codecProfile: metadata.codecProfile } : {}),
    }
  }
} else {
  let compatibilityShim = false
  const uint8ArrayConstructor = Uint8Array as Uint8ArrayConstructor & {
    fromBase64?: (value: string) => Uint8Array
  }
  if (typeof uint8ArrayConstructor.fromBase64 !== 'function') {
    compatibilityShim = true
    Object.defineProperty(uint8ArrayConstructor, 'fromBase64', {
      configurable: true,
      value: (value: string): Uint8Array => new Uint8Array(Buffer.from(value, 'base64')),
    })
  }
  const { decode, getAvifItemInfo, parseISOBMFF } = await import('@stacksjs/ts-avif')
  execute = async () => {
    if (action === 'reference-metadata') {
      const info = getAvifItemInfo(input, parseISOBMFF(input))
      const configuration = info.av1C
      const chromaSubsampling = configuration?.monochrome
        ? '400'
        : configuration?.chromaSubsamplingX
          ? configuration.chromaSubsamplingY
            ? '420'
            : '422'
          : '444'
      return {
        width: info.width,
        height: info.height,
        outputBytes: 0,
        bitDepth: info.bitDepth,
        chromaSubsampling,
        codecProfile: configuration?.seqProfile,
        hasAlpha: info.hasAlpha,
      }
    }
    const image = decode(input)
    return { width: image.width, height: image.height, outputBytes: image.data.byteLength }
  }
  process.env.PUREJSIMAGE_AVIF_REFERENCE_SHIM = compatibilityShim ? 'true' : 'false'
}

for (let pass = 0; pass < 3; pass += 1) {
  global.gc?.()
  await new Promise<void>((resolve) => setImmediate(resolve))
}

const baselineRssBytes = process.memoryUsage().rss
const cpuStart = process.cpuUsage()
const start = performance.now()

try {
  const output = await execute()
  const cpu = process.cpuUsage(cpuStart)
  const maxRssBytes = process.resourceUsage().maxRSS * 1024
  process.send?.({
    ok: true,
    action,
    ...output,
    wallMilliseconds: performance.now() - start,
    cpuMilliseconds: (cpu.user + cpu.system) / 1000,
    baselineRssBytes,
    maxRssBytes,
    peakRssDeltaBytes: Math.max(0, maxRssBytes - baselineRssBytes),
    compatibilityShim: process.env.PUREJSIMAGE_AVIF_REFERENCE_SHIM === 'true',
  })
} catch (error) {
  const maxRssBytes = process.resourceUsage().maxRSS * 1024
  process.send?.({
    ok: false,
    action,
    error: error instanceof Error ? error.message : String(error),
    wallMilliseconds: performance.now() - start,
    baselineRssBytes,
    maxRssBytes,
    peakRssDeltaBytes: Math.max(0, maxRssBytes - baselineRssBytes),
    compatibilityShim: process.env.PUREJSIMAGE_AVIF_REFERENCE_SHIM === 'true',
  })
}
