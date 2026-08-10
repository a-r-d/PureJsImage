import { invalidInput, limitExceeded, unsupportedOperation } from '../errors.ts'
import {
  rasterSampleBytes,
  type RasterBlock,
  type RasterDecoder,
  type RasterSampleType,
} from '../raster.ts'
import type { TiffProfile, TiffProfileContext } from '../tiff/profiles.ts'
import type { TiffDirectory, TiffDocument } from '../tiff/types.ts'
import { parseXmlDocument, xmlChild, xmlChildren, xmlLocalName, type XmlElement } from '../xml.ts'
import type {
  MultidimensionalRasterDataset,
  PhysicalPixelSize,
  RasterChannelInfo,
  RasterPlaneRequest,
} from './dataset.ts'

const imageDescriptionTag = 270
const validDimensionOrders = new Set(['XYZCT', 'XYZTC', 'XYCZT', 'XYCTZ', 'XYTCZ', 'XYTZC'])

const requiredAttribute = (element: XmlElement, name: string): string => {
  const value = element.attributes[name]
  if (value === undefined || value.length === 0) {
    throw invalidInput(`OME ${xmlLocalName(element.name)} requires ${name}`)
  }
  return value
}

const positiveIntegerAttribute = (element: XmlElement, name: string): number => {
  const raw = requiredAttribute(element, name)
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 1) {
    throw invalidInput(`OME ${name} must be a positive safe integer`)
  }
  return value
}

const nonNegativeIntegerAttribute = (
  element: XmlElement,
  name: string,
  fallback: number,
): number => {
  const raw = element.attributes[name]
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 0) {
    throw invalidInput(`OME ${name} must be a non-negative safe integer`)
  }
  return value
}

const physicalSize = (
  pixels: XmlElement,
  name: 'PhysicalSizeX' | 'PhysicalSizeY',
): PhysicalPixelSize | undefined => {
  const raw = pixels.attributes[name]
  if (raw === undefined) return undefined
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) throw invalidInput(`OME ${name} must be positive`)
  const unit = pixels.attributes[`${name}Unit`]
  return Object.freeze({ value, ...(unit === undefined ? {} : { unit }) })
}

const omeSampleType = (value: string): RasterSampleType => {
  if (
    value === 'uint8' ||
    value === 'uint16' ||
    value === 'uint32' ||
    value === 'int8' ||
    value === 'int16' ||
    value === 'int32'
  ) {
    return value
  }
  if (value === 'float') return 'float32'
  if (value === 'double') return 'float64'
  throw unsupportedOperation(`OME pixel type ${value} is unsupported`)
}

const coordinateKey = (z: number, c: number, t: number): string => `${z}:${c}:${t}`

type OmeAxis = 'Z' | 'C' | 'T'

const dimensionAxes = (dimensionOrder: string): readonly OmeAxis[] => {
  const axes: OmeAxis[] = []
  for (const axis of dimensionOrder.slice(2)) {
    if (axis !== 'Z' && axis !== 'C' && axis !== 'T') {
      throw invalidInput(`OME DimensionOrder ${dimensionOrder} is invalid`)
    }
    axes.push(axis)
  }
  return axes
}

const coordinateFromIndex = (
  index: number,
  dimensionOrder: string,
  sizes: Readonly<Record<'Z' | 'C' | 'T', number>>,
): { readonly z: number; readonly c: number; readonly t: number } => {
  let remainder = index
  const coordinates: Record<'Z' | 'C' | 'T', number> = { Z: 0, C: 0, T: 0 }
  for (const axis of dimensionAxes(dimensionOrder)) {
    const size = sizes[axis]
    coordinates[axis] = remainder % size
    remainder = Math.floor(remainder / size)
  }
  if (remainder !== 0) throw invalidInput('OME plane coordinate exceeds declared dimensions')
  return { z: coordinates.Z, c: coordinates.C, t: coordinates.T }
}

const indexFromCoordinate = (
  z: number,
  c: number,
  t: number,
  dimensionOrder: string,
  sizes: Readonly<Record<'Z' | 'C' | 'T', number>>,
): number => {
  const coordinates: Readonly<Record<'Z' | 'C' | 'T', number>> = { Z: z, C: c, T: t }
  let multiplier = 1
  let index = 0
  for (const axis of dimensionAxes(dimensionOrder)) {
    index += coordinates[axis] * multiplier
    multiplier *= sizes[axis]
  }
  return index
}

const directoryLevels = (directory: TiffDirectory): readonly TiffDirectory[] => [
  directory,
  ...directory.subIfds,
]

const selectedLevel = (directory: TiffDirectory, level: number): TiffDirectory => {
  const selected = directoryLevels(directory)[level]
  if (!selected) throw invalidInput(`OME resolutionLevel ${level} is unavailable`)
  return selected
}

const selectedBlock = (
  block: RasterBlock,
  channels: readonly number[],
  sampleType: RasterSampleType,
): RasterBlock => {
  if (block.format.sampleType !== sampleType) {
    block.release?.()
    throw invalidInput('OME TIFF directory sample type does not match Pixels Type')
  }
  if (channels.some((channel) => channel < 0 || channel >= block.format.channels)) {
    block.release?.()
    throw invalidInput('OME channel selection exceeds the TIFF raster channels')
  }
  const identity =
    channels.length === block.format.channels &&
    channels.every((channel, index) => channel === index)
  if (identity) return block
  const bytesPerSample = rasterSampleBytes(sampleType)
  const rowBytes = block.width * bytesPerSample
  const planeStride = rowBytes * block.height
  const outputBytes = planeStride * channels.length
  if (!Number.isSafeInteger(outputBytes) || outputBytes > 1_073_741_824) {
    block.release?.()
    throw limitExceeded('OME selected raster block is too large')
  }
  const output = new Uint8Array(outputBytes)
  const sourcePlaneStride = block.planeStride ?? block.stride * block.height
  for (let selected = 0; selected < channels.length; selected += 1) {
    const channel = channels[selected]
    if (channel === undefined) continue
    for (let row = 0; row < block.height; row += 1) {
      for (let x = 0; x < block.width; x += 1) {
        const source = block.format.planar
          ? channel * sourcePlaneStride + row * block.stride + x * bytesPerSample
          : row * block.stride + (x * block.format.channels + channel) * bytesPerSample
        const target = selected * planeStride + row * rowBytes + x * bytesPerSample
        output.set(block.data.subarray(source, source + bytesPerSample), target)
      }
    }
  }
  block.release?.()
  return {
    x: block.x,
    y: block.y,
    width: block.width,
    height: block.height,
    stride: rowBytes,
    planeStride,
    format: Object.freeze({ sampleType, channels: channels.length, planar: true }),
    data: output,
  }
}

const combinedPlaneBlocks = async function* (
  decoders: readonly RasterDecoder[],
  request: Readonly<RasterPlaneRequest>,
  sampleType: RasterSampleType,
): AsyncGenerator<RasterBlock> {
  const decodeRequest = {
    ...(request.x === undefined ? {} : { x: request.x }),
    ...(request.y === undefined ? {} : { y: request.y }),
    ...(request.width === undefined ? {} : { width: request.width }),
    ...(request.height === undefined ? {} : { height: request.height }),
  }
  const iterators = decoders.map((decoder) => decoder.decode(decodeRequest)[Symbol.asyncIterator]())
  while (true) {
    const results = await Promise.all(iterators.map((iterator) => iterator.next()))
    if (results.every((result) => result.done)) return
    if (results.some((result) => result.done)) {
      for (const result of results) if (!result.done) result.value.release?.()
      throw invalidInput('OME channel planes emitted inconsistent raster blocks')
    }
    const first = results[0]?.value
    if (!first) throw invalidInput('OME channel plane is missing')
    const bytesPerSample = rasterSampleBytes(sampleType)
    const rowBytes = first.width * bytesPerSample
    const planeStride = rowBytes * first.height
    const outputBytes = planeStride * results.length
    if (!Number.isSafeInteger(outputBytes) || outputBytes > 1_073_741_824) {
      for (const result of results) result.value.release?.()
      throw limitExceeded('OME combined raster block is too large')
    }
    const output = new Uint8Array(outputBytes)
    for (let channel = 0; channel < results.length; channel += 1) {
      const block = results[channel]?.value
      if (
        !block ||
        block.x !== first.x ||
        block.y !== first.y ||
        block.width !== first.width ||
        block.height !== first.height ||
        block.format.sampleType !== sampleType ||
        block.format.channels !== 1
      ) {
        for (const result of results) result.value.release?.()
        throw invalidInput('OME channel planes have incompatible raster geometry')
      }
      for (let row = 0; row < block.height; row += 1) {
        const source = row * block.stride
        const target = channel * planeStride + row * rowBytes
        output.set(block.data.subarray(source, source + rowBytes), target)
      }
      block.release?.()
    }
    yield {
      x: first.x,
      y: first.y,
      width: first.width,
      height: first.height,
      stride: rowBytes,
      planeStride,
      format: Object.freeze({ sampleType, channels: results.length, planar: true }),
      data: output,
    }
  }
}

class OmeTiffDataset implements MultidimensionalRasterDataset {
  readonly sizeX: number
  readonly sizeY: number
  readonly sizeZ: number
  readonly sizeC: number
  readonly sizeT: number
  readonly sampleType: RasterSampleType
  readonly dimensionOrder: string
  readonly channels: readonly RasterChannelInfo[]
  readonly physicalSizeX?: PhysicalPixelSize
  readonly physicalSizeY?: PhysicalPixelSize
  readonly #planes: ReadonlyMap<string, TiffDirectory>

  constructor(options: {
    readonly sizeX: number
    readonly sizeY: number
    readonly sizeZ: number
    readonly sizeC: number
    readonly sizeT: number
    readonly sampleType: RasterSampleType
    readonly dimensionOrder: string
    readonly channels: readonly RasterChannelInfo[]
    readonly physicalSizeX?: PhysicalPixelSize
    readonly physicalSizeY?: PhysicalPixelSize
    readonly planes: ReadonlyMap<string, TiffDirectory>
  }) {
    this.sizeX = options.sizeX
    this.sizeY = options.sizeY
    this.sizeZ = options.sizeZ
    this.sizeC = options.sizeC
    this.sizeT = options.sizeT
    this.sampleType = options.sampleType
    this.dimensionOrder = options.dimensionOrder
    this.channels = Object.freeze([...options.channels])
    if (options.physicalSizeX !== undefined) this.physicalSizeX = options.physicalSizeX
    if (options.physicalSizeY !== undefined) this.physicalSizeY = options.physicalSizeY
    this.#planes = options.planes
  }

  async *readPlane(options: Readonly<RasterPlaneRequest>): AsyncGenerator<RasterBlock> {
    if (
      !Number.isSafeInteger(options.z) ||
      options.z < 0 ||
      options.z >= this.sizeZ ||
      !Number.isSafeInteger(options.t) ||
      options.t < 0 ||
      options.t >= this.sizeT
    ) {
      throw invalidInput('OME Z/T plane coordinate is outside the dataset')
    }
    const channels =
      options.c === undefined
        ? Array.from({ length: this.sizeC }, (_, index) => index)
        : typeof options.c === 'number'
          ? [options.c]
          : [...options.c]
    if (
      channels.length < 1 ||
      channels.some(
        (channel) => !Number.isSafeInteger(channel) || channel < 0 || channel >= this.sizeC,
      ) ||
      new Set(channels).size !== channels.length
    ) {
      throw invalidInput('OME channel selection is invalid')
    }
    const level = options.resolutionLevel ?? 0
    if (!Number.isSafeInteger(level) || level < 0) {
      throw invalidInput('OME resolutionLevel must be a non-negative safe integer')
    }
    const directories = channels.map((channel) => {
      const directory = this.#planes.get(coordinateKey(options.z, channel, options.t))
      if (!directory) throw invalidInput('OME plane mapping is incomplete')
      return selectedLevel(directory, level)
    })
    const unique = new Set(directories)
    const decodeRequest = {
      ...(options.x === undefined ? {} : { x: options.x }),
      ...(options.y === undefined ? {} : { y: options.y }),
      ...(options.width === undefined ? {} : { width: options.width }),
      ...(options.height === undefined ? {} : { height: options.height }),
    }
    if (unique.size === 1) {
      const directory = directories[0]
      if (!directory) throw invalidInput('OME plane directory is missing')
      const decoder = await directory.createRasterDecoder()
      const sourceChannels = decoder.format.channels
      const selections = sourceChannels === 1 ? [0] : channels
      for await (const block of decoder.decode(decodeRequest)) {
        yield selectedBlock(block, selections, this.sampleType)
      }
      return
    }
    if (unique.size !== directories.length) {
      throw unsupportedOperation(
        'OME mixed interleaved and separate channel mappings are unsupported',
      )
    }
    const decoders = await Promise.all(
      directories.map((directory) => directory.createRasterDecoder()),
    )
    if (decoders.some((decoder) => decoder.format.channels !== 1)) {
      throw unsupportedOperation('OME separate channel planes must contain one TIFF sample')
    }
    yield* combinedPlaneBlocks(decoders, options, this.sampleType)
  }
}

const omeDescription = async (document: TiffDocument): Promise<string | undefined> => {
  const value = await document.topLevelDirectories[0]?.getTag(imageDescriptionTag, {
    maxBytes: 4_194_304,
  })
  return value?.kind === 'ascii' ? value.value : undefined
}

export const isOmeTiff = async (document: TiffDocument): Promise<boolean> => {
  const description = await omeDescription(document)
  return description !== undefined && /<(?:(?:[A-Za-z_][\w.-]*):)?OME\b/.test(description)
}

export const openOmeTiff = async (
  document: TiffDocument,
  imageIndex = 0,
): Promise<MultidimensionalRasterDataset> => {
  const description = await omeDescription(document)
  if (!description) throw invalidInput('TIFF ImageDescription does not contain OME XML')
  const root = parseXmlDocument(description, { maxCharacters: 4_194_304, maxElements: 100_000 })
  if (xmlLocalName(root.name) !== 'OME') throw invalidInput('OME XML root element is missing')
  const images = xmlChildren(root, 'Image')
  const image = images[imageIndex]
  if (!image) throw invalidInput(`OME Image index ${imageIndex} is unavailable`)
  const pixels = xmlChild(image, 'Pixels')
  if (!pixels) throw invalidInput('OME Image is missing Pixels')
  const sizeX = positiveIntegerAttribute(pixels, 'SizeX')
  const sizeY = positiveIntegerAttribute(pixels, 'SizeY')
  const sizeZ = positiveIntegerAttribute(pixels, 'SizeZ')
  const sizeC = positiveIntegerAttribute(pixels, 'SizeC')
  const sizeT = positiveIntegerAttribute(pixels, 'SizeT')
  const dimensionOrder = requiredAttribute(pixels, 'DimensionOrder')
  if (!validDimensionOrders.has(dimensionOrder)) {
    throw unsupportedOperation(`OME DimensionOrder ${dimensionOrder} is unsupported`)
  }
  const sampleType = omeSampleType(requiredAttribute(pixels, 'Type'))
  const channelElements = xmlChildren(pixels, 'Channel')
  const channels: RasterChannelInfo[] = channelElements.map((channel) => {
    const samplesPerPixel = nonNegativeIntegerAttribute(channel, 'SamplesPerPixel', 1)
    if (samplesPerPixel < 1) throw invalidInput('OME Channel SamplesPerPixel must be positive')
    const colorRaw = channel.attributes.Color
    const color = colorRaw === undefined ? undefined : Number(colorRaw)
    if (
      color !== undefined &&
      (!Number.isSafeInteger(color) || color < -2_147_483_648 || color > 4_294_967_295)
    ) {
      throw invalidInput('OME Channel Color is invalid')
    }
    return Object.freeze({
      samplesPerPixel,
      ...(channel.attributes.ID === undefined ? {} : { id: channel.attributes.ID }),
      ...(channel.attributes.Name === undefined ? {} : { name: channel.attributes.Name }),
      ...(color === undefined ? {} : { color }),
    })
  })
  if (channels.length === 0) {
    for (let channel = 0; channel < sizeC; channel += 1) {
      channels.push(Object.freeze({ samplesPerPixel: 1 }))
    }
  }
  if (channels.reduce((sum, channel) => sum + channel.samplesPerPixel, 0) !== sizeC) {
    throw invalidInput('OME Channel SamplesPerPixel totals do not match SizeC')
  }

  const sizes = { Z: sizeZ, C: sizeC, T: sizeT } as const
  const totalPlanes = sizeZ * sizeC * sizeT
  if (!Number.isSafeInteger(totalPlanes)) throw limitExceeded('OME plane count is too large')
  const planes = new Map<string, TiffDirectory>()
  const tiffData = xmlChildren(pixels, 'TiffData')
  if (tiffData.length === 0) {
    if (
      document.topLevelDirectories.length === 1 &&
      document.topLevelDirectories[0]?.samplesPerPixel === sizeC
    ) {
      const directory = document.topLevelDirectories[0]
      if (!directory) throw invalidInput('OME TIFF directory is missing')
      for (let channel = 0; channel < sizeC; channel += 1) {
        planes.set(coordinateKey(0, channel, 0), directory)
      }
    } else {
      for (let plane = 0; plane < totalPlanes; plane += 1) {
        const directory = document.topLevelDirectories[plane]
        if (!directory) throw invalidInput('OME implicit IFD mapping exceeds TIFF directories')
        const coordinate = coordinateFromIndex(plane, dimensionOrder, sizes)
        planes.set(coordinateKey(coordinate.z, coordinate.c, coordinate.t), directory)
      }
    }
  } else {
    for (const mapping of tiffData) {
      const ifdIndex = nonNegativeIntegerAttribute(mapping, 'IFD', 0)
      const firstZ = nonNegativeIntegerAttribute(mapping, 'FirstZ', 0)
      const firstC = nonNegativeIntegerAttribute(mapping, 'FirstC', 0)
      const firstT = nonNegativeIntegerAttribute(mapping, 'FirstT', 0)
      const planeCount = nonNegativeIntegerAttribute(mapping, 'PlaneCount', 1)
      if (planeCount < 1) throw invalidInput('OME TiffData PlaneCount must be positive')
      if (firstZ >= sizeZ || firstC >= sizeC || firstT >= sizeT) {
        throw invalidInput('OME TiffData first coordinate is outside Pixels dimensions')
      }
      const start = indexFromCoordinate(firstZ, firstC, firstT, dimensionOrder, sizes)
      const firstDirectory = document.topLevelDirectories[ifdIndex]
      if (
        planeCount === 1 &&
        sizeZ === 1 &&
        sizeT === 1 &&
        firstC === 0 &&
        firstDirectory?.samplesPerPixel === sizeC
      ) {
        for (let channel = 0; channel < sizeC; channel += 1) {
          const key = coordinateKey(0, channel, 0)
          if (planes.has(key)) throw invalidInput('OME TiffData maps a plane more than once')
          planes.set(key, firstDirectory)
        }
        continue
      }
      for (let plane = 0; plane < planeCount; plane += 1) {
        const coordinate = coordinateFromIndex(start + plane, dimensionOrder, sizes)
        const directory = document.topLevelDirectories[ifdIndex + plane]
        if (!directory) throw invalidInput('OME TiffData IFD mapping exceeds TIFF directories')
        const key = coordinateKey(coordinate.z, coordinate.c, coordinate.t)
        if (planes.has(key)) throw invalidInput('OME TiffData maps a plane more than once')
        planes.set(key, directory)
      }
    }
  }
  if (planes.size !== totalPlanes)
    throw invalidInput('OME TiffData mapping does not cover every plane')
  for (const directory of new Set(planes.values())) {
    if (directory.width !== sizeX || directory.height !== sizeY) {
      throw invalidInput('OME Pixels dimensions disagree with the mapped TIFF directory')
    }
    const decoder = await directory.createRasterDecoder()
    if (decoder.format.sampleType !== sampleType) {
      throw invalidInput('OME Pixels Type disagrees with TIFF SampleFormat/BitsPerSample')
    }
  }
  const physicalSizeX = physicalSize(pixels, 'PhysicalSizeX')
  const physicalSizeY = physicalSize(pixels, 'PhysicalSizeY')
  return new OmeTiffDataset({
    sizeX,
    sizeY,
    sizeZ,
    sizeC,
    sizeT,
    sampleType,
    dimensionOrder,
    channels,
    ...(physicalSizeX === undefined ? {} : { physicalSizeX }),
    ...(physicalSizeY === undefined ? {} : { physicalSizeY }),
    planes,
  })
}

export const omeTiffProfile: TiffProfile<MultidimensionalRasterDataset> = Object.freeze({
  id: 'ome-tiff',
  priority: 100,
  detect: ({ document }: Readonly<TiffProfileContext>) => isOmeTiff(document),
  open: ({ document }: Readonly<TiffProfileContext>) => openOmeTiff(document),
})
