import { describe, expect, it } from 'vitest'
import {
  deriveHevcChromaMode,
  deriveHevcLumaCandidates,
  deriveHevcLumaMode,
  predictHevcIntra,
  prepareHevcIntraReferences,
} from '../src/codecs/hevc-intra.ts'

const references = (size: 4 | 8 | 16 | 32) =>
  prepareHevcIntraReferences(
    Array.from({ length: size * 2 + 1 }, (_, index) => 20 + index),
    Array.from({ length: size * 2 + 1 }, (_, index) => 20 + index * 2),
    size,
    8,
  )

describe('HEVC intra reconstruction', () => {
  it('substitutes unavailable references in normative perimeter order', () => {
    expect(
      prepareHevcIntraReferences(
        [undefined, undefined, undefined, 9, undefined, undefined, undefined, undefined, undefined],
        [undefined, undefined, undefined, undefined, undefined, 7, undefined, undefined, undefined],
        4,
        8,
      ),
    ).toEqual({
      top: new Int32Array([7, 7, 7, 9, 9, 9, 9, 9, 9]),
      left: new Int32Array([7, 7, 7, 7, 7, 7, 7, 7, 7]),
    })
    const unavailable = Array.from({ length: 9 }, () => undefined)
    expect(prepareHevcIntraReferences(unavailable, unavailable, 4, 10).top).toEqual(
      new Int32Array(9).fill(512),
    )
  })

  it('predicts planar and filtered DC blocks exactly', () => {
    expect(
      Array.from(
        predictHevcIntra(references(4), {
          bitDepth: 8,
          component: 1,
          mode: 0,
          size: 4,
        }),
      ),
    ).toEqual([23, 24, 25, 25, 25, 25, 26, 26, 27, 27, 27, 27, 29, 28, 28, 28])
    expect(
      Array.from(
        predictHevcIntra(references(4), {
          bitDepth: 8,
          component: 0,
          mode: 1,
          size: 4,
        }),
      ),
    ).toEqual([23, 24, 24, 24, 24, 24, 24, 24, 25, 24, 24, 24, 25, 24, 24, 24])
  })

  it('predicts vertical, horizontal, and fractional angular modes', () => {
    expect(
      Array.from(
        predictHevcIntra(references(4), {
          bitDepth: 8,
          component: 1,
          mode: 26,
          size: 4,
        }),
      ),
    ).toEqual([21, 22, 23, 24, 21, 22, 23, 24, 21, 22, 23, 24, 21, 22, 23, 24])
    expect(
      Array.from(
        predictHevcIntra(references(4), {
          bitDepth: 8,
          component: 1,
          mode: 10,
          size: 4,
        }),
      ),
    ).toEqual([22, 22, 22, 22, 24, 24, 24, 24, 26, 26, 26, 26, 28, 28, 28, 28])
    expect(
      Array.from(
        predictHevcIntra(references(4), {
          bitDepth: 8,
          component: 1,
          mode: 34,
          size: 4,
        }),
      ),
    ).toEqual([22, 23, 24, 25, 23, 24, 25, 26, 24, 25, 26, 27, 25, 26, 27, 28])
    expect(
      Array.from(
        predictHevcIntra(references(4), {
          bitDepth: 8,
          component: 1,
          mode: 13,
          size: 4,
        }),
      ),
    ).toEqual([21, 21, 20, 21, 23, 23, 22, 22, 25, 25, 24, 24, 27, 27, 26, 26])
  })

  it('does not filter neighbouring references for 4:2:0 chroma', () => {
    const input = prepareHevcIntraReferences(
      [20, 21, 80, 22, 90, 23, 100, 24, 110, 25, 120, 26, 130, 27, 140, 28, 150],
      [20, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45],
      8,
      8,
    )
    const chroma = predictHevcIntra(input, {
      bitDepth: 8,
      component: 1,
      mode: 18,
      size: 8,
    })
    const luma = predictHevcIntra(input, {
      bitDepth: 8,
      component: 0,
      disableBoundaryFilter: true,
      mode: 18,
      size: 8,
    })
    expect(chroma[0]).toBe(20)
    expect(chroma).not.toEqual(luma)
  })

  it('derives luma candidates, remaining modes, and chroma modes', () => {
    expect(deriveHevcLumaCandidates(1, 1)).toEqual([0, 1, 26])
    expect(deriveHevcLumaCandidates(22, 22)).toEqual([22, 21, 23])
    expect(deriveHevcLumaCandidates(0, 10)).toEqual([0, 10, 1])
    expect(deriveHevcLumaMode([0, 1, 26], 2, undefined)).toBe(26)
    expect(deriveHevcLumaMode([0, 1, 26], undefined, 24)).toBe(27)
    expect(deriveHevcChromaMode(0, 0)).toBe(34)
    expect(deriveHevcChromaMode(4, 22)).toBe(22)
  })
})
