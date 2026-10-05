import { jpegxlCodec } from '../../src/codecs/jpegxl.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { Uint8ArraySink } from '../../src/sink.ts'
import { MemorySource } from '../../src/source.ts'

const checksum = (bytes: Uint8Array): number => {
  let value = 0x811c9dc5
  for (let index = 0; index < bytes.length; index++)
    value = Math.imul(value ^ (bytes[index] ?? 0), 0x01000193) >>> 0
  return value
}

/** Exercise both sides of the optional 512-pixel group boundary, including hidden RGB. */
export const verifyGroupedLosslessSearch = async (
  width: 512 | 513,
  effort: 1 | 7,
  maxWorkingBytes?: number,
) => {
  const height = 512,
    pixels = new Uint8Array(width * height * 4)
  let random = 0x12345678
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0
      const base = (x * 3 + y * 5 + (random >>> 27)) & 255
      const offset = (y * width + x) * 4
      pixels[offset] = base
      pixels[offset + 1] = (base + (x >>> 5)) & 255
      pixels[offset + 2] = (base + (y >>> 5)) & 255
      pixels[offset + 3] = x % 17 === 0 ? 0 : (x + y) & 255
    }
  const inputChecksum = checksum(pixels)
  const sink = new Uint8ArraySink()
  const encoder = await jpegxlCodec.createEncoder?.(sink, {
    width,
    height,
    pixelFormat: 'rgba8',
    limits: defaultImageLimits,
    colorSemantics: {
      family: 'rgb',
      primaries: 'srgb',
      transfer: { kind: 'srgb' },
      matrix: 'identity',
      range: 'full',
      alpha: 'straight',
      provenance: 'assumed-default',
      renderingIntent: 'relative',
    },
    options: {
      mode: 'lossless',
      effort,
      ...(maxWorkingBytes === undefined ? {} : { maxWorkingBytes }),
    },
  })
  if (!encoder) throw new Error('Missing JPEG XL encoder')
  await encoder.write({
    x: 0,
    y: 0,
    width,
    height,
    stride: width * 4,
    format: 'rgba8',
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
    throw new Error('Grouped lossless search changed caller samples or retained owned storage')
  if (maxWorkingBytes !== undefined && encoder.managedPeakBytes > maxWorkingBytes)
    throw new Error('Grouped lossless search exceeded the public working budget')
  const encoded = sink.toUint8Array()
  const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(encoded), defaultImageLimits)
  if (
    !decoder ||
    decoder.width !== width ||
    decoder.height !== height ||
    decoder.pixelFormat !== 'rgba8'
  )
    throw new Error('Grouped lossless search changed the sample layout')
  const coverage = new Uint8Array(width * height)
  let samples = 0
  for await (const block of decoder.decode()) {
    try {
      if (
        block.format !== 'rgba8' ||
        block.x < 0 ||
        block.y < 0 ||
        block.x + block.width > width ||
        block.y + block.height > height
      )
        throw new Error('Grouped lossless output block is invalid')
      for (let y = 0; y < block.height; y++)
        for (let x = 0; x < block.width; x++) {
          const pixel = (block.y + y) * width + block.x + x
          if (coverage[pixel] !== 0)
            throw new Error('Grouped lossless search emitted duplicate pixels')
          coverage[pixel] = 1
          for (let channel = 0; channel < 4; channel++) {
            if (block.data[y * block.stride + x * 4 + channel] !== pixels[pixel * 4 + channel])
              throw new Error('Grouped lossless search changed an original sample')
            samples++
          }
        }
    } finally {
      block.release?.()
    }
  }
  if (samples !== pixels.length || coverage.some((value) => value !== 1))
    throw new Error('Grouped lossless output is incomplete')
  return {
    width,
    effort,
    bytes: encoded.length,
    encodedChecksum: checksum(encoded),
    inputChecksum,
    samples,
    ownedPeak: encoder.managedPeakBytes,
    ownedLive: 0,
    ownedAllocations: 0,
  }
}
