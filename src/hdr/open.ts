import { throwIfAborted } from '../abort.ts'
import type { ImageDecoder, ImageMetadata } from '../codec.ts'
import {
  avifCodec,
  createAvifGainMapDecoderComponents,
  type AvifBitstreamInspection,
  type NclxColor,
} from '../codecs/avif.ts'
import { jpegCodec } from '../codecs/jpeg.ts'
import type { PixelColorSemantics } from '../color.ts'
import type { EvidenceContext } from '../evidence.ts'
import { invalidInput, unsupportedOperation } from '../errors.ts'
import type { ImageLimitOptions } from '../limits.ts'
import { resolveLimits } from '../limits.ts'
import type { PixelBlock } from '../pixel.ts'
import type { CropOptions, ResizeKernel } from '../pipeline.ts'
import { createResizeTransform } from '../resize.ts'
import type { ImageInput, ImageSource } from '../source.ts'
import { createImageSource, readExactly } from '../source.ts'
import { inspectHdrJpeg, type HdrJpegInspection, type HdrJpegLimits } from './jpeg.ts'
import type { GainMapMetadata } from './model.ts'
import { normalizeGainMapMetadata } from './model.ts'
import { decodeTransfer, gainMapDisplayWeight } from './math.ts'
import { ImageSourceRange } from './source-slice.ts'
import {
  encodeTransformedGainMapJpeg,
  planTransformedGainMapMetadata,
  renderTransformedGainMapRasters,
  transformGainMapRasters,
  type GainMapJpegEncodeOptions,
  type GainMapTransformOperation,
} from './transform.ts'
import type { GainMapQuarterTurn } from './geometry.ts'
import { assembleGainMapAvif, type GainMapAvifEncodeOptions } from './avif-output.ts'

export interface OpenGainMapImageOptions extends HdrJpegLimits {
  readonly imageLimits?: ImageLimitOptions
  readonly signal?: AbortSignal
  readonly evidence?: EvidenceContext
}

interface GainMapImageInspectionCommon {
  readonly status: 'valid'
  readonly metadata: GainMapMetadata
  readonly representations: readonly ['iso-21496-1'] | HdrJpegInspection['representations']
}

export interface JpegGainMapImageInspection extends GainMapImageInspectionCommon {
  readonly container: 'jpeg'
  readonly primary: HdrJpegInspection['primary']
  readonly gainMap: NonNullable<HdrJpegInspection['gainMap']>
}

export interface AvifGainMapImageInspection extends GainMapImageInspectionCommon {
  readonly container: 'avif'
  readonly avif: AvifBitstreamInspection
  readonly representations: readonly ['iso-21496-1']
}

export type GainMapImageInspection = JpegGainMapImageInspection | AvifGainMapImageInspection

export interface GainMapRenderedBlock {
  readonly x: 0
  readonly y: number
  readonly width: number
  readonly height: number
  readonly stride: number
  readonly pixelFormat: 'rgbf32' | 'rgbaf32'
  readonly colorSemantics: PixelColorSemantics
  readonly data: Float32Array
}

export interface GainMapRenderRequest {
  readonly displayBoost: number
  readonly signal?: AbortSignal
  readonly maxMaterializedBytes?: number
}

export interface OpenedGainMapImage {
  inspection(): GainMapImageInspection
  extractBase(options?: Readonly<{ readonly signal?: AbortSignal }>): Promise<Uint8Array>
  extractGainMap(options?: Readonly<{ readonly signal?: AbortSignal }>): Promise<Uint8Array>
  render(request: Readonly<GainMapRenderRequest>): AsyncIterable<GainMapRenderedBlock>
  autoOrient(): OpenedGainMapImage
  crop(options: Readonly<CropOptions>): OpenedGainMapImage
  flipHorizontal(): OpenedGainMapImage
  flipVertical(): OpenedGainMapImage
  rotate(degrees: GainMapQuarterTurn): OpenedGainMapImage
  resize(
    options: Readonly<{
      readonly width: number
      readonly height: number
      readonly kernel?: ResizeKernel
      readonly gainMapDimensions?: Readonly<{ readonly width: number; readonly height: number }>
    }>,
  ): OpenedGainMapImage
  jpeg(options?: Readonly<GainMapJpegEncodeOptions>): Promise<Uint8Array>
  avif(
    options?: Readonly<
      GainMapAvifEncodeOptions & {
        readonly maxMaterializedBytes?: number
      }
    >,
  ): Promise<Uint8Array>
  close(): void
}

interface GainMapImageOwner {
  closed: boolean
}

const sRgbDecodedSemantics = Object.freeze<PixelColorSemantics>({
  family: 'rgb',
  primaries: 'srgb',
  transfer: Object.freeze({ kind: 'srgb' }),
  matrix: 'identity',
  range: 'full',
  alpha: 'none',
  provenance: 'decoder-converted',
})

const linearSrgbSemantics = Object.freeze<PixelColorSemantics>({
  ...sRgbDecodedSemantics,
  transfer: Object.freeze({ kind: 'linear' }),
})

const gainSemantics = (channels: 1 | 3): PixelColorSemantics =>
  Object.freeze({
    family: channels === 1 ? 'gray' : 'rgb',
    primaries: channels === 1 ? 'unspecified' : 'srgb',
    transfer: Object.freeze({ kind: 'linear' }),
    matrix: 'identity',
    range: 'full',
    alpha: 'none',
    provenance: 'container-signaled',
  })

const createDecoder = async (
  source: ImageSource,
  limits: ReturnType<typeof resolveLimits>,
  signal: AbortSignal | undefined,
): Promise<ImageDecoder> => {
  if (!jpegCodec.createDecoder) throw unsupportedOperation('JPEG decoding is unavailable')
  return jpegCodec.createDecoder(source, limits, signal === undefined ? {} : { signal })
}

const alignedRgbBlocks = async function* (
  blocks: AsyncIterable<PixelBlock>,
  width: number,
  outputChannels: 3 | 4 = 3,
): AsyncGenerator<PixelBlock> {
  let expectedY = 0
  let blockY = 0
  let rows = 0
  let output = new Uint8Array(width * 32 * outputChannels)
  const iterator = blocks[Symbol.asyncIterator]()
  try {
    while (true) {
      const result = await iterator.next()
      if (result.done) break
      const block = result.value
      try {
        const inputChannels = block.format === 'rgb8' ? 3 : block.format === 'rgba8' ? 4 : 0
        if (
          block.x !== 0 ||
          block.y !== expectedY ||
          block.width !== width ||
          inputChannels === 0 ||
          block.stride < width * inputChannels
        ) {
          throw invalidInput('Gain-map JPEG rows are not contiguous RGB8 pixels')
        }
        for (let sourceY = 0; sourceY < block.height; sourceY += 1) {
          const sourceRow = sourceY * block.stride
          const targetRow = rows * width * outputChannels
          if (inputChannels === outputChannels) {
            output.set(
              block.data.subarray(sourceRow, sourceRow + width * outputChannels),
              targetRow,
            )
          } else {
            for (let x = 0; x < width; x += 1) {
              const source = sourceRow + x * inputChannels
              const target = targetRow + x * outputChannels
              output[target] = block.data[source] ?? 0
              output[target + 1] = block.data[source + 1] ?? 0
              output[target + 2] = block.data[source + 2] ?? 0
              if (outputChannels === 4) {
                output[target + 3] = inputChannels === 4 ? (block.data[source + 3] ?? 0) : 255
              }
            }
          }
          rows += 1
          expectedY += 1
          if (rows === 32) {
            yield {
              x: 0,
              y: blockY,
              width,
              height: rows,
              stride: width * outputChannels,
              format: outputChannels === 4 ? 'rgba8' : 'rgb8',
              data: output,
            }
            blockY += rows
            rows = 0
            output = new Uint8Array(width * 32 * outputChannels)
          }
        }
      } finally {
        block.release?.()
      }
    }
    if (rows > 0) {
      yield {
        x: 0,
        y: blockY,
        width,
        height: rows,
        stride: width * outputChannels,
        format: outputChannels === 4 ? 'rgba8' : 'rgb8',
        data: output.subarray(0, rows * width * outputChannels),
      }
    }
  } finally {
    await iterator.return?.()
  }
}

const gainMultipliers = (metadata: GainMapMetadata, displayBoost: number): Float64Array => {
  const weight = gainMapDisplayWeight(metadata, displayBoost)
  const table = new Float64Array(3 * 256)
  for (let channel = 0; channel < 3; channel += 1) {
    const minimum = metadata.minimum[channel] ?? 0
    const maximum = metadata.maximum[channel] ?? minimum
    const inverseGamma = 1 / (metadata.gamma[channel] ?? 1)
    for (let encoded = 0; encoded < 256; encoded += 1) {
      const recovery = (encoded / 255) ** inverseGamma
      const logBoost = minimum * (1 - recovery) + maximum * recovery
      table[channel * 256 + encoded] = 2 ** (logBoost * weight)
    }
  }
  return table
}

class OpenedGainMapImageImplementation implements OpenedGainMapImage {
  readonly #source: ImageSource
  readonly #inspection: GainMapImageInspection
  readonly #baseSource: ImageSourceRange | undefined
  readonly #gainSource: ImageSourceRange | undefined
  readonly #baseItem: Uint8Array | undefined
  readonly #gainItem: Uint8Array | undefined
  readonly #baseDecoder: ImageDecoder
  readonly #gainDecoder: ImageDecoder
  readonly #evidence: EvidenceContext | undefined
  readonly #owner: GainMapImageOwner
  readonly #operations: readonly GainMapTransformOperation[]

  constructor(
    source: ImageSource,
    inspection: GainMapImageInspection,
    baseSource: ImageSourceRange | undefined,
    gainSource: ImageSourceRange | undefined,
    baseDecoder: ImageDecoder,
    gainDecoder: ImageDecoder,
    evidence: EvidenceContext | undefined,
    owner: GainMapImageOwner = { closed: false },
    operations: readonly GainMapTransformOperation[] = [],
    baseItem?: Uint8Array,
    gainItem?: Uint8Array,
  ) {
    this.#source = source
    this.#inspection = inspection
    this.#baseSource = baseSource
    this.#gainSource = gainSource
    this.#baseItem = baseItem
    this.#gainItem = gainItem
    this.#baseDecoder = baseDecoder
    this.#gainDecoder = gainDecoder
    this.#evidence = evidence
    this.#owner = owner
    this.#operations = operations
  }

  #assertOpen(): void {
    if (this.#owner.closed) throw invalidInput('Gain-map image is closed')
  }

  inspection(): GainMapImageInspection {
    this.#assertOpen()
    if (this.#operations.length === 0) return this.#inspection
    return Object.freeze({
      ...this.#inspection,
      metadata: planTransformedGainMapMetadata(this.#inspection.metadata, this.#operations),
    })
  }

  async extractBase(
    options: Readonly<{ readonly signal?: AbortSignal }> = {},
  ): Promise<Uint8Array> {
    this.#assertOpen()
    const evidence = this.#evidence?.child('base extraction')
    evidence?.operation({ operationId: 'hdr-base-extract', phase: 'start' })
    const output = this.#baseSource
      ? Uint8Array.from(await readExactly(this.#baseSource, 0, this.#baseSource.size, options))
      : this.#baseItem
        ? Uint8Array.from(this.#baseItem)
        : (() => {
            throw unsupportedOperation('Encoded AVIF base extraction is unavailable')
          })()
    evidence?.operation({ operationId: 'hdr-base-extract', phase: 'complete' })
    return output
  }

  async extractGainMap(
    options: Readonly<{ readonly signal?: AbortSignal }> = {},
  ): Promise<Uint8Array> {
    this.#assertOpen()
    const evidence = this.#evidence?.child('gain-map extraction')
    evidence?.operation({ operationId: 'hdr-gain-map-extract', phase: 'start' })
    const output = this.#gainSource
      ? Uint8Array.from(await readExactly(this.#gainSource, 0, this.#gainSource.size, options))
      : this.#gainItem
        ? Uint8Array.from(this.#gainItem)
        : (() => {
            throw unsupportedOperation('Encoded AVIF gain-map extraction is unavailable')
          })()
    evidence?.operation({ operationId: 'hdr-gain-map-extract', phase: 'complete' })
    return output
  }

  render(request: Readonly<GainMapRenderRequest>): AsyncIterable<GainMapRenderedBlock> {
    this.#assertOpen()
    const owner = this
    if (this.#operations.length > 0) {
      return {
        async *[Symbol.asyncIterator](): AsyncGenerator<GainMapRenderedBlock> {
          const transformed = await transformGainMapRasters(
            owner.#baseDecoder,
            owner.#gainDecoder,
            owner.#inspection.metadata,
            owner.#operations,
            {
              ...(request.signal === undefined ? {} : { signal: request.signal }),
              ...(request.maxMaterializedBytes === undefined
                ? {}
                : { maxMaterializedBytes: request.maxMaterializedBytes }),
            },
          )
          yield* renderTransformedGainMapRasters(
            transformed,
            request.displayBoost,
            request.maxMaterializedBytes,
          )
        },
      }
    }
    return {
      async *[Symbol.asyncIterator](): AsyncGenerator<GainMapRenderedBlock> {
        owner.#assertOpen()
        throwIfAborted(request.signal)
        const metadata = owner.#inspection.metadata
        const baseChannels = metadata.baseColor.alpha === 'none' ? 3 : 4
        const multipliers = gainMultipliers(metadata, request.displayBoost)
        const baseOffset =
          metadata.baseRendition === 'hdr' ? metadata.offsetHdr : metadata.offsetSdr
        const alternateOffset =
          metadata.baseRendition === 'hdr' ? metadata.offsetSdr : metadata.offsetHdr
        const baseBlocks = alignedRgbBlocks(
          owner.#baseDecoder.decode(request.signal === undefined ? {} : { signal: request.signal }),
          owner.#baseDecoder.width,
          baseChannels,
        )
        let gainBlocks: AsyncIterable<PixelBlock> = alignedRgbBlocks(
          owner.#gainDecoder.decode(request.signal === undefined ? {} : { signal: request.signal }),
          owner.#gainDecoder.width,
        )
        if (
          owner.#gainDecoder.width !== owner.#baseDecoder.width ||
          owner.#gainDecoder.height !== owner.#baseDecoder.height
        ) {
          gainBlocks = createResizeTransform(
            owner.#gainDecoder.width,
            owner.#gainDecoder.height,
            'rgb8',
            {
              width: owner.#baseDecoder.width,
              height: owner.#baseDecoder.height,
              fit: 'fill',
              kernel: 'bilinear',
            },
          ).apply(gainBlocks)
        }
        const alignedGain = alignedRgbBlocks(gainBlocks, owner.#baseDecoder.width)
        const baseIterator = baseBlocks[Symbol.asyncIterator]()
        const gainIterator = alignedGain[Symbol.asyncIterator]()
        const evidence = owner.#evidence?.child('gain-map composition')
        evidence?.operation({ operationId: 'hdr-gain-map-compose', phase: 'start' })
        try {
          while (true) {
            owner.#assertOpen()
            throwIfAborted(request.signal)
            const [baseResult, gainResult] = await Promise.all([
              baseIterator.next(),
              gainIterator.next(),
            ])
            if (baseResult.done || gainResult.done) {
              if (baseResult.done !== gainResult.done) {
                throw invalidInput('Base and gain-map JPEG rows ended at different positions')
              }
              evidence?.operation({ operationId: 'hdr-gain-map-compose', phase: 'complete' })
              return
            }
            const base = baseResult.value
            const gain = gainResult.value
            if (
              base.y !== gain.y ||
              base.width !== gain.width ||
              base.height !== gain.height ||
              base.format !== (baseChannels === 4 ? 'rgba8' : 'rgb8') ||
              gain.format !== 'rgb8'
            ) {
              throw invalidInput('Base and gain-map JPEG blocks do not align')
            }
            const pixels = base.width * base.height
            const output = new Float32Array(pixels * baseChannels)
            for (let pixel = 0; pixel < pixels; pixel += 1) {
              const basePixelOffset = pixel * baseChannels
              const gainOffset = pixel * 3
              const scalarGain = gain.data[gainOffset] ?? 0
              for (let channel = 0; channel < 3; channel += 1) {
                const encodedGain =
                  metadata.channelCount === 1 ? scalarGain : (gain.data[gainOffset + channel] ?? 0)
                const baseLinear = decodeTransfer(
                  (base.data[basePixelOffset + channel] ?? 0) / 255,
                  metadata.baseColor.transfer,
                )
                const value =
                  (baseLinear + (baseOffset[channel] ?? 0)) *
                    (multipliers[channel * 256 + encodedGain] ?? 1) -
                  (alternateOffset[channel] ?? 0)
                if (!Number.isFinite(value)) {
                  throw invalidInput('Gain-map JPEG rendering produced a non-finite value')
                }
                output[basePixelOffset + channel] = Math.max(0, value)
              }
              if (baseChannels === 4) {
                output[basePixelOffset + 3] = (base.data[basePixelOffset + 3] ?? 0) / 255
              }
            }
            evidence?.block({
              stage: 'decoded',
              blockId: `hdr-output:${base.y}`,
              width: base.width,
              height: base.height,
            })
            yield Object.freeze({
              x: 0,
              y: base.y,
              width: base.width,
              height: base.height,
              stride: base.width * baseChannels,
              pixelFormat: baseChannels === 4 ? 'rgbaf32' : 'rgbf32',
              colorSemantics:
                baseChannels === 4
                  ? Object.freeze({ ...linearSrgbSemantics, alpha: metadata.baseColor.alpha })
                  : linearSrgbSemantics,
              data: output,
            })
          }
        } catch (error) {
          if (request.signal?.aborted) {
            evidence?.cancellation('hdr-gain-map-compose')
          } else {
            evidence?.operation({
              operationId: 'hdr-gain-map-compose',
              phase: 'failed',
              failureCode: error instanceof Error ? error.name : 'unknown',
            })
          }
          throw error
        } finally {
          await baseIterator.return?.(undefined)
          await gainIterator.return?.(undefined)
        }
      },
    }
  }

  #append(operation: GainMapTransformOperation): OpenedGainMapImage {
    this.#assertOpen()
    return new OpenedGainMapImageImplementation(
      this.#source,
      this.#inspection,
      this.#baseSource,
      this.#gainSource,
      this.#baseDecoder,
      this.#gainDecoder,
      this.#evidence,
      this.#owner,
      Object.freeze([...this.#operations, Object.freeze(operation)]),
      this.#baseItem,
      this.#gainItem,
    )
  }

  autoOrient(): OpenedGainMapImage {
    return this.#append({ type: 'auto-orient' })
  }

  crop(options: Readonly<CropOptions>): OpenedGainMapImage {
    return this.#append({ type: 'crop', ...options })
  }

  flipHorizontal(): OpenedGainMapImage {
    return this.#append({ type: 'flip-horizontal' })
  }

  flipVertical(): OpenedGainMapImage {
    return this.#append({ type: 'flip-vertical' })
  }

  rotate(degrees: GainMapQuarterTurn): OpenedGainMapImage {
    return this.#append({ type: 'rotate', degrees })
  }

  resize(
    options: Readonly<{
      readonly width: number
      readonly height: number
      readonly kernel?: ResizeKernel
      readonly gainMapDimensions?: Readonly<{ readonly width: number; readonly height: number }>
    }>,
  ): OpenedGainMapImage {
    return this.#append({
      type: 'resize',
      width: options.width,
      height: options.height,
      kernel: options.kernel ?? 'lanczos3',
      ...(options.gainMapDimensions ? { gainMapDimensions: options.gainMapDimensions } : {}),
    })
  }

  async jpeg(options: Readonly<GainMapJpegEncodeOptions> = {}): Promise<Uint8Array> {
    this.#assertOpen()
    const transformed = await transformGainMapRasters(
      this.#baseDecoder,
      this.#gainDecoder,
      this.#inspection.metadata,
      this.#operations,
      {
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        ...(options.maxMaterializedBytes === undefined
          ? {}
          : { maxMaterializedBytes: options.maxMaterializedBytes }),
      },
    )
    return encodeTransformedGainMapJpeg(transformed, options)
  }

  async avif(
    options: Readonly<GainMapAvifEncodeOptions & { readonly maxMaterializedBytes?: number }> = {},
  ): Promise<Uint8Array> {
    this.#assertOpen()
    const transformed = await transformGainMapRasters(
      this.#baseDecoder,
      this.#gainDecoder,
      this.#inspection.metadata,
      this.#operations,
      {
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        ...(options.maxMaterializedBytes === undefined
          ? {}
          : { maxMaterializedBytes: options.maxMaterializedBytes }),
      },
    )
    return assembleGainMapAvif(transformed, options)
  }

  close(): void {
    this.#owner.closed = true
  }
}

const jpegGainMapMetadata = (
  inspection: HdrJpegInspection,
  primaryMetadata: ImageMetadata,
): GainMapMetadata => {
  const xmp = inspection.ultraHdr
  const iso = inspection.iso
  const gainDimensions = inspection.gainMapDimensions
  if ((!iso && !xmp) || !inspection.gainMap || !gainDimensions) {
    throw unsupportedOperation('JPEG does not contain a supported valid gain-map relationship')
  }
  const channelCount: 1 | 3 = gainDimensions.components === 1 ? 1 : 3
  if (gainDimensions.components !== 1 && gainDimensions.components !== 3) {
    throw unsupportedOperation('Gain-map JPEG must contain one or three components')
  }
  const orientation = primaryMetadata.orientation ?? 1
  const selected = iso ?? xmp
  if (!selected) throw unsupportedOperation('JPEG gain-map metadata is missing')
  const channelValues = (values: readonly number[]): readonly number[] =>
    channelCount === 1 ? Object.freeze([values[0] ?? 0]) : values
  return normalizeGainMapMetadata({
    baseRendition: selected.baseRendition,
    channelCount,
    baseDimensions: {
      width: inspection.primaryDimensions.width,
      height: inspection.primaryDimensions.height,
    },
    gainMapDimensions: { width: gainDimensions.width, height: gainDimensions.height },
    minimum: channelValues(selected.minimum),
    maximum: channelValues(selected.maximum),
    gamma: channelValues(selected.gamma),
    offsetSdr: channelValues(selected.offsetSdr),
    offsetHdr: channelValues(selected.offsetHdr),
    capacityMinimum: selected.capacityMinimum,
    capacityMaximum: selected.capacityMaximum,
    useBaseColorSpace: iso?.useBaseColorSpace ?? true,
    baseColor: sRgbDecodedSemantics,
    alternateColor: linearSrgbSemantics,
    gainMapColor: gainSemantics(channelCount),
    container: 'jpeg',
    representations: inspection.representations,
    selectedRepresentation: iso ? 'iso-21496-1' : 'ultra-hdr-xmp',
    baseRange: inspection.primary,
    gainMapRange: inspection.gainMap,
    metadataRanges: inspection.metadataRanges,
    orientation,
    ...(iso ? { exactIso: iso.exact } : {}),
    ...(xmp
      ? {
          ultraHdrLexical: {
            minimum: xmp.lexical.minimum,
            maximum: xmp.lexical.maximum,
            gamma: xmp.lexical.gamma,
            offsetSdr: xmp.lexical.offsetSdr,
            offsetHdr: xmp.lexical.offsetHdr,
            capacityMinimum: xmp.lexical.capacityMinimum,
            capacityMaximum: xmp.lexical.capacityMaximum,
          },
        }
      : {}),
    warnings:
      primaryMetadata.colorProfile?.kind === 'icc'
        ? ['JPEG ICC pixels are rendered through the existing decoder conversion path']
        : [],
  })
}

const rationalValue = (value: Readonly<{ numerator: number; denominator: number }>): number =>
  value.numerator / value.denominator

const nclxSemantics = (
  color: NclxColor,
  alpha: PixelColorSemantics['alpha'],
): PixelColorSemantics => {
  const primaries: PixelColorSemantics['primaries'] =
    color.primaries === 1
      ? 'srgb'
      : color.primaries === 12
        ? 'display-p3'
        : color.primaries === 9
          ? 'rec2020'
          : 'unspecified'
  const transfer: PixelColorSemantics['transfer'] =
    color.transferCharacteristics === 13
      ? { kind: 'srgb' }
      : color.transferCharacteristics === 8
        ? { kind: 'linear' }
        : color.transferCharacteristics === 16
          ? { kind: 'pq' }
          : color.transferCharacteristics === 18
            ? { kind: 'hlg' }
            : { kind: 'unspecified' }
  const matrix: PixelColorSemantics['matrix'] =
    color.matrixCoefficients === 0
      ? 'identity'
      : color.matrixCoefficients === 1 || color.matrixCoefficients === 6
        ? 'bt709'
        : color.matrixCoefficients === 9
          ? 'bt2020-ncl'
          : 'unspecified'
  return Object.freeze({
    family: 'rgb',
    primaries,
    transfer: Object.freeze(transfer),
    matrix,
    range: color.fullRange ? 'full' : 'limited',
    alpha,
    provenance: 'decoder-converted',
  })
}

const avifGainMapMetadata = (
  components: Awaited<ReturnType<typeof createAvifGainMapDecoderComponents>>,
): GainMapMetadata => {
  const gainMap = components.inspection.gainMap
  const baseColor = components.inspection.nclx
  if (!gainMap || !baseColor) {
    throw unsupportedOperation('AVIF gain-map color signaling is required')
  }
  const metadata = gainMap.metadata
  const values = (items: typeof metadata.gainMapMin): readonly number[] =>
    metadata.channelCount === 1
      ? Object.freeze([rationalValue(items[0])])
      : Object.freeze(items.map(rationalValue))
  return normalizeGainMapMetadata({
    baseRendition: metadata.baseRendition,
    channelCount: metadata.channelCount,
    baseDimensions: {
      width: components.baseDecoder.width,
      height: components.baseDecoder.height,
    },
    gainMapDimensions: {
      width: components.gainMapDecoder.width,
      height: components.gainMapDecoder.height,
    },
    minimum: values(metadata.gainMapMin),
    maximum: values(metadata.gainMapMax),
    gamma: values(metadata.gainMapGamma),
    offsetSdr: values(metadata.exactIso.offsetSdr),
    offsetHdr: values(metadata.exactIso.offsetHdr),
    capacityMinimum: rationalValue(metadata.exactIso.capacityMinimum),
    capacityMaximum: rationalValue(metadata.exactIso.capacityMaximum),
    useBaseColorSpace: metadata.useBaseColorSpace,
    baseColor: nclxSemantics(
      baseColor,
      components.inspection.alphaItemId === undefined ? 'none' : 'straight',
    ),
    alternateColor: nclxSemantics(gainMap.alternateColor, 'none'),
    gainMapColor: gainSemantics(metadata.channelCount),
    container: 'avif',
    representations: ['iso-21496-1'],
    selectedRepresentation: 'iso-21496-1',
    sourceCardinality: metadata.channelCount === 1 ? 'scalar' : 'rgb',
    metadataRanges: [],
    orientation: 1,
    exactIso: metadata.exactIso,
    warnings: [],
  })
}

export const openGainMapImage = async (
  input: ImageInput,
  options: Readonly<OpenGainMapImageOptions> = {},
): Promise<OpenedGainMapImage> => {
  const limits = resolveLimits(options.imageLimits)
  const source = await createImageSource(input, limits, options)
  const header = await source.read(0, Math.min(source.size, 64), options)
  if (avifCodec.detect(header)) {
    const components = await createAvifGainMapDecoderComponents(source, limits)
    const metadata = avifGainMapMetadata(components)
    const publicInspection: AvifGainMapImageInspection = Object.freeze({
      container: 'avif',
      status: 'valid',
      metadata,
      representations: Object.freeze(['iso-21496-1'] as const),
      avif: components.inspection,
    })
    return new OpenedGainMapImageImplementation(
      source,
      publicInspection,
      undefined,
      undefined,
      components.baseDecoder,
      components.gainMapDecoder,
      options.evidence,
      { closed: false },
      [],
      components.baseItem,
      components.gainMapItem,
    )
  }
  const inspectionEvidence = options.evidence?.child('compound JPEG inspection')
  inspectionEvidence?.operation({ operationId: 'hdr-jpeg-inspect', phase: 'start' })
  const jpeg = await inspectHdrJpeg(source, options)
  inspectionEvidence?.operation({ operationId: 'hdr-jpeg-inspect', phase: 'complete' })
  if (!jpeg.gainMap) {
    throw unsupportedOperation('JPEG does not contain a supported gain-map image')
  }
  const baseSource = new ImageSourceRange(
    source,
    jpeg.primary.start,
    jpeg.primary.end - jpeg.primary.start,
  )
  const gainSource = new ImageSourceRange(
    source,
    jpeg.gainMap.start,
    jpeg.gainMap.end - jpeg.gainMap.start,
  )
  const primaryMetadata = await jpegCodec.metadata(baseSource, limits, {
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
  const metadata = jpegGainMapMetadata(jpeg, primaryMetadata)
  const publicInspection: GainMapImageInspection = Object.freeze({
    container: 'jpeg',
    status: 'valid',
    metadata,
    primary: jpeg.primary,
    gainMap: jpeg.gainMap,
    representations: jpeg.representations,
  })
  const [baseDecoder, gainDecoder] = await Promise.all([
    createDecoder(baseSource, limits, options.signal),
    createDecoder(gainSource, limits, options.signal),
  ])
  return new OpenedGainMapImageImplementation(
    source,
    publicInspection,
    baseSource,
    gainSource,
    baseDecoder,
    gainDecoder,
    options.evidence,
  )
}
