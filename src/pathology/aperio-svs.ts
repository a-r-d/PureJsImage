import type { AbortOptions } from '../abort.ts'
import { throwIfAborted } from '../abort.ts'
import { invalidInput, limitExceeded } from '../errors.ts'
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

export interface AperioSvsLimits {
  readonly maxSourceBytes: number
  readonly maxWidth: number
  readonly maxHeight: number
  readonly maxDirectories: number
  readonly maxRegionPixels: number
  readonly maxRegionDecodedBytes: number
  readonly maxAssociatedImagePixels: number
}

export interface AperioSvsOptions extends AbortOptions {
  readonly limits?: Partial<AperioSvsLimits>
}

export const defaultAperioSvsLimits: Readonly<AperioSvsLimits> = Object.freeze({
  maxSourceBytes: 4_398_046_511_104,
  maxWidth: 1_000_000,
  maxHeight: 1_000_000,
  maxDirectories: 4_096,
  maxRegionPixels: 16_777_216,
  maxRegionDecodedBytes: 268_435_456,
  maxAssociatedImagePixels: 67_108_864,
})

const positiveLimit = (name: keyof AperioSvsLimits, value: number): number => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw invalidInput(`${name} must be a positive safe integer`)
  }
  return value
}

export const resolveAperioSvsLimits = (
  limits: Partial<AperioSvsLimits> = {},
): Readonly<AperioSvsLimits> =>
  Object.freeze({
    maxSourceBytes: positiveLimit(
      'maxSourceBytes',
      limits.maxSourceBytes ?? defaultAperioSvsLimits.maxSourceBytes,
    ),
    maxWidth: positiveLimit('maxWidth', limits.maxWidth ?? defaultAperioSvsLimits.maxWidth),
    maxHeight: positiveLimit('maxHeight', limits.maxHeight ?? defaultAperioSvsLimits.maxHeight),
    maxDirectories: positiveLimit(
      'maxDirectories',
      limits.maxDirectories ?? defaultAperioSvsLimits.maxDirectories,
    ),
    maxRegionPixels: positiveLimit(
      'maxRegionPixels',
      limits.maxRegionPixels ?? defaultAperioSvsLimits.maxRegionPixels,
    ),
    maxRegionDecodedBytes: positiveLimit(
      'maxRegionDecodedBytes',
      limits.maxRegionDecodedBytes ?? defaultAperioSvsLimits.maxRegionDecodedBytes,
    ),
    maxAssociatedImagePixels: positiveLimit(
      'maxAssociatedImagePixels',
      limits.maxAssociatedImagePixels ?? defaultAperioSvsLimits.maxAssociatedImagePixels,
    ),
  })

const decodedFormat = (directory: TiffDirectory): PixelFormat => {
  if (directory.bitsPerSample.some((bits) => bits !== 8)) {
    throw invalidInput('Aperio whole-slide display reads require 8-bit decoded samples')
  }
  if (directory.samplesPerPixel === 1) return 'gray8'
  if (directory.samplesPerPixel === 3) return 'rgb8'
  if (directory.samplesPerPixel === 4) return 'rgba8'
  throw invalidInput('Aperio whole-slide display sample count is unsupported')
}

const imageMetadata = (directory: TiffDirectory) => {
  const icc = directory.getTagInfo?.(34675)
  if (icc !== undefined && icc.fieldType !== 7) {
    throw invalidInput('Aperio TIFF ICC profile must use the UNDEFINED field type')
  }
  return Object.freeze({
    compression: directory.compression,
    photometric: directory.photometric,
    samplesPerPixel: directory.samplesPerPixel,
    bitsPerSample: Object.freeze([...directory.bitsPerSample]),
    ...(icc === undefined
      ? {}
      : {
          iccProfile: Object.freeze({
            present: true as const,
            byteLength: icc.byteLength,
            tag: 34675 as const,
          }),
        }),
  })
}

const checkedPixels = (width: number, height: number, label: string): number => {
  const pixels = width * height
  if (!Number.isSafeInteger(pixels)) throw limitExceeded(`${label} pixel count exceeds safe limits`)
  return pixels
}

const validateRead = (
  request: Readonly<{ x: number; y: number; width: number; height: number }>,
  image: Readonly<{ width: number; height: number; format: PixelFormat }>,
  limits: Readonly<AperioSvsLimits>,
  maximumPixels: number,
  label: string,
): void => {
  if (
    !Number.isSafeInteger(request.x) ||
    !Number.isSafeInteger(request.y) ||
    request.x < 0 ||
    request.y < 0
  ) {
    throw invalidInput(`${label} coordinates must be non-negative safe integers`)
  }
  if (
    !Number.isSafeInteger(request.width) ||
    !Number.isSafeInteger(request.height) ||
    request.width < 1 ||
    request.height < 1
  ) {
    throw invalidInput(`${label} dimensions must be positive safe integers`)
  }
  const endX = request.x + request.width
  const endY = request.y + request.height
  if (
    !Number.isSafeInteger(endX) ||
    !Number.isSafeInteger(endY) ||
    endX > image.width ||
    endY > image.height
  ) {
    throw invalidInput(`${label} is outside the image bounds`)
  }
  const pixels = checkedPixels(request.width, request.height, label)
  if (pixels > maximumPixels) {
    throw limitExceeded(`${label} has ${pixels} pixels; configured maximum is ${maximumPixels}`)
  }
  const decodedBytes = checkedPixels(
    pixels,
    decodedFormatComponents(image.format),
    `${label} decoded`,
  )
  if (decodedBytes > limits.maxRegionDecodedBytes) {
    throw limitExceeded(
      `${label} needs ${decodedBytes} decoded bytes; maxRegionDecodedBytes is ${limits.maxRegionDecodedBytes}`,
    )
  }
}

const decodedFormatComponents = (format: PixelFormat): number =>
  format === 'gray8' ? 1 : format === 'rgb8' ? 3 : format === 'rgba8' ? 4 : 0

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
  readonly #limits: Readonly<AperioSvsLimits>

  constructor(
    id: string,
    label: string,
    directory: TiffDirectory,
    metadata: Awaited<ReturnType<typeof imageMetadata>>,
    limits: Readonly<AperioSvsLimits>,
  ) {
    this.id = id
    this.label = label
    this.width = directory.width
    this.height = directory.height
    this.format = decodedFormat(directory)
    this.metadata = metadata
    this.#directory = directory
    this.#limits = limits
  }

  async *read(
    options: Readonly<WholeSlideAssociatedImageRequest> = {},
  ): AsyncGenerator<PixelBlock> {
    throwIfAborted(options.signal)
    const request = {
      x: options.x ?? 0,
      y: options.y ?? 0,
      width: options.width ?? this.width - (options.x ?? 0),
      height: options.height ?? this.height - (options.y ?? 0),
    }
    validateRead(
      request,
      this,
      this.#limits,
      this.#limits.maxAssociatedImagePixels,
      'Associated-image read',
    )
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
  readonly #limits: Readonly<AperioSvsLimits>

  constructor(
    index: number,
    baseWidth: number,
    baseHeight: number,
    directory: TiffDirectory,
    metadata: Awaited<ReturnType<typeof imageMetadata>>,
    limits: Readonly<AperioSvsLimits>,
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
    this.#limits = limits
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
    const request = {
      x,
      y,
      width: Math.min(this.tileWidth, this.width - x),
      height: Math.min(this.tileHeight, this.height - y),
    }
    validateRead(request, this, this.#limits, this.#limits.maxRegionPixels, 'Whole-slide tile')
    const decoder = await this.#directory.createImageDecoder(options)
    yield* decoder.decode({
      ...request,
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
  readonly #limits: Readonly<AperioSvsLimits>

  constructor(options: {
    readonly levelDirectories: readonly TiffDirectory[]
    readonly levelMetadata: readonly Awaited<ReturnType<typeof imageMetadata>>[]
    readonly associatedImages: readonly WholeSlideAssociatedImage[]
    readonly properties: Readonly<Record<string, string>>
    readonly limits: Readonly<AperioSvsLimits>
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
        return new AperioWholeSlideLevel(
          index,
          this.width,
          this.height,
          directory,
          metadata,
          options.limits,
        )
      }),
    )
    this.associatedImages = Object.freeze([...options.associatedImages])
    this.properties = options.properties
    this.#limits = options.limits
    const micronsPerPixel = positiveProperty(this.properties, 'aperio.MPP')
    const objectivePower = positiveProperty(this.properties, 'aperio.AppMag')
    if (micronsPerPixel !== undefined) this.micronsPerPixel = micronsPerPixel
    if (objectivePower !== undefined) this.objectivePower = objectivePower
  }

  async *readRegion(options: Readonly<WholeSlideRegionRequest>): AsyncGenerator<PixelBlock> {
    throwIfAborted(options.signal)
    if (!Number.isSafeInteger(options.level) || options.level < 0) {
      throw invalidInput('Whole-slide level must be a non-negative safe integer')
    }
    const directory = this.#levelDirectories[options.level]
    if (!directory) throw invalidInput(`Whole-slide level ${options.level} is unavailable`)
    const level = this.levels[options.level]
    if (level === undefined || level.format === undefined) {
      throw invalidInput(`Whole-slide level ${options.level} is unavailable`)
    }
    validateRead(
      options,
      { width: level.width, height: level.height, format: level.format },
      this.#limits,
      this.#limits.maxRegionPixels,
      'Whole-slide region',
    )
    const decoder = await directory.createImageDecoder(options)
    if (
      directory.tiled &&
      directory.tileWidth !== undefined &&
      directory.tileHeight !== undefined
    ) {
      const firstTileX = Math.floor(options.x / directory.tileWidth)
      const lastTileX = Math.floor((options.x + options.width - 1) / directory.tileWidth)
      const firstTileY = Math.floor(options.y / directory.tileHeight)
      const lastTileY = Math.floor((options.y + options.height - 1) / directory.tileHeight)
      for (let tileY = firstTileY; tileY <= lastTileY; tileY += 1) {
        for (let tileX = firstTileX; tileX <= lastTileX; tileX += 1) {
          throwIfAborted(options.signal)
          const nativeX = tileX * directory.tileWidth
          const nativeY = tileY * directory.tileHeight
          const x = Math.max(options.x, nativeX)
          const y = Math.max(options.y, nativeY)
          const right = Math.min(options.x + options.width, nativeX + directory.tileWidth)
          const bottom = Math.min(options.y + options.height, nativeY + directory.tileHeight)
          for await (const block of decoder.decode({
            x,
            y,
            width: right - x,
            height: bottom - y,
            ...(options.signal === undefined ? {} : { signal: options.signal }),
          })) {
            yield {
              ...block,
              x: x - options.x + block.x,
              y: y - options.y + block.y,
            }
          }
        }
      }
      return
    }
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
  options: Readonly<AperioSvsOptions> = {},
): Promise<WholeSlideImage> => {
  throwIfAborted(options.signal)
  const limits = resolveAperioSvsLimits(options.limits)
  if (document.directories.length > limits.maxDirectories) {
    throw limitExceeded(
      `Aperio SVS has ${document.directories.length} directories; maxDirectories is ${limits.maxDirectories}`,
    )
  }
  for (const directory of document.directories) {
    if (directory.width > limits.maxWidth || directory.height > limits.maxHeight) {
      throw limitExceeded(
        `Aperio directory ${directory.width}x${directory.height} exceeds configured dimensions`,
      )
    }
  }
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
      new AperioAssociatedImage(id, label, directory, imageMetadata(directory), limits),
    )
  }
  const levelMetadata: Awaited<ReturnType<typeof imageMetadata>>[] = []
  for (const directory of levelDirectories) {
    levelMetadata.push(imageMetadata(directory))
  }
  return new AperioWholeSlideImage({
    levelDirectories,
    levelMetadata,
    associatedImages,
    properties: aperioProperties(mainDescription),
    limits,
  })
}

export const aperioSvsProfile: TiffProfile<WholeSlideImage> = Object.freeze({
  id: 'aperio-svs',
  priority: 90,
  detect: ({ document }: Readonly<TiffProfileContext>) => isAperioSvs(document),
  open: ({ document }: Readonly<TiffProfileContext>) => openAperioSvs(document),
})
