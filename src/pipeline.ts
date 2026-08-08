import type { ChromaSubsampling, ImageMetadata } from './codec.ts'
import { invalidInput } from './errors.ts'
import type { ImageLimits } from './limits.ts'
import { validateImageDimensions } from './limits.ts'

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
}

export type ResizeOptions = ResizeBase &
  ({ width: number; height?: number } | { height: number; width?: number })

export interface CropOptions {
  x: number
  y: number
  width: number
  height: number
}

export interface RotateOptions {
  background?: Background
}

export interface JpegEncodeOptions {
  quality?: number
  progressive?: boolean
  background?: Background
  chromaSubsampling?: Exclude<ChromaSubsampling, '400'>
}

export interface PngEncodeOptions {
  compressionLevel?: number
}

export interface WebpEncodeOptions {
  lossless?: boolean
  quality?: number
}

export interface BmpEncodeOptions {
  alpha?: boolean
}

export interface TiffEncodeOptions {
  compression?: 'none'
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
  | {
      readonly type: 'encode'
      readonly format: 'bmp'
      readonly options: Readonly<BmpEncodeOptions>
    }
  | {
      readonly type: 'encode'
      readonly format: 'jpeg'
      readonly options: Readonly<JpegEncodeOptions>
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
      readonly format: 'webp'
      readonly options: Readonly<WebpEncodeOptions>
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
  validBackground(options.background)
  return Object.freeze({ type: 'encode', format: 'jpeg', options: Object.freeze({ ...options }) })
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
  return Object.freeze({ type: 'encode', format: 'webp', options: Object.freeze({ ...options }) })
}

export const createBmpEncodeOperation = (options: BmpEncodeOptions): PipelineOperation => {
  if (options.alpha !== undefined && typeof options.alpha !== 'boolean') {
    throw invalidInput('BMP alpha must be a boolean')
  }
  return Object.freeze({ type: 'encode', format: 'bmp', options: Object.freeze({ ...options }) })
}

export const createTiffEncodeOperation = (options: TiffEncodeOptions): PipelineOperation => {
  if (options.compression !== undefined && options.compression !== 'none') {
    throw invalidInput('TIFF compression must be none')
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

    metadata =
      operation.format === 'jpeg'
        ? { ...metadata, format: 'jpeg', mimeType: 'image/jpeg', hasAlpha: false, bitDepth: 8 }
        : operation.format === 'png'
          ? { ...metadata, format: 'png', mimeType: 'image/png', bitDepth: 8 }
          : { ...metadata, format: 'webp', mimeType: 'image/webp', bitDepth: 8 }
  }

  return metadata
}
