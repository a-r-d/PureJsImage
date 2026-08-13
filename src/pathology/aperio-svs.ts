import type { AbortOptions } from '../abort.ts'
import { throwIfAborted } from '../abort.ts'
import { invalidInput } from '../errors.ts'
import { MAX_ICC_PROFILE_BYTES } from '../codecs/icc.ts'
import type { PixelBlock } from '../pixel.ts'
import type { PixelFormat } from '../pixel.ts'
import type { TiffProfile, TiffProfileContext } from '../tiff/profiles.ts'
import type { TiffDirectory, TiffDocument } from '../tiff/types.ts'
import type {
  WholeSlideAssociatedImage,
  WholeSlideAssociatedImageRequest,
  WholeSlideImage,
  WholeSlideLevel,
  WholeSlideRegionRequest,
} from './whole-slide.ts'

const decodedFormat = (directory: TiffDirectory): PixelFormat => {
  if (directory.bitsPerSample.some((bits) => bits !== 8)) {
    throw invalidInput('Aperio whole-slide display reads require 8-bit decoded samples')
  }
  if (directory.samplesPerPixel === 1) return 'gray8'
  if (directory.samplesPerPixel === 3) return 'rgb8'
  if (directory.samplesPerPixel === 4) return 'rgba8'
  throw invalidInput('Aperio whole-slide display sample count is unsupported')
}

const imageMetadata = async (directory: TiffDirectory, options: Readonly<AbortOptions>) => {
  const icc = await directory.getTag(34675, {
    maxBytes: MAX_ICC_PROFILE_BYTES,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
  if (icc !== undefined && icc.kind !== 'bytes') {
    throw invalidInput('Aperio TIFF ICC profile must use the UNDEFINED field type')
  }
  return Object.freeze({
    compression: directory.compression,
    photometric: directory.photometric,
    samplesPerPixel: directory.samplesPerPixel,
    bitsPerSample: Object.freeze([...directory.bitsPerSample]),
    ...(icc === undefined ? {} : { iccProfile: icc.value }),
  })
}

const imageDescriptionTag = 270

const directoryDescription = async (
  directory: TiffDirectory,
  options: Readonly<AbortOptions> = {},
): Promise<string> => {
  const value = await directory.getTag(imageDescriptionTag, {
    maxBytes: 1_048_576,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
  return value?.kind === 'ascii' ? value.value : ''
}

const aperioProperties = (description: string): Readonly<Record<string, string>> => {
  const properties: Record<string, string> = {}
  const fields = description.split('|')
  const header = fields.shift()?.trim()
  if (header) properties['aperio.Header'] = header
  for (const field of fields) {
    const separator = field.indexOf('=')
    if (separator < 1) continue
    const name = field.slice(0, separator).trim()
    const value = field.slice(separator + 1).trim()
    if (name.length !== 0 && value.length !== 0) properties[`aperio.${name}`] = value
  }
  return Object.freeze(properties)
}

const positiveProperty = (
  properties: Readonly<Record<string, string>>,
  name: string,
): number | undefined => {
  const raw = properties[name]
  if (raw === undefined) return undefined
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : undefined
}

const associatedLabel = (description: string, tiled: boolean): string | undefined => {
  const normalized = description.toLowerCase()
  if (/\b(?:label|barcode)\b/.test(normalized)) return 'label'
  if (/\bmacro\b/.test(normalized)) return 'macro'
  if (/\bthumbnail\b/.test(normalized) || !tiled) return 'thumbnail'
  return undefined
}

const compatibleAspectRatio = (main: TiffDirectory, candidate: TiffDirectory): boolean => {
  const widthScale = main.width / candidate.width
  const heightScale = main.height / candidate.height
  return (
    widthScale > 1 && heightScale > 1 && Math.abs(widthScale - heightScale) / widthScale <= 0.05
  )
}

class AperioAssociatedImage implements WholeSlideAssociatedImage {
  readonly id: string
  readonly label: string
  readonly width: number
  readonly height: number
  readonly format: PixelFormat
  readonly metadata: Awaited<ReturnType<typeof imageMetadata>>
  readonly #directory: TiffDirectory

  constructor(
    id: string,
    label: string,
    directory: TiffDirectory,
    metadata: Awaited<ReturnType<typeof imageMetadata>>,
  ) {
    this.id = id
    this.label = label
    this.width = directory.width
    this.height = directory.height
    this.format = decodedFormat(directory)
    this.metadata = metadata
    this.#directory = directory
  }

  async *read(
    options: Readonly<WholeSlideAssociatedImageRequest> = {},
  ): AsyncGenerator<PixelBlock> {
    const decoder = await this.#directory.createImageDecoder(options)
    yield* decoder.decode({
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      ...(options.x === undefined ? {} : { x: options.x }),
      ...(options.y === undefined ? {} : { y: options.y }),
      ...(options.width === undefined ? {} : { width: options.width }),
      ...(options.height === undefined ? {} : { height: options.height }),
    })
  }
}
class AperioWholeSlideLevel implements WholeSlideLevel {
  readonly index: number
  readonly width: number
  readonly height: number
  readonly downsample: number
  readonly downsampleX: number
  readonly downsampleY: number
  readonly format: PixelFormat
  readonly metadata: Awaited<ReturnType<typeof imageMetadata>>
  readonly tileWidth?: number
  readonly tileHeight?: number
  readonly #directory: TiffDirectory

  constructor(
    index: number,
    baseWidth: number,
    baseHeight: number,
    directory: TiffDirectory,
    metadata: Awaited<ReturnType<typeof imageMetadata>>,
  ) {
    this.index = index
    this.width = directory.width
    this.height = directory.height
    this.downsample = baseWidth / directory.width
    this.downsampleX = baseWidth / directory.width
    this.downsampleY = baseHeight / directory.height
    this.format = decodedFormat(directory)
    this.metadata = metadata
    this.#directory = directory
    if (directory.tileWidth !== undefined) this.tileWidth = directory.tileWidth
    if (directory.tileHeight !== undefined) this.tileHeight = directory.tileHeight
  }

  async *tile(
    column: number,
    row: number,
    options: Readonly<AbortOptions> = {},
  ): AsyncGenerator<PixelBlock> {
    throwIfAborted(options.signal)
    if (!Number.isSafeInteger(column) || column < 0) {
      throw invalidInput('Whole-slide tile column must be a non-negative safe integer')
    }
    if (!Number.isSafeInteger(row) || row < 0) {
      throw invalidInput('Whole-slide tile row must be a non-negative safe integer')
    }
    if (this.tileWidth === undefined || this.tileHeight === undefined) {
      throw invalidInput(`Whole-slide level ${this.index} does not have native tiles`)
    }
    const x = column * this.tileWidth
    const y = row * this.tileHeight
    if (
      !Number.isSafeInteger(x) ||
      !Number.isSafeInteger(y) ||
      x >= this.width ||
      y >= this.height
    ) {
      throw invalidInput(`Whole-slide tile ${column},${row} is outside level ${this.index}`)
    }
    const decoder = await this.#directory.createImageDecoder(options)
    yield* decoder.decode({
      x,
      y,
      width: Math.min(this.tileWidth, this.width - x),
      height: Math.min(this.tileHeight, this.height - y),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
  }
}

class AperioWholeSlideImage implements WholeSlideImage {
  readonly width: number
  readonly height: number
  readonly levels: readonly WholeSlideLevel[]
  readonly associatedImages: readonly WholeSlideAssociatedImage[]
  readonly properties: Readonly<Record<string, string>>
  readonly micronsPerPixel?: number
  readonly objectivePower?: number
  readonly format: PixelFormat
  readonly #levelDirectories: readonly TiffDirectory[]

  constructor(options: {
    readonly levelDirectories: readonly TiffDirectory[]
    readonly levelMetadata: readonly Awaited<ReturnType<typeof imageMetadata>>[]
    readonly associatedImages: readonly WholeSlideAssociatedImage[]
    readonly properties: Readonly<Record<string, string>>
  }) {
    const first = options.levelDirectories[0]
    if (!first) throw invalidInput('Aperio SVS has no pyramid image')
    this.width = first.width
    this.height = first.height
    this.format = decodedFormat(first)
    this.#levelDirectories = Object.freeze([...options.levelDirectories])
    this.levels = Object.freeze(
      options.levelDirectories.map((directory, index) => {
        const metadata = options.levelMetadata[index]
        if (metadata === undefined) throw invalidInput('Aperio level metadata is unavailable')
        return new AperioWholeSlideLevel(index, this.width, this.height, directory, metadata)
      }),
    )
    this.associatedImages = Object.freeze([...options.associatedImages])
    this.properties = options.properties
    const micronsPerPixel = positiveProperty(this.properties, 'aperio.MPP')
    const objectivePower = positiveProperty(this.properties, 'aperio.AppMag')
    if (micronsPerPixel !== undefined) this.micronsPerPixel = micronsPerPixel
    if (objectivePower !== undefined) this.objectivePower = objectivePower
  }

  async *readRegion(options: Readonly<WholeSlideRegionRequest>): AsyncGenerator<PixelBlock> {
    if (!Number.isSafeInteger(options.level) || options.level < 0) {
      throw invalidInput('Whole-slide level must be a non-negative safe integer')
    }
    const directory = this.#levelDirectories[options.level]
    if (!directory) throw invalidInput(`Whole-slide level ${options.level} is unavailable`)
    const decoder = await directory.createImageDecoder(options)
    yield* decoder.decode({
      x: options.x,
      y: options.y,
      width: options.width,
      height: options.height,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
  }
}

export const isAperioSvs = async (
  document: TiffDocument,
  options: Readonly<AbortOptions> = {},
): Promise<boolean> => {
  throwIfAborted(options.signal)
  const first = document.topLevelDirectories[0]
  if (!first) return false
  return /^Aperio\b/i.test((await directoryDescription(first, options)).trimStart())
}

export const openAperioSvs = async (
  document: TiffDocument,
  options: Readonly<AbortOptions> = {},
): Promise<WholeSlideImage> => {
  throwIfAborted(options.signal)
  const main = document.topLevelDirectories[0]
  if (!main) throw invalidInput('Aperio SVS has no TIFF directories')
  const mainDescription = await directoryDescription(main, options)
  if (!/^Aperio\b/i.test(mainDescription.trimStart())) {
    throw invalidInput('TIFF ImageDescription is not an Aperio SVS header')
  }
  const levelDirectories: TiffDirectory[] = [main]
  const associatedCandidates: {
    readonly directory: TiffDirectory
    readonly label: string
  }[] = []
  for (const directory of document.topLevelDirectories.slice(1)) {
    throwIfAborted(options.signal)
    const description = await directoryDescription(directory, options)
    const label = associatedLabel(description, directory.tiled)
    if (label !== undefined || !compatibleAspectRatio(main, directory)) {
      associatedCandidates.push({ directory, label: label ?? 'associated' })
    } else {
      levelDirectories.push(directory)
    }
  }
  levelDirectories.sort((left, right) => right.width * right.height - left.width * left.height)
  for (let index = 1; index < levelDirectories.length; index += 1) {
    const previous = levelDirectories[index - 1]
    const current = levelDirectories[index]
    if (
      !previous ||
      !current ||
      current.width >= previous.width ||
      current.height >= previous.height
    ) {
      throw invalidInput('Aperio pyramid levels are not strictly reduced')
    }
  }
  const labelCounts = new Map<string, number>()
  const associatedImages: WholeSlideAssociatedImage[] = []
  for (const { directory, label } of associatedCandidates) {
    const count = (labelCounts.get(label) ?? 0) + 1
    labelCounts.set(label, count)
    const id = count === 1 ? label : `${label}-${count}`
    associatedImages.push(
      new AperioAssociatedImage(id, label, directory, await imageMetadata(directory, options)),
    )
  }
  const levelMetadata: Awaited<ReturnType<typeof imageMetadata>>[] = []
  for (const directory of levelDirectories) {
    levelMetadata.push(await imageMetadata(directory, options))
  }
  return new AperioWholeSlideImage({
    levelDirectories,
    levelMetadata,
    associatedImages,
    properties: aperioProperties(mainDescription),
  })
}

export const aperioSvsProfile: TiffProfile<WholeSlideImage> = Object.freeze({
  id: 'aperio-svs',
  priority: 90,
  detect: ({ document }: Readonly<TiffProfileContext>) => isAperioSvs(document),
  open: ({ document }: Readonly<TiffProfileContext>) => openAperioSvs(document),
})
