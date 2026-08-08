import { invalidInput } from '../errors.ts'
import { createJpeg2000Contexts, Jpeg2000MqDecoder } from './jpeg2000-mq.ts'

export type Jpeg2000Subband = 'HH' | 'HL' | 'LH' | 'LL'

export interface Jpeg2000CodeBlockResult {
  readonly magnitude: Uint32Array
  readonly negative: Uint8Array
  readonly decodedBitPlanes: Uint8Array
}

const processed = 1
const newlySignificant = 2
const uniformContext = 17
const runContext = 18

const significanceContext = (
  magnitude: Uint32Array,
  width: number,
  height: number,
  x: number,
  y: number,
  band: Jpeg2000Subband,
): number => {
  const index = y * width + x
  let horizontal = 0
  let vertical = 0
  let diagonal = 0
  if (x > 0 && magnitude[index - 1] !== 0) horizontal += 1
  if (x + 1 < width && magnitude[index + 1] !== 0) horizontal += 1
  if (y > 0 && magnitude[index - width] !== 0) vertical += 1
  if (y + 1 < height && magnitude[index + width] !== 0) vertical += 1
  if (y > 0) {
    if (x > 0 && magnitude[index - width - 1] !== 0) diagonal += 1
    if (x + 1 < width && magnitude[index - width + 1] !== 0) diagonal += 1
  }
  if (y + 1 < height) {
    if (x > 0 && magnitude[index + width - 1] !== 0) diagonal += 1
    if (x + 1 < width && magnitude[index + width + 1] !== 0) diagonal += 1
  }

  if (band === 'HH') {
    const orthogonal = horizontal + vertical
    if (diagonal === 0) return orthogonal === 0 ? 0 : orthogonal === 1 ? 1 : 2
    if (diagonal === 1) return orthogonal === 0 ? 3 : orthogonal === 1 ? 4 : 5
    if (diagonal === 2) return orthogonal === 0 ? 6 : 7
    return 8
  }
  if (band === 'HL') {
    const swap = horizontal
    horizontal = vertical
    vertical = swap
  }
  if (horizontal === 0) {
    if (vertical === 0) return diagonal === 0 ? 0 : diagonal === 1 ? 1 : 2
    return vertical === 1 ? 3 : 4
  }
  if (horizontal === 1) {
    if (vertical > 0) return 7
    return diagonal === 0 ? 5 : 6
  }
  return 8
}

const signedContribution = (sign: number): number => (sign === 0 ? 1 : -1)

const decodeSign = (
  decoder: Jpeg2000MqDecoder,
  contexts: Uint8Array,
  magnitude: Uint32Array,
  negative: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
): number => {
  const index = y * width + x
  let horizontal = 0
  let vertical = 0
  if (x > 0 && magnitude[index - 1] !== 0)
    horizontal += signedContribution(negative[index - 1] ?? 0)
  if (x + 1 < width && magnitude[index + 1] !== 0)
    horizontal += signedContribution(negative[index + 1] ?? 0)
  if (y > 0 && magnitude[index - width] !== 0)
    vertical += signedContribution(negative[index - width] ?? 0)
  if (y + 1 < height && magnitude[index + width] !== 0)
    vertical += signedContribution(negative[index + width] ?? 0)
  horizontal = Math.max(-1, Math.min(1, horizontal))
  vertical = Math.max(-1, Math.min(1, vertical))

  const contribution = horizontal * 3 + vertical
  const context = 9 + Math.abs(contribution)
  const prediction = contribution < 0 ? 1 : 0
  return decoder.read(contexts, context) ^ prediction
}

const markSignificant = (
  decoder: Jpeg2000MqDecoder,
  contexts: Uint8Array,
  magnitude: Uint32Array,
  negative: Uint8Array,
  flags: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
): void => {
  const index = y * width + x
  negative[index] = decodeSign(decoder, contexts, magnitude, negative, width, height, x, y)
  magnitude[index] = 1
  flags[index] = (flags[index] ?? 0) | newlySignificant
}

const hasSignificantNeighbor = (
  magnitude: Uint32Array,
  width: number,
  height: number,
  x: number,
  y: number,
): boolean => significanceContext(magnitude, width, height, x, y, 'LL') !== 0

const propagationPass = (
  decoder: Jpeg2000MqDecoder,
  contexts: Uint8Array,
  magnitude: Uint32Array,
  negative: Uint8Array,
  flags: Uint8Array,
  decoded: Uint8Array,
  width: number,
  height: number,
  band: Jpeg2000Subband,
): void => {
  for (let stripe = 0; stripe < height; stripe += 4) {
    for (let x = 0; x < width; x += 1) {
      const stripeEnd = Math.min(height, stripe + 4)
      for (let y = stripe; y < stripeEnd; y += 1) {
        const index = y * width + x
        flags[index] = (flags[index] ?? 0) & ~processed
        if (magnitude[index] !== 0 || !hasSignificantNeighbor(magnitude, width, height, x, y)) {
          continue
        }
        const context = significanceContext(magnitude, width, height, x, y, band)
        if (decoder.read(contexts, context) === 1) {
          markSignificant(decoder, contexts, magnitude, negative, flags, width, height, x, y)
        }
        decoded[index] = (decoded[index] ?? 0) + 1
        flags[index] = (flags[index] ?? 0) | processed
      }
    }
  }
}

const refinementPass = (
  decoder: Jpeg2000MqDecoder,
  contexts: Uint8Array,
  magnitude: Uint32Array,
  flags: Uint8Array,
  decoded: Uint8Array,
  width: number,
  height: number,
): void => {
  for (let stripe = 0; stripe < height; stripe += 4) {
    for (let x = 0; x < width; x += 1) {
      const stripeEnd = Math.min(height, stripe + 4)
      for (let y = stripe; y < stripeEnd; y += 1) {
        const index = y * width + x
        if (magnitude[index] === 0 || ((flags[index] ?? 0) & processed) !== 0) continue
        let context = 16
        if (((flags[index] ?? 0) & newlySignificant) !== 0) {
          flags[index] = (flags[index] ?? 0) & ~newlySignificant
          context = hasSignificantNeighbor(magnitude, width, height, x, y) ? 14 : 15
        }
        magnitude[index] = ((magnitude[index] ?? 0) << 1) | decoder.read(contexts, context)
        decoded[index] = (decoded[index] ?? 0) + 1
        flags[index] = (flags[index] ?? 0) | processed
      }
    }
  }
}

const cleanupPass = (
  decoder: Jpeg2000MqDecoder,
  contexts: Uint8Array,
  magnitude: Uint32Array,
  negative: Uint8Array,
  flags: Uint8Array,
  decoded: Uint8Array,
  width: number,
  height: number,
  band: Jpeg2000Subband,
): void => {
  for (let stripe = 0; stripe < height; stripe += 4) {
    const stripeEnd = Math.min(height, stripe + 4)
    for (let x = 0; x < width; x += 1) {
      let firstRow = stripe
      if (stripeEnd - stripe === 4) {
        let empty = true
        for (let y = stripe; y < stripeEnd; y += 1) {
          const index = y * width + x
          if (flags[index] !== 0 || hasSignificantNeighbor(magnitude, width, height, x, y)) {
            empty = false
            break
          }
        }
        if (empty) {
          if (decoder.read(contexts, runContext) === 0) {
            for (let y = stripe; y < stripeEnd; y += 1) {
              const index = y * width + x
              decoded[index] = (decoded[index] ?? 0) + 1
            }
            continue
          }
          const row =
            (decoder.read(contexts, uniformContext) << 1) | decoder.read(contexts, uniformContext)
          const y = stripe + row
          markSignificant(decoder, contexts, magnitude, negative, flags, width, height, x, y)
          for (let prior = stripe; prior <= y; prior += 1) {
            const index = prior * width + x
            decoded[index] = (decoded[index] ?? 0) + 1
          }
          firstRow = y + 1
        }
      }
      for (let y = firstRow; y < stripeEnd; y += 1) {
        const index = y * width + x
        if (magnitude[index] !== 0 || ((flags[index] ?? 0) & processed) !== 0) continue
        const context = significanceContext(magnitude, width, height, x, y, band)
        if (decoder.read(contexts, context) === 1) {
          markSignificant(decoder, contexts, magnitude, negative, flags, width, height, x, y)
        }
        decoded[index] = (decoded[index] ?? 0) + 1
      }
    }
  }
}

export const decodeJpeg2000CodeBlock = (options: {
  readonly data: Uint8Array
  readonly width: number
  readonly height: number
  readonly band: Jpeg2000Subband
  readonly zeroBitPlanes: number
  readonly codingPasses: number
  readonly segmentationSymbols: boolean
}): Jpeg2000CodeBlockResult => {
  const { data, width, height, band, zeroBitPlanes, codingPasses, segmentationSymbols } = options
  if (width < 1 || height < 1 || width * height > 4096) {
    throw invalidInput(`JPEG 2000 code-block dimensions ${width}x${height} are invalid`)
  }
  if (data.byteLength === 0 || codingPasses < 1 || codingPasses > 164) {
    throw invalidInput('JPEG 2000 code-block contribution is invalid')
  }
  const count = width * height
  const magnitude = new Uint32Array(count)
  const negative = new Uint8Array(count)
  const flags = new Uint8Array(count)
  const decoded = new Uint8Array(count)
  decoded.fill(zeroBitPlanes)
  const contexts = createJpeg2000Contexts()
  const decoder = new Jpeg2000MqDecoder(data)

  let pass = 2
  for (let index = 0; index < codingPasses; index += 1) {
    if (pass === 0) {
      propagationPass(decoder, contexts, magnitude, negative, flags, decoded, width, height, band)
    } else if (pass === 1) {
      refinementPass(decoder, contexts, magnitude, flags, decoded, width, height)
    } else {
      cleanupPass(decoder, contexts, magnitude, negative, flags, decoded, width, height, band)
      if (segmentationSymbols) {
        const symbol =
          (decoder.read(contexts, uniformContext) << 3) |
          (decoder.read(contexts, uniformContext) << 2) |
          (decoder.read(contexts, uniformContext) << 1) |
          decoder.read(contexts, uniformContext)
        if (symbol !== 0x0a) throw invalidInput('JPEG 2000 segmentation symbol is invalid')
      }
    }
    pass = (pass + 1) % 3
  }
  return { magnitude, negative, decodedBitPlanes: decoded }
}
