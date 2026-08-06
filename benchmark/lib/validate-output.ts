import { createHash } from 'node:crypto'
import jpeg from 'jpeg-js'
import { PNG } from 'pngjs'
import { imageDimensionsFromData } from 'image-dimensions'
import type { EngineExecution, PixelCorner, ValidationResult, Workflow } from '../types.ts'

const inspectCorner = (output: Buffer, format: string): PixelCorner | undefined => {
  if (format === 'png') {
    const decoded = PNG.sync.read(output)
    return {
      red: decoded.data[0] ?? -1,
      green: decoded.data[1] ?? -1,
      blue: decoded.data[2] ?? -1,
      alpha: decoded.data[3] ?? -1,
    }
  }

  if (format === 'jpeg') {
    const decoded = jpeg.decode(output, {
      formatAsRGBA: true,
      tolerantDecoding: true,
      useTArray: true,
    })
    return {
      red: decoded.data[0] ?? -1,
      green: decoded.data[1] ?? -1,
      blue: decoded.data[2] ?? -1,
      alpha: decoded.data[3] ?? -1,
    }
  }

  return undefined
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

  let corner: PixelCorner | undefined
  if (
    workflow.expected.cornerAlpha !== undefined ||
    workflow.expected.cornerRgbMinimum !== undefined
  ) {
    corner = inspectCorner(output, dimensions.type)
  }

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
