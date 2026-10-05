import { jpegxlCodec } from '../../src/codecs/jpegxl.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { Uint8ArraySink } from '../../src/sink.ts'
import { MemorySource } from '../../src/source.ts'

type FastFormat = 'gray8' | 'gray16' | 'rgb8' | 'rgb16' | 'rgba8' | 'rgba16'

export const roundTripFastLossless = async (
  width: number,
  height: number,
  format: FastFormat,
  input: Uint8Array,
  maxWorkingBytes?: number,
) => {
  const channels = format.startsWith('gray') ? 1 : format.startsWith('rgba') ? 4 : 3
  const sampleBytes = format.endsWith('16') ? 2 : 1
  const rowBytes = width * channels * sampleBytes
  const sink = new Uint8ArraySink()
  const encoder = await jpegxlCodec.createEncoder?.(sink, {
    width,
    height,
    pixelFormat: format,
    colorSemantics: {
      family: channels === 1 ? 'gray' : 'rgb',
      primaries: 'srgb',
      transfer: { kind: 'srgb' },
      matrix: 'identity',
      range: 'full',
      alpha: channels === 4 ? 'straight' : 'none',
      provenance: 'assumed-default',
      renderingIntent: 'relative',
    },
    options: {
      mode: 'lossless',
      effort: 1,
      ...(maxWorkingBytes === undefined ? {} : { maxWorkingBytes }),
    },
  })
  if (!encoder) throw new Error('Missing JPEG XL encoder')
  await encoder.write({ x: 0, y: 0, width, height, stride: rowBytes, format, data: input })
  await encoder.finish()
  if (
    !('managedPeakBytes' in encoder) ||
    typeof encoder.managedPeakBytes !== 'number' ||
    !('managedLiveBytes' in encoder) ||
    encoder.managedLiveBytes !== 0 ||
    !('managedLiveAllocations' in encoder) ||
    encoder.managedLiveAllocations !== 0
  )
    throw new Error('Lossless encoder did not release its owned allocations')
  const ownedPeak = encoder.managedPeakBytes
  const output = sink.toUint8Array()
  const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(output), defaultImageLimits)
  if (!decoder) throw new Error('Missing JPEG XL decoder')
  let rows = 0
  for await (const block of decoder.decode()) {
    if (block.format !== format) throw new Error('JPEG XL sample format changed')
    for (let y = 0; y < block.height; y++) {
      for (let byte = 0; byte < rowBytes; byte++) {
        if (block.data[y * block.stride + byte] !== input[(block.y + y) * rowBytes + byte])
          throw new Error(`JPEG XL sample changed at row ${block.y + y}, byte ${byte}`)
      }
      rows++
    }
    block.release?.()
  }
  if (rows !== height) throw new Error('JPEG XL output rows are incomplete')
  let checksum = 0x811c9dc5
  for (const byte of output) checksum = Math.imul(checksum ^ byte, 0x01000193) >>> 0
  return { bytes: output.length, checksum, samples: input.length, ownedPeak }
}

export const verifyRepeatedLosslessColors = async (depth: 8 | 16, maxWorkingBytes?: number) => {
  const width = 513,
    height = 65,
    sampleBytes = depth / 8
  const input = new Uint8Array(width * height * 4 * sampleBytes)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const tile = (Math.floor(x / 16) + Math.floor(y / 8)) % 7
      for (let channel = 0; channel < 4; channel++) {
        const value =
          channel === 3
            ? (x + y) % 5 === 0
              ? 0
              : depth === 8
                ? 255
                : 65535
            : depth === 8
              ? (tile * 37 + channel * 51) & 255
              : (tile * 9001 + channel * 12017) & 65535
        const at = ((y * width + x) * 4 + channel) * sampleBytes
        if (sampleBytes === 2) input[at] = value >>> 8
        input[at + sampleBytes - 1] = value
      }
    }
  const checksumInput = () => {
    let checksum = 0x811c9dc5
    for (let at = 0; at < input.length; at++)
      checksum = Math.imul(checksum ^ (input[at] ?? 0), 0x01000193) >>> 0
    return checksum
  }
  const inputChecksum = checksumInput()
  const result = await roundTripFastLossless(
    width,
    height,
    depth === 8 ? 'rgba8' : 'rgba16',
    input,
    maxWorkingBytes,
  )
  if (checksumInput() !== inputChecksum) throw new Error('Lossless encoder changed caller samples')
  return { depth, ...result, inputChecksum }
}

export const verifyFastLosslessChannels = async (depth: 8 | 16) => {
  const width = 1025,
    height = 41,
    sampleBytes = depth / 8
  const rgb = new Uint8Array(width * height * 3 * sampleBytes)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      for (let channel = 0; channel < 3; channel++) {
        const value =
          depth === 8
            ? (x + y * 3 + channel * 19) & 255
            : (x * 37 + y * 409 + channel * 1901) & 65535
        const offset = ((y * width + x) * 3 + channel) * sampleBytes
        if (sampleBytes === 2) rgb[offset] = value >>> 8
        rgb[offset + sampleBytes - 1] = value
      }
  const reference = await roundTripFastLossless(width, height, depth === 8 ? 'rgb8' : 'rgb16', rgb)
  const alphaResults = []
  for (const alpha of [0, 2 ** (depth - 1), 2 ** depth - 1]) {
    const rgba = new Uint8Array(width * height * 4 * sampleBytes)
    for (let position = 0; position < width * height; position++) {
      const offset = position * 4 * sampleBytes
      for (let byte = 0; byte < 3 * sampleBytes; byte++)
        rgba[offset + byte] = rgb[position * 3 * sampleBytes + byte] ?? 0
      if (sampleBytes === 2) rgba[offset + 3 * sampleBytes] = alpha >>> 8
      rgba[offset + 4 * sampleBytes - 1] = alpha
    }
    const result = await roundTripFastLossless(
      width,
      height,
      depth === 8 ? 'rgba8' : 'rgba16',
      rgba,
    )
    if (result.bytes > reference.bytes + 1024)
      throw new Error('Constant alpha consumed pixel-sized entropy storage')
    alphaResults.push({ alpha, ...result })
  }
  return { depth, reference, alphaResults }
}
