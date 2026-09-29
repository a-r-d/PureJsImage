import { jpegxlCodec } from '../../src/codecs/jpegxl.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { Uint8ArraySink } from '../../src/sink.ts'
import { MemorySource } from '../../src/source.ts'

export const encodeJpegXlLocalContrast = async (progressive: boolean, distance = 3) => {
  const width = 129,
    height = 65
  const pixels = new Uint8Array(width * height * 3)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const grain = ((x * 13 + y * 7) % 17) - 8
      const i = (y * width + x) * 3
      pixels[i] = 170 + grain
      pixels[i + 1] = 100 + grain
      pixels[i + 2] = 60 + grain
    }

  const sink = new Uint8ArraySink()
  const encoder = await jpegxlCodec.createEncoder?.(sink, {
    width,
    height,
    pixelFormat: 'rgb8',
    colorSemantics: {
      family: 'rgb',
      primaries: 'srgb',
      transfer: { kind: 'srgb' },
      matrix: 'identity',
      range: 'full',
      alpha: 'none',
      provenance: 'assumed-default',
      renderingIntent: 'relative',
    },
    limits: defaultImageLimits,
    options: { mode: 'lossy', distance, effort: 7, progressive },
  })
  if (!encoder) throw new Error('Missing JPEG XL encoder')
  await encoder.write({
    x: 0,
    y: 0,
    width,
    height,
    stride: width * 3,
    format: 'rgb8',
    data: pixels,
  })
  await encoder.finish()
  return { encoded: sink.toUint8Array(), pixels, width, height }
}

export const verifyJpegXlLocalContrast = async (progressive: boolean, distance = 3) => {
  const { encoded, pixels, width } = await encodeJpegXlLocalContrast(progressive, distance)
  const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(encoded), defaultImageLimits)
  if (!decoder) throw new Error('Missing JPEG XL decoder')
  const background = Uint8Array.of(170, 100, 60)
  let error = 0,
    reference = 0,
    covariance = 0,
    samples = 0
  for await (const block of decoder.decode()) {
    for (let y = 0; y < block.height; y++)
      for (let x = 0; x < block.width; x++)
        for (let c = 0; c < 3; c++) {
          const orig = pixels[((block.y + y) * width + block.x + x) * 3 + c] ?? 0
          const actual = block.data[y * block.stride + x * 3 + c] ?? 0
          const grain = orig - (background[c] ?? 0)
          error += (actual - orig) ** 2
          reference += grain ** 2
          covariance += grain * (actual - (background[c] ?? 0))
          samples++
        }
    block.release?.()
  }
  return {
    bytes: encoded.length,
    rmse: Math.sqrt(error / samples),
    contrast: covariance / reference,
    samples,
  }
}
