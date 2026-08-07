import { describe, expect, it } from 'vitest'
import { applyHevcSao, type HevcSaoCtb } from '../src/codecs/hevc-sao.ts'

const component = (
  type: 0 | 1 | 2,
  offsets: readonly [number, number, number, number, number],
  bandPosition = 0,
  edgeClass = 0,
) => ({ type, offsets, bandPosition, edgeClass })

describe('HEVC sample-adaptive offset filtering', () => {
  it('applies four wrapped band offsets and clips samples', () => {
    const parameters: HevcSaoCtb[] = [
      {
        components: [
          component(1, [0, 2, -3, 7, 20], 30),
          component(0, [0, 0, 0, 0, 0]),
          component(0, [0, 0, 0, 0, 0]),
        ],
      },
    ]
    expect(
      applyHevcSao(Uint16Array.from([240, 248, 0, 8, 16, 255]), 6, 1, 8, 1, 1, 8, 0, parameters),
    ).toEqual(Uint16Array.from([242, 245, 7, 28, 16, 252]))
  })

  it('classifies horizontal edges from the unmodified source samples', () => {
    const parameters: HevcSaoCtb[] = [
      {
        components: [
          component(2, [0, 1, 2, -3, -4]),
          component(0, [0, 0, 0, 0, 0]),
          component(0, [0, 0, 0, 0, 0]),
        ],
      },
    ]
    expect(
      applyHevcSao(Uint16Array.from([2, 1, 3, 2, 2]), 5, 1, 8, 1, 1, 8, 0, parameters),
    ).toEqual(Uint16Array.from([2, 2, 0, 4, 2]))
  })
})
