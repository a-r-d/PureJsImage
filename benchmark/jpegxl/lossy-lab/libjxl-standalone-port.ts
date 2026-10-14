/**
 * Source: libjxl lib/jxl/enc_heuristics.cc, v0.12.0,
 * a7a9c787341cf703dede03c2009fa460cae5e5df.
 * Copyright (c) the JPEG XL Project Authors. BSD-3-Clause
 * Changes: coherent development orchestration of the separately attributed
 * scalar ports. Retains our CfL, chroma matrix scales and writer. The direct
 * variant uses separately attributed filter defaults and bypasses the discarded
 * own transform search. Other variants retain our EPF decisions.
 * All decisions derive from pixels and distance. No decoder or peer maps.
 */
import type { JpegXlDevelopmentDecisions } from '../../../src/codecs/jpegxl-development-decisions.ts'
import { libjxlDcOverrides } from './libjxl-dc-port.ts'
import { libjxlInitialGlobalScale, libjxlInitialQuantField } from './libjxl-initial-quant-port.ts'
import { libjxlGaborishContext } from './libjxl-gaborish-port.ts'
import { strategyPortOverrides } from './libjxl-strategy-port.ts'
import { selectorBlockCache } from './selector-block-cache.ts'
import { libjxlFilterDefaults } from './libjxl-filter-port.ts'

export type StandalonePort =
  | 'standalone'
  | 'standalone-reference'
  | 'standalone-cache'
  | 'standalone-fast'
  | 'standalone-compact'
  | 'standalone-direct'

export function libjxlStandaloneOverrides(
  distance: number,
  width: number,
  height: number,
  mode: StandalonePort,
): JpegXlDevelopmentDecisions {
  const cache = mode !== 'standalone-reference'
  const prune = mode !== 'standalone-reference' && mode !== 'standalone-cache'
  const fastTransforms =
    mode === 'standalone-fast' || mode === 'standalone-compact' || mode === 'standalone-direct'
  const compact = mode === 'standalone-compact' || mode === 'standalone-direct'
  const direct = mode === 'standalone-direct'
  const dc = libjxlDcOverrides(distance, true).dc
  if (!dc) throw new Error('Missing initial DC quantizer')
  const quantDc = 1 / (512 * dc.quantization[1])
  return {
    skipStrategySearch: direct,
    dc,
    globalScale: libjxlInitialGlobalScale(distance, quantDc),
    rewriteGeometry: (base, context) => {
      const defaults = direct ? libjxlFilterDefaults(distance) : undefined
      const field = libjxlInitialQuantField(base, context, defaults?.quantDistance ?? distance)
      const filtered =
        defaults?.gaborish === false
          ? undefined
          : libjxlGaborishContext(base, context, width, height)
      const cached = cache ? selectorBlockCache(base, filtered ?? context) : undefined
      const sharpness = defaults
        ? base.memory?.allocate(Uint8Array, field.length)
        : base.sharpnessMap
      if (defaults) sharpness?.fill(defaults.sharpness)
      try {
        const select = strategyPortOverrides(
          distance,
          'spatial-source',
          context,
          field,
          prune,
          fastTransforms,
          compact,
        ).rewriteGeometry
        if (!select) throw new Error('Missing standalone selector')
        return select(
          {
            ...base,
            smoothDc: true,
            ...(sharpness ? { sharpnessMap: sharpness } : {}),
            developmentFilters: defaults ?? {
              gaborish: true,
              epfIterations: base.sharpnessMap ? 2 : 0,
            },
          },
          cached ?? filtered ?? context,
        )
      } finally {
        base.memory?.release(field)
        cached?.release()
        filtered?.release()
      }
    },
  }
}
