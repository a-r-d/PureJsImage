import { throwIfAborted } from '../abort.ts'
import type { ImageDecoder } from '../codec.ts'
import { jpegCodec } from '../codecs/jpeg.ts'
import { cropPixelBlocks } from '../crop.ts'
import { invalidInput, limitExceeded, unsupportedOperation } from '../errors.ts'
import type { CropOptions, ResizeKernel } from '../pipeline.ts'
import type { PixelBlock } from '../pixel.ts'
import { createResizeTransform } from '../resize.ts'
import { Uint8ArraySink } from '../sink.ts'
import { assembleGainMapJpeg, type AssembleGainMapJpegOptions } from './jpeg-output.ts'
import {
  planGainMapCrop,
  planGainMapOrientation,
  planGainMapQuarterTurn,
  planGainMapResize,
  type GainMapQuarterTurn,
} from './geometry.ts'
import type { GainMapDimensions, GainMapMetadata } from './model.ts'
import { normalizeGainMapMetadata } from './model.ts'
import { composeGainMapLinearF32, decodeBaseRgb8ToLinearF32 } from './math.ts'
import type { GainMapRenderedBlock } from './open.ts'

export type GainMapTransformOperation =
  | { readonly type: 'auto-orient' }
  | ({ readonly type: 'crop' } & Readonly<CropOptions>)
  | { readonly type: 'flip-horizontal' }
  | { readonly type: 'flip-vertical' }
  | { readonly type: 'rotate'; readonly degrees: GainMapQuarterTurn }
  | {
      readonly type: 'resize'
      readonly width: number
      readonly height: number
      readonly kernel: ResizeKernel
      readonly gainMapDimensions?: GainMapDimensions
    }

export interface GainMapJpegEncodeOptions extends AssembleGainMapJpegOptions {
  readonly baseQuality?: number
  readonly gainMapQuality?: number
  readonly baseChromaSubsampling?: '420' | '422' | '444'
  readonly maxMaterializedBytes?: number
}

export interface GainMapTransformedRasters {
  readonly base: GainMapRaster8
  readonly gainMap: GainMapRaster8
  readonly metadata: GainMapMetadata
}

export const planTransformedGainMapMetadata = (
  metadata: GainMapMetadata,
  operations: readonly GainMapTransformOperation[],
): GainMapMetadata => {
  let state = {
    base: metadata.baseDimensions,
    gainMap: metadata.gainMapDimensions,
  }
  let orientation = metadata.orientation
  for (const operation of operations) {
    if (operation.type === 'auto-orient') {
      state = planGainMapOrientation(state, orientation)
      orientation = 1
    } else if (operation.type === 'crop') {
      const plan = planGainMapCrop(state, operation)
      state = { base: plan.base, gainMap: plan.gainMap }
    } else if (operation.type === 'rotate') {
      state = planGainMapQuarterTurn(state, operation.degrees)
      orientation = 1
    } else if (operation.type === 'resize') {
      const plan = planGainMapResize(
        state,
        { width: operation.width, height: operation.height },
        {
          kernel: operation.kernel,
          ...(operation.gainMapDimensions
            ? { gainMapDimensions: operation.gainMapDimensions }
            : {}),
        },
      )
      state = { base: plan.base, gainMap: plan.gainMap }
    }
  }
  return normalizeGainMapMetadata({
    ...metadata,
    baseDimensions: state.base,
    gainMapDimensions: state.gainMap,
    baseRange: undefined,
    gainMapRange: undefined,
    metadataRanges: [],
    orientation,
  })
}

export interface GainMapRaster8 {
  readonly width: number
  readonly height: number
  readonly channels: 1 | 3 | 4
  readonly data: Uint8Array
}

export const renderTransformedGainMapRasters = async function* (
  rasters: GainMapTransformedRasters,
  displayBoost: number,
  maxMaterializedBytes = 256 * 1024 * 1024,
): AsyncGenerator<GainMapRenderedBlock> {
  const gainMap = await resizeRaster(
    rasters.gainMap,
    { width: rasters.base.width, height: rasters.base.height },
    'bilinear',
    maxMaterializedBytes,
  )
  const baseChannels = rasters.base.channels === 4 ? 4 : 3
  const baseLinear = decodeBaseRgb8ToLinearF32(rasters.base.data, rasters.metadata, baseChannels)
  const output = composeGainMapLinearF32(
    baseLinear,
    gainMap.data,
    rasters.metadata,
    { displayBoost },
    baseChannels,
  )
  const rowsPerBlock = 32
  for (let y = 0; y < rasters.base.height; y += rowsPerBlock) {
    const height = Math.min(rowsPerBlock, rasters.base.height - y)
    const start = y * rasters.base.width * baseChannels
    const end = start + height * rasters.base.width * baseChannels
    yield Object.freeze({
      x: 0,
      y,
      width: rasters.base.width,
      height,
      stride: rasters.base.width * baseChannels,
      pixelFormat: baseChannels === 4 ? 'rgbaf32' : 'rgbf32',
      colorSemantics:
        baseChannels === 4
          ? Object.freeze({
              ...rasters.metadata.alternateColor,
              alpha: rasters.metadata.baseColor.alpha,
            })
          : rasters.metadata.alternateColor,
      data: output.subarray(start, end),
    })
  }
}

const checkedBytes = (
  width: number,
  height: number,
  channels: number,
  maxBytes: number,
): number => {
  const result = BigInt(width) * BigInt(height) * BigInt(channels)
  if (result > BigInt(maxBytes) || result > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw limitExceeded('Transformed HDR pixels exceed maxMaterializedBytes')
  }
  return Number(result)
}

const validateQuality = (value: number | undefined, fallback: number, label: string): number => {
  const result = value ?? fallback
  if (!Number.isInteger(result) || result < 1 || result > 100) {
    throw invalidInput(`${label} must be an integer from 1 through 100`)
  }
  return result
}

const decodeRaster = async (
  decoder: ImageDecoder,
  channels: 1 | 3 | 4,
  maxBytes: number,
  signal: AbortSignal | undefined,
): Promise<GainMapRaster8> => {
  const bytes = checkedBytes(decoder.width, decoder.height, channels, maxBytes)
  const data = new Uint8Array(bytes)
  let expectedY = 0
  for await (const block of decoder.decode(signal === undefined ? {} : { signal })) {
    try {
      throwIfAborted(signal)
      if (
        block.x !== 0 ||
        block.y !== expectedY ||
        block.width !== decoder.width ||
        (block.format !== 'rgb8' && block.format !== 'rgba8')
      ) {
        throw invalidInput('HDR transform requires ordered RGB8 decoder blocks')
      }
      const inputChannels = block.format === 'rgb8' ? 3 : 4
      if (block.stride < decoder.width * inputChannels) {
        throw invalidInput('HDR transform decoder stride is invalid')
      }
      for (let row = 0; row < block.height; row += 1) {
        if (channels === inputChannels) {
          data.set(
            block.data.subarray(row * block.stride, row * block.stride + decoder.width * channels),
            (expectedY + row) * decoder.width * channels,
          )
        } else if (channels === 1) {
          const sourceRow = row * block.stride
          const targetRow = (expectedY + row) * decoder.width
          for (let x = 0; x < decoder.width; x += 1) {
            data[targetRow + x] = block.data[sourceRow + x * 3] ?? 0
          }
        } else if (channels === 3) {
          const sourceRow = row * block.stride
          const targetRow = (expectedY + row) * decoder.width * 3
          for (let x = 0; x < decoder.width; x += 1) {
            const source = sourceRow + x * 4
            const target = targetRow + x * 3
            data[target] = block.data[source] ?? 0
            data[target + 1] = block.data[source + 1] ?? 0
            data[target + 2] = block.data[source + 2] ?? 0
          }
        } else {
          const sourceRow = row * block.stride
          const targetRow = (expectedY + row) * decoder.width * 4
          for (let x = 0; x < decoder.width; x += 1) {
            const source = sourceRow + x * inputChannels
            const target = targetRow + x * 4
            data[target] = block.data[source] ?? 0
            data[target + 1] = block.data[source + 1] ?? 0
            data[target + 2] = block.data[source + 2] ?? 0
            data[target + 3] = inputChannels === 4 ? (block.data[source + 3] ?? 0) : 255
          }
        }
      }
      expectedY += block.height
    } finally {
      block.release?.()
    }
  }
  if (expectedY !== decoder.height) {
    throw invalidInput(`HDR transform received ${expectedY} of ${decoder.height} rows`)
  }
  return Object.freeze({ width: decoder.width, height: decoder.height, channels, data })
}

const collectBlocks = async (
  blocks: AsyncIterable<PixelBlock>,
  dimensions: GainMapDimensions,
  channels: 1 | 3 | 4,
  maxBytes: number,
): Promise<GainMapRaster8> => {
  const data = new Uint8Array(checkedBytes(dimensions.width, dimensions.height, channels, maxBytes))
  let expectedY = 0
  const format = channels === 1 ? 'gray8' : channels === 3 ? 'rgb8' : 'rgba8'
  for await (const block of blocks) {
    try {
      if (
        block.x !== 0 ||
        block.y !== expectedY ||
        block.width !== dimensions.width ||
        block.format !== format ||
        block.stride < dimensions.width * channels
      ) {
        throw invalidInput('HDR transform produced invalid pixel blocks')
      }
      for (let row = 0; row < block.height; row += 1) {
        data.set(
          block.data.subarray(row * block.stride, row * block.stride + dimensions.width * channels),
          (expectedY + row) * dimensions.width * channels,
        )
      }
      expectedY += block.height
    } finally {
      block.release?.()
    }
  }
  if (expectedY !== dimensions.height) throw invalidInput('HDR transform output is truncated')
  return Object.freeze({ ...dimensions, channels, data })
}

const blocksFor = (raster: GainMapRaster8): AsyncIterable<PixelBlock> => ({
  async *[Symbol.asyncIterator](): AsyncGenerator<PixelBlock> {
    yield {
      x: 0,
      y: 0,
      width: raster.width,
      height: raster.height,
      stride: raster.width * raster.channels,
      format: raster.channels === 1 ? 'gray8' : raster.channels === 3 ? 'rgb8' : 'rgba8',
      data: raster.data,
    }
  },
})

const cropRaster = async (
  raster: GainMapRaster8,
  crop: Readonly<CropOptions>,
  maxBytes: number,
): Promise<GainMapRaster8> =>
  collectBlocks(
    cropPixelBlocks(
      blocksFor(raster),
      raster.width,
      raster.height,
      raster.channels === 1 ? 'gray8' : raster.channels === 3 ? 'rgb8' : 'rgba8',
      crop,
    ),
    { width: crop.width, height: crop.height },
    raster.channels,
    maxBytes,
  )

const resizeRaster = async (
  raster: GainMapRaster8,
  output: GainMapDimensions,
  kernel: ResizeKernel,
  maxBytes: number,
): Promise<GainMapRaster8> => {
  if (raster.width === output.width && raster.height === output.height) return raster
  const transform = createResizeTransform(
    raster.width,
    raster.height,
    raster.channels === 1 ? 'gray8' : 'rgb8',
    { width: output.width, height: output.height, fit: 'fill', kernel },
  )
  return collectBlocks(transform.apply(blocksFor(raster)), output, raster.channels, maxBytes)
}

const resampleRegion = (
  raster: GainMapRaster8,
  region: Readonly<{ left: number; top: number; right: number; bottom: number }>,
  output: GainMapDimensions,
  maxBytes: number,
): GainMapRaster8 => {
  const data = new Uint8Array(checkedBytes(output.width, output.height, raster.channels, maxBytes))
  const sample = (x: number, y: number, channel: number): number => {
    const clampedX = Math.max(0, Math.min(raster.width - 1, x))
    const clampedY = Math.max(0, Math.min(raster.height - 1, y))
    return raster.data[(clampedY * raster.width + clampedX) * raster.channels + channel] ?? 0
  }
  for (let y = 0; y < output.height; y += 1) {
    const sourceY = region.top + ((y + 0.5) * (region.bottom - region.top)) / output.height - 0.5
    const top = Math.floor(sourceY)
    const fractionY = sourceY - top
    for (let x = 0; x < output.width; x += 1) {
      const sourceX = region.left + ((x + 0.5) * (region.right - region.left)) / output.width - 0.5
      const left = Math.floor(sourceX)
      const fractionX = sourceX - left
      const target = (y * output.width + x) * raster.channels
      for (let channel = 0; channel < raster.channels; channel += 1) {
        const upper =
          sample(left, top, channel) * (1 - fractionX) + sample(left + 1, top, channel) * fractionX
        const lower =
          sample(left, top + 1, channel) * (1 - fractionX) +
          sample(left + 1, top + 1, channel) * fractionX
        data[target + channel] = Math.round(upper * (1 - fractionY) + lower * fractionY)
      }
    }
  }
  return Object.freeze({ ...output, channels: raster.channels, data })
}

const orientRaster = (
  raster: GainMapRaster8,
  orientation: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8,
  maxBytes: number,
): GainMapRaster8 => {
  if (orientation === 1) return raster
  const swapsAxes = orientation >= 5
  const width = swapsAxes ? raster.height : raster.width
  const height = swapsAxes ? raster.width : raster.height
  const data = new Uint8Array(checkedBytes(width, height, raster.channels, maxBytes))
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sourceX = x
      let sourceY = y
      if (orientation === 2) sourceX = raster.width - 1 - x
      else if (orientation === 3) {
        sourceX = raster.width - 1 - x
        sourceY = raster.height - 1 - y
      } else if (orientation === 4) sourceY = raster.height - 1 - y
      else if (orientation === 5) {
        sourceX = y
        sourceY = x
      } else if (orientation === 6) {
        sourceX = y
        sourceY = raster.height - 1 - x
      } else if (orientation === 7) {
        sourceX = raster.width - 1 - y
        sourceY = raster.height - 1 - x
      } else if (orientation === 8) {
        sourceX = raster.width - 1 - y
        sourceY = x
      }
      const source = (sourceY * raster.width + sourceX) * raster.channels
      const target = (y * width + x) * raster.channels
      data.set(raster.data.subarray(source, source + raster.channels), target)
    }
  }
  return Object.freeze({ width, height, channels: raster.channels, data })
}

const fractionValue = (value: Readonly<{ numerator: number; denominator: number }>): number =>
  value.numerator / value.denominator

const transformedMetadata = (
  metadata: GainMapMetadata,
  base: GainMapRaster8,
  gainMap: GainMapRaster8,
): GainMapMetadata =>
  normalizeGainMapMetadata({
    ...metadata,
    baseDimensions: { width: base.width, height: base.height },
    gainMapDimensions: { width: gainMap.width, height: gainMap.height },
    baseRange: undefined,
    gainMapRange: undefined,
    metadataRanges: [],
    orientation: 1,
  })

export const transformGainMapRasters = async (
  baseDecoder: ImageDecoder,
  gainDecoder: ImageDecoder,
  metadata: GainMapMetadata,
  operations: readonly GainMapTransformOperation[],
  options: Readonly<{ readonly maxMaterializedBytes?: number; readonly signal?: AbortSignal }> = {},
): Promise<GainMapTransformedRasters> => {
  const maxBytes = options.maxMaterializedBytes ?? 256 * 1024 * 1024
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw invalidInput('maxMaterializedBytes must be a positive safe integer')
  }
  let base = await decodeRaster(
    baseDecoder,
    metadata.baseColor.alpha === 'none' ? 3 : 4,
    maxBytes,
    options.signal,
  )
  let gainMap = await decodeRaster(gainDecoder, metadata.channelCount, maxBytes, options.signal)
  let currentMetadata = metadata
  for (const operation of operations) {
    throwIfAborted(options.signal)
    const state = {
      base: { width: base.width, height: base.height },
      gainMap: { width: gainMap.width, height: gainMap.height },
    }
    if (operation.type === 'auto-orient') {
      planGainMapOrientation(state, currentMetadata.orientation)
      base = orientRaster(base, currentMetadata.orientation, maxBytes)
      gainMap = orientRaster(gainMap, currentMetadata.orientation, maxBytes)
    } else if (operation.type === 'crop') {
      const plan = planGainMapCrop(state, operation)
      base = await cropRaster(base, plan.baseCrop, maxBytes)
      gainMap = resampleRegion(
        gainMap,
        {
          left: fractionValue(plan.gainMapSourceRegion.left),
          top: fractionValue(plan.gainMapSourceRegion.top),
          right: fractionValue(plan.gainMapSourceRegion.right),
          bottom: fractionValue(plan.gainMapSourceRegion.bottom),
        },
        plan.gainMap,
        maxBytes,
      )
    } else if (operation.type === 'flip-horizontal') {
      base = orientRaster(base, 2, maxBytes)
      gainMap = orientRaster(gainMap, 2, maxBytes)
    } else if (operation.type === 'flip-vertical') {
      base = orientRaster(base, 4, maxBytes)
      gainMap = orientRaster(gainMap, 4, maxBytes)
    } else if (operation.type === 'rotate') {
      planGainMapQuarterTurn(state, operation.degrees)
      const orientation = operation.degrees === 90 ? 6 : operation.degrees === 180 ? 3 : 8
      base = orientRaster(base, orientation, maxBytes)
      gainMap = orientRaster(gainMap, orientation, maxBytes)
    } else {
      const plan = planGainMapResize(
        state,
        { width: operation.width, height: operation.height },
        {
          kernel: operation.kernel,
          ...(operation.gainMapDimensions
            ? { gainMapDimensions: operation.gainMapDimensions }
            : {}),
        },
      )
      base = await resizeRaster(base, plan.base, plan.kernel, maxBytes)
      gainMap = await resizeRaster(gainMap, plan.gainMap, plan.kernel, maxBytes)
    }
    currentMetadata = transformedMetadata(currentMetadata, base, gainMap)
  }
  return Object.freeze({ base, gainMap, metadata: currentMetadata })
}

const encodeJpeg = async (
  raster: GainMapRaster8,
  quality: number,
  chromaSubsampling: '420' | '422' | '444',
  signal: AbortSignal | undefined,
): Promise<Uint8Array> => {
  if (!jpegCodec.createEncoder) throw unsupportedOperation('JPEG encoding is unavailable')
  const sink = new Uint8ArraySink()
  const encoder = await jpegCodec.createEncoder(sink, {
    width: raster.width,
    height: raster.height,
    pixelFormat: raster.channels === 1 ? 'gray8' : 'rgb8',
    options: { quality, chromaSubsampling },
    ...(signal === undefined ? {} : { signal }),
  })
  try {
    await encoder.write({
      x: 0,
      y: 0,
      width: raster.width,
      height: raster.height,
      stride: raster.width * raster.channels,
      format: raster.channels === 1 ? 'gray8' : 'rgb8',
      data: raster.data,
    })
    await encoder.finish()
  } catch (error) {
    await encoder.abort?.(error)
    throw error
  }
  return sink.toUint8Array()
}

export const encodeTransformedGainMapJpeg = async (
  rasters: GainMapTransformedRasters,
  options: Readonly<GainMapJpegEncodeOptions> = {},
): Promise<Uint8Array> => {
  if (rasters.base.channels !== 3) {
    throw unsupportedOperation('Gain-map JPEG output does not support base alpha')
  }
  const baseQuality = validateQuality(options.baseQuality, 90, 'baseQuality')
  const gainMapQuality = validateQuality(options.gainMapQuality, 90, 'gainMapQuality')
  const [baseJpeg, gainMapJpeg] = await Promise.all([
    encodeJpeg(rasters.base, baseQuality, options.baseChromaSubsampling ?? '420', options.signal),
    encodeJpeg(rasters.gainMap, gainMapQuality, '444', options.signal),
  ])
  return assembleGainMapJpeg({ baseJpeg, gainMapJpeg, metadata: rasters.metadata }, options)
}
