import { describe, expect, it } from 'vitest'
import { decodeJpegLosslessFrame } from '../src/codecs/jpeg-lossless.ts'
import { inspectJpegCodestream } from '../src/codecs/jpeg.ts'
import { ImageError } from '../src/errors.ts'
import { encodeJpegLosslessGray } from './dicom/jpeg-lossless-encode.ts'

const hugeSof3 = (): Uint8Array =>
  Uint8Array.of(
    0xff,
    0xd8,
    0xff,
    0xc3,
    0x00,
    0x0b,
    8,
    0xff,
    0xff,
    0xff,
    0xff,
    1,
    1,
    0x11,
    0,
    0xff,
    0xd9,
  )

const insertFillBeforeMarker = (
  data: Uint8Array,
  marker: number,
  fillCount: number,
): Uint8Array => {
  for (let index = 0; index + 1 < data.byteLength; index += 1) {
    if (data[index] !== 0xff || data[index + 1] !== marker) continue
    const output = new Uint8Array(data.byteLength + fillCount)
    output.set(data.subarray(0, index))
    output.fill(0xff, index, index + fillCount)
    output.set(data.subarray(index), index + fillCount)
    return output
  }
  throw new Error(`JPEG marker 0x${marker.toString(16)} is missing`)
}

describe('JPEG lossless Huffman', () => {
  it('round-trips 8-bit SV1 gray samples', () => {
    const samples = [10, 20, 30, 40, 80, 90, 100, 110]
    const encoded = encodeJpegLosslessGray(4, 2, samples)
    const decoded = decodeJpegLosslessFrame(encoded, { requiredSelection: 1 })
    expect(decoded).toMatchObject({ width: 4, height: 2, precision: 8, selection: 1 })
    expect([...decoded.samplesLittleEndian]).toEqual(samples)
  })

  it('round-trips 16-bit SV1 gray samples including wraparound neighbors', () => {
    const samples = [0, 65535, 1, 32768]
    const encoded = encodeJpegLosslessGray(2, 2, samples, { precision: 16 })
    const decoded = decodeJpegLosslessFrame(encoded, { requiredSelection: 1 })
    expect(decoded.precision).toBe(16)
    const values: number[] = []
    for (let index = 0; index < decoded.samplesLittleEndian.byteLength; index += 2) {
      values.push(
        (decoded.samplesLittleEndian[index] ?? 0) |
          ((decoded.samplesLittleEndian[index + 1] ?? 0) << 8),
      )
    }
    expect(values).toEqual(samples)
  })

  it('rejects a required SV1 scan that uses another predictor', () => {
    const encoded = encodeJpegLosslessGray(2, 1, [8, 9], { selection: 2 })
    expect(() => decodeJpegLosslessFrame(encoded, { requiredSelection: 1 })).toThrow(
      /selection value 2/,
    )
  })

  it('decodes restart intervals after the row-buffer refactor', () => {
    const samples = [10, 20, 30, 40, 80, 90, 100, 110]
    const encoded = encodeJpegLosslessGray(4, 2, samples, { restartInterval: 3 })
    const decoded = decodeJpegLosslessFrame(encoded, { requiredSelection: 1 })
    expect([...decoded.samplesLittleEndian]).toEqual(samples)
  })

  it('validates SOF3 dimensions before allocating working buffers', () => {
    let sawHeader = false
    expect(() =>
      decodeJpegLosslessFrame(hugeSof3(), {
        limits: { expectedWidth: 2, expectedHeight: 2 },
        onFrameHeader: () => {
          sawHeader = true
        },
      }),
    ).toThrow(ImageError)
    expect(sawHeader).toBe(false)
    try {
      decodeJpegLosslessFrame(hugeSof3(), { limits: { expectedWidth: 2, expectedHeight: 2 } })
      throw new Error('expected dimension mismatch')
    } catch (error) {
      expect(error).toBeInstanceOf(ImageError)
      expect(error).toMatchObject({
        code: 'INVALID_INPUT',
        message: expect.stringMatching(/does not match expected width/),
      })
    }
    expect(() =>
      decodeJpegLosslessFrame(hugeSof3(), { limits: { maxWidth: 10, maxHeight: 10 } }),
    ).toThrow(/exceeds maxWidth/)
    expect(() => decodeJpegLosslessFrame(hugeSof3(), { limits: { maxDecodedBytes: 1 } })).toThrow(
      /working set/,
    )
    const encoded = encodeJpegLosslessGray(2, 2, [1, 2, 3, 4])
    expect(() => decodeJpegLosslessFrame(encoded, { limits: { maxEncodedBytes: 4 } })).toThrow(
      /maxEncodedBytes/,
    )
  })

  it('treats repeated FF bytes as fill before EOI and restart markers', () => {
    const samples = [10, 20, 30, 40, 80, 90, 100, 110]
    const encoded = encodeJpegLosslessGray(4, 2, samples)
    const ordinary = inspectJpegCodestream(encoded)
    expect(ordinary.sofMarker).toBe(0xc3)
    expect(ordinary.trailingByteCount).toBe(0)
    const oneFill = insertFillBeforeMarker(encoded, 0xd9, 1)
    const severalFill = insertFillBeforeMarker(encoded, 0xd9, 4)
    expect(inspectJpegCodestream(oneFill).eoiOffset).toBe(ordinary.eoiOffset + 1)
    expect(inspectJpegCodestream(severalFill).eoiOffset).toBe(ordinary.eoiOffset + 4)
    expect([
      ...decodeJpegLosslessFrame(oneFill, { requiredSelection: 1 }).samplesLittleEndian,
    ]).toEqual(samples)
    const restart = encodeJpegLosslessGray(4, 2, samples, { restartInterval: 3 })
    const restartFilled = insertFillBeforeMarker(restart, 0xd0, 3)
    expect([
      ...decodeJpegLosslessFrame(restart, { requiredSelection: 1 }).samplesLittleEndian,
    ]).toEqual(samples)
    expect([
      ...decodeJpegLosslessFrame(restartFilled, { requiredSelection: 1 }).samplesLittleEndian,
    ]).toEqual(samples)
    expect(inspectJpegCodestream(restartFilled).sofMarker).toBe(0xc3)
  })
})
