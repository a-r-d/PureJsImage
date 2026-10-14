import type { JpegXlDevelopmentDecisions } from '../../../src/codecs/jpegxl-development-decisions.ts'
import type { VarDctCoefficientGeometry } from '../../../src/codecs/jpegxl-jpeg-encode.ts'
import {
  jpegXlVarDctStrategyBlockWidths,
  jpegXlVarDctStrategyBlockHeights,
} from '../../../src/codecs/jpegxl-vardct-jpeg.ts'
import {
  parseStrategyPort,
  strategyPortOverrides,
  type StrategyPort,
} from './libjxl-strategy-port.ts'
import { libjxlGaborishContext } from './libjxl-gaborish-port.ts'
import { libjxlDcOverrides } from './libjxl-dc-port.ts'
import { rewriteStrategyGeometry } from './strategy-transplant.ts'

export type LibjxlPort =
  | StrategyPort
  | 'own-rewrite'
  | 'own-roundtrip'
  | 'gaborish'
  | 'gaborish-strategy'
  | 'dc'
  | 'dc-smooth'
export function parseLibjxlPort(value: string): LibjxlPort {
  if (
    value === 'own-rewrite' ||
    value === 'own-roundtrip' ||
    value === 'gaborish' ||
    value === 'gaborish-strategy' ||
    value === 'dc' ||
    value === 'dc-smooth'
  )
    return value
  return parseStrategyPort(value)
}

function ownDecisions(base: VarDctCoefficientGeometry) {
  const strategies = Array.from(
    base.strategyMap ?? new Int32Array(base.blocksWide * base.blocksHigh),
  )
  const strategyFirstBlocks = new Uint8Array(strategies.length)
  const visited = new Uint8Array(strategies.length)
  for (let y = 0; y < base.blocksHigh; y++)
    for (let x = 0; x < base.blocksWide; x++) {
      const at = y * base.blocksWide + x
      if (visited[at]) continue
      const strategy = strategies[at] ?? 0
      const bw = jpegXlVarDctStrategyBlockWidths[strategy] ?? 0,
        bh = jpegXlVarDctStrategyBlockHeights[strategy] ?? 0
      if (!bw || !bh || x + bw > base.blocksWide || y + bh > base.blocksHigh)
        throw new Error('Invalid own strategy footprint')
      strategyFirstBlocks[at] = 1
      for (let dy = 0; dy < bh; dy++)
        for (let dx = 0; dx < bw; dx++) visited[(y + dy) * base.blocksWide + x + dx] = 1
    }
  return {
    blocksWide: base.blocksWide,
    blocksHigh: base.blocksHigh,
    strategies,
    strategyFirstBlocks: Array.from(strategyFirstBlocks),
  }
}

export function libjxlPortOverrides(
  mode: LibjxlPort,
  distance: number,
  width: number,
  height: number,
): JpegXlDevelopmentDecisions {
  if (mode === 'dc' || mode === 'dc-smooth')
    return libjxlDcOverrides(distance, mode === 'dc-smooth')
  if (
    mode === 'own-rewrite' ||
    mode === 'own-roundtrip' ||
    mode === 'gaborish' ||
    mode === 'gaborish-strategy'
  )
    return {
      rewriteGeometry: (base, context) => {
        const decisions = ownDecisions(base)
        if (mode === 'own-rewrite' || mode === 'own-roundtrip')
          return rewriteStrategyGeometry(base, context, decisions, false, mode === 'own-roundtrip')
        const filtered = libjxlGaborishContext(base, context, width, height)
        try {
          if (mode === 'gaborish-strategy') {
            const select = strategyPortOverrides(
              distance,
              'spatial-actual',
              context,
            ).rewriteGeometry
            if (!select) throw new Error('Missing source strategy selector')
            return select(
              {
                ...base,
                developmentFilters: { gaborish: true, epfIterations: base.sharpnessMap ? 2 : 0 },
              },
              filtered,
            )
          }
          return rewriteStrategyGeometry(
            {
              ...base,
              developmentFilters: { gaborish: true, epfIterations: base.sharpnessMap ? 2 : 0 },
            },
            filtered,
            decisions,
            false,
          )
        } finally {
          filtered.release()
        }
      },
    }
  return strategyPortOverrides(distance, mode)
}
