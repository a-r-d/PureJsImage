import type { ImageLimits } from '../limits.ts'
import { validateImageDimensions } from '../limits.ts'
import type { ImageSource } from '../source.ts'
import {
  parseCoefficientJpegSource,
  type JpegCoefficientScan,
  type JpegColorTransform,
} from './jpeg-baseline.ts'

export interface JpegCoefficientComponent {
  readonly id: number
  readonly horizontalSampling: number
  readonly verticalSampling: number
  readonly quantizationTable: number
  readonly blocksPerLine: number
  readonly blocksPerColumn: number
  readonly blocksPerLineForMcu: number
  readonly blocksPerColumnForMcu: number
  readonly quantization: Int32Array
  readonly coefficients: Int16Array
}

export interface JpegCoefficientImage {
  readonly width: number
  readonly height: number
  readonly progressive: boolean
  readonly colorTransform: JpegColorTransform
  readonly maximumHorizontalSampling: number
  readonly maximumVerticalSampling: number
  readonly mcusPerLine: number
  readonly mcusPerColumn: number
  readonly restartInterval: number
  readonly components: readonly JpegCoefficientComponent[]
  readonly scans: readonly JpegCoefficientScan[]
  readonly coefficientBytes: number
}

export const parseJpegCoefficientImage = async (
  source: ImageSource,
  limits: ImageLimits,
  maximumCoefficientBytes: number,
): Promise<JpegCoefficientImage | undefined> => {
  const jpeg = await parseCoefficientJpegSource(
    source,
    (width, height) => validateImageDimensions(width, height, 1, limits),
    false,
    maximumCoefficientBytes,
  )
  if (!jpeg) return undefined
  let coefficientBytes = 0
  const components = Object.freeze(
    jpeg.components.map((component) => {
      coefficientBytes += component.coefficients.byteLength
      return Object.freeze({
        id: component.id,
        horizontalSampling: component.horizontalSampling,
        verticalSampling: component.verticalSampling,
        quantizationTable: component.quantizationId,
        blocksPerLine: component.blocksPerLine,
        blocksPerColumn: component.blocksPerColumn,
        blocksPerLineForMcu: component.blocksPerLineForMcu,
        blocksPerColumnForMcu: component.blocksPerColumnForMcu,
        quantization: component.quantization,
        coefficients: component.coefficients,
      })
    }),
  )
  return Object.freeze({
    width: jpeg.width,
    height: jpeg.height,
    progressive: jpeg.progressive,
    colorTransform: jpeg.colorTransform,
    maximumHorizontalSampling: jpeg.maximumHorizontalSampling,
    maximumVerticalSampling: jpeg.maximumVerticalSampling,
    mcusPerLine: jpeg.mcusPerLine,
    mcusPerColumn: jpeg.mcusPerColumn,
    restartInterval: jpeg.restartInterval,
    components,
    scans: jpeg.scans,
    coefficientBytes,
  })
}
