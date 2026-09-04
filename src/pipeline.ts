import type { ImageMetadata } from './codec.ts'
import type { ConvertPixelFormatOptions } from './convert.ts'
import { validateConvertPixelFormatOptions } from './convert.ts'
import { invalidInput } from './errors.ts'
import type { ImageLimits } from './limits.ts'
import { validateImageDimensions } from './limits.ts'
import type { LutOptions, LutPixelFormat } from './lut.ts'

export type ResizeFit = 'contain' | 'cover' | 'fill' | 'inside' | 'outside'
export type ResizePosition = 'center'
export type ResizeKernel = 'nearest' | 'bilinear' | 'lanczos3'
export type Background = 'transparent' | `#${string}`

interface ResizeBase {
  fit?: ResizeFit
  position?: ResizePosition
  background?: Background
  withoutEnlargement?: boolean
  kernel?: ResizeKernel
  /** Opt-in transfer-aware resampling. The default keeps historical encoded-sample behavior. */
  colorSpace?: 'encoded' | 'linear-light'
}

export type ResizeOptions = ResizeBase &
  ({ width: number; height?: number } | { height: number; width?: number })

export interface CropOptions {
  x: number
  y: number
  width: number
  height: number
}
export interface WindowOptions {
  readonly center: number
  readonly width: number
}

export type {
  AlphaRemoval,
  ConvertiblePixelFormat,
  ConvertPixelFormatOptions,
  PixelConversionRange,
} from './convert.ts'
export type { LutOptions, LutPixelFormat } from './lut.ts'

export interface RotateOptions {
  background?: Background
}

export interface AvifEncodeOptions {
  background?: Background
}

export interface JpegEncodeOptions {
  quality?: number
  progressive?: boolean
  background?: Background
  chromaSubsampling?: '420' | '422' | '444'
  restartInterval?: number
}

export interface JpegXlEncodeOptions {
  mode?: 'lossless'
  effort?: 1 | 3 | 5 | 7
  container?: boolean
  /** Intended native color sample depth. Required for 9 through 15-bit data in 16-bit blocks. */
  sampleBitDepth?: 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16
  /** Intended alpha depth when it differs from the color sample depth. */
  alphaBitDepth?: 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16
  /** EXIF-compatible display orientation stored in the JPEG XL image header. */
  orientation?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
  /** Source intrinsic dimensions, independent of stored pixel dimensions. */
  intrinsicSize?: Readonly<{ width: number; height: number }>
  /** Luminance metadata; numeric fields are encoded with finite half precision. */
  toneMapping?: Readonly<{
    intensityTarget: number
    minNits: number
    relativeToMaxDisplay: boolean
    linearBelow: number
  }>
}

export interface PngEncodeOptions {
  compressionLevel?: number
}

export interface WebpEncodeOptions {
  /** Lossless VP8L output. Required when nearLossless is set. */
  lossless?: boolean
  /** Encoder search effort from 0 (fastest) through 6 (smallest). */
  effort?: number
  /** VP8L near-lossless preprocessing quality from 0 (strongest) through 100 (off). */
  nearLossless?: number
  quality?: number
}

export interface BmpEncodeOptions {
  alpha?: boolean
}

export interface HdrEncodeOptions {
  exposure?: number
  gamma?: number
}

export interface QoiEncodeOptions {
  channels?: 3 | 4
  colorspace?: 'srgb' | 'linear'
}

export interface NetpbmEncodeOptions {
  format?: 'pbm' | 'pgm' | 'ppm' | 'pam' | 'pfm'
  ascii?: boolean
  bitDepth?: 8 | 16
  endian?: 'little' | 'big'
  scale?: number
}

export interface PbmEncodeOptions {
  ascii?: boolean
}

export interface PgmEncodeOptions {
  ascii?: boolean
  bitDepth?: 8 | 16
}

export interface PpmEncodeOptions {
  ascii?: boolean
  bitDepth?: 8 | 16
}

export interface PamEncodeOptions {
  bitDepth?: 8 | 16
}

export interface PfmEncodeOptions {
  endian?: 'little' | 'big'
  scale?: number
}

export interface TgaEncodeOptions {
  alpha?: boolean
  rle?: boolean
}

export interface TiffEncodeOptions {
  compression?: 'deflate'
  predictor?: 'horizontal'
  layout?: 'strips' | 'tiles'
  compressionLevel?: number
  rowsPerStrip?: number
  tileWidth?: number
  tileHeight?: number
  format?: 'classic' | 'bigtiff' | 'auto'
}

export type PipelineOperation =
  | { readonly type: 'autoOrient' }
  | { readonly type: 'keepExif' }
  | { readonly type: 'keepIcc' }
  | { readonly type: 'flip' }
  | { readonly type: 'flop' }
  | { readonly type: 'rotate'; readonly degrees: number; readonly options: Readonly<RotateOptions> }
  | ({ readonly type: 'crop' } & Readonly<CropOptions>)
  | ({ readonly type: 'resize' } & Readonly<ResizeOptions>)
  | { readonly type: 'window'; readonly options: Readonly<WindowOptions> }
  | { readonly type: 'convertPixelFormat'; readonly options: Readonly<ConvertPixelFormatOptions> }
  | { readonly type: 'lut'; readonly options: Readonly<LutOptions> }
  | {
      readonly type: 'encode'
      readonly format: 'avif'
      readonly options: Readonly<AvifEncodeOptions>
    }
  | {
      readonly type: 'encode'
      readonly format: 'bmp'
      readonly options: Readonly<BmpEncodeOptions>
    }
  | {
      readonly type: 'encode'
      readonly format: 'hdr'
      readonly options: Readonly<HdrEncodeOptions>
    }
  | {
      readonly type: 'encode'
      readonly format: 'jpeg'
      readonly options: Readonly<JpegEncodeOptions>
    }
  | {
      readonly type: 'encode'
      readonly format: 'jpegxl'
      readonly options: Readonly<JpegXlEncodeOptions>
    }
  | {
      readonly type: 'encode'
      readonly format: 'png'
      readonly options: Readonly<PngEncodeOptions>
    }
  | {
      readonly type: 'encode'
      readonly format: 'tiff'
      readonly options: Readonly<TiffEncodeOptions>
    }
  | {
      readonly type: 'encode'
      readonly format: 'netpbm'
      readonly options: Readonly<NetpbmEncodeOptions>
    }
  | {
      readonly type: 'encode'
      readonly format: 'qoi'
      readonly options: Readonly<QoiEncodeOptions>
    }
  | {
      readonly type: 'encode'
      readonly format: 'webp'
      readonly options: Readonly<WebpEncodeOptions>
    }
  | {
      readonly type: 'encode'
      readonly format: 'tga'
      readonly options: Readonly<TgaEncodeOptions>
    }

const positiveDimension = (name: string, value: number | undefined): void => {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) {
    throw invalidInput(`${name} must be a positive safe integer`)
  }
}

const validBackground = (background: Background | undefined): void => {
  if (background === undefined || background === 'transparent') return
  if (!/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(background)) {
    throw invalidInput('Background must be transparent, #RRGGBB, or #RRGGBBAA')
  }
}

export const createCropOperation = (options: CropOptions): PipelineOperation => {
  for (const [name, value] of Object.entries(options)) {
    if (!Number.isSafeInteger(value) || (name === 'x' || name === 'y' ? value < 0 : value < 1)) {
      throw invalidInput(`Crop ${name} is invalid`)
    }
  }
  return Object.freeze({ type: 'crop', ...options })
}

export const createRotateOperation = (
  degrees: number,
  options: RotateOptions = {},
): PipelineOperation => {
  if (!Number.isFinite(degrees)) throw invalidInput('Rotate degrees must be a finite number')
  validBackground(options.background)
  return Object.freeze({
    type: 'rotate',
    degrees,
    options: Object.freeze({ ...options }),
  })
}

export const normalizedRotation = (degrees: number): number => ((degrees % 360) + 360) % 360
export const createWindowOperation = (options: WindowOptions): PipelineOperation => {
  if (!Number.isFinite(options.center)) throw invalidInput('Window center must be finite')
  if (!Number.isFinite(options.width) || options.width <= 0) {
    throw invalidInput('Window width must be finite and greater than zero')
  }
  return Object.freeze({ type: 'window', options: Object.freeze({ ...options }) })
}
export const createConvertPixelFormatOperation = (
  options: ConvertPixelFormatOptions,
): PipelineOperation => {
  validateConvertPixelFormatOptions(options)
  return Object.freeze({
    type: 'convertPixelFormat',
    options: Object.freeze({
      ...options,
      ...(options.range === undefined ? {} : { range: Object.freeze({ ...options.range }) }),
      ...(options.alphaRemoval === undefined
        ? {}
        : { alphaRemoval: Object.freeze({ ...options.alphaRemoval }) }),
    }),
  })
}

export const createLutOperation = (options: LutOptions): PipelineOperation => {
  const channels: Readonly<Record<LutPixelFormat, number>> = {
    gray8: 1,
    rgb8: 3,
    rgba8: 4,
  }
  if (!(options.table instanceof Uint8Array)) {
    throw invalidInput('LUT table must be a Uint8Array')
  }
  const expectedBytes = 256 * channels[options.format]
  if (!Number.isSafeInteger(expectedBytes) || options.table.byteLength !== expectedBytes) {
    throw invalidInput(`LUT ${String(options.format)} table must contain ${expectedBytes} bytes`)
  }
  return Object.freeze({
    type: 'lut',
    options: Object.freeze({ format: options.format, table: options.table.slice() }),
  })
}

export const rotationDimensions = (
  width: number,
  height: number,
  degrees: number,
): { readonly width: number; readonly height: number } => {
  const normalized = normalizedRotation(degrees)
  if (normalized === 0 || normalized === 180) return { width, height }
  if (normalized === 90 || normalized === 270) return { width: height, height: width }
  const radians = (normalized * Math.PI) / 180
  return {
    width: Math.max(
      1,
      Math.ceil(Math.abs(width * Math.cos(radians)) + Math.abs(height * Math.sin(radians))),
    ),
    height: Math.max(
      1,
      Math.ceil(Math.abs(width * Math.sin(radians)) + Math.abs(height * Math.cos(radians))),
    ),
  }
}

export const createResizeOperation = (options: ResizeOptions): PipelineOperation => {
  positiveDimension('Resize width', options.width)
  positiveDimension('Resize height', options.height)
  if (
    options.kernel !== undefined &&
    options.kernel !== 'nearest' &&
    options.kernel !== 'bilinear' &&
    options.kernel !== 'lanczos3'
  ) {
    throw invalidInput('Resize kernel must be nearest, bilinear, or lanczos3')
  }
  if (
    options.colorSpace !== undefined &&
    options.colorSpace !== 'encoded' &&
    options.colorSpace !== 'linear-light'
  ) {
    throw invalidInput('Resize colorSpace must be encoded or linear-light')
  }
  if (options.width === undefined && options.height === undefined) {
    throw invalidInput('Resize requires a width or height')
  }
  if (
    (options.fit || options.position || options.background) &&
    (!options.width || !options.height)
  ) {
    throw invalidInput('Resize fit, position, and background require both width and height')
  }
  if ((options.position || options.background) && options.fit !== 'contain') {
    throw invalidInput('Resize position and background are only valid with fit: contain')
  }
  validBackground(options.background)
  return Object.freeze({ type: 'resize', ...options })
}

export const createAvifEncodeOperation = (options: AvifEncodeOptions): PipelineOperation => {
  validBackground(options.background)
  return Object.freeze({ type: 'encode', format: 'avif', options: Object.freeze({ ...options }) })
}

export const createJpegEncodeOperation = (options: JpegEncodeOptions): PipelineOperation => {
  if (
    options.quality !== undefined &&
    (!Number.isInteger(options.quality) || options.quality < 1 || options.quality > 100)
  ) {
    throw invalidInput('JPEG quality must be an integer from 1 to 100')
  }
  if (
    options.chromaSubsampling !== undefined &&
    options.chromaSubsampling !== '420' &&
    options.chromaSubsampling !== '422' &&
    options.chromaSubsampling !== '444'
  ) {
    throw invalidInput('JPEG chromaSubsampling must be 420, 422, or 444')
  }
  if (
    options.restartInterval !== undefined &&
    (!Number.isInteger(options.restartInterval) ||
      options.restartInterval < 0 ||
      options.restartInterval > 65_535)
  ) {
    throw invalidInput('JPEG restartInterval must be an integer from 0 to 65535')
  }
  validBackground(options.background)
  return Object.freeze({ type: 'encode', format: 'jpeg', options: Object.freeze({ ...options }) })
}

export const createJpegXlEncodeOperation = (options: JpegXlEncodeOptions): PipelineOperation => {
  if (options.mode !== undefined && options.mode !== 'lossless') {
    throw invalidInput('JPEG XL mode must be lossless')
  }
  if (
    options.effort !== undefined &&
    options.effort !== 1 &&
    options.effort !== 3 &&
    options.effort !== 5 &&
    options.effort !== 7
  ) {
    throw invalidInput('JPEG XL effort must be 1, 3, 5, or 7')
  }
  if (options.container !== undefined && typeof options.container !== 'boolean') {
    throw invalidInput('JPEG XL container must be a boolean')
  }
  for (const [name, depth] of [
    ['sampleBitDepth', options.sampleBitDepth],
    ['alphaBitDepth', options.alphaBitDepth],
  ] as const) {
    if (depth !== undefined && (!Number.isInteger(depth) || depth < 8 || depth > 16)) {
      throw invalidInput(`JPEG XL ${name} must be an integer from 8 to 16`)
    }
  }
  return Object.freeze({ type: 'encode', format: 'jpegxl', options: Object.freeze({ ...options }) })
}

export const createPngEncodeOperation = (options: PngEncodeOptions): PipelineOperation => {
  if (
    options.compressionLevel !== undefined &&
    (!Number.isInteger(options.compressionLevel) ||
      options.compressionLevel < 0 ||
      options.compressionLevel > 9)
  ) {
    throw invalidInput('PNG compressionLevel must be an integer from 0 to 9')
  }
  return Object.freeze({ type: 'encode', format: 'png', options: Object.freeze({ ...options }) })
}

export const createWebpEncodeOperation = (options: WebpEncodeOptions): PipelineOperation => {
  if (
    options.quality !== undefined &&
    (!Number.isInteger(options.quality) || options.quality < 1 || options.quality > 100)
  ) {
    throw invalidInput('WebP quality must be an integer from 1 to 100')
  }
  if (options.lossless !== undefined && typeof options.lossless !== 'boolean') {
    throw invalidInput('WebP lossless must be a boolean')
  }
  if (
    options.effort !== undefined &&
    (!Number.isInteger(options.effort) || options.effort < 0 || options.effort > 6)
  ) {
    throw invalidInput('WebP effort must be an integer from 0 to 6')
  }
  if (
    options.nearLossless !== undefined &&
    (!Number.isInteger(options.nearLossless) ||
      options.nearLossless < 0 ||
      options.nearLossless > 100)
  ) {
    throw invalidInput('WebP nearLossless must be an integer from 0 to 100')
  }
  if (options.nearLossless !== undefined && options.lossless !== true) {
    throw invalidInput('WebP nearLossless requires lossless: true')
  }
  return Object.freeze({ type: 'encode', format: 'webp', options: Object.freeze({ ...options }) })
}

export const createBmpEncodeOperation = (options: BmpEncodeOptions): PipelineOperation => {
  if (options.alpha !== undefined && typeof options.alpha !== 'boolean') {
    throw invalidInput('BMP alpha must be a boolean')
  }
  return Object.freeze({ type: 'encode', format: 'bmp', options: Object.freeze({ ...options }) })
}

export const createHdrEncodeOperation = (options: HdrEncodeOptions): PipelineOperation => {
  for (const [label, value] of [
    ['exposure', options.exposure],
    ['gamma', options.gamma],
  ] as const) {
    if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
      throw invalidInput(`Radiance HDR ${label} must be finite and greater than zero`)
    }
  }
  return Object.freeze({ type: 'encode', format: 'hdr', options: Object.freeze({ ...options }) })
}

export const createQoiEncodeOperation = (options: QoiEncodeOptions): PipelineOperation => {
  if (options.channels !== undefined && options.channels !== 3 && options.channels !== 4) {
    throw invalidInput('QOI channels must be 3 or 4')
  }
  if (
    options.colorspace !== undefined &&
    options.colorspace !== 'srgb' &&
    options.colorspace !== 'linear'
  ) {
    throw invalidInput('QOI colorspace must be srgb or linear')
  }
  return Object.freeze({ type: 'encode', format: 'qoi', options: Object.freeze({ ...options }) })
}

export const createNetpbmEncodeOperation = (options: NetpbmEncodeOptions): PipelineOperation => {
  if (
    options.format !== undefined &&
    options.format !== 'pbm' &&
    options.format !== 'pgm' &&
    options.format !== 'ppm' &&
    options.format !== 'pam' &&
    options.format !== 'pfm'
  ) {
    throw invalidInput('Netpbm format must be pbm, pgm, ppm, pam, or pfm')
  }
  if (options.ascii !== undefined && typeof options.ascii !== 'boolean') {
    throw invalidInput('Netpbm ascii must be a boolean')
  }
  if (options.bitDepth !== undefined && options.bitDepth !== 8 && options.bitDepth !== 16) {
    throw invalidInput('Netpbm bitDepth must be 8 or 16')
  }
  if (options.endian !== undefined && options.endian !== 'little' && options.endian !== 'big') {
    throw invalidInput('PFM endian must be little or big')
  }
  if (options.scale !== undefined && (!Number.isFinite(options.scale) || options.scale <= 0)) {
    throw invalidInput('PFM scale must be finite and greater than zero')
  }
  if (options.format === 'pam' && options.ascii === true) {
    throw invalidInput('PAM does not have an ASCII encoding')
  }
  if (options.format === 'pfm' && (options.ascii !== undefined || options.bitDepth !== undefined)) {
    throw invalidInput('PFM does not use ascii or bitDepth options')
  }
  return Object.freeze({
    type: 'encode',
    format: 'netpbm',
    options: Object.freeze({ ...options }),
  })
}

export const createTgaEncodeOperation = (options: TgaEncodeOptions): PipelineOperation => {
  if (options.alpha !== undefined && typeof options.alpha !== 'boolean') {
    throw invalidInput('TGA alpha must be a boolean')
  }
  if (options.rle !== undefined && typeof options.rle !== 'boolean') {
    throw invalidInput('TGA rle must be a boolean')
  }
  return Object.freeze({ type: 'encode', format: 'tga', options: Object.freeze({ ...options }) })
}

export const createTiffEncodeOperation = (options: TiffEncodeOptions): PipelineOperation => {
  if (options.compression !== undefined && options.compression !== 'deflate') {
    throw invalidInput('TIFF compression must be deflate')
  }
  if (options.predictor !== undefined && options.predictor !== 'horizontal') {
    throw invalidInput('TIFF predictor must be horizontal')
  }
  if (options.layout !== undefined && options.layout !== 'strips' && options.layout !== 'tiles') {
    throw invalidInput('TIFF layout must be strips or tiles')
  }
  if (
    options.format !== undefined &&
    options.format !== 'classic' &&
    options.format !== 'bigtiff' &&
    options.format !== 'auto'
  ) {
    throw invalidInput('TIFF format must be classic, bigtiff, or auto')
  }
  for (const [label, value] of [
    ['rowsPerStrip', options.rowsPerStrip],
    ['tileWidth', options.tileWidth],
    ['tileHeight', options.tileHeight],
  ] as const) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) {
      throw invalidInput(`TIFF ${label} must be a positive safe integer`)
    }
  }
  if (options.layout === 'tiles' && options.rowsPerStrip !== undefined) {
    throw invalidInput('TIFF rowsPerStrip requires layout: strips')
  }
  if (
    options.layout === 'tiles' &&
    ((options.tileWidth !== undefined && options.tileWidth % 16 !== 0) ||
      (options.tileHeight !== undefined && options.tileHeight % 16 !== 0))
  ) {
    throw invalidInput('TIFF tile dimensions must be multiples of 16')
  }
  if (
    options.compressionLevel !== undefined &&
    (!Number.isInteger(options.compressionLevel) ||
      options.compressionLevel < 0 ||
      options.compressionLevel > 9)
  ) {
    throw invalidInput('TIFF compressionLevel must be an integer from 0 to 9')
  }
  return Object.freeze({ type: 'encode', format: 'tiff', options: Object.freeze({ ...options }) })
}

export const calculateResizeDimensions = (
  width: number,
  height: number,
  options: ResizeOptions,
): { width: number; height: number } => {
  if (options.width !== undefined && options.height === undefined) {
    const scale = options.width / width
    if (options.withoutEnlargement && scale > 1) return { width, height }
    return { width: options.width, height: Math.max(1, Math.round(height * scale)) }
  }
  if (options.height !== undefined && options.width === undefined) {
    const scale = options.height / height
    if (options.withoutEnlargement && scale > 1) return { width, height }
    return { width: Math.max(1, Math.round(width * scale)), height: options.height }
  }

  const targetWidth = options.width
  const targetHeight = options.height
  if (targetWidth === undefined || targetHeight === undefined) {
    throw invalidInput('Resize requires a width or height')
  }
  const fit = options.fit ?? 'cover'
  if (fit === 'contain' || fit === 'cover' || fit === 'fill') {
    return { width: targetWidth, height: targetHeight }
  }

  const scale =
    fit === 'inside'
      ? Math.min(targetWidth / width, targetHeight / height)
      : Math.max(targetWidth / width, targetHeight / height)
  const boundedScale = options.withoutEnlargement ? Math.min(1, scale) : scale
  return {
    width: Math.max(1, Math.round(width * boundedScale)),
    height: Math.max(1, Math.round(height * boundedScale)),
  }
}

export const planMetadata = (
  source: ImageMetadata,
  operations: readonly PipelineOperation[],
  limits: ImageLimits,
): ImageMetadata => {
  let metadata = { ...source }

  for (const operation of operations) {
    if (operation.type === 'keepExif' || operation.type === 'keepIcc') continue
    if (operation.type === 'window') {
      metadata = {
        ...metadata,
        bitDepth: 8,
        sampleFormat: 'unsigned-integer',
      }
      continue
    }
    if (operation.type === 'convertPixelFormat') {
      const format = operation.options.format
      metadata = {
        ...metadata,
        bitDepth: format.endsWith('16') ? 16 : format.endsWith('f32') ? 32 : 8,
        sampleFormat: format.endsWith('f32') ? 'floating-point' : 'unsigned-integer',
        channels: format.startsWith('gray') ? 1 : format.startsWith('rgba') ? 4 : 3,
        hasAlpha: format.startsWith('rgba'),
        colorSpace: format.startsWith('gray') ? 'gray' : 'rgb',
      }
      continue
    }
    if (operation.type === 'lut') {
      metadata = {
        ...metadata,
        bitDepth: 8,
        sampleFormat: 'unsigned-integer',
        channels:
          operation.options.format === 'gray8' ? 1 : operation.options.format === 'rgb8' ? 3 : 4,
        hasAlpha: operation.options.format === 'rgba8',
        colorSpace: operation.options.format === 'gray8' ? 'gray' : 'sRGB',
      }
      continue
    }
    if (operation.type === 'autoOrient') {
      if (
        metadata.orientation !== undefined &&
        metadata.orientation >= 5 &&
        metadata.orientation <= 8
      ) {
        metadata = { ...metadata, width: metadata.height, height: metadata.width, orientation: 1 }
      } else if (metadata.orientation !== undefined) {
        metadata = { ...metadata, orientation: 1 }
      }
      continue
    }

    if (operation.type === 'flip' || operation.type === 'flop') {
      if (metadata.orientation !== undefined) metadata = { ...metadata, orientation: 1 }
      continue
    }

    if (operation.type === 'rotate') {
      const dimensions = rotationDimensions(metadata.width, metadata.height, operation.degrees)
      const transparentCanvas =
        normalizedRotation(operation.degrees) % 90 !== 0 &&
        (operation.options.background === undefined ||
          operation.options.background === 'transparent' ||
          (operation.options.background.length === 9 &&
            operation.options.background.slice(7, 9).toLowerCase() !== 'ff'))
      metadata = {
        ...metadata,
        ...dimensions,
        hasAlpha: metadata.hasAlpha || transparentCanvas,
        ...(metadata.orientation === undefined ? {} : { orientation: 1 }),
      }
      validateImageDimensions(metadata.width, metadata.height, metadata.frames ?? 1, limits)
      continue
    }

    if (operation.type === 'crop') {
      if (
        operation.x + operation.width > metadata.width ||
        operation.y + operation.height > metadata.height
      ) {
        throw invalidInput(
          `Crop ${operation.x},${operation.y} ${operation.width}x${operation.height} exceeds ${metadata.width}x${metadata.height}`,
        )
      }
      metadata = { ...metadata, width: operation.width, height: operation.height }
      continue
    }

    if (operation.type === 'resize') {
      const transparentCanvas =
        operation.fit === 'contain' &&
        (operation.background === undefined ||
          operation.background === 'transparent' ||
          (operation.background.length === 9 &&
            operation.background.slice(7, 9).toLowerCase() !== 'ff'))
      metadata = {
        ...metadata,
        ...calculateResizeDimensions(metadata.width, metadata.height, operation),
        hasAlpha: metadata.hasAlpha || transparentCanvas,
      }
      validateImageDimensions(metadata.width, metadata.height, metadata.frames ?? 1, limits)
      continue
    }

    if (operation.format === 'bmp') {
      const hasAlpha = operation.options.alpha ?? metadata.hasAlpha
      metadata = {
        ...metadata,
        format: 'bmp',
        mimeType: 'image/bmp',
        hasAlpha,
        bitDepth: hasAlpha ? 32 : 24,
      }
      continue
    }

    if (operation.format === 'tiff') {
      metadata = {
        ...metadata,
        format: 'tiff',
        mimeType: 'image/tiff',
        bitDepth: 8,
      }
      continue
    }

    if (operation.format === 'avif') {
      metadata = {
        ...metadata,
        format: 'avif',
        mimeType: 'image/avif',
        hasAlpha: false,
        bitDepth: 8,
        chromaSubsampling: '420',
        codecProfile: 0,
      }
      continue
    }

    if (operation.format === 'jpegxl') {
      metadata = {
        ...metadata,
        format: 'jpegxl',
        mimeType: 'image/jxl',
        bitDepth: (metadata.bitDepth ?? 8) > 8 ? 16 : 8,
        lossless: true,
      }
      continue
    }

    metadata =
      operation.format === 'jpeg'
        ? { ...metadata, format: 'jpeg', mimeType: 'image/jpeg', hasAlpha: false, bitDepth: 8 }
        : operation.format === 'png'
          ? {
              ...metadata,
              format: 'png',
              mimeType: 'image/png',
              bitDepth: (metadata.bitDepth ?? 8) > 8 ? 16 : 8,
            }
          : { ...metadata, format: 'webp', mimeType: 'image/webp', bitDepth: 8 }
  }

  return metadata
}
