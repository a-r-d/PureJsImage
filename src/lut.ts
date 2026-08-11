import type { AbortOptions } from './abort.ts'
import { throwIfAborted } from './abort.ts'
import { invalidInput, unsupportedOperation } from './errors.ts'
import type { PixelBlock, PixelFormat } from './pixel.ts'

export type LutPixelFormat = 'gray8' | 'rgb8' | 'rgba8'

export interface LutOptions {
  readonly table: Uint8Array
  readonly format: LutPixelFormat
}

const channelsFor = (format: LutPixelFormat): 1 | 3 | 4 =>
  format === 'gray8' ? 1 : format === 'rgb8' ? 3 : 4

export const applyLutPixelBlocks = async function* (
  blocks: AsyncIterable<PixelBlock>,
  inputFormat: PixelFormat,
  options: Readonly<LutOptions>,
  abort: Readonly<AbortOptions> = {},
): AsyncGenerator<PixelBlock> {
  if (inputFormat !== 'gray8' && inputFormat !== 'rgba8') {
    throw unsupportedOperation(`LUT input must be gray8 or rgba8, received ${inputFormat}`)
  }
  if (inputFormat === 'rgba8' && options.format !== 'rgba8') {
    throw unsupportedOperation(`RGBA LUT output must be rgba8, received ${options.format}`)
  }
  const channels = channelsFor(options.format)
  const expectedTableBytes = 256 * channels
  if (!(options.table instanceof Uint8Array) || options.table.byteLength !== expectedTableBytes) {
    throw invalidInput(`LUT ${options.format} table must contain ${expectedTableBytes} bytes`)
  }

  for await (const block of blocks) {
    try {
      throwIfAborted(abort.signal)
      const inputChannels = inputFormat === 'gray8' ? 1 : 4
      const inputRowBytes = block.width * inputChannels
      if (
        block.format !== inputFormat ||
        block.height < 1 ||
        block.stride < inputRowBytes ||
        block.data.byteLength < block.stride * (block.height - 1) + inputRowBytes
      ) {
        throw invalidInput(`LUT received an invalid ${inputFormat} pixel block`)
      }
      const stride = block.width * channels
      const output = new Uint8Array(stride * block.height)
      for (let row = 0; row < block.height; row += 1) {
        throwIfAborted(abort.signal)
        let source = row * block.stride
        let target = row * stride
        const end = source + inputRowBytes
        if (inputFormat === 'gray8') {
          while (source < end) {
            const index = (block.data[source] ?? 0) * channels
            for (let channel = 0; channel < channels; channel += 1) {
              output[target + channel] = options.table[index + channel] ?? 0
            }
            source += 1
            target += channels
          }
        } else {
          while (source < end) {
            output[target] = options.table[(block.data[source] ?? 0) * 4] ?? 0
            output[target + 1] = options.table[(block.data[source + 1] ?? 0) * 4 + 1] ?? 0
            output[target + 2] = options.table[(block.data[source + 2] ?? 0) * 4 + 2] ?? 0
            output[target + 3] = options.table[(block.data[source + 3] ?? 0) * 4 + 3] ?? 0
            source += 4
            target += 4
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
        data: output,
      }
    } finally {
      block.release?.()
    }
  }
}
