import { type AbortOptions, ImageError, type PixelBlock } from 'purejsimage'
import type {
  WholeSlideAssociatedImage,
  WholeSlideAssociatedImageRequest,
  WholeSlideImage,
  WholeSlideLevel,
  WholeSlideRegionRequest,
} from 'purejsimage/pathology'
import type { TiffDirectory, TiffDocument, TiffProfile, TiffProfileContext } from 'purejsimage/tiff'

const namespaces = new Set([
  'http://www.leica-microsystems.com/scn/2010/03/10',
  'http://www.leica-microsystems.com/scn/2010/10/01',
])
const imageDescriptionTag = 270

const invalid = (message: string): ImageError => new ImageError('INVALID_INPUT', message)
const unsupported = (message: string): ImageError =>
  new ImageError('UNSUPPORTED_OPERATION', message)

const decodeXml = (value: string): string => {
  if (/&(?!(?:#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);)/.test(value)) {
    throw invalid('Leica XML contains an unsupported entity')
  }
  return value.replaceAll(
    /&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g,
    (_match, entity: string) => {
      if (entity === 'amp') return '&'
      if (entity === 'lt') return '<'
      if (entity === 'gt') return '>'
      if (entity === 'quot') return '"'
      if (entity === 'apos') return "'"
      const codePoint = entity.startsWith('#x')
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10)
      if (
        !Number.isSafeInteger(codePoint) ||
        codePoint < 0 ||
        codePoint > 0x10ffff ||
        (codePoint >= 0xd800 && codePoint <= 0xdfff)
      ) {
        throw invalid('Leica XML character reference is invalid')
      }
      return String.fromCodePoint(codePoint)
    },
  )
}

const attributes = (source: string): Readonly<Record<string, string>> => {
  const values: Record<string, string> = {}
  const pattern = /([A-Za-z_][A-Za-z0-9_.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
  for (const match of source.matchAll(pattern)) {
    const name = match[1]
    if (!name) continue
    if (values[name] !== undefined) throw invalid(`Leica XML repeats attribute ${name}`)
    values[name] = decodeXml(match[2] ?? match[3] ?? '')
  }
  return values
}

const requiredInteger = (values: Readonly<Record<string, string>>, name: string): number => {
  const raw = values[name]
  const value = raw === undefined ? Number.NaN : Number(raw)
  if (!Number.isSafeInteger(value) || value < 0) {
    throw invalid(`Leica XML attribute ${name} must be a non-negative safe integer`)
  }
  return value
}

interface LeicaDimension {
  readonly ifd: number
  readonly width: number
  readonly height: number
}

interface LeicaImage {
  readonly macro: boolean
  readonly physicalWidth: number
  readonly dimensions: readonly LeicaDimension[]
}

interface LeicaDescription {
  readonly namespace: string
  readonly images: readonly LeicaImage[]
}

const elementMatch = (source: string, name: string): RegExpMatchArray | null =>
  source.match(new RegExp(`<${name}\\b([^>]*)>([\\s\\S]*?)</${name}\\s*>`, 'i'))

const parseDescription = (xml: string): LeicaDescription => {
  if (xml.length > 4_194_304) throw invalid('Leica XML exceeds 4 MiB')
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) {
    throw invalid('Leica XML document types and entities are unsupported')
  }
  const root = elementMatch(xml, 'scn')
  if (!root) throw invalid('Leica XML scn root is missing')
  const rootAttributes = attributes(root[1] ?? '')
  const namespace = rootAttributes.xmlns
  if (namespace === undefined || !namespaces.has(namespace)) {
    throw invalid('Leica XML namespace is unsupported')
  }
  const collection = elementMatch(root[2] ?? '', 'collection')
  if (!collection) throw invalid('Leica XML collection is missing')
  const collectionAttributes = attributes(collection[1] ?? '')
  const collectionWidth = requiredInteger(collectionAttributes, 'sizeX')
  const collectionHeight = requiredInteger(collectionAttributes, 'sizeY')
  if (collectionWidth < 1 || collectionHeight < 1) {
    throw invalid('Leica collection dimensions must be positive')
  }
  const images: LeicaImage[] = []
  const imagePattern = /<image\b([^>]*)>([\s\S]*?)<\/image\s*>/gi
  for (const imageMatch of (collection[2] ?? '').matchAll(imagePattern)) {
    const body = imageMatch[2] ?? ''
    const viewMatch = body.match(/<view\b([^>]*)\/?\s*>/i)
    if (!viewMatch) throw invalid('Leica image view is missing')
    const view = attributes(viewMatch[1] ?? '')
    const physicalWidth = requiredInteger(view, 'sizeX')
    const physicalHeight = requiredInteger(view, 'sizeY')
    const offsetX = requiredInteger(view, 'offsetX')
    const offsetY = requiredInteger(view, 'offsetY')
    const macro =
      offsetX === 0 &&
      offsetY === 0 &&
      physicalWidth === collectionWidth &&
      physicalHeight === collectionHeight
    const dimensions: LeicaDimension[] = []
    const dimensionPattern = /<dimension\b([^>]*)\/?\s*>/gi
    for (const dimensionMatch of body.matchAll(dimensionPattern)) {
      const dimension = attributes(dimensionMatch[1] ?? '')
      const z = dimension.z
      if (z !== undefined && z !== '0') continue
      const width = requiredInteger(dimension, 'sizeX')
      const height = requiredInteger(dimension, 'sizeY')
      if (width < 1 || height < 1) throw invalid('Leica pixel dimensions must be positive')
      dimensions.push({ ifd: requiredInteger(dimension, 'ifd'), width, height })
    }
    if (dimensions.length === 0) throw invalid('Leica image has no z-plane 0 dimensions')
    dimensions.sort((left, right) => right.width * right.height - left.width * left.height)
    images.push({ macro, physicalWidth, dimensions: Object.freeze(dimensions) })
  }
  if (images.length === 0) throw invalid('Leica collection contains no images')
  return Object.freeze({ namespace, images: Object.freeze(images) })
}

const descriptionFor = async (document: TiffDocument): Promise<string | undefined> => {
  const directory = document.topLevelDirectories[0]
  if (!directory?.tiled) return undefined
  const tag = await directory.getTag(imageDescriptionTag, { maxBytes: 4_194_304 })
  return tag?.kind === 'ascii' ? tag.value : undefined
}

class LeicaAssociatedImage implements WholeSlideAssociatedImage {
  readonly id = 'macro'
  readonly label = 'macro'
  readonly width: number
  readonly height: number
  readonly #directory: TiffDirectory

  constructor(directory: TiffDirectory) {
    this.#directory = directory
    this.width = directory.width
    this.height = directory.height
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
class LeicaWholeSlideLevel implements WholeSlideLevel {
  readonly index: number
  readonly width: number
  readonly height: number
  readonly downsample: number
  readonly tileWidth?: number
  readonly tileHeight?: number
  readonly #directory: TiffDirectory

  constructor(index: number, baseWidth: number, directory: TiffDirectory) {
    this.index = index
    this.width = directory.width
    this.height = directory.height
    this.downsample = baseWidth / directory.width
    this.#directory = directory
    if (directory.tileWidth !== undefined) this.tileWidth = directory.tileWidth
    if (directory.tileHeight !== undefined) this.tileHeight = directory.tileHeight
  }

  async *tile(
    column: number,
    row: number,
    options: Readonly<AbortOptions> = {},
  ): AsyncGenerator<PixelBlock> {
    if (!Number.isSafeInteger(column) || column < 0 || !Number.isSafeInteger(row) || row < 0) {
      throw invalid('Leica tile coordinates must be non-negative safe integers')
    }
    if (this.tileWidth === undefined || this.tileHeight === undefined) {
      throw unsupported(`Leica pyramid level ${this.index} is not tiled`)
    }
    const x = column * this.tileWidth
    const y = row * this.tileHeight
    if (
      !Number.isSafeInteger(x) ||
      !Number.isSafeInteger(y) ||
      x >= this.width ||
      y >= this.height
    ) {
      throw invalid(`Leica tile ${column},${row} is outside pyramid level ${this.index}`)
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

class LeicaWholeSlideImage implements WholeSlideImage {
  readonly width: number
  readonly height: number
  readonly levels: readonly WholeSlideLevel[]
  readonly associatedImages: readonly WholeSlideAssociatedImage[]
  readonly properties: Readonly<Record<string, string>>
  readonly micronsPerPixel?: number
  readonly #directories: readonly TiffDirectory[]

  constructor(
    directories: readonly TiffDirectory[],
    associatedImages: readonly WholeSlideAssociatedImage[],
    namespace: string,
    physicalWidth: number,
  ) {
    const first = directories[0]
    if (!first) throw invalid('Leica slide pyramid is empty')
    this.width = first.width
    this.height = first.height
    this.#directories = Object.freeze([...directories])
    this.levels = Object.freeze(
      directories.map((directory, index) => new LeicaWholeSlideLevel(index, this.width, directory)),
    )
    this.associatedImages = Object.freeze([...associatedImages])
    this.properties = Object.freeze({ 'leica.xmlNamespace': namespace })
    const micronsPerPixel = physicalWidth / this.width / 1000
    if (Number.isFinite(micronsPerPixel) && micronsPerPixel > 0) {
      this.micronsPerPixel = micronsPerPixel
    }
  }

  async *readRegion(options: Readonly<WholeSlideRegionRequest>): AsyncGenerator<PixelBlock> {
    const directory = this.#directories[options.level]
    if (!directory) throw invalid(`Leica pyramid level ${options.level} is unavailable`)
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

export const isLeicaScn = async (document: TiffDocument): Promise<boolean> => {
  const description = await descriptionFor(document)
  if (!description || ![...namespaces].some((namespace) => description.includes(namespace))) {
    return false
  }
  parseDescription(description)
  return true
}

export const openLeicaScn = async (document: TiffDocument): Promise<WholeSlideImage> => {
  const xml = await descriptionFor(document)
  if (!xml) throw invalid('TIFF is not a tiled Leica SCN image')
  const description = parseDescription(xml)
  const mainImages = description.images.filter((image) => !image.macro)
  if (mainImages.length !== 1) {
    throw unsupported('The external Leica profile supports one brightfield image area')
  }
  const main = mainImages[0]
  if (!main) throw invalid('Leica main image is missing')
  const directories = main.dimensions.map((dimension) => {
    const directory = document.topLevelDirectories[dimension.ifd]
    if (!directory) throw invalid(`Leica dimension references missing IFD ${dimension.ifd}`)
    if (directory.width !== dimension.width || directory.height !== dimension.height) {
      throw invalid(`Leica dimension disagrees with IFD ${dimension.ifd}`)
    }
    return directory
  })
  const macroImages = description.images.filter((image) => image.macro)
  if (macroImages.length > 1) throw unsupported('Multiple Leica macro images are unsupported')
  const macro = macroImages[0]
  const associatedImages: WholeSlideAssociatedImage[] = []
  if (macro) {
    const largest = macro.dimensions[0]
    const directory = largest ? document.topLevelDirectories[largest.ifd] : undefined
    if (!largest || !directory) throw invalid('Leica macro image references a missing IFD')
    if (directory.width !== largest.width || directory.height !== largest.height) {
      throw invalid('Leica macro dimensions disagree with its TIFF IFD')
    }
    associatedImages.push(new LeicaAssociatedImage(directory))
  }
  return new LeicaWholeSlideImage(
    directories,
    associatedImages,
    description.namespace,
    main.physicalWidth,
  )
}

export const leicaScnProfile: TiffProfile<WholeSlideImage> = Object.freeze({
  id: 'leica-scn-single-area',
  priority: 80,
  detect: ({ document }: Readonly<TiffProfileContext>) => isLeicaScn(document),
  open: ({ document }: Readonly<TiffProfileContext>) => openLeicaScn(document),
})
