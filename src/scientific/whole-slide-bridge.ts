import type { AbortOptions } from '../abort.ts'
import { throwIfAborted } from '../abort.ts'
import { invalidInput } from '../errors.ts'
import type { PixelBlock, PixelFormat } from '../pixel.ts'
import type { RasterBlock } from '../raster.ts'
import type {
  WholeSlideAssociatedImage,
  WholeSlideImage,
  WholeSlideImageMetadata,
} from '../pathology/whole-slide.ts'
import type {
  NormalizedScientificDatasetDescriptor,
  ScientificAxisDescriptor,
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
  ScientificDatasetIdentity,
  ScientificDocument,
  ScientificOpenContext,
  ScientificReaderDescriptor,
} from './reader.ts'
import { createScientificDatasetIdentity, identifyScientificDataset } from './reader.ts'

interface WholeSlideScientificBridgeOptions {
  readonly context: Readonly<ScientificOpenContext>
  readonly reader: ScientificReaderDescriptor
  readonly slide: WholeSlideImage
  readonly metadata?: ScientificMetadataObject
}

const componentsForFormat = (format: PixelFormat): readonly ScientificComponentDescriptor[] => {
  if (format === 'gray8') return Object.freeze([{ id: 'intensity', kind: 'intensity' }])
  if (format === 'rgb8') {
    return Object.freeze([
      Object.freeze({ id: 'red', name: 'Red', kind: 'red' }),
      Object.freeze({ id: 'green', name: 'Green', kind: 'green' }),
      Object.freeze({ id: 'blue', name: 'Blue', kind: 'blue' }),
    ])
  }
  if (format === 'rgba8') {
    return Object.freeze([
      ...componentsForFormat('rgb8'),
      Object.freeze({ id: 'alpha', name: 'Alpha', kind: 'alpha' }),
    ])
  }
  throw invalidInput(`Whole-slide scientific bridge cannot expose decoded ${format} samples`)
}

const channelsForFormat = (format: PixelFormat): number =>
  format === 'gray8' ? 1 : format === 'rgb8' ? 3 : format === 'rgba8' ? 4 : 0

const requiredFormat = (format: PixelFormat | undefined, label: string): PixelFormat => {
  if (format === undefined) throw invalidInput(`${label} does not declare its decoded format`)
  componentsForFormat(format)
  return format
}

const rasterBlock = (
  block: PixelBlock,
  expected: PixelFormat,
  offsetX: number,
  offsetY: number,
): RasterBlock => {
  if (block.format !== expected) {
    block.release?.()
    throw invalidInput(
      `Whole-slide decoder returned ${block.format}; descriptor declared ${expected}`,
    )
  }
  const channels = channelsForFormat(expected)
  if (channels === 0) {
    block.release?.()
    throw invalidInput(`Whole-slide decoded format ${expected} is unsupported`)
  }
  return Object.freeze({
    x: block.x + offsetX,
    y: block.y + offsetY,
    width: block.width,
    height: block.height,
    stride: block.stride,
    format: Object.freeze({ sampleType: 'uint8' as const, channels, planar: false }),
    data: block.data,
    ...(block.release === undefined ? {} : { release: block.release }),
  })
}

const imageMetadata = (metadata: WholeSlideImageMetadata): ScientificMetadataObject =>
  normalizeScientificMetadataObject({
    compression: metadata.compression,
    photometric: metadata.photometric,
    samplesPerPixel: metadata.samplesPerPixel,
    bitsPerSample: metadata.bitsPerSample,
    ...(metadata.iccProfile === undefined
      ? {}
      : {
          iccProfile: {
            present: true,
            byteLength: metadata.iccProfile.byteLength,
            tag: metadata.iccProfile.tag,
          },
        }),
  })

const validatePyramidFormats = (slide: WholeSlideImage, formatName: string): PixelFormat => {
  const format = requiredFormat(slide.format, `${formatName} pyramid`)
  for (const level of slide.levels) {
    const levelFormat = requiredFormat(level.format, `${formatName} pyramid level ${level.index}`)
    if (levelFormat !== format) {
      throw invalidInput(
        `${formatName} pyramid level ${level.index} declares ${levelFormat}; expected ${format}`,
      )
    }
  }
  return format
}

const axis = (
  id: 'x' | 'y',
  length: number,
  micronsPerPixel: number | undefined,
): ScientificAxisDescriptor =>
  Object.freeze({
    id,
    name: id === 'x' ? 'X' : 'Y',
    kind: 'space',
    length,
    ...(micronsPerPixel === undefined ? {} : { unit: 'µm' }),
    coordinates:
      micronsPerPixel === undefined
        ? Object.freeze({ type: 'index' as const })
        : Object.freeze({ type: 'linear' as const, origin: 0, step: micronsPerPixel }),
  })

const sourceMetadata = (context: Readonly<ScientificOpenContext>): ScientificMetadataObject =>
  normalizeScientificMetadataObject({
    id: context.primary.id,
    size: context.primary.source.size,
    ...(context.primary.name === undefined ? {} : { name: context.primary.name }),
    ...(context.primary.mediaType === undefined ? {} : { mediaType: context.primary.mediaType }),
  })

const pyramidDescriptor = (
  slide: WholeSlideImage,
  formatName: string,
  metadata: ScientificMetadataObject | undefined,
  source: ScientificMetadataObject,
): NormalizedScientificDatasetDescriptor => {
  const axes = Object.freeze([
    axis('x', slide.width, slide.micronsPerPixel),
    axis('y', slide.height, slide.micronsPerPixel),
  ])
  const levels: readonly ScientificResolutionLevel[] = Object.freeze(
    slide.levels.map((level) =>
      Object.freeze({
        level: level.index,
        axisLengths: Object.freeze([
          Object.freeze({ axisId: 'x', length: level.width }),
          Object.freeze({ axisId: 'y', length: level.height }),
        ]),
        ...(slide.micronsPerPixel === undefined
          ? {}
          : {
              axisCoordinates: Object.freeze([
                Object.freeze({
                  axisId: 'x',
                  coordinates: Object.freeze({
                    type: 'linear' as const,
                    origin: 0,
                    step: slide.micronsPerPixel * (level.downsampleX ?? level.downsample),
                  }),
                }),
                Object.freeze({
                  axisId: 'y',
                  coordinates: Object.freeze({
                    type: 'linear' as const,
                    origin: 0,
                    step: slide.micronsPerPixel * (level.downsampleY ?? level.downsample),
                  }),
                }),
              ]),
            }),
      }),
    ),
  )
  return normalizeScientificDatasetDescriptor({
    schemaVersion: 1,
    axes,
    sampleType: 'uint8',
    components: componentsForFormat(requiredFormat(slide.format, `${formatName} pyramid`)),
    levels,
    metadata: {
      format: formatName,
      source,
      ...(metadata ?? {}),
      ...(slide.micronsPerPixel === undefined ? {} : { micronsPerPixel: slide.micronsPerPixel }),
      ...(slide.objectivePower === undefined ? {} : { objectivePower: slide.objectivePower }),
      levels: slide.levels.map((level) => ({
        level: level.index,
        width: level.width,
        height: level.height,
        downsampleX: level.downsampleX ?? level.downsample,
        downsampleY: level.downsampleY ?? level.downsample,
        ...(level.metadata === undefined ? {} : { tiff: imageMetadata(level.metadata) }),
      })),
    },
    capabilities: {
      regionReads: true,
      resolutionLevels: levels.length > 1,
      planeReads: { kind: 'ordered-axis-pairs', pairs: [['x', 'y']] },
    },
  })
}

class WholeSlidePyramidDataset implements ScientificDataset {
  readonly descriptor: NormalizedScientificDatasetDescriptor
  readonly #slide: WholeSlideImage
  readonly #format: PixelFormat

  constructor(
    slide: WholeSlideImage,
    formatName: string,
    metadata: ScientificMetadataObject | undefined,
    source: ScientificMetadataObject,
  ) {
    this.#slide = slide
    this.#format = requiredFormat(slide.format, `${formatName} pyramid`)
    this.descriptor = pyramidDescriptor(slide, formatName, metadata, source)
  }

  async *readPlane(request: Readonly<ScientificPlaneReadRequest>): AsyncGenerator<RasterBlock> {
    const normalized = normalizeScientificPlaneReadRequest(this.descriptor, request)
    for await (const block of this.#slide.readRegion({
      level: normalized.resolutionLevel,
      x: normalized.x,
      y: normalized.y,
      width: normalized.width,
      height: normalized.height,
      ...(normalized.signal === undefined ? {} : { signal: normalized.signal }),
    })) {
      yield rasterBlock(block, this.#format, normalized.x, normalized.y)
    }
  }
}

const associatedDescriptor = (
  image: WholeSlideAssociatedImage,
  formatName: string,
  source: ScientificMetadataObject,
): NormalizedScientificDatasetDescriptor =>
  normalizeScientificDatasetDescriptor({
    schemaVersion: 1,
    axes: [axis('x', image.width, undefined), axis('y', image.height, undefined)],
    sampleType: 'uint8',
    components: componentsForFormat(requiredFormat(image.format, `${formatName} associated image`)),
    metadata: {
      format: `${formatName} associated image`,
      source,
      associatedImage: { id: image.id, label: image.label },
      ...(image.metadata === undefined ? {} : { tiff: imageMetadata(image.metadata) }),
    },
    capabilities: {
      regionReads: true,
      resolutionLevels: false,
      planeReads: { kind: 'ordered-axis-pairs', pairs: [['x', 'y']] },
    },
  })

class WholeSlideAssociatedDataset implements ScientificDataset {
  readonly descriptor: NormalizedScientificDatasetDescriptor
  readonly #image: WholeSlideAssociatedImage
  readonly #format: PixelFormat

  constructor(
    image: WholeSlideAssociatedImage,
    formatName: string,
    source: ScientificMetadataObject,
  ) {
    this.#image = image
    this.#format = requiredFormat(image.format, `${formatName} associated image`)
    this.descriptor = associatedDescriptor(image, formatName, source)
  }

  async *readPlane(request: Readonly<ScientificPlaneReadRequest>): AsyncGenerator<RasterBlock> {
    const normalized = normalizeScientificPlaneReadRequest(this.descriptor, request)
    for await (const block of this.#image.read({
      x: normalized.x,
      y: normalized.y,
      width: normalized.width,
      height: normalized.height,
      ...(normalized.signal === undefined ? {} : { signal: normalized.signal }),
    })) {
      yield rasterBlock(block, this.#format, normalized.x, normalized.y)
    }
  }
}

interface IdentifiedDataset {
  readonly id: string
  readonly name: string
  readonly dataset: ScientificDataset
  readonly identity: ScientificDatasetIdentity
}

/** Internal generic bridge used by concrete whole-slide scientific readers. */
export const createWholeSlideScientificDocument = async (
  options: Readonly<WholeSlideScientificBridgeOptions>,
): Promise<ScientificDocument> => {
  const { context, reader, slide } = options
  validatePyramidFormats(slide, reader.format)
  const source = sourceMetadata(context)
  const candidates = [
    {
      id: 'pyramid',
      name: 'Pyramid',
      dataset: new WholeSlidePyramidDataset(slide, reader.format, options.metadata, source),
    },
    ...slide.associatedImages.map((image) => ({
      id: `associated/${image.id}`,
      name: image.label,
      dataset: new WholeSlideAssociatedDataset(image, reader.format, source),
    })),
  ]
  const identified: IdentifiedDataset[] = []
  for (const candidate of candidates) {
    const identity = await createScientificDatasetIdentity({
      reader,
      datasetId: candidate.id,
      resources: [context.primary],
    })
    identified.push(
      Object.freeze({
        ...candidate,
        identity,
        dataset: identifyScientificDataset(candidate.dataset, identity),
      }),
    )
  }
  const metadata = normalizeScientificMetadataObject({
    format: reader.format,
    source,
    ...(options.metadata ?? {}),
    width: slide.width,
    height: slide.height,
    levelCount: slide.levels.length,
    associatedImageCount: slide.associatedImages.length,
    ...(slide.micronsPerPixel === undefined ? {} : { micronsPerPixel: slide.micronsPerPixel }),
    ...(slide.objectivePower === undefined ? {} : { objectivePower: slide.objectivePower }),
  })
  return Object.freeze({
    reader: Object.freeze({ id: reader.id, version: reader.version }),
    format: reader.format,
    metadata,
    datasets: Object.freeze(
      identified.map((entry) =>
        Object.freeze({
          id: entry.id,
          name: entry.name,
          descriptor: entry.dataset.descriptor,
          identity: entry.identity,
        }),
      ),
    ),
    async openDataset(id: string, openOptions: Readonly<AbortOptions> = {}) {
      throwIfAborted(openOptions.signal ?? context.signal)
      const found = identified.find((entry) => entry.id === id)
      if (found === undefined) throw invalidInput(`Unknown ${reader.format} dataset ${id}`)
      return found.dataset
    },
  })
}
