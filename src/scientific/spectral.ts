import { invalidInput } from '../errors.ts'
import type { PixelBlock } from '../pixel.ts'
import type { RasterBlock } from '../raster.ts'
import type {
  MultidimensionalRasterDataset,
  PhysicalPixelSize,
  RasterChannelInfo,
  RasterPlaneRequest,
} from './dataset.ts'
import {
  renderScientificPlane,
  type ScientificPlaneRenderOptions,
  type ScientificRenderedPlane,
} from './render.ts'
import { rasterSampleOffset, readRasterSample, validateRasterBlock } from './samples.ts'

/** Requested wavelength and the nearest channel center actually selected. */
export interface SpectralChannelSelection {
  readonly requested: number
  readonly channel: number
  readonly selected: number
  readonly unit?: string
}

interface SpectralChannel {
  readonly channel: number
  readonly center: number
  readonly unit?: string
}

const spectralChannels = (dataset: MultidimensionalRasterDataset): readonly SpectralChannel[] => {
  const channels = dataset.channels.flatMap((channel, index) =>
    channel.spectral === undefined
      ? []
      : [
          {
            channel: index,
            center: channel.spectral.center,
            ...(channel.spectral.unit === undefined ? {} : { unit: channel.spectral.unit }),
          },
        ],
  )
  if (channels.length === 0)
    throw invalidInput('Scientific dataset has no spectral channel metadata')
  const units = new Set(channels.map(({ unit }) => unit ?? ''))
  if (units.size > 1) throw invalidInput('Scientific dataset mixes incompatible spectral units')
  return channels
}

/** Selects the nearest real spectral channel without interpolating metadata. */
export const nearestSpectralChannel = (
  dataset: MultidimensionalRasterDataset,
  wavelength: number,
): SpectralChannelSelection => {
  if (!Number.isFinite(wavelength)) throw invalidInput('Requested wavelength must be finite')
  const channels = spectralChannels(dataset)
  let nearest = channels[0]
  if (!nearest) throw invalidInput('Scientific dataset has no spectral channels')
  for (let index = 1; index < channels.length; index += 1) {
    const candidate = channels[index]
    if (
      candidate &&
      Math.abs(candidate.center - wavelength) < Math.abs(nearest.center - wavelength)
    ) {
      nearest = candidate
    }
  }
  return Object.freeze({
    requested: wavelength,
    channel: nearest.channel,
    selected: nearest.center,
    ...(nearest.unit === undefined ? {} : { unit: nearest.unit }),
  })
}

export interface SpectralBandRenderOptions extends Omit<ScientificPlaneRenderOptions, 'plane'> {
  readonly wavelength: number
  readonly z?: number
  readonly t?: number
}

export interface SpectralBandRenderResult {
  readonly selection: SpectralChannelSelection
  readonly image: ScientificRenderedPlane
}

/**
 * Selects a real channel by wavelength and explicitly renders it for display.
 * Dataset or percentile ranges may scan the selected native band before pixels
 * are consumed; pass an explicit measured range to avoid that scan.
 */
export const renderSpectralBand = async (
  dataset: MultidimensionalRasterDataset,
  options: Readonly<SpectralBandRenderOptions>,
): Promise<SpectralBandRenderResult> => {
  const selection = nearestSpectralChannel(dataset, options.wavelength)
  const { wavelength: _wavelength, z = 0, t = 0, ...renderOptions } = options
  const image = await renderScientificPlane(dataset, {
    ...renderOptions,
    plane: { z, c: selection.channel, t },
  })
  return Object.freeze({ selection, image })
}

export interface SpectralCompositeRenderOptions
  extends Omit<ScientificPlaneRenderOptions, 'palette' | 'plane'> {
  readonly red: number
  readonly green: number
  readonly blue: number
  readonly z?: number
  readonly t?: number
}

export interface SpectralCompositeRenderResult {
  readonly red: SpectralChannelSelection
  readonly green: SpectralChannelSelection
  readonly blue: SpectralChannelSelection
  readonly width: number
  readonly height: number
  readonly x: number
  readonly y: number
  readonly ranges: readonly [
    ScientificRenderedPlane['range'],
    ScientificRenderedPlane['range'],
    ScientificRenderedPlane['range'],
  ]
  readonly pixels: AsyncIterable<PixelBlock>
}

const compositePixels = async function* (
  red: AsyncIterable<PixelBlock>,
  green: AsyncIterable<PixelBlock>,
  blue: AsyncIterable<PixelBlock>,
): AsyncGenerator<PixelBlock> {
  const iterators = [red, green, blue].map((blocks) => blocks[Symbol.asyncIterator]())
  while (true) {
    const results: IteratorResult<PixelBlock>[] = []
    for (const iterator of iterators) results.push(await iterator.next())
    if (results.every((result) => result.done)) return
    if (results.some((result) => result.done))
      throw invalidInput('Spectral composite channels emitted inconsistent blocks')
    const blocks = results.map((result) => result.value)
    const first = blocks[0]
    if (!first) throw invalidInput('Spectral composite is missing its red block')
    if (
      blocks.some(
        (block) =>
          block.x !== first.x ||
          block.y !== first.y ||
          block.width !== first.width ||
          block.height !== first.height ||
          block.format !== 'rgb8',
      )
    ) {
      for (const block of blocks) block.release?.()
      throw invalidInput('Spectral composite channel blocks are incompatible')
    }
    const output = new Uint8Array(first.width * first.height * 3)
    for (let row = 0; row < first.height; row += 1) {
      for (let x = 0; x < first.width; x += 1) {
        const target = (row * first.width + x) * 3
        for (let channel = 0; channel < 3; channel += 1) {
          const block = blocks[channel]
          if (block) output[target + channel] = block.data[row * block.stride + x * 3] ?? 0
        }
      }
    }
    for (const block of blocks) block.release?.()
    yield {
      x: first.x,
      y: first.y,
      width: first.width,
      height: first.height,
      stride: first.width * 3,
      format: 'rgb8',
      data: output,
    }
  }
}

/**
 * Renders a false-color RGB display from the nearest real red, green, and blue
 * spectral channels. Native source samples and wavelength metadata are unchanged.
 */
export const renderSpectralComposite = async (
  dataset: MultidimensionalRasterDataset,
  options: Readonly<SpectralCompositeRenderOptions>,
): Promise<SpectralCompositeRenderResult> => {
  const red = nearestSpectralChannel(dataset, options.red)
  const green = nearestSpectralChannel(dataset, options.green)
  const blue = nearestSpectralChannel(dataset, options.blue)
  const { red: _red, green: _green, blue: _blue, z = 0, t = 0, ...renderOptions } = options
  const redImage = await renderScientificPlane(dataset, {
    ...renderOptions,
    palette: 'grayscale',
    plane: { z, c: red.channel, t },
  })
  const greenImage = await renderScientificPlane(dataset, {
    ...renderOptions,
    palette: 'grayscale',
    plane: { z, c: green.channel, t },
  })
  const blueImage = await renderScientificPlane(dataset, {
    ...renderOptions,
    palette: 'grayscale',
    plane: { z, c: blue.channel, t },
  })
  return Object.freeze({
    red,
    green,
    blue,
    width: redImage.width,
    height: redImage.height,
    x: redImage.x,
    y: redImage.y,
    ranges: Object.freeze([redImage.range, greenImage.range, blueImage.range] as const),
    pixels: {
      [Symbol.asyncIterator]: () =>
        compositePixels(redImage.pixels, greenImage.pixels, blueImage.pixels),
    },
  })
}

type DerivedOperation =
  | {
      readonly kind: 'integrate'
      readonly channels: readonly SpectralChannel[]
    }
  | {
      readonly kind: 'ratio'
      readonly numerator: SpectralChannelSelection
      readonly denominator: SpectralChannelSelection
    }

export interface SpectralDerivedDataset extends MultidimensionalRasterDataset {
  readonly sourceChannels: readonly number[]
}

const validateDerivedRequest = (request: Readonly<RasterPlaneRequest>): void => {
  const channels =
    request.c === undefined ? [0] : typeof request.c === 'number' ? [request.c] : request.c
  if (channels.length !== 1 || channels[0] !== 0) {
    throw invalidInput('Derived spectral rasters contain only channel 0')
  }
  if (request.resolutionLevel !== undefined && request.resolutionLevel !== 0) {
    throw invalidInput('Derived spectral raster resolutionLevel must be 0')
  }
}

const derivedValue = (operation: DerivedOperation, values: Float64Array): number => {
  for (let index = 0; index < values.length; index += 1) {
    if (!Number.isFinite(values[index])) return Number.NaN
  }
  if (operation.kind === 'ratio') {
    const denominator = values[1]
    return denominator === undefined || denominator === 0
      ? Number.NaN
      : (values[0] ?? Number.NaN) / denominator
  }
  if (operation.channels.length === 1) return values[0] ?? Number.NaN
  let integrated = 0
  for (let index = 1; index < operation.channels.length; index += 1) {
    const previous = operation.channels[index - 1]
    const current = operation.channels[index]
    if (!previous || !current) continue
    integrated +=
      ((values[index - 1] ?? 0) + (values[index] ?? 0)) * 0.5 * (current.center - previous.center)
  }
  return integrated
}

class DerivedSpectralDataset implements SpectralDerivedDataset {
  readonly sizeX: number
  readonly sizeY: number
  readonly sizeZ: number
  readonly sizeC = 1
  readonly sizeT: number
  readonly sampleType = 'float64' as const
  readonly dimensionOrder: string
  readonly channels: readonly RasterChannelInfo[]
  readonly physicalSizeX?: PhysicalPixelSize
  readonly physicalSizeY?: PhysicalPixelSize
  readonly originX?: PhysicalPixelSize
  readonly originY?: PhysicalPixelSize
  readonly metadata?: Readonly<Record<string, string>>
  readonly noDataValue = Number.NaN
  readonly sourceChannels: readonly number[]
  readonly #source: MultidimensionalRasterDataset
  readonly #operation: DerivedOperation

  constructor(
    source: MultidimensionalRasterDataset,
    operation: DerivedOperation,
    name: string,
    sourceChannels: readonly number[],
  ) {
    this.#source = source
    this.#operation = operation
    this.sizeX = source.sizeX
    this.sizeY = source.sizeY
    this.sizeZ = source.sizeZ
    this.sizeT = source.sizeT
    this.dimensionOrder = source.dimensionOrder
    this.channels = Object.freeze([Object.freeze({ name, samplesPerPixel: 1 })])
    this.sourceChannels = Object.freeze([...sourceChannels])
    if (source.physicalSizeX !== undefined) this.physicalSizeX = source.physicalSizeX
    if (source.physicalSizeY !== undefined) this.physicalSizeY = source.physicalSizeY
    if (source.originX !== undefined) this.originX = source.originX
    if (source.originY !== undefined) this.originY = source.originY
    if (source.metadata !== undefined) this.metadata = source.metadata
  }

  async *readPlane(request: Readonly<RasterPlaneRequest>): AsyncGenerator<RasterBlock> {
    validateDerivedRequest(request)
    for await (const block of this.#source.readPlane({
      ...request,
      c: this.sourceChannels,
    })) {
      try {
        if (block.format.channels !== this.sourceChannels.length) {
          throw invalidInput('Source dataset returned the wrong spectral channel count')
        }
        const layout = validateRasterBlock(block)
        const inputView = new DataView(
          block.data.buffer,
          block.data.byteOffset,
          block.data.byteLength,
        )
        const output = new Uint8Array(block.width * block.height * 8)
        const outputView = new DataView(output.buffer)
        const values = new Float64Array(this.sourceChannels.length)
        for (let y = 0; y < block.height; y += 1) {
          for (let x = 0; x < block.width; x += 1) {
            for (let channel = 0; channel < this.sourceChannels.length; channel += 1) {
              const value = readRasterSample(
                block.data,
                inputView,
                rasterSampleOffset(block, layout, x, y, channel),
                block.format.sampleType,
              )
              values[channel] =
                this.#source.noDataValue !== undefined && value === this.#source.noDataValue
                  ? Number.NaN
                  : value
            }
            outputView.setFloat64(
              (y * block.width + x) * 8,
              derivedValue(this.#operation, values),
              false,
            )
          }
        }
        yield {
          x: block.x,
          y: block.y,
          width: block.width,
          height: block.height,
          stride: block.width * 8,
          format: Object.freeze({ sampleType: 'float64', channels: 1, planar: false }),
          data: output,
        }
      } finally {
        block.release?.()
      }
    }
  }
}

export interface SpectralRangeOptions {
  readonly from: number
  readonly to: number
}

export const integrateSpectralRange = (
  dataset: MultidimensionalRasterDataset,
  options: Readonly<SpectralRangeOptions>,
): SpectralDerivedDataset => {
  if (!Number.isFinite(options.from) || !Number.isFinite(options.to) || options.from > options.to) {
    throw invalidInput('Spectral integration range requires finite from <= to')
  }
  const channels = spectralChannels(dataset)
    .filter(({ center }) => center >= options.from && center <= options.to)
    .sort((left, right) => left.center - right.center)
  if (channels.length === 0) throw invalidInput('Spectral integration range contains no channels')
  return new DerivedSpectralDataset(
    dataset,
    { kind: 'integrate', channels },
    `Integrated ${channels[0]?.center}-${channels.at(-1)?.center}${channels[0]?.unit ? ` ${channels[0].unit}` : ''}`,
    channels.map(({ channel }) => channel),
  )
}

export interface BandRatioOptions {
  readonly numerator: number
  readonly denominator: number
}

export const bandRatio = (
  dataset: MultidimensionalRasterDataset,
  options: Readonly<BandRatioOptions>,
): SpectralDerivedDataset => {
  const numerator = nearestSpectralChannel(dataset, options.numerator)
  const denominator = nearestSpectralChannel(dataset, options.denominator)
  return new DerivedSpectralDataset(
    dataset,
    { kind: 'ratio', numerator, denominator },
    `Ratio ${numerator.selected}/${denominator.selected}${numerator.unit ? ` ${numerator.unit}` : ''}`,
    [numerator.channel, denominator.channel],
  )
}
