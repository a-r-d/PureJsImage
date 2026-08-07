import { describe, expect, it } from 'vitest'

import { HevcIntraCabacContexts } from '../src/codecs/hevc-contexts.ts'

describe('HEVC intra CABAC context tables', () => {
  it('initializes the standard I-slice context groups at SliceQpY', () => {
    const contexts = new HevcIntraCabacContexts(26)

    expect(contexts.splitCodingUnit).toHaveLength(3)
    expect(contexts.splitCodingUnit.map((context) => context.state)).toEqual([0, 15, 24])
    expect(contexts.partMode[0]).toMatchObject({ state: 0, mostProbableSymbol: 1 })
    expect(contexts.lastSignificantX).toHaveLength(18)
    expect(contexts.significantCoefficient).toHaveLength(42)
    expect(contexts.coefficientGreaterOne).toHaveLength(24)
    expect(contexts.coefficientGreaterTwo).toHaveLength(6)
  })

  it('bounds named context lookups', () => {
    const contexts = new HevcIntraCabacContexts(26)
    expect(contexts.context(contexts.lumaCbf, 1, 'luma CBF')).toBe(contexts.lumaCbf[1])
    expect(() => contexts.context(contexts.lumaCbf, 2, 'luma CBF')).toThrow('out of range')
  })
})
