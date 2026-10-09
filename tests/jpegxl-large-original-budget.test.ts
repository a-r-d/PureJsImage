import { describe, expect, it } from 'vitest'
import { JpegXlEncoderMemory } from '../src/codecs/jpegxl-encoder-memory.ts'
import {
  createJpegXlLargeSelector,
  type JpegXlLargeWindowMenu,
  type JpegXlLargeSelection,
} from '../src/codecs/jpegxl-vardct-large-select.ts'

function menu(): JpegXlLargeWindowMenu {
  const baselineCounts = new Uint16Array(48).fill(65535)
  baselineCounts.fill(0, 0, 3)
  return {
    coefficientRates: new Float64Array(45).fill(1000),
    errors: new Float64Array(45).fill(1000),
    nonzeroCounts: new Uint16Array(135),
    dcRates: new Float64Array(3),
    baselineCoefficientRate: 100,
    baselineMagnitudeRate: 100,
    baselineConditionalRate: 100,
    baselineError: 10,
    baselineCounts,
    compactDc: Int32Array.from({ length: 144 }, (_, i) => i - 72),
  }
}
function selector(
  memory: JpegXlEncoderMemory,
  input: JpegXlLargeWindowMenu,
  baseline = new Int32Array(16).fill(8),
) {
  const owner = createJpegXlLargeSelector(memory, 4, 4, baseline, true)
  for (let c = 0; c < 3; c++) owner.learnBaselineCount(0, c)
  owner.addWindow(0, input)
  owner.finalize()
  return owner
}
function finish(iterator: Generator<void, JpegXlLargeSelection | undefined, undefined>) {
  for (;;) {
    const step = iterator.next()
    if (step.done) return step.value
  }
}

describe('JPEG XL original-error budget selection', () => {
  it('returns a supported cheaper selection under the original error cap and retains the source Q', () => {
    const memory = new JpegXlEncoderMemory(1_000_000),
      input = menu()
    input.coefficientRates[36] = 80
    input.errors[36] = 5
    input.coefficientRates[37] = 1
    input.errors[37] = 20
    const originalQ = new Int32Array(16).fill(8),
      owner = selector(memory, input, originalQ),
      live = memory.liveBytes
    const selected = finish(owner.selectOriginalBudget())
    expect(selected).toBeDefined()
    if (!selected) throw new Error('Expected feasible selection')
    expect(selected.stats.selectedError).toBeLessThanOrEqual(selected.stats.baselineError)
    expect(selected.stats.selectedRate).toBeLessThan(selected.stats.baselineRate)
    expect(selected.stats.selectedSquare).toBe(1)
    expect(selected.stats.lambdaMultiplier).toBeGreaterThanOrEqual(0)
    expect(selected.stats.lambdaMultiplier).toBeLessThanOrEqual(1)
    expect(selected.quantizationMap).toEqual(new Int32Array(16).fill(4))
    expect(originalQ).toEqual(new Int32Array(16).fill(8))
    selected.release()
    expect(memory.liveBytes).toBe(live)
    owner.release()
    expect(memory.liveBytes).toBe(0)
  })

  it('returns original/no-selection for exact ties, no saving, zero error or an infeasible initial policy', () => {
    for (const kind of ['tie', 'no-saving', 'zero-error', 'initial-infeasible']) {
      const memory = new JpegXlEncoderMemory(1_000_000)
      let input = menu()
      if (kind === 'tie') {
        input.coefficientRates[36] = 100
        input.errors[36] = 10
      }
      if (kind === 'zero-error') input = { ...input, baselineError: 0 }
      if (kind === 'initial-infeasible') {
        input.coefficientRates[36] = 0
        input.errors[36] = 11
      }
      const owner = selector(memory, input),
        live = memory.liveBytes
      expect(finish(owner.selectOriginalBudget())).toBeUndefined()
      expect(memory.liveBytes).toBe(live)
      owner.release()
      expect(memory.liveBytes).toBe(0)
    }
  })

  it('cleans staged arrays when cancelled at each budget-search phase', () => {
    for (const pauses of [1, 2, 3, 6]) {
      const memory = new JpegXlEncoderMemory(1_000_000),
        input = menu()
      input.coefficientRates[36] = 80
      input.errors[36] = 5
      input.coefficientRates[37] = 1
      input.errors[37] = 20
      const owner = selector(memory, input),
        live = memory.liveBytes,
        iterator = owner.selectOriginalBudget()
      for (let i = 0; i < pauses; i++) expect(iterator.next().done).toBe(false)
      const sentinel = new Error('cancel budget search')
      expect(() => iterator.throw(sentinel)).toThrow(sentinel)
      expect(memory.liveBytes).toBe(live)
      owner.release()
      expect(memory.liveBytes).toBe(0)
    }
  })

  it('unwinds partial output allocation and rejects use after release', () => {
    const probe = new JpegXlEncoderMemory(1_000_000),
      original = selector(probe, menu()),
      held = probe.liveBytes
    original.release()
    expect(probe.liveBytes).toBe(0)
    for (const reserve of [0, 16, 48, 100, 200]) {
      const memory = new JpegXlEncoderMemory(held + reserve),
        owner = selector(memory, menu()),
        live = memory.liveBytes
      expect(() => owner.selectOriginalBudget().next()).toThrow()
      expect(memory.liveBytes).toBe(live)
      owner.release()
      owner.release()
      expect(() => owner.selectOriginalBudget().next()).toThrow()
      expect(memory.liveBytes).toBe(0)
    }
  })
})
