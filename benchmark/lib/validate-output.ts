import { createHash } from 'node:crypto'
import jpeg from 'jpeg-js'
import { PNG } from 'pngjs'
import { imageDimensionsFromData } from 'image-dimensions'
import type { EngineExecution, PixelCorner, ValidationResult, Workflow } from '../types.ts'

interface DecodedPixels {
  width: number
  height: number
  data: Uint8Array
}

const decodePixels = (output: Buffer, format: string): DecodedPixels | undefined => {
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

export const validateExecution = ({
  workflow,
  execution,
}: {
  workflow: Workflow
  execution: EngineExecution
}): ValidationResult => {
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
  const dimensions = imageDimensionsFromData(
    new Uint8Array(output.buffer, output.byteOffset, output.byteLength),
  )
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
  const decoded = needsPixels ? decodePixels(output, dimensions.type) : undefined
  if (needsPixels && !decoded) {
    errors.push(`pixel validation is unavailable for ${dimensions.type} output`)
  }
  const corner = decoded ? pixelAt(decoded, 0, 0) : undefined

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
    const actual = decoded ? pixelAt(decoded, sample.x, sample.y) : undefined
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
