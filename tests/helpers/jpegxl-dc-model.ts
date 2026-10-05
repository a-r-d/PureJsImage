import { jpegxlCodec } from '../../src/codecs/jpegxl.ts'
import { JpegXlEncoderMemory } from '../../src/codecs/jpegxl-encoder-memory.ts'
import {
  encodeJpegXlVarDct8,
  encodeJpegXlVarDct8Async,
} from '../../src/codecs/jpegxl-vardct-encode.ts'
import { limitExceeded } from '../../src/errors.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { Uint8ArraySink } from '../../src/sink.ts'
import { MemorySource } from '../../src/source.ts'

const width = 513
const height = 257

const checksum = (data: Uint8Array): number => {
  let value = 2166136261
  for (let at = 0; at < data.length; at++)
    value = Math.imul(value ^ (data[at] ?? 0), 16777619) >>> 0
  return value
}

export const jpegXlDcModelPixels = (): Uint8Array => {
  const pixels = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4
      const grain = (Math.imul(x + 1, 1597334677) ^ Math.imul(y + 1, 3812015801)) >>> 0
      pixels[at] = Math.round(100 + (75 * x) / width + 22 * Math.sin(y / 19)) + (grain % 9) - 4
      pixels[at + 1] =
        Math.round(65 + (85 * y) / height + 18 * Math.sin((x + y) / 31)) + ((grain >>> 8) % 9) - 4
      pixels[at + 2] =
        Math.round(115 + (42 * x) / width + (40 * y) / height + 16 * Math.cos(x / 23)) +
        ((grain >>> 16) % 9) -
        4
      pixels[at + 3] = 255
    }
  }
  return pixels
}

const verifyDecodedGradient = async (encoded: Uint8Array, original: Uint8Array) => {
  const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(encoded), defaultImageLimits)
  if (decoder?.pixelFormat !== 'rgba8' || decoder.width !== width || decoder.height !== height)
    throw new Error('Missing complete RGBA decoder')
  const decoded = new Uint8Array(original.length)
  const visited = new Uint8Array(width * height)
  for await (const block of decoder.decode()) {
    try {
      if (
        block.format !== 'rgba8' ||
        block.x < 0 ||
        block.y < 0 ||
        block.x + block.width > width ||
        block.y + block.height > height
      )
        throw new Error('Unexpected decoded gradient block')
      for (let y = 0; y < block.height; y++) {
        const start = (block.y + y) * width + block.x
        for (let x = 0; x < block.width; x++) {
          if (visited[start + x] !== 0) throw new Error('Duplicate decoded gradient coverage')
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
  let alphaError = 0
  for (let pixel = 0; pixel < visited.length; pixel++) {
    if (visited[pixel] !== 1) throw new Error('Missing decoded gradient pixel')
    const at = pixel * 4 + 3
    alphaError = Math.max(alphaError, Math.abs((decoded[at] ?? 0) - (original[at] ?? 0)))
  }
  return {
    bytes: encoded.length,
    encodedChecksum: checksum(encoded),
    decodedChecksum: checksum(decoded),
    samples: decoded.length,
    alphaError,
  }
}

export const verifyJpegXlDcModel = async (maxWorkingBytes = 16_777_216) => {
  const pixels = jpegXlDcModelPixels()
  const original = pixels.slice()
  const sink = new Uint8ArraySink()
  const encoder = await jpegxlCodec.createEncoder?.(sink, {
    width,
    height,
    pixelFormat: 'rgba8',
    limits: defaultImageLimits,
    options: { mode: 'lossy', effort: 7, distance: 4, maxWorkingBytes },
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
    width,
    height,
    stride: width * 4,
    format: 'rgba8',
    data: pixels,
  })
  await encoder.finish()
  for (let sample = 0; sample < original.length; sample++)
    if (pixels[sample] !== original[sample]) throw new Error('Original gradient input changed')
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
  return {
    ...(await verifyDecodedGradient(sink.toUint8Array(), original)),
    inputChecksum: checksum(pixels),
    ownedPeak: encoder.managedPeakBytes,
    ownedLive: encoder.managedLiveBytes,
    ownedAllocations: encoder.managedLiveAllocations,
  }
}

type Owned = ReturnType<JpegXlEncoderMemory['allocate']>
class RejectOptionalDcFeatures extends JpegXlEncoderMemory {
  rejectedAllocations = 0

  override allocate<T extends Owned>(
    arrayType: { new (length: number): T; readonly BYTES_PER_ELEMENT: number },
    length: number,
    scope = this.currentScope,
  ): T {
    // Fail the compact DC feature table while leaving the original writer available.
    if (
      Object.is(arrayType, Int32Array) &&
      length === Math.ceil(width / 8) * Math.ceil(height / 8) * 6
    ) {
      this.rejectedAllocations++
      throw limitExceeded('Deliberate optional DC allocation failure')
    }
    return super.allocate(arrayType, length, scope)
  }
}

export const verifyJpegXlDcAllocationRecovery = async (asynchronous: boolean) => {
  const pixels = jpegXlDcModelPixels()
  const original = pixels.slice()
  const memory = new RejectOptionalDcFeatures(16_777_216)
  const sink = new Uint8ArraySink()
  let checkpoints = 0
  try {
    const parts = asynchronous
      ? await encodeJpegXlVarDct8Async(
          pixels,
          width,
          height,
          4,
          memory,
          async () => {
            checkpoints++
          },
          4,
          7,
        )
      : encodeJpegXlVarDct8(pixels, width, height, 4, memory, 4, 7)
    if (memory.liveBytes !== parts.reduce((sum, part) => sum + part.byteLength, 0))
      throw new Error('Optional DC search scratch remains')
    for (const part of parts) await sink.write(part)
  } finally {
    memory.close()
  }
  for (let sample = 0; sample < original.length; sample++)
    if (pixels[sample] !== original[sample]) throw new Error('Original gradient input changed')
  if (memory.rejectedAllocations === 0 || (asynchronous && checkpoints === 0))
    throw new Error('Required optional allocation failure or cooperative checkpoint missing')
  return {
    ...(await verifyDecodedGradient(sink.toUint8Array(), original)),
    inputChecksum: checksum(pixels),
    rejectedAllocations: memory.rejectedAllocations,
    checkpoints,
    ownedPeak: memory.peakBytes,
    ownedLive: memory.liveBytes,
    ownedAllocations: memory.liveAllocations,
  }
}
