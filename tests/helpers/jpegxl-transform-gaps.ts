import { jpegxlCodec } from '../../src/codecs/jpegxl.ts'
import { inspectJpegXl, openJpegXlSequence } from '../../src/jpegxl.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { MemorySource } from '../../src/source.ts'

export const verifyJpegXlTransformFixture = async (
  input: Uint8Array,
  reference: Uint8Array,
  width: number,
  height: number,
  bytesPerPixel: number,
) => {
  let maximum = 0,
    squared = 0,
    samples = 0
  let fallback = false
  for (const region of [
    { x: 0, y: 0, width, height },
    { x: 249, y: 249, width: 22, height: 10 },
    { x: 512, y: 256, width: 1, height: 3 },
  ]) {
    const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(input), defaultImageLimits)
    if (!decoder) throw new Error('Missing JPEG XL decoder')
    fallback = (decoder.execution?.fullFrameFallbackReasons.length ?? 0) > 0
    let row = 0
    for await (const block of decoder.decode(region)) {
      try {
        if (block.y !== row || block.width !== region.width)
          throw new Error('Incorrect row geometry')
        for (let y = 0; y < block.height; y++)
          for (let x = 0; x < region.width * bytesPerPixel; x++) {
            const expected =
              reference[((region.y + row + y) * width + region.x) * bytesPerPixel + x]
            const actual = block.data[y * block.stride + x]
            if (expected === undefined || actual === undefined)
              throw new Error('Missing reference sample')
            const error = Math.abs(actual - expected)
            maximum = Math.max(maximum, error)
            squared += error * error
            samples++
          }
        row += block.height
      } finally {
        block.release?.()
      }
    }
    if (row !== region.height) throw new Error('Missing output rows')
  }
  const inspection = await inspectJpegXl(input)
  if (inspection.encoding === 'vardct') {
    const result = await verifyJpegXlTransformFrame(input, reference)
    maximum = Math.max(maximum, result.maximum)
    if (result.rmse > 0.55) throw new Error('Full-plane rendering exceeds reference tolerance')
  }
  return {
    maximum,
    rmse: Math.sqrt(squared / samples),
    fallback,
    imageKind: inspection.imageKind,
    unsupportedFeatures: inspection.unsupportedFeatures,
  }
}

/** The sequence API exercises full working planes rather than restoration bands. */
export const verifyJpegXlTransformFrame = async (input: Uint8Array, reference: Uint8Array) => {
  const sequence = await openJpegXlSequence(input)
  try {
    const frame = await sequence.frame(0)
    let maximum = 0,
      squared = 0
    for (let index = 0; index < reference.length; index++) {
      const value = frame.planes[index % 3]?.[Math.floor(index / 3)]
      const expected = reference[index]
      if (value === undefined || expected === undefined) throw new Error('Missing frame sample')
      const actual = Math.round(Math.max(0, Math.min(1, value)) * 255)
      const error = Math.abs(actual - expected)
      maximum = Math.max(maximum, error)
      squared += error * error
    }
    return { maximum, rmse: Math.sqrt(squared / reference.length) }
  } finally {
    await sequence.close()
  }
}
