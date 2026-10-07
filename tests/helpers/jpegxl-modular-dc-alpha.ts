import { jpegxlCodec } from '../../src/codecs/jpegxl.ts'
import { openJpegXlSequence, openJpegXlSession } from '../../src/jpegxl.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import type { PixelBlock } from '../../src/pixel.ts'
import { MemorySource } from '../../src/source.ts'

export const verifyJpegXlModularDcAlpha = async (
  input: Uint8Array,
  reference: Uint8Array,
  width: number,
  height: number,
) => {
  if (reference.length !== width * height * 4) throw new Error('Complete RGBA reference required')
  let rows = 0,
    maximumColor = 0,
    maximumAlpha = 0
  const compare = (block: Readonly<PixelBlock>): void => {
    if (
      block.format !== 'rgba8' ||
      block.x !== 0 ||
      block.y !== rows ||
      block.width !== width ||
      rows + block.height > height
    )
      throw new Error('DC alpha output geometry differs')
    for (let y = 0; y < block.height; y++)
      for (let x = 0; x < width; x++)
        for (let channel = 0; channel < 4; channel++) {
          const value = block.data[y * block.stride + x * 4 + channel]
          const expected = reference[((rows + y) * width + x) * 4 + channel]
          if (value === undefined || expected === undefined)
            throw new Error('DC alpha sample missing')
          const error = Math.abs(value - expected)
          if (channel === 3) maximumAlpha = Math.max(maximumAlpha, error)
          else maximumColor = Math.max(maximumColor, error)
        }
    rows += block.height
  }
  const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(input), defaultImageLimits)
  if (!decoder || decoder.width !== width || decoder.height !== height)
    throw new Error('DC alpha public decoder missing')
  for await (const block of decoder.decode()) {
    try {
      compare(block)
    } finally {
      block.release?.()
    }
  }
  if (rows !== height) throw new Error('DC alpha ordinary rows missing')
  rows = 0
  const session = await openJpegXlSession(input)
  try {
    for await (const event of session.decode({ until: 'final' }))
      if (event.type === 'block') {
        try {
          compare(event.block)
        } finally {
          event.block.release?.()
        }
      }
    if (rows !== height) throw new Error('DC alpha session rows missing')
  } finally {
    await session.close()
  }
  const sequence = await openJpegXlSequence(input)
  try {
    const frame = await sequence.frame(0)
    if (frame.width !== width || frame.height !== height || frame.planes.length !== 4)
      throw new Error('DC alpha sequence geometry differs')
    for (let pixel = 0; pixel < width * height; pixel++)
      for (let channel = 0; channel < 4; channel++) {
        const value = frame.planes[channel]?.[pixel],
          expected = reference[pixel * 4 + channel]
        if (value === undefined || expected === undefined || !Number.isFinite(value))
          throw new Error('DC alpha sequence sample missing')
        const error = Math.abs(Math.max(0, Math.min(255, Math.round(value * 255))) - expected)
        if (channel === 3) maximumAlpha = Math.max(maximumAlpha, error)
        else maximumColor = Math.max(maximumColor, error)
      }
    let layers = 0
    for await (const layer of sequence.layers()) {
      if (layer.header.frameType !== 'regular') continue
      if (
        layer.planes.length !== 4 ||
        layer.layouts[3]?.width !== width ||
        layer.layouts[3]?.height !== height
      )
        throw new Error('DC alpha native layer dimensions differ')
      const alpha = layer.planes[3]
      if (!alpha || alpha.length !== width * height)
        throw new Error('DC alpha native alpha missing')
      for (let pixel = 0; pixel < alpha.length; pixel++)
        maximumAlpha = Math.max(
          maximumAlpha,
          Math.abs((alpha[pixel] ?? -1) - (reference[pixel * 4 + 3] ?? -2)),
        )
      layers++
    }
    if (layers !== 1) throw new Error('DC alpha native layer missing')
  } finally {
    await sequence.close()
  }
  if (maximumColor > 1 || maximumAlpha !== 0)
    throw new Error('DC alpha pixels differ from independent reference')
  return { maximumColor, maximumAlpha, rows }
}
