import { describe, expect, it } from 'vitest'
import { JpegXlEncoderMemory } from '../src/codecs/jpegxl-encoder-memory.ts'
import {
  createJpegXlLargeSelector,
  fillJpegXlLargeSourceWeights,
  jpegXlLargeCoefficientRate,
  jpegXlLargeQuantizers,
  poolJpegXlLargeSourceWeights,
} from '../src/codecs/jpegxl-vardct-large-select.ts'
import type { JpegXlLargeWindowMenu } from '../src/codecs/jpegxl-vardct-large-select.ts'

function menu(): JpegXlLargeWindowMenu {
  const baselineCounts = new Uint16Array(48).fill(65535)
  baselineCounts.fill(0, 0, 3)
  return {
    coefficientRates: new Float64Array(45).fill(1000),
    errors: new Float64Array(45).fill(1000),
    nonzeroCounts: new Uint16Array(135),
    dcRates: Float64Array.of(5, 5, 5),
    baselineCoefficientRate: 100,
    baselineError: 100,
    baselineCounts,
    compactDc: Int32Array.from({ length: 144 }, (_, i) => i - 72),
  }
}
function learn(selector: ReturnType<typeof createJpegXlLargeSelector>): void {
  for (let channel = 0; channel < 3; channel++) selector.learnBaselineCount(0, channel)
}

describe('JPEG XL staged large transform selector', () => {
  it('selects both rectangle halves independently and stages the complete family DC', () => {
    const memory = new JpegXlEncoderMemory(1_000_000),
      baseline = new Int32Array(20).fill(8)
    const selector = createJpegXlLargeSelector(memory, 5, 4, baseline),
      input = menu()
    learn(selector)
    // An edge leader participates in histogram learning, but has no window alternative.
    for (let c = 0; c < 3; c++) selector.learnBaselineCount(1, c)
    for (const choice of [3, 14]) {
      input.coefficientRates[choice] = 10
      input.errors[choice] = 20
    }
    selector.addWindow(0, input)
    input.coefficientRates.fill(9999)
    input.errors.fill(9999)
    input.compactDc.fill(9999)
    selector.finalize()
    const selection = selector.select(0.7),
      countCost = Math.log2(258 / 2)
    let expectedBaselineRate = 100,
      expectedHalfRate = 10
    for (let c = 0; c < 3; c++) {
      expectedBaselineRate += countCost
      expectedHalfRate += countCost
    }
    expect(selection.stats.baselineRate).toBe(expectedBaselineRate)
    expect(selection.stats.selectedRate).toBe(5 + expectedHalfRate + expectedHalfRate)
    expect(selection.stats.selectedError).toBe(40)
    expect(selection.stats.lambda).toBe((expectedBaselineRate / 100) * 0.7)
    expect(selection.stats.selectedVertical).toBe(1)
    expect(selection.stats.selectedSquare).toBe(0)
    expect(selection.map.first.filter(Boolean)).toHaveLength(2)
    expect(selection.map.first[0]).toBe(1)
    expect(selection.map.first[2]).toBe(1)
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 5; x++) {
        const i = y * 5 + x
        expect(selection.map.strategy[i]).toBe(x < 4 ? 10 : 0)
        expect(selection.quantizationMap[i]).toBe(x < 2 ? 7 : x < 4 ? 9 : 8)
        expect(baseline[i]).toBe(8)
      }
    expect(selection.compactDc).toEqual(Int32Array.from({ length: 48 }, (_, i) => i - 72))
    selection.release()
    selection.release()
    selector.release()
    selector.release()
    expect(memory.liveBytes).toBe(0)
    expect(memory.liveAllocations).toBe(0)
  })

  it('retains the exact original solution on strict ties, including its Q and DC', () => {
    const memory = new JpegXlEncoderMemory(1_000_000),
      baseline = new Int32Array(16).fill(11)
    const selector = createJpegXlLargeSelector(memory, 4, 4, baseline)
    const input = { ...menu(), baselineCoefficientRate: 0, baselineError: 1 }
    input.coefficientRates.fill(0)
    input.errors.fill(1)
    input.dcRates.fill(0)
    learn(selector)
    selector.addWindow(0, input)
    selector.finalize()
    const selection = selector.select(1)
    expect(selection.stats.selected).toBe(0)
    expect(selection.stats.selectedRate).toBe(selection.stats.baselineRate)
    expect(selection.stats.selectedError).toBe(1)
    expect(selection.map.strategy).toEqual(new Uint8Array(16))
    expect(selection.quantizationMap).toEqual(baseline)
    expect(selection.compactDc).toEqual(new Int32Array(48))
    selection.release()
    selector.release()
    expect(memory.liveBytes).toBe(0)
  })

  it('keeps the original exact reconstruction when aggregate error is zero', () => {
    for (const baselineCoefficientRate of [0, 100]) {
      const memory = new JpegXlEncoderMemory(1_000_000)
      const baseline = new Int32Array(16).fill(8)
      const selector = createJpegXlLargeSelector(memory, 4, 4, baseline)
      const input = { ...menu(), baselineCoefficientRate, baselineError: 0 }
      if (baselineCoefficientRate === 0) input.baselineCounts.fill(65535)
      else learn(selector)
      input.coefficientRates.fill(0)
      input.errors.fill(0)
      input.dcRates.fill(0)
      selector.addWindow(0, input)
      selector.finalize()
      const selection = selector.select(1)
      expect(selection.stats.lambda).toBe(0)
      expect(selection.stats.selected).toBe(0)
      expect(selection.stats.selectedRate).toBe(selection.stats.baselineRate)
      expect(selection.stats.selectedError).toBe(0)
      expect(selection.quantizationMap).toEqual(baseline)
      expect(selection.map.strategy).toEqual(new Uint8Array(16))
      expect(selection.compactDc).toEqual(new Int32Array(48))
      selection.release()
      selector.release()
      expect(memory.liveBytes).toBe(0)
    }
  })

  it('requires histogram training for all supplied original leaders before pricing', () => {
    const memory = new JpegXlEncoderMemory(1_000_000)
    const selector = createJpegXlLargeSelector(memory, 4, 4, new Int32Array(16).fill(8))
    selector.addWindow(0, menu())
    expect(() => selector.finalize()).toThrow('missing original large transform count training')
    learn(selector)
    selector.finalize()
    const selection = selector.select(1)
    expect(selection.stats.baselineRate).toBeGreaterThan(100)
    selection.release()
    selector.release()
    expect(memory.liveBytes).toBe(0)
  })

  it('packs horizontal and square footprints with the declared Q order', () => {
    for (const square of [false, true]) {
      const memory = new JpegXlEncoderMemory(1_000_000)
      const selector = createJpegXlLargeSelector(memory, 4, 4, new Int32Array(16).fill(8)),
        input = menu()
      const choices = square ? [44] : [20, 34]
      for (const choice of choices) {
        input.coefficientRates[choice] = 0
        input.errors[choice] = 0
      }
      learn(selector)
      selector.addWindow(0, input)
      selector.finalize()
      const selection = selector.select(1)
      expect(selection.stats.selectedHorizontal).toBe(square ? 0 : 1)
      expect(selection.stats.selectedSquare).toBe(square ? 1 : 0)
      expect(selection.map.strategy.every((value) => value === (square ? 5 : 11))).toBe(true)
      expect(selection.map.first.filter(Boolean)).toHaveLength(square ? 1 : 2)
      expect(selection.map.blocksX.every((value) => value === 4)).toBe(true)
      expect(selection.map.blocksY.every((value) => value === (square ? 4 : 2))).toBe(true)
      expect(selection.quantizationMap[0]).toBe(square ? 16 : 6)
      expect(selection.quantizationMap[15]).toBe(square ? 16 : 12)
      const offset = square ? 96 : 48
      expect(selection.compactDc).toEqual(
        Int32Array.from({ length: 48 }, (_, i) => offset + i - 72),
      )
      selection.release()
      selector.release()
      expect(memory.liveBytes).toBe(0)
    }
    expect(jpegXlLargeQuantizers).toEqual([4, 5, 6, 7, 8, 9, 10, 12, 16])
    expect(jpegXlLargeCoefficientRate(-3)).toBe(5)
    expect(jpegXlLargeCoefficientRate(0)).toBe(0)
  })

  it('rejects incomplete or invalid input and cleans up interrupted staged selections', () => {
    const memory = new JpegXlEncoderMemory(1_000_000)
    const selector = createJpegXlLargeSelector(memory, 4, 4, new Int32Array(16).fill(8))
    expect(() => selector.finalize()).toThrow()
    expect(() => selector.select(1)).toThrow()
    expect(() => selector.learnBaselineCount(1009, 0)).toThrow()
    const invalid = menu()
    invalid.errors[9] = NaN
    expect(() => selector.addWindow(0, invalid)).toThrow()
    learn(selector)
    selector.addWindow(0, menu())
    selector.finalize()
    expect(() => selector.learnBaselineCount(0, 0)).toThrow()
    expect(() => selector.finalize()).toThrow()
    expect(() => selector.select(0)).toThrow()
    const held = memory.liveBytes
    expect(() =>
      selector.select(1, () => {
        throw new Error('cancelled')
      }),
    ).toThrow('cancelled')
    expect(memory.liveBytes).toBe(held)
    selector.release()
    expect(memory.liveBytes).toBe(0)
    expect(() => selector.select(1)).toThrow()
    const small = new JpegXlEncoderMemory(500)
    expect(() => createJpegXlLargeSelector(small, 4, 4, new Int32Array(16).fill(8))).toThrow()
    expect(small.liveBytes).toBe(0)
  })
})

describe('JPEG XL bounded large transform source weights', () => {
  it('matches the per-pixel source response and cardinal-curvature reference', () => {
    const matrix = Float64Array.of(0.3, 0.6, 0.1, 0.23, 0.69, 0.08, 0.24, 0.2, 0.56)
    const tile = new Float64Array(34 * 34 * 3),
      rx = Float64Array.from({ length: 16 }, (_, i) => (i - 8) / 84)
    for (let y = 0; y < 34; y++)
      for (let x = 0; x < 34; x++)
        for (let c = 0; c < 3; c++)
          tile[(y * 34 + x) * 3 + c] = ((x * 13 + y * 7 + c * 29) % 101) / 100
    const actual = new Float32Array(16)
    fillJpegXlLargeSourceWeights(tile, matrix, rx, actual)
    const reference = new Float32Array(16),
      light = new Float64Array(34 * 34)
    for (let i = 0; i < light.length; i++)
      light[i] = Math.log(
        (((matrix[0] ?? 0) + (matrix[3] ?? 0)) * (tile[i * 3] ?? 0)) / 2 +
          (((matrix[1] ?? 0) + (matrix[4] ?? 0)) * (tile[i * 3 + 1] ?? 0)) / 2 +
          (((matrix[2] ?? 0) + (matrix[5] ?? 0)) * (tile[i * 3 + 2] ?? 0)) / 2 +
          1 / 256,
      )
    for (let by = 0; by < 4; by++)
      for (let bx = 0; bx < 4; bx++) {
        const cell = by * 4 + bx
        let logs = 0,
          curve = 0
        for (let y = by * 8 + 1; y <= by * 8 + 8; y++)
          for (let x = bx * 8 + 1; x <= bx * 8 + 8; x++) {
            const at = (y * 34 + x) * 3,
              r = tile[at] ?? 0,
              g = tile[at + 1] ?? 0,
              b = tile[at + 2] ?? 0
            const lr = (matrix[0] ?? 0) * r + (matrix[1] ?? 0) * g + (matrix[2] ?? 0) * b
            const lg = (matrix[3] ?? 0) * r + (matrix[4] ?? 0) * g + (matrix[5] ?? 0) * b
            const u = Math.cbrt(lr + 0.0037930732552754493),
              v = Math.cbrt(lg + 0.0037930732552754493)
            logs +=
              Math.log(
                ((lr + lg) / 2 + 1 / 256) /
                  (1.5 * ((1 + (rx[cell] ?? 0)) * u * u + (1 - (rx[cell] ?? 0)) * v * v)),
              ) / 64
            const i = y * 34 + x,
              center = light[i] ?? 0
            curve +=
              (Math.abs(2 * center - (light[i - 1] ?? 0) - (light[i + 1] ?? 0)) +
                Math.abs(2 * center - (light[i - 34] ?? 0) - (light[i + 34] ?? 0))) /
              64
          }
        reference[cell] = Math.exp(0.5 * logs - 0.25 * Math.log1p(curve / (1 / 256)))
      }
    expect(actual).toEqual(reference)
    let mean = 0
    for (const weight of reference) mean += weight / 16
    expect(poolJpegXlLargeSourceWeights(actual)).toBe(Math.fround(mean))
    expect(() => poolJpegXlLargeSourceWeights(new Float32Array(16))).toThrow()
  })
})
