import { fork } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { decode as decodeBmp } from 'bmp-ts'
import { imageDimensionsFromData } from 'image-dimensions'
import jpeg from 'jpeg-js'
import { PNG } from 'pngjs'
import type { EngineExecution, PixelCorner, ValidationResult, Workflow } from '../types.ts'
import { identifyClassicTiff } from './tiff.ts'

interface DecodedPixels {
  width: number
  height: number
  data: Uint8Array
}

interface OracleSample extends PixelCorner {
  readonly x: number
  readonly y: number
}

interface WebpOracleResult {
  readonly width: number
  readonly height: number
  readonly samples: readonly OracleSample[]
}

const isNumber = (value: unknown): value is number => typeof value === 'number'

const isOracleSample = (value: unknown): value is OracleSample =>
  typeof value === 'object' &&
  value !== null &&
  'x' in value &&
  isNumber(value.x) &&
  'y' in value &&
  isNumber(value.y) &&
  'red' in value &&
  isNumber(value.red) &&
  'green' in value &&
  isNumber(value.green) &&
  'blue' in value &&
  isNumber(value.blue) &&
  'alpha' in value &&
  isNumber(value.alpha)

const isWebpOracleResult = (value: unknown): value is WebpOracleResult =>
  typeof value === 'object' &&
  value !== null &&
  'width' in value &&
  isNumber(value.width) &&
  'height' in value &&
  isNumber(value.height) &&
  'samples' in value &&
  Array.isArray(value.samples) &&
  value.samples.every(isOracleSample)

const decodeWebpSamples = async (
  output: Buffer,
  points: readonly { readonly x: number; readonly y: number }[],
): Promise<WebpOracleResult> => {
  const worker = new URL('./webp-oracle-worker.ts', import.meta.url)
  return new Promise<WebpOracleResult>((resolve, reject) => {
    const child = fork(fileURLToPath(worker), [JSON.stringify(points)], {
      serialization: 'advanced',
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    })
    const stderr: Buffer[] = []
    let settled = false
    child.stderr?.on('data', (chunk: unknown) => {
      if (chunk instanceof Uint8Array) stderr.push(Buffer.from(chunk))
    })
    child.once('message', (message: unknown) => {
      settled = true
      if (isWebpOracleResult(message)) resolve(message)
      else reject(new Error('WebP oracle returned invalid data'))
    })
    child.once('error', (error) => {
      if (!settled) reject(error)
    })
    child.once('close', (code) => {
      if (!settled) {
        reject(
          new Error(
            Buffer.concat(stderr).toString('utf8') || `WebP oracle exited ${code} without a result`,
          ),
        )
      }
    })
    child.send(output)
  })
}

const decodePixels = (output: Buffer, format: string): DecodedPixels | undefined => {
  if (format === 'bmp') {
    const decoded = decodeBmp(output, { toRGBA: true })
    return { width: decoded.width, height: decoded.height, data: decoded.data }
  }
  if (format === 'png') {
    const decoded = PNG.sync.read(output)
    return { width: decoded.width, height: decoded.height, data: decoded.data }
  }

  if (format === 'jpeg') {
    const decoded = jpeg.decode(output, {
      formatAsRGBA: true,
      tolerantDecoding: true,
      useTArray: true,
    })
    return { width: decoded.width, height: decoded.height, data: decoded.data }
  }

  return undefined
}

const pixelAt = (decoded: DecodedPixels, x: number, y: number): PixelCorner | undefined => {
  if (x < 0 || y < 0 || x >= decoded.width || y >= decoded.height) return undefined
  const offset = (y * decoded.width + x) * 4
  return {
    red: decoded.data[offset] ?? -1,
    green: decoded.data[offset + 1] ?? -1,
    blue: decoded.data[offset + 2] ?? -1,
    alpha: decoded.data[offset + 3] ?? -1,
  }
}

const identifyOutput = (
  output: Buffer,
): { type: string; width: number; height: number } | undefined => {
  const bytes = new Uint8Array(output.buffer, output.byteOffset, output.byteLength)
  const detected = imageDimensionsFromData(bytes)
  if (detected) return detected
  const tiff = identifyClassicTiff(bytes)
  if (tiff) return tiff
  if (bytes[0] !== 0x42 || bytes[1] !== 0x4d) return undefined
  try {
    const decoded = decodeBmp(output, { toRGBA: true })
    return { type: 'bmp', width: decoded.width, height: decoded.height }
  } catch {
    return undefined
  }
}

export const validateExecution = async ({
  workflow,
  execution,
}: {
  workflow: Workflow
  execution: EngineExecution
}): Promise<ValidationResult> => {
  const errors: string[] = []

  if (execution.metadata) {
    for (const field of ['format', 'width', 'height'] as const) {
      if (execution.metadata[field] !== workflow.expected[field]) {
        errors.push(
          `${field}: expected ${workflow.expected[field]}, got ${execution.metadata[field]}`,
        )
      }
    }
    return {
      valid: errors.length === 0,
      errors,
      metadata: execution.metadata,
      outputBytes: 0,
    }
  }

  if (!execution.output) {
    return { valid: false, errors: ['engine returned no output'], outputBytes: 0 }
  }

  const output = Buffer.from(execution.output)
  const dimensions = identifyOutput(output)
  if (!dimensions) {
    return {
      valid: false,
      errors: ['output format could not be identified'],
      outputBytes: output.byteLength,
    }
  }

  if (dimensions.type !== workflow.expected.format) {
    errors.push(`format: expected ${workflow.expected.format}, got ${dimensions.type}`)
  }
  if (workflow.expected.width !== undefined && dimensions.width !== workflow.expected.width) {
    errors.push(`width: expected ${workflow.expected.width}, got ${dimensions.width}`)
  }
  if (workflow.expected.height !== undefined && dimensions.height !== workflow.expected.height) {
    errors.push(`height: expected ${workflow.expected.height}, got ${dimensions.height}`)
  }
  if (
    workflow.expected.outputs !== undefined &&
    execution.outputCount !== workflow.expected.outputs
  ) {
    errors.push(`outputs: expected ${workflow.expected.outputs}, got ${execution.outputCount}`)
  }

  const needsPixels =
    workflow.expected.cornerAlpha !== undefined ||
    workflow.expected.cornerRgbMinimum !== undefined ||
    (workflow.expected.pixelSamples?.length ?? 0) > 0
  const decoded =
    needsPixels && dimensions.type !== 'webp' ? decodePixels(output, dimensions.type) : undefined
  const points = [
    ...(workflow.expected.cornerAlpha !== undefined ||
    workflow.expected.cornerRgbMinimum !== undefined
      ? [{ x: 0, y: 0 }]
      : []),
    ...(workflow.expected.pixelSamples ?? []).map(({ x, y }) => ({ x, y })),
  ]
  let webpOracle: WebpOracleResult | undefined
  if (needsPixels && dimensions.type === 'webp') {
    try {
      webpOracle = await decodeWebpSamples(output, points)
      if (webpOracle.width !== dimensions.width || webpOracle.height !== dimensions.height) {
        errors.push(
          `WebP oracle dimensions: expected ${dimensions.width}x${dimensions.height}, got ${webpOracle.width}x${webpOracle.height}`,
        )
      }
    } catch (error) {
      errors.push(
        `WebP oracle validation failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
  if (needsPixels && !decoded && !webpOracle && dimensions.type !== 'webp') {
    errors.push(`pixel validation is unavailable for ${dimensions.type} output`)
  }
  const oraclePixelAt = (x: number, y: number): PixelCorner | undefined =>
    webpOracle?.samples.find((sample) => sample.x === x && sample.y === y)
  const validatedPixelAt = (x: number, y: number): PixelCorner | undefined =>
    decoded ? pixelAt(decoded, x, y) : oraclePixelAt(x, y)
  const corner = validatedPixelAt(0, 0)

  if (
    workflow.expected.cornerAlpha !== undefined &&
    corner?.alpha !== workflow.expected.cornerAlpha
  ) {
    errors.push(`corner alpha: expected ${workflow.expected.cornerAlpha}, got ${corner?.alpha}`)
  }

  if (workflow.expected.cornerRgbMinimum !== undefined) {
    for (const channel of ['red', 'green', 'blue'] as const) {
      if ((corner?.[channel] ?? -1) < workflow.expected.cornerRgbMinimum) {
        errors.push(
          `corner ${channel}: expected >= ${workflow.expected.cornerRgbMinimum}, got ${corner?.[channel]}`,
        )
      }
    }
  }

  for (const sample of workflow.expected.pixelSamples ?? []) {
    const actual = validatedPixelAt(sample.x, sample.y)
    if (!actual) {
      errors.push(`pixel (${sample.x}, ${sample.y}) is outside the decoded output`)
      continue
    }
    const tolerance = sample.tolerance ?? 0
    for (const channel of ['red', 'green', 'blue', 'alpha'] as const) {
      const expected = sample[channel]
      if (expected !== undefined && Math.abs(actual[channel] - expected) > tolerance) {
        errors.push(
          `pixel (${sample.x}, ${sample.y}) ${channel}: expected ${expected} +/- ${tolerance}, got ${actual[channel]}`,
        )
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    output: {
      format: dimensions.type,
      width: dimensions.width,
      height: dimensions.height,
      bytes: execution.outputBytes ?? output.byteLength,
      sha256: execution.batchSha256 ?? createHash('sha256').update(output).digest('hex'),
      ...(execution.outputCount ? { count: execution.outputCount } : {}),
      ...(corner ? { corner } : {}),
    },
    outputBytes: execution.outputBytes ?? output.byteLength,
  }
}
