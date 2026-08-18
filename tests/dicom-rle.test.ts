import { describe, expect, it } from 'vitest'
import { ImageError } from '../src/errors.ts'
import { decodeDicomRleFrame } from '../src/scientific/formats/dicom/rle.ts'
import { encodeDicomRleFrame } from './dicom/rle-encode.ts'

describe('DICOM RLE', () => {
  it('round-trips unsigned 8-bit and signed 16-bit frames', () => {
    const eight = Uint8Array.of(1, 1, 2, 3, 3, 3, 4, 5)
    expect(
      decodeDicomRleFrame(encodeDicomRleFrame(eight, 8, 4), {
        rows: 2,
        columns: 4,
        samplesPerPixel: 1,
        bitsAllocated: 8,
        frameBytes: 8,
      }),
    ).toEqual(eight)
    const sixteen = Uint8Array.of(0x00, 0x80, 0xff, 0x7f, 0x00, 0x00, 0x01, 0x00)
    expect(
      decodeDicomRleFrame(encodeDicomRleFrame(sixteen, 16, 2), {
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
    const segment = Uint8Array.of(0xff, 0x11, 0x01, 0x22, 0x33, 0x00)
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
    ).toThrow(/row boundary/)
  })

  it('rejects a first segment offset other than 64', () => {
    const encoded = new Uint8Array(66)
    encoded[0] = 1
    encoded[4] = 65
    encoded[65] = 0x00
    encoded[65] = 0xaa
    expect(() =>
      decodeDicomRleFrame(encoded, {
        rows: 1,
        columns: 1,
        samplesPerPixel: 1,
        bitsAllocated: 8,
        frameBytes: 1,
      }),
    ).toThrow(/first segment offset must equal 64/)
  })

  it('rejects PackBits runs that cross a row boundary', () => {
    const header = new Uint8Array(64)
    header[0] = 1
    header[4] = 64
    const segment = Uint8Array.of(0xfd, 0x11)
    const encoded = new Uint8Array(64 + segment.byteLength)
    encoded.set(header)
    encoded.set(segment, 64)
    expect(() =>
      decodeDicomRleFrame(encoded, {
        rows: 2,
        columns: 2,
        samplesPerPixel: 1,
        bitsAllocated: 8,
        frameBytes: 4,
      }),
    ).toThrow(/crosses a row boundary/)
  })

  it('permits odd-length segments with a single zero pad and rejects other trailing bytes', () => {
    const header = new Uint8Array(64)
    header[0] = 1
    header[4] = 64
    const validPad = Uint8Array.of(0x80, 0x00, 0xaa, 0x00)
    const valid = new Uint8Array(64 + validPad.byteLength)
    valid.set(header)
    valid.set(validPad, 64)
    expect(
      decodeDicomRleFrame(valid, {
        rows: 1,
        columns: 1,
        samplesPerPixel: 1,
        bitsAllocated: 8,
        frameBytes: 1,
      }),
    ).toEqual(Uint8Array.of(0xaa))
    const nonZero = Uint8Array.of(0x80, 0x00, 0xaa, 0x01)
    const padded = new Uint8Array(64 + nonZero.byteLength)
    padded.set(header)
    padded.set(nonZero, 64)
    expect(() =>
      decodeDicomRleFrame(padded, {
        rows: 1,
        columns: 1,
        samplesPerPixel: 1,
        bitsAllocated: 8,
        frameBytes: 1,
      }),
    ).toThrow(/padding byte must be zero/)
    const trailing = Uint8Array.of(0x00, 0xaa, 0x00, 0x00)
    const extra = new Uint8Array(64 + trailing.byteLength)
    extra.set(header)
    extra.set(trailing, 64)
    expect(() =>
      decodeDicomRleFrame(extra, {
        rows: 1,
        columns: 1,
        samplesPerPixel: 1,
        bitsAllocated: 8,
        frameBytes: 1,
      }),
    ).toThrow(/trailing bytes/)
  })

  it('requires each 16-bit RLE segment to have even physical length', () => {
    const oddSegment = Uint8Array.of(0x80, 0x00, 0xaa)
    const writeHeader = (secondOffset: number): Uint8Array => {
      const header = new Uint8Array(64)
      header[0] = 2
      header[4] = 64
      header[8] = secondOffset & 0xff
      return header
    }
    const oddCombined = new Uint8Array(70)
    oddCombined.set(writeHeader(67))
    oddCombined.set(oddSegment, 64)
    oddCombined.set(oddSegment, 67)
    expect(oddCombined.byteLength & 1).toBe(0)
    expect(() =>
      decodeDicomRleFrame(oddCombined, {
        rows: 1,
        columns: 1,
        samplesPerPixel: 1,
        bitsAllocated: 16,
        frameBytes: 2,
      }),
    ).toThrow(/segment length must be even/)
    const evenSegment = Uint8Array.of(0x80, 0x00, 0xaa, 0x00)
    const evenCombined = new Uint8Array(72)
    evenCombined.set(writeHeader(68))
    evenCombined.set(evenSegment, 64)
    evenCombined.set(evenSegment, 68)
    expect(
      decodeDicomRleFrame(evenCombined, {
        rows: 1,
        columns: 1,
        samplesPerPixel: 1,
        bitsAllocated: 16,
        frameBytes: 2,
      }),
    ).toEqual(Uint8Array.of(0xaa, 0xaa))
    const nonZeroPad = Uint8Array.of(0x80, 0x00, 0xaa, 0x01)
    const nonZero = new Uint8Array(72)
    nonZero.set(writeHeader(68))
    nonZero.set(evenSegment, 64)
    nonZero.set(nonZeroPad, 68)
    expect(() =>
      decodeDicomRleFrame(nonZero, {
        rows: 1,
        columns: 1,
        samplesPerPixel: 1,
        bitsAllocated: 16,
        frameBytes: 2,
      }),
    ).toThrow(/padding byte must be zero/)
  })
})
