import { describe, expect, it } from 'vitest'
import { ImageError } from '../src/errors.ts'
import { decodeDicomRleFrame } from '../src/scientific/formats/dicom/rle.ts'
import { encodeDicomRleFrame } from './dicom/rle-encode.ts'

describe('DICOM RLE', () => {
  it('round-trips unsigned 8-bit and signed 16-bit frames', () => {
    const eight = Uint8Array.of(1, 1, 2, 3, 3, 3, 4, 5)
    expect(
      decodeDicomRleFrame(encodeDicomRleFrame(eight, 8), {
        rows: 2,
        columns: 4,
        samplesPerPixel: 1,
        bitsAllocated: 8,
        frameBytes: 8,
      }),
    ).toEqual(eight)
    const sixteen = Uint8Array.of(0x00, 0x80, 0xff, 0x7f, 0x00, 0x00, 0x01, 0x00)
    expect(
      decodeDicomRleFrame(encodeDicomRleFrame(sixteen, 16), {
        rows: 2,
        columns: 2,
        samplesPerPixel: 1,
        bitsAllocated: 16,
        frameBytes: 8,
      }),
    ).toEqual(sixteen)
  })

  it('decodes an explicit PackBits-style 8-bit segment', () => {
    const header = new Uint8Array(64)
    header[0] = 1
    header[4] = 64
    const segment = Uint8Array.of(0xff, 0x11, 0x01, 0x22, 0x33)
    const encoded = new Uint8Array(64 + segment.byteLength)
    encoded.set(header)
    encoded.set(segment, 64)
    expect(
      decodeDicomRleFrame(encoded, {
        rows: 2,
        columns: 2,
        samplesPerPixel: 1,
        bitsAllocated: 8,
        frameBytes: 4,
      }),
    ).toEqual(Uint8Array.of(0x11, 0x11, 0x22, 0x33))
  })

  it('rejects truncated and overflowing RLE segments', () => {
    const header = new Uint8Array(64)
    header[0] = 1
    header[4] = 64
    expect(() =>
      decodeDicomRleFrame(header, {
        rows: 1,
        columns: 2,
        samplesPerPixel: 1,
        bitsAllocated: 8,
        frameBytes: 2,
      }),
    ).toThrow(ImageError)
    const overflow = new Uint8Array(66)
    overflow.set(header)
    overflow[64] = 0xff
    overflow[65] = 0xaa
    expect(() =>
      decodeDicomRleFrame(overflow, {
        rows: 1,
        columns: 1,
        samplesPerPixel: 1,
        bitsAllocated: 8,
        frameBytes: 1,
      }),
    ).toThrow(/exceeds/)
  })
})
