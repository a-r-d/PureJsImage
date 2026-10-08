import { JpegXlEncoderMemory } from '../../src/codecs/jpegxl-encoder-memory.ts'
import { prepareJpegXlLargeMenus } from '../../src/codecs/jpegxl-vardct-large-menu.ts'
import {
  createJpegXlLargeSelector,
  fillJpegXlLargeSourceWeights,
  type JpegXlLargeSelection,
  type JpegXlLargeSelectionStats,
  type JpegXlLargeSelector,
} from '../../src/codecs/jpegxl-vardct-large-select.ts'

export interface LargeSourceSelectionSummary {
  readonly strategies: readonly number[]
  readonly quantizers: readonly number[]
  readonly compactDc: readonly number[]
  readonly stats: JpegXlLargeSelectionStats
  readonly weightedCandidateChecksum: number
  readonly sourceWeightChecksum: number
  readonly menuCount: number
  readonly baselineUnchanged: boolean
  readonly peakOwnedBytes: number
  readonly finalOwnedBytes: number
  readonly finalOwnedAllocations: number
}

/** Portable joint source/menu/selection witness. The two nonconstant windows exercise
 * every rectangular/square Q alternative, independently of which family wins. */
export function verifyLargeSourceSelection(): LargeSourceSelectionSummary {
  const memory = new JpegXlEncoderMemory(2_097_152)
  const width = 64,
    height = 32,
    wide = 8,
    high = 4,
    cells = wide * high
  let selector: JpegXlLargeSelector | undefined
  let selection: JpegXlLargeSelection | undefined
  let summary:
    | Omit<LargeSourceSelectionSummary, 'finalOwnedBytes' | 'finalOwnedAllocations'>
    | undefined
  try {
    const linear = memory.allocate(Float64Array, width * height * 3)
    const physical = [
      memory.allocate(Float32Array, width * height),
      memory.allocate(Float32Array, width * height),
      memory.allocate(Float32Array, width * height),
    ] as const
    const planes = [
      memory.allocate(Float32Array, 64),
      memory.allocate(Float32Array, 64),
      memory.allocate(Float32Array, 64),
    ] as const
    const matrix = memory.allocate(Float64Array, 9)
    const constants = [
      0.3, 0.622, 0.078, 0.23, 0.692, 0.078, 0.2434226894556144, 0.20476744435558894,
      0.5518098669709147,
    ] as const
    for (let p = 0; p < 9; p++) matrix[p] = Math.fround(constants[p] ?? 0)
    const bias = 0.0037930732552754493,
      biasRoot = Math.cbrt(bias)
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const p = y * width + x,
          at = p * 3
        const red = Math.fround(0.04 + x / 128 + y / 256 + ((x * y) % 17) / 512)
        const green = Math.fround(0.08 + x / 256 + y / 96 + ((x + y) % 5) / 1024)
        const blue = Math.fround(0.12 + (width - x) / 256 + y / 128 + (x % 3) / 1024)
        linear[at] = red
        linear[at + 1] = green
        linear[at + 2] = blue
        const first =
          Math.cbrt(
            (matrix[0] ?? 0) * red + (matrix[1] ?? 0) * green + (matrix[2] ?? 0) * blue + bias,
          ) - biasRoot
        const second =
          Math.cbrt(
            (matrix[3] ?? 0) * red + (matrix[4] ?? 0) * green + (matrix[5] ?? 0) * blue + bias,
          ) - biasRoot
        const third =
          Math.cbrt(
            (matrix[6] ?? 0) * red + (matrix[7] ?? 0) * green + (matrix[8] ?? 0) * blue + bias,
          ) - biasRoot
        physical[0][p] = (first - second) / 2
        physical[1][p] = (first + second) / 2
        physical[2][p] = third - (first + second) / 2
      }
    const strategies = memory.allocate(Int32Array, cells),
      quantizers = memory.allocate(Int32Array, cells)
    quantizers.fill(8)
    const dc = [
      memory.allocate(Int32Array, cells),
      memory.allocate(Int32Array, cells),
      memory.allocate(Int32Array, cells),
    ] as const
    const factors = [2 / 16384, 2 / 2048, 2 / 1024] as const
    for (let by = 0; by < high; by++)
      for (let bx = 0; bx < wide; bx++)
        for (let c = 0; c < 3; c++) {
          const destination = dc[c]
          if (!destination) throw new Error('Missing fixture DC channel')
          let sum = 0
          for (let y = 0; y < 8; y++)
            for (let x = 0; x < 8; x++) sum += physical[c]?.[(by * 8 + y) * width + bx * 8 + x] ?? 0
          destination[by * wide + bx] = Math.round(sum / (64 * (factors[c] ?? 1)))
        }
    const baseline = memory.allocate(Int32Array, cells * 5)
    baseline.set(strategies)
    baseline.set(quantizers, cells)
    for (let c = 0; c < 3; c++) {
      const plane = dc[c]
      if (!plane) throw new Error('Missing fixture DC channel')
      baseline.set(plane, cells * (c + 2))
    }
    const correlationX = memory.allocate(Int32Array, 1),
      correlationB = memory.allocate(Int32Array, 1)
    correlationX[0] = 21
    correlationB[0] = -42
    const tile = memory.allocate(Float64Array, 34 * 34 * 3),
      ratios = memory.allocate(Float64Array, 16)
    ratios.fill(0.25)
    selector = createJpegXlLargeSelector(memory, wide, high, quantizers)
    const activeSelector = selector
    let menuCount = 0,
      weightedCandidateChecksum = 0,
      sourceWeightChecksum = 0
    for (const _ of prepareJpegXlLargeMenus({
      memory,
      blocksWide: wide,
      blocksHigh: high,
      globalScale: 8192,
      strategyMap: strategies,
      quantizationMap: quantizers,
      dc,
      dcFactors: factors,
      correlationX,
      correlationB,
      smoothDc: true,
      fill8: (correlated, bx, by) => {
        for (let p = 0; p < 64; p++) {
          const at = (by * 8 + (p >>> 3)) * width + bx * 8 + (p & 7),
            sy = physical[1][at] ?? 0
          planes[0][p] = (physical[0][at] ?? 0) - (correlated ? 0.25 * sy : 0)
          planes[1][p] = sy
          planes[2][p] = (physical[2][at] ?? 0) - (correlated ? -0.5 * sy : 0)
        }
        return planes
      },
      quantizeAc: (value) => Math.round(value),
      fillWeights: (bx, by, output) => {
        for (let y = 0; y < 34; y++)
          for (let x = 0; x < 34; x++) {
            const sourceY = Math.max(0, Math.min(height - 1, by * 8 + y - 1)),
              sourceX = Math.max(0, Math.min(width - 1, bx * 8 + x - 1)),
              source = (sourceY * width + sourceX) * 3,
              target = (y * 34 + x) * 3
            for (let c = 0; c < 3; c++) tile[target + c] = linear[source + c] ?? 0
          }
        fillJpegXlLargeSourceWeights(tile, matrix, ratios, output)
        for (let p = 0; p < 16; p++)
          sourceWeightChecksum += (menuCount * 16 + p + 1) * (output[p] ?? 0)
      },
      learnBaselineCount: (nonzero, channel) => activeSelector.learnBaselineCount(nonzero, channel),
      addWindow: (index, menu) => {
        if (
          index !== menuCount ||
          menu.coefficientRates.length !== 45 ||
          menu.errors.length !== 45 ||
          menu.compactDc.length !== 144
        )
          throw new Error('Incomplete large source menu')
        for (let p = 0; p < 45; p++) {
          const rate = menu.coefficientRates[p] ?? NaN,
            error = menu.errors[p] ?? NaN
          if (!Number.isFinite(rate) || rate < 0 || !Number.isFinite(error) || error < 0)
            throw new Error('Invalid large source alternative')
          weightedCandidateChecksum += (index * 45 + p + 1) * (rate + error)
        }
        activeSelector.addWindow(index, menu)
        menuCount++
      },
      check: () => {},
    })) {
      /* consume the production cooperative source pass */
    }
    if (menuCount !== 2 || !(weightedCandidateChecksum > 0) || !(sourceWeightChecksum > 0))
      throw new Error('Nonconstant large source fixture was not exercised')
    activeSelector.finalize()
    selection = activeSelector.select(1)
    for (let p = 0; p < cells; p++) {
      if (strategies[p] !== baseline[p] || quantizers[p] !== baseline[cells + p])
        throw new Error('Large selection changed its baseline maps')
      for (let c = 0; c < 3; c++)
        if (dc[c]?.[p] !== baseline[cells * (c + 2) + p])
          throw new Error('Large selection changed its baseline DC')
    }
    summary = {
      strategies: Array.from(selection.map.strategy),
      quantizers: Array.from(selection.quantizationMap),
      compactDc: Array.from(selection.compactDc),
      stats: selection.stats,
      weightedCandidateChecksum,
      sourceWeightChecksum,
      menuCount,
      baselineUnchanged: true,
      peakOwnedBytes: memory.peakBytes,
    }
  } finally {
    selection?.release()
    selector?.release()
    memory.close()
  }
  if (!summary || memory.liveBytes !== 0 || memory.liveAllocations !== 0)
    throw new Error('Large source fixture retained owner storage')
  return {
    ...summary,
    finalOwnedBytes: memory.liveBytes,
    finalOwnedAllocations: memory.liveAllocations,
  }
}
