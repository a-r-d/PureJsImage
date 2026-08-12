import type { DecodeRequest, ImageCodec, ImageDecoder, PixelBlock } from '../src/index.ts'
import { defaultImageLimits } from '../src/index.ts'
import { MemorySource } from '../src/source.ts'

export interface DecodedFixture {
  readonly decoder: ImageDecoder
  readonly blocks: readonly PixelBlock[]
  readonly pixels: Uint8Array
}

export const decodeFixture = async (
  codec: ImageCodec,
  input: Uint8Array,
  request: DecodeRequest = {},
): Promise<DecodedFixture> => {
  if (!codec.createDecoder) throw new Error(`${codec.format} decoder is unavailable`)
  const decoder = await codec.createDecoder(new MemorySource(input), defaultImageLimits)
  const blocks: PixelBlock[] = []
  const pixels: number[] = []
  for await (const block of decoder.decode(request)) {
    blocks.push(block)
    pixels.push(...block.data.subarray(0, block.stride * block.height))
  }
  return { decoder, blocks, pixels: Uint8Array.from(pixels) }
}
