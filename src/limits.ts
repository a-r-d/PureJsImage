import { invalidInput, limitExceeded } from './errors.ts'

export interface ImageLimits {
  maxWidth: number
  maxHeight: number
  maxPixels: number
  maxInputBytes: number
  maxFrames: number
  maxDecodedBytes: number
}

export type ImageLimitOptions = Partial<ImageLimits>

export const defaultImageLimits: Readonly<ImageLimits> = Object.freeze({
  maxWidth: 100_000,
  maxHeight: 100_000,
  maxPixels: 268_435_456,
  maxInputBytes: 134_217_728,
  maxFrames: 1_000,
  maxDecodedBytes: 1_073_741_824,
})

const positiveInteger = (name: keyof ImageLimits, value: number): number => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw invalidInput(`${name} must be a positive safe integer`)
  }
  return value
}

export const resolveLimits = (options: ImageLimitOptions = {}): Readonly<ImageLimits> => {
  return Object.freeze({
    maxWidth: positiveInteger('maxWidth', options.maxWidth ?? defaultImageLimits.maxWidth),
    maxHeight: positiveInteger('maxHeight', options.maxHeight ?? defaultImageLimits.maxHeight),
    maxPixels: positiveInteger('maxPixels', options.maxPixels ?? defaultImageLimits.maxPixels),
    maxInputBytes: positiveInteger(
      'maxInputBytes',
      options.maxInputBytes ?? defaultImageLimits.maxInputBytes,
    ),
    maxFrames: positiveInteger('maxFrames', options.maxFrames ?? defaultImageLimits.maxFrames),
    maxDecodedBytes: positiveInteger(
      'maxDecodedBytes',
      options.maxDecodedBytes ?? defaultImageLimits.maxDecodedBytes,
    ),
  })
}

export const validateInputSize = (size: number, limits: ImageLimits): void => {
  if (!Number.isSafeInteger(size) || size < 0) throw invalidInput('Input size is invalid')
  if (size > limits.maxInputBytes) {
    throw limitExceeded(`Input is ${size} bytes; maxInputBytes is ${limits.maxInputBytes}`)
  }
}

export const validateImageDimensions = (
  width: number,
  height: number,
  frames: number,
  limits: ImageLimits,
): void => {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw invalidInput(`Invalid image dimensions: ${width}x${height}`)
  }
  if (width > limits.maxWidth) {
    throw limitExceeded(`Image width ${width} exceeds maxWidth ${limits.maxWidth}`)
  }
  if (height > limits.maxHeight) {
    throw limitExceeded(`Image height ${height} exceeds maxHeight ${limits.maxHeight}`)
  }
  if (!Number.isInteger(frames) || frames < 1) throw invalidInput(`Invalid frame count: ${frames}`)
  if (frames > limits.maxFrames) {
    throw limitExceeded(`Image frame count ${frames} exceeds maxFrames ${limits.maxFrames}`)
  }

  const pixels = BigInt(width) * BigInt(height)
  if (pixels > BigInt(limits.maxPixels)) {
    throw limitExceeded(`Image has ${pixels} pixels; maxPixels is ${limits.maxPixels}`)
  }

  const decodedBytes = pixels * 4n
  if (decodedBytes > BigInt(limits.maxDecodedBytes)) {
    throw limitExceeded(
      `Worst-case decoded size is ${decodedBytes} bytes; maxDecodedBytes is ${limits.maxDecodedBytes}`,
    )
  }
}
