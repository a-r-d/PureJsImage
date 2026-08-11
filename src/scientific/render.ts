import { invalidInput } from '../errors.ts'
import type { PixelBlock } from '../pixel.ts'
import type { RasterPlaneRequest } from './dataset.ts'
import type { MultidimensionalRasterDataset } from './dataset.ts'
import { scientificPaletteTable, type ScientificPalette } from './palettes.ts'
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

/** Options for resolving a quantitative display range without producing display pixels. */
export interface ScientificPlaneMeasureOptions {
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
  readonly statistics?: ScientificStatisticsRequest
}

export interface ScientificStatisticsRequest {
  readonly mean?: boolean
  /** Population standard deviation computed with Welford's running algorithm. */
  readonly standardDeviation?: boolean
  readonly invalidSamples?: boolean
  readonly percentiles?: readonly number[]
  readonly percentileMaxSamples?: number
  readonly histogram?: {
    readonly bins: number
    readonly range?: ScientificRenderRange
  }
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

/**
 * A reusable range measurement for one dataset channel and spatial region.
 * Percentile ranges use bounded sampling and are approximate when `sampledValues`
 * is smaller than `finiteSamples`. Explicit ranges do not read the dataset.
 */
export interface ScientificPlaneMeasurement {
  readonly range: ScientificRenderRange
  readonly finiteSamples: number
  readonly sampledValues: number
  readonly roi: {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
  }
  readonly channel: number
  readonly mean?: number
  readonly standardDeviation?: number
  readonly invalidSamples?: number
  readonly percentiles?: readonly ScientificPercentile[]
  readonly histogram?: ScientificHistogram
}

export interface ScientificPercentile {
  readonly percentile: number
  readonly value: number
}

export interface ScientificHistogram {
  readonly range: ScientificRenderRange
  readonly counts: Float64Array
  readonly underflow: number
  readonly overflow: number
}

interface ScalarRow {
  readonly y: number
  readonly values: Float64Array
}

const selectedRegion = (
  dataset: MultidimensionalRasterDataset,
  options: Readonly<ScientificPlaneMeasureOptions>,
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
  options: Readonly<ScientificPlaneMeasureOptions>,
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

interface StatisticsScan {
  readonly finiteSamples: number
  readonly invalidSamples: number
  readonly mean: number
  readonly standardDeviation: number
  readonly percentiles?: readonly ScientificPercentile[]
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
  const samples = new Float64Array(maxSamples)
  let sampledValues = 0
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
        if (
          range.mode === 'percentile' &&
          ordinal % sampleStride === 0 &&
          sampledValues < samples.length
        ) {
          samples[sampledValues] = value
          sampledValues += 1
        }
      }
      ordinal += 1
    }
  }
  if (finiteSamples === 0) throw invalidInput('Scientific plane contains no finite display samples')
  if (range.mode === 'percentile') {
    if (sampledValues === 0) throw invalidInput('Scientific percentile sample is empty')
    const sorted = samples.subarray(0, sampledValues)
    sorted.sort()
    minimum = sorted[percentileIndex(sampledValues, low)] ?? minimum
    maximum = sorted[percentileIndex(sampledValues, high)] ?? maximum
  }
  if (minimum === maximum) {
    const delta = minimum === 0 ? 1 : Math.abs(minimum) * 0.5
    minimum -= delta
    maximum += delta
  }
  return {
    range: { min: minimum, max: maximum },
    finiteSamples,
    sampledValues,
  }
}

const validatedStatistics = (
  request: Readonly<ScientificStatisticsRequest>,
): {
  readonly percentiles: readonly number[]
  readonly percentileMaxSamples: number
  readonly histogram?: { readonly bins: number; readonly range?: ScientificRenderRange }
} => {
  const percentiles = request.percentiles ?? []
  if (
    percentiles.some(
      (percentile) => !Number.isFinite(percentile) || percentile < 0 || percentile > 100,
    )
  ) {
    throw invalidInput('Scientific percentiles must be finite values from 0 through 100')
  }
  const percentileMaxSamples = request.percentileMaxSamples ?? 65_536
  if (!Number.isSafeInteger(percentileMaxSamples) || percentileMaxSamples < 2) {
    throw invalidInput('Scientific percentileMaxSamples must be a safe integer of at least 2')
  }
  const histogram = request.histogram
  if (histogram !== undefined) {
    if (!Number.isSafeInteger(histogram.bins) || histogram.bins < 1 || histogram.bins > 65_536) {
      throw invalidInput('Scientific histogram bins must be a safe integer from 1 through 65536')
    }
    if (
      histogram.range !== undefined &&
      (!Number.isFinite(histogram.range.min) ||
        !Number.isFinite(histogram.range.max) ||
        histogram.range.min >= histogram.range.max)
    ) {
      throw invalidInput('Scientific histogram range must contain finite min < max')
    }
  }
  return {
    percentiles: Object.freeze([...percentiles]),
    percentileMaxSamples,
    ...(histogram === undefined ? {} : { histogram }),
  }
}

const scanStatistics = async (
  dataset: MultidimensionalRasterDataset,
  request: Readonly<RasterPlaneRequest>,
  options: Readonly<ScientificStatisticsRequest>,
): Promise<StatisticsScan> => {
  const validated = validatedStatistics(options)
  const totalPixels = (request.width ?? dataset.sizeX) * (request.height ?? dataset.sizeY)
  const sampleStride = Math.max(1, Math.ceil(totalPixels / validated.percentileMaxSamples))
  const samples =
    validated.percentiles.length === 0
      ? undefined
      : new Float64Array(validated.percentileMaxSamples)
  let sampledValues = 0
  let finiteSamples = 0
  let invalidSamples = 0
  let mean = 0
  let sumSquaredDifferences = 0
  let ordinal = 0
  for await (const row of scalarRows(dataset, request)) {
    for (const value of row.values) {
      if (!usableValue(value, dataset.noDataValue)) {
        invalidSamples += 1
        ordinal += 1
        continue
      }
      finiteSamples += 1
      const delta = value - mean
      mean += delta / finiteSamples
      sumSquaredDifferences += delta * (value - mean)
      if (samples !== undefined && ordinal % sampleStride === 0 && sampledValues < samples.length) {
        samples[sampledValues] = value
        sampledValues += 1
      }
      ordinal += 1
    }
  }
  if (finiteSamples === 0) {
    return {
      finiteSamples: 0,
      invalidSamples,
      mean: Number.NaN,
      standardDeviation: Number.NaN,
      ...(validated.percentiles.length === 0
        ? {}
        : {
            percentiles: Object.freeze(
              validated.percentiles.map((percentile) =>
                Object.freeze({ percentile, value: Number.NaN }),
              ),
            ),
          }),
    }
  }
  let percentiles: readonly ScientificPercentile[] | undefined
  if (samples !== undefined) {
    const sorted = samples.subarray(0, sampledValues)
    sorted.sort()
    percentiles = Object.freeze(
      validated.percentiles.map((percentile) =>
        Object.freeze({
          percentile,
          value: sorted[percentileIndex(sampledValues, percentile)] ?? Number.NaN,
        }),
      ),
    )
  }
  return {
    finiteSamples,
    invalidSamples,
    mean,
    standardDeviation: Math.sqrt(sumSquaredDifferences / finiteSamples),
    ...(percentiles === undefined ? {} : { percentiles }),
  }
}

const scanHistogram = async (
  dataset: MultidimensionalRasterDataset,
  request: Readonly<RasterPlaneRequest>,
  bins: number,
  range: ScientificRenderRange,
): Promise<ScientificHistogram> => {
  const counts = new Float64Array(bins)
  let underflow = 0
  let overflow = 0
  const span = range.max - range.min
  for await (const row of scalarRows(dataset, request)) {
    for (const value of row.values) {
      if (!usableValue(value, dataset.noDataValue)) continue
      if (value < range.min) {
        underflow += 1
      } else if (value > range.max) {
        overflow += 1
      } else {
        const index =
          value === range.max ? bins - 1 : Math.floor(((value - range.min) / span) * bins)
        counts[index] = (counts[index] ?? 0) + 1
      }
    }
  }
  return Object.freeze({ range: Object.freeze({ ...range }), counts, underflow, overflow })
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
  if (
    !Number.isFinite(left) ||
    !Number.isFinite(right) ||
    !Number.isFinite(above) ||
    !Number.isFinite(below)
  ) {
    return 1
  }
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
  palette: Uint8Array,
  scale: ScientificDisplayScale,
  relief: ResolvedRelief | undefined,
): AsyncGenerator<PixelBlock> {
  const iterator = scalarRows(dataset, request)[Symbol.asyncIterator]()
  const currentResult = await iterator.next()
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
      const paletteOffset = Math.round(scaledValue(value, range, scale) * 255) * 3
      const factor =
        relief === undefined ? 1 : reliefFactor(previous, current.values, next, x, range, relief)
      output[outputOffset] = Math.round((palette[paletteOffset] ?? 0) * factor)
      output[outputOffset + 1] = Math.round((palette[paletteOffset + 1] ?? 0) * factor)
      output[outputOffset + 2] = Math.round((palette[paletteOffset + 2] ?? 0) * factor)
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

/**
 * Resolves an explicit, dataset, or approximate percentile range for one plane.
 * Dataset and percentile modes lazily scan the selected ROI once. The returned
 * range can be passed back as an explicit range to avoid another measurement
 * when palette, display transfer, or relief settings change.
 */
export const measureScientificPlane = async (
  dataset: MultidimensionalRasterDataset,
  options: Readonly<ScientificPlaneMeasureOptions>,
): Promise<ScientificPlaneMeasurement> => {
  const roi = selectedRegion(dataset, options)
  const request = planeRequest(options, roi)
  const rangeMode = options.range ?? { mode: 'percentile', low: 1, high: 99 }
  const scan = await scanRange(dataset, request, rangeMode)
  const requestedStatistics = options.statistics
  const statistics =
    requestedStatistics === undefined
      ? undefined
      : await scanStatistics(dataset, request, requestedStatistics)
  const histogramRequest = requestedStatistics?.histogram
  const histogram =
    histogramRequest === undefined
      ? undefined
      : await scanHistogram(
          dataset,
          request,
          histogramRequest.bins,
          histogramRequest.range ?? scan.range,
        )
  return Object.freeze({
    range: Object.freeze(scan.range),
    finiteSamples: statistics?.finiteSamples ?? scan.finiteSamples,
    sampledValues: scan.sampledValues,
    roi: Object.freeze(roi),
    channel: options.plane.c,
    ...(requestedStatistics?.mean ? { mean: statistics?.mean ?? Number.NaN } : {}),
    ...(requestedStatistics?.standardDeviation
      ? { standardDeviation: statistics?.standardDeviation ?? Number.NaN }
      : {}),
    ...(requestedStatistics?.invalidSamples
      ? { invalidSamples: statistics?.invalidSamples ?? 0 }
      : {}),
    ...(statistics?.percentiles === undefined ? {} : { percentiles: statistics.percentiles }),
    ...(histogram === undefined ? {} : { histogram }),
  })
}

/**
 * Maps one native numeric plane to lazy RGB display blocks. Dataset and
 * percentile ranges measure the selected plane before the returned iterator
 * reads it again for rendering. Call `measureScientificPlane()` and pass its
 * result as an explicit range when an application needs to reuse that scan.
 * Display transfer and relief affect display pixels only; relief is hillshading
 * in sample coordinates and does not use physical X/Y spacing.
 */
export const renderScientificPlane = async (
  dataset: MultidimensionalRasterDataset,
  options: Readonly<ScientificPlaneRenderOptions>,
): Promise<ScientificRenderedPlane> => {
  const measured = await measureScientificPlane(dataset, options)
  const region = measured.roi
  const request = planeRequest(options, region)
  const palette = scientificPaletteTable(options.palette ?? 'grayscale')
  const scale = options.scale ?? 'linear'
  if (scale !== 'linear' && scale !== 'log' && scale !== 'sqrt' && scale !== 'asinh') {
    throw invalidInput(`Unknown scientific display scale ${scale}`)
  }
  const relief = resolveRelief(options.relief)
  return Object.freeze({
    ...region,
    channel: options.plane.c,
    range: measured.range,
    finiteSamples: measured.finiteSamples,
    sampledValues: measured.sampledValues,
    pixels: {
      [Symbol.asyncIterator]: () =>
        renderRows(dataset, request, measured.range, palette, scale, relief),
    },
  })
}
