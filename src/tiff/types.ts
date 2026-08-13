import type { AbortOptions } from '../abort.ts'
import type { ImageCodec, ImageDecoder } from '../codec.ts'
import type { ImageLimitOptions } from '../limits.ts'
import type { RasterDecoder } from '../raster.ts'
import type { ImageSource } from '../source.ts'

export type TiffTagValue =
  | { readonly kind: 'ascii'; readonly value: string }
  | { readonly kind: 'numbers'; readonly values: readonly number[] }
  | { readonly kind: 'bigints'; readonly values: readonly bigint[] }
  | { readonly kind: 'bytes'; readonly value: Uint8Array }

export interface TiffTagReadOptions extends AbortOptions {
  /** Maximum tag payload read for this call. Defaults to 1 MiB. */
  readonly maxBytes?: number
}

export interface TiffTagInfo {
  readonly tag: number
  readonly fieldType: number
  readonly count: number
  readonly byteLength: number
}

export interface TiffByteReadOptions extends AbortOptions {
  /** Maximum bytes read for this call. Required so profile readers cannot issue unbounded reads. */
  readonly maxBytes: number
}

export interface TiffDirectory {
  readonly index: number
  /** Absolute byte offset of this IFD in the TIFF source. */
  readonly offset: number
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

  /** Inspect parsed tag metadata without reading an out-of-line payload, when supported. */
  getTagInfo?(tag: number): TiffTagInfo | undefined
  getTag(tag: number, options?: Readonly<TiffTagReadOptions>): Promise<TiffTagValue | undefined>
  createImageDecoder(options?: Readonly<AbortOptions>): Promise<ImageDecoder>
  createRasterDecoder(options?: Readonly<AbortOptions>): Promise<RasterDecoder>
}

export interface TiffDocument {
  readonly littleEndian: boolean
  readonly bigTiff: boolean
  readonly directories: readonly TiffDirectory[]
  readonly topLevelDirectories: readonly TiffDirectory[]

  getDirectory(index: number): TiffDirectory | undefined
  /** Resolve any parsed top-level or SubIFD directory by its absolute source offset. */
  getDirectoryByOffset(offset: number): TiffDirectory | undefined
  /**
   * Read an exact byte range from the TIFF source. The requested range must be
   * in bounds and no larger than options.maxBytes.
   */
  readBytes(
    offset: number,
    length: number,
    options: Readonly<TiffByteReadOptions>,
  ): Promise<Uint8Array>
}

export interface TiffDocumentOptions extends ImageLimitOptions, AbortOptions {
  /**
   * Maximum physical strip or tile entries, including planar samples, in one image directory.
   * Defaults to 1,048,576.
   */
  readonly maxSegmentCount?: number
  /** Maximum peak bytes used to load and convert segment tables. Defaults to 32 MiB. */
  readonly maxSegmentTableBytes?: number
  /** Maximum encoded bytes in one strip or tile. Defaults to 128 MiB. */
  readonly maxEncodedSegmentBytes?: number
  readonly embeddedCodecs?: readonly ImageCodec[]
}

export type TiffDocumentOpener = (
  source: ImageSource,
  options?: Readonly<TiffDocumentOptions>,
) => Promise<TiffDocument>
