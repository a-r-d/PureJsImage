import type { ImageLibraryRegistration } from './accelerator.ts'
import {
  createImageLibraryForPlatform,
  type Image as RuntimeImage,
  type ImageLibrary as RuntimeImageLibrary,
} from './image-core.ts'
import { browserPlatform } from './browser-platform.ts'
import type { ImageInput } from './source.ts'

export type {
  ImageAcceleratorKind,
  ImageCodecAccelerator,
  ImageLibraryConfiguration,
  ImageLibraryRegistration,
} from './accelerator.ts'
export type {
  BuiltInFormat,
  ChromaSubsampling,
  ColorProfile,
  DecodeRequest,
  DecoderCapabilities,
  DecoderOptions,
  EncodeRequest,
  ImageCodec,
  ImageDecoder,
  ImageEncoder,
  ImageMetadata,
  MetadataPreservationOptions,
  PreservedMetadata,
} from './codec.ts'
export { CodecRegistry } from './codec.ts'
export type { ImageErrorCode } from './errors.ts'
export { ImageError } from './errors.ts'
export type { ImageOpenOptions } from './image-core.ts'
export type Image = RuntimeImage<ImageInput, Uint8Array>
export type ImageLibrary = RuntimeImageLibrary<ImageInput, Uint8Array>
export type { ImageLimitOptions, ImageLimits } from './limits.ts'
export { defaultImageLimits } from './limits.ts'
export type {
  Background,
  BmpEncodeOptions,
  CropOptions,
  JpegEncodeOptions,
  PngEncodeOptions,
  ResizeFit,
  ResizeKernel,
  ResizeOptions,
  ResizePosition,
  RotateOptions,
  TiffEncodeOptions,
  WebpEncodeOptions,
} from './pipeline.ts'
export type { PixelBlock, PixelFormat, PixelSampleDisplayRange } from './pixel.ts'
export { BufferPool } from './pixel.ts'
export { aperioSvsProfile, isAperioSvs, openAperioSvs } from './pathology/aperio-svs.ts'
export type {
  WholeSlideAssociatedImage,
  WholeSlideAssociatedImageRequest,
  WholeSlideImage,
  WholeSlideLevel,
  WholeSlideRegionRequest,
} from './pathology/whole-slide.ts'
export type {
  RasterBlock,
  RasterDecoder,
  RasterDecodeRequest,
  RasterDisplayOptions,
  RasterDisplayRange,
  RasterFormat,
  RasterSampleType,
} from './raster.ts'
export { rasterSampleBytes, rasterToPixels } from './raster.ts'
export type {
  MultidimensionalRasterDataset,
  PhysicalPixelSize,
  RasterChannelInfo,
  RasterPlaneRequest,
} from './scientific/dataset.ts'
export { isOmeTiff, omeTiffProfile, openOmeTiff } from './scientific/ome-tiff.ts'
export { geoTiffProfile } from './geotiff.ts'
export type {
  GeoTiffBoundingBox,
  GeoTiffGdalMetadataItem,
  GeoTiffKey,
  GeoTiffModel,
  GeoTiffPoint,
  GeoTiffProfile,
  GeoTiffRasterType,
} from './geotiff.ts'
export type { ImageSink } from './sink.ts'
export { Uint8ArraySink } from './sink.ts'
export type { ImageInput, ImageSource } from './source.ts'
export {
  BlobSource,
  HttpRangeSource,
  MemorySource,
} from './source.ts'
export type { HttpRangeSourceOptions, HttpRangeSourceStats } from './source.ts'

export const createImageLibrary = (registration: ImageLibraryRegistration): ImageLibrary =>
  createImageLibraryForPlatform(registration, browserPlatform)
