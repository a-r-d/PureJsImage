import { combineAbortSignals } from '../abort.ts'
import { invalidInput } from '../errors.ts'
import type { PixelBlock } from '../pixel.ts'
import type {
  NormalizedScientificPlaneReadRequest,
  ScientificAxisIndex,
  ScientificDataset,
  ScientificPlaneReadRequest,
} from './dataset.ts'
import { normalizeScientificPlaneReadRequest } from './dataset.ts'
import { isScientificDataset } from './dataset-adapters.ts'
import type { MultidimensionalRasterDataset, RasterPlaneRequest } from './legacy-dataset.ts'
import type { NumericArray, NumericTile, NumericTileSource } from './numeric-tile.ts'
import {
  rasterBlockToNumericTile,
  resolveNumericTileSource,
  validateNumericTile,
} from './numeric-tile.ts'
import { type ScientificPalette, scientificPaletteTable } from './palettes.ts'

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

export interface LegacyScientificPlaneRenderOptions {
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

export interface ScientificPlaneSelection {
  readonly displayAxes: readonly [horizontal: string, vertical: string]
  readonly fixedIndices: readonly ScientificAxisIndex[]
  readonly resolutionLevel?: number
  readonly signal?: AbortSignal
}

export interface ScientificPlaneRenderOptions
  extends Omit<LegacyScientificPlaneRenderOptions, 'plane'> {
  readonly plane: ScientificPlaneSelection
}

/** Options for resolving a quantitative display range without producing display pixels. */
export interface LegacyScientificPlaneMeasureOptions {
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
  readonly signal?: AbortSignal
}

export interface ScientificPlaneMeasureOptions
  extends Omit<LegacyScientificPlaneMeasureOptions, 'plane'> {
  readonly plane: ScientificPlaneSelection
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

export interface LegacyScientificRenderedPlane {
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

export interface ScientificRenderedPlane extends Omit<LegacyScientificRenderedPlane, 'channel'> {
  readonly selection: NormalizedScientificPlaneReadRequest
}

/**
 * A reusable range measurement for one dataset channel and spatial region.
 * Percentile ranges use bounded sampling and are approximate when `sampledValues`
 * is smaller than `finiteSamples`. Explicit ranges do not read the dataset.
 */
export interface LegacyScientificPlaneMeasurement {
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

export interface ScientificPlaneMeasurement
  extends Omit<LegacyScientificPlaneMeasurement, 'channel'> {
  readonly selection: NormalizedScientificPlaneReadRequest
}

export interface ScientificPercentile {
  readonly percentile: number
  readonly value: number
}

export interface ScientificHistogram {
  readonly range: ScientificRenderRange
  /** Explicit `counts.length + 1` lower/upper bin boundaries. */
  readonly binEdges?: Float64Array
  readonly counts: Float64Array
  readonly underflow: number
  readonly overflow: number
}

interface ScalarRow {
  readonly y: number
  readonly values: Exclude<NumericArray, BigUint64Array | BigInt64Array>
  readonly offset: number
  readonly width: number
}

interface ResolvedScalarPlane {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly noDataValue?: number
  readonly channel?: number
  readonly selection?: NormalizedScientificPlaneReadRequest
  read(): AsyncIterable<NumericTile>
}

const numericSource = (dataset: ScientificDataset): NumericTileSource =>
  resolveNumericTileSource(dataset, {
    ...(dataset.descriptor.sampleType === 'uint64' || dataset.descriptor.sampleType === 'int64'
      ? { targetSampleType: 'float64' }
      : {}),
  })

const isScientificPlaneOptions = (
  options:
    | Readonly<LegacyScientificPlaneMeasureOptions>
    | Readonly<ScientificPlaneMeasureOptions>
    | Readonly<LegacyScientificPlaneRenderOptions>
    | Readonly<ScientificPlaneRenderOptions>,
): options is Readonly<ScientificPlaneMeasureOptions> | Readonly<ScientificPlaneRenderOptions> =>
  'displayAxes' in options.plane

const resolveLegacyPlane = (
  dataset: MultidimensionalRasterDataset,
  options: Readonly<LegacyScientificPlaneMeasureOptions>,
): ResolvedScalarPlane => {
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
  const request: RasterPlaneRequest = {
    z: options.plane.z,
    c: options.plane.c,
    t: options.plane.t,
    x,
    y,
    width,
    height,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  }
  return {
    x,
    y,
    width,
    height,
    channel: options.plane.c,
    ...(dataset.noDataValue === undefined ? {} : { noDataValue: dataset.noDataValue }),
    read: async function* () {
      for await (const block of dataset.readPlane(request)) {
        yield rasterBlockToNumericTile(block, {
          ...(block.format.sampleType === 'uint64' || block.format.sampleType === 'int64'
            ? { targetSampleType: 'float64' }
            : {}),
        })
      }
    },
  }
}

const resolveScientificPlane = (
  dataset: ScientificDataset,
  options: Readonly<ScientificPlaneMeasureOptions>,
): ResolvedScalarPlane => {
  if (dataset.descriptor.components.length !== 1) {
    throw invalidInput('Scientific scalar rendering requires exactly one stored component')
  }
  const signal = combineAbortSignals(options.signal, options.plane.signal)
  const request: ScientificPlaneReadRequest = {
    displayAxes: options.plane.displayAxes,
    fixedIndices: options.plane.fixedIndices,
    ...(options.plane.resolutionLevel === undefined
      ? {}
      : { resolutionLevel: options.plane.resolutionLevel }),
    ...(signal === undefined ? {} : { signal }),
    ...(options.x === undefined ? {} : { x: options.x }),
    ...(options.y === undefined ? {} : { y: options.y }),
    ...(options.width === undefined ? {} : { width: options.width }),
    ...(options.height === undefined ? {} : { height: options.height }),
  }
  const normalized = normalizeScientificPlaneReadRequest(dataset.descriptor, request)
  const source = numericSource(dataset)
  return {
    x: normalized.x,
    y: normalized.y,
    width: normalized.width,
    height: normalized.height,
    selection: normalized,
    ...(dataset.descriptor.noDataValue === undefined
      ? {}
      : { noDataValue: dataset.descriptor.noDataValue }),
    read: () =>
      source.readNumericTiles({
        ...normalized,
        ...(dataset.descriptor.sampleType === 'uint64' || dataset.descriptor.sampleType === 'int64'
          ? { targetSampleType: 'float64' }
          : {}),
      }),
  }
}

const scalarRows = async function* (plane: ResolvedScalarPlane): AsyncGenerator<ScalarRow> {
  const expectedX = plane.x
  const expectedWidth = plane.width
  let expectedY = plane.y
  for await (const tile of plane.read()) {
    try {
      if (
        tile.x !== expectedX ||
        tile.y !== expectedY ||
        tile.width !== expectedWidth ||
        tile.componentCount !== 1
      ) {
        throw invalidInput('Scientific dataset emitted non-contiguous plane blocks')
      }
      validateNumericTile(tile)
      if (tile.data instanceof BigUint64Array || tile.data instanceof BigInt64Array) {
        throw invalidInput(
          'Scientific 64-bit integer values must be exactly convertible to float64',
        )
      }
      for (let row = 0; row < tile.height; row += 1) {
        yield {
          y: tile.y + row,
          values: tile.data,
          offset: row * tile.rowStrideElements,
          width: tile.width,
        }
      }
      expectedY += tile.height
    } finally {
      tile.release()
    }
  }
  const requestedEnd = plane.y + plane.height
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
  readonly histogram?: ScientificHistogram
}

const percentileIndex = (length: number, percentile: number): number =>
  Math.max(0, Math.min(length - 1, Math.round((percentile / 100) * (length - 1))))

const scanRange = async (
  plane: ResolvedScalarPlane,
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
  const totalPixels = plane.width * plane.height
  const sampleStride =
    range.mode === 'percentile' ? Math.max(1, Math.ceil(totalPixels / maxSamples)) : 1
  const samples = new Float64Array(maxSamples)
  let sampledValues = 0
  let minimum = Number.POSITIVE_INFINITY
  let maximum = Number.NEGATIVE_INFINITY
  let finiteSamples = 0
  let ordinal = 0
  for await (const row of scalarRows(plane)) {
    const end = row.offset + row.width
    for (let index = row.offset; index < end; index += 1) {
      const value = row.values[index] ?? Number.NaN
      if (usableValue(value, plane.noDataValue)) {
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
  plane: ResolvedScalarPlane,
  options: Readonly<ScientificStatisticsRequest>,
  histogramDefaultRange: ScientificRenderRange,
): Promise<StatisticsScan> => {
  const validated = validatedStatistics(options)
  const histogramRange = validated.histogram?.range ?? histogramDefaultRange
  const histogramCounts =
    validated.histogram === undefined ? undefined : new Float64Array(validated.histogram.bins)
  const histogramEdges =
    validated.histogram === undefined ? undefined : new Float64Array(validated.histogram.bins + 1)
  const histogramSpan = histogramRange.max - histogramRange.min
  if (histogramEdges !== undefined && histogramCounts !== undefined) {
    if (!Number.isFinite(histogramSpan)) {
      throw invalidInput('Scientific histogram range span must be finite')
    }
    const binWidth = histogramSpan / histogramCounts.length
    for (let index = 0; index <= histogramCounts.length; index += 1) {
      const edge =
        index === histogramCounts.length
          ? histogramRange.max
          : histogramRange.min + binWidth * index
      if (index > 0 && edge <= (histogramEdges[index - 1] ?? Number.NaN)) {
        throw invalidInput('Scientific histogram range is too narrow for the requested bin count')
      }
      histogramEdges[index] = edge
    }
  }
  let histogramUnderflow = 0
  let histogramOverflow = 0
  const totalPixels = plane.width * plane.height
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
  for await (const row of scalarRows(plane)) {
    const end = row.offset + row.width
    for (let index = row.offset; index < end; index += 1) {
      const value = row.values[index] ?? Number.NaN
      if (!usableValue(value, plane.noDataValue)) {
        invalidSamples += 1
        ordinal += 1
        continue
      }
      finiteSamples += 1
      if (histogramCounts !== undefined) {
        if (value < histogramRange.min) histogramUnderflow += 1
        else if (value > histogramRange.max) histogramOverflow += 1
        else {
          const histogramIndex =
            value === histogramRange.max
              ? histogramCounts.length - 1
              : Math.floor(((value - histogramRange.min) / histogramSpan) * histogramCounts.length)
          histogramCounts[histogramIndex] = (histogramCounts[histogramIndex] ?? 0) + 1
        }
      }
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
      ...(histogramCounts === undefined || histogramEdges === undefined
        ? {}
        : {
            histogram: Object.freeze({
              range: Object.freeze({ ...histogramRange }),
              binEdges: histogramEdges,
              counts: histogramCounts,
              underflow: histogramUnderflow,
              overflow: histogramOverflow,
            }),
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
    ...(histogramCounts === undefined || histogramEdges === undefined
      ? {}
      : {
          histogram: Object.freeze({
            range: Object.freeze({ ...histogramRange }),
            binEdges: histogramEdges,
            counts: histogramCounts,
            underflow: histogramUnderflow,
            overflow: histogramOverflow,
          }),
        }),
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
  plane: ResolvedScalarPlane,
  range: ScientificRenderRange,
  palette: Uint8Array,
  scale: ScientificDisplayScale,
  relief: ResolvedRelief | undefined,
): AsyncGenerator<PixelBlock> {
  if (relief === undefined) {
    for await (const row of scalarRows(plane)) {
      const output = new Uint8Array(row.width * 3)
      for (let x = 0; x < row.width; x += 1) {
        const value = row.values[row.offset + x] ?? Number.NaN
        const outputOffset = x * 3
        if (!usableValue(value, plane.noDataValue)) continue
        const paletteOffset = Math.round(scaledValue(value, range, scale) * 255) * 3
        output[outputOffset] = palette[paletteOffset] ?? 0
        output[outputOffset + 1] = palette[paletteOffset + 1] ?? 0
        output[outputOffset + 2] = palette[paletteOffset + 2] ?? 0
      }
      yield {
        x: plane.x,
        y: row.y,
        width: row.width,
        height: 1,
        stride: row.width * 3,
        format: 'rgb8',
        data: output,
      }
    }
    return
  }
  const materialize = (row: ScalarRow): Float64Array => {
    const output = new Float64Array(row.width)
    for (let x = 0; x < row.width; x += 1) {
      output[x] = row.values[row.offset + x] ?? Number.NaN
    }
    return output
  }
  const iterator = scalarRows(plane)[Symbol.asyncIterator]()
  const currentResult = await iterator.next()
  if (currentResult.done) return
  let previous = materialize(currentResult.value)
  let currentY = currentResult.value.y
  let current = previous
  let nextResult = await iterator.next()
  while (true) {
    const next = nextResult.done ? current : materialize(nextResult.value)
    const output = new Uint8Array(current.length * 3)
    for (let x = 0; x < current.length; x += 1) {
      const value = current[x] ?? Number.NaN
      const outputOffset = x * 3
      if (!usableValue(value, plane.noDataValue)) {
        output[outputOffset] = 0
        output[outputOffset + 1] = 0
        output[outputOffset + 2] = 0
        continue
      }
      const paletteOffset = Math.round(scaledValue(value, range, scale) * 255) * 3
      const factor = reliefFactor(previous, current, next, x, range, relief)
      output[outputOffset] = Math.round((palette[paletteOffset] ?? 0) * factor)
      output[outputOffset + 1] = Math.round((palette[paletteOffset + 1] ?? 0) * factor)
      output[outputOffset + 2] = Math.round((palette[paletteOffset + 2] ?? 0) * factor)
    }
    yield {
      x: plane.x,
      y: currentY,
      width: current.length,
      height: 1,
      stride: current.length * 3,
      format: 'rgb8',
      data: output,
    }
    if (nextResult.done) return
    previous = current
    currentY = nextResult.value.y
    current = next
    nextResult = await iterator.next()
  }
}

/**
 * Resolves an explicit, dataset, or approximate percentile range for one plane.
 * Dataset and percentile modes lazily scan the selected ROI once. The returned
 * range can be passed back as an explicit range to avoid another measurement
 * when palette, display transfer, or relief settings change.
 */
const measureResolvedPlane = async (
  plane: ResolvedScalarPlane,
  options: Readonly<LegacyScientificPlaneMeasureOptions | ScientificPlaneMeasureOptions>,
): Promise<LegacyScientificPlaneMeasurement | ScientificPlaneMeasurement> => {
  const rangeMode = options.range ?? { mode: 'percentile', low: 1, high: 99 }
  const scan = await scanRange(plane, rangeMode)
  const requestedStatistics = options.statistics
  const statistics =
    requestedStatistics === undefined
      ? undefined
      : await scanStatistics(plane, requestedStatistics, scan.range)
  const histogram = statistics?.histogram
  return Object.freeze({
    range: Object.freeze(scan.range),
    finiteSamples: statistics?.finiteSamples ?? scan.finiteSamples,
    sampledValues: scan.sampledValues,
    roi: Object.freeze({ x: plane.x, y: plane.y, width: plane.width, height: plane.height }),
    ...(plane.selection === undefined
      ? { channel: plane.channel ?? 0 }
      : { selection: plane.selection }),
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

export function measureScientificPlane(
  dataset: MultidimensionalRasterDataset,
  options: Readonly<LegacyScientificPlaneMeasureOptions>,
): Promise<LegacyScientificPlaneMeasurement>
export function measureScientificPlane(
  dataset: ScientificDataset,
  options: Readonly<ScientificPlaneMeasureOptions>,
): Promise<ScientificPlaneMeasurement>
export function measureScientificPlane(
  dataset: MultidimensionalRasterDataset | ScientificDataset,
  options: Readonly<LegacyScientificPlaneMeasureOptions | ScientificPlaneMeasureOptions>,
): Promise<LegacyScientificPlaneMeasurement | ScientificPlaneMeasurement> {
  if (isScientificDataset(dataset)) {
    if (!isScientificPlaneOptions(options)) {
      throw invalidInput('A labeled-axis dataset requires a labeled plane selection')
    }
    return measureResolvedPlane(resolveScientificPlane(dataset, options), options)
  }
  if (isScientificPlaneOptions(options)) {
    throw invalidInput('A fixed-axis dataset requires z, c, and t plane coordinates')
  }
  return measureResolvedPlane(resolveLegacyPlane(dataset, options), options)
}

/**
 * Maps one native numeric plane to lazy RGB display blocks. Dataset and
 * percentile ranges measure the selected plane before the returned iterator
 * reads it again for rendering. Call `measureScientificPlane()` and pass its
 * result as an explicit range when an application needs to reuse that scan.
 * Display transfer and relief affect display pixels only; relief is hillshading
 * in sample coordinates and does not use physical X/Y spacing.
 */
export function renderScientificPlane(
  dataset: MultidimensionalRasterDataset,
  options: Readonly<LegacyScientificPlaneRenderOptions>,
): Promise<LegacyScientificRenderedPlane>
export function renderScientificPlane(
  dataset: ScientificDataset,
  options: Readonly<ScientificPlaneRenderOptions>,
): Promise<ScientificRenderedPlane>
export async function renderScientificPlane(
  dataset: MultidimensionalRasterDataset | ScientificDataset,
  options: Readonly<LegacyScientificPlaneRenderOptions | ScientificPlaneRenderOptions>,
): Promise<LegacyScientificRenderedPlane | ScientificRenderedPlane> {
  let plane: ResolvedScalarPlane
  if (isScientificDataset(dataset)) {
    if (!isScientificPlaneOptions(options)) {
      throw invalidInput('A labeled-axis dataset requires a labeled plane selection')
    }
    plane = resolveScientificPlane(dataset, options)
  } else {
    if (isScientificPlaneOptions(options)) {
      throw invalidInput('A fixed-axis dataset requires z, c, and t plane coordinates')
    }
    plane = resolveLegacyPlane(dataset, options)
  }
  const measured = await measureResolvedPlane(plane, options)
  const palette = scientificPaletteTable(options.palette ?? 'grayscale')
  const scale = options.scale ?? 'linear'
  if (scale !== 'linear' && scale !== 'log' && scale !== 'sqrt' && scale !== 'asinh') {
    throw invalidInput(`Unknown scientific display scale ${scale}`)
  }
  const relief = resolveRelief(options.relief)
  return Object.freeze({
    x: plane.x,
    y: plane.y,
    width: plane.width,
    height: plane.height,
    ...(plane.selection === undefined
      ? { channel: plane.channel ?? 0 }
      : { selection: plane.selection }),
    range: measured.range,
    finiteSamples: measured.finiteSamples,
    sampledValues: measured.sampledValues,
    pixels: {
      [Symbol.asyncIterator]: () => renderRows(plane, measured.range, palette, scale, relief),
    },
  })
}
