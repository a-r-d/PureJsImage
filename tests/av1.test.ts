import { describe, expect, it } from 'vitest'

import { inspectAv1Bitstream, parseAv1Obus, readAv1Leb128 } from '../src/codecs/av1.ts'

class BitWriter {
  readonly #bits: number[] = []

  bit(value: number | boolean): void {
    this.#bits.push(value ? 1 : 0)
  }

  bits(value: number, count: number): void {
    for (let shift = count - 1; shift >= 0; shift -= 1) this.bit((value >>> shift) & 1)
  }

  finish(): Uint8Array {
    const output = new Uint8Array(Math.ceil(this.#bits.length / 8))
    for (const [index, bit] of this.#bits.entries()) {
      const byteIndex = index >>> 3
      if (bit === 1) output[byteIndex] = (output[byteIndex] ?? 0) | (1 << (7 - (index & 7)))
    }
    return output
  }
}

const reducedSequenceHeader = (): Uint8Array => {
  const writer = new BitWriter()
  writer.bits(0, 3) // profile
  writer.bit(true) // still_picture
  writer.bit(true) // reduced_still_picture_header
  writer.bits(0, 5) // level
  writer.bits(3, 4) // frame_width_bits_minus_1
  writer.bits(3, 4) // frame_height_bits_minus_1
  writer.bits(15, 4) // max_frame_width_minus_1
  writer.bits(7, 4) // max_frame_height_minus_1
  writer.bit(false) // use_128x128_superblock
  writer.bit(true) // enable_filter_intra
  writer.bit(true) // enable_intra_edge_filter
  writer.bit(false) // enable_superres
  writer.bit(true) // enable_cdef
  writer.bit(true) // enable_restoration
  writer.bit(false) // high_bitdepth
  writer.bit(false) // monochrome
  writer.bit(false) // color_description_present
  writer.bit(true) // color_range
  writer.bits(0, 2) // chroma_sample_position
  writer.bit(false) // separate_uv_delta_q
  writer.bit(false) // film_grain_params_present
  writer.bit(true) // trailing_one_bit
  return writer.finish()
}

const sequenceObu = (): Uint8Array => {
  const sequence = reducedSequenceHeader()
  return Uint8Array.of(0x0a, sequence.byteLength, ...sequence)
}

describe('AV1 low-overhead bitstreams', () => {
  it('parses a reduced still-picture sequence header', () => {
    const inspection = inspectAv1Bitstream(sequenceObu())

    expect(inspection.obus).toHaveLength(1)
    expect(inspection.sequence).toMatchObject({
      profile: 0,
      stillPicture: true,
      reducedStillPictureHeader: true,
      maxFrameWidth: 16,
      maxFrameHeight: 8,
      bitDepth: 8,
      monochrome: false,
      chromaSubsampling: '420',
      fullRange: true,
    })
  })

  it('accepts non-canonical LEB128 and rejects values beyond 32 bits', () => {
    expect(readAv1Leb128(Uint8Array.of(0x81, 0x00), 0)).toEqual({ value: 1, bytes: 2 })
    expect(() => readAv1Leb128(Uint8Array.of(0x80, 0x80, 0x80, 0x80, 0x10), 0)).toThrow(
      /exceeds 32 bits/,
    )
  })

  it('requires explicit OBU sizes and validates reserved fields', () => {
    expect(() => parseAv1Obus(Uint8Array.of(0x08))).toThrow(/explicit size field/)
    expect(() => parseAv1Obus(Uint8Array.of(0x8a, 0x00))).toThrow(/forbidden bit/)
    expect(() => parseAv1Obus(Uint8Array.of(0x0b, 0x00))).toThrow(/reserved bit/)
    expect(() => parseAv1Obus(Uint8Array.of(0x0e))).toThrow(/extension is truncated/)
    expect(() => parseAv1Obus(Uint8Array.of(0x0e, 0x01, 0x00))).toThrow(/extension reserved bits/)
  })

  it('requires exactly one sequence header and strict trailing bits', () => {
    expect(() => inspectAv1Bitstream(Uint8Array.of(0x12, 0x00))).toThrow(
      /exactly one sequence header/,
    )
    const duplicate = sequenceObu()
    expect(() => inspectAv1Bitstream(Uint8Array.of(...duplicate, ...duplicate))).toThrow(/found 2/)
    const invalidTrailing = sequenceObu()
    invalidTrailing[invalidTrailing.length - 1] = 0
    expect(() => inspectAv1Bitstream(invalidTrailing)).toThrow(/trailing one bit/)
  })
})
