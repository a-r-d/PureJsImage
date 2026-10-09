import type { CoherentCoefficientModel } from './jpegxl-vardct-coefficient-model.ts'
import { invalidJpegXlInput } from './jpegxl-errors.ts'
import type { JpegXlEncoderMemory } from './jpegxl-encoder-memory.ts'
import {
  forwardJpegXlDct8,
  forwardJpegXlDct16,
  forwardJpegXlDctHalves,
  forwardJpegXlHornuss,
} from './jpegxl-vardct-forward-transforms.ts'
import {
  forwardJpegXlDct32,
  forwardJpegXlRectangle32,
  quantizeJpegXlDct32Dc,
  quantizeJpegXlRectangle32Dc,
} from './jpegxl-vardct-large-transforms.ts'
import { jpegXlLargeQuantizers, type JpegXlLargeWindowMenu } from './jpegxl-vardct-large-select.ts'
import {
  defaultJpegXlDct8Dequantization,
  defaultJpegXlDct16Dequantization,
  defaultJpegXlDct32Dequantization,
  defaultJpegXlRectangle32Dequantization,
  defaultJpegXlHornussDequantization,
  defaultJpegXlDct4x8Dequantization,
  defaultJpegXlQuantizationBiases,
} from './jpegxl-vardct-quantization.ts'

type Planes = readonly [Float64Array, Float64Array, Float64Array]
type SourcePlanes = readonly [Float32Array, Float32Array, Float32Array]
export interface JpegXlLargeMenuInput {
  readonly memory: JpegXlEncoderMemory
  readonly coherent?: {
    readonly model: CoherentCoefficientModel
    readonly canonicalOrders: readonly Uint32Array[]
  }
  readonly blocksWide: number
  readonly blocksHigh: number
  readonly globalScale: number
  readonly strategyMap: Int32Array
  readonly quantizationMap: Int32Array
  /** Original compact words in physical channel order X, Y, BminusY, before CfL. */
  readonly dc: readonly [Int32Array, Int32Array, Int32Array]
  readonly dcFactors: readonly [number, number, number]
  readonly correlationX: Int32Array
  readonly correlationB: Int32Array
  readonly smoothDc: boolean
  /** Borrowed 8x8 planes; consumed before the next call. */
  readonly fill8: (correlated: boolean, x: number, y: number) => SourcePlanes
  readonly quantizeAc: (value: number, channel: number) => number
  readonly fillWeights: (x: number, y: number, output: Float32Array) => void
  readonly learnBaselineCount: (nonzero: number, channel: number) => void
  readonly addWindow: (index: number, menu: JpegXlLargeWindowMenu) => void
  readonly check: () => void
}
const basis = (n: number): Float64Array =>
  Float64Array.from(
    { length: n * n },
    (_, i) =>
      Math.sqrt(2 / n) *
      (Math.floor(i / n) === 0 ? Math.SQRT1_2 : 1) *
      Math.cos(((2 * (i % n) + 1) * Math.floor(i / n) * Math.PI) / (2 * n)),
  )
const b2 = basis(2),
  b4 = basis(4),
  b8 = basis(8),
  b16 = basis(16),
  b32 = basis(32)
const resample = (frequency: number, blocks: 2 | 4): number =>
  1 /
  (Math.cos((frequency * Math.PI) / (blocks * 16)) *
    Math.cos((frequency * Math.PI) / (blocks * 8)) *
    Math.cos((frequency * Math.PI) / (blocks * 4)))
const decoded = (value: number, channel: number): number =>
  value === 0
    ? 0
    : Math.abs(value) === 1
      ? Math.sign(value) * (defaultJpegXlQuantizationBiases[channel] ?? 1)
      : value - 0.145 / value
const rateToken = (value: number): number =>
  value === 0 ? 0 : 1 + 2 * Math.log2(1 + Math.abs(value))
const isLf = (position: number, strategy: number): boolean =>
  strategy === 4 ? position >>> 4 < 2 && (position & 15) < 2 : position === 0
const table = (strategy: number): readonly Float64Array[] =>
  strategy === 4
    ? defaultJpegXlDct16Dequantization
    : strategy === 0
      ? defaultJpegXlDct8Dequantization
      : strategy === 1
        ? defaultJpegXlHornussDequantization
        : defaultJpegXlDct4x8Dequantization
const requireValue = (condition: boolean, message: string): void => {
  if (!condition) throw invalidJpegXlInput(message)
}

function inverseSquare(
  coefficients: Float64Array,
  n: 8 | 16,
  output: Float64Array,
  scratch: Float64Array,
): void {
  const b = n === 8 ? b8 : b16
  for (let v = 0; v < n; v++)
    for (let x = 0; x < n; x++) {
      let sum = 0
      for (let h = 0; h < n; h++) sum += (coefficients[h * n + v] ?? 0) * (b[h * n + x] ?? 0)
      scratch[v * n + x] = sum
    }
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      let sum = 0
      for (let v = 0; v < n; v++) sum += (scratch[v * n + x] ?? 0) * (b[v * n + y] ?? 0)
      output[y * n + x] = sum * n
    }
}
function inverseSmall(
  strategy: number,
  coefficients: Float64Array,
  output: Float64Array,
  scratch: Float64Array,
  block: Float64Array,
): void {
  if (strategy === 0) {
    inverseSquare(coefficients, 8, output, scratch)
    return
  }
  if (strategy === 1) {
    for (let p = 0; p < 64; p++) scratch[p] = coefficients[p] ?? 0
    const a = scratch[0] ?? 0,
      b = scratch[1] ?? 0,
      c = scratch[8] ?? 0,
      d = scratch[9] ?? 0
    scratch[0] = a + b + c + d
    scratch[1] = a + b - c - d
    scratch[8] = a - b + c - d
    scratch[9] = a - b - c + d
    for (let cy = 0; cy < 2; cy++)
      for (let cx = 0; cx < 2; cx++) {
        const base = 64 + (cy * 2 + cx) * 16
        let residualSum = 0
        for (let y = 0; y < 4; y++)
          for (let x = 0; x < 4; x++) {
            const value = scratch[(cy + y * 2) * 8 + cx + x * 2] ?? 0
            scratch[base + y * 4 + x] = value
            if (x !== 0 || y !== 0) residualSum += value
          }
        const average = (scratch[base] ?? 0) - residualSum / 16
        scratch[base] = scratch[base + 5] ?? 0
        scratch[base + 5] = 0
        for (let i = 0; i < 16; i++) scratch[base + i] = (scratch[base + i] ?? 0) + average
        for (let y = 0; y < 4; y++)
          for (let x = 0; x < 4; x++)
            output[(cy * 4 + y) * 8 + cx * 4 + x] = scratch[base + y * 4 + x] ?? 0
      }
    return
  }
  requireValue(strategy === 12 || strategy === 13, 'Unsupported large-menu original transform')
  const width = strategy === 12 ? 8 : 4,
    height = strategy === 12 ? 4 : 8,
    hb = width === 8 ? b8 : b4,
    vb = height === 8 ? b8 : b4
  for (let half = 0; half < 2; half++) {
    block[0] = (coefficients[0] ?? 0) + (half === 0 ? 1 : -1) * (coefficients[8] ?? 0)
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 8; x++)
        if (x !== 0 || y !== 0) block[y * 8 + x] = coefficients[(half + y * 2) * 8 + x] ?? 0
    for (let v = 0; v < height; v++)
      for (let x = 0; x < width; x++) {
        let sum = 0
        for (let h = 0; h < width; h++)
          sum +=
            (block[height >= width ? h * height + v : v * width + h] ?? 0) *
            (hb[h * width + x] ?? 0)
        scratch[v * width + x] = sum
      }
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        let sum = 0
        for (let v = 0; v < height; v++)
          sum += (scratch[v * width + x] ?? 0) * (vb[v * height + y] ?? 0)
        output[(y + (strategy === 12 ? half * 4 : 0)) * 8 + x + (strategy === 13 ? half * 4 : 0)] =
          sum * Math.sqrt(32)
      }
  }
}
function forwardPhysical(
  samples: Float64Array,
  horizontal: boolean,
  square: boolean,
  output: Float64Array,
  scratch: Float64Array,
): void {
  if (square) {
    for (let y = 0; y < 32; y++)
      for (let h = 0; h < 32; h++) {
        let sum = 0
        for (let x = 0; x < 32; x++) sum += (samples[y * 32 + x] ?? 0) * (b32[h * 32 + x] ?? 0)
        scratch[y * 32 + h] = sum
      }
    for (let h = 0; h < 32; h++)
      for (let v = 0; v < 32; v++) {
        let sum = 0
        for (let y = 0; y < 32; y++) sum += (scratch[y * 32 + h] ?? 0) * (b32[v * 32 + y] ?? 0)
        output[h * 32 + v] = sum / 32
      }
  } else {
    const row = horizontal ? 32 : 1,
      column = horizontal ? 1 : 16
    for (let s = 0; s < 16; s++)
      for (let l = 0; l < 32; l++) {
        let sum = 0
        for (let p = 0; p < 32; p++)
          sum += (samples[s * row + p * column] ?? 0) * (b32[l * 32 + p] ?? 0)
        scratch[s * 32 + l] = sum
      }
    for (let s = 0; s < 16; s++)
      for (let l = 0; l < 32; l++) {
        let sum = 0
        for (let p = 0; p < 16; p++) sum += (scratch[p * 32 + l] ?? 0) * (b16[s * 16 + p] ?? 0)
        output[s * 32 + l] = sum / Math.sqrt(512)
      }
  }
}
function insertLf(dc: Float64Array, output: Float64Array, strategy: 4 | 5 | 10 | 11): void {
  const width = strategy === 10 || strategy === 4 ? 2 : 4,
    height = strategy === 11 || strategy === 4 ? 2 : 4
  for (let h = 0; h < (strategy === 10 || strategy === 11 ? 2 : width); h++)
    for (let v = 0; v < (strategy === 10 || strategy === 11 ? 4 : height); v++) {
      let sum = 0
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          if (strategy === 10 || strategy === 11) {
            // Preserve short-axis then long-axis product order in both orientations.
            sum +=
              (dc[y * width + x] ?? 0) *
              (b2[h * 2 + (strategy === 11 ? y : x)] ?? 0) *
              (b4[v * 4 + (strategy === 11 ? x : y)] ?? 0)
          } else {
            sum +=
              (dc[y * width + x] ?? 0) *
              ((width === 2 ? b2 : b4)[h * width + x] ?? 0) *
              ((height === 2 ? b2 : b4)[v * height + y] ?? 0)
          }
        }
      const at = strategy === 4 ? h * 16 + v : h * 32 + v
      output[at] =
        (sum / Math.sqrt(width * height)) *
        resample(h, strategy === 5 ? 4 : 2) *
        resample(v, strategy === 4 ? 2 : 4)
    }
}

/** Build borrowed per-window menus without retaining source or AC planes. The caller
 * copies each menu before resuming and freezes its count model only after completion. */
export function* prepareJpegXlLargeMenus(
  input: JpegXlLargeMenuInput,
): Generator<void, void, undefined> {
  const {
    memory,
    blocksWide: wide,
    blocksHigh: high,
    globalScale,
    strategyMap,
    quantizationMap,
    dc: rawDc,
    dcFactors: factors,
  } = input
  const cells = wide * high
  requireValue(
    Number.isSafeInteger(wide) &&
      wide >= 4 &&
      Number.isSafeInteger(high) &&
      high >= 4 &&
      Number.isSafeInteger(cells),
    'Invalid large-menu grid',
  )
  requireValue(
    strategyMap.length === cells &&
      quantizationMap.length === cells &&
      rawDc.every((plane) => plane.length === cells),
    'Invalid large-menu baseline extent',
  )
  requireValue(
    Number.isFinite(globalScale) &&
      globalScale > 0 &&
      factors.every((f) => Number.isFinite(f) && f > 0),
    'Invalid large-menu precision',
  )
  const held: ArrayBufferView[] = [],
    own = <T extends ArrayBufferView>(view: T): T => {
      held.push(view)
      return view
    }
  const f64 = (size: number): Float64Array => own(memory.allocate(Float64Array, size)),
    f32 = (size: number): Float32Array => own(memory.allocate(Float32Array, size)),
    i32 = (size: number): Int32Array => own(memory.allocate(Int32Array, size)),
    u16 = (size: number): Uint16Array => own(memory.allocate(Uint16Array, size))
  const doubles = (size: number): Planes => [f64(size), f64(size), f64(size)],
    floats = (size: number): SourcePlanes => [f32(size), f32(size), f32(size)]
  try {
    const coherent = input.coherent
    const integers = coherent ? own(memory.allocate(Int16Array, 1024)) : undefined
    const cost = coherent ? f64(6) : undefined
    const price = (strategy: number, channel: number): number => {
      if (!coherent || !integers || !cost) throw invalidJpegXlInput('Missing coherent menu storage')
      const index =
        strategy === 5
          ? 10
          : strategy === 10 || strategy === 11
            ? 9
            : (strategy === 4 ? 6 : strategy === 0 ? 0 : 3) + channel
      const order = coherent.canonicalOrders[index]
      if (!order) throw invalidJpegXlInput('Missing coherent canonical order')
      coherent.model.estimateInto(
        integers,
        order,
        strategy === 5 ? 16 : strategy === 10 || strategy === 11 ? 8 : strategy === 4 ? 4 : 1,
        channel === 1 ? 0 : channel === 0 ? 1 : 2,
        0,
        cost,
      )
      return cost[0] ?? 0
    }
    const source = doubles(1024),
      baseline = doubles(1024),
      coefficients = doubles(1024),
      spatial = doubles(512),
      sourceCoefficients = doubles(1024),
      physicalHalf = doubles(1024)
    const rawPair = [floats(512), floats(512)] as const,
      transformedPair = [floats(512), floats(512)] as const,
      squareRaw = floats(1024),
      squareTransformed = floats(1024),
      originalRaw = floats(256),
      originalTransformed = floats(256)
    const smallTransformed = floats(64),
      smallIntermediate = f32(64),
      forwardScratch = f32(1024),
      doubleScratch = f64(1024),
      inverseScratch = f64(1024),
      smallBlock = f64(32),
      weights = f32(16),
      halo = doubles(36),
      smooth = doubles(36),
      compactPhysical = f64(16),
      compactWords = i32(16),
      dcWords = i32(48)
    const rectangleScratch = forwardScratch.subarray(0, 512),
      originalScratch = forwardScratch.subarray(0, 256)
    const coefficientRates = f64(45),
      errors = f64(45),
      nonzeroCounts = u16(135),
      dcRates = f64(3),
      baselineCounts = u16(48),
      compactDc = i32(144)
    const transformOriginal = (x: number, y: number, strategy: number): SourcePlanes => {
      requireValue(
        strategy === 0 || strategy === 1 || strategy === 4 || strategy === 12 || strategy === 13,
        'Unsupported large-menu original strategy',
      )
      if (strategy === 4) {
        for (let dy = 0; dy < 2; dy++)
          for (let dx = 0; dx < 2; dx++) {
            const planes = input.fill8(true, x + dx, y + dy)
            for (let c = 0; c < 3; c++)
              for (let py = 0; py < 8; py++)
                for (let px = 0; px < 8; px++)
                  originalRaw[c]![(dy * 8 + py) * 16 + dx * 8 + px] = planes[c]?.[py * 8 + px] ?? 0
          }
        for (let c = 0; c < 3; c++)
          forwardJpegXlDct16(originalRaw[c]!, originalScratch, originalTransformed[c]!)
        return originalTransformed
      }
      const planes = input.fill8(true, x, y)
      for (let c = 0; c < 3; c++) {
        const plane = planes[c]!,
          output = smallTransformed[c]!
        if (strategy === 1) forwardJpegXlHornuss(plane, output)
        else if (strategy === 12 || strategy === 13)
          forwardJpegXlDctHalves(plane, smallIntermediate, output, strategy === 13)
        else forwardJpegXlDct8(plane, smallIntermediate, output)
      }
      return smallTransformed
    }
    const dcRate = (bx: number, by: number, replacement: Int32Array | undefined): number => {
      let rate = 0
      const value = (c: number, x: number, y: number): number =>
        replacement && x >= bx && x < bx + 4 && y >= by && y < by + 4
          ? (replacement[c * 16 + (y - by) * 4 + x - bx] ?? 0)
          : (rawDc[c]?.[Math.max(0, y) * wide + Math.max(0, x)] ?? 0)
      for (let c = 0; c < 3; c++)
        for (let y = by; y < by + 4; y++)
          for (let x = bx; x < bx + 4; x++) {
            const left = x > 0 ? value(c, x - 1, y) : y > 0 ? value(c, x, y - 1) : 0,
              top = y > 0 ? value(c, x, y - 1) : left,
              topLeft = x > 0 && y > 0 ? value(c, x - 1, y - 1) : left
            const prediction = Math.max(
              Math.min(left, top),
              Math.min(Math.max(left, top), left + top - topLeft),
            )
            rate += rateToken(value(c, x, y) - prediction)
          }
      return rate
    }
    const fillHalo = (bx: number, by: number, replacement: Int32Array | undefined): void => {
      for (let hy = 0; hy < 6; hy++)
        for (let hx = 0; hx < 6; hx++) {
          const x = Math.max(0, Math.min(wide - 1, bx + hx - 1)),
            y = Math.max(0, Math.min(high - 1, by + hy - 1)),
            inside = hx >= 1 && hx <= 4 && hy >= 1 && hy <= 4
          for (let c = 0; c < 3; c++)
            halo[c]![hy * 6 + hx] =
              (replacement && inside
                ? (replacement[c * 16 + (hy - 1) * 4 + hx - 1] ?? 0)
                : (rawDc[c]?.[y * wide + x] ?? 0)) * (factors[c] ?? 0)
          halo[2][hy * 6 + hx] = (halo[2][hy * 6 + hx] ?? 0) + (halo[1][hy * 6 + hx] ?? 0)
        }
      if (input.smoothDc) {
        const side = 0.20345139757231578,
          corner = 0.0334829185968739,
          center = 1 - 4 * (side + corner)
        for (let c = 0; c < 3; c++) smooth[c]!.set(halo[c]!)
        for (let y = 1; y < 5; y++)
          for (let x = 1; x < 5; x++) {
            const at = y * 6 + x
            let gap = 0.5
            for (let c = 0; c < 3; c++) {
              const plane = halo[c]!,
                value =
                  (plane[at] ?? 0) * center +
                  ((plane[at - 1] ?? 0) +
                    (plane[at + 1] ?? 0) +
                    (plane[at - 6] ?? 0) +
                    (plane[at + 6] ?? 0)) *
                    side +
                  ((plane[at - 7] ?? 0) +
                    (plane[at - 5] ?? 0) +
                    (plane[at + 5] ?? 0) +
                    (plane[at + 7] ?? 0)) *
                    corner
              smooth[c]![at] = value
              gap = Math.max(gap, Math.abs(((plane[at] ?? 0) - value) / (factors[c] ?? 1)))
            }
            const mix = Math.max(0, 3 - 4 * gap)
            for (let c = 0; c < 3; c++)
              smooth[c]![at] =
                (halo[c]?.[at] ?? 0) + ((smooth[c]?.[at] ?? 0) - (halo[c]?.[at] ?? 0)) * mix
          }
        for (let c = 0; c < 3; c++) halo[c]!.set(smooth[c]!)
      }
      for (let dy = 0; dy < 4; dy++)
        for (let dx = 0; dx < 4; dx++)
          if (bx + dx === 0 || by + dy === 0 || bx + dx === wide - 1 || by + dy === high - 1) {
            const at = (dy + 1) * 6 + dx + 1
            for (let c = 0; c < 3; c++)
              halo[c]![at] =
                (replacement
                  ? (replacement[c * 16 + dy * 4 + dx] ?? 0)
                  : (rawDc[c]?.[(by + dy) * wide + bx + dx] ?? 0)) * (factors[c] ?? 0)
            halo[2][at] = (halo[2][at] ?? 0) + (halo[1][at] ?? 0)
          }
    }
    const saveDc = (family: number): void => {
      for (let c = 0; c < 3; c++)
        for (let p = 0; p < 16; p++)
          compactDc[family * 48 + (c === 0 ? 1 : c === 1 ? 0 : 2) * 16 + p] =
            dcWords[c * 16 + p] ?? 0
    }
    const physicalError = (count: number, weight: number): number => {
      let sum = 0
      for (let p = 0; p < count; p++) {
        const ex = (sourceCoefficients[0][p] ?? 0) - (coefficients[0][p] ?? 0),
          ey = (sourceCoefficients[1][p] ?? 0) - (coefficients[1][p] ?? 0),
          eb = (sourceCoefficients[2][p] ?? 0) - (coefficients[2][p] ?? 0)
        sum += (ey + ex) ** 2 + (ey - ex) ** 2 + eb ** 2
      }
      return sum * count * weight
    }
    let window = 0
    for (let by = 0; by + 4 <= high; by += 4)
      for (let bx = 0; bx + 4 <= wide; bx += 4) {
        input.check()
        input.fillWeights(bx, by, weights)
        baselineCounts.fill(65535)
        fillHalo(bx, by, undefined)
        const tile = Math.floor(by / 8) * Math.ceil(wide / 8) + Math.floor(bx / 8),
          rx = (input.correlationX[tile] ?? 0) / 84,
          rb = (input.correlationB[tile] ?? 0) / 84
        let baselineCoefficientRate = dcRate(bx, by, undefined),
          baselineMagnitudeRate = 0,
          baselineConditionalRate = 0
        for (let dy = 0; dy < 4; dy++)
          for (let dx = 0; dx < 4; dx++) {
            const x = bx + dx,
              y = by + dy,
              index = y * wide + x,
              source8 = input.fill8(false, x, y)
            for (let p = 0; p < 64; p++) {
              const at = (dy * 8 + (p >>> 3)) * 32 + dx * 8 + (p & 7),
                sy = source8[1][p] ?? 0
              source[0][at] = source8[0][p] ?? 0
              source[1][at] = sy
              source[2][at] = (source8[2][p] ?? 0) + sy
            }
            const strategy = strategyMap[index] ?? -1
            if (strategy === 4 && (dx % 2 !== 0 || dy % 2 !== 0)) continue
            const transformed = transformOriginal(x, y, strategy),
              n = strategy === 4 ? 16 : 8,
              count = n * n,
              q = quantizationMap[index] ?? 0
            requireValue(q > 0, 'Invalid original large-menu quantizer')
            for (let c = 0; c < 3; c++) {
              const coeff = coefficients[c]!,
                matrix = table(strategy)[c]!
              coeff.fill(0)
              integers?.fill(0)
              let nonzero = 0
              const scale = 65536 / globalScale / q
              for (let p = 0; p < count; p++)
                if (!isLf(p, strategy)) {
                  const step = scale * (matrix[p] ?? 0),
                    value = input.quantizeAc((transformed[c]?.[p] ?? 0) / step, c)
                  requireValue(Math.abs(value) <= 4095, 'Original large-menu AC range')
                  baselineCoefficientRate += rateToken(value)
                  if (integers) {
                    baselineMagnitudeRate += rateToken(value)
                    integers[p] = value
                  }
                  if (value !== 0) nonzero++
                  coeff[p] = decoded(value, c) * step
                }
              if (coherent) baselineConditionalRate += price(strategy, c)
              baselineCounts[(dy * 4 + dx) * 3 + c] = nonzero
              input.learnBaselineCount(nonzero, c)
            }
            for (let p = 0; p < count; p++)
              if (!isLf(p, strategy)) {
                const sy = coefficients[1][p] ?? 0
                coefficients[0][p] = (coefficients[0][p] ?? 0) + rx * sy
                coefficients[2][p] = (coefficients[2][p] ?? 0) + (1 + rb) * sy
              }
            for (let c = 0; c < 3; c++) {
              const coeff = coefficients[c]!,
                output = spatial[c]!
              if (strategy === 4) {
                for (let iy = 0; iy < 2; iy++)
                  for (let ix = 0; ix < 2; ix++)
                    compactPhysical[iy * 2 + ix] = halo[c]?.[(dy + iy + 1) * 6 + dx + ix + 1] ?? 0
                insertLf(compactPhysical, coeff, 4)
                inverseSquare(coeff, 16, output, inverseScratch)
              } else {
                coeff[0] = halo[c]?.[(dy + 1) * 6 + dx + 1] ?? 0
                inverseSmall(strategy, coeff, output, inverseScratch, smallBlock)
              }
              for (let iy = 0; iy < n; iy++)
                for (let ix = 0; ix < n; ix++)
                  baseline[c]![(dy * 8 + iy) * 32 + dx * 8 + ix] = output[iy * n + ix] ?? 0
            }
          }
        let weight = 0
        for (let i = 0; i < 16; i++) {
          const w = weights[i] ?? 0
          requireValue(Number.isFinite(w) && w > 0, 'Invalid large-menu source weight')
          weight += w / 16
        }
        weight = Math.fround(weight)
        let baselineError = 0
        for (let i = 0; i < 1024; i++) {
          const ex = (source[0][i] ?? 0) - (baseline[0][i] ?? 0),
            ey = (source[1][i] ?? 0) - (baseline[1][i] ?? 0),
            eb = (source[2][i] ?? 0) - (baseline[2][i] ?? 0)
          baselineError += weight * ((ey + ex) ** 2 + (ey - ex) ** 2 + eb ** 2)
        }
        for (let orientation = 0; orientation < 2; orientation++) {
          const horizontal = orientation === 1,
            bw = horizontal ? 4 : 2,
            bh = horizontal ? 2 : 4,
            pixelWidth = bw * 8
          for (let half = 0; half < 2; half++) {
            const ox = horizontal ? 0 : half * 2,
              oy = horizontal ? half * 2 : 0,
              rawHalf = rawPair[half]!,
              transformed = transformedPair[half]!
            for (let c = 0; c < 3; c++)
              for (let y = 0; y < bh * 8; y++)
                for (let x = 0; x < pixelWidth; x++) {
                  const at = (oy * 8 + y) * 32 + ox * 8 + x
                  rawHalf[c]![y * pixelWidth + x] =
                    (source[c]?.[at] ?? 0) - (c === 2 ? (source[1][at] ?? 0) : 0)
                }
            for (let c = 0; c < 3; c++) {
              const raw = rawHalf[c]!,
                output = transformed[c]!
              forwardJpegXlRectangle32(raw, rectangleScratch, output, horizontal)
              quantizeJpegXlRectangle32Dc(output, factors[c] ?? 0, compactWords, 0, horizontal)
              for (let y = 0; y < bh; y++)
                for (let x = 0; x < bw; x++)
                  dcWords[c * 16 + (oy + y) * 4 + ox + x] = compactWords[y * bw + x] ?? 0
              if (c !== 1)
                for (let p = 0; p < 512; p++)
                  raw[p] = (raw[p] ?? 0) - (c === 0 ? rx : rb) * (rawHalf[1][p] ?? 0)
              forwardJpegXlRectangle32(raw, rectangleScratch, output, horizontal)
            }
          }
          fillHalo(bx, by, dcWords)
          dcRates[orientation] = dcRate(bx, by, dcWords)
          saveDc(orientation)
          for (let half = 0; half < 2; half++) {
            const ox = horizontal ? 0 : half * 2,
              oy = horizontal ? half * 2 : 0,
              transformed = transformedPair[half]!
            for (let c = 0; c < 3; c++) {
              for (let y = 0; y < bh * 8; y++)
                for (let x = 0; x < pixelWidth; x++)
                  physicalHalf[c]![y * pixelWidth + x] =
                    source[c]?.[(oy * 8 + y) * 32 + ox * 8 + x] ?? 0
              forwardPhysical(
                physicalHalf[c]!,
                horizontal,
                false,
                sourceCoefficients[c]!,
                doubleScratch,
              )
            }
            for (let qi = 0; qi < jpegXlLargeQuantizers.length; qi++) {
              const q = jpegXlLargeQuantizers[qi]!,
                at = orientation * 18 + half * 9 + qi
              let rate = 0
              for (let c = 0; c < 3; c++) {
                const coeff = coefficients[c]!,
                  matrix = defaultJpegXlRectangle32Dequantization[c]!,
                  scale = 65536 / globalScale / q
                coeff.fill(0)
                integers?.fill(0)
                let nonzero = 0
                for (let p = 0; p < 512; p++)
                  if (!(p >>> 5 < 2 && (p & 31) < 4)) {
                    const step = scale * (matrix[p] ?? 0),
                      value = input.quantizeAc((transformed[c]?.[p] ?? 0) / step, c)
                    requireValue(Math.abs(value) <= 4095, 'Rectangle large-menu AC range')
                    if (integers) integers[p] = value
                    else rate += rateToken(value)
                    if (value !== 0) nonzero++
                    coeff[p] = decoded(value, c) * step
                  }
                if (coherent) rate += price(horizontal ? 11 : 10, c)
                nonzeroCounts[at * 3 + c] = nonzero
              }
              for (let p = 0; p < 512; p++)
                if (!(p >>> 5 < 2 && (p & 31) < 4)) {
                  const sy = coefficients[1][p] ?? 0
                  coefficients[0][p] = (coefficients[0][p] ?? 0) + rx * sy
                  coefficients[2][p] = (coefficients[2][p] ?? 0) + (1 + rb) * sy
                }
              for (let c = 0; c < 3; c++) {
                for (let y = 0; y < bh; y++)
                  for (let x = 0; x < bw; x++)
                    compactPhysical[y * bw + x] = halo[c]?.[(oy + y + 1) * 6 + ox + x + 1] ?? 0
                insertLf(compactPhysical, coefficients[c]!, horizontal ? 11 : 10)
              }
              coefficientRates[at] = rate
              errors[at] = physicalError(512, weight)
            }
          }
        }
        for (let c = 0; c < 3; c++)
          for (let p = 0; p < 1024; p++)
            squareRaw[c]![p] = (source[c]?.[p] ?? 0) - (c === 2 ? (source[1][p] ?? 0) : 0)
        for (let c = 0; c < 3; c++) {
          const raw = squareRaw[c]!,
            output = squareTransformed[c]!
          forwardJpegXlDct32(raw, forwardScratch, output)
          quantizeJpegXlDct32Dc(output, factors[c] ?? 0, compactWords, 0)
          dcWords.set(compactWords, c * 16)
          if (c !== 1)
            for (let p = 0; p < 1024; p++)
              raw[p] = (raw[p] ?? 0) - (c === 0 ? rx : rb) * (squareRaw[1][p] ?? 0)
          forwardJpegXlDct32(raw, forwardScratch, output)
          forwardPhysical(source[c]!, false, true, sourceCoefficients[c]!, doubleScratch)
        }
        fillHalo(bx, by, dcWords)
        dcRates[2] = dcRate(bx, by, dcWords)
        saveDc(2)
        for (let qi = 0; qi < jpegXlLargeQuantizers.length; qi++) {
          const q = jpegXlLargeQuantizers[qi]!,
            at = 36 + qi
          let rate = 0
          for (let c = 0; c < 3; c++) {
            const coeff = coefficients[c]!,
              matrix = defaultJpegXlDct32Dequantization[c]!,
              scale = 65536 / globalScale / q
            coeff.fill(0)
            integers?.fill(0)
            let nonzero = 0
            for (let p = 0; p < 1024; p++)
              if (!(p >>> 5 < 4 && (p & 31) < 4)) {
                const step = scale * (matrix[p] ?? 0),
                  value = input.quantizeAc((squareTransformed[c]?.[p] ?? 0) / step, c)
                requireValue(Math.abs(value) <= 4095, 'Square large-menu AC range')
                if (integers) integers[p] = value
                else rate += rateToken(value)
                if (value !== 0) nonzero++
                coeff[p] = decoded(value, c) * step
              }
            if (coherent) rate += price(5, c)
            nonzeroCounts[at * 3 + c] = nonzero
          }
          for (let p = 0; p < 1024; p++)
            if (!(p >>> 5 < 4 && (p & 31) < 4)) {
              const sy = coefficients[1][p] ?? 0
              coefficients[0][p] = (coefficients[0][p] ?? 0) + rx * sy
              coefficients[2][p] = (coefficients[2][p] ?? 0) + (1 + rb) * sy
            }
          for (let c = 0; c < 3; c++) {
            for (let y = 0; y < 4; y++)
              for (let x = 0; x < 4; x++)
                compactPhysical[y * 4 + x] = halo[c]?.[(y + 1) * 6 + x + 1] ?? 0
            insertLf(compactPhysical, coefficients[c]!, 5)
          }
          coefficientRates[at] = rate
          errors[at] = physicalError(1024, weight)
        }
        input.addWindow(window++, {
          coefficientRates,
          errors,
          nonzeroCounts,
          dcRates,
          baselineCoefficientRate,
          ...(coherent ? { baselineMagnitudeRate, baselineConditionalRate } : {}),
          baselineError,
          baselineCounts,
          compactDc,
        })
        yield
      }
    const fullWidth = Math.floor(wide / 4) * 4,
      fullHeight = Math.floor(high / 4) * 4
    for (let y = 0; y < high; y++) {
      input.check()
      for (let x = 0; x < wide; x++) {
        if (x < fullWidth && y < fullHeight) continue
        const index = y * wide + x,
          strategy = strategyMap[index] ?? -1
        if (strategy === 4 && (x % 2 !== 0 || y % 2 !== 0)) continue
        const transformed = transformOriginal(x, y, strategy),
          count = strategy === 4 ? 256 : 64,
          q = quantizationMap[index] ?? 0
        requireValue(q > 0, 'Invalid edge large-menu quantizer')
        const scale = 65536 / globalScale / q
        for (let c = 0; c < 3; c++) {
          let nonzero = 0
          const matrix = table(strategy)[c]!
          for (let p = 0; p < count; p++)
            if (!isLf(p, strategy)) {
              const value = input.quantizeAc(
                (transformed[c]?.[p] ?? 0) / (scale * (matrix[p] ?? 0)),
                c,
              )
              requireValue(Math.abs(value) <= 4095, 'Edge large-menu AC range')
              if (value !== 0) nonzero++
            }
          input.learnBaselineCount(nonzero, c)
        }
      }
      if (fullWidth !== wide || y >= fullHeight) yield
    }
  } finally {
    for (const allocation of held) memory.release(allocation)
  }
}
