import { readFile } from 'node:fs/promises'
import * as Lerc from 'lerc'
import { beforeAll, describe, expect, it } from 'vitest'

import { decodeLerc2, type LercDataType } from '../src/codecs/tiff-lerc.ts'

const fixture = async (name: string): Promise<Uint8Array> =>
  new Uint8Array(await readFile(`tests/fixtures/${name}`))

const decodedValues = (data: Uint8Array, dataType: LercDataType): readonly number[] => {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const bytes = dataType <= 1 ? 1 : dataType <= 3 ? 2 : dataType <= 6 ? 4 : 8
  const values: number[] = []
  for (let offset = 0; offset < data.byteLength; offset += bytes) {
    if (dataType === 0) values.push(view.getInt8(offset))
    else if (dataType === 1) values.push(view.getUint8(offset))
    else if (dataType === 2) values.push(view.getInt16(offset, true))
    else if (dataType === 3) values.push(view.getUint16(offset, true))
    else if (dataType === 4) values.push(view.getInt32(offset, true))
    else if (dataType === 5) values.push(view.getUint32(offset, true))
    else if (dataType === 6) values.push(view.getFloat32(offset, true))
    else values.push(view.getFloat64(offset, true))
  }
  return values
}

describe('first-party LERC2 decoder', () => {
  beforeAll(async () => {
    await Lerc.load()
  })

  for (const name of ['bluemarble_256_256_3_byte.lerc2', 'california_400_400_1_float.lerc2']) {
    it(`matches the independent Esri decoder for ${name}`, async () => {
      const input = await fixture(name)
      const expected = Lerc.decode(input)
      const actual = decodeLerc2(input)
      const expectedDepth = expected.depthCount * expected.pixels.length
      const expectedValues: number[] = []
      for (let pixel = 0; pixel < expected.width * expected.height; pixel += 1) {
        for (const band of expected.pixels) {
          for (let depth = 0; depth < expected.depthCount; depth += 1) {
            expectedValues.push(band[pixel * expected.depthCount + depth] ?? 0)
          }
        }
      }
      expect({
        width: actual.width,
        height: actual.height,
        depth: actual.depth,
        mask: actual.mask,
      }).toEqual({
        width: expected.width,
        height: expected.height,
        depth: expectedDepth,
        mask: expected.mask ?? new Uint8Array(expected.width * expected.height).fill(1),
      })
      expect(decodedValues(actual.data, actual.dataType)).toEqual(expectedValues)
    })
  }

  it('rejects a corrupted checksummed blob without allocating from hostile dimensions', async () => {
    const input = await fixture('california_400_400_1_float.lerc2')
    const corrupt = Uint8Array.from(input)
    expect(() => decodeLerc2(input.subarray(0, input.byteLength - 1))).toThrowError(
      expect.objectContaining({ code: 'TRUNCATED_INPUT' }),
    )
    corrupt[corrupt.byteLength - 1] = (corrupt[corrupt.byteLength - 1] ?? 0) ^ 0xff
    expect(() => decodeLerc2(corrupt)).toThrowError(
      expect.objectContaining({ code: 'INVALID_INPUT' }),
    )

    const hostile = Uint8Array.from(input)
    new DataView(hostile.buffer).setInt32(14, 0x7fff_ffff, true)
    expect(() => decodeLerc2(hostile)).toThrowError(
      expect.objectContaining({ code: 'LIMIT_EXCEEDED' }),
    )
  })
})
