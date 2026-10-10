import { jpegCodec } from '../../src/codecs/jpeg.ts'
import { decodeBaselineJpeg, parseBaselineJpeg } from '../../src/codecs/jpeg-baseline.ts'
import { ImageError } from '../../src/errors.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import type { PixelBlock } from '../../src/pixel.ts'
import { Uint8ArraySink } from '../../src/sink.ts'
import { MemorySource } from '../../src/source.ts'

export async function createTerminalRestartFixture(restartInterval = 1): Promise<Uint8Array> {
  const data = new Uint8Array(32 * 32 * 3)
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++) {
      const offset = (y * 32 + x) * 3
      data[offset] = x * 7
      data[offset + 1] = y * 7
      data[offset + 2] = (x + y) * 3
    }
  const sink = new Uint8ArraySink()
  const encoder = await jpegCodec.createEncoder?.(sink, {
    width: 32,
    height: 32,
    pixelFormat: 'rgb8',
    options: { quality: 92, chromaSubsampling: '420', restartInterval },
  })
  if (!encoder) throw new Error('JPEG encoder missing')
  await encoder.write({ x: 0, y: 0, width: 32, height: 32, stride: 96, format: 'rgb8', data })
  await encoder.finish()
  return sink.toUint8Array()
}

export function withJpegTerminalSuffix(input: Uint8Array, suffix: readonly number[]): Uint8Array {
  if (input[input.length - 2] !== 0xff || input[input.length - 1] !== 0xd9)
    throw new Error('Fixture EOI missing')
  const output = new Uint8Array(input.length - 2 + suffix.length)
  output.set(input.subarray(0, -2))
  output.set(suffix, input.length - 2)
  return output
}

async function collect(blocks: AsyncIterable<PixelBlock>): Promise<Uint8Array> {
  const pixels = new Uint8Array(32 * 32 * 3)
  for await (const block of blocks) {
    if (block.format !== 'rgb8') throw new Error('Unexpected JPEG pixels')
    for (let y = 0; y < block.height; y++)
      pixels.set(
        block.data.subarray(y * block.stride, y * block.stride + block.width * 3),
        ((block.y + y) * 32 + block.x) * 3,
      )
    block.release?.()
  }
  return pixels
}

export async function decodeTerminalFixture(
  input: Uint8Array,
  buffered: boolean,
): Promise<Uint8Array> {
  if (buffered) {
    const jpeg = parseBaselineJpeg(input)
    if (!jpeg) throw new Error('Expected baseline JPEG')
    return collect(decodeBaselineJpeg(jpeg, { x: 0, y: 0, width: 32, height: 32 }))
  }
  const decoder = await jpegCodec.createDecoder?.(new MemorySource(input), defaultImageLimits, {
    tolerantDecoding: false,
  })
  if (!decoder) throw new Error('JPEG decoder missing')
  return collect(decoder.decode())
}

export async function verifyJpegTerminalRestart(): Promise<{ checks: number; checksum: number }> {
  let checks = 0,
    checksum = 0
  for (const interval of [1, 2, 4]) {
    const original = await createTerminalRestartFixture(interval)
    const marker = 0xd0 + Math.floor(3 / interval)
    const expected = await decodeTerminalFixture(original, false)
    for (const suffix of [
      [0xff, marker, 0xff, 0xd9],
      [0xff, 0xff, marker, 0xff, 0xff, 0xd9],
    ]) {
      for (const buffered of [false, true]) {
        const actual = await decodeTerminalFixture(
          withJpegTerminalSuffix(original, suffix),
          buffered,
        )
        if (actual.some((value, index) => value !== expected[index]))
          throw new Error('Terminal restart changed pixels')
        checks++
      }
    }
    for (const value of expected) checksum = (Math.imul(checksum, 31) + value) >>> 0
  }
  const original = await createTerminalRestartFixture()
  const invalid = [
    [0xff, 0xd2, 0xff, 0xd9],
    [0xff, 0xd3, 0xff, 0xd3, 0xff, 0xd9],
    [0xff, 0xd3, 0x12, 0xff, 0xd9],
    [0xff, 0xd3, 0xff, 0, 0xff, 0xd9],
    [0xff, 0xd3, 0xff, 0xda],
    [0xff, 0xd3],
  ]
  for (const suffix of invalid)
    for (const buffered of [false, true]) {
      let rejected = false
      try {
        await decodeTerminalFixture(withJpegTerminalSuffix(original, suffix), buffered)
      } catch (error) {
        if (
          !(error instanceof ImageError) ||
          (error.code !== 'INVALID_INPUT' && error.code !== 'TRUNCATED_INPUT')
        )
          throw error
        rejected = true
      }
      if (!rejected) throw new Error('Malformed terminal restart accepted')
      checks++
    }
  for (const interval of [0, 3, 5]) {
    const input = await createTerminalRestartFixture(interval)
    for (const buffered of [false, true]) {
      let rejected = false
      try {
        await decodeTerminalFixture(
          withJpegTerminalSuffix(input, [0xff, 0xd0, 0xff, 0xd9]),
          buffered,
        )
      } catch (error) {
        if (!(error instanceof ImageError) || error.code !== 'INVALID_INPUT') throw error
        rejected = true
      }
      if (!rejected) throw new Error('Terminal restart outside completed interval accepted')
      checks++
    }
  }
  return { checks, checksum }
}
