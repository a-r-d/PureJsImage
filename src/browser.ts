export type { AbortOptions } from './abort.ts'
export type {
  PixelAlphaSemantics,
  PixelColorFamily,
  PixelColorPrimaries,
  PixelColorProvenance,
  PixelColorSemantics,
  PixelIccSemantics,
  PixelMatrixCoefficients,
  PixelRange,
  PixelTransferFunction,
} from './color.ts'

import type { ImageLibraryRegistration } from './accelerator.ts'
import { browserPlatform } from './browser-platform.ts'
import {
  createImageLibraryForPlatform,
  type Image as RuntimeImage,
  type ImageLibrary as RuntimeImageLibrary,
} from './image-core.ts'
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
export type { ImageExecutionOptions, ImageOpenOptions } from './image-core.ts'
export type Image = RuntimeImage<ImageInput, Uint8Array>
export type ImageLibrary = RuntimeImageLibrary<ImageInput, Uint8Array>
export type { ImageLimitOptions, ImageLimits } from './limits.ts'
export { defaultImageLimits } from './limits.ts'
export type {
  AlphaRemoval,
  AvifEncodeOptions,
  Background,
  BmpEncodeOptions,
  ConvertiblePixelFormat,
  ConvertPixelFormatOptions,
  CropOptions,
  HdrEncodeOptions,
  JpegEncodeOptions,
  JpegXlEncodeOptions,
  LutOptions,
  LutPixelFormat,
  NetpbmEncodeOptions,
  PamEncodeOptions,
  PbmEncodeOptions,
  PfmEncodeOptions,
  PgmEncodeOptions,
  PixelConversionRange,
  PngEncodeOptions,
  PpmEncodeOptions,
  QoiEncodeOptions,
  ResizeFit,
  ResizeKernel,
  ResizeOptions,
  ResizePosition,
  RotateOptions,
  TgaEncodeOptions,
  TiffEncodeOptions,
  WebpEncodeOptions,
  WindowOptions,
} from './pipeline.ts'
export type {
  PixelBlock,
  PixelFormat,
  PixelSampleDisplayRange,
  PixelStorageDescriptor,
} from './pixel.ts'
export { BufferPool, pixelBytesPerPixel, pixelStorage } from './pixel.ts'
export type { ImageSink } from './sink.ts'
export { Uint8ArraySink } from './sink.ts'
export type { ImageInput, ImageSource, ImageSourceReadOptions } from './source.ts'
export { BlobSource, MemorySource } from './source.ts'

export const createImageLibrary = (registration: ImageLibraryRegistration): ImageLibrary =>
  createImageLibraryForPlatform(registration, browserPlatform)
