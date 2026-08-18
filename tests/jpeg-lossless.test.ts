import { describe, expect, it } from 'vitest'
import { decodeJpegLosslessFrame } from '../src/codecs/jpeg-lossless.ts'
import { encodeJpegLosslessGray } from './dicom/jpeg-lossless-encode.ts'

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
})
