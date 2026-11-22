/**
 * Sources: libjxl-tiny encoder/enc_ac_strategy.cc at
 * 8eae18172059d54f5c734ca814f23b96eebff859; libjxl lib/jxl/enc_ac_strategy.cc
 * and tools/ssimulacra2.cc (SSIMMap structure term), v0.12.0,
 * a7a9c787341cf703dede03c2009fa460cae5e5df.
 * Copyright (c) the JPEG XL Project Authors. BSD-3-Clause
 * Changes: scalar TypeScript entropy and eighth-power spatial loss with
 * hierarchical selection over DCT8, DCT4, DCT2, Hornuss and 2x2/4x4 merges,
 * using our transforms, CfL, rate-aware rounding and writer. Selection scores
 * unscaled normative matrices and the sixteenth-norm quantizer; the final field
 * uses AdjustQuantField. First-party: a regularized luma detail term built from
 * 8x8 box moments and the SSIMULACRA2 structure denominator, admissible pruning,
 * Y-first evaluation, 64x64 tile traversal, bounded caches, signed-byte AC
 * storage and direct DC grid recovery. Not a metric implementation.
 */
import type { JpegXlEncoderMemory } from './jpegxl-encoder-memory.ts'
import { invalidJpegXlInput } from './jpegxl-errors.ts'
import type {
  JpegXlOrderFamily,
  VarDctCoefficientGeometry,
  VarDctCoefficientPlane,
} from './jpegxl-jpeg-encode.ts'
import {
  type JpegXlBlockSource,
  jpegXlLibjxlFrameParameters,
  jpegXlLibjxlInitialQuantField,
  jpegXlLibjxlTransformQuantization,
  raiseJpegXlLibjxlCoarsePrecision,
} from './jpegxl-libjxl-quant-field.ts'
import {
  forwardJpegXlLibjxlTransform,
  inverseJpegXlLibjxlTransform,
  jpegXlInverseGaborishSource,
  jpegXlLibjxlDcGrid,
  jpegXlSelectorTileCache,
  jpegXlSelectorTileMask,
} from './jpegxl-libjxl-transforms.ts'
import {
  jpegXlVarDctStrategyBlockHeights,
  jpegXlVarDctStrategyBlockWidths,
  naturalJpegXlCoefficientOrder,
} from './jpegxl-vardct-jpeg.ts'
import { defaultJpegXlQuantizationBiases } from './jpegxl-vardct-quantization.ts'
import { jpegXlDequantizationMatrices } from './jpegxl-vardct-render.ts'

/** Regularized SSIM-style structure loss of a luma error, from 8x8 box moments. */
const regularizedDetailLoss = (
  source: Float32Array,
  error: Float32Array,
  width: number,
  height: number,
  scale: number,
): number => {
  let total = 0
  for (let by = 0; by < height; by += 8)
    for (let bx = 0; bx < width; bx += 8) {
      let sum = 0,
        sumError = 0,
        square = 0,
        squareError = 0,
        cross = 0
      for (let y = 0; y < 8; y++)
        for (let x = 0; x < 8; x++) {
          const at = (by + y) * width + bx + x
          const value = source[at] ?? 0
          const residual = (error[at] ?? 0) * scale
          sum += value
          sumError += residual
          square += value * value
          squareError += residual * residual
          cross += value * residual
        }
      const variance = Math.max(0, square - (sum * sum) / 64)
      const errorVariance = Math.max(0, squareError - (sumError * sumError) / 64)
      const covariance = cross - (sum * sumError) / 64
      const reconstructed = Math.max(0, variance + errorVariance - 2 * covariance)
      const epsilon = 64 * 0.0009
      total += Math.min(1, errorVariance / (variance + reconstructed + epsilon))
    }
  return total / ((width * height) / 64)
}

/** Eighth-power masked spatial loss in row order. */
const maskedLoss = (
  spatial: Float32Array,
  mask: Float32Array,
  width: number,
  height: number,
  maskOrigin: number,
  maskOffset: number,
  channelWeight: number,
): number => {
  let loss = 0,
    p = 0
  for (let y = 0; y < height; y++) {
    let at = maskOrigin + y * 64
    for (let x = 0; x < width; x++, p++, at++) {
      let error = (spatial[p] ?? 0) * ((mask[at] ?? 1) + maskOffset) * channelWeight
      error *= error
      error *= error
      error *= error
      loss += error
    }
  }
  return loss
}

/** Coefficients in the largest menu transform, DCT32. */
const largestTransform = 1024

/** The single-block menu in scoring order, with libjxl's entropy multipliers. */
const smallMenu = [
  [3, 1.08],
  [2, 0.95],
  [1, 1.0427542510634957],
] as const

interface Selection {
  readonly strategies: Int32Array
  readonly first: Uint8Array
  readonly quantizationMap: Int32Array
}

const selectTransforms = (
  base: Readonly<VarDctCoefficientGeometry>,
  source: JpegXlBlockSource,
  maskSource: JpegXlBlockSource,
  field: Float32Array,
  distance: number,
  memory: JpegXlEncoderMemory,
): Selection => {
  const { blocksWide, blocksHigh } = base
  const globalScale = base.globalScale
  if (!globalScale) throw invalidJpegXlInput('libjxl selector global scale is missing')
  const blockCount = blocksWide * blocksHigh
  if (field.length !== blockCount) throw invalidJpegXlInput('libjxl selector field is invalid')
  const pairs = memory.allocate(Float64Array, 64)
  const strategies = memory.allocate(Int32Array, blockCount)
  const first = memory.allocate(Uint8Array, blockCount)
  first.fill(1)
  const costs = memory.allocate(Float64Array, blockCount)
  const losses = memory.allocate(Float64Array, blockCount)
  const planes = [
    memory.allocate(Float32Array, largestTransform),
    memory.allocate(Float32Array, largestTransform),
    memory.allocate(Float32Array, largestTransform),
  ]
  const transformed = [
    memory.allocate(Float64Array, largestTransform),
    memory.allocate(Float64Array, largestTransform),
    memory.allocate(Float64Array, largestTransform),
  ]
  const scratch = memory.allocate(Float64Array, largestTransform)
  const residual = memory.allocate(Float64Array, largestTransform)
  const spatial = memory.allocate(Float32Array, largestTransform)
  const active = memory.allocate(Uint16Array, 64)
  const ratio = (distance + 0.13731742964354549) / (1 + 0.13731742964354549)
  const infoWeight = 1.2 * ratio ** 0.33677806662454718
  const zeroWeight = 9.3089059022677905 * ratio ** 0.50990926717963703
  // With no nonzero ACs: bits = 1, ceilLog2(bits + 17) + bits = 6.
  const minimumEntropy = zeroWeight * 6
  const magnitudeWeight = 10.833273317067883 * ratio ** 0.36702940662370243
  const invGlobal = 65536 / globalScale
  const zeroThresholds = maskSource.zeroQuantizationThresholds
  const tileMask = jpegXlSelectorTileMask(maskSource, blocksWide, blocksHigh, memory)
  let maskOriginX = 0,
    maskOriginY = 0
  let lastLoss = 0
  let roundingX = -1,
    roundingY = -1

  const plans: ({
    readonly bw: number
    readonly bh: number
    readonly width: number
    readonly height: number
    readonly size: number
    readonly penalty: number
    readonly tables: readonly Float64Array[]
    readonly dcColumns: number
    readonly dcEnd: number
    readonly naturalWidth: number
    readonly errors: Float64Array
    readonly pixels: Float32Array
  } | null)[] = []
  const plan = (strategy: number) => {
    const existing = plans[strategy]
    if (existing) return existing
    const bw = jpegXlVarDctStrategyBlockWidths[strategy] ?? 0
    const bh = jpegXlVarDctStrategyBlockHeights[strategy] ?? 0
    const width = bw * 8,
      height = bh * 8,
      size = width * height,
      naturalWidth = Math.max(width, height)
    const created = {
      bw,
      bh,
      width,
      height,
      size,
      penalty: bw * bh >= 2 ? 1 + Math.min(3, (bw * bh) / 8) : 1,
      tables: jpegXlDequantizationMatrices(strategy),
      naturalWidth,
      dcColumns: Math.max(bw, bh),
      dcEnd: naturalWidth * Math.min(bw, bh),
      errors: residual.subarray(0, size),
      pixels: spatial.subarray(0, size),
    }
    plans[strategy] = created
    return created
  }

  // All scratch belongs to one candidate, independent of image area.
  const score = (
    x: number,
    y: number,
    strategy: number,
    entropyMultiplier: number,
    cutoff = Number.POSITIVE_INFINITY,
    sourcePrepared = false,
  ): number => {
    const {
      bw,
      bh,
      width,
      height,
      size,
      penalty,
      tables,
      naturalWidth,
      dcColumns,
      dcEnd,
      errors,
      pixels,
    } = plan(strategy)
    // Every single-block strategy reads the same source as the DCT8 baseline.
    if (!sourcePrepared)
      for (let dy = 0; dy < bh; dy++)
        for (let dx = 0; dx < bw; dx++) {
          const block = source.readBlock(x + dx, y + dy, false)
          for (let c = 0; c < 3; c++) {
            const from = block[c],
              target = planes[c]
            if (!from || !target) throw invalidJpegXlInput('libjxl selector plane is missing')
            if (width === 8 && from.length === 64) {
              target.set(from, dy * 64)
              continue
            }
            for (let py = 0; py < 8; py++) {
              const to = (dy * 8 + py) * width + dx * 8,
                at = py * 8
              target[to] = from[at] ?? 0
              target[to + 1] = from[at + 1] ?? 0
              target[to + 2] = from[at + 2] ?? 0
              target[to + 3] = from[at + 3] ?? 0
              target[to + 4] = from[at + 4] ?? 0
              target[to + 5] = from[at + 5] ?? 0
              target[to + 6] = from[at + 6] ?? 0
              target[to + 7] = from[at + 7] ?? 0
            }
          }
        }
    const quantizer = jpegXlLibjxlTransformQuantization(
      field,
      blocksWide,
      x,
      y,
      bw,
      bh,
      distance,
      true,
    )
    const lumaPlane = planes[1],
      lumaOutput = transformed[1]
    if (!lumaPlane || !lumaOutput) throw invalidJpegXlInput('libjxl selector scratch is missing')
    forwardJpegXlLibjxlTransform(strategy, lumaPlane, scratch, lumaOutput, pairs)
    const tile = Math.floor(y / 8) * Math.ceil(blocksWide / 8) + Math.floor(x / 8)
    const scale = invGlobal / quantizer
    let entropy = 0,
      loss = 0,
      lumaEntropy = 0,
      lumaLoss = 0,
      spatialBound = 0
    if (x !== roundingX || y !== roundingY) {
      // Only the unfiltered source read prepares the writer's rate-aware rounding state.
      maskSource.readBlock(x, y, true)
      roundingX = x
      roundingY = y
    }
    // Score Y first, then X and B, so luma bounds can prune chroma work.
    for (let channelIndex = 0; channelIndex < 3; channelIndex++) {
      const c = channelIndex < 2 ? channelIndex ^ 1 : channelIndex
      if (c !== 1) {
        const boundEntropy =
          (c === 0 ? lumaEntropy : entropy) + minimumEntropy * (c === 0 ? penalty + 1 : 1)
        if (entropyMultiplier * boundEntropy + spatialBound > cutoff * (1 + 1e-12)) {
          lastLoss = Number.POSITIVE_INFINITY
          return Number.POSITIVE_INFINITY
        }
        const plane = planes[c],
          output = transformed[c]
        if (!plane || !output) throw invalidJpegXlInput('libjxl deferred transform is missing')
        forwardJpegXlLibjxlTransform(strategy, plane, scratch, output, pairs)
      }
      const coefficients = transformed[c],
        luma = transformed[1],
        matrix = tables[c]
      if (!coefficients || !luma || !matrix)
        throw invalidJpegXlInput('libjxl selector coefficients are missing')
      // The leading zero keeps the signed-zero behavior of the reference arithmetic.
      const correlation =
        c === 0
          ? 0 + (base.correlationX?.[tile] ?? 0) / 84
          : c === 2
            ? 0 + (base.correlationB?.[tile] ?? 0) / 84
            : 0
      let nonzero = 0,
        channelEntropy = 0
      const dcMask = naturalWidth - 1
      const bias = defaultJpegXlQuantizationBiases[c] ?? 1
      const shortcut = zeroThresholds[c] ?? 0
      for (let p = 0; p < size; p++) {
        if (p < dcEnd && (p & dcMask) < dcColumns) {
          residual[p] = 0
          continue
        }
        const weight = matrix[p] ?? 0
        const value = ((coefficients[p] ?? 0) - correlation * (luma[p] ?? 0)) / (scale * weight)
        if (value > -shortcut && value < shortcut) {
          // Preserve the quantizer's signed-zero subtraction at exactly zero.
          const error = value === 0 ? value - source.quantize(value, c) : value
          residual[p] = error * weight
          continue
        }
        const rounded = source.quantize(value, c)
        const magnitude = Math.abs(rounded)
        if (!Number.isFinite(value) || !(magnitude <= 4095)) return Number.POSITIVE_INFINITY
        let error = value - rounded
        if (magnitude !== 0) {
          nonzero++
          channelEntropy +=
            magnitude === 1 ? magnitudeWeight : Math.sqrt(magnitude) * magnitudeWeight
          const centroid = magnitude === 1 ? Math.sign(rounded) * bias : rounded - 0.145 / rounded
          error = value - centroid
        }
        residual[p] = error * weight
      }
      // A menu transform has at most 1024 coefficients. Its count descriptor
      // uses at most 14 bits, so ceilLog2(bits + 17) is always five.
      const bits = 33 - Math.clz32(nonzero)
      channelEntropy += zeroWeight * (5 + bits)
      // Nonnegative channel costs give an admissible lower bound. Preserve the
      // complete winner calculation, including its summation order.
      const priorEntropy = c === 0 ? lumaEntropy : entropy
      const pendingMinimum = minimumEntropy * (c === 1 ? penalty + 1 : c === 0 ? 1 : 0)
      const boundEntropy = priorEntropy + channelEntropy * (c === 0 ? penalty : 1) + pendingMinimum
      if (entropyMultiplier * boundEntropy + spatialBound > cutoff * (1 + 1e-12)) {
        lastLoss = Number.POSITIVE_INFINITY
        return Number.POSITIVE_INFINITY
      }
      entropy += channelEntropy
      inverseJpegXlLibjxlTransform(strategy, errors, scratch, pixels, active)
      const channelWeight = c === 0 ? 8.2 : c === 2 ? 1.03 : 1
      const maskOffset = c === 0 ? 12 : c === 2 ? 4 : 0
      let channelLoss = maskedLoss(
        spatial,
        tileMask.data,
        width,
        height,
        (y * 8 - maskOriginY) * 64 + x * 8 - maskOriginX,
        maskOffset,
        channelWeight,
      )
      if (c === 1)
        channelLoss *=
          (1 + 0.5 * regularizedDetailLoss(lumaPlane, spatial, width, height, scale)) ** 8
      loss += channelLoss
      if (c === 0 && bw * bh >= 2) {
        entropy *= penalty
        loss *= penalty
      }
      if (c === 0) {
        // Restore X,Y,B summation order exactly after scoring Y first.
        entropy += lumaEntropy
        loss += lumaLoss
      }
      spatialBound = infoWeight * (loss / size) ** (1 / 8) * scale * size
      if (entropyMultiplier * entropy + spatialBound >= cutoff) {
        lastLoss = Number.POSITIVE_INFINITY
        return Number.POSITIVE_INFINITY
      }
      if (c === 1) {
        lumaEntropy = entropy
        lumaLoss = loss
        entropy = 0
        loss = 0
      }
    }
    lastLoss = (loss / size) ** (1 / 8) * scale
    return entropyMultiplier * entropy + infoWeight * lastLoss * size
  }
  const write = (x: number, y: number, strategy: number, cost: number, loss: number): void => {
    const bw = jpegXlVarDctStrategyBlockWidths[strategy] ?? 0
    const bh = jpegXlVarDctStrategyBlockHeights[strategy] ?? 0
    for (let dy = 0; dy < bh; dy++)
      for (let dx = 0; dx < bw; dx++) {
        const at = (y + dy) * blocksWide + x + dx
        strategies[at] = strategy
        first[at] = dx === 0 && dy === 0 ? 1 : 0
        costs[at] = cost / (bw * bh)
        losses[at] = loss
      }
  }
  const smallMultiplier = 1 - 0.4 / (distance + 1.4)
  // Every merge fits its aligned 8x8-block tile. Finish a tile while its
  // filtered pixels are cached, preserving each tile's decision order.
  for (let ty = 0; ty < blocksHigh; ty += 8)
    for (let tx = 0; tx < blocksWide; tx += 8) {
      tileMask.fill(tx, ty)
      maskOriginX = tx * 8
      maskOriginY = ty * 8
      const endX = Math.min(blocksWide, tx + 8)
      const endY = Math.min(blocksHigh, ty + 8)
      for (let y = ty; y < endY; y++)
        for (let x = tx; x < endX; x++) {
          let best = 0,
            bestCost = score(x, y, 0, 1),
            bestLoss = lastLoss
          for (const [strategy, multiplier] of smallMenu) {
            let weight = multiplier / 0.8
            if ((strategy === 1 || strategy === 2) && distance < 5)
              weight -= 0.4 * ((5 - distance) / 5) ** 2
            if (strategy === 3 && distance > 4)
              weight += 0.5 * (distance < 12 ? 8 / (distance - 4) : 1)
            const cost = score(x, y, strategy, weight, bestCost, true)
            if (cost < bestCost) {
              best = strategy
              bestCost = cost
              bestLoss = lastLoss
            }
          }
          write(x, y, best, bestCost * smallMultiplier, bestLoss)
        }
      // Compare square and both two-rectangle partitions with their incumbent.
      // Alignment makes every candidate cover whole previous transforms.
      for (const blocks of [2, 4] as const) {
        const square = blocks === 2 ? 4 : 5
        const vertical = blocks === 2 ? 6 : 10
        const horizontal = blocks === 2 ? 7 : 11
        const rectangleMultiplier = blocks === 2 ? 1.21 : 1.49
        const squareMultiplier = blocks === 2 ? 1.34 : 1.48
        for (let y = ty; y + blocks <= endY; y += blocks)
          for (let x = tx; x + blocks <= endX; x += blocks) {
            let oldCost = 0,
              oldLoss = 0
            for (let dy = 0; dy < blocks; dy++)
              for (let dx = 0; dx < blocks; dx++) {
                oldCost += costs[(y + dy) * blocksWide + x + dx] ?? 0
                oldLoss = Math.max(oldLoss, losses[(y + dy) * blocksWide + x + dx] ?? 0)
              }
            let bestCost = oldCost,
              bestKind = 0,
              loss0 = 0,
              loss1 = 0,
              cost0 = 0,
              cost1 = 0
            const squareCost = score(x, y, square, squareMultiplier, bestCost)
            if (squareCost < bestCost) {
              bestCost = squareCost
              bestKind = square
              loss0 = lastLoss
              cost0 = squareCost
            }
            for (const strategy of [vertical, horizontal]) {
              const dx = strategy === vertical ? blocks / 2 : 0,
                dy = strategy === vertical ? 0 : blocks / 2
              let oldLeft = 0,
                oldRight = 0
              for (let iy = 0; iy < blocks; iy++)
                for (let ix = 0; ix < blocks; ix++) {
                  const at = (y + iy) * blocksWide + x + ix
                  if ((strategy === vertical ? ix : iy) < blocks / 2) oldLeft += costs[at] ?? 0
                  else oldRight += costs[at] ?? 0
                }
              const a = score(
                x,
                y,
                strategy,
                rectangleMultiplier,
                Math.min(oldLeft, bestCost * (1 + 1e-12) + 1e-12),
              )
              const la = lastLoss
              // The other half has nonnegative cost. A partition must beat the
              // current square/partition as well as each half's existing cover.
              const left = Math.min(a, oldLeft)
              const skipRight = left >= bestCost
              const b = skipRight
                ? Number.POSITIVE_INFINITY
                : score(
                    x + dx,
                    y + dy,
                    strategy,
                    rectangleMultiplier,
                    Math.min(oldRight, Math.max(0, bestCost - left) * (1 + 1e-12) + 1e-12),
                  )
              const lb = skipRight ? Number.POSITIVE_INFINITY : lastLoss
              const cost = Math.min(a, oldLeft) + Math.min(b, oldRight)
              if (cost < bestCost) {
                bestCost = cost
                bestKind = strategy
                cost0 = a < oldLeft ? a : -1
                cost1 = b < oldRight ? b : -1
                loss0 = la
                loss1 = lb
              }
            }
            if (bestKind) {
              if (cost0 >= 0) write(x, y, bestKind, cost0, loss0)
              if (bestKind !== square && cost1 >= 0)
                write(
                  x + (bestKind === vertical ? blocks / 2 : 0),
                  y + (bestKind === horizontal ? blocks / 2 : 0),
                  bestKind,
                  cost1,
                  loss1,
                )
            }
          }
      }
    }
  for (const buffer of [
    ...planes,
    ...transformed,
    scratch,
    residual,
    spatial,
    active,
    costs,
    losses,
  ])
    memory.release(buffer)
  memory.release(pairs)
  tileMask.release()
  // AdjustQuantField: one wire quantizer per transform from the floating field.
  const quantizationMap = memory.allocate(Int32Array, blockCount)
  for (let at = 0; at < blockCount; at++) {
    if (!first[at]) continue
    const strategy = strategies[at] ?? 0
    const bw = jpegXlVarDctStrategyBlockWidths[strategy] ?? 1,
      bh = jpegXlVarDctStrategyBlockHeights[strategy] ?? 1
    const q = jpegXlLibjxlTransformQuantization(
      field,
      blocksWide,
      at % blocksWide,
      Math.floor(at / blocksWide),
      bw,
      bh,
      distance,
      false,
    )
    const quantizer = Math.max(1, Math.min(256, Math.floor(q + 0.5)))
    for (let dy = 0; dy < bh; dy++)
      for (let dx = 0; dx < bw; dx++) quantizationMap[at + dy * blocksWide + dx] = quantizer
  }
  return { strategies, first, quantizationMap }
}

/** Lossless AC storage: byte tokens, with zero runs and Int16 escapes. */
interface PackedCoefficients {
  readonly tokens: Uint8Array
  readonly exceptions: Int16Array
  readonly length: number
}

// Token 0 starts a zero run whose length (1-255) is the next byte. Token 128
// escapes the next Int16 exception. Other tokens are signed byte values.
const packCoefficients = (source: Int16Array, memory: JpegXlEncoderMemory): PackedCoefficients => {
  let tokenCount = 0,
    exceptionCount = 0
  for (let i = 0; i < source.length; ) {
    const value = source[i] ?? 0
    if (value === 0) {
      let run = 1
      while (run < 255 && i + run < source.length && source[i + run] === 0) run++
      tokenCount += 2
      i += run
      continue
    }
    tokenCount++
    if (value < -127 || value > 127) exceptionCount++
    i++
  }
  const tokens = memory.allocate(Uint8Array, tokenCount)
  const exceptions = memory.allocate(Int16Array, exceptionCount)
  let t = 0,
    e = 0
  for (let i = 0; i < source.length; ) {
    const value = source[i] ?? 0
    if (value === 0) {
      let run = 1
      while (run < 255 && i + run < source.length && source[i + run] === 0) run++
      tokens[t++] = 0
      tokens[t++] = run
      i += run
      continue
    }
    if (value < -127 || value > 127) {
      tokens[t++] = 128
      exceptions[e++] = value
    } else tokens[t++] = value & 255
    i++
  }
  return { tokens, exceptions, length: source.length }
}

const unpackCoefficients = (source: PackedCoefficients, output: Int16Array): void => {
  if (output.length < source.length)
    throw invalidJpegXlInput('libjxl coefficient output is too short')
  const { tokens, exceptions } = source
  let i = 0,
    e = 0
  for (let t = 0; t < tokens.length; ) {
    const token = tokens[t++] ?? 0
    if (token === 0) {
      const end = i + (tokens[t++] ?? 0)
      output.fill(0, i, end)
      i = end
    } else if (token === 128) {
      const value = exceptions[e++]
      if (value === undefined) throw invalidJpegXlInput('libjxl coefficient exception is missing')
      output[i++] = value
    } else output[i++] = (token << 24) >> 24
  }
  if (i !== source.length || e !== exceptions.length)
    throw invalidJpegXlInput('libjxl coefficient storage is inconsistent')
}

/** Order families for the menu: wire slots for DCT8, Hornuss/DCT2/DCT4, squares and rectangles. */
const orderFamilies = (): JpegXlOrderFamily[] =>
  (
    [
      [0, 0],
      [1, 1],
      [4, 2],
      [5, 3],
      [10, 6],
      [6, 4],
      [8, 5],
      [18, 7],
      [19, 8],
    ] as const
  ).map(([strategy, wire]) => {
    const natural = naturalJpegXlCoefficientOrder(strategy)
    // Our writer uses transposed internal coordinates for the single-block families.
    if (strategy === 0 || strategy === 1)
      for (let i = 0; i < natural.length; i++) {
        const p = natural[i] ?? 0
        natural[i] = (p & 7) * 8 + (p >>> 3)
      }
    return {
      wire,
      natural,
      skip:
        (jpegXlVarDctStrategyBlockWidths[strategy] ?? 0) *
        (jpegXlVarDctStrategyBlockHeights[strategy] ?? 0),
    }
  })

/** Quantize the selected transforms into signed-byte AC groups and recover their DC grid. */
const writeSelectedGeometry = (
  base: Readonly<VarDctCoefficientGeometry>,
  source: JpegXlBlockSource,
  selection: Selection,
  memory: JpegXlEncoderMemory,
): VarDctCoefficientGeometry => {
  const { strategies, first, quantizationMap: q } = selection
  const globalScale = base.globalScale
  if (!globalScale || !base.quantDc) throw invalidJpegXlInput('libjxl writer scale is missing')
  const pairs = memory.allocate(Float64Array, 64)
  const scratch = memory.allocate(Float64Array, largestTransform)
  const transformed = [
    memory.allocate(Float64Array, largestTransform),
    memory.allocate(Float64Array, largestTransform),
    memory.allocate(Float64Array, largestTransform),
  ]
  const planes = [
    memory.allocate(Float32Array, largestTransform),
    memory.allocate(Float32Array, largestTransform),
    memory.allocate(Float32Array, largestTransform),
  ]
  const dc = memory.allocate(Float64Array, 64)
  const families = orderFamilies()
  const packedGroups: {
    planes: readonly PackedCoefficients[]
    offsets: Int32Array
    width: number
    height: number
  }[] = []
  const invGlobal = 65536 / globalScale
  const groupCount = base.groupsAcross * base.groupsDown
  for (let group = 0; group < groupCount; group++) {
    const ox = (group % base.groupsAcross) * 32,
      oy = Math.floor(group / base.groupsAcross) * 32
    const width = Math.min(32, base.blocksWide - ox),
      height = Math.min(32, base.blocksHigh - oy)
    const offsets = memory.allocate(Int32Array, width * height)
    offsets.fill(-1)
    const coefficients = [
      memory.allocate(Int16Array, width * height * 64),
      memory.allocate(Int16Array, width * height * 64),
      memory.allocate(Int16Array, width * height * 64),
    ]
    let cursor = 0
    const visited = memory.allocate(Uint8Array, width * height)
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        if (visited[y * width + x]) continue
        const at = (oy + y) * base.blocksWide + ox + x
        const strategy = strategies[at] ?? -1
        const bw = jpegXlVarDctStrategyBlockWidths[strategy] ?? 0,
          bh = jpegXlVarDctStrategyBlockHeights[strategy] ?? 0
        if (bw < 1 || bh < 1 || x + bw > width || y + bh > height || first[at] !== 1)
          throw invalidJpegXlInput('libjxl transform footprint is invalid')
        const quant = q[at] ?? 0
        for (let dy = 0; dy < bh; dy++)
          for (let dx = 0; dx < bw; dx++) {
            const index = (oy + y + dy) * base.blocksWide + ox + x + dx
            if (strategies[index] !== strategy || q[index] !== quant)
              throw invalidJpegXlInput('libjxl transform footprint differs')
            visited[(y + dy) * width + x + dx] = 1
          }
        offsets[y * width + x] = cursor
        const size = bw * bh * 64,
          stride = bw * 8
        for (let dy = 0; dy < bh; dy++)
          for (let dx = 0; dx < bw; dx++) {
            const block = source.readBlock(ox + x + dx, oy + y + dy, false)
            for (let c = 0; c < 3; c++) {
              const plane = block[c],
                target = planes[c]
              if (!plane || !target) throw invalidJpegXlInput('libjxl writer plane is missing')
              for (let py = 0; py < 8; py++)
                for (let px = 0; px < 8; px++)
                  target[(dy * 8 + py) * stride + dx * 8 + px] = plane[py * 8 + px] ?? 0
            }
          }
        for (let c = 0; c < 3; c++) {
          const plane = planes[c]
          const result = transformed[c]
          if (!plane || !result) throw invalidJpegXlInput('libjxl writer transform is missing')
          forwardJpegXlLibjxlTransform(strategy, plane, scratch, result, pairs)
          jpegXlLibjxlDcGrid(result, bw, bh, dc)
          const target = base.dcComponents[c < 2 ? c ^ 1 : c]?.coefficients
          const step = (invGlobal * (base.dcQuantization?.[c] ?? 0)) / base.quantDc
          if (!target || !(step > 0)) throw invalidJpegXlInput('libjxl DC precision is missing')
          for (let dy = 0; dy < bh; dy++)
            for (let dx = 0; dx < bw; dx++)
              target[(oy + y + dy) * base.blocksWide + ox + x + dx] = Math.round(
                (dc[dy * bw + dx] ?? 0) / step,
              )
        }
        // Set the existing rate-aware quantizer's activity state at the leader.
        source.readBlock(ox + x, oy + y, true)
        const tile =
          Math.floor((oy + y) / 8) * Math.ceil(base.blocksWide / 8) + Math.floor((ox + x) / 8)
        const yCoefficients = transformed[1]
        if (!yCoefficients) throw invalidJpegXlInput('libjxl luma coefficients are missing')
        const tables = jpegXlDequantizationMatrices(strategy)
        const naturalWidth = Math.max(bw, bh) * 8
        for (let c = 0; c < 3; c++) {
          const result = transformed[c]
          const target = coefficients[c],
            table = tables[c]
          if (!target || !table || !result)
            throw invalidJpegXlInput('libjxl writer quantization is missing')
          // The leading zero keeps the signed-zero behavior of the reference arithmetic.
          const ratio =
            c === 0
              ? 0 + (base.correlationX?.[tile] ?? 0) / 84
              : c === 2
                ? 0 + (base.correlationB?.[tile] ?? 0) / 84
                : 0
          const multiplier =
            c === 0
              ? 0.8 ** ((base.xScale ?? 2) - 2)
              : c === 2
                ? 0.8 ** ((base.bScale ?? 2) - 2)
                : 1
          const step = (invGlobal / quant) * multiplier
          for (let p = 0; p < size; p++) {
            if (
              p % naturalWidth < Math.max(bw, bh) &&
              Math.floor(p / naturalWidth) < Math.min(bw, bh)
            )
              continue
            const value = source.quantize(
              ((result[p] ?? 0) - ratio * (yCoefficients[p] ?? 0)) / (step * (table[p] ?? 0)),
              c,
            )
            if (Math.abs(value) > 4095)
              throw invalidJpegXlInput('libjxl coefficient exceeds the writer range')
            target[cursor + (size === 64 ? (p & 7) * 8 + (p >>> 3) : p)] = value
          }
        }
        cursor += size
      }
    memory.release(visited)
    packedGroups.push({
      planes: coefficients.map((plane) => {
        const packed = packCoefficients(plane, memory)
        memory.release(plane)
        return packed
      }),
      offsets,
      width,
      height,
    })
  }
  for (const buffer of [...planes, scratch, ...transformed, dc, pairs]) memory.release(buffer)
  // One group holds at most 32x32 blocks; size the restore buffers to the largest group.
  const groupCoefficients = Math.min(32, base.blocksWide) * Math.min(32, base.blocksHigh) * 64
  const restored = [
    memory.allocate(Int16Array, groupCoefficients),
    memory.allocate(Int16Array, groupCoefficients),
    memory.allocate(Int16Array, groupCoefficients),
  ]
  let restoredGroup = -1
  let restoredPlanes: readonly VarDctCoefficientPlane[] = []
  return {
    ...base,
    strategyMap: strategies,
    firstBlocks: first,
    quantizationMap: q,
    orderFamilies: families,
    coefficientOrders: families.flatMap((order) => [order.natural, order.natural, order.natural]),
    loadAc: (group) => {
      if (restoredGroup === group) return restoredPlanes
      const stored = packedGroups[group]
      if (!stored) throw invalidJpegXlInput('libjxl AC group is missing')
      restoredPlanes = stored.planes.map((packed, channel) => {
        const target = restored[channel]
        if (!target) throw invalidJpegXlInput('libjxl AC channel is missing')
        unpackCoefficients(packed, target)
        return {
          coefficients: target.subarray(0, packed.length),
          coefficientOffsets: stored.offsets,
          blocksPerLineForMcu: stored.width,
          blocksPerColumnForMcu: stored.height,
        }
      })
      restoredGroup = group
      return restoredPlanes
    },
  }
}

/**
 * Replace the encoder's transform, quantization field, AC and DC choices with
 * the libjxl-derived effort-7 decisions. `base` must come from the encoder's
 * first pass with `jpegXlLibjxlFrameParameters` applied to its scales.
 */
export const rewriteJpegXlLibjxlGeometry = (
  base: Readonly<VarDctCoefficientGeometry>,
  source: JpegXlBlockSource,
  distance: number,
  gaborishStrength: number,
  width: number,
  height: number,
): VarDctCoefficientGeometry => {
  const memory = base.memory
  if (!memory || !base.globalScale) throw invalidJpegXlInput('libjxl geometry input is missing')
  const parameters = jpegXlLibjxlFrameParameters(distance, gaborishStrength)
  const field = jpegXlLibjxlInitialQuantField(
    source,
    base.blocksWide,
    base.blocksHigh,
    base.globalScale,
    distance,
    memory,
  )
  raiseJpegXlLibjxlCoarsePrecision(field, distance)
  const strength = parameters.gaborishStrength
  const filtered =
    strength > 0
      ? jpegXlInverseGaborishSource(
          source,
          base.blocksWide,
          base.blocksHigh,
          width,
          height,
          memory,
          strength,
        )
      : undefined
  const cached = jpegXlSelectorTileCache(filtered ?? source, memory)
  const sharpness = memory.allocate(Uint8Array, field.length)
  sharpness.fill(parameters.sharpness)
  try {
    const geometry: VarDctCoefficientGeometry = {
      ...base,
      smoothDc: false,
      sharpnessMap: sharpness,
      loopFilters: {
        gaborish: strength > 0,
        gaborishStrength: strength,
        epfIterations: parameters.epfIterations,
      },
    }
    const selection = selectTransforms(geometry, cached, source, field, distance, memory)
    return writeSelectedGeometry(geometry, cached, selection, memory)
  } finally {
    memory.release(field)
    cached.release()
    filtered?.release()
  }
}
