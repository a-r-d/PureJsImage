import { jpegxlCodec } from '../../src/codecs/jpegxl.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { MemorySource } from '../../src/source.ts'

/** Compare streamed repository rows with the already-scored independent RGB raster. */
export async function verifyM7QualityPixels(
  encoded: Uint8Array,
  expected: Uint8Array,
  width: number,
  height: number,
): Promise<{ maximum: number; rmse: number; samples: number; rows: number }> {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    !Number.isSafeInteger(width * height * 3) ||
    expected.length !== width * height * 3
  )
    throw new Error('Invalid independent RGB raster extent')
  const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(encoded), defaultImageLimits)
  if (!decoder) throw new Error('Repository decoder unavailable')
  let maximum = 0,
    squared = 0,
    samples = 0,
    nextRow = 0
  for await (const block of decoder.decode()) {
    try {
      if (
        block.format !== 'rgb8' ||
        block.x !== 0 ||
        block.y !== nextRow ||
        block.width !== width ||
        block.height < 1 ||
        nextRow + block.height > height
      )
        throw new Error('Repository RGB8 output has invalid row coverage')
      for (let y = 0; y < block.height; y++)
        for (let x = 0; x < width * 3; x++) {
          const delta = Math.abs(
            (block.data[y * block.stride + x] ?? -1000) -
              (expected[(nextRow + y) * width * 3 + x] ?? 1000),
          )
          maximum = Math.max(maximum, delta)
          squared += delta * delta
          samples++
        }
      nextRow += block.height
    } finally {
      block.release?.()
    }
  }
  if (nextRow !== height || samples !== expected.length || maximum > 2)
    throw new Error(`Repository decoder mismatch: ${maximum}, samples ${samples}`)
  return { maximum, rmse: Math.sqrt(squared / samples), samples, rows: nextRow }
}
