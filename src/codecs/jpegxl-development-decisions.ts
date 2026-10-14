import type { JpegXlJpegColorCorrelation } from './jpegxl-vardct-jpeg.ts'
import type { VarDctCoefficientGeometry } from './jpegxl-jpeg-encode.ts'

export interface JpegXlDevelopmentTransformContext {
  readBlock(x: number, y: number, correlated: boolean): readonly Float32Array[]
  quantize(value: number, channel: number): number
}

/** Internal lab input. Never accepted by the public codec options. */
export interface JpegXlDevelopmentDecisions {
  readonly skipStrategySearch?: boolean
  readonly allocation?: Readonly<{
    acPrecisionScale: number
    dcAlpha: number
    dcSteps: readonly [number, number, number]
    smoothDc?: boolean
  }>
  readonly strategyMap?: Int32Array
  readonly strategyFirstBlocks?: Uint8Array
  readonly rewriteGeometry?: (
    geometry: VarDctCoefficientGeometry,
    context: JpegXlDevelopmentTransformContext,
  ) => VarDctCoefficientGeometry
  readonly globalScale?: number
  readonly quantizationMap?: Int32Array
  readonly dc?: Readonly<{
    globalScale: number
    quantDc: number
    quantization: readonly [number, number, number]
  }>
  readonly correlation?: Readonly<{
    parameters: JpegXlJpegColorCorrelation
    x: Int32Array
    b: Int32Array
  }>
  readonly filters?: Readonly<{
    sharpness: Uint8Array
    gaborish: boolean
    epfIterations: number
  }>
}
