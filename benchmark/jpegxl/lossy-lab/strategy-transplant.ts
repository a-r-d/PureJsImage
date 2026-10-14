import {
  packCoefficients,
  unpackCoefficients,
  type PackedCoefficients,
} from './packed-coefficients.ts'
import type { JpegXlDevelopmentTransformContext } from '../../../src/codecs/jpegxl-development-decisions.ts'
import type {
  VarDctCoefficientGeometry,
  VarDctCoefficientPlane,
  JpegXlDevelopmentOrderFamily,
} from '../../../src/codecs/jpegxl-jpeg-encode.ts'
import { jpegXlDevelopmentDequantization } from '../../../src/codecs/jpegxl-vardct-render.ts'
import {
  naturalJpegXlDevelopmentCoefficientOrder,
  jpegXlVarDctStrategyBlockWidths,
  jpegXlVarDctStrategyBlockHeights,
} from '../../../src/codecs/jpegxl-vardct-jpeg.ts'
import { forwardDevelopmentTransform, developmentDcGrid } from './transform-kernels.ts'
import type { TransplantDecisions } from './decisions.ts'
import { libjxlRoundtripLuma, libjxlChromaResidual } from './libjxl-chroma-roundtrip-port.ts'

export function rewriteStrategyGeometry(
  base: VarDctCoefficientGeometry,
  context: JpegXlDevelopmentTransformContext,
  decisions: Pick<
    TransplantDecisions,
    'blocksWide' | 'blocksHigh' | 'strategies' | 'strategyFirstBlocks'
  >,
  exactQuant: boolean,
  roundtripChroma = false,
  compactStorage = false,
): VarDctCoefficientGeometry {
  const memory = base.memory
  if (
    !memory ||
    base.blocksWide !== decisions.blocksWide ||
    base.blocksHigh !== decisions.blocksHigh
  )
    throw new Error('Strategy transplant dimensions differ')
  const strategies = memory.allocate(Int32Array, decisions.strategies.length)
  strategies.set(decisions.strategies)
  const q = memory.allocate(Int32Array, strategies.length)
  if (!base.quantizationMap) throw new Error('Missing own quant field')
  q.set(base.quantizationMap)
  const scratch = memory.allocate(Float64Array, 4096)
  const transformed = [
    memory.allocate(Float64Array, 4096),
    memory.allocate(Float64Array, 4096),
    memory.allocate(Float64Array, 4096),
  ]
  const firstBlocks = memory.allocate(Uint8Array, strategies.length)
  firstBlocks.set(decisions.strategyFirstBlocks)
  const source = [
    memory.allocate(Float32Array, 4096),
    memory.allocate(Float32Array, 4096),
    memory.allocate(Float32Array, 4096),
  ]
  const dc = memory.allocate(Float64Array, 64)
  const orders: JpegXlDevelopmentOrderFamily[] = [0, 1, 4, 5, 10, 6, 8, 18, 19].map((strategy) => {
    const natural = naturalJpegXlDevelopmentCoefficientOrder(strategy)
    // Our existing writer uses transposed internal coordinates for the small family.
    if (strategy === 0 || strategy === 1)
      for (let i = 0; i < natural.length; i++) {
        const p = natural[i] ?? 0
        natural[i] = (p & 7) * 8 + (p >>> 3)
      }
    const wire =
      strategy === 0
        ? 0
        : strategy === 1
          ? 1
          : strategy === 4
            ? 2
            : strategy === 5
              ? 3
              : strategy === 10
                ? 6
                : strategy === 6
                  ? 4
                  : strategy === 8
                    ? 5
                    : strategy === 18
                      ? 7
                      : 8
    return {
      wire,
      natural,
      skip:
        (jpegXlVarDctStrategyBlockWidths[strategy] ?? 0) *
        (jpegXlVarDctStrategyBlockHeights[strategy] ?? 0),
    }
  })
  const groupCount = base.groupsAcross * base.groupsDown
  const groups: (readonly VarDctCoefficientPlane[])[] = []
  const packedGroups: {
    planes: readonly PackedCoefficients[]
    offsets: Int32Array
    width: number
    height: number
  }[] = []
  const invGlobal = 65536 / (base.globalScale ?? 0)
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
        if (
          bw < 1 ||
          bh < 1 ||
          bw > 8 ||
          bh > 8 ||
          x + bw > width ||
          y + bh > height ||
          decisions.strategyFirstBlocks[at] !== 1
        )
          throw new Error('Invalid forced transform footprint')
        let quant = 0
        for (let dy = 0; dy < bh; dy++)
          for (let dx = 0; dx < bw; dx++) {
            const index = (oy + y + dy) * base.blocksWide + ox + x + dx
            if (strategies[index] !== strategy)
              throw new Error('Forced transform footprint map differs')
            if (exactQuant && q[index] !== q[at])
              throw new Error('Forced quant field varies within transform')
            quant = Math.max(quant, q[index] ?? 0)
            visited[(y + dy) * width + x + dx] = 1
          }
        offsets[y * width + x] = cursor
        for (let dy = 0; dy < bh; dy++)
          for (let dx = 0; dx < bw; dx++) q[(oy + y + dy) * base.blocksWide + ox + x + dx] = quant
        const size = bw * bh * 64,
          stride = bw * 8
        {
          for (let dy = 0; dy < bh; dy++)
            for (let dx = 0; dx < bw; dx++) {
              const block = context.readBlock(ox + x + dx, oy + y + dy, false)
              for (let c = 0; c < 3; c++) {
                const plane = block[c],
                  target = source[c]
                if (!plane || !target) throw new Error('Missing transform source plane')
                for (let py = 0; py < 8; py++)
                  for (let px = 0; px < 8; px++)
                    target[(dy * 8 + py) * stride + dx * 8 + px] = plane[py * 8 + px] ?? 0
              }
            }
          for (let c = 0; c < 3; c++) {
            const plane = source[c]
            const result = transformed[c]
            if (!plane || !result) throw new Error('Missing transform plane')
            forwardDevelopmentTransform(strategy, plane, scratch, result)
            {
              developmentDcGrid(result, bw, bh, dc)
              const target = base.dcComponents[c < 2 ? c ^ 1 : c]?.coefficients
              const step = (invGlobal * (base.dcQuantization?.[c] ?? 0)) / (base.quantDc ?? 0)
              if (!target || !(step > 0)) throw new Error('Missing transform DC precision')
              for (let dy = 0; dy < bh; dy++)
                for (let dx = 0; dx < bw; dx++)
                  target[(oy + y + dy) * base.blocksWide + ox + x + dx] = Math.round(
                    (dc[dy * bw + dx] ?? 0) / step,
                  )
            }
          }
          // Set our existing rate-aware quantizer's activity state at the leader.
          context.readBlock(ox + x, oy + y, true)
          const tile =
            Math.floor((oy + y) / 8) * Math.ceil(base.blocksWide / 8) + Math.floor((ox + x) / 8)
          const correlation = base.developmentCorrelation
          const yCoefficients = transformed[1]
          if (!yCoefficients) throw new Error('Missing luminance coefficients')
          if (roundtripChroma) {
            const target = coefficients[1],
              matrix = jpegXlDevelopmentDequantization(strategy)[1]
            if (!target || !matrix) throw new Error('Missing luma roundtrip target')
            libjxlRoundtripLuma(
              yCoefficients,
              scratch,
              target,
              cursor,
              size,
              bw,
              bh,
              invGlobal / quant,
              matrix,
              context,
            )
          }
          for (let c = 0; c < 3; c++) {
            if (roundtripChroma && c === 1) continue
            const result = transformed[c]
            const target = coefficients[c],
              table = jpegXlDevelopmentDequantization(strategy)[c]
            if (!target || !table || !result) throw new Error('Missing transform quantization')
            const ratio =
              c === 0
                ? (correlation?.baseCorrelationX ?? 0) +
                  (base.correlationX?.[tile] ?? 0) / (correlation?.colorFactor ?? 84)
                : c === 2
                  ? (correlation ? correlation.baseCorrelationB - 1 : 0) +
                    (base.correlationB?.[tile] ?? 0) / (correlation?.colorFactor ?? 84)
                  : 0
            const multiplier =
              c === 0
                ? 0.8 ** ((base.xScale ?? 2) - 2)
                : c === 2
                  ? 0.8 ** ((base.bScale ?? 2) - 2)
                  : 1
            const step = (invGlobal / quant) * multiplier
            for (let p = 0; p < size; p++) {
              const naturalWidth = Math.max(bw, bh) * 8
              if (
                p % naturalWidth < Math.max(bw, bh) &&
                Math.floor(p / naturalWidth) < Math.min(bw, bh)
              )
                continue
              const value = context.quantize(
                (roundtripChroma
                  ? libjxlChromaResidual(
                      result[p] ?? 0,
                      yCoefficients[p] ?? 0,
                      scratch[p] ?? 0,
                      ratio,
                      c === 2,
                    )
                  : (result[p] ?? 0) - ratio * (yCoefficients[p] ?? 0)) /
                  (step * (table[p] ?? 0)),
                c,
              )
              if (Math.abs(value) > 4095)
                throw new Error('Forced transform coefficient exceeds writer range')
              target[cursor + (size === 64 ? (p & 7) * 8 + (p >>> 3) : p)] = value
            }
          }
        }
        cursor += size
      }
    memory.release(visited)
    if (compactStorage) {
      const planes = coefficients.map((plane) => {
        const packed = packCoefficients(plane, memory)
        if (packed.values !== plane) memory.release(plane)
        return packed
      })
      packedGroups.push({ planes, offsets, width, height })
    } else {
      groups.push(
        coefficients.map((coefficients) => ({
          coefficients,
          coefficientOffsets: offsets,
          blocksPerLineForMcu: width,
          blocksPerColumnForMcu: height,
        })),
      )
    }
  }
  for (const buffer of [...source, scratch, ...transformed, dc]) memory.release(buffer)
  const restored = compactStorage
    ? [
        memory.allocate(Int16Array, 65536),
        memory.allocate(Int16Array, 65536),
        memory.allocate(Int16Array, 65536),
      ]
    : undefined
  let restoredGroup = -1
  let restoredPlanes: readonly VarDctCoefficientPlane[] = []
  const loadAc = restored
    ? (group: number): readonly VarDctCoefficientPlane[] => {
        if (restoredGroup === group) return restoredPlanes
        const stored = packedGroups[group]
        if (!stored) throw new Error('Missing packed AC group')
        restoredPlanes = stored.planes.map((packed, channel) => {
          const target = restored[channel]
          if (!target) throw new Error('Missing packed AC channel')
          unpackCoefficients(packed, target)
          return {
            coefficients: target.subarray(0, packed.values.length),
            coefficientOffsets: stored.offsets,
            blocksPerLineForMcu: stored.width,
            blocksPerColumnForMcu: stored.height,
          }
        })
        restoredGroup = group
        return restoredPlanes
      }
    : (group: number): readonly VarDctCoefficientPlane[] => {
        const planes = groups[group]
        if (!planes) throw new Error('Missing forced AC group')
        return planes
      }
  return {
    ...base,
    strategyMap: strategies,
    developmentFirstBlocks: firstBlocks,
    quantizationMap: q,
    developmentOrderFamilies: orders,
    coefficientOrders: orders.flatMap((order) => [order.natural, order.natural, order.natural]),
    loadAc,
  }
}
