import { describe, expect, it } from 'vitest'
import { sortJpegXlModularTrainingKeys } from '../src/codecs/jpegxl-modular-sort.ts'

describe('JPEG XL exact training-key order', () => {
  for (const count of [7, 257, 4096, 65536])
    it(`matches numeric order with signed features, ties and ${count} samples`, () => {
      const keys = new Float64Array(count)
      let state = 0x853c49e6
      for (let sample = 0; sample < count; sample++) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0
        const feature = sample % 7 === 0 ? 0 : sample % 7 === 1 ? -1 : state | 0
        keys[sample] = feature * count + sample
      }
      const expected = keys.slice().sort(),
        scratch = new Float64Array(count + 3),
        buckets = new Uint32Array(768)
      scratch.fill(-123)
      buckets.fill(999)
      sortJpegXlModularTrainingKeys(keys, scratch, buckets)
      expect(keys).toEqual(expected)
      expect(scratch.subarray(count)).toEqual(new Float64Array([-123, -123, -123]))
      expect(buckets.subarray(256)).toEqual(new Uint32Array(512).fill(999))
    })

  for (const count of [0, 1, 2048])
    it(`retains an ordered ${count}-key sequence without touching scratch`, () => {
      const keys = new Float64Array(count)
      for (let sample = 0; sample < count; sample++) keys[sample] = -65536 + sample
      const original = keys.slice(),
        scratch = new Float64Array(count).fill(42),
        buckets = new Uint32Array(256).fill(17)
      sortJpegXlModularTrainingKeys(keys, scratch, buckets)
      expect(keys).toEqual(original)
      expect(scratch).toEqual(new Float64Array(count).fill(42))
      expect(buckets).toEqual(new Uint32Array(256).fill(17))
    })

  it('retains duplicate keys and handles signed feature extremes', () => {
    const count = 65536,
      keys = new Float64Array([
        2147483647 * count + count - 1,
        -2147483648 * count,
        0,
        -count + 1,
        0,
        2147483647 * count,
      ]),
      expected = keys.slice().sort()
    sortJpegXlModularTrainingKeys(keys, new Float64Array(keys.length), new Uint32Array(256))
    expect(keys).toEqual(expected)
  })
})
