/** Development-only reconstruction of our selected geometry, before entropy coding. */
import {
  writeJpegXlDevelopmentF16,
  type VarDctCoefficientGeometry,
} from '../../../src/codecs/jpegxl-jpeg-encode.ts'
import { JpegXlBitWriter } from '../../../src/codecs/jpegxl-modular-encode.ts'
import {
  convertJpegXlNativeXybPlanes,
  filterJpegXlDevelopmentPlanes,
  inverseJpegXlDevelopmentTransform,
  jpegXlDevelopmentDequantization,
  populateJpegXlDevelopmentLowestFrequencies,
} from '../../../src/codecs/jpegxl-vardct-render.ts'
import {
  jpegXlVarDctStrategyBlockWidths,
  jpegXlVarDctStrategyBlockHeights,
} from '../../../src/codecs/jpegxl-vardct-jpeg.ts'
import { defaultJpegXlQuantizationBiases } from '../../../src/codecs/jpegxl-vardct-quantization.ts'
import { tracePlanes, type TracePlanes } from './display-error-trace.ts'
import { libjxlDitheredRgba } from './libjxl-output-dither-port.ts'

const wireHalf = (value: number): number => {
  const writer = new JpegXlBitWriter()
  writeJpegXlDevelopmentF16(writer, value)
  const bytes = writer.finish(),
    bits = (bytes[0] ?? 0) | ((bytes[1] ?? 0) << 8)
  return bits === 0 ? 0 : (1 + (bits & 1023) / 1024) * 2 ** ((bits >>> 10) - 15)
}

/** Full crop audit first. This allocation pattern is not an encoder speed/memory claim. */
export function renderSelectedGeometry(
  geometry: VarDctCoefficientGeometry,
  width: number,
  height: number,
) {
  const g = geometry,
    strategies = g.strategyMap,
    first = g.developmentFirstBlocks,
    quant = g.quantizationMap,
    sharpness = g.sharpnessMap,
    dcQuant = g.dcQuantization,
    globalScale = g.globalScale,
    quantDc = g.quantDc,
    filters = g.developmentFilters
  if (
    g.colorTransform !== 'xyb' ||
    (g.alpha && !g.opaqueColorCost) ||
    !g.defaultMatrices ||
    g.imageHeader ||
    g.smoothDc ||
    g.progressive ||
    g.shifts.some(([x, y]) => x !== 0 || y !== 0) ||
    !strategies ||
    !first ||
    !quant ||
    !sharpness ||
    !dcQuant ||
    !globalScale ||
    !quantDc ||
    !filters ||
    !g.loadAc ||
    g.blocksWide !== Math.ceil(width / 8) ||
    g.blocksHigh !== Math.ceil(height / 8)
  )
    throw new Error('Geometry display requires the retained standalone SDR geometry')
  const blocks = g.blocksWide * g.blocksHigh,
    stride = g.blocksWide * 8,
    length = stride * g.blocksHigh * 8,
    planes = [
      new Float32Array(length),
      new Float32Array(length),
      new Float32Array(length),
    ] as const,
    dc = tracePlanes(blocks),
    invGlobal = 65536 / globalScale,
    correlation = g.developmentCorrelation,
    factor = correlation?.colorFactor ?? 84,
    baseX = wireHalf(correlation?.baseCorrelationX ?? 0),
    baseB = wireHalf(correlation?.baseCorrelationB ?? g.baseB ?? 0),
    scales = [0.8 ** ((g.xScale ?? 2) - 2), 1, 0.8 ** ((g.bScale ?? 2) - 2)]
  for (let c = 0; c < 3; c++) {
    const source = g.dcComponents[c < 2 ? c ^ 1 : c]?.coefficients,
      target = dc[c],
      step = (invGlobal * (wireHalf((dcQuant[c] ?? 0) * 128) / 128)) / quantDc
    if (!source || !target || source.length !== blocks) throw new Error('Missing geometry DC')
    for (let p = 0; p < blocks; p++) target[p] = (source[p] ?? 0) * step
  }
  for (const c of [0, 2] as const) {
    const ratio =
      c === 0
        ? baseX + (correlation?.yToXDc ?? 0) / factor
        : baseB + (correlation?.yToBDc ?? 0) / factor
    for (let p = 0; p < blocks; p++) dc[c][p] = (dc[c][p] ?? 0) + (dc[1][p] ?? 0) * ratio
  }
  const scratches = new Map<
    number,
    {
      values: TracePlanes
      dc: Float64Array
      temporary: Float64Array
      frequencies: Float64Array
      output: Float32Array
      active: Uint16Array
      matrices: readonly Float64Array[]
    }
  >()
  for (const strategy of new Set(strategies)) {
    const bw = jpegXlVarDctStrategyBlockWidths[strategy] ?? 0,
      bh = jpegXlVarDctStrategyBlockHeights[strategy] ?? 0,
      size = bw * bh * 64
    if (size === 0) throw new Error('Missing geometry transform')
    scratches.set(strategy, {
      values: tracePlanes(size),
      dc: new Float64Array(bw * bh),
      // Hornuss uses the second half of its scratch for quadrant residuals.
      temporary: new Float64Array(Math.max(128, size)),
      frequencies: new Float64Array(bw * bh),
      output: new Float32Array(size),
      active: new Uint16Array(Math.max(bw, bh) * 8),
      matrices: jpegXlDevelopmentDequantization(strategy),
    })
  }
  for (let group = 0; group < g.groupsAcross * g.groupsDown; group++) {
    const ox = (group % g.groupsAcross) * 32,
      oy = Math.floor(group / g.groupsAcross) * 32,
      gw = Math.min(32, g.blocksWide - ox),
      gh = Math.min(32, g.blocksHigh - oy),
      ac = g.loadAc(group, 0)
    for (let y = 0; y < gh; y++)
      for (let x = 0; x < gw; x++) {
        const bx = ox + x,
          by = oy + y,
          at = by * g.blocksWide + bx
        if (!first[at]) continue
        const strategy = strategies[at] ?? -1,
          scratch = scratches.get(strategy),
          bw = jpegXlVarDctStrategyBlockWidths[strategy] ?? 0,
          bh = jpegXlVarDctStrategyBlockHeights[strategy] ?? 0,
          size = bw * bh * 64,
          rawQuant = quant[at] ?? 0,
          tile = Math.floor(by / 8) * Math.ceil(g.blocksWide / 8) + Math.floor(bx / 8)
        if (!scratch || rawQuant < 1) throw new Error('Invalid selected geometry')
        for (let c = 0; c < 3; c++) {
          const component = ac[c],
            offset = component?.coefficientOffsets?.[y * gw + x],
            values = scratch.values[c],
            matrix = scratch.matrices[c],
            scale = (invGlobal * (scales[c] ?? 1)) / rawQuant,
            bias = defaultJpegXlQuantizationBiases[c] ?? 1
          if (!component || offset === undefined || offset < 0 || !values || !matrix)
            throw new Error('Missing selected coefficients')
          for (let p = 0; p < size; p++) {
            const q =
              component.coefficients[offset + (size === 64 ? (p & 7) * 8 + (p >>> 3) : p)] ?? 0
            const adjusted = Math.abs(q) === 1 ? q * bias : q === 0 ? 0 : q - 0.145 / q
            values[p] = adjusted * scale * (matrix[p] ?? 1)
          }
        }
        for (const c of [0, 2] as const) {
          const values = scratch.values[c],
            luma = scratch.values[1],
            ratio =
              c === 0
                ? baseX + (g.correlationX?.[tile] ?? 0) / factor
                : baseB + (g.correlationB?.[tile] ?? 0) / factor
          for (let p = 0; p < size; p++) {
            const yValue = luma[p] ?? 0
            if (yValue !== 0) values[p] = (values[p] ?? 0) + yValue * ratio
          }
        }
        for (let c = 0; c < 3; c++) {
          const values = scratch.values[c],
            channelDc = dc[c],
            plane = planes[c]
          if (!values || !channelDc || !plane) throw new Error('Missing geometry plane')
          for (let dy = 0; dy < bh; dy++)
            for (let dx = 0; dx < bw; dx++)
              scratch.dc[dy * bw + dx] = channelDc[(by + dy) * g.blocksWide + bx + dx] ?? 0
          populateJpegXlDevelopmentLowestFrequencies(
            values,
            scratch.dc,
            bw,
            bh,
            scratch.frequencies,
          )
          inverseJpegXlDevelopmentTransform(
            strategy,
            values,
            scratch.temporary,
            scratch.output,
            scratch.active,
          )
          for (let py = 0; py < bh * 8; py++)
            for (let px = 0; px < bw * 8; px++)
              plane[(by * 8 + py) * stride + bx * 8 + px] = scratch.output[py * bw * 8 + px] ?? 0
        }
      }
  }
  const crop = (): TracePlanes => {
    const result = tracePlanes(width * height)
    for (let c = 0; c < 3; c++) {
      const source = planes[c],
        target = result[c]
      if (!source || !target) throw new Error('Missing display plane')
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) target[y * width + x] = source[y * stride + x] ?? 0
    }
    return result
  }
  const raw = crop()
  filterJpegXlDevelopmentPlanes(
    planes,
    width,
    height,
    quant,
    sharpness,
    globalScale,
    filters.gaborish,
    filters.epfIterations,
  )
  const filtered = crop(),
    srgb = convertJpegXlNativeXybPlanes(filtered, undefined)
  return { raw, filtered, srgb, rgba: libjxlDitheredRgba(srgb, width, height) }
}
