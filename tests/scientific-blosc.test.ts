import { describe, expect, it } from 'vitest'

import { decodeBlosc } from '../src/scientific/formats/blosc.ts'

const fromHex = (hex: string): Uint8Array => {
  const output = new Uint8Array(hex.length / 2)
  for (let index = 0; index < output.byteLength; index += 1) {
    output[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  }
  return output
}

const byteShuffle = (input: Uint8Array, elementBytes: number): Uint8Array => {
  const elements = input.byteLength / elementBytes
  const output = new Uint8Array(input.byteLength)
  for (let byte = 0; byte < elementBytes; byte += 1) {
    for (let element = 0; element < elements; element += 1) {
      output[byte * elements + element] = input[element * elementBytes + byte] ?? 0
    }
  }
  return output
}

const bitShuffle = (input: Uint8Array, elementBytes: number): Uint8Array => {
  const elements = input.byteLength / elementBytes
  const rowBytes = elements / 8
  const output = new Uint8Array(input.byteLength)
  for (let group = 0; group < rowBytes; group += 1) {
    const inputGroup = group * 8 * elementBytes
    for (let byte = 0; byte < elementBytes; byte += 1) {
      const row = byte * 8 * rowBytes + group
      for (let bit = 0; bit < 8; bit += 1) {
        let packed = 0
        for (let element = 0; element < 8; element += 1) {
          const value = input[inputGroup + element * elementBytes + byte] ?? 0
          packed |= ((value >>> bit) & 1) << element
        }
        output[row + bit * rowBytes] = packed
      }
    }
  }
  return output
}

const rawBlosc = (
  input: Uint8Array,
  options: { readonly blockBytes: number; readonly elementBytes: number; readonly flags: number },
): Uint8Array => {
  const blockCount = Math.ceil(input.byteLength / options.blockBytes)
  const encodedBlocks: Uint8Array[] = []
  for (let block = 0; block < blockCount; block += 1) {
    const raw = input.slice(block * options.blockBytes, (block + 1) * options.blockBytes)
    encodedBlocks.push(
      (options.flags & 0x04) !== 0
        ? bitShuffle(raw, options.elementBytes)
        : (options.flags & 0x01) !== 0
          ? byteShuffle(raw, options.elementBytes)
          : raw,
    )
  }
  const tableBytes = blockCount * 4
  const totalBytes =
    16 + tableBytes + encodedBlocks.reduce((sum, block) => sum + 4 + block.length, 0)
  const output = new Uint8Array(totalBytes)
  const view = new DataView(output.buffer)
  output.set([2, 1, options.flags | 0x10, options.elementBytes])
  view.setInt32(4, input.byteLength, true)
  view.setInt32(8, options.blockBytes, true)
  view.setInt32(12, totalBytes, true)
  let cursor = 16 + tableBytes
  for (const [index, block] of encodedBlocks.entries()) {
    view.setInt32(16 + index * 4, cursor, true)
    view.setInt32(cursor, block.byteLength, true)
    cursor += 4
    output.set(block, cursor)
    cursor += block.byteLength
  }
  return output
}

describe('Blosc scientific compression', () => {
  it('decodes a zstd bitshuffle buffer produced by the numcodecs Blosc oracle', async () => {
    const encoded = fromHex(
      '02019404000100000001000041000000140000002900000028b52ffd600000fd0000400000aacc00ffffff0ba0a0f801b003f321a2235156840e0f779b6597cf0e',
    )
    const expected = Uint8Array.from({ length: 256 }, (_, index) => index % 16)

    await expect(decodeBlosc(encoded, { maxOutputBytes: 256 })).resolves.toEqual(expected)
  })

  it('rejects bitshuffle blocks that are not aligned to their element size', async () => {
    const encoded = fromHex(
      '02019404000100000001000041000000140000002900000028b52ffd600000fd0000400000aacc00ffffff0ba0a0f801b003f321a2235156840e0f779b6597cf0e',
    )
    encoded[3] = 3

    await expect(decodeBlosc(encoded, { maxOutputBytes: 256 })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
  })

  it('unshuffles each block independently across a multi-block byte-shuffle buffer', async () => {
    const expected = Uint8Array.from({ length: 64 }, (_, index) => (index * 29 + 7) & 255)
    const encoded = rawBlosc(expected, { blockBytes: 16, elementBytes: 2, flags: 0x01 })

    await expect(decodeBlosc(encoded, { maxOutputBytes: 64 })).resolves.toEqual(expected)
  })

  it('bit-unshuffles multiple aligned blocks and rejects conflicting shuffle flags', async () => {
    const expected = Uint8Array.from({ length: 64 }, (_, index) => (index * 17 + 3) & 255)
    const encoded = rawBlosc(expected, { blockBytes: 16, elementBytes: 2, flags: 0x04 })
    await expect(decodeBlosc(encoded, { maxOutputBytes: 64 })).resolves.toEqual(expected)

    encoded[2] = (encoded[2] ?? 0) | 0x01
    await expect(decodeBlosc(encoded, { maxOutputBytes: 64 })).rejects.toThrow(
      'cannot both be enabled',
    )
  })
})
