import { invalidInput } from '../errors.ts'
import type { PixelBlock } from '../pixel.ts'
import type { TiffProfile, TiffProfileContext } from '../tiff/profiles.ts'
import type { TiffDirectory, TiffDocument } from '../tiff/types.ts'
import type {
  WholeSlideAssociatedImage,
  WholeSlideAssociatedImageRequest,
  WholeSlideImage,
  WholeSlideLevel,
  WholeSlideRegionRequest,
} from './whole-slide.ts'

const imageDescriptionTag = 270

const directoryDescription = async (directory: TiffDirectory): Promise<string> => {
  const value = await directory.getTag(imageDescriptionTag, { maxBytes: 1_048_576 })
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
  readonly #directory: TiffDirectory

  constructor(id: string, label: string, directory: TiffDirectory) {
    this.id = id
    this.label = label
    this.width = directory.width
    this.height = directory.height
    this.#directory = directory
  }

  async *read(
    options: Readonly<WholeSlideAssociatedImageRequest> = {},
  ): AsyncGenerator<PixelBlock> {
    const decoder = await this.#directory.createImageDecoder()
    yield* decoder.decode({
      ...(options.x === undefined ? {} : { x: options.x }),
      ...(options.y === undefined ? {} : { y: options.y }),
      ...(options.width === undefined ? {} : { width: options.width }),
      ...(options.height === undefined ? {} : { height: options.height }),
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
  readonly #levelDirectories: readonly TiffDirectory[]

  constructor(options: {
    readonly levelDirectories: readonly TiffDirectory[]
    readonly associatedImages: readonly WholeSlideAssociatedImage[]
    readonly properties: Readonly<Record<string, string>>
  }) {
    const first = options.levelDirectories[0]
    if (!first) throw invalidInput('Aperio SVS has no pyramid image')
    this.width = first.width
    this.height = first.height
    this.#levelDirectories = Object.freeze([...options.levelDirectories])
    this.levels = Object.freeze(
      options.levelDirectories.map((directory, index) =>
        Object.freeze({
          index,
          width: directory.width,
          height: directory.height,
          downsample: this.width / directory.width,
          ...(directory.tileWidth === undefined ? {} : { tileWidth: directory.tileWidth }),
          ...(directory.tileHeight === undefined ? {} : { tileHeight: directory.tileHeight }),
        }),
      ),
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
    const decoder = await directory.createImageDecoder()
    yield* decoder.decode({
      x: options.x,
      y: options.y,
      width: options.width,
      height: options.height,
    })
  }
}

export const isAperioSvs = async (document: TiffDocument): Promise<boolean> => {
  const first = document.topLevelDirectories[0]
  if (!first) return false
  return /^Aperio\b/i.test((await directoryDescription(first)).trimStart())
}

export const openAperioSvs = async (document: TiffDocument): Promise<WholeSlideImage> => {
  const main = document.topLevelDirectories[0]
  if (!main) throw invalidInput('Aperio SVS has no TIFF directories')
  const mainDescription = await directoryDescription(main)
  if (!/^Aperio\b/i.test(mainDescription.trimStart())) {
    throw invalidInput('TIFF ImageDescription is not an Aperio SVS header')
  }
  const levelDirectories: TiffDirectory[] = [main]
  const associatedCandidates: {
    readonly directory: TiffDirectory
    readonly label: string
  }[] = []
  for (const directory of document.topLevelDirectories.slice(1)) {
    const description = await directoryDescription(directory)
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
  const associatedImages = associatedCandidates.map(({ directory, label }) => {
    const count = (labelCounts.get(label) ?? 0) + 1
    labelCounts.set(label, count)
    const id = count === 1 ? label : `${label}-${count}`
    return new AperioAssociatedImage(id, label, directory)
  })
  return new AperioWholeSlideImage({
    levelDirectories,
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
