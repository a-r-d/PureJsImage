/**
 * Sources: libjxl-tiny encoder/enc_ac_strategy.cc at
 * 8eae18172059d54f5c734ca814f23b96eebff859; libjxl lib/jxl/enc_ac_strategy.cc
 * at v0.12.0, a7a9c787341cf703dede03c2009fa460cae5e5df.
 * Copyright (c) the JPEG XL Project Authors. BSD-3-Clause
 * Changes: scalar TypeScript cost models and hierarchical selection, using our
 * transforms, quantization fields, CfL and writer. Tiny's adaptive mask is held
 * at one; v0.12's pixel mask can be held at one or ported separately. Maximum-footprint Q is
 * used instead of v0.12's sixteenth norm except in spatial-source mode, which
 * uses the separately ported norm and post-selection field adjustment.
 * That mode scores unscaled normative matrices as the native heuristic does;
 * the writer still applies the signaled chroma matrix scales.
 * Optional error guard is our own.
 * Bounded caching, admissible cost pruning, Y-first evaluation, tile traversal
 * and the compact candidate menu are first-party speed adaptations.
 * Writer-estimate experiments independently match the final quantization field,
 * chroma matrix scales and rate-aware rounding used by our writer.
 * Tiny's split-cost literal is written as its representable JavaScript double.
 * First-party pruning includes known luma cost, minimum remaining channel
 * entropy and the remaining budget for rectangle partitions.
 * First-party rounding-state reuse bypasses unused filtered pixels and repeats
 * at a candidate origin when the original mask context shares the quantizer.
 * This is a development experiment, never imported by the public encoder.
 */
import { selectorTileMask } from './selector-tile-mask.ts'
import { selectorMaskLoss } from './selector-mask-loss.ts'
import { inverseSelectorTransform } from './selector-inverse.ts'
import { inverseWeightedSelectorTransform } from './selector-inverse-weights.ts'
import type {
  JpegXlDevelopmentDecisions,
  JpegXlDevelopmentTransformContext,
} from '../../../src/codecs/jpegxl-development-decisions.ts'
import type { VarDctCoefficientGeometry } from '../../../src/codecs/jpegxl-jpeg-encode.ts'
import {
  inverseJpegXlDevelopmentTransform,
  jpegXlDevelopmentDequantization,
} from '../../../src/codecs/jpegxl-vardct-render.ts'
import {
  jpegXlVarDctStrategyBlockWidths,
  jpegXlVarDctStrategyBlockHeights,
} from '../../../src/codecs/jpegxl-vardct-jpeg.ts'
import { forwardDevelopmentTransform } from './transform-kernels.ts'
import {
  forwardSelectorTransform,
  forwardSymmetricSelectorTransform,
  forwardPairedSelectorTransform,
} from './selector-transforms.ts'
import { rewriteStrategyGeometry } from './strategy-transplant.ts'
import { libjxlStrategyMask } from './libjxl-strategy-mask.ts'
import { libjxlTransformQuantization } from './libjxl-quantization-port.ts'
import { defaultJpegXlQuantizationBiases } from '../../../src/codecs/jpegxl-vardct-quantization.ts'

export type StrategyPort =
  | 'tiny'
  | 'spatial'
  | 'spatial-masked'
  | 'spatial-guarded'
  | 'spatial-actual'
  | 'spatial-actual-guarded'
  | 'spatial-source'
export function parseStrategyPort(value: string): StrategyPort {
  if (
    value === 'tiny' ||
    value === 'spatial' ||
    value === 'spatial-masked' ||
    value === 'spatial-guarded' ||
    value === 'spatial-actual' ||
    value === 'spatial-actual-guarded' ||
    value === 'spatial-source'
  )
    return value
  throw new Error(`Unknown strategy port: ${value}`)
}

const ceilLog2 = (value: number): number => Math.ceil(Math.log2(value))
const smallMenu = [0, 3, 2, 12, 13, 1, 14, 15, 16, 17] as const
const smallWeights = [
  0.8, 1.08, 0.95, 0.85931637428340035, 0.85931637428340035, 1.0427542510634957,
  0.81779489591359944, 0.81779489591359944, 0.81779489591359944, 0.81779489591359944,
] as const

export interface StrategyOptions {
  initialField?: Float32Array
  prune?: boolean
  fastTransforms?: boolean
  compact?: boolean
  symmetric?: boolean
  boundedMask?: boolean
  symmetricInverse?: boolean
  limit16?: boolean
  compactStorage?: boolean
  writerTransform?: 'small' | 'paired' | 'all'
  writerEstimate?: 'field' | 'rounding' | 'matrices' | 'all'
  pairedTransform?: boolean
  inverseWeights?: boolean
  rowMask?: boolean
  bulkBlockCopy?: boolean
  lossScale?: number
  directRoundingState?: boolean
}

export function strategyPortOverrides(
  distance: number,
  mode: StrategyPort,
  maskContext?: JpegXlDevelopmentTransformContext,
  options: StrategyOptions = {},
): JpegXlDevelopmentDecisions {
  if (!(distance >= 0.25 && distance <= 25)) throw new Error('Invalid strategy-port distance')
  return {
    rewriteGeometry: (base, context) =>
      selectGeometry(base, context, distance, mode, maskContext ?? context, options),
  }
}

function selectGeometry(
  base: VarDctCoefficientGeometry,
  context: JpegXlDevelopmentTransformContext,
  distance: number,
  mode: StrategyPort,
  maskContext: JpegXlDevelopmentTransformContext,
  options: StrategyOptions,
): VarDctCoefficientGeometry {
  const {
    initialField,
    prune = false,
    fastTransforms = false,
    compact = false,
    symmetric = false,
    boundedMask = false,
    symmetricInverse = false,
    limit16 = false,
    compactStorage = false,
    writerEstimate,
    writerTransform,
    pairedTransform = false,
    inverseWeights = false,
    rowMask = false,
    bulkBlockCopy = false,
    lossScale = 1,
    directRoundingState = false,
  } = options
  const memory = base.memory
  if (!memory || !base.quantizationMap || !base.globalScale)
    throw new Error('Missing strategy input')
  const blockCount = base.blocksWide * base.blocksHigh
  if (initialField && (mode !== 'spatial-source' || initialField.length !== blockCount))
    throw new Error('Invalid floating selector field')
  const selectionField = initialField ?? base.quantizationMap
  const pairs = pairedTransform ? memory.allocate(Float64Array, 64) : undefined
  const transform = pairs
    ? (strategy: number, pixels: Float32Array, scratch: Float64Array, output: Float64Array) =>
        forwardPairedSelectorTransform(strategy, pixels, scratch, output, pairs)
    : symmetric
      ? forwardSymmetricSelectorTransform
      : fastTransforms
        ? forwardSelectorTransform
        : forwardDevelopmentTransform
  const inverse = inverseWeights
    ? inverseWeightedSelectorTransform
    : symmetricInverse
      ? inverseSelectorTransform
      : inverseJpegXlDevelopmentTransform
  const strategies = memory.allocate(Int32Array, blockCount)
  const first = memory.allocate(Uint8Array, blockCount)
  first.fill(1)
  const costs = memory.allocate(Float64Array, blockCount)
  const losses = memory.allocate(Float64Array, blockCount)
  const planes = [
    memory.allocate(Float32Array, 4096),
    memory.allocate(Float32Array, 4096),
    memory.allocate(Float32Array, 4096),
  ]
  const transformed = [
    memory.allocate(Float64Array, 4096),
    memory.allocate(Float64Array, 4096),
    memory.allocate(Float64Array, 4096),
  ]
  const scratch = memory.allocate(Float64Array, 4096)
  const residual = memory.allocate(Float64Array, 4096)
  const spatial = memory.allocate(Float32Array, 4096)
  const active = memory.allocate(Uint16Array, 64)
  const ratio = (distance + 0.13731742964354549) / (1 + 0.13731742964354549)
  const infoWeight = 1.2 * ratio ** 0.33677806662454718 * lossScale
  const zeroWeight = 9.3089059022677905 * ratio ** 0.50990926717963703
  // With no nonzero ACs: bits = 1, ceilLog2(bits + 17) + bits = 6.
  const minimumEntropy = zeroWeight * 6
  const magnitudeWeight = 10.833273317067883 * ratio ** 0.36702940662370243
  const invGlobal = 65536 / base.globalScale
  const tiny = mode === 'tiny'
  const actualRounding =
    mode === 'spatial-actual' ||
    mode === 'spatial-actual-guarded' ||
    writerEstimate === 'rounding' ||
    writerEstimate === 'all'
  const writerField = writerEstimate === 'field' || writerEstimate === 'all'
  const writerMatrices = writerEstimate === 'matrices' || writerEstimate === 'all'
  const guarded = mode === 'spatial-guarded' || mode === 'spatial-actual-guarded'
  const maskField =
    !boundedMask &&
    (mode === 'spatial-masked' || mode === 'spatial-source' || guarded || actualRounding)
      ? libjxlStrategyMask(base, maskContext)
      : undefined
  const tileMask = boundedMask ? selectorTileMask(base, maskContext) : undefined
  let maskOriginX = 0,
    maskOriginY = 0
  let lastLoss = 0
  let roundingX = -1,
    roundingY = -1

  // All scratch belongs to one candidate, independent of image area.
  const score = (
    x: number,
    y: number,
    strategy: number,
    entropyMultiplier: number,
    cutoff = Infinity,
  ): number => {
    const bw = jpegXlVarDctStrategyBlockWidths[strategy] ?? 0
    const bh = jpegXlVarDctStrategyBlockHeights[strategy] ?? 0
    const width = bw * 8,
      height = bh * 8,
      size = width * height
    let quantizer = 0
    for (let dy = 0; dy < bh; dy++)
      for (let dx = 0; dx < bw; dx++) {
        quantizer = Math.max(quantizer, selectionField[(y + dy) * base.blocksWide + x + dx] ?? 0)
        const block = context.readBlock(x + dx, y + dy, false)
        for (let c = 0; c < 3; c++) {
          const source = block[c],
            target = planes[c]
          if (!source || !target) throw new Error('Missing strategy color plane')
          if (bulkBlockCopy && width === 8 && source.length === 64) {
            target.set(source, dy * 64)
            continue
          }
          for (let py = 0; py < 8; py++)
            for (let px = 0; px < 8; px++)
              target[(dy * 8 + py) * width + dx * 8 + px] = source[py * 8 + px] ?? 0
        }
      }
    if (mode === 'spatial-source')
      quantizer = libjxlTransformQuantization(
        selectionField,
        base.blocksWide,
        x,
        y,
        bw,
        bh,
        distance,
        !writerField,
        false,
      )
    if (writerField) quantizer = Math.max(1, Math.min(256, Math.floor(quantizer + 0.5)))
    for (let c = prune ? 1 : 0; c < (prune ? 2 : 3); c++) {
      const source = planes[c],
        output = transformed[c]
      if (!source || !output) throw new Error('Missing transform scratch')
      transform(strategy, source, scratch, output)
    }
    const tile = Math.floor(y / 8) * Math.ceil(base.blocksWide / 8) + Math.floor(x / 8)
    const scale = invGlobal / quantizer
    let entropy = 0,
      loss = 0,
      lumaEntropy = 0,
      lumaLoss = 0,
      absoluteError = 0,
      squaredError = 0
    if (actualRounding) {
      if (!directRoundingState) context.readBlock(x, y, true)
      else if (x !== roundingX || y !== roundingY) {
        // Uncorrelated reads preserve the shared writer's activity state.
        // Only the original source read is needed to prepare rate-aware rounding.
        maskContext.readBlock(x, y, true)
        roundingX = x
        roundingY = y
      }
    }
    const penalty = bw * bh >= 2 ? 1 + Math.min(3, (bw * bh) / 8) : 1
    const tables = jpegXlDevelopmentDequantization(strategy)
    const naturalWidth = Math.max(width, height)
    for (let channelIndex = 0; channelIndex < 3; channelIndex++) {
      const c = prune && channelIndex < 2 ? channelIndex ^ 1 : channelIndex
      if (prune && !tiny && c !== 1) {
        const boundEntropy =
          (c === 0 ? lumaEntropy : entropy) + minimumEntropy * (c === 0 ? penalty + 1 : 1)
        const boundLoss = c === 0 ? lumaLoss : loss
        if (
          entropyMultiplier * boundEntropy +
            infoWeight * (boundLoss / size) ** (1 / 8) * scale * size >
          cutoff * (1 + 1e-12)
        ) {
          lastLoss = Infinity
          return Infinity
        }
      }
      if (prune && c !== 1) {
        const source = planes[c],
          output = transformed[c]
        if (!source || !output) throw new Error('Missing deferred transform scratch')
        transform(strategy, source, scratch, output)
      }
      const coefficients = transformed[c],
        luma = transformed[1],
        matrix = tables[c]
      if (!coefficients || !luma || !matrix) throw new Error('Missing strategy coefficients')
      const correlation =
        c === 0
          ? (base.developmentCorrelation?.baseCorrelationX ?? 0) +
            (base.correlationX?.[tile] ?? 0) / (base.developmentCorrelation?.colorFactor ?? 84)
          : c === 2
            ? (base.developmentCorrelation ? base.developmentCorrelation.baseCorrelationB - 1 : 0) +
              (base.correlationB?.[tile] ?? 0) / (base.developmentCorrelation?.colorFactor ?? 84)
            : 0
      const channelScale =
        mode === 'spatial-source' && !writerMatrices
          ? 1
          : c === 0
            ? 0.8 ** ((base.xScale ?? 2) - 2)
            : c === 2
              ? 0.8 ** ((base.bScale ?? 2) - 2)
              : 1
      let nonzero = 0,
        channelEntropy = 0
      residual.fill(0, 0, size)
      for (let p = 0; p < size; p++) {
        if (p % naturalWidth < Math.max(bw, bh) && Math.floor(p / naturalWidth) < Math.min(bw, bh))
          continue
        const step = scale * channelScale * (matrix[p] ?? 0)
        const value = ((coefficients[p] ?? 0) - correlation * (luma[p] ?? 0)) / step
        // C++ SIMD Round uses nearest-even; ties are explicit in this scalar port.
        const lower = Math.floor(value),
          fraction = value - lower
        const rounded = actualRounding
          ? context.quantize(value, c)
          : fraction === 0.5
            ? lower % 2 === 0
              ? lower
              : lower + 1
            : Math.round(value)
        if (!Number.isFinite(value) || Math.abs(rounded) > 4095) return Infinity
        const magnitude = Math.abs(rounded),
          error =
            value -
            (actualRounding && rounded !== 0
              ? Math.abs(rounded) === 1
                ? Math.sign(rounded) * (defaultJpegXlQuantizationBiases[c] ?? 1)
                : rounded - 0.145 / rounded
              : rounded)
        absoluteError += Math.abs(error)
        squaredError += error * error
        if (magnitude !== 0) nonzero++
        channelEntropy += tiny
          ? Math.sqrt(magnitude) * 5.3359184934516337 + (magnitude >= 2 ? 4.4628149885273363 : 0)
          : Math.sqrt(magnitude) * magnitudeWeight
        residual[p] = error * channelScale * (matrix[p] ?? 0)
      }
      const bits = ceilLog2(nonzero + 1) + 1
      channelEntropy += (tiny ? 7.565053364251793 : zeroWeight) * (ceilLog2(bits + 17) + bits)
      if (tiny) channelEntropy += nonzero * (1 + Math.min(1, distance / 3) * 8.8703248061477744)
      // Nonnegative channel costs give an admissible lower bound. Preserve the
      // complete winner calculation, including its summation order. Luma cost
      // is held separately while evaluating X; include it in the lower bound.
      if (prune && !tiny) {
        const priorEntropy = c === 0 ? lumaEntropy : entropy
        const priorLoss = c === 0 ? lumaLoss : loss
        const pendingMinimum = minimumEntropy * (c === 1 ? penalty + 1 : c === 0 ? 1 : 0)
        const boundEntropy =
          priorEntropy + channelEntropy * (c === 0 ? penalty : 1) + pendingMinimum
        if (
          entropyMultiplier * boundEntropy +
            infoWeight * (priorLoss / size) ** (1 / 8) * scale * size >
          cutoff * (1 + 1e-12)
        ) {
          lastLoss = Infinity
          return Infinity
        }
      }
      entropy += channelEntropy
      if (!tiny) {
        inverse(strategy, residual.subarray(0, size), scratch, spatial.subarray(0, size), active)
        const channelWeight = c === 0 ? 8.2 : c === 2 ? 1.03 : 1
        const maskOffset = c === 0 ? 12 : c === 2 ? 4 : 0
        let channelLoss = 0
        if (rowMask && tileMask)
          channelLoss = selectorMaskLoss(
            spatial,
            tileMask.data,
            width,
            height,
            (y * 8 - maskOriginY) * 64 + x * 8 - maskOriginX,
            maskOffset,
            channelWeight,
          )
        else
          for (let p = 0; p < size; p++) {
            const mask = tileMask
              ? (tileMask.data[
                  (y * 8 - maskOriginY + Math.floor(p / width)) * 64 +
                    x * 8 -
                    maskOriginX +
                    (p % width)
                ] ?? 1)
              : (maskField?.[
                  (y * 8 + Math.floor(p / width)) * base.blocksWide * 8 + x * 8 + (p % width)
                ] ?? 1)
            let error = (spatial[p] ?? 0) * (mask + maskOffset) * channelWeight
            error *= error
            error *= error
            error *= error
            channelLoss += error
          }
        loss += channelLoss
        if (c === 0 && bw * bh >= 2) {
          const penalty = 1 + Math.min(3, (bw * bh) / 8)
          entropy *= penalty
          loss *= penalty
        }
        if (prune && c === 0) {
          // Restore X,Y,B summation order exactly after scoring Y first.
          entropy += lumaEntropy
          loss += lumaLoss
        }
        if (
          prune &&
          entropyMultiplier * entropy + infoWeight * (loss / size) ** (1 / 8) * scale * size >=
            cutoff
        ) {
          lastLoss = Infinity
          return Infinity
        }
        if (prune && c === 1) {
          lumaEntropy = entropy
          lumaLoss = loss
          entropy = 0
          loss = 0
        }
      }
    }
    lastLoss = tiny ? squaredError * scale * scale : (loss / size) ** (1 / 8) * scale
    return tiny
      ? entropyMultiplier *
          (entropy + 138 * absoluteError + 50.46839691767866 * Math.sqrt(bw * bh * squaredError))
      : entropyMultiplier * entropy + infoWeight * lastLoss * size
  }
  const write = (x: number, y: number, strategy: number, cost: number, loss: number): void => {
    const bw = jpegXlVarDctStrategyBlockWidths[strategy] ?? 0
    const bh = jpegXlVarDctStrategyBlockHeights[strategy] ?? 0
    for (let dy = 0; dy < bh; dy++)
      for (let dx = 0; dx < bw; dx++) {
        const at = (y + dy) * base.blocksWide + x + dx
        strategies[at] = strategy
        first[at] = dx === 0 && dy === 0 ? 1 : 0
        costs[at] = cost / (bw * bh)
        losses[at] = loss
      }
  }
  const smallMultiplier = tiny
    ? 1.0735757687292622 * 0.75 - (0.55 * 0.75) / (distance + 1.4)
    : 1 - 0.4 / (distance + 1.4)
  // Every supported merge fits its aligned color tile. Finish a tile while
  // its filtered pixels are cached, preserving each tile's decision order.
  const tileSize = prune || boundedMask ? 8 : Math.max(base.blocksWide, base.blocksHigh)
  for (let ty = 0; ty < base.blocksHigh; ty += tileSize)
    for (let tx = 0; tx < base.blocksWide; tx += tileSize) {
      tileMask?.fill(tx, ty)
      maskOriginX = tx * 8
      maskOriginY = ty * 8
      const endX = Math.min(base.blocksWide, tx + tileSize)
      const endY = Math.min(base.blocksHigh, ty + tileSize)
      for (let y = ty; y < endY; y++)
        for (let x = tx; x < endX; x++) {
          let best = 0,
            bestCost = score(x, y, 0, 1),
            bestLoss = lastLoss
          if (!tiny)
            for (let i = 1; i < smallMenu.length; i++) {
              const strategy = smallMenu[i] ?? 0
              if (compact && strategy > 3) continue
              let weight = (smallWeights[i] ?? 0.8) / 0.8
              if ((strategy === 1 || strategy === 2) && distance < 5)
                weight -= 0.4 * ((5 - distance) / 5) ** 2
              if (strategy !== 0 && strategy !== 1 && strategy !== 2 && distance > 4)
                weight += 0.5 * (distance < 12 ? 8 / (distance - 4) : 1)
              const cost = score(x, y, strategy, weight, bestCost)
              if (cost < bestCost && (!guarded || lastLoss <= bestLoss)) {
                best = strategy
                bestCost = cost
                bestLoss = lastLoss
              }
            }
          write(x, y, best, (bestCost + (tiny ? 3 : 0)) * smallMultiplier, bestLoss)
        }
      // Compare square and both complete two-rectangle partitions with their incumbent.
      // Alignment makes every candidate cover whole previous transforms.
      for (const blocks of tiny || limit16 ? [2] : compact ? [2, 4] : [2, 4, 8]) {
        const square = blocks === 2 ? 4 : blocks === 4 ? 5 : 18
        const vertical = blocks === 2 ? 6 : blocks === 4 ? 10 : 19
        const horizontal = blocks === 2 ? 7 : blocks === 4 ? 11 : 20
        const rectangleMultiplier = tiny
          ? 0.9019587899705066 - 0.55 / (distance + 1.6)
          : blocks === 2
            ? 1.21
            : blocks === 4
              ? 1.49
              : 2.25
        const squareMultiplier = blocks === 2 ? 1.34 : blocks === 4 ? 1.48 : 2.25
        for (let y = ty; y + blocks <= endY; y += blocks)
          for (let x = tx; x + blocks <= endX; x += blocks) {
            let oldCost = 0,
              oldLoss = 0
            for (let dy = 0; dy < blocks; dy++)
              for (let dx = 0; dx < blocks; dx++) {
                oldCost += costs[(y + dy) * base.blocksWide + x + dx] ?? 0
                oldLoss = Math.max(oldLoss, losses[(y + dy) * base.blocksWide + x + dx] ?? 0)
              }
            let bestCost = oldCost,
              bestKind = 0,
              loss0 = 0,
              loss1 = 0,
              cost0 = 0,
              cost1 = 0
            if (!tiny) {
              const cost = score(x, y, square, squareMultiplier, bestCost)
              if (cost < bestCost && (!guarded || lastLoss <= oldLoss)) {
                bestCost = cost
                bestKind = square
                loss0 = lastLoss
                cost0 = cost
              }
            }
            for (const strategy of [vertical, horizontal]) {
              const dx = strategy === vertical ? blocks / 2 : 0,
                dy = strategy === vertical ? 0 : blocks / 2
              let oldLeft = 0,
                oldRight = 0,
                leftLoss = 0,
                rightLoss = 0
              for (let iy = 0; iy < blocks; iy++)
                for (let ix = 0; ix < blocks; ix++) {
                  const at = (y + iy) * base.blocksWide + x + ix
                  if ((strategy === vertical ? ix : iy) < blocks / 2) {
                    oldLeft += costs[at] ?? 0
                    leftLoss = Math.max(leftLoss, losses[at] ?? 0)
                  } else {
                    oldRight += costs[at] ?? 0
                    rightLoss = Math.max(rightLoss, losses[at] ?? 0)
                  }
                }
              let a = score(
                x,
                y,
                strategy,
                rectangleMultiplier,
                prune ? Math.min(oldLeft, bestCost * (1 + 1e-12) + 1e-12) : oldLeft,
              )
              const la = lastLoss
              // The other half has nonnegative cost. A partition must beat the
              // current square/partition as well as each half's existing cover.
              const left = Math.min(a, oldLeft)
              const skipRight = prune && left >= bestCost
              let b = skipRight
                ? Infinity
                : score(
                    x + dx,
                    y + dy,
                    strategy,
                    rectangleMultiplier,
                    prune
                      ? Math.min(oldRight, Math.max(0, bestCost - left) * (1 + 1e-12) + 1e-12)
                      : oldRight,
                  )
              const lb = skipRight ? Infinity : lastLoss
              if (guarded) {
                if (la > leftLoss) a = Infinity
                if (lb > rightLoss) b = Infinity
              }
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
  if (maskField) memory.release(maskField)
  if (pairs) memory.release(pairs)
  tileMask?.release()
  const adjusted = mode === 'spatial-source' ? memory.allocate(Int32Array, blockCount) : undefined
  if (adjusted) {
    for (let at = 0; at < blockCount; at++) {
      if (!first[at]) continue
      const strategy = strategies[at] ?? 0
      const bw = jpegXlVarDctStrategyBlockWidths[strategy] ?? 1,
        bh = jpegXlVarDctStrategyBlockHeights[strategy] ?? 1
      const x = at % base.blocksWide,
        y = Math.floor(at / base.blocksWide)
      const q = libjxlTransformQuantization(
        selectionField,
        base.blocksWide,
        x,
        y,
        bw,
        bh,
        distance,
        false,
        !initialField,
      )
      for (let dy = 0; dy < bh; dy++)
        for (let dx = 0; dx < bw; dx++)
          adjusted[at + dy * base.blocksWide + dx] = initialField
            ? Math.max(1, Math.min(256, Math.floor(q + 0.5)))
            : q
    }
  }
  try {
    return rewriteStrategyGeometry(
      adjusted ? { ...base, quantizationMap: adjusted } : base,
      context,
      {
        blocksWide: base.blocksWide,
        blocksHigh: base.blocksHigh,
        strategies: Array.from(strategies),
        strategyFirstBlocks: Array.from(first),
      },
      false,
      false,
      compactStorage,
      writerTransform,
    )
  } finally {
    memory.release(strategies)
    memory.release(first)
    if (adjusted) memory.release(adjusted)
  }
}
