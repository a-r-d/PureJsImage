import { invalidJpegXlInput } from './jpegxl-errors.ts'
import type { JpegXlEncoderMemory } from './jpegxl-encoder-memory.ts'
import { encodeHybridUintPacked } from './jpegxl-modular-encode.ts'

export const jpegXlLargeQuantizers = [4, 5, 6, 7, 8, 9, 10, 12, 16] as const
const countConfig = { splitExponent: 3, msbInToken: 1, lsbInToken: 0 } as const
const absentCount = 65535

/** Borrowed scratch, copied by addWindow. Rates exclude unsigned count costs.
 * Choices: vertical halves (9 each), horizontal halves (9 each), square (9).
 * DC: family vertical/horizontal/square, then Y/X/B, then row-major 4×4 cells.
 * Baseline counts: row-major leader slot, then channel; followers use 65535. */
export interface JpegXlLargeWindowMenu {
  readonly coefficientRates: Float64Array
  readonly errors: Float64Array
  readonly nonzeroCounts: Uint16Array
  readonly dcRates: Float64Array
  readonly baselineCoefficientRate: number
  readonly baselineMagnitudeRate?: number
  readonly baselineConditionalRate?: number
  readonly baselineError: number
  readonly baselineCounts: Uint16Array
  readonly compactDc: Int32Array
}

export interface JpegXlLargeSelectionStats {
  readonly windows: number
  readonly selected: number
  readonly selectedVertical: number
  readonly selectedHorizontal: number
  readonly selectedSquare: number
  readonly baselineRate: number
  readonly baselineError: number
  readonly selectedRate: number
  readonly selectedError: number
  readonly lambda: number
  readonly lambdaMultiplier: number
}

/** Staged replacement only. Zero strategy cells retain the original geometry.
 * compactDc has 48 words/window, meaningful only for selected windows. */
export interface JpegXlLargeSelection {
  readonly map: {
    readonly width: number
    readonly height: number
    readonly strategy: Uint8Array
    readonly first: Uint8Array
    readonly blocksX: Uint8Array
    readonly blocksY: Uint8Array
  }
  readonly quantizationMap: Int32Array
  readonly compactDc: Int32Array
  readonly stats: JpegXlLargeSelectionStats
  release(): void
}

export interface JpegXlLargeSelector {
  /** Include every original leader/channel, including incomplete edge windows. */
  learnBaselineCount(nonzero: number, channel: number): void
  /** Complete windows must arrive once, in row-major order. */
  addWindow(index: number, menu: JpegXlLargeWindowMenu): void
  finalize(): void
  select(multiplier: number, check?: () => void): JpegXlLargeSelection
  selectOriginalBudget(
    check?: () => void,
  ): Generator<void, JpegXlLargeSelection | undefined, undefined>
  release(): void
}

function requireValue(condition: boolean, message: string): void {
  if (!condition) throw invalidJpegXlInput(message)
}
function validCost(value: number): boolean {
  return Number.isFinite(value) && value >= 0
}
function countToken(nonzero: number, channel: number): number {
  requireValue(
    Number.isInteger(nonzero) && nonzero >= 0 && nonzero <= 1008,
    'large transform count is outside its coefficient extent',
  )
  requireValue(
    Number.isInteger(channel) && channel >= 0 && channel < 3,
    'invalid large transform channel',
  )
  return encodeHybridUintPacked(nonzero, countConfig)
}

/** Retains curve/count/DC arrays, never source pixels or coefficient caches.
 * The caller keeps baselineQ immutable and commits staged results transactionally. */
export function createJpegXlLargeSelector(
  memory: JpegXlEncoderMemory,
  blocksWide: number,
  blocksHigh: number,
  baselineQ: Int32Array,
  coherent = false,
): JpegXlLargeSelector {
  requireValue(
    Number.isSafeInteger(blocksWide) &&
      blocksWide >= 4 &&
      Number.isSafeInteger(blocksHigh) &&
      blocksHigh >= 4 &&
      Number.isSafeInteger(blocksWide * blocksHigh) &&
      baselineQ.length === blocksWide * blocksHigh,
    'invalid large transform grid',
  )
  for (const q of baselineQ)
    requireValue(
      Number.isInteger(q) && q > 0 && q < 65536,
      'invalid original large transform precision',
    )
  const across = Math.floor(blocksWide / 4)
  const windows = across * Math.floor(blocksHigh / 4)
  const held: ArrayBufferView[] = []
  try {
    const rates = memory.allocate(Float64Array, windows * 45)
    held.push(rates)
    const errors = memory.allocate(Float64Array, windows * 45)
    held.push(errors)
    const counts = memory.allocate(Uint16Array, windows * 135)
    held.push(counts)
    const dcRates = memory.allocate(Float64Array, windows * 3)
    held.push(dcRates)
    const dc = memory.allocate(Int32Array, windows * 144)
    held.push(dc)
    const oldRates = memory.allocate(Float64Array, windows)
    held.push(oldRates)
    const oldMagnitudes = coherent ? memory.allocate(Float64Array, windows) : undefined
    if (oldMagnitudes) held.push(oldMagnitudes)
    const oldConditional = coherent ? memory.allocate(Float64Array, windows) : undefined
    if (oldConditional) held.push(oldConditional)
    const oldErrors = memory.allocate(Float64Array, windows)
    held.push(oldErrors)
    const oldCounts = memory.allocate(Uint16Array, windows * 48)
    held.push(oldCounts)
    const histogram = memory.allocate(Uint32Array, 768)
    held.push(histogram)
    const totals = memory.allocate(Uint32Array, 3)
    held.push(totals)
    const costs = memory.allocate(Float64Array, 768)
    held.push(costs)
    let added = 0,
      finalized = false,
      released = false,
      baselineRate = 0,
      normalizationBaselineRate = 0,
      baselineError = 0
    const live = (): void => requireValue(!released, 'large transform selector is released')
    const countCost = (nonzero: number, channel: number): number => {
      const packed = countToken(nonzero, channel)
      return (costs[channel * 256 + (packed & 255)] ?? 0) + ((packed >>> 8) & 31)
    }
    return {
      learnBaselineCount(nonzero, channel) {
        live()
        requireValue(!finalized, 'large transform histogram is finalized')
        const packed = countToken(nonzero, channel),
          at = channel * 256 + (packed & 255)
        requireValue(
          (totals[channel] ?? 0) < 0xffffffff,
          'large transform count histogram overflow',
        )
        histogram[at] = (histogram[at] ?? 0) + 1
        totals[channel] = (totals[channel] ?? 0) + 1
      },
      addWindow(index, menu) {
        live()
        requireValue(
          !finalized && index === added && index < windows,
          'large transform windows must be supplied once in order',
        )
        requireValue(
          menu.coefficientRates.length === 45 &&
            menu.errors.length === 45 &&
            menu.nonzeroCounts.length === 135 &&
            menu.dcRates.length === 3 &&
            menu.baselineCounts.length === 48 &&
            menu.compactDc.length === 144 &&
            (!coherent ||
              (validCost(menu.baselineMagnitudeRate ?? NaN) &&
                validCost(menu.baselineConditionalRate ?? NaN))) &&
            validCost(menu.baselineCoefficientRate) &&
            validCost(menu.baselineError),
          'invalid large transform window menu',
        )
        for (const value of menu.coefficientRates)
          requireValue(validCost(value), 'invalid large transform rate')
        for (const value of menu.errors)
          requireValue(validCost(value), 'invalid large transform error')
        for (const value of menu.dcRates)
          requireValue(validCost(value), 'invalid large transform DC rate')
        for (let i = 0; i < 135; i++) countToken(menu.nonzeroCounts[i] ?? 0, i % 3)
        for (let i = 0; i < 48; i++) {
          const count = menu.baselineCounts[i] ?? absentCount
          if (count !== absentCount) countToken(count, i % 3)
        }
        rates.set(menu.coefficientRates, index * 45)
        errors.set(menu.errors, index * 45)
        counts.set(menu.nonzeroCounts, index * 135)
        dcRates.set(menu.dcRates, index * 3)
        oldCounts.set(menu.baselineCounts, index * 48)
        dc.set(menu.compactDc, index * 144)
        if (oldMagnitudes && oldConditional) {
          oldMagnitudes[index] = menu.baselineMagnitudeRate ?? 0
          oldConditional[index] = menu.baselineConditionalRate ?? 0
        }
        oldRates[index] = menu.baselineCoefficientRate
        oldErrors[index] = menu.baselineError
        baselineError += menu.baselineError
        added++
      },
      finalize() {
        live()
        requireValue(!finalized && added === windows, 'incomplete large transform menus')
        // Every supplied full-window leader must occur in the learned histogram.
        // Additional counts belong to fixed/edge leaders and remain in the model.
        for (let i = 0; i < 768; i++) costs[i] = histogram[i] ?? 0
        for (let i = 0; i < oldCounts.length; i++) {
          const n = oldCounts[i] ?? absentCount
          if (n === absentCount) continue
          const packed = countToken(n, i % 3),
            at = (i % 3) * 256 + (packed & 255)
          requireValue((costs[at] ?? 0) >= 1, 'missing original large transform count training')
          costs[at] = (costs[at] ?? 0) - 1
        }
        for (let channel = 0; channel < 3; channel++)
          for (let token = 0; token < 256; token++)
            costs[channel * 256 + token] = Math.log2(
              ((totals[channel] ?? 0) + 256) / ((histogram[channel * 256 + token] ?? 0) + 1),
            )
        baselineRate = 0
        for (let window = 0; window < windows; window++) {
          let oldRate = oldRates[window] ?? 0,
            countRate = 0
          for (let slot = 0; slot < 16; slot++)
            for (let channel = 0; channel < 3; channel++) {
              const n = oldCounts[(window * 16 + slot) * 3 + channel] ?? absentCount
              if (n !== absentCount) {
                const cost = countCost(n, channel)
                oldRate += cost
                countRate += cost
              }
            }
          normalizationBaselineRate += oldRate
          const objectiveRate =
            oldConditional && oldMagnitudes
              ? (oldConditional[window] ?? 0) +
                countRate +
                (oldRate - countRate - (oldMagnitudes[window] ?? 0))
              : oldRate
          oldRates[window] = objectiveRate
          baselineRate += objectiveRate
          for (let choice = 0; choice < 45; choice++) {
            const at = window * 45 + choice
            let rate = rates[at] ?? 0
            for (let channel = 0; channel < 3; channel++)
              rate += countCost(counts[at * 3 + channel] ?? 0, channel)
            rates[at] = rate
          }
        }
        requireValue(
          baselineRate >= 0 &&
            Number.isFinite(baselineRate) &&
            baselineError >= 0 &&
            Number.isFinite(baselineError),
          'invalid large transform baseline objective',
        )
        finalized = true
      },
      select(multiplier, check) {
        live()
        requireValue(
          finalized && Number.isFinite(multiplier) && (coherent ? multiplier >= 0 : multiplier > 0),
          'invalid large transform selection multiplier',
        )
        const lambda =
          baselineError === 0
            ? 0
            : ((coherent ? normalizationBaselineRate : baselineRate) / baselineError) * multiplier
        requireValue(Number.isFinite(lambda), 'invalid large transform objective scale')
        const output: ArrayBufferView[] = []
        try {
          const strategy = memory.allocate(Uint8Array, baselineQ.length)
          output.push(strategy)
          const first = memory.allocate(Uint8Array, baselineQ.length)
          output.push(first)
          const blocksX = memory.allocate(Uint8Array, baselineQ.length)
          output.push(blocksX)
          const blocksY = memory.allocate(Uint8Array, baselineQ.length)
          output.push(blocksY)
          const quantizationMap = memory.allocate(Int32Array, baselineQ.length)
          output.push(quantizationMap)
          const compactDc = memory.allocate(Int32Array, windows * 48)
          output.push(compactDc)
          quantizationMap.set(baselineQ)
          let selected = 0,
            selectedVertical = 0,
            selectedHorizontal = 0,
            selectedSquare = 0
          let selectedRate = 0,
            selectedError = 0
          for (let window = 0; window < windows; window++) {
            check?.()
            // Exact original reconstruction has no meaningful rate/error scale.
            if (baselineError === 0) {
              selectedRate += oldRates[window] ?? 0
              continue
            }
            let bestRate = oldRates[window] ?? 0,
              bestError = oldErrors[window] ?? 0
            let bestScore = bestRate + lambda * bestError,
              family = -1,
              q0 = 0,
              q1 = 0
            for (let orientation = 0; orientation < 2; orientation++) {
              let rate = dcRates[window * 3 + orientation] ?? 0,
                error = 0,
                firstQ = 4,
                secondQ = 4
              for (let half = 0; half < 2; half++) {
                let best = Infinity,
                  chosen = 0
                for (let qi = 0; qi < 9; qi++) {
                  const at = window * 45 + orientation * 18 + half * 9 + qi
                  const score = (rates[at] ?? 0) + lambda * (errors[at] ?? 0)
                  if (score < best) {
                    best = score
                    chosen = qi
                  }
                }
                const at = window * 45 + orientation * 18 + half * 9 + chosen
                rate += rates[at] ?? 0
                error += errors[at] ?? 0
                if (half === 0) firstQ = jpegXlLargeQuantizers[chosen] ?? 4
                else secondQ = jpegXlLargeQuantizers[chosen] ?? 4
              }
              const score = rate + lambda * error
              if (score < bestScore) {
                bestScore = score
                bestRate = rate
                bestError = error
                family = orientation
                q0 = firstQ
                q1 = secondQ
              }
            }
            for (let qi = 0; qi < 9; qi++) {
              const at = window * 45 + 36 + qi,
                rate = (rates[at] ?? 0) + (dcRates[window * 3 + 2] ?? 0)
              const error = errors[at] ?? 0,
                score = rate + lambda * error
              if (score < bestScore) {
                bestScore = score
                bestRate = rate
                bestError = error
                family = 2
                q0 = jpegXlLargeQuantizers[qi] ?? 4
                q1 = q0
              }
            }
            selectedRate += bestRate
            selectedError += bestError
            if (family < 0) continue
            selected++
            if (family === 0) selectedVertical++
            else if (family === 1) selectedHorizontal++
            else selectedSquare++
            compactDc.set(
              dc.subarray(window * 144 + family * 48, window * 144 + family * 48 + 48),
              window * 48,
            )
            const bx = (window % across) * 4,
              by = Math.floor(window / across) * 4
            const bw = family === 0 ? 2 : 4,
              bh = family === 1 ? 2 : 4
            for (let half = 0; half < (family === 2 ? 1 : 2); half++) {
              const ox = family === 0 ? half * 2 : 0,
                oy = family === 1 ? half * 2 : 0
              for (let dy = 0; dy < bh; dy++)
                for (let dx = 0; dx < bw; dx++) {
                  const at = (by + oy + dy) * blocksWide + bx + ox + dx
                  strategy[at] = family === 2 ? 5 : family === 0 ? 10 : 11
                  first[at] = dx === 0 && dy === 0 ? 1 : 0
                  blocksX[at] = bw
                  blocksY[at] = bh
                  quantizationMap[at] = half === 0 ? q0 : q1
                }
            }
          }
          let closed = false
          return {
            map: { width: blocksWide, height: blocksHigh, strategy, first, blocksX, blocksY },
            quantizationMap,
            compactDc,
            stats: {
              windows,
              selected,
              selectedVertical,
              selectedHorizontal,
              selectedSquare,
              baselineRate,
              baselineError,
              selectedRate,
              selectedError,
              lambda,
              lambdaMultiplier: multiplier,
            },
            release() {
              if (!closed) {
                for (const view of output) memory.release(view)
                closed = true
              }
            },
          }
        } catch (error) {
          for (const view of output) memory.release(view)
          throw error
        }
      },
      *selectOriginalBudget(check) {
        live()
        requireValue(
          coherent && finalized,
          'Original error budget requires finalized coherent menus',
        )
        let pending: JpegXlLargeSelection | undefined
        const evaluate = (multiplier: number): JpegXlLargeSelectionStats => {
          pending = this.select(multiplier, check)
          const stats = pending.stats
          pending.release()
          pending = undefined
          return stats
        }
        try {
          const initial = evaluate(1)
          yield
          if (
            initial.baselineError === 0 ||
            initial.baselineRate === 0 ||
            initial.lambda === 0 ||
            initial.selectedError > initial.baselineError
          )
            return undefined
          const budget = initial.baselineError
          let best = initial
          evaluate(1)
          yield
          let low = evaluate(0),
            high = initial
          yield
          if (low.selectedError <= budget && low.selectedRate < best.selectedRate) best = low
          if (low.selectedError > budget) {
            for (let i = 0; i < 64; i++) {
              const midpoint = (low.lambdaMultiplier + high.lambdaMultiplier) / 2
              if (midpoint === low.lambdaMultiplier || midpoint === high.lambdaMultiplier) break
              const point = evaluate(midpoint)
              yield
              if (point.selectedError <= budget) {
                high = point
                if (point.selectedRate < best.selectedRate) best = point
              } else low = point
            }
          }
          if (best.selectedRate >= initial.baselineRate || best.selected === 0) return undefined
          pending = this.select(best.lambdaMultiplier, check)
          requireValue(
            pending.stats.selectedError <= budget &&
              pending.stats.selectedRate < initial.baselineRate,
            'Original error budget is infeasible',
          )
          const result = pending
          pending = undefined
          return result
        } finally {
          pending?.release()
        }
      },
      release() {
        if (!released) {
          for (const view of held) memory.release(view)
          released = true
        }
      },
    }
  } catch (error) {
    for (const view of held) memory.release(view)
    throw error
  }
}

/** Coefficient magnitude proxy used to normalize the COUNT selector. */
export function jpegXlLargeCoefficientRate(value: number): number {
  return value === 0 ? 0 : 1 + 2 * Math.log2(1 + Math.abs(value))
}

/** Caller supplies 34×34 interleaved linear RGB, with a replicated one-pixel halo,
 * the first-party forward matrix and per-cell CfL X ratios. No source is retained. */
export function fillJpegXlLargeSourceWeights(
  linearRgb: Float64Array,
  matrix: Float64Array,
  correlationX: Float64Array,
  output: Float32Array,
): void {
  requireValue(
    linearRgb.length === 34 * 34 * 3 &&
      matrix.length === 9 &&
      correlationX.length === 16 &&
      output.length === 16,
    'invalid large transform source tile',
  )
  const adaptation = 1 / 256,
    bias = 0.0037930732552754493
  // The caller provides linear conversion once for the complete source tile.
  const light = (x: number, y: number): number => {
    const at = (y * 34 + x) * 3,
      r = linearRgb[at] ?? 0,
      g = linearRgb[at + 1] ?? 0,
      b = linearRgb[at + 2] ?? 0
    return Math.log(
      (((matrix[0] ?? 0) + (matrix[3] ?? 0)) * r) / 2 +
        (((matrix[1] ?? 0) + (matrix[4] ?? 0)) * g) / 2 +
        (((matrix[2] ?? 0) + (matrix[5] ?? 0)) * b) / 2 +
        adaptation,
    )
  }
  for (let by = 0; by < 4; by++)
    for (let bx = 0; bx < 4; bx++) {
      const cell = by * 4 + bx,
        rx = correlationX[cell] ?? 0
      let response = 0,
        curvature = 0
      for (let y = by * 8 + 1; y <= by * 8 + 8; y++)
        for (let x = bx * 8 + 1; x <= bx * 8 + 8; x++) {
          const at = (y * 34 + x) * 3,
            r = linearRgb[at] ?? 0,
            g = linearRgb[at + 1] ?? 0,
            b = linearRgb[at + 2] ?? 0
          const lr = (matrix[0] ?? 0) * r + (matrix[1] ?? 0) * g + (matrix[2] ?? 0) * b
          const lg = (matrix[3] ?? 0) * r + (matrix[4] ?? 0) * g + (matrix[5] ?? 0) * b
          const vr = Math.cbrt(lr + bias),
            vg = Math.cbrt(lg + bias)
          const derivative = 1.5 * ((1 + rx) * vr * vr + (1 - rx) * vg * vg)
          response += Math.log(((lr + lg) / 2 + adaptation) / derivative) / 64
          const center = light(x, y)
          curvature +=
            (Math.abs(2 * center - light(x - 1, y) - light(x + 1, y)) +
              Math.abs(2 * center - light(x, y - 1) - light(x, y + 1))) /
            64
        }
      const weight = Math.exp(0.5 * response - 0.25 * Math.log1p(curvature / adaptation))
      requireValue(
        Number.isFinite(weight) &&
          weight > 0 &&
          Number.isFinite(Math.fround(weight)) &&
          Math.fround(weight) > 0,
        'invalid large transform source weight',
      )
      output[cell] = weight
    }
}

export function poolJpegXlLargeSourceWeights(weights: Float32Array): number {
  requireValue(weights.length === 16, 'invalid large transform source weights')
  let mean = 0
  for (const weight of weights) {
    requireValue(Number.isFinite(weight) && weight > 0, 'invalid large transform source weight')
    mean += weight / 16
  }
  return Math.fround(mean)
}
