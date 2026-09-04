import type { AbortOptions } from './abort.ts'
import { throwIfAborted } from './abort.ts'
import type { PixelColorSemantics } from './color.ts'
import { invalidInput, unsupportedOperation } from './errors.ts'
import { type PixelBlock, type PixelFormat, pixelStorage } from './pixel.ts'

export type ConvertiblePixelFormat =
  | 'gray8'
  | 'gray16'
  | 'grayf32'
  | 'rgb8'
  | 'rgb16'
  | 'rgbf32'
  | 'rgbaf32'
  | 'rgba8'
  | 'rgba16'

export interface PixelConversionRange {
  readonly minimum: number
  readonly maximum: number
}

export type AlphaRemoval =
  | { readonly mode: 'discard' }
  | { readonly mode: 'background'; readonly background: `#${string}` }

export interface ConvertPixelFormatOptions {
  readonly format: ConvertiblePixelFormat
  readonly range?: Readonly<PixelConversionRange>
  /** Normalized alpha from 0 through 1 when adding an alpha channel. */
  readonly alpha?: number
  readonly alphaRemoval?: Readonly<AlphaRemoval>
}

const sourceSupported = (format: PixelFormat): format is ConvertiblePixelFormat =>
  format === 'gray8' ||
  format === 'gray16' ||
  format === 'grayf32' ||
  format === 'rgb8' ||
  format === 'rgb16' ||
  format === 'rgbf32' ||
  format === 'rgbaf32' ||
  format === 'rgba8' ||
  format === 'rgba16'

const validateBackground = (value: string): void => {
  if (!/^#[0-9a-fA-F]{6}$/.test(value)) {
    throw invalidInput('Pixel conversion background must be #RRGGBB')
  }
}

export const validateConvertPixelFormatOptions = (
  options: Readonly<ConvertPixelFormatOptions>,
): void => {
  if (!sourceSupported(options.format)) {
    throw invalidInput(`Pixel conversion output format ${options.format} is unsupported`)
  }
  if (
    options.range !== undefined &&
    (!Number.isFinite(options.range.minimum) ||
      !Number.isFinite(options.range.maximum) ||
      options.range.minimum >= options.range.maximum)
  ) {
    throw invalidInput('Pixel conversion range must contain increasing finite endpoints')
  }
  if (
    options.alpha !== undefined &&
    (!Number.isFinite(options.alpha) || options.alpha < 0 || options.alpha > 1)
  ) {
    throw invalidInput('Pixel conversion alpha must be from 0 through 1')
  }
  if (options.alphaRemoval?.mode === 'background')
    validateBackground(options.alphaRemoval.background)
}

const sampleMaximum = (format: PixelFormat): number => (format.endsWith('16') ? 65_535 : 255)

const readSample = (
  data: Uint8Array,
  view: DataView,
  offset: number,
  format: PixelFormat,
): number => {
  if (format.endsWith('f32')) return view.getFloat32(offset, false)
  if (format.endsWith('16')) return (data[offset] ?? 0) * 256 + (data[offset + 1] ?? 0)
  return data[offset] ?? 0
}

const writeSample = (data: Uint8Array, offset: number, value: number, maximum: number): void => {
  const rounded = Math.max(0, Math.min(maximum, Math.round(value)))
  if (maximum === 255) {
    data[offset] = rounded
  } else {
    data[offset] = rounded >>> 8
    data[offset + 1] = rounded & 0xff
  }
}

const background = (value: `#${string}`, maximum: number): readonly [number, number, number] => {
  const scale = maximum / 255
  return [
    Number.parseInt(value.slice(1, 3), 16) * scale,
    Number.parseInt(value.slice(3, 5), 16) * scale,
    Number.parseInt(value.slice(5, 7), 16) * scale,
  ]
}

export const convertedPixelColorSemantics = (
  semantics: PixelColorSemantics | undefined,
  outputFormat: PixelFormat,
): PixelColorSemantics | undefined => {
  if (semantics === undefined) return undefined
  if (semantics.alpha === 'premultiplied') {
    throw unsupportedOperation(
      'Pixel format conversion does not support explicitly premultiplied alpha input',
    )
  }
  return Object.freeze({
    ...semantics,
    family: outputFormat.startsWith('gray') ? 'gray' : 'rgb',
    alpha: outputFormat.startsWith('rgba') ? 'straight' : 'none',
  })
}

export const convertPixelBlocks = async function* (
  blocks: AsyncIterable<PixelBlock>,
  inputFormat: PixelFormat,
  options: Readonly<ConvertPixelFormatOptions>,
  abort: Readonly<AbortOptions> = {},
  sampleBitDepths?: readonly number[],
): AsyncGenerator<PixelBlock> {
  validateConvertPixelFormatOptions(options)
  if (!sourceSupported(inputFormat)) {
    throw unsupportedOperation(`Pixel conversion does not support ${inputFormat} input`)
  }
  const input = pixelStorage(inputFormat)
  const output = pixelStorage(options.format)
  const inputFloat = input.sampleType === 'floating-point'
  const outputFloat = output.sampleType === 'floating-point'
  if (outputFloat) {
    throw unsupportedOperation('Pixel conversion does not currently produce float output')
  }
  if (inputFloat && options.range === undefined) {
    throw invalidInput('Float pixel conversion requires an explicit finite range')
  }
  if (!inputFloat && options.range !== undefined) {
    throw invalidInput('Pixel conversion range is only supported for float input')
  }
  if (input.channels > 1 && output.channels === 1) {
    throw unsupportedOperation('RGB to grayscale conversion requires an explicit color conversion')
  }
  if (input.channels < output.channels && output.channels === 4 && options.alpha === undefined) {
    throw invalidInput('Adding an alpha channel requires an explicit normalized alpha value')
  }
  if (input.channels === 4 && output.channels < 4 && options.alphaRemoval === undefined) {
    throw invalidInput('Removing alpha requires an explicit background or discard policy')
  }
  const inputMaximum = inputFloat ? 1 : sampleMaximum(inputFormat)
  const outputMaximum = sampleMaximum(options.format)
  const inputBytesPerPixel = input.channels * input.bytesPerSample
  const outputBytesPerPixel = output.channels * output.bytesPerSample
  const range = options.range
  const backgroundValues =
    options.alphaRemoval?.mode === 'background'
      ? background(options.alphaRemoval.background, outputMaximum)
      : undefined

  for await (const block of blocks) {
    try {
      const colorSemantics = convertedPixelColorSemantics(block.colorSemantics, options.format)
      throwIfAborted(abort.signal)
      const inputRowBytes = block.width * inputBytesPerPixel
      if (
        block.format !== inputFormat ||
        block.height < 1 ||
        block.stride < inputRowBytes ||
        block.data.byteLength < block.stride * (block.height - 1) + inputRowBytes
      ) {
        throw invalidInput('Pixel conversion received an invalid pixel block')
      }
      const stride = block.width * outputBytesPerPixel
      const data = new Uint8Array(stride * block.height)
      const view = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength)
      for (let row = 0; row < block.height; row += 1) {
        throwIfAborted(abort.signal)
        for (let x = 0; x < block.width; x += 1) {
          const source = row * block.stride + x * inputBytesPerPixel
          const target = row * stride + x * outputBytesPerPixel
          const first = readSample(block.data, view, source, inputFormat)
          if (!Number.isFinite(first)) throw invalidInput('Pixel conversion input must be finite')
          const second =
            input.channels === 1
              ? first
              : readSample(block.data, view, source + input.bytesPerSample, inputFormat)
          const third =
            input.channels === 1
              ? first
              : readSample(block.data, view, source + input.bytesPerSample * 2, inputFormat)
          const fourth =
            input.channels === 4
              ? readSample(block.data, view, source + input.bytesPerSample * 3, inputFormat)
              : inputMaximum
          if (!Number.isFinite(second) || !Number.isFinite(third) || !Number.isFinite(fourth)) {
            throw invalidInput('Pixel conversion input must be finite')
          }
          const sourceAlpha =
            fourth /
            (inputFloat
              ? 1
              : sampleBitDepths?.[3] === undefined
                ? inputMaximum
                : 2 ** sampleBitDepths[3] - 1)
          for (let channel = 0; channel < output.channels; channel += 1) {
            let value: number
            if (channel === 3) {
              value = (options.alpha ?? sourceAlpha) * outputMaximum
            } else {
              const sourceValue = channel === 0 ? first : channel === 1 ? second : third
              const normalized = inputFloat
                ? (sourceValue - (range?.minimum ?? 0)) /
                  ((range?.maximum ?? 1) - (range?.minimum ?? 0))
                : sourceValue /
                  (sampleBitDepths?.[input.channels === 1 ? 0 : channel] === undefined
                    ? inputMaximum
                    : 2 ** (sampleBitDepths[input.channels === 1 ? 0 : channel] ?? 8) - 1)
              value = normalized * outputMaximum
              if (input.channels === 4 && output.channels < 4 && backgroundValues) {
                value = value * sourceAlpha + (backgroundValues[channel] ?? 0) * (1 - sourceAlpha)
              }
            }
            writeSample(data, target + channel * output.bytesPerSample, value, outputMaximum)
          }
        }
      }
      yield {
        x: block.x,
        y: block.y,
        width: block.width,
        height: block.height,
        stride,
        format: options.format,
        data,
        ...(colorSemantics === undefined ? {} : { colorSemantics }),
      }
    } finally {
      block.release?.()
    }
  }
}
