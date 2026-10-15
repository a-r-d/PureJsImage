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
import { libjxlStandaloneOverrides, type StandalonePort } from './libjxl-standalone-port.ts'

export type LibjxlPort =
  | StrategyPort
  | 'own-rewrite'
  | 'own-roundtrip'
  | 'gaborish'
  | 'gaborish-strategy'
  | 'dc'
  | 'dc-smooth'
  | StandalonePort
export function parseLibjxlPort(value: string): LibjxlPort {
  if (
    value === 'own-rewrite' ||
    value === 'own-roundtrip' ||
    value === 'gaborish' ||
    value === 'gaborish-strategy' ||
    value === 'dc' ||
    value === 'dc-smooth' ||
    value === 'standalone' ||
    value === 'standalone-reference' ||
    value === 'standalone-cache' ||
    value === 'standalone-fast' ||
    value === 'standalone-compact' ||
    value === 'standalone-direct' ||
    value === 'standalone-sharp5' ||
    value === 'standalone-sharp6' ||
    value === 'standalone-epf1' ||
    value === 'standalone-hfhalf' ||
    value === 'standalone-symmetric' ||
    value === 'standalone-bounded' ||
    value === 'standalone-sharp2' ||
    value === 'standalone-epf0' ||
    value === 'standalone-inverse' ||
    value === 'standalone-16' ||
    value === 'standalone-optimized' ||
    value === 'standalone-refined' ||
    value === 'standalone-refined-dcfine' ||
    value === 'standalone-refined-nosmooth' ||
    value === 'standalone-refined-round' ||
    value === 'standalone-refined-dcfine-hfhalf' ||
    value === 'standalone-refined-dcquarter' ||
    value === 'standalone-refined-dark-hf' ||
    value === 'standalone-refined-chroma75' ||
    value === 'standalone-refined-chroma100' ||
    value === 'standalone-refined-chroma75-nosmooth' ||
    value === 'standalone-guard-hf625' ||
    value === 'standalone-guard-hf375' ||
    value === 'standalone-guard-packed' ||
    value === 'standalone-guard-source-cache' ||
    value === 'standalone-writer-field' ||
    value === 'standalone-writer-rounding' ||
    value === 'standalone-writer-matrices' ||
    value === 'standalone-loss75' ||
    value === 'standalone-loss125' ||
    value === 'standalone-selector-pairs' ||
    value === 'standalone-writer-all' ||
    value === 'standalone-guard-bounded'
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
  if (
    mode === 'standalone' ||
    mode === 'standalone-reference' ||
    mode === 'standalone-cache' ||
    mode === 'standalone-fast' ||
    mode === 'standalone-compact' ||
    mode === 'standalone-direct' ||
    mode === 'standalone-sharp5' ||
    mode === 'standalone-sharp6' ||
    mode === 'standalone-epf1' ||
    mode === 'standalone-hfhalf' ||
    mode === 'standalone-symmetric' ||
    mode === 'standalone-bounded' ||
    mode === 'standalone-sharp2' ||
    mode === 'standalone-epf0' ||
    mode === 'standalone-inverse' ||
    mode === 'standalone-16' ||
    mode === 'standalone-optimized' ||
    mode === 'standalone-refined' ||
    mode === 'standalone-refined-dcfine' ||
    mode === 'standalone-refined-nosmooth' ||
    mode === 'standalone-refined-round' ||
    mode === 'standalone-refined-dcfine-hfhalf' ||
    mode === 'standalone-refined-dcquarter' ||
    mode === 'standalone-refined-dark-hf' ||
    mode === 'standalone-refined-chroma75' ||
    mode === 'standalone-refined-chroma100' ||
    mode === 'standalone-refined-chroma75-nosmooth' ||
    mode === 'standalone-guard-hf625' ||
    mode === 'standalone-guard-hf375' ||
    mode === 'standalone-guard-packed' ||
    mode === 'standalone-guard-source-cache' ||
    mode === 'standalone-writer-field' ||
    mode === 'standalone-writer-rounding' ||
    mode === 'standalone-writer-matrices' ||
    mode === 'standalone-loss75' ||
    mode === 'standalone-loss125' ||
    mode === 'standalone-selector-pairs' ||
    mode === 'standalone-writer-all' ||
    mode === 'standalone-guard-bounded'
  )
    return libjxlStandaloneOverrides(distance, width, height, mode)
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
                developmentFilters: {
                  gaborish: true,
                  epfIterations: base.sharpnessMap ? 2 : 0,
                },
              },
              filtered,
            )
          }
          return rewriteStrategyGeometry(
            {
              ...base,
              developmentFilters: {
                gaborish: true,
                epfIterations: base.sharpnessMap ? 2 : 0,
              },
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
