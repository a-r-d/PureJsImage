import { jpegxlCodec } from '../../src/codecs/jpegxl.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { Uint8ArraySink } from '../../src/sink.ts'
import { MemorySource } from '../../src/source.ts'

export const flatPaletteGraphic = (): Uint8Array => {
  const pixels = new Uint8Array(128 * 128 * 4)
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 128; x++) {
      const at = (y * 128 + x) * 4
      const shade = x < 4 && y < 4 ? 61 : 8 + ((x * 17 + y * 29) % 224)
      pixels[at] = shade
      pixels[at + 1] = shade + 3
      pixels[at + 2] = shade + 7
      pixels[at + 3] = 255
    }
  }
  return pixels
}

const checksum = (bytes: Uint8Array): number => {
  let value = 2166136261
  for (let index = 0; index < bytes.length; index++)
    value = Math.imul(value ^ (bytes[index] ?? 0), 16777619) >>> 0
  return value
}

export const verifyFlatPaletteGraphic = async (maxWorkingBytes: number) => {
  const pixels = flatPaletteGraphic(),
    original = pixels.slice(),
    sink = new Uint8ArraySink()
  const encoder = await jpegxlCodec.createEncoder?.(sink, {
    width: 128,
    height: 128,
    pixelFormat: 'rgba8',
    limits: defaultImageLimits,
    options: { mode: 'lossy', effort: 7, distance: 2, maxWorkingBytes },
    colorSemantics: {
      family: 'rgb',
      primaries: 'srgb',
      transfer: { kind: 'srgb' },
      matrix: 'identity',
      range: 'full',
      alpha: 'straight',
      provenance: 'container-signaled',
      renderingIntent: 'relative',
    },
  })
  if (!encoder) throw new Error('Missing JPEG XL encoder')
  await encoder.write({
    x: 0,
    y: 0,
    width: 128,
    height: 128,
    stride: 512,
    format: 'rgba8',
    data: pixels,
  })
  await encoder.finish()
  for (let sample = 0; sample < original.length; sample++)
    if (pixels[sample] !== original[sample]) throw new Error('Original graphic input changed')
  if (
    !('managedLiveBytes' in encoder) ||
    encoder.managedLiveBytes !== 0 ||
    !('managedLiveAllocations' in encoder) ||
    encoder.managedLiveAllocations !== 0
  )
    throw new Error('Managed encoder ownership remains')
  if (
    !('managedPeakBytes' in encoder) ||
    typeof encoder.managedPeakBytes !== 'number' ||
    encoder.managedPeakBytes > maxWorkingBytes
  )
    throw new Error('Managed working limit exceeded')
  const encoded = sink.toUint8Array(),
    decoder = await jpegxlCodec.createDecoder?.(new MemorySource(encoded), defaultImageLimits)
  if (
    !decoder ||
    decoder.pixelFormat !== 'rgba8' ||
    decoder.width !== 128 ||
    decoder.height !== 128
  )
    throw new Error('Missing complete RGBA decoder')
  const decoded = new Uint8Array(pixels.length),
    visited = new Uint8Array(128 * 128)
  for await (const block of decoder.decode()) {
    try {
      if (
        block.format !== 'rgba8' ||
        block.x < 0 ||
        block.y < 0 ||
        block.x + block.width > 128 ||
        block.y + block.height > 128
      )
        throw new Error('Unexpected decoded graphic block')
      for (let y = 0; y < block.height; y++) {
        const start = (block.y + y) * 128 + block.x
        for (let x = 0; x < block.width; x++) {
          if (visited[start + x] !== 0) throw new Error('Duplicate decoded graphic coverage')
          visited[start + x] = 1
        }
        decoded.set(
          block.data.subarray(y * block.stride, y * block.stride + block.width * 4),
          start * 4,
        )
      }
    } finally {
      block.release?.()
    }
  }
  for (let pixel = 0; pixel < visited.length; pixel++)
    if (visited[pixel] !== 1) throw new Error('Missing decoded graphic pixel')
  let maximumColorError = 0,
    maximumAlphaError = 0,
    preservedColorOccurrences = 0,
    changedPreservedColors = 0
  for (let at = 0; at < pixels.length; at += 4) {
    maximumAlphaError = Math.max(
      maximumAlphaError,
      Math.abs((decoded[at + 3] ?? 0) - (pixels[at + 3] ?? 0)),
    )
    if (pixels[at] === 61) {
      preservedColorOccurrences++
      if (
        decoded[at] !== pixels[at] ||
        decoded[at + 1] !== pixels[at + 1] ||
        decoded[at + 2] !== pixels[at + 2]
      )
        changedPreservedColors++
    }
    for (let channel = 0; channel < 3; channel++)
      maximumColorError = Math.max(
        maximumColorError,
        Math.abs((decoded[at + channel] ?? 0) - (pixels[at + channel] ?? 0)),
      )
  }
  return {
    bytes: encoded.length,
    encodedChecksum: checksum(encoded),
    inputChecksum: checksum(pixels),
    decodedChecksum: checksum(decoded),
    maximumColorError,
    maximumAlphaError,
    preservedColorOccurrences,
    changedPreservedColors,
    ownedPeak: encoder.managedPeakBytes,
    ownedLive: 0,
    ownedAllocations: 0,
  }
}
