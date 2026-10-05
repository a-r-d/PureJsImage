import { describe, expect, it } from 'vitest'
import { JpegXlBitReader } from '../src/codecs/jpegxl-bitstream.ts'
import { type JpegXlModularNode, readJpegXlModularTree } from '../src/codecs/jpegxl-decode.ts'
import { JpegXlEncoderMemory } from '../src/codecs/jpegxl-encoder-memory.ts'
import { JpegXlBitWriter, writeLearnedTree } from '../src/codecs/jpegxl-modular-encode.ts'

import { jpegXlEntropyTree as tree } from './helpers/jpegxl-tree-entropy.ts'

const roundTrip = (nodes: readonly JpegXlModularNode[], offset: number, limit = 1048576) => {
  const memory = new JpegXlEncoderMemory(limit)
  try {
    const writer = new JpegXlBitWriter(memory)
    writer.writeBits(2 ** offset - 1, offset)
    writeLearnedTree(writer, nodes)
    const treeEnd = writer.bitPosition
    writer.writeBits(0xabcde, 20)
    const encoded = writer.finish(),
      reader = new JpegXlBitReader(encoded)
    expect(reader.readBits(offset)).toBe(2 ** offset - 1)
    expect(readJpegXlModularTree(reader).nodes).toEqual(nodes)
    expect(reader.bitPosition).toBe(treeEnd)
    expect(reader.readBits(20)).toBe(0xabcde)
    expect(memory.liveBytes).toBe(encoded.length)
    expect(memory.liveAllocations).toBe(1)
    return { bits: treeEnd - offset, bytes: encoded.length, peak: memory.peakBytes }
  } finally {
    memory.close()
    expect(memory.liveBytes).toBe(0)
    expect(memory.liveAllocations).toBe(0)
  }
}

describe('JPEG XL learned-tree entropy', () => {
  it.each([0, 1, 2, 3, 4, 5, 6, 7])(
    'preserves signed thresholds and adjacent fields at offset %i',
    (offset) => {
      const result = roundTrip(tree(9), offset)
      // Independently verified old prefix costs 9,612 bits for these same nodes.
      expect(result.bits).toBe(6783)
      expect(result.bits).toBeLessThan(9612)
    },
  )

  it.each([0, 1, 2, 3, 4, 5, 6, 7])('retains full int32 thresholds at offset %i', (offset) => {
    // Their ANS extra bits exceed packed uint32 capacity; exact prefix stays eligible.
    expect(roundTrip(tree(9, true), offset).bits).toBe(14966)
  })

  it('retains the exact prefix stream at the original working budget', () => {
    const result = roundTrip(tree(9), 7, 5915)
    expect(result).toEqual({ bits: 9612, bytes: 1205, peak: 5915 })
  })

  it('keeps tiny trees on the prior prefix policy', () => {
    expect(roundTrip(tree(1), 0).bits).toBe(18)
  })

  it.each([0.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid thresholds before appending bits: %s',
    (split) => {
      const memory = new JpegXlEncoderMemory(1048576),
        writer = new JpegXlBitWriter(memory),
        nodes = [...tree(9)],
        first = nodes[0]
      if (!first || first.kind !== 'branch') throw new Error('Missing regression branch')
      nodes[0] = { ...first, split }
      writer.writeBits(93, 7)
      try {
        expect(() => writeLearnedTree(writer, nodes)).toThrow(/must be integers/)
        expect(writer.bitPosition).toBe(7)
        expect(memory.liveBytes).toBe(256)
        expect(memory.liveAllocations).toBe(1)
      } finally {
        memory.close()
        expect(memory.liveBytes).toBe(0)
      }
    },
  )
})
