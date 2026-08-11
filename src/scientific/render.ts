import { invalidInput } from '../errors.ts'
import type { PixelBlock } from '../pixel.ts'
import type { RasterPlaneRequest } from './dataset.ts'
import type { MultidimensionalRasterDataset } from './dataset.ts'
import { scientificPaletteColor, type ScientificPalette } from './palettes.ts'
import { rasterSampleOffset, readRasterSample, validateRasterBlock } from './samples.ts'

export type ScientificDisplayScale = 'linear' | 'log' | 'sqrt' | 'asinh'

export type ScientificRange =
  | { readonly mode: 'explicit'; readonly min: number; readonly max: number }
  | { readonly mode: 'dataset' }
  | {
      readonly mode: 'percentile'
      readonly low?: number
      readonly high?: number
      readonly maxSamples?: number
    }

export interface ScientificReliefOptions {
  readonly azimuth?: number
  readonly elevation?: number
  readonly strength?: number
}

export interface ScientificPlaneRenderOptions {
  readonly plane: {
    readonly z: number
    readonly c: number
    readonly t: number
  }
  readonly x?: number
  readonly y?: number
  readonly width?: number
  readonly height?: number
  readonly range?: ScientificRange
  readonly scale?: ScientificDisplayScale
  readonly palette?: ScientificPalette
  readonly relief?: false | ScientificReliefOptions
}

export interface ScientificRenderRange {
  readonly min: number
  readonly max: number
}

export interface ScientificRenderedPlane {
  readonly width: number
  readonly height: number
  readonly x: number
  readonly y: number
  readonly channel: number
  readonly range: ScientificRenderRange
  readonly finiteSamples: number
  readonly sampledValues: number
  readonly pixels: AsyncIterable<PixelBlock>
}

interface ScalarRow {
  readonly y: number
  readonly values: Float64Array
}

const selectedRegion = (
  dataset: MultidimensionalRasterDataset,
  options: Readonly<ScientificPlaneRenderOptions>,
): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } => {
  if (
    !Number.isSafeInteger(options.plane.c) ||
    options.plane.c < 0 ||
    options.plane.c >= dataset.sizeC
  ) {
    throw invalidInput('Scientific render channel is outside the dataset')
  }
  const x = options.x ?? 0
  const y = options.y ?? 0
  const width = options.width ?? dataset.sizeX - x
  const height = options.height ?? dataset.sizeY - y
  if (
    !Number.isSafeInteger(x) ||
    !Number.isSafeInteger(y) ||
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    x < 0 ||
    y < 0 ||
    width < 1 ||
    height < 1 ||
    x + width > dataset.sizeX ||
    y + height > dataset.sizeY
  ) {
    throw invalidInput('Scientific render region is outside the dataset')
  }
  return { x, y, width, height }
}

const planeRequest = (
  options: Readonly<ScientificPlaneRenderOptions>,
  region: {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
  },
): RasterPlaneRequest => ({
  z: options.plane.z,
  c: options.plane.c,
  t: options.plane.t,
  ...region,
})

const scalarRows = async function* (
  dataset: MultidimensionalRasterDataset,
  request: Readonly<RasterPlaneRequest>,
): AsyncGenerator<ScalarRow> {
  const expectedX = request.x ?? 0
  const expectedWidth = request.width ?? dataset.sizeX
  let expectedY = request.y ?? 0
  for await (const block of dataset.readPlane(request)) {
    try {
      if (
        block.x !== expectedX ||
        block.y !== expectedY ||
        block.width !== expectedWidth ||
        block.format.channels !== 1
      ) {
        throw invalidInput('Scientific dataset emitted non-contiguous plane blocks')
      }
      const layout = validateRasterBlock(block)
      const view = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength)
      for (let row = 0; row < block.height; row += 1) {
        const values = new Float64Array(block.width)
        for (let x = 0; x < block.width; x += 1) {
          values[x] = readRasterSample(
            block.data,
            view,
            rasterSampleOffset(block, layout, x, row, 0),
            block.format.sampleType,
          )
        }
        yield { y: block.y + row, values }
      }
      expectedY += block.height
    } finally {
      block.release?.()
    }
  }
  const requestedEnd = (request.y ?? 0) + (request.height ?? dataset.sizeY)
  if (expectedY !== requestedEnd)
    throw invalidInput('Scientific dataset emitted an incomplete plane')
}

const usableValue = (value: number, noDataValue: number | undefined): boolean =>
  Number.isFinite(value) &&
  (noDataValue === undefined ||
    (Number.isNaN(noDataValue) ? !Number.isNaN(value) : value !== noDataValue))

interface RangeScan {
  readonly range: ScientificRenderRange
  readonly finiteSamples: number
  readonly sampledValues: number
}

const percentileIndex = (length: number, percentile: number): number =>
  Math.max(0, Math.min(length - 1, Math.round((percentile / 100) * (length - 1))))

const scanRange = async (
  dataset: MultidimensionalRasterDataset,
  request: Readonly<RasterPlaneRequest>,
  range: ScientificRange,
): Promise<RangeScan> => {
  if (range.mode === 'explicit') {
    if (!Number.isFinite(range.min) || !Number.isFinite(range.max) || range.min >= range.max) {
      throw invalidInput('Scientific explicit display range must contain finite min < max')
    }
    return { range: { min: range.min, max: range.max }, finiteSamples: 0, sampledValues: 0 }
  }
  const low = range.mode === 'percentile' ? (range.low ?? 1) : 0
  const high = range.mode === 'percentile' ? (range.high ?? 99) : 100
  if (!Number.isFinite(low) || !Number.isFinite(high) || low < 0 || high > 100 || low >= high) {
    throw invalidInput('Scientific percentile range must satisfy 0 <= low < high <= 100')
  }
  const maxSamples = range.mode === 'percentile' ? (range.maxSamples ?? 65_536) : 0
  if (range.mode === 'percentile' && (!Number.isSafeInteger(maxSamples) || maxSamples < 2)) {
    throw invalidInput('Scientific percentile maxSamples must be a safe integer of at least 2')
  }
  const totalPixels = (request.width ?? dataset.sizeX) * (request.height ?? dataset.sizeY)
  const sampleStride =
    range.mode === 'percentile' ? Math.max(1, Math.ceil(totalPixels / maxSamples)) : 1
  const samples: number[] = []
  let minimum = Number.POSITIVE_INFINITY
  let maximum = Number.NEGATIVE_INFINITY
  let finiteSamples = 0
  let ordinal = 0
  for await (const row of scalarRows(dataset, request)) {
    for (const value of row.values) {
      if (usableValue(value, dataset.noDataValue)) {
        finiteSamples += 1
        minimum = Math.min(minimum, value)
        maximum = Math.max(maximum, value)
        if (range.mode === 'percentile' && ordinal % sampleStride === 0) samples.push(value)
      }
      ordinal += 1
    }
  }
  if (finiteSamples === 0) throw invalidInput('Scientific plane contains no finite display samples')
  if (range.mode === 'percentile') {
    if (samples.length === 0) throw invalidInput('Scientific percentile sample is empty')
    samples.sort((left, right) => left - right)
    minimum = samples[percentileIndex(samples.length, low)] ?? minimum
    maximum = samples[percentileIndex(samples.length, high)] ?? maximum
  }
  if (minimum === maximum) {
    const delta = minimum === 0 ? 1 : Math.abs(minimum) * 0.5
    minimum -= delta
    maximum += delta
  }
  return {
    range: { min: minimum, max: maximum },
    finiteSamples,
    sampledValues: samples.length,
  }
}

const scaledValue = (
  value: number,
  range: ScientificRenderRange,
  scale: ScientificDisplayScale,
): number => {
  const linear = Math.max(0, Math.min(1, (value - range.min) / (range.max - range.min)))
  if (scale === 'linear') return linear
  if (scale === 'sqrt') return Math.sqrt(linear)
  if (scale === 'log') return Math.log1p(linear * 999) / Math.log(1_000)
  return Math.asinh(linear * 10) / Math.asinh(10)
}

interface ResolvedRelief {
  readonly lightX: number
  readonly lightY: number
  readonly lightZ: number
  readonly strength: number
}

const resolveRelief = (
  relief: false | ScientificReliefOptions | undefined,
): ResolvedRelief | undefined => {
  if (relief === false || relief === undefined) return undefined
  const azimuth = relief.azimuth ?? 315
  const elevation = relief.elevation ?? 45
  const strength = relief.strength ?? 0.5
  if (
    !Number.isFinite(azimuth) ||
    !Number.isFinite(elevation) ||
    elevation < 0 ||
    elevation > 90 ||
    !Number.isFinite(strength) ||
    strength < 0 ||
    strength > 1
  ) {
    throw invalidInput(
      'Scientific relief requires finite azimuth, elevation 0..90, and strength 0..1',
    )
  }
  const azimuthRadians = (azimuth * Math.PI) / 180
  const elevationRadians = (elevation * Math.PI) / 180
  const horizontal = Math.cos(elevationRadians)
  return {
    lightX: Math.sin(azimuthRadians) * horizontal,
    lightY: -Math.cos(azimuthRadians) * horizontal,
    lightZ: Math.sin(elevationRadians),
    strength,
  }
}

const reliefFactor = (
  previous: Float64Array,
  current: Float64Array,
  next: Float64Array,
  x: number,
  range: ScientificRenderRange,
  relief: ResolvedRelief,
): number => {
  const left = current[Math.max(0, x - 1)] ?? current[x] ?? range.min
  const right = current[Math.min(current.length - 1, x + 1)] ?? current[x] ?? range.min
  const above = previous[x] ?? current[x] ?? range.min
  const below = next[x] ?? current[x] ?? range.min
  if (![left, right, above, below].every(Number.isFinite)) return 1
  const span = range.max - range.min
  const dx = ((right - left) / span) * 2
  const dy = ((below - above) / span) * 2
  const length = Math.hypot(dx, dy, 1)
  const shade = Math.max(
    0,
    (-dx / length) * relief.lightX + (-dy / length) * relief.lightY + (1 / length) * relief.lightZ,
  )
  const lit = 0.35 + shade * 0.65
  return 1 - relief.strength + relief.strength * lit
}

const renderRows = async function* (
  dataset: MultidimensionalRasterDataset,
  request: Readonly<RasterPlaneRequest>,
  range: ScientificRenderRange,
  palette: ScientificPalette,
  scale: ScientificDisplayScale,
  relief: ResolvedRelief | undefined,
): AsyncGenerator<PixelBlock> {
  const iterator = scalarRows(dataset, request)[Symbol.asyncIterator]()
  let currentResult = await iterator.next()
  if (currentResult.done) return
  let previous = currentResult.value.values
  let current = currentResult.value
  let nextResult = await iterator.next()
  while (true) {
    const next = nextResult.done ? current.values : nextResult.value.values
    const output = new Uint8Array(current.values.length * 3)
    for (let x = 0; x < current.values.length; x += 1) {
      const value = current.values[x] ?? Number.NaN
      const outputOffset = x * 3
      if (!usableValue(value, dataset.noDataValue)) {
        output[outputOffset] = 0
        output[outputOffset + 1] = 0
        output[outputOffset + 2] = 0
        continue
      }
      const color = scientificPaletteColor(palette, scaledValue(value, range, scale))
      const factor =
        relief === undefined ? 1 : reliefFactor(previous, current.values, next, x, range, relief)
      output[outputOffset] = Math.round(color[0] * factor)
      output[outputOffset + 1] = Math.round(color[1] * factor)
      output[outputOffset + 2] = Math.round(color[2] * factor)
    }
    yield {
      x: request.x ?? 0,
      y: current.y,
      width: current.values.length,
      height: 1,
      stride: current.values.length * 3,
      format: 'rgb8',
      data: output,
    }
    if (nextResult.done) return
    previous = current.values
    current = nextResult.value
    nextResult = await iterator.next()
  }
}

export const renderScientificPlane = async (
  dataset: MultidimensionalRasterDataset,
  options: Readonly<ScientificPlaneRenderOptions>,
): Promise<ScientificRenderedPlane> => {
  const region = selectedRegion(dataset, options)
  const request = planeRequest(options, region)
  const rangeMode = options.range ?? { mode: 'percentile', low: 1, high: 99 }
  const scan = await scanRange(dataset, request, rangeMode)
  const palette = options.palette ?? 'grayscale'
  const scale = options.scale ?? 'linear'
  if (scale !== 'linear' && scale !== 'log' && scale !== 'sqrt' && scale !== 'asinh') {
    throw invalidInput(`Unknown scientific display scale ${scale}`)
  }
  const relief = resolveRelief(options.relief)
  return Object.freeze({
    ...region,
    channel: options.plane.c,
    range: Object.freeze(scan.range),
    finiteSamples: scan.finiteSamples,
    sampledValues: scan.sampledValues,
    pixels: {
      [Symbol.asyncIterator]: () =>
        renderRows(dataset, request, scan.range, palette, scale, relief),
    },
  })
}
