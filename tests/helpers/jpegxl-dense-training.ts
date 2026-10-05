import { jpegxlCodec } from '../../src/codecs/jpegxl.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { Uint8ArraySink } from '../../src/sink.ts'
import { MemorySource } from '../../src/source.ts'

const checksum = (data: Uint8Array): number => {
  let value = 0x811c9dc5
  for (const byte of data) value = Math.imul(value ^ byte, 0x01000193) >>> 0
  return value
}

export const verifyDenseLosslessTraining = async (maxWorkingBytes?: number) => {
  const width = 513,
    height = 257,
    pixels = new Uint8Array(width * height * 3)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      for (let channel = 0; channel < 3; channel++)
        pixels[(y * width + x) * 3 + channel] = Math.round(
          127 + 100 * Math.sin(x / (13 + channel * 7) + y / (5 + channel * 3)),
        )
  const inputChecksum = checksum(pixels)
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
    options: {
      mode: 'lossless',
      effort: 7,
      ...(maxWorkingBytes === undefined ? {} : { maxWorkingBytes }),
    },
  })
  if (!encoder) throw new Error('Missing public JPEG XL encoder')
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
  if (
    !('managedPeakBytes' in encoder) ||
    typeof encoder.managedPeakBytes !== 'number' ||
    !('managedLiveBytes' in encoder) ||
    encoder.managedLiveBytes !== 0 ||
    !('managedLiveAllocations' in encoder) ||
    encoder.managedLiveAllocations !== 0 ||
    checksum(pixels) !== inputChecksum
  )
    throw new Error('Dense training changed caller input or retained managed storage')
  if (maxWorkingBytes !== undefined && encoder.managedPeakBytes > maxWorkingBytes)
    throw new Error('Dense training exceeded the public working-memory budget')
  const encoded = sink.toUint8Array()
  const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(encoded), defaultImageLimits)
  if (
    !decoder ||
    decoder.width !== width ||
    decoder.height !== height ||
    decoder.pixelFormat !== 'rgb8'
  )
    throw new Error('Dense training changed the public sample layout')
  const coverage = new Uint8Array(width * height)
  let samples = 0
  for await (const block of decoder.decode()) {
    try {
      if (
        block.format !== 'rgb8' ||
        block.x < 0 ||
        block.y < 0 ||
        block.x + block.width > width ||
        block.y + block.height > height
      )
        throw new Error('Dense training output block is invalid')
      for (let y = 0; y < block.height; y++)
        for (let x = 0; x < block.width; x++) {
          const pixel = (block.y + y) * width + block.x + x
          if (coverage[pixel] !== 0) throw new Error('Dense training emitted a duplicate pixel')
          coverage[pixel] = 1
          for (let channel = 0; channel < 3; channel++) {
            if (block.data[y * block.stride + x * 3 + channel] !== pixels[pixel * 3 + channel])
              throw new Error('Dense training changed an original sample')
            samples++
          }
        }
    } finally {
      block.release?.()
    }
  }
  if (samples !== pixels.length || coverage.some((value) => value !== 1))
    throw new Error('Dense training output is incomplete')
  return {
    bytes: encoded.length,
    encodedChecksum: checksum(encoded),
    inputChecksum,
    samples,
    ownedPeak: encoder.managedPeakBytes,
    ownedLive: encoder.managedLiveBytes,
    ownedAllocations: encoder.managedLiveAllocations,
  }
}
