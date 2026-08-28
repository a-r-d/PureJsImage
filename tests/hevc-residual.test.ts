import { describe, expect, it } from 'vitest'

import type { HevcCabacContext } from '../src/codecs/hevc-cabac.ts'
import { HevcIntraCabacContexts } from '../src/codecs/hevc-contexts.ts'
import { decodeHevcResidual, hevcScanOrder } from '../src/codecs/hevc-residual.ts'

class ScriptedCabac {
  readonly decisionContexts: HevcCabacContext[] = []
  readonly #bypass: number[]
  readonly #decisions: number[]

  constructor(decisions: readonly number[], bypass: readonly number[]) {
    this.#decisions = [...decisions]
    this.#bypass = [...bypass]
  }

  decodeDecision(context: HevcCabacContext): 0 | 1 {
    this.decisionContexts.push(context)
    const value = this.#decisions.shift()
    if (value === 0 || value === 1) return value
    throw new Error('Missing scripted decision')
  }

  decodeBypass(): 0 | 1 {
    const value = this.#bypass.shift()
    if (value === 0 || value === 1) return value
    throw new Error('Missing scripted bypass bin')
  }

  decodeBypassBits(count: number): number {
    let value = 0
    for (let index = 0; index < count; index += 1) value = value * 2 + this.decodeBypass()
    return value
  }
}

describe('HEVC coefficient scan orders', () => {
  it('derives diagonal, horizontal, and vertical scan coordinates', () => {
    expect(hevcScanOrder(2, 0).slice(0, 8)).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 0 },
      { x: 0, y: 2 },
      { x: 1, y: 1 },
      { x: 2, y: 0 },
      { x: 0, y: 3 },
      { x: 1, y: 2 },
    ])
    expect(hevcScanOrder(1, 1)).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ])
    expect(hevcScanOrder(1, 2)).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
    ])
  })
})

describe('HEVC residual syntax', () => {
  const options = {
    component: 0 as const,
    intraMode: 0,
    log2Size: 2,
    signDataHiding: true,
    transformSkipEnabled: false,
    transquantBypass: false,
  }

  it('decodes a positive DC-only 4x4 transform block', () => {
    const block = decodeHevcResidual(
      new ScriptedCabac([0, 0, 0], [0]),
      new HevcIntraCabacContexts(26),
      options,
    )

    expect([...block.coefficients]).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
  })

  it('decodes a signed coefficient with greater-one syntax', () => {
    const block = decodeHevcResidual(
      new ScriptedCabac([0, 0, 1, 0], [1]),
      new HevcIntraCabacContexts(26),
      options,
    )

    expect(block.coefficients[0]).toBe(-2)
  })

  it('swaps the coded last-coefficient coordinates for vertical scans', () => {
    const block = decodeHevcResidual(
      new ScriptedCabac([1, 0, 0, 0, 0], [0]),
      new HevcIntraCabacContexts(26),
      { ...options, intraMode: 10 },
    )

    expect(block.coefficients[4]).toBe(1)
    expect(block.coefficients[1]).toBe(0)
  })

  it('uses the chroma significance contexts for 4x4 chroma coefficients', () => {
    const contexts = new HevcIntraCabacContexts(26)
    const decoder = new ScriptedCabac([1, 0, 0, 0, 0, 0], [0])

    decodeHevcResidual(decoder, contexts, { ...options, component: 1 })

    expect(decoder.decisionContexts[3]).toBe(contexts.significantCoefficient[29])
    expect(decoder.decisionContexts[4]).toBe(contexts.significantCoefficient[27])
  })

  it('parses transform skip only for 4x4 transform blocks', () => {
    const four = new ScriptedCabac([0, 0, 0, 0], [0])
    const fourContexts = new HevcIntraCabacContexts(26)
    decodeHevcResidual(four, fourContexts, { ...options, transformSkipEnabled: true })
    expect(four.decisionContexts[0]).toBe(fourContexts.transformSkip[0])

    const eight = new ScriptedCabac(new Array(16).fill(0), new Array(8).fill(0))
    const eightContexts = new HevcIntraCabacContexts(26)
    decodeHevcResidual(eight, eightContexts, {
      ...options,
      log2Size: 3,
      transformSkipEnabled: true,
    })
    expect(eight.decisionContexts[0]).toBe(eightContexts.lastSignificantX[3])
    expect(eight.decisionContexts[0]).not.toBe(eightContexts.transformSkip[0])
  })
})
