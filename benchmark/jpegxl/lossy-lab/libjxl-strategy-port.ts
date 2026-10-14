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
 * Tiny's split-cost literal is written as its representable JavaScript double.
 * This is a development experiment, never imported by the public encoder.
 */
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

export function strategyPortOverrides(
  distance: number,
  mode: StrategyPort,
  maskContext?: JpegXlDevelopmentTransformContext,
): JpegXlDevelopmentDecisions {
  if (!(distance >= 0.25 && distance <= 25)) throw new Error('Invalid strategy-port distance')
  return {
    rewriteGeometry: (base, context) =>
      selectGeometry(base, context, distance, mode, maskContext ?? context),
  }
}

function selectGeometry(
  base: VarDctCoefficientGeometry,
  context: JpegXlDevelopmentTransformContext,
  distance: number,
  mode: StrategyPort,
  maskContext: JpegXlDevelopmentTransformContext,
): VarDctCoefficientGeometry {
  const memory = base.memory
  if (!memory || !base.quantizationMap || !base.globalScale)
    throw new Error('Missing strategy input')
  const blockCount = base.blocksWide * base.blocksHigh
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
  const infoWeight = 1.2 * ratio ** 0.33677806662454718
  const zeroWeight = 9.3089059022677905 * ratio ** 0.50990926717963703
  const magnitudeWeight = 10.833273317067883 * ratio ** 0.36702940662370243
  const invGlobal = 65536 / base.globalScale
  const tiny = mode === 'tiny'
  const actualRounding = mode === 'spatial-actual' || mode === 'spatial-actual-guarded'
  const guarded = mode === 'spatial-guarded' || mode === 'spatial-actual-guarded'
  const maskField =
    mode === 'spatial-masked' || mode === 'spatial-source' || guarded || actualRounding
      ? libjxlStrategyMask(base, maskContext)
      : undefined
  let lastLoss = 0

  // All scratch belongs to one candidate, independent of image area.
  const score = (x: number, y: number, strategy: number, entropyMultiplier: number): number => {
    const bw = jpegXlVarDctStrategyBlockWidths[strategy] ?? 0
    const bh = jpegXlVarDctStrategyBlockHeights[strategy] ?? 0
    const width = bw * 8,
      height = bh * 8,
      size = width * height
    let quantizer = 0
    for (let dy = 0; dy < bh; dy++)
      for (let dx = 0; dx < bw; dx++) {
        quantizer = Math.max(
          quantizer,
          base.quantizationMap?.[(y + dy) * base.blocksWide + x + dx] ?? 0,
        )
        const block = context.readBlock(x + dx, y + dy, false)
        for (let c = 0; c < 3; c++) {
          const source = block[c],
            target = planes[c]
          if (!source || !target) throw new Error('Missing strategy color plane')
          for (let py = 0; py < 8; py++)
            for (let px = 0; px < 8; px++)
              target[(dy * 8 + py) * width + dx * 8 + px] = source[py * 8 + px] ?? 0
        }
      }
    if (mode === 'spatial-source')
      quantizer = libjxlTransformQuantization(
        base.quantizationMap ?? [],
        base.blocksWide,
        x,
        y,
        bw,
        bh,
        distance,
        true,
      )
    for (let c = 0; c < 3; c++) {
      const source = planes[c],
        output = transformed[c]
      if (!source || !output) throw new Error('Missing transform scratch')
      forwardDevelopmentTransform(strategy, source, scratch, output)
    }
    const tile = Math.floor(y / 8) * Math.ceil(base.blocksWide / 8) + Math.floor(x / 8)
    const scale = invGlobal / quantizer
    let entropy = 0,
      loss = 0,
      absoluteError = 0,
      squaredError = 0
    if (actualRounding) context.readBlock(x, y, true)
    const tables = jpegXlDevelopmentDequantization(strategy)
    const naturalWidth = Math.max(width, height)
    for (let c = 0; c < 3; c++) {
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
        mode === 'spatial-source'
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
      entropy += channelEntropy
      if (!tiny) {
        inverseJpegXlDevelopmentTransform(
          strategy,
          residual.subarray(0, size),
          scratch,
          spatial.subarray(0, size),
          active,
        )
        const channelWeight = c === 0 ? 8.2 : c === 2 ? 1.03 : 1
        const maskOffset = c === 0 ? 12 : c === 2 ? 4 : 0
        let channelLoss = 0
        for (let p = 0; p < size; p++) {
          const mask =
            maskField?.[
              (y * 8 + Math.floor(p / width)) * base.blocksWide * 8 + x * 8 + (p % width)
            ] ?? 1
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
  for (let y = 0; y < base.blocksHigh; y++)
    for (let x = 0; x < base.blocksWide; x++) {
      let best = 0,
        bestCost = score(x, y, 0, 1),
        bestLoss = lastLoss
      if (!tiny)
        for (let i = 1; i < smallMenu.length; i++) {
          const strategy = smallMenu[i] ?? 0
          let weight = (smallWeights[i] ?? 0.8) / 0.8
          if ((strategy === 1 || strategy === 2) && distance < 5)
            weight -= 0.4 * ((5 - distance) / 5) ** 2
          if (strategy !== 0 && strategy !== 1 && strategy !== 2 && distance > 4)
            weight += 0.5 * (distance < 12 ? 8 / (distance - 4) : 1)
          const cost = score(x, y, strategy, weight)
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
  for (const blocks of tiny ? [2] : [2, 4, 8]) {
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
    for (let y = 0; y + blocks <= base.blocksHigh; y += blocks)
      for (let x = 0; x + blocks <= base.blocksWide; x += blocks) {
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
          const cost = score(x, y, square, squareMultiplier)
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
          let a = score(x, y, strategy, rectangleMultiplier)
          const la = lastLoss
          let b = score(x + dx, y + dy, strategy, rectangleMultiplier)
          const lb = lastLoss
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
        base.quantizationMap,
        base.blocksWide,
        x,
        y,
        bw,
        bh,
        distance,
        false,
      )
      for (let dy = 0; dy < bh; dy++)
        for (let dx = 0; dx < bw; dx++) adjusted[at + dy * base.blocksWide + dx] = q
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
    )
  } finally {
    memory.release(strategies)
    memory.release(first)
    if (adjusted) memory.release(adjusted)
  }
}
