import type { ScientificDisplayScale, ScientificPalette } from '../../../src/scientific/index.ts'

export type ScientificDemoMode = 'surface' | 'hyperspectral'
export type ScientificDemoRangeMode = 'dataset' | 'percentile' | 'explicit'
export type ScientificDemoDisplayMode = 'band' | 'composite'

export interface ScientificDemoRenderSettings {
  readonly displayMode: ScientificDemoDisplayMode
  readonly palette: ScientificPalette
  readonly rangeMode: ScientificDemoRangeMode
  readonly rangeMin: number
  readonly rangeMax: number
  readonly percentileLow: number
  readonly percentileHigh: number
  readonly scale: ScientificDisplayScale
  readonly relief: boolean
  readonly reliefAzimuth: number
  readonly reliefElevation: number
  readonly reliefStrength: number
  readonly wavelength: number
  readonly red: number
  readonly green: number
  readonly blue: number
}

export type ScientificWorkerRequest =
  | { readonly type: 'open-gsf'; readonly name: string; readonly data: ArrayBuffer }
  | {
      readonly type: 'open-envi'
      readonly headerName: string
      readonly dataName: string
      readonly header: ArrayBuffer
      readonly data: ArrayBuffer
    }
  | {
      readonly type: 'render'
      readonly sequence: number
      readonly settings: ScientificDemoRenderSettings
    }

export interface ScientificOpenedMetadata {
  readonly mode: ScientificDemoMode
  readonly name: string
  readonly width: number
  readonly height: number
  readonly bands: number
  readonly sampleType: string
  readonly title?: string
  readonly valueUnit?: string
  readonly physicalWidth?: number
  readonly physicalHeight?: number
  readonly physicalUnit?: string
  readonly pixelSizeX?: number
  readonly pixelSizeY?: number
  readonly wavelengthMin?: number
  readonly wavelengthMax?: number
  readonly wavelengthUnit?: string
  readonly dataMin: number
  readonly dataMax: number
  readonly sourceBytes: number
}

export type ScientificWorkerResponse =
  | { readonly type: 'opening'; readonly message: string }
  | { readonly type: 'opened'; readonly metadata: ScientificOpenedMetadata }
  | {
      readonly type: 'rendered'
      readonly sequence: number
      readonly width: number
      readonly height: number
      readonly pixels: Uint8ClampedArray<ArrayBuffer>
      readonly renderMilliseconds: number
      readonly sourceBytesRead: number
      readonly sourceBytesLabel: string
      readonly rangeLabel: string
      readonly selectionLabel?: string
    }
  | { readonly type: 'error'; readonly message: string }
