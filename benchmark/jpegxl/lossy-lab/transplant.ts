import type { JpegXlDevelopmentDecisions } from '../../../src/codecs/jpegxl-development-decisions.ts'
import { JpegXlEncoderMemory } from '../../../src/codecs/jpegxl-encoder-memory.ts'
import { encodeJpegXlVarDct8Async } from '../../../src/codecs/jpegxl-vardct-encode.ts'
import type { TransplantDecisions } from './decisions.ts'
import { rewriteStrategyGeometry } from './strategy-transplant.ts'
import {
  developmentImageHeader,
  encodeDevelopmentReference,
  writeDevelopmentPatches,
  type DevelopmentReference,
} from './feature-transplant.ts'
import type { JpegXlPatch } from '../../../src/codecs/jpegxl-frame-features.ts'
import { developmentSourceContext, ownTransformDecisions } from './source-transplant.ts'
import type { JpegXlDevelopmentTransformContext } from '../../../src/codecs/jpegxl-development-decisions.ts'
import type { VarDctCoefficientGeometry } from '../../../src/codecs/jpegxl-jpeg-encode.ts'

export interface TransplantOverrides extends JpegXlDevelopmentDecisions {
  readonly references?: readonly DevelopmentReference[]
  readonly patches?: readonly JpegXlPatch[]
  readonly matrixScales?: readonly [number, number]
  readonly smoothDc?: boolean
  readonly rawDc?: Readonly<{ quantDc: number; quantization: readonly [number, number, number] }>
}

function quantizationScale(value: number): NonNullable<VarDctCoefficientGeometry['xScale']> {
  if (
    value === 0 ||
    value === 1 ||
    value === 2 ||
    value === 3 ||
    value === 4 ||
    value === 5 ||
    value === 6 ||
    value === 7
  )
    return value
  throw new Error('Invalid signaled channel quantization scale')
}

function rewriteDevelopmentGeometry(
  base: VarDctCoefficientGeometry,
  context: JpegXlDevelopmentTransformContext,
  d: TransplantDecisions,
  forcedStrategies: boolean,
  exactQuant: boolean,
  features: boolean,
  filters: boolean,
): VarDctCoefficientGeometry {
  const selected = forcedStrategies ? d : ownTransformDecisions(base, d)
  const geometry = exactQuant
    ? {
        ...base,
        xScale: quantizationScale(d.xQuantizationScale),
        bScale: quantizationScale(d.bQuantizationScale),
        smoothDc: d.smoothDc,
        quantDc: d.quantDc,
        dcQuantization: d.dcQuantization,
      }
    : base
  if (!features && (!filters || !d.gaborish))
    return rewriteStrategyGeometry(geometry, context, selected, exactQuant)
  const source = developmentSourceContext(geometry, context, d, features, filters && d.gaborish)
  try {
    return rewriteStrategyGeometry(geometry, source, selected, exactQuant)
  } finally {
    source.release()
  }
}

export type TransplantComponent =
  | 'control'
  | 'quant'
  | 'dc'
  | 'cfl'
  | 'filters'
  | 'available'
  | 'strategy'
  | 'features'
  | 'all'
export function parseTransplantComponent(value: string): TransplantComponent {
  if (
    value === 'control' ||
    value === 'quant' ||
    value === 'dc' ||
    value === 'cfl' ||
    value === 'filters' ||
    value === 'available' ||
    value === 'strategy' ||
    value === 'features' ||
    value === 'all'
  )
    return value
  throw new Error('Unknown transplant component')
}

export function transplantOverrides(
  component: TransplantComponent,
  d: TransplantDecisions,
): TransplantOverrides {
  if (
    (component === 'strategy' || component === 'all') &&
    d.strategies.some((s) => s < 0 || s > 20)
  )
    throw new Error('Transform replay currently supports at most 64x64')
  if (component === 'available')
    return {
      ...transplantOverrides('quant', d),
      ...transplantOverrides('dc', d),
      ...transplantOverrides('cfl', d),
      ...transplantOverrides('filters', d),
    }
  if (component === 'strategy')
    return {
      strategyMap: Int32Array.from(d.strategies),
      strategyFirstBlocks: Uint8Array.from(d.strategyFirstBlocks),
      rewriteGeometry: (geometry, context) => rewriteStrategyGeometry(geometry, context, d, false),
    }
  if (component === 'all') {
    const features = transplantOverrides('features', d)
    return {
      ...transplantOverrides('available', d),
      ...features,
      strategyMap: Int32Array.from(d.strategies),
      strategyFirstBlocks: Uint8Array.from(d.strategyFirstBlocks),
      matrixScales: [d.xQuantizationScale, d.bQuantizationScale],
      smoothDc: d.smoothDc,
      rawDc: { quantDc: d.quantDc, quantization: d.dcQuantization },
      rewriteGeometry: (geometry, context) =>
        rewriteDevelopmentGeometry(geometry, context, d, true, true, true, true),
    }
  }
  if (component === 'features') {
    if (d.noise || d.splines.length)
      throw new Error('Noise and spline replay is not needed by this corpus')
    if (d.dependencies.length && !d.references) throw new Error('Missing decoded reference samples')
    return {
      ...(d.patches.length
        ? {
            references: d.references,
            patches: d.patches,
            rewriteGeometry: (geometry, context) =>
              rewriteDevelopmentGeometry(geometry, context, d, false, false, true, false),
          }
        : {}),
    }
  }
  if (
    component === 'filters' &&
    (d.gaborishWeights || d.epfSharpness || d.epfWeights || d.epfSigma)
  )
    throw new Error('Custom loop-filter parameters need a development writer')
  return {
    ...(component === 'quant'
      ? {
          globalScale: d.globalScale,
          quantizationMap: Int32Array.from(d.rawQuantization),
        }
      : {}),
    ...(component === 'dc'
      ? {
          dc: {
            globalScale: d.globalScale,
            quantDc: d.quantDc,
            quantization: d.dcQuantization,
          },
        }
      : {}),
    ...(component === 'cfl'
      ? {
          correlation: {
            parameters: d.colorCorrelation,
            x: Int32Array.from(d.correlationX),
            b: Int32Array.from(d.correlationB),
          },
        }
      : {}),
    ...(component === 'filters'
      ? {
          filters: {
            sharpness: Uint8Array.from(d.sharpness),
            gaborish: d.gaborish,
            epfIterations: d.epfIterations,
          },
          ...(d.gaborish
            ? {
                rewriteGeometry: (
                  geometry: VarDctCoefficientGeometry,
                  context: JpegXlDevelopmentTransformContext,
                ) => rewriteDevelopmentGeometry(geometry, context, d, false, false, false, true),
              }
            : {}),
        }
      : {}),
  }
}

export function assertTransplantDecisions(
  overrides: TransplantOverrides,
  actual: TransplantDecisions,
): void {
  const equal = (a: ArrayLike<number>, b: ArrayLike<number>) => {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
    return true
  }
  if (
    overrides.strategyMap &&
    (!equal(overrides.strategyMap, actual.strategies) ||
      !overrides.strategyFirstBlocks ||
      !equal(overrides.strategyFirstBlocks, actual.strategyFirstBlocks))
  )
    throw new Error('Emitted transform decisions differ')
  if (
    overrides.matrixScales &&
    (overrides.matrixScales[0] !== actual.xQuantizationScale ||
      overrides.matrixScales[1] !== actual.bQuantizationScale)
  )
    throw new Error('Emitted channel matrix scales differ')
  if (overrides.smoothDc !== undefined && overrides.smoothDc !== actual.smoothDc)
    throw new Error('Emitted DC smoothing differs')
  if (
    overrides.rawDc &&
    (overrides.rawDc.quantDc !== actual.quantDc ||
      !equal(overrides.rawDc.quantization, actual.dcQuantization))
  )
    throw new Error('Emitted raw DC fields differ')
  if (overrides.patches && JSON.stringify(overrides.patches) !== JSON.stringify(actual.patches))
    throw new Error('Emitted patch decisions differ')
  if (
    overrides.quantizationMap &&
    (overrides.globalScale !== actual.globalScale ||
      !equal(overrides.quantizationMap, actual.rawQuantization))
  )
    throw new Error('Emitted quant field differs from the forced field')
  if (overrides.correlation) {
    const expected = overrides.correlation
    for (const key of [
      'colorFactor',
      'baseCorrelationX',
      'baseCorrelationB',
      'yToXDc',
      'yToBDc',
    ] as const)
      if (expected.parameters[key] !== actual.colorCorrelation[key])
        throw new Error('Emitted correlation parameters differ')
    if (!equal(expected.x, actual.correlationX) || !equal(expected.b, actual.correlationB))
      throw new Error('Emitted correlation maps differ')
  }
  if (
    overrides.filters &&
    (overrides.filters.gaborish !== actual.gaborish ||
      overrides.filters.epfIterations !== actual.epfIterations ||
      !equal(overrides.filters.sharpness, actual.sharpness))
  )
    throw new Error('Emitted filter settings differ')
  if (overrides.dc) {
    for (let c = 0; c < 3; c++) {
      const expected =
        (overrides.dc.quantization[c] ?? 0) / overrides.dc.globalScale / overrides.dc.quantDc
      const measured = (actual.dcQuantization[c] ?? 0) / actual.globalScale / actual.quantDc
      // Normalizing DC independently of AC may round a field to binary16.
      if (Math.abs(measured / expected - 1) > 0.001) throw new Error('Emitted DC precision differs')
    }
  }
}

/** Uses the same forward path for the control and every component, at effort 7. */
export async function encodeTransplant(
  pixels: Uint8Array,
  width: number,
  height: number,
  distance: number,
  overrides: TransplantOverrides,
) {
  const memory = new JpegXlEncoderMemory(268_435_456)
  try {
    const referenceParts: Uint8Array[] = []
    for (const reference of overrides.references ?? []) {
      const planes = reference.planes.map((plane) => {
        const copy = memory.allocate(Int32Array, plane.length)
        copy.set(plane)
        return copy
      })
      referenceParts.push(...(await encodeDevelopmentReference({ ...reference, planes }, memory)))
      for (const plane of planes) memory.release(plane)
    }
    const imageHeader = referenceParts.length
      ? developmentImageHeader(width, height, memory)
      : undefined
    const parts = await encodeJpegXlVarDct8Async(
      pixels,
      width,
      height,
      distance,
      memory,
      async () => {},
      4,
      7,
      imageHeader,
      8,
      false,
      undefined,
      undefined,
      {
        developmentDecisions: overrides,
        ...(overrides.patches?.length
          ? {
              patchGlobalSection: (section: Uint8Array) =>
                writeDevelopmentPatches(section, overrides.patches ?? [], memory),
            }
          : {}),
      },
    )
    const assembled = referenceParts.length
      ? [parts[0] ?? new Uint8Array(), ...referenceParts, ...parts.slice(1)]
      : parts
    const length = assembled.reduce((n, p) => n + p.length, 0)
    const bytes = memory.allocate(Uint8Array, length + 40)
    bytes.set([
      0, 0, 0, 12, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a, 0, 0, 0, 20, 0x66, 0x74, 0x79,
      0x70, 0x6a, 0x78, 0x6c, 0x20, 0, 0, 0, 0, 0x6a, 0x78, 0x6c, 0x20, 0, 0, 0, 0, 0x6a, 0x78,
      0x6c, 0x63,
    ])
    new DataView(bytes.buffer).setUint32(32, length + 8)
    let offset = 40
    for (const part of assembled) {
      bytes.set(part, offset)
      offset += part.length
    }
    return { bytes, managedPeakBytes: memory.peakBytes }
  } finally {
    memory.close()
  }
}
