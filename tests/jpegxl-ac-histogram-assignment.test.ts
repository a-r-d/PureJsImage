import { describe, expect, it } from 'vitest'
import { assignCachedAcHistograms } from '../src/codecs/jpegxl-jpeg-encode.ts'
import {
  acAssignmentSymbolCounts,
  runAcAssignmentFixture,
} from './helpers/jpegxl-ac-histogram-assignment.ts'

describe('JPEG XL AC histogram assignment', () => {
  it.each(
    [10, 0xffffffff].flatMap((count) =>
      acAssignmentSymbolCounts.map((symbolCount) => ({ count, symbolCount })),
    ),
  )(
    'keeps closest clusters and earlier ties with $symbolCount symbols and count $count',
    ({ count, symbolCount }) => {
      let expectedCosts: Float64Array | undefined
      for (const active of [
        [0, 1, 2, 3],
        [3, 2, 1, 0],
      ]) {
        const { assignments, costs } = runAcAssignmentFixture(count, active, symbolCount)
        expect([...assignments]).toEqual([0, 1, 3, 0])
        expect(costs[3]).toBe(0)
        expect(costs.subarray(0, 3).every((value) => Number.isFinite(value) && value > 0)).toBe(
          true,
        )
        if (expectedCosts) expect(costs).toEqual(expectedCosts)
        else expectedCosts = costs.slice()
      }
    },
  )

  it('leaves assignments alone when every cluster is empty', () => {
    const assignments = Uint8Array.of(7),
      costs = new Float64Array(1)
    assignCachedAcHistograms(
      [Uint32Array.of(1)],
      [0],
      [Uint32Array.of(0)],
      [0],
      assignments,
      1,
      costs,
      new Float64Array(1),
    )
    expect(assignments[0]).toBe(7)
    expect(costs[0]).toBe(Number.POSITIVE_INFINITY)
  })

  it('still rejects a missing active histogram', () => {
    expect(() =>
      assignCachedAcHistograms(
        [],
        [0],
        [Uint32Array.of(1)],
        [1],
        new Uint8Array(1),
        1,
        new Float64Array(1),
        new Float64Array(1),
      ),
    ).toThrow('AC frequency histogram is missing')
  })
})
