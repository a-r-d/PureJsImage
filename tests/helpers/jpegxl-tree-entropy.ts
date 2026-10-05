import { JpegXlBitReader } from '../../src/codecs/jpegxl-bitstream.ts'
import { type JpegXlModularNode, readJpegXlModularTree } from '../../src/codecs/jpegxl-decode.ts'
import { JpegXlEncoderMemory } from '../../src/codecs/jpegxl-encoder-memory.ts'
import { JpegXlBitWriter, writeLearnedTree } from '../../src/codecs/jpegxl-modular-encode.ts'

export const jpegXlEntropyTree = (levels: number, wide = false): readonly JpegXlModularNode[] => {
  const count = 2 ** levels - 1,
    branches = (count - 1) / 2,
    nodes: JpegXlModularNode[] = []
  for (let index = 0; index < count; index++)
    nodes.push(
      index < branches
        ? {
            kind: 'branch',
            property: wide ? index % 4112 : 9 + (index % 7),
            split: wide
              ? index % 2
                ? -2147483648 + index
                : 2147483647 - index
              : index % 2
                ? -index * 137
                : index * 71,
            greater: index * 2 + 1,
            lessOrEqual: index * 2 + 2,
          }
        : {
            kind: 'leaf',
            predictor: index % 14,
            offset: 0,
            multiplier: 1,
            context: index - branches,
          },
    )
  return nodes
}

export const verifyJpegXlTreeEntropy = (offset: number, wide: boolean, limit: number) => {
  const nodes = jpegXlEntropyTree(9, wide),
    memory = new JpegXlEncoderMemory(limit)
  let result: { bits: number; bytes: number; peak: number; checksum: number }
  try {
    const writer = new JpegXlBitWriter(memory)
    writer.writeBits(2 ** offset - 1, offset)
    writeLearnedTree(writer, nodes)
    const treeEnd = writer.bitPosition
    writer.writeBits(0xabcde, 20)
    const encoded = writer.finish(),
      reader = new JpegXlBitReader(encoded)
    if (
      reader.readBits(offset) !== 2 ** offset - 1 ||
      JSON.stringify(readJpegXlModularTree(reader).nodes) !== JSON.stringify(nodes) ||
      reader.bitPosition !== treeEnd ||
      reader.readBits(20) !== 0xabcde
    )
      throw new Error('Tree nodes or adjacent fields changed')
    const liveBytes = memory.liveBytes,
      liveAllocations = memory.liveAllocations
    if (liveBytes !== encoded.length || liveAllocations !== 1)
      throw new Error('Temporary tree storage leaked')
    let checksum = 0x811c9dc5
    for (const byte of encoded) checksum = Math.imul(checksum ^ byte, 0x01000193) >>> 0
    result = { bits: treeEnd - offset, bytes: encoded.length, peak: memory.peakBytes, checksum }
  } finally {
    memory.close()
  }
  if (memory.liveBytes !== 0 || memory.liveAllocations !== 0)
    throw new Error('Tree storage did not close')
  return result
}
