import { invalidInput, unsupportedOperation } from '../errors.ts'
import {
  type ImageLimitOptions,
  resolveLimits,
  validateImageDimensions,
  validateInputSize,
} from '../limits.ts'
import type { ComponentSpec } from './jpeg2000-metadata.ts'
import { parseCodestream, type ParsedCodestream } from './jpeg2000-packets.ts'
import {
  roundHalfAwayFromZero,
  componentValueAt,
  reconstructTile,
  quantStep,
} from './jpeg2000-decode.ts'

export interface Jpeg2000LosslessQualification {
  readonly reversibleTransform: boolean
  readonly unquantized: boolean
  readonly bitPreserving: boolean
}

const expectedJpeg2000CodingPasses = (magnitudeBits: number, zeroBitPlanes: number): number => {
  const remaining = magnitudeBits - zeroBitPlanes
  if (remaining <= 0) return 0
  return 1 + 3 * (remaining - 1)
}

const qualifyJpeg2000Codestream = (parsed: ParsedCodestream): Jpeg2000LosslessQualification => {
  let reversibleTransform = true
  let unquantized = true
  let completeCodingPasses = true
  for (const tile of parsed.tiles) {
    for (const component of tile.components) {
      if (!component.style.reversible) reversibleTransform = false
      if (component.quantization.style !== 0) unquantized = false
      let sequentialStep = 0
      for (const resolution of component.resolutions) {
        for (const band of resolution.bands) {
          const step = quantStep(component.quantization, sequentialStep, resolution.level)
          if (component.quantization.style !== 1) sequentialStep += 1
          const magnitudeBits = component.quantization.guardBits + step.exponent - 1
          const codedMagnitudeBits = magnitudeBits + component.roiShift
          for (const block of band.blocks) {
            if (!block.included) continue
            let codingPasses = 0
            for (const chunk of block.chunks) codingPasses += chunk.codingPasses
            if (
              codingPasses < expectedJpeg2000CodingPasses(codedMagnitudeBits, block.zeroBitPlanes)
            ) {
              completeCodingPasses = false
            }
          }
        }
      }
    }
  }
  return {
    reversibleTransform,
    unquantized,
    bitPreserving: reversibleTransform && unquantized && completeCodingPasses,
  }
}

export interface Jpeg2000NativeGrayFrame {
  readonly width: number
  readonly height: number
  readonly precision: number
  readonly signed: boolean
  readonly reversibleTransform: boolean
  readonly unquantized: boolean
  readonly bitPreserving: boolean
  readonly samplesLittleEndian: Uint8Array
  readonly consumedBytes: number
}

const nativeGraySample = (value: number, specification: ComponentSpec): number => {
  const shifted = specification.signed
    ? roundHalfAwayFromZero(value)
    : roundHalfAwayFromZero(value + 2 ** (specification.precision - 1))
  if (specification.signed) {
    const minimum = -(2 ** (specification.precision - 1))
    const maximum = 2 ** (specification.precision - 1) - 1
    return Math.max(minimum, Math.min(maximum, shifted))
  }
  const maximum = 2 ** specification.precision - 1
  return Math.max(0, Math.min(maximum, shifted))
}

export const decodeJpeg2000NativeGrayFrame = (
  codestream: Uint8Array,
  options: Readonly<ImageLimitOptions & { readonly allowTrailingBytes?: boolean }> = {},
): Jpeg2000NativeGrayFrame => {
  const limits = resolveLimits(options)
  validateInputSize(codestream.byteLength, limits)
  const parsed = parseCodestream(codestream, limits, {
    ...(options.allowTrailingBytes === undefined
      ? {}
      : { allowTrailingBytes: options.allowTrailingBytes }),
  })
  const specification = parsed.size.components[0]
  if (parsed.size.components.length !== 1 || specification === undefined) {
    throw unsupportedOperation(
      `JPEG 2000 native gray decoding does not support ${parsed.size.components.length} components`,
    )
  }
  if (specification.xSampling !== 1 || specification.ySampling !== 1) {
    throw unsupportedOperation('JPEG 2000 subsampled gray components are unsupported')
  }
  const width = parsed.size.xSize - parsed.size.xOrigin
  const height = parsed.size.ySize - parsed.size.yOrigin
  validateImageDimensions(width, height, 1, limits)
  if (specification.precision < 1 || specification.precision > 16) {
    throw unsupportedOperation(
      `JPEG 2000 component precision ${specification.precision} is unsupported`,
    )
  }
  const bytesPerSample = specification.precision <= 8 ? 1 : 2
  const samples = new Uint8Array(width * height * bytesPerSample)
  const qualification = qualifyJpeg2000Codestream(parsed)
  for (const tile of parsed.tiles) {
    const rendered = reconstructTile(codestream, parsed, tile, 1)
    const component = rendered.components[0]
    if (component === undefined)
      throw invalidInput('JPEG 2000 reconstructed gray component is missing')
    const x0 = Math.max(tile.x0, parsed.size.xOrigin)
    const y0 = Math.max(tile.y0, parsed.size.yOrigin)
    const x1 = Math.min(tile.x1, parsed.size.xSize)
    const y1 = Math.min(tile.y1, parsed.size.ySize)
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const sample = nativeGraySample(
          componentValueAt(component, specification, x, y),
          specification,
        )
        const index = (y - parsed.size.yOrigin) * width + (x - parsed.size.xOrigin)
        if (bytesPerSample === 1) {
          samples[index] = sample & 0xff
          continue
        }
        samples[index * 2] = sample & 0xff
        samples[index * 2 + 1] = (sample >> 8) & 0xff
      }
    }
  }
  return Object.freeze({
    width,
    height,
    precision: specification.precision,
    signed: specification.signed,
    reversibleTransform: qualification.reversibleTransform,
    unquantized: qualification.unquantized,
    bitPreserving: qualification.bitPreserving,
    samplesLittleEndian: samples,
    consumedBytes: parsed.endOffset,
  })
}
