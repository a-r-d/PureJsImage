import type { ImageCodec, ImageDecoder } from '../codec.ts'
import type { ImageLimitOptions } from '../limits.ts'
import type { RasterDecoder } from '../raster.ts'
import type { ImageSource } from '../source.ts'

export type TiffTagValue =
  | { readonly kind: 'ascii'; readonly value: string }
  | { readonly kind: 'numbers'; readonly values: readonly number[] }
  | { readonly kind: 'bigints'; readonly values: readonly bigint[] }
  | { readonly kind: 'bytes'; readonly value: Uint8Array }

export interface TiffTagReadOptions {
  /** Maximum tag payload read for this call. Defaults to 1 MiB. */
  readonly maxBytes?: number
}

export interface TiffDirectory {
  readonly index: number
  readonly width: number
  readonly height: number
  readonly compression: number
  readonly photometric: number
  readonly samplesPerPixel: number
  readonly bitsPerSample: readonly number[]
  readonly sampleFormats: readonly number[]
  readonly planar: boolean
  readonly tiled: boolean
  readonly tileWidth?: number
  readonly tileHeight?: number
  readonly subIfds: readonly TiffDirectory[]

  getTag(tag: number, options?: Readonly<TiffTagReadOptions>): Promise<TiffTagValue | undefined>
  createImageDecoder(): Promise<ImageDecoder>
  createRasterDecoder(): Promise<RasterDecoder>
}

export interface TiffDocument {
  readonly littleEndian: boolean
  readonly bigTiff: boolean
  readonly directories: readonly TiffDirectory[]
  readonly topLevelDirectories: readonly TiffDirectory[]

  getDirectory(index: number): TiffDirectory | undefined
}

export interface TiffDocumentOptions extends ImageLimitOptions {
  readonly embeddedCodecs?: readonly ImageCodec[]
}

export type TiffDocumentOpener = (
  source: ImageSource,
  options?: Readonly<TiffDocumentOptions>,
) => Promise<TiffDocument>
