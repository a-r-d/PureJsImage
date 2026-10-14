/**
 * Source: libjxl lib/jxl/enc_heuristics.cc, v0.12.0,
 * a7a9c787341cf703dede03c2009fa460cae5e5df.
 * Copyright (c) the JPEG XL Project Authors. BSD-3-Clause
 * Changes: coherent development orchestration of the separately attributed
 * scalar ports. Retains our CfL, chroma matrix scales and writer. The direct
 * variant uses separately attributed filter defaults and bypasses the discarded
 * own transform search. Other variants retain our EPF decisions. Refined
 * experiments cap EPF iterations and independently vary physical DC precision,
 * smoothing, high-frequency masking or coefficient rounding.
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
  | 'standalone-sharp5'
  | 'standalone-sharp6'
  | 'standalone-epf1'
  | 'standalone-hfhalf'
  | 'standalone-symmetric'
  | 'standalone-bounded'
  | 'standalone-sharp2'
  | 'standalone-epf0'
  | 'standalone-inverse'
  | 'standalone-16'
  | 'standalone-optimized'
  | 'standalone-refined'
  | 'standalone-refined-dcfine'
  | 'standalone-refined-nosmooth'
  | 'standalone-refined-round'
  | 'standalone-refined-dcfine-hfhalf'
  | 'standalone-refined-dcquarter'
  | 'standalone-refined-dark-hf'
  | 'standalone-refined-chroma75'
  | 'standalone-refined-chroma100'
  | 'standalone-refined-chroma75-nosmooth'
  | 'standalone-guard-hf625'
  | 'standalone-guard-hf375'
  | 'standalone-guard-packed'
  | 'standalone-guard-source-cache'
  | 'standalone-guard-bounded'

export function libjxlStandaloneOverrides(
  distance: number,
  width: number,
  height: number,
  requestedMode: StandalonePort,
): JpegXlDevelopmentDecisions {
  const guardNoSmooth =
    requestedMode === 'standalone-refined-chroma75-nosmooth' ||
    requestedMode === 'standalone-guard-hf625' ||
    requestedMode === 'standalone-guard-hf375' ||
    requestedMode === 'standalone-guard-packed' ||
    requestedMode === 'standalone-guard-source-cache' ||
    requestedMode === 'standalone-guard-bounded'
  const mode = guardNoSmooth ? 'standalone-refined-chroma75' : requestedMode
  const guardHf =
    requestedMode === 'standalone-guard-hf625' ||
    requestedMode === 'standalone-guard-packed' ||
    requestedMode === 'standalone-guard-source-cache' ||
    requestedMode === 'standalone-guard-bounded'
      ? 0.625
      : requestedMode === 'standalone-guard-hf375'
        ? 0.375
        : undefined
  const cache = mode !== 'standalone-reference'
  const prune = mode !== 'standalone-reference' && mode !== 'standalone-cache'
  const direct = ![
    'standalone',
    'standalone-reference',
    'standalone-cache',
    'standalone-fast',
    'standalone-compact',
  ].includes(mode)
  const fastTransforms = mode === 'standalone-fast' || mode === 'standalone-compact' || direct
  const compact = mode === 'standalone-compact' || direct
  const refined =
    mode === 'standalone-refined' ||
    mode === 'standalone-refined-dcfine' ||
    mode === 'standalone-refined-nosmooth' ||
    mode === 'standalone-refined-round' ||
    mode === 'standalone-refined-dcfine-hfhalf' ||
    mode === 'standalone-refined-dcquarter' ||
    mode === 'standalone-refined-dark-hf' ||
    mode === 'standalone-refined-chroma75' ||
    mode === 'standalone-refined-chroma100'
  const optimized = mode === 'standalone-optimized' || refined
  const dc = libjxlDcOverrides(distance, true).dc
  if (!dc) throw new Error('Missing initial DC quantizer')
  const quantDc = 1 / (512 * dc.quantization[1])
  const dcScale =
    mode === 'standalone-refined-dcquarter'
      ? 0.25
      : mode === 'standalone-refined-dcfine' ||
          mode === 'standalone-refined-dcfine-hfhalf' ||
          mode === 'standalone-refined-dark-hf' ||
          mode === 'standalone-refined-chroma75' ||
          mode === 'standalone-refined-chroma100'
        ? 0.5
        : 1
  const dcChromaScale =
    mode === 'standalone-refined-chroma75'
      ? 0.75
      : mode === 'standalone-refined-chroma100'
        ? 1
        : dcScale
  const chosenDc: NonNullable<JpegXlDevelopmentDecisions['dc']> =
    dcScale !== 1
      ? {
          ...dc,
          quantization: [
            dc.quantization[0] * dcChromaScale,
            dc.quantization[1] * dcScale,
            dc.quantization[2] * dcChromaScale,
          ],
        }
      : dc
  return {
    skipStrategySearch: direct,
    dc: chosenDc,
    globalScale: libjxlInitialGlobalScale(distance, quantDc),
    rewriteGeometry: (base, sourceContext) => {
      const context =
        mode === 'standalone-refined-round'
          ? { readBlock: sourceContext.readBlock, quantize: Math.round }
          : sourceContext
      const defaults = direct ? libjxlFilterDefaults(distance) : undefined
      if (defaults && mode === 'standalone-sharp2') defaults.sharpness = 2
      if (defaults && mode === 'standalone-epf0') defaults.epfIterations = 0
      if (defaults && mode === 'standalone-sharp5') defaults.sharpness = 5
      if (defaults && mode === 'standalone-sharp6') defaults.sharpness = 6
      if (defaults && (mode === 'standalone-epf1' || refined))
        defaults.epfIterations = Math.min(1, defaults.epfIterations)
      const field = libjxlInitialQuantField(
        base,
        context,
        defaults?.quantDistance ?? distance,
        guardHf ??
          (mode === 'standalone-hfhalf' ||
          mode === 'standalone-refined-dcfine-hfhalf' ||
          mode === 'standalone-refined-chroma75' ||
          mode === 'standalone-refined-chroma100'
            ? 0.5
            : 1),
        mode === 'standalone-bounded' || optimized,
        mode === 'standalone-refined-dark-hf',
      )
      const filtered =
        defaults?.gaborish === false
          ? undefined
          : libjxlGaborishContext(
              base,
              context,
              width,
              height,
              requestedMode === 'standalone-guard-source-cache' ||
                requestedMode === 'standalone-guard-bounded',
            )
      const cached = cache ? selectorBlockCache(base, filtered ?? context) : undefined
      const sharpness = defaults
        ? base.memory?.allocate(Uint8Array, field.length)
        : base.sharpnessMap
      if (defaults) sharpness?.fill(defaults.sharpness)
      try {
        const select = strategyPortOverrides(distance, 'spatial-source', context, {
          initialField: field,
          compactStorage:
            requestedMode === 'standalone-guard-packed' ||
            requestedMode === 'standalone-guard-bounded',
          prune,
          fastTransforms,
          compact,
          symmetric: optimized || mode === 'standalone-symmetric' || mode === 'standalone-inverse',
          boundedMask: mode === 'standalone-bounded' || optimized,
          symmetricInverse: optimized || mode === 'standalone-inverse',
          limit16: mode === 'standalone-16',
        }).rewriteGeometry
        if (!select) throw new Error('Missing standalone selector')
        return select(
          {
            ...base,
            smoothDc: mode !== 'standalone-refined-nosmooth' && !guardNoSmooth,
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
