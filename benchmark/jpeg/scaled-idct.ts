import type { DecodeRequest } from '../../src/codec.ts'
import { jpegCodec } from '../../src/codecs/jpeg.ts'
import { selectDecodeScaleDenominator } from '../../src/executor.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import type { PixelBlock } from '../../src/pixel.ts'
import { calculateResizeDimensions } from '../../src/pipeline.ts'
import { createResizeTransform } from '../../src/resize.ts'
import { MemorySource } from '../../src/source.ts'

export type ScaledIdctMode = 'full' | 'scaled'

export interface ScaledIdctExecution {
  readonly data: Uint8Array
  readonly decodedHeight: number
  readonly decodedPixels: number
  readonly decodedWidth: number
  readonly height: number
  readonly scaleDenominator: 1 | 2 | 4 | 8
  readonly sourceHeight: number
  readonly sourcePixels: number
  readonly sourceWidth: number
  readonly width: number
}

const collectRgb = async (
  blocks: AsyncIterable<PixelBlock>,
  width: number,
  height: number,
): Promise<Uint8Array> => {
  const output = new Uint8Array(width * height * 3)
  let rows = 0
  for await (const block of blocks) {
    if (block.format !== 'rgb8' || block.x !== 0 || block.width !== width) {
      throw new Error('Scaled-IDCT benchmark received an unexpected pixel block')
    }
    for (let row = 0; row < block.height; row += 1) {
      const source = row * block.stride
      const target = (block.y + row) * width * 3
      output.set(block.data.subarray(source, source + width * 3), target)
    }
    rows += block.height
    block.release?.()
  }
  if (rows !== height) throw new Error(`Scaled-IDCT benchmark produced ${rows} of ${height} rows`)
  return output
}

export const executeScaledIdctResize = async (
  input: Uint8Array,
  targetWidth: number,
  mode: ScaledIdctMode,
): Promise<ScaledIdctExecution> => {
  const decoder = await jpegCodec.createDecoder?.(new MemorySource(input), defaultImageLimits)
  if (!decoder) throw new Error('JPEG decoder is unavailable')
  const resizeOperation = { type: 'resize', width: targetWidth } as const
  const sourceWidth = decoder.width
  const sourceHeight = decoder.height
  const target = calculateResizeDimensions(sourceWidth, sourceHeight, resizeOperation)
  const scaleDenominator =
    mode === 'scaled'
      ? selectDecodeScaleDenominator(
          sourceWidth,
          sourceHeight,
          { x: 0, y: 0, width: sourceWidth, height: sourceHeight },
          [resizeOperation],
          decoder.capabilities.scaledDecode,
        )
      : 1
  const decodedWidth = Math.ceil(sourceWidth / scaleDenominator)
  const decodedHeight = Math.ceil(sourceHeight / scaleDenominator)
  const request: DecodeRequest =
    scaleDenominator === 1
      ? { x: 0, y: 0, width: sourceWidth, height: sourceHeight }
      : {
          x: 0,
          y: 0,
          width: decodedWidth,
          height: decodedHeight,
          scaleDenominator,
        }
  const resize = createResizeTransform(
    decodedWidth,
    decodedHeight,
    decoder.pixelFormat,
    resizeOperation,
  )
  if (resize.width !== target.width || resize.height !== target.height) {
    throw new Error(
      `Scaled-IDCT resize planned ${resize.width}x${resize.height}, expected ${target.width}x${target.height}`,
    )
  }
  const data = await collectRgb(resize.apply(decoder.decode(request)), resize.width, resize.height)
  return {
    data,
    decodedHeight,
    decodedPixels: decodedWidth * decodedHeight,
    decodedWidth,
    height: resize.height,
    scaleDenominator,
    sourceHeight,
    sourcePixels: sourceWidth * sourceHeight,
    sourceWidth,
    width: resize.width,
  }
}
