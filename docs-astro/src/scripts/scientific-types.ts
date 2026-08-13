import type { ScientificDisplayScale, ScientificPalette } from '../../../src/scientific/index.ts'

export type ScientificDemoMode = 'surface' | 'hyperspectral' | 'fits' | 'mrc' | 'cbf'
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
  readonly channel: number
  readonly red: number
  readonly green: number
  readonly blue: number
  readonly z: number
  readonly sliceAxis: 'xy' | 'xz' | 'yz'
  readonly projection: 'none' | 'max' | 'min' | 'mean'
  readonly sliceIndex: number
}

export interface ScientificFitsHduOption {
  readonly index: number
  readonly label: string
  readonly canOpenRaster: boolean
}

export type ScientificWorkerRequest =
  | { readonly type: 'open-gsf'; readonly name: string; readonly data: ArrayBuffer | File }
  | {
      readonly type: 'open-envi'
      readonly headerName: string
      readonly dataName: string
      readonly header: ArrayBuffer | File
      readonly data: ArrayBuffer | File
    }
  | { readonly type: 'open-fits'; readonly name: string; readonly data: ArrayBuffer | File }
  | { readonly type: 'open-mrc'; readonly name: string; readonly data: ArrayBuffer | File }
  | { readonly type: 'open-cbf'; readonly name: string; readonly data: ArrayBuffer | File }
  | { readonly type: 'select-fits-hdu'; readonly index: number }
  | { readonly type: 'download-png' }
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
  readonly channelCenters?: readonly (number | null)[]
  readonly enviFileType?: 'ENVI Standard' | 'ENVI Classification'
  readonly classificationClasses?: number
  readonly dataMin?: number
  readonly dataMax?: number
  readonly sourceBytes: number
  readonly sizeZ?: number
  readonly sliceAxes: readonly ('xy' | 'xz' | 'yz')[]
  readonly fitsHdus?: readonly ScientificFitsHduOption[]
  readonly fitsHdu?: number
  readonly fitsPrimary?: boolean
  readonly bitpix?: number
  readonly bscale?: number
  readonly bzero?: number
  readonly blank?: number
  readonly storedSampleType?: string
  readonly byteOrder?: string
  readonly mrcMode?: number
  readonly detectorName?: string
  readonly exposureTimeSeconds?: number
  readonly wavelengthAngstroms?: number
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
      readonly nativeRangeLabel?: string
    }
  | { readonly type: 'png'; readonly data: Uint8Array<ArrayBuffer> }
  | { readonly type: 'error'; readonly message: string }
