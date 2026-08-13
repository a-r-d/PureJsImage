import { invalidInput } from '../errors.ts'
import type { PixelBlock } from '../pixel.ts'
import type { RasterBlock } from '../raster.ts'
import type {
  MultidimensionalRasterDataset,
  PhysicalPixelSize,
  RasterChannelInfo,
  RasterPlaneRequest,
} from './legacy-dataset.ts'
import { isScientificDataset } from './dataset-adapters.ts'
import type {
  NormalizedScientificDatasetDescriptor,
  ScientificDataset,
  ScientificPlaneReadRequest,
} from './dataset.ts'
import {
  normalizeScientificDatasetDescriptor,
  normalizeScientificPlaneReadRequest,
} from './dataset.ts'
import type { NumericArray, NumericTile, NumericTileSource } from './numeric-tile.ts'
import {
  rasterBlockToNumericTile,
  resolveNumericTileSource,
  validateNumericTile,
} from './numeric-tile.ts'
import {
  type ScientificPlaneRenderOptions,
  type ScientificRenderedPlane,
  renderScientificPlane,
  type LegacyScientificPlaneRenderOptions,
  type LegacyScientificRenderedPlane,
} from './render.ts'

type NumberNumericArray = Exclude<NumericArray, BigUint64Array>

const numericSource = (dataset: ScientificDataset): NumericTileSource =>
  resolveNumericTileSource(dataset, {
    ...(dataset.descriptor.sampleType === 'uint64' ? { targetSampleType: 'float64' } : {}),
  })

const numberTileData = (tile: NumericTile): NumberNumericArray => {
  validateNumericTile(tile)
  if (tile.data instanceof BigUint64Array) {
    throw invalidInput('Scientific uint64 values must be exactly convertible to float64')
  }
  return tile.data
}

/** Requested wavelength and the nearest channel center actually selected. */
export interface SpectralChannelSelection {
  readonly requested: number
  readonly channel: number
  readonly selected: number
  readonly unit?: string
  readonly axisId?: string
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

const scientificSpectralChannels = (
  dataset: ScientificDataset,
  axisId: string,
): readonly SpectralChannel[] => {
  const axis = dataset.descriptor.axes.find((candidate) => candidate.id === axisId)
  if (axis === undefined) throw invalidInput(`Scientific spectral axis ${axisId} is unknown`)
  if (axis.kind !== 'spectral') {
    throw invalidInput(`Scientific axis ${axisId} is not declared as spectral`)
  }
  let channels: readonly SpectralChannel[]
  if (axis.coordinates.type === 'lookup') {
    channels = axis.coordinates.values.map((center, channel) => ({
      channel,
      center,
      ...(axis.unit === undefined ? {} : { unit: axis.unit }),
    }))
  } else if (axis.coordinates.type === 'linear') {
    const coordinates = axis.coordinates
    channels = Array.from({ length: axis.length }, (_, channel) => ({
      channel,
      center: coordinates.origin + coordinates.step * channel,
      ...(axis.unit === undefined ? {} : { unit: axis.unit }),
    }))
  } else if (axis.entries?.every((entry) => entry.spectral !== undefined)) {
    channels = axis.entries.map((entry, channel) => ({
      channel,
      center: entry.spectral?.center ?? Number.NaN,
      ...(entry.spectral?.unit === undefined ? {} : { unit: entry.spectral.unit }),
    }))
  } else {
    throw invalidInput(`Scientific spectral axis ${axisId} has no numeric calibration`)
  }
  const units = new Set(channels.map(({ unit }) => unit ?? ''))
  if (units.size > 1) throw invalidInput('Scientific dataset mixes incompatible spectral units')
  return channels
}

/** Selects the nearest real spectral channel without interpolating metadata. */
export function nearestSpectralChannel(
  dataset: MultidimensionalRasterDataset,
  wavelength: number,
): SpectralChannelSelection
export function nearestSpectralChannel(
  dataset: ScientificDataset,
  wavelength: number,
  axisId: string,
): SpectralChannelSelection
export function nearestSpectralChannel(
  dataset: MultidimensionalRasterDataset | ScientificDataset,
  wavelength: number,
  axisId?: string,
): SpectralChannelSelection {
  if (!Number.isFinite(wavelength)) throw invalidInput('Requested wavelength must be finite')
  let channels: readonly SpectralChannel[]
  if (isScientificDataset(dataset)) {
    if (axisId === undefined) {
      throw invalidInput('Labeled spectral selection requires an explicit axis id')
    }
    channels = scientificSpectralChannels(dataset, axisId)
  } else {
    channels = spectralChannels(dataset)
  }
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
    ...(axisId === undefined ? {} : { axisId }),
  })
}

export interface LegacySpectralBandRenderOptions
  extends Omit<LegacyScientificPlaneRenderOptions, 'plane'> {
  readonly wavelength: number
  readonly z?: number
  readonly t?: number
}

export interface SpectralBandRenderOptions extends Omit<ScientificPlaneRenderOptions, 'plane'> {
  readonly wavelength: number
  readonly spectralAxis: string
  readonly plane: ScientificPlaneRenderOptions['plane']
}

export interface LegacySpectralBandRenderResult {
  readonly selection: SpectralChannelSelection
  readonly image: LegacyScientificRenderedPlane
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
const withScientificAxisIndex = (
  plane: ScientificPlaneRenderOptions['plane'],
  axisId: string,
  index: number,
): ScientificPlaneRenderOptions['plane'] =>
  Object.freeze({
    ...plane,
    fixedIndices: Object.freeze([
      ...plane.fixedIndices.filter((selection) => selection.axisId !== axisId),
      { axisId, index },
    ]),
  })

export function renderSpectralBand(
  dataset: MultidimensionalRasterDataset,
  options: Readonly<LegacySpectralBandRenderOptions>,
): Promise<LegacySpectralBandRenderResult>
export function renderSpectralBand(
  dataset: ScientificDataset,
  options: Readonly<SpectralBandRenderOptions>,
): Promise<SpectralBandRenderResult>
export async function renderSpectralBand(
  dataset: MultidimensionalRasterDataset | ScientificDataset,
  options: Readonly<LegacySpectralBandRenderOptions | SpectralBandRenderOptions>,
): Promise<LegacySpectralBandRenderResult | SpectralBandRenderResult> {
  if (isScientificDataset(dataset)) {
    if (!('spectralAxis' in options)) {
      throw invalidInput('Labeled spectral rendering requires an explicit spectralAxis')
    }
    const selection = nearestSpectralChannel(dataset, options.wavelength, options.spectralAxis)
    const { wavelength: _wavelength, spectralAxis, plane, ...renderOptions } = options
    const image = await renderScientificPlane(dataset, {
      ...renderOptions,
      plane: withScientificAxisIndex(plane, spectralAxis, selection.channel),
    })
    return Object.freeze({ selection, image })
  }
  if ('spectralAxis' in options) {
    throw invalidInput('Fixed-axis spectral rendering does not accept spectralAxis')
  }
  const selection = nearestSpectralChannel(dataset, options.wavelength)
  const { wavelength: _wavelength, z = 0, t = 0, ...renderOptions } = options
  const image = await renderScientificPlane(dataset, {
    ...renderOptions,
    plane: { z, c: selection.channel, t },
  })
  return Object.freeze({ selection, image })
}

export interface LegacySpectralCompositeRenderOptions
  extends Omit<LegacyScientificPlaneRenderOptions, 'palette' | 'plane'> {
  readonly red: number
  readonly green: number
  readonly blue: number
  readonly z?: number
  readonly t?: number
}

export interface SpectralCompositeRenderOptions
  extends Omit<ScientificPlaneRenderOptions, 'palette' | 'plane'> {
  readonly red: number
  readonly green: number
  readonly blue: number
  readonly spectralAxis: string
  readonly plane: ScientificPlaneRenderOptions['plane']
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
    LegacyScientificRenderedPlane['range'],
    LegacyScientificRenderedPlane['range'],
    LegacyScientificRenderedPlane['range'],
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
export function renderSpectralComposite(
  dataset: MultidimensionalRasterDataset,
  options: Readonly<LegacySpectralCompositeRenderOptions>,
): Promise<SpectralCompositeRenderResult>
export function renderSpectralComposite(
  dataset: ScientificDataset,
  options: Readonly<SpectralCompositeRenderOptions>,
): Promise<SpectralCompositeRenderResult>
export async function renderSpectralComposite(
  dataset: MultidimensionalRasterDataset | ScientificDataset,
  options: Readonly<LegacySpectralCompositeRenderOptions | SpectralCompositeRenderOptions>,
): Promise<SpectralCompositeRenderResult> {
  if (isScientificDataset(dataset)) {
    if (!('spectralAxis' in options)) {
      throw invalidInput('Labeled spectral composite requires an explicit spectralAxis')
    }
    const red = nearestSpectralChannel(dataset, options.red, options.spectralAxis)
    const green = nearestSpectralChannel(dataset, options.green, options.spectralAxis)
    const blue = nearestSpectralChannel(dataset, options.blue, options.spectralAxis)
    const { red: _red, green: _green, blue: _blue, spectralAxis, plane, ...renderOptions } = options
    const renderBand = (channel: number) =>
      renderScientificPlane(dataset, {
        ...renderOptions,
        palette: 'grayscale',
        plane: withScientificAxisIndex(plane, spectralAxis, channel),
      })
    const redImage = await renderBand(red.channel)
    const greenImage = await renderBand(green.channel)
    const blueImage = await renderBand(blue.channel)
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
  if ('spectralAxis' in options) {
    throw invalidInput('Fixed-axis spectral composite does not accept spectralAxis')
  }
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

export interface LegacySpectralDerivedDataset extends MultidimensionalRasterDataset {
  readonly sourceChannels: readonly number[]
}

export interface SpectralDerivedDataset extends ScientificDataset {
  readonly sourceIndices: readonly number[]
  readonly spectralAxis: string
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

class DerivedSpectralDataset implements LegacySpectralDerivedDataset {
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
      const tile = rasterBlockToNumericTile(block, {
        ...(block.format.sampleType === 'uint64' ? { targetSampleType: 'float64' } : {}),
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      })
      try {
        if (tile.componentCount !== this.sourceChannels.length) {
          throw invalidInput('Source dataset returned the wrong spectral channel count')
        }
        const input = numberTileData(tile)
        const componentStride = tile.layout === 'planar' ? (tile.planeStrideElements ?? 0) : 1
        const pixelStride = tile.layout === 'planar' ? 1 : tile.componentCount
        const output = new Uint8Array(tile.width * tile.height * 8)
        const outputView = new DataView(output.buffer)
        const values = new Float64Array(this.sourceChannels.length)
        for (let y = 0; y < tile.height; y += 1) {
          const rowOffset = y * tile.rowStrideElements
          for (let x = 0; x < tile.width; x += 1) {
            const pixelOffset = rowOffset + x * pixelStride
            for (let channel = 0; channel < this.sourceChannels.length; channel += 1) {
              const value = input[pixelOffset + channel * componentStride] ?? Number.NaN
              values[channel] =
                this.#source.noDataValue !== undefined && value === this.#source.noDataValue
                  ? Number.NaN
                  : value
            }
            outputView.setFloat64(
              (y * tile.width + x) * 8,
              derivedValue(this.#operation, values),
              false,
            )
          }
        }
        yield {
          x: tile.x,
          y: tile.y,
          width: tile.width,
          height: tile.height,
          stride: tile.width * 8,
          format: Object.freeze({ sampleType: 'float64', channels: 1, planar: false }),
          data: output,
        }
      } finally {
        tile.release()
      }
    }
  }
}

const tileValues = (tile: NumericTile, noDataValue: number | undefined): Float64Array => {
  if (tile.componentCount !== 1) {
    throw invalidInput('Labeled spectral math requires scalar source blocks')
  }
  const input = numberTileData(tile)
  const output = new Float64Array(tile.width * tile.height)
  for (let y = 0; y < tile.height; y += 1) {
    const sourceRow = y * tile.rowStrideElements
    for (let x = 0; x < tile.width; x += 1) {
      const value = input[sourceRow + x] ?? Number.NaN
      output[y * tile.width + x] =
        noDataValue !== undefined && value === noDataValue ? Number.NaN : value
    }
  }
  return output
}

const readScientificSpectralRegion = async (
  dataset: ScientificDataset,
  request: Readonly<ScientificPlaneReadRequest>,
): Promise<Float64Array> => {
  const normalized = normalizeScientificPlaneReadRequest(dataset.descriptor, request)
  const source = numericSource(dataset)
  const output = new Float64Array(normalized.width * normalized.height)
  let expectedY = normalized.y
  for await (const tile of source.readNumericTiles({
    ...normalized,
    ...(dataset.descriptor.sampleType === 'uint64' ? { targetSampleType: 'float64' } : {}),
  })) {
    try {
      if (tile.x !== normalized.x || tile.y !== expectedY || tile.width !== normalized.width) {
        throw invalidInput('Labeled spectral source emitted incompatible blocks')
      }
      output.set(
        tileValues(tile, dataset.descriptor.noDataValue),
        (tile.y - normalized.y) * normalized.width,
      )
      expectedY += tile.height
    } finally {
      tile.release()
    }
  }
  if (expectedY !== normalized.y + normalized.height) {
    throw invalidInput('Labeled spectral source emitted an incomplete region')
  }
  return output
}

class DerivedScientificSpectralDataset implements SpectralDerivedDataset {
  readonly descriptor: NormalizedScientificDatasetDescriptor
  readonly sourceIndices: readonly number[]
  readonly spectralAxis: string
  readonly #source: ScientificDataset
  readonly #operation: DerivedOperation

  constructor(
    source: ScientificDataset,
    spectralAxis: string,
    operation: DerivedOperation,
    name: string,
    sourceIndices: readonly number[],
  ) {
    const axis = source.descriptor.axes.find((candidate) => candidate.id === spectralAxis)
    if (axis === undefined || axis.kind !== 'spectral') {
      throw invalidInput(`Scientific axis ${spectralAxis} is not a spectral axis`)
    }
    const axes = source.descriptor.axes.filter((candidate) => candidate.id !== spectralAxis)
    if (axes.length < 2) {
      throw invalidInput('Spectral reduction must leave at least two displayable axes')
    }
    const levels = source.descriptor.levels.map((level) => ({
      level: level.level,
      axisLengths: level.axisLengths.filter((entry) => entry.axisId !== spectralAxis),
      ...(level.axisCoordinates === undefined
        ? {}
        : {
            axisCoordinates: level.axisCoordinates.filter((entry) => entry.axisId !== spectralAxis),
          }),
    }))
    this.#source = source
    this.#operation = operation
    this.spectralAxis = spectralAxis
    this.sourceIndices = Object.freeze([...sourceIndices])
    this.descriptor = normalizeScientificDatasetDescriptor({
      schemaVersion: 1,
      axes,
      sampleType: 'float64',
      components: [{ id: 'value', name, kind: 'scalar' }],
      levels,
      noDataValue: Number.NaN,
      metadata: {
        source: source.descriptor.metadata ?? {},
        derived: { operation: name, spectralAxis, sourceIndices: [...sourceIndices] },
      },
      capabilities: {
        regionReads: source.descriptor.capabilities.regionReads,
        resolutionLevels: levels.length > 1,
        planeReads:
          source.descriptor.capabilities.planeReads.kind === 'any-axis-pair'
            ? source.descriptor.capabilities.planeReads
            : {
                kind: 'ordered-axis-pairs',
                pairs: source.descriptor.capabilities.planeReads.pairs.filter(
                  (pair) => pair[0] !== spectralAxis && pair[1] !== spectralAxis,
                ),
              },
      },
    })
  }

  async *readPlane(request: Readonly<ScientificPlaneReadRequest>): AsyncGenerator<RasterBlock> {
    const normalized = normalizeScientificPlaneReadRequest(this.descriptor, request)
    const firstIndex = this.sourceIndices[0]
    if (firstIndex === undefined) throw invalidInput('Spectral derivation has no source indices')
    const firstRequest: ScientificPlaneReadRequest = {
      displayAxes: normalized.displayAxes,
      fixedIndices: [...normalized.fixedIndices, { axisId: this.spectralAxis, index: firstIndex }],
      resolutionLevel: normalized.resolutionLevel,
      x: normalized.x,
      y: normalized.y,
      width: normalized.width,
      height: normalized.height,
      ...(normalized.signal === undefined ? {} : { signal: normalized.signal }),
    }
    const source = numericSource(this.#source)
    let expectedY = normalized.y
    for await (const tile of source.readNumericTiles({
      ...firstRequest,
      ...(this.#source.descriptor.sampleType === 'uint64' ? { targetSampleType: 'float64' } : {}),
    })) {
      try {
        if (tile.x !== normalized.x || tile.y !== expectedY || tile.width !== normalized.width) {
          throw invalidInput('Labeled spectral source emitted incompatible blocks')
        }
        const sourceValues: Float64Array[] = [tileValues(tile, this.#source.descriptor.noDataValue)]
        for (let index = 1; index < this.sourceIndices.length; index += 1) {
          const sourceIndex = this.sourceIndices[index]
          if (sourceIndex === undefined) continue
          sourceValues.push(
            await readScientificSpectralRegion(this.#source, {
              displayAxes: normalized.displayAxes,
              fixedIndices: [
                ...normalized.fixedIndices,
                { axisId: this.spectralAxis, index: sourceIndex },
              ],
              resolutionLevel: normalized.resolutionLevel,
              x: tile.x,
              y: tile.y,
              width: tile.width,
              height: tile.height,
              ...(normalized.signal === undefined ? {} : { signal: normalized.signal }),
            }),
          )
        }
        const sampleCount = tile.width * tile.height
        const output = new Uint8Array(sampleCount * 8)
        const view = new DataView(output.buffer)
        const values = new Float64Array(sourceValues.length)
        for (let sample = 0; sample < sampleCount; sample += 1) {
          for (let index = 0; index < sourceValues.length; index += 1) {
            values[index] = sourceValues[index]?.[sample] ?? Number.NaN
          }
          view.setFloat64(sample * 8, derivedValue(this.#operation, values), false)
        }
        yield {
          x: tile.x,
          y: tile.y,
          width: tile.width,
          height: tile.height,
          stride: tile.width * 8,
          format: Object.freeze({ sampleType: 'float64', channels: 1, planar: false }),
          data: output,
        }
        expectedY += tile.height
      } finally {
        tile.release()
      }
    }
    if (expectedY !== normalized.y + normalized.height) {
      throw invalidInput('Labeled spectral source emitted an incomplete region')
    }
  }
}

export interface LegacySpectralRangeOptions {
  readonly from: number
  readonly to: number
}

export interface SpectralRangeOptions extends LegacySpectralRangeOptions {
  readonly spectralAxis: string
}

export function integrateSpectralRange(
  dataset: MultidimensionalRasterDataset,
  options: Readonly<LegacySpectralRangeOptions>,
): LegacySpectralDerivedDataset
export function integrateSpectralRange(
  dataset: ScientificDataset,
  options: Readonly<SpectralRangeOptions>,
): SpectralDerivedDataset
export function integrateSpectralRange(
  dataset: MultidimensionalRasterDataset | ScientificDataset,
  options: Readonly<LegacySpectralRangeOptions | SpectralRangeOptions>,
): LegacySpectralDerivedDataset | SpectralDerivedDataset {
  if (!Number.isFinite(options.from) || !Number.isFinite(options.to) || options.from > options.to) {
    throw invalidInput('Spectral integration range requires finite from <= to')
  }
  let allChannels: readonly SpectralChannel[]
  if (isScientificDataset(dataset)) {
    if (!('spectralAxis' in options)) {
      throw invalidInput('Labeled spectral integration requires spectralAxis')
    }
    allChannels = scientificSpectralChannels(dataset, options.spectralAxis)
  } else {
    allChannels = spectralChannels(dataset)
  }
  const channels = allChannels
    .filter(({ center }) => center >= options.from && center <= options.to)
    .sort((left, right) => left.center - right.center)
  if (channels.length === 0) throw invalidInput('Spectral integration range contains no channels')
  if (isScientificDataset(dataset)) {
    if (!('spectralAxis' in options)) {
      throw invalidInput('Labeled spectral integration requires spectralAxis')
    }
    return new DerivedScientificSpectralDataset(
      dataset,
      options.spectralAxis,
      { kind: 'integrate', channels },
      `Integrated ${channels[0]?.center}-${channels.at(-1)?.center}${channels[0]?.unit ? ` ${channels[0].unit}` : ''}`,
      channels.map(({ channel }) => channel),
    )
  }
  return new DerivedSpectralDataset(
    dataset,
    { kind: 'integrate', channels },
    `Integrated ${channels[0]?.center}-${channels.at(-1)?.center}${channels[0]?.unit ? ` ${channels[0].unit}` : ''}`,
    channels.map(({ channel }) => channel),
  )
}

export interface LegacyBandRatioOptions {
  readonly numerator: number
  readonly denominator: number
}

export interface BandRatioOptions extends LegacyBandRatioOptions {
  readonly spectralAxis: string
}

export function bandRatio(
  dataset: MultidimensionalRasterDataset,
  options: Readonly<LegacyBandRatioOptions>,
): LegacySpectralDerivedDataset
export function bandRatio(
  dataset: ScientificDataset,
  options: Readonly<BandRatioOptions>,
): SpectralDerivedDataset
export function bandRatio(
  dataset: MultidimensionalRasterDataset | ScientificDataset,
  options: Readonly<LegacyBandRatioOptions | BandRatioOptions>,
): LegacySpectralDerivedDataset | SpectralDerivedDataset {
  if (isScientificDataset(dataset)) {
    if (!('spectralAxis' in options)) {
      throw invalidInput('Labeled band ratios require spectralAxis')
    }
    const numerator = nearestSpectralChannel(dataset, options.numerator, options.spectralAxis)
    const denominator = nearestSpectralChannel(dataset, options.denominator, options.spectralAxis)
    return new DerivedScientificSpectralDataset(
      dataset,
      options.spectralAxis,
      { kind: 'ratio', numerator, denominator },
      `Ratio ${numerator.selected}/${denominator.selected}${numerator.unit ? ` ${numerator.unit}` : ''}`,
      [numerator.channel, denominator.channel],
    )
  }
  const numerator = nearestSpectralChannel(dataset, options.numerator)
  const denominator = nearestSpectralChannel(dataset, options.denominator)
  return new DerivedSpectralDataset(
    dataset,
    { kind: 'ratio', numerator, denominator },
    `Ratio ${numerator.selected}/${denominator.selected}${numerator.unit ? ` ${numerator.unit}` : ''}`,
    [numerator.channel, denominator.channel],
  )
}
