import type { AbortOptions } from '../abort.ts'
import { throwIfAborted } from '../abort.ts'
import type { DecoderOptions, ImageCodec, ImageDecoder, ImageMetadata } from '../codec.ts'
import { invalidInput, limitExceeded, unsupportedOperation } from '../errors.ts'
import type { ImageLimitOptions, ImageLimits } from '../limits.ts'
import { resolveLimits, validateImageDimensions, validateInputSize } from '../limits.ts'
import type { PixelBlock, PixelFormat } from '../pixel.ts'
import type { RasterBlock, RasterFormat } from '../raster.ts'
import {
  bindImageSourceSignal,
  type ImageSource,
  sourceSessionEnd,
  sourceSessionStart,
} from '../source.ts'
import type {
  NormalizedScientificDatasetDescriptor,
  ScientificComponentDescriptor,
  ScientificDataset,
  ScientificMetadataObject,
  ScientificPlaneReadRequest,
  ScientificResolutionLevel,
} from './dataset.ts'
import {
  normalizeScientificDatasetDescriptor,
  normalizeScientificMetadataObject,
  normalizeScientificPlaneReadRequest,
} from './dataset.ts'
import type {
  ScientificDatasetSummary,
  ScientificDocument,
  ScientificOpenContext,
  ScientificProbeResult,
  ScientificReader,
  ScientificReaderDescriptor,
} from './reader.ts'
import { createScientificDatasetIdentity, identifyScientificDataset } from './reader.ts'
import { resourceHasHint } from './readers/shared.ts'

export interface ImageCodecScientificReaderOptions {
  readonly descriptor: ScientificReaderDescriptor
  readonly codec: ImageCodec
  readonly limits?: ImageLimitOptions
}

interface SessionManagedSource extends ImageSource {
  [sourceSessionStart](): void
  [sourceSessionEnd](): Promise<void>
}

interface LevelDescription {
  readonly level: number
  readonly width: number
  readonly height: number
}

interface FrameDescription {
  readonly frame: number
  readonly datasetId: string
  readonly pixelFormat: CanonicalPixelFormat
  readonly levels: readonly LevelDescription[]
}

type CanonicalPixelFormat = Extract<PixelFormat, 'gray8' | 'rgb8' | 'rgba8'>

const grayComponents: readonly ScientificComponentDescriptor[] = Object.freeze([
  Object.freeze({ id: 'grayscale', name: 'Grayscale intensity', kind: 'intensity' }),
])
const rgbComponents: readonly ScientificComponentDescriptor[] = Object.freeze([
  Object.freeze({ id: 'red', name: 'Red', kind: 'red' }),
  Object.freeze({ id: 'green', name: 'Green', kind: 'green' }),
  Object.freeze({ id: 'blue', name: 'Blue', kind: 'blue' }),
])
const rgbaComponents: readonly ScientificComponentDescriptor[] = Object.freeze([
  ...rgbComponents,
  Object.freeze({ id: 'alpha', name: 'Alpha', kind: 'alpha' }),
])
const rasterFormats: Readonly<Record<CanonicalPixelFormat, RasterFormat>> = Object.freeze({
  gray8: Object.freeze({ sampleType: 'uint8', channels: 1, planar: false }),
  rgb8: Object.freeze({ sampleType: 'uint8', channels: 3, planar: false }),
  rgba8: Object.freeze({ sampleType: 'uint8', channels: 4, planar: false }),
})

const isSessionManagedSource = (source: ImageSource): source is SessionManagedSource =>
  sourceSessionStart in source &&
  typeof source[sourceSessionStart] === 'function' &&
  sourceSessionEnd in source &&
  typeof source[sourceSessionEnd] === 'function'

const canonicalPixelFormat = (format: PixelFormat, codec: ImageCodec): CanonicalPixelFormat => {
  if (format === 'gray8' || format === 'rgb8' || format === 'rgba8') return format
  throw unsupportedOperation(
    `Scientific codec adapter ${codec.format} requires gray8, rgb8, or rgba8 decoder output; received ${format}`,
  )
}

const componentsFor = (format: CanonicalPixelFormat): readonly ScientificComponentDescriptor[] =>
  format === 'gray8' ? grayComponents : format === 'rgb8' ? rgbComponents : rgbaComponents

const positiveSelectionCount = (value: number | undefined, label: string): number => {
  const count = value ?? 1
  if (!Number.isSafeInteger(count) || count < 1) {
    throw invalidInput(`${label} must be a positive safe integer`)
  }
  return count
}

const decoderOptions = (
  codec: ImageCodec,
  frame: number,
  resolutionLevel: number,
  signal: AbortSignal | undefined,
): DecoderOptions =>
  Object.freeze({
    ...(codec.selection?.frames === true ? { frame } : {}),
    ...(codec.selection?.resolutionLevels === true ? { resolutionLevel } : {}),
    ...(signal === undefined ? {} : { signal }),
  })

const inspectDecoder = (
  decoder: ImageDecoder,
  codec: ImageCodec,
  limits: ImageLimits,
): CanonicalPixelFormat => {
  const format = canonicalPixelFormat(decoder.pixelFormat, codec)
  validateImageDimensions(decoder.width, decoder.height, 1, limits, rasterFormats[format].channels)
  return format
}

const describeFrames = async (
  source: ImageSource,
  codec: ImageCodec,
  metadata: ImageMetadata,
  limits: ImageLimits,
  signal: AbortSignal | undefined,
): Promise<readonly FrameDescription[]> => {
  const createDecoder = codec.createDecoder
  if (createDecoder === undefined) {
    throw unsupportedOperation(`Codec ${codec.format} does not expose a pixel decoder`)
  }
  const frameCount =
    codec.selection?.frames === true
      ? positiveSelectionCount(metadata.frames, `${codec.format} frame count`)
      : 1
  const levelCount =
    codec.selection?.resolutionLevels === true
      ? positiveSelectionCount(metadata.resolutionLevels, `${codec.format} resolution-level count`)
      : 1
  const selectionCount = BigInt(frameCount) * BigInt(levelCount)
  if (selectionCount > BigInt(limits.maxFrames)) {
    throw limitExceeded(
      `${codec.format} exposes ${selectionCount} frame/level selections; maxFrames is ${limits.maxFrames}`,
    )
  }

  const frames: FrameDescription[] = []
  for (let frame = 0; frame < frameCount; frame += 1) {
    const levels: LevelDescription[] = []
    let pixelFormat: CanonicalPixelFormat | undefined
    for (let level = 0; level < levelCount; level += 1) {
      throwIfAborted(signal)
      const decoder = await createDecoder(
        source,
        limits,
        decoderOptions(codec, frame, level, signal),
      )
      throwIfAborted(signal)
      const selectedFormat = inspectDecoder(decoder, codec, limits)
      if (pixelFormat !== undefined && selectedFormat !== pixelFormat) {
        throw unsupportedOperation(
          `Scientific codec adapter ${codec.format} frame ${frame} changes pixel format between resolution levels`,
        )
      }
      pixelFormat = selectedFormat
      levels.push(Object.freeze({ level, width: decoder.width, height: decoder.height }))
    }
    if (pixelFormat === undefined) throw invalidInput(`${codec.format} exposes no decodable levels`)
    frames.push(
      Object.freeze({
        frame,
        datasetId: frameCount === 1 ? 'image' : `frame-${frame}`,
        pixelFormat,
        levels: Object.freeze(levels),
      }),
    )
  }
  return Object.freeze(frames)
}

const scientificLevels = (frame: FrameDescription): readonly ScientificResolutionLevel[] =>
  Object.freeze(
    frame.levels.map(({ level, width, height }) =>
      Object.freeze({
        level,
        axisLengths: Object.freeze([
          Object.freeze({ axisId: 'x', length: width }),
          Object.freeze({ axisId: 'y', length: height }),
        ]),
      }),
    ),
  )

const datasetDescriptor = (
  codec: ImageCodec,
  metadata: ScientificMetadataObject,
  frame: FrameDescription,
): NormalizedScientificDatasetDescriptor => {
  const base = frame.levels[0]
  if (base === undefined) throw invalidInput(`${codec.format} exposes no base resolution level`)
  return normalizeScientificDatasetDescriptor({
    schemaVersion: 1,
    axes: [
      { id: 'x', name: 'X', kind: 'index', length: base.width, coordinates: { type: 'index' } },
      { id: 'y', name: 'Y', kind: 'index', length: base.height, coordinates: { type: 'index' } },
    ],
    sampleType: 'uint8',
    components: componentsFor(frame.pixelFormat),
    levels: scientificLevels(frame),
    metadata: normalizeScientificMetadataObject({
      'purejsimage:image-codec': {
        format: codec.format,
        frame: frame.frame,
        image: metadata,
      },
    }),
    capabilities: {
      regionReads: true,
      resolutionLevels: frame.levels.length > 1,
      planeReads: { kind: 'ordered-axis-pairs', pairs: [['x', 'y']] },
    },
  })
}

const validatePixelBlock = (
  block: PixelBlock,
  expectedFormat: CanonicalPixelFormat,
  request: ReturnType<typeof normalizeScientificPlaneReadRequest>,
): void => {
  const channels = rasterFormats[expectedFormat].channels
  if (block.format !== expectedFormat) {
    throw unsupportedOperation(
      `Scientific codec decoder changed pixel format from ${expectedFormat} to ${block.format}`,
    )
  }
  if (
    !Number.isSafeInteger(block.x) ||
    !Number.isSafeInteger(block.y) ||
    !Number.isSafeInteger(block.width) ||
    !Number.isSafeInteger(block.height) ||
    block.width < 1 ||
    block.height < 1 ||
    block.x < request.x ||
    block.y < request.y ||
    block.x + block.width > request.x + request.width ||
    block.y + block.height > request.y + request.height
  ) {
    throw invalidInput('Scientific codec decoder returned a block outside the requested region')
  }
  const rowBytes = block.width * channels
  const occupiedBytes = block.stride * (block.height - 1) + rowBytes
  if (
    !Number.isSafeInteger(block.stride) ||
    block.stride < rowBytes ||
    !Number.isSafeInteger(occupiedBytes) ||
    block.data.byteLength < occupiedBytes
  ) {
    throw invalidInput('Scientific codec decoder returned invalid block storage')
  }
}

class ImageCodecScientificDataset implements ScientificDataset {
  readonly descriptor: NormalizedScientificDatasetDescriptor
  readonly #codec: ImageCodec
  readonly #frame: FrameDescription
  readonly #limits: ImageLimits
  readonly #source: ImageSource

  constructor(options: {
    readonly codec: ImageCodec
    readonly descriptor: NormalizedScientificDatasetDescriptor
    readonly frame: FrameDescription
    readonly limits: ImageLimits
    readonly source: ImageSource
  }) {
    this.#codec = options.codec
    this.descriptor = options.descriptor
    this.#frame = options.frame
    this.#limits = options.limits
    this.#source = options.source
  }

  async *readPlane(request: Readonly<ScientificPlaneReadRequest>): AsyncIterable<RasterBlock> {
    const normalized = normalizeScientificPlaneReadRequest(this.descriptor, request)
    throwIfAborted(normalized.signal)
    const level = this.#frame.levels[normalized.resolutionLevel]
    if (level === undefined) {
      throw invalidInput(
        `Unknown ${this.#codec.format} resolution level ${normalized.resolutionLevel}`,
      )
    }
    const source = bindImageSourceSignal(this.#source, normalized.signal)
    const managed = isSessionManagedSource(source)
    let sessionEnded = !managed
    const endSession = async (suppressError: boolean): Promise<void> => {
      if (sessionEnded || !managed) return
      sessionEnded = true
      if (!suppressError) {
        await source[sourceSessionEnd]()
        return
      }
      try {
        await source[sourceSessionEnd]()
      } catch {
        // Preserve the decode error or iterator-return outcome.
      }
    }
    if (managed) source[sourceSessionStart]()
    try {
      const createDecoder = this.#codec.createDecoder
      if (createDecoder === undefined) {
        throw unsupportedOperation(`Codec ${this.#codec.format} does not expose a pixel decoder`)
      }
      const decoder = await createDecoder(
        source,
        this.#limits,
        decoderOptions(
          this.#codec,
          this.#frame.frame,
          normalized.resolutionLevel,
          normalized.signal,
        ),
      )
      throwIfAborted(normalized.signal)
      const format = inspectDecoder(decoder, this.#codec, this.#limits)
      if (
        decoder.width !== level.width ||
        decoder.height !== level.height ||
        format !== this.#frame.pixelFormat
      ) {
        throw invalidInput('Scientific codec decoder selection changed after document opening')
      }
      for await (const block of decoder.decode({
        x: normalized.x,
        y: normalized.y,
        width: normalized.width,
        height: normalized.height,
        ...(normalized.signal === undefined ? {} : { signal: normalized.signal }),
      })) {
        let transferred = false
        try {
          throwIfAborted(normalized.signal)
          validatePixelBlock(block, this.#frame.pixelFormat, normalized)
          const rasterBlock = Object.freeze({
            x: block.x,
            y: block.y,
            width: block.width,
            height: block.height,
            stride: block.stride,
            format: rasterFormats[this.#frame.pixelFormat],
            data: block.data,
            ...(block.release === undefined ? {} : { release: block.release }),
          })
          transferred = true
          yield rasterBlock
        } finally {
          if (!transferred) block.release?.()
        }
      }
      throwIfAborted(normalized.signal)
      await endSession(false)
    } catch (error: unknown) {
      await endSession(true)
      throw error
    } finally {
      await endSession(true)
    }
  }
}

const documentMetadata = (
  codec: ImageCodec,
  metadata: ImageMetadata,
  frames: readonly FrameDescription[],
): ScientificMetadataObject =>
  normalizeScientificMetadataObject({
    codec: {
      format: codec.format,
      mimeTypes: codec.mimeTypes,
    },
    image: metadata,
    selection: {
      frameRule:
        codec.selection?.frames === true
          ? 'one-dataset-per-selectable-frame'
          : 'single-dataset-first-decodable-image',
      resolutionRule:
        codec.selection?.resolutionLevels === true
          ? 'levels-within-each-frame-dataset'
          : 'base-level-only',
      datasets: frames.length,
    },
  })

const normalizedReaderDescriptor = (
  descriptor: ScientificReaderDescriptor,
): ScientificReaderDescriptor =>
  Object.freeze({
    ...descriptor,
    extensions: Object.freeze(descriptor.extensions.map((value) => value.toLowerCase())),
    mediaTypes: Object.freeze(descriptor.mediaTypes.map((value) => value.toLowerCase())),
    capabilities: normalizeScientificMetadataObject(descriptor.capabilities),
  })

/** Wrap one explicit ImageCodec as a low-confidence, uint8 ScientificReader fallback. */
export const createImageCodecScientificReader = (
  options: Readonly<ImageCodecScientificReaderOptions>,
): ScientificReader => {
  const descriptor = normalizedReaderDescriptor(options.descriptor)
  const codec = options.codec
  const limits = resolveLimits(options.limits)
  if (codec.createDecoder === undefined) {
    throw unsupportedOperation(`Codec ${codec.format} does not expose a pixel decoder`)
  }
  return Object.freeze({
    descriptor,
    async probe(context: Readonly<ScientificOpenContext>): Promise<ScientificProbeResult> {
      throwIfAborted(context.signal)
      if (context.primary.source.size < codec.minimumBytes) {
        return Object.freeze({ confidence: 0, reason: `${codec.format} header is too short` })
      }
      const header = await context.primary.source.read(0, codec.minimumBytes, {
        ...(context.signal === undefined ? {} : { signal: context.signal }),
      })
      throwIfAborted(context.signal)
      if (header.byteLength !== codec.minimumBytes || !codec.detect(header)) {
        return Object.freeze({ confidence: 0, reason: `${codec.format} detector did not match` })
      }
      const hinted = resourceHasHint(context.primary, descriptor.extensions, descriptor.mediaTypes)
      return Object.freeze({
        confidence: hinted ? 0.6 : 0.5,
        reason: hinted
          ? `${codec.format} detector and resource hint match`
          : `${codec.format} detector matches as a generic image fallback`,
      })
    },
    async open(context: Readonly<ScientificOpenContext>): Promise<ScientificDocument> {
      throwIfAborted(context.signal)
      validateInputSize(context.primary.source.size, limits)
      const metadata = await codec.metadata(context.primary.source, limits, {
        ...(context.signal === undefined ? {} : { signal: context.signal }),
      })
      throwIfAborted(context.signal)
      const frames = await describeFrames(
        context.primary.source,
        codec,
        metadata,
        limits,
        context.signal,
      )
      const normalizedMetadata = normalizeScientificMetadataObject(metadata)
      const summaries: ScientificDatasetSummary[] = []
      const datasets = new Map<string, ScientificDataset>()
      for (const frame of frames) {
        const identity = await createScientificDatasetIdentity({
          reader: descriptor,
          datasetId: frame.datasetId,
          resources: [context.primary],
        })
        const dataset = identifyScientificDataset(
          new ImageCodecScientificDataset({
            codec,
            descriptor: datasetDescriptor(codec, normalizedMetadata, frame),
            frame,
            limits,
            source: context.primary.source,
          }),
          identity,
        )
        datasets.set(frame.datasetId, dataset)
        summaries.push(
          Object.freeze({
            id: frame.datasetId,
            ...(frames.length === 1 ? {} : { name: `Frame ${frame.frame + 1}` }),
            descriptor: dataset.descriptor,
            identity,
          }),
        )
      }
      const metadataObject = documentMetadata(codec, metadata, frames)
      return Object.freeze({
        reader: Object.freeze({ id: descriptor.id, version: descriptor.version }),
        format: descriptor.format,
        metadata: metadataObject,
        datasets: Object.freeze(summaries),
        async openDataset(id: string, openOptions: Readonly<AbortOptions> = {}) {
          const signal = openOptions.signal ?? context.signal
          throwIfAborted(signal)
          const dataset = datasets.get(id)
          if (dataset === undefined)
            throw invalidInput(`Unknown ${descriptor.format} dataset ${id}`)
          return dataset
        },
      })
    },
  })
}
