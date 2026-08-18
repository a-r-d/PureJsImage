import { jpegCodec } from '../../src/codecs/jpeg.ts'
import { Uint8ArraySink } from '../../src/sink.ts'

export const encodeGrayJpeg = async (
  width: number,
  height: number,
  samples: Uint8Array,
  quality = 90,
): Promise<Uint8Array> => {
  const createEncoder = jpegCodec.createEncoder
  if (createEncoder === undefined) throw new Error('JPEG encoder is unavailable')
  const sink = new Uint8ArraySink()
  const encoder = await createEncoder(sink, {
    width,
    height,
    pixelFormat: 'gray8',
    options: { quality },
  })
  await encoder.write({
    x: 0,
    y: 0,
    width,
    height,
    stride: width,
    format: 'gray8',
    data: samples,
  })
  await encoder.finish()
  return sink.toUint8Array()
}

export const encodeRgbJpeg = async (
  width: number,
  height: number,
  rgb: Uint8Array,
  quality = 90,
): Promise<Uint8Array> => {
  const createEncoder = jpegCodec.createEncoder
  if (createEncoder === undefined) throw new Error('JPEG encoder is unavailable')
  const sink = new Uint8ArraySink()
  const encoder = await createEncoder(sink, {
    width,
    height,
    pixelFormat: 'rgb8',
    options: { quality },
  })
  await encoder.write({
    x: 0,
    y: 0,
    width,
    height,
    stride: width * 3,
    format: 'rgb8',
    data: rgb,
  })
  await encoder.finish()
  return sink.toUint8Array()
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
