import { PNG } from 'pngjs'
import { jpegCodec } from '../../src/codecs/jpeg.ts'
import { pngCodec } from '../../src/codecs/png.ts'
import { createNodeImageLibrary } from '../../src/node-image.ts'

const images = createNodeImageLibrary([pngCodec, jpegCodec])

export const encodeGrayJpeg = async (
  width: number,
  height: number,
  samples: Uint8Array,
  quality = 90,
): Promise<Uint8Array> => {
  const png = new PNG({ width, height })
  for (let index = 0; index < width * height; index += 1) {
    const value = samples[index] ?? 0
    png.data.set([value, value, value, 255], index * 4)
  }
  const encoded = await (await images.open(PNG.sync.write(png, { colorType: 0 })))
    .jpeg({ quality })
    .toBuffer()
  return Uint8Array.from(encoded)
}

export const stripJpegJfif = (encoded: Uint8Array): Uint8Array => {
  if (
    encoded.byteLength < 6 ||
    encoded[0] !== 0xff ||
    encoded[1] !== 0xd8 ||
    encoded[2] !== 0xff ||
    encoded[3] !== 0xe0
  ) {
    return encoded
  }
  const length = ((encoded[4] ?? 0) << 8) | (encoded[5] ?? 0)
  const skip = 2 + length
  const output = new Uint8Array(encoded.byteLength - skip)
  output.set(encoded.subarray(0, 2))
  output.set(encoded.subarray(2 + skip), 2)
  return output
}
