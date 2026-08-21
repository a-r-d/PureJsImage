import { throwIfAborted } from '../abort.ts'
import { invalidInput, limitExceeded, unsupportedOperation } from '../errors.ts'
import type { NumericArray, NumericSampleType, NumericTile } from '../scientific/numeric-tile.ts'
import { numericTileSampleOffset, validateNumericTile } from '../scientific/numeric-tile.ts'
import { canonicalJson } from '../analysis/canonical-json.ts'
import type {
  RasterNoData,
  RasterOperationLimits,
  RasterResampling,
} from '../analysis/raster-contracts.ts'
import {
  admitRasterAllocation,
  normalizeRasterNoData,
  numericSampleBytes,
  rasterNoDataNumber,
} from '../analysis/raster-contracts.ts'
import {
  createRasterTargetGridPlan,
  resampleRasterTileToGrid,
} from '../analysis/raster-sampling.ts'
import type { GeoAxisIndex, GeoNumericTile, GeoPixelRegion, GeoRasterView } from './contracts.ts'
import { normalizeGeoPixelRegion } from './contracts.ts'
import type { GeoGridLimits, GeoTargetGrid, ResolvedGeoGridLimits } from './grid.ts'
import {
  canonicalizeGeoTargetGrid,
  geoTargetGridFromGeometry,
  geoTargetGridToNumericRasterGrid,
  normalizeGeoTargetGrid,
  resolveGeoGridLimits,
} from './grid.ts'
import type {
  GeoCoordinateTransformer,
  GeoCoordinateTransformProvider,
  GeoTransformAccuracy,
} from './transform.ts'
import { resolveGeoCoordinateTransformer } from './transform.ts'

export const geoReprojectionSchemaVersion = 1 as const

export interface GeoReprojectionTransformProvenance {
  readonly transformIdentity: string
  readonly implementationIdentity: string
  readonly accuracy: GeoTransformAccuracy
  readonly warnings: readonly string[]
}

export interface GeoReprojectionProvenance {
  readonly schemaVersion: 1
  readonly sourceGridIdentity: string
  readonly targetGridIdentity: string
  readonly transform: GeoReprojectionTransformProvenance
  readonly resampling: RasterResampling
  readonly minimumValidWeight: number
}

export interface GeoReprojectedTile extends GeoNumericTile {
  readonly provenance: GeoReprojectionProvenance
}

export interface GeoReprojectionLimits extends GeoGridLimits {
  readonly maxSourcePixels?: number
}

export interface ResolvedGeoReprojectionLimits extends ResolvedGeoGridLimits {
  readonly maxSourcePixels: number
}

export interface GeoReprojectionNoDataPolicy {
  readonly source?: RasterNoData | readonly RasterNoData[]
  readonly output?: RasterNoData
  /** Bilinear output is nodata when valid contributors have less total weight. */
  readonly minimumValidWeight?: number
}

export interface GeoReprojectReadRequest {
  readonly targetGrid: GeoTargetGrid
  readonly targetRegion: GeoPixelRegion
  readonly sourceBands: readonly number[]
  readonly resampling: RasterResampling
  readonly noData?: GeoReprojectionNoDataPolicy
  readonly transformer?: GeoCoordinateTransformer
  readonly transformProvider?: GeoCoordinateTransformProvider
  readonly signal?: AbortSignal
  readonly limits?: GeoReprojectionLimits
}

export interface GeoReprojectionPlan {
  readonly schemaVersion: 1
  readonly sourceGridIdentity: string
  readonly targetGridIdentity: string
  readonly targetRegion: GeoPixelRegion
  readonly sourceBands: readonly number[]
  readonly resampling: RasterResampling
  readonly sourceNoData: readonly RasterNoData[]
  readonly outputNoData: RasterNoData
  readonly minimumValidWeight: number
  readonly transform: GeoReprojectionTransformProvenance
}

const resolvedLimits = (
  value: Readonly<GeoReprojectionLimits> = {},
): ResolvedGeoReprojectionLimits => {
  const grid = resolveGeoGridLimits(value)
  const maxSourcePixels = value.maxSourcePixels ?? grid.maxOutputPixels
  if (!Number.isSafeInteger(maxSourcePixels) || maxSourcePixels < 1) {
    throw invalidInput('maxSourcePixels must be a positive safe integer')
  }
  return Object.freeze({ ...grid, maxSourcePixels })
}

const numericSampleType = (
  value: GeoRasterView['dataset']['descriptor']['sampleType'],
): NumericSampleType => (value === 'float16' ? 'float32' : value)

const sourceNoDataForBand = (view: GeoRasterView, bandIndex: number): RasterNoData => {
  const band = view.dataset.descriptor.bands.find(
    ({ sourceComponentIndex }) => sourceComponentIndex === bandIndex,
  )
  const value = band?.noData
  if (typeof value === 'number') {
    return Number.isNaN(value)
      ? Object.freeze({ kind: 'nan' })
      : Object.freeze({ kind: 'value', value })
  }
  if (typeof value === 'string') {
    if (value.trim().toLowerCase() === 'nan') return Object.freeze({ kind: 'nan' })
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return Object.freeze({ kind: 'value', value: parsed })
  }
  return Object.freeze({ kind: 'none' })
}

const normalizeBands = (view: GeoRasterView, values: readonly number[]): readonly number[] => {
  if (values.length < 1) throw invalidInput('Reprojected reads require at least one source band')
  const available = new Set(
    view.dataset.descriptor.bands.map(({ sourceComponentIndex }) => sourceComponentIndex),
  )
  const seen = new Set<number>()
  return Object.freeze(
    values.map((value) => {
      if (!Number.isSafeInteger(value) || value < 0 || !available.has(value)) {
        throw invalidInput(`Reprojected source band ${value} is unavailable`)
      }
      if (seen.has(value)) throw invalidInput(`Reprojected source band ${value} is repeated`)
      seen.add(value)
      return value
    }),
  )
}

const normalizeNoDataPolicies = (
  view: GeoRasterView,
  bands: readonly number[],
  policy: Readonly<GeoReprojectionNoDataPolicy> | undefined,
  targetGrid: GeoTargetGrid,
): {
  readonly source: readonly RasterNoData[]
  readonly output: RasterNoData
  readonly minimumValidWeight: number
} => {
  const configured = policy?.source
  let source: readonly RasterNoData[]
  if (configured === undefined) {
    source = Object.freeze(bands.map((band) => sourceNoDataForBand(view, band)))
  } else if (isRasterNoDataArray(configured)) {
    if (configured.length !== bands.length) {
      throw invalidInput('Per-band source nodata must match the selected source bands')
    }
    source = Object.freeze(configured.map((entry) => normalizeRasterNoData(entry)))
  } else {
    const normalized = normalizeRasterNoData(configured)
    source = Object.freeze(bands.map(() => normalized))
  }
  const minimumValidWeight = policy?.minimumValidWeight ?? 0.5
  if (!Number.isFinite(minimumValidWeight) || minimumValidWeight <= 0 || minimumValidWeight > 1) {
    throw invalidInput('minimumValidWeight must be in (0, 1]')
  }
  return Object.freeze({
    source,
    output: normalizeRasterNoData(policy?.output ?? targetGrid.noData),
    minimumValidWeight,
  })
}

const isRasterNoDataArray = (
  value: RasterNoData | readonly RasterNoData[],
): value is readonly RasterNoData[] => Array.isArray(value)

const modelPoint = (
  grid: GeoTargetGrid,
  column: number,
  row: number,
): readonly [number, number] => {
  const offset = grid.pixelRegistration === 'pixel-is-area' ? 0.5 : 0
  const x = column + offset
  const y = row + offset
  return Object.freeze([
    grid.pixelToWorld[0] * x + grid.pixelToWorld[1] * y + grid.pixelToWorld[2],
    grid.pixelToWorld[3] * x + grid.pixelToWorld[4] * y + grid.pixelToWorld[5],
  ])
}

const sourcePixel = (
  grid: GeoTargetGrid,
  worldX: number,
  worldY: number,
): readonly [number, number] => {
  const offset = grid.pixelRegistration === 'pixel-is-area' ? 0.5 : 0
  return Object.freeze([
    grid.worldToPixel[0] * worldX + grid.worldToPixel[1] * worldY + grid.worldToPixel[2] - offset,
    grid.worldToPixel[3] * worldX + grid.worldToPixel[4] * worldY + grid.worldToPixel[5] - offset,
  ])
}

const requiredSourceRegion = (
  sourceGrid: GeoTargetGrid,
  targetGrid: GeoTargetGrid,
  targetRegion: GeoPixelRegion,
  transformer: GeoCoordinateTransformer,
  resampling: RasterResampling,
  signal: AbortSignal | undefined,
): GeoPixelRegion | undefined => {
  if (transformer.inverse === undefined) {
    throw unsupportedOperation('Reprojected reads require an inverse coordinate transform')
  }
  let minimumX = Number.POSITIVE_INFINITY
  let minimumY = Number.POSITIVE_INFINITY
  let maximumX = Number.NEGATIVE_INFINITY
  let maximumY = Number.NEGATIVE_INFINITY
  for (let y = 0; y < targetRegion.height; y += 1) {
    throwIfAborted(signal)
    for (let x = 0; x < targetRegion.width; x += 1) {
      const target = modelPoint(targetGrid, targetRegion.x + x, targetRegion.y + y)
      const sourceWorld = transformer.inverse(target[0], target[1])
      if (
        sourceWorld.length !== 2 ||
        !Number.isFinite(sourceWorld[0]) ||
        !Number.isFinite(sourceWorld[1])
      ) {
        continue
      }
      const pixel = sourcePixel(sourceGrid, sourceWorld[0], sourceWorld[1])
      if (
        pixel[0] < -0.5 ||
        pixel[1] < -0.5 ||
        pixel[0] >= sourceGrid.width - 0.5 ||
        pixel[1] >= sourceGrid.height - 0.5
      ) {
        continue
      }
      const left = resampling === 'nearest' ? Math.round(pixel[0]) : Math.floor(pixel[0])
      const top = resampling === 'nearest' ? Math.round(pixel[1]) : Math.floor(pixel[1])
      const right = resampling === 'nearest' ? left : left + 1
      const bottom = resampling === 'nearest' ? top : top + 1
      minimumX = Math.min(minimumX, left)
      minimumY = Math.min(minimumY, top)
      maximumX = Math.max(maximumX, right)
      maximumY = Math.max(maximumY, bottom)
    }
  }
  if (!Number.isFinite(minimumX)) return undefined
  const x = Math.max(0, minimumX)
  const y = Math.max(0, minimumY)
  const endX = Math.min(sourceGrid.width - 1, maximumX)
  const endY = Math.min(sourceGrid.height - 1, maximumY)
  return Object.freeze({ x, y, width: endX - x + 1, height: endY - y + 1 })
}

const allocateNumericArray = (sampleType: NumericSampleType, length: number): NumericArray => {
  if (sampleType === 'uint8') return new Uint8Array(length)
  if (sampleType === 'uint16') return new Uint16Array(length)
  if (sampleType === 'uint32') return new Uint32Array(length)
  if (sampleType === 'uint64') return new BigUint64Array(length)
  if (sampleType === 'int8') return new Int8Array(length)
  if (sampleType === 'int16') return new Int16Array(length)
  if (sampleType === 'int32') return new Int32Array(length)
  if (sampleType === 'int64') return new BigInt64Array(length)
  if (sampleType === 'float32') return new Float32Array(length)
  return new Float64Array(length)
}

const writeValue = (data: NumericArray, index: number, value: number | bigint): void => {
  if (data instanceof BigInt64Array || data instanceof BigUint64Array) {
    if (typeof value !== 'bigint')
      throw invalidInput('64-bit integer tile received a numeric value')
    data[index] = value
  } else {
    if (typeof value !== 'number') throw invalidInput('Numeric tile received a bigint value')
    data[index] = value
  }
}

const sameFixedIndices = (left: readonly GeoAxisIndex[], right: readonly GeoAxisIndex[]): boolean =>
  left.length === right.length &&
  left.every((entry, index) => {
    const other = right[index]
    return other !== undefined && entry.axisId === other.axisId && entry.index === other.index
  })

const readSourceMosaic = async (
  view: GeoRasterView,
  region: GeoPixelRegion,
  bands: readonly number[],
  sampleType: NumericSampleType,
  signal: AbortSignal | undefined,
): Promise<{ readonly tile: NumericTile; readonly fixedIndices: readonly GeoAxisIndex[] }> => {
  const elementCount = region.width * region.height * bands.length
  if (!Number.isSafeInteger(elementCount)) throw limitExceeded('Source mosaic size overflowed')
  const data = allocateNumericArray(sampleType, elementCount)
  const coverage = new Uint8Array(region.width * region.height)
  let fixedIndices: readonly GeoAxisIndex[] | undefined
  const selectedView = view.dataset.createView({ ...view.selection, sourceBands: bands })
  for await (const tile of selectedView.readPixelRegion({
    region,
    targetSampleType: sampleType,
    ...(signal === undefined ? {} : { signal }),
  })) {
    try {
      throwIfAborted(signal)
      validateNumericTile(tile)
      if (tile.sampleType !== sampleType || tile.componentCount !== bands.length) {
        throw invalidInput('Geo source tile does not match the requested mosaic layout')
      }
      if (fixedIndices === undefined) fixedIndices = tile.fixedIndices
      else if (!sameFixedIndices(fixedIndices, tile.fixedIndices)) {
        throw unsupportedOperation('Reprojected reads require one fixed non-spatial plane')
      }
      const startX = Math.max(region.x, tile.x)
      const startY = Math.max(region.y, tile.y)
      const endX = Math.min(region.x + region.width, tile.x + tile.width)
      const endY = Math.min(region.y + region.height, tile.y + tile.height)
      for (let y = startY; y < endY; y += 1) {
        for (let x = startX; x < endX; x += 1) {
          const pixelIndex = (y - region.y) * region.width + (x - region.x)
          coverage[pixelIndex] = 1
          for (let component = 0; component < bands.length; component += 1) {
            const value =
              tile.data[numericTileSampleOffset(tile, x - tile.x, y - tile.y, component)]
            if (value === undefined) throw invalidInput('Geo source tile is truncated')
            writeValue(data, pixelIndex * bands.length + component, value)
          }
        }
      }
    } finally {
      tile.release()
    }
  }
  if (fixedIndices === undefined) throw invalidInput('Geo source returned no numeric tiles')
  for (const covered of coverage) {
    if (covered === 0) throw invalidInput('Geo source did not cover the required source region')
  }
  return Object.freeze({
    tile: Object.freeze({
      x: region.x,
      y: region.y,
      width: region.width,
      height: region.height,
      sampleType,
      componentCount: bands.length,
      layout: 'interleaved' as const,
      rowStrideElements: region.width * bands.length,
      data,
      release() {},
    }),
    fixedIndices,
  })
}

const writeNoData = (data: NumericArray, noData: RasterNoData): void => {
  const value = rasterNoDataNumber(noData)
  if (data instanceof BigInt64Array || data instanceof BigUint64Array) {
    if (!Number.isSafeInteger(value) || (data instanceof BigUint64Array && value < 0)) {
      throw invalidInput('Integer Geo target requires an exact finite output nodata value')
    }
    data.fill(BigInt(value))
  } else {
    data.fill(value)
  }
}

const outputOffset = (
  grid: GeoTargetGrid,
  pixelIndex: number,
  component: number,
  pixelCount: number,
): number =>
  grid.bandLayout.layout === 'interleaved'
    ? pixelIndex * grid.bandLayout.componentCount + component
    : component * pixelCount + pixelIndex

const rasterLimits = (limits: ResolvedGeoReprojectionLimits): RasterOperationLimits => ({
  maxTilePixels: limits.maxOutputPixels,
  maxOutputBytes: limits.maxOutputBytes,
  maxWorkingBytes: limits.maxWorkingBytes,
})

export const createGeoReprojectionPlan = (
  value: Readonly<GeoReprojectionPlan>,
): GeoReprojectionPlan => {
  if (value.schemaVersion !== geoReprojectionSchemaVersion) {
    throw invalidInput('Unsupported Geo reprojection plan version')
  }
  const targetRegion = value.targetRegion
  if (
    !Number.isSafeInteger(targetRegion.x) ||
    !Number.isSafeInteger(targetRegion.y) ||
    !Number.isSafeInteger(targetRegion.width) ||
    !Number.isSafeInteger(targetRegion.height) ||
    targetRegion.x < 0 ||
    targetRegion.y < 0 ||
    targetRegion.width < 1 ||
    targetRegion.height < 1
  ) {
    throw invalidInput('Geo reprojection plan target region is invalid')
  }
  if (value.sourceBands.length < 1 || value.sourceNoData.length !== value.sourceBands.length) {
    throw invalidInput('Geo reprojection plan bands and nodata policies must match')
  }
  const seenBands = new Set<number>()
  for (const band of value.sourceBands) {
    if (!Number.isSafeInteger(band) || band < 0 || seenBands.has(band)) {
      throw invalidInput('Geo reprojection plan source bands are invalid')
    }
    seenBands.add(band)
  }
  if (value.resampling !== 'nearest' && value.resampling !== 'bilinear') {
    throw invalidInput('Geo reprojection plan resampling is invalid')
  }
  if (
    !Number.isFinite(value.minimumValidWeight) ||
    value.minimumValidWeight <= 0 ||
    value.minimumValidWeight > 1
  ) {
    throw invalidInput('Geo reprojection plan minimumValidWeight must be in (0, 1]')
  }
  for (const [name, identity] of Object.entries({
    sourceGridIdentity: value.sourceGridIdentity,
    targetGridIdentity: value.targetGridIdentity,
    transformIdentity: value.transform.transformIdentity,
    implementationIdentity: value.transform.implementationIdentity,
  })) {
    if (identity.trim().length < 1 || identity.length > 2_097_152) {
      throw invalidInput(`Geo reprojection plan ${name} is invalid`)
    }
  }
  if (
    value.transform.accuracy.kind === 'estimated' &&
    (!Number.isFinite(value.transform.accuracy.maximumError) ||
      value.transform.accuracy.maximumError < 0 ||
      value.transform.accuracy.unit.trim().length < 1)
  ) {
    throw invalidInput('Geo reprojection plan transform accuracy is invalid')
  }
  if (
    value.transform.accuracy.kind !== 'exact' &&
    value.transform.accuracy.kind !== 'estimated' &&
    value.transform.accuracy.kind !== 'unknown'
  ) {
    throw invalidInput('Geo reprojection plan transform accuracy is invalid')
  }
  if (value.transform.warnings.length > 256) {
    throw limitExceeded('Geo reprojection plan exceeds transform warning limits')
  }
  return Object.freeze({
    ...value,
    targetRegion: Object.freeze({ ...targetRegion }),
    sourceBands: Object.freeze([...value.sourceBands]),
    sourceNoData: Object.freeze(value.sourceNoData.map((entry) => normalizeRasterNoData(entry))),
    outputNoData: normalizeRasterNoData(value.outputNoData),
    transform: Object.freeze({
      ...value.transform,
      accuracy: Object.freeze({ ...value.transform.accuracy }),
      warnings: Object.freeze([...value.transform.warnings]),
    }),
  })
}

export const canonicalizeGeoReprojectionPlan = (value: Readonly<GeoReprojectionPlan>): string =>
  canonicalJson(createGeoReprojectionPlan(value), {
    maxDepth: 32,
    maxValues: 16_384,
    maxBytes: 1_048_576,
  })

export async function* readReprojectedGeoRegion(
  view: GeoRasterView,
  request: Readonly<GeoReprojectReadRequest>,
): AsyncGenerator<GeoReprojectedTile> {
  throwIfAborted(request.signal)
  const targetGrid = normalizeGeoTargetGrid(request.targetGrid)
  const targetRegion = normalizeGeoPixelRegion(request.targetRegion, targetGrid)
  if (targetGrid.geographicBounds?.crossesAntimeridian) {
    throw unsupportedOperation(
      'Antimeridian-crossing target grids require the caller to split the request',
    )
  }
  if (view.level.geometry.wrappedBounds?.crossesAntimeridian) {
    throw unsupportedOperation(
      'Antimeridian-crossing source grids require the caller to split the request',
    )
  }
  if (request.resampling !== 'nearest' && request.resampling !== 'bilinear') {
    throw invalidInput('Unsupported Geo reprojection resampling method')
  }
  const bands = normalizeBands(view, request.sourceBands)
  if (targetGrid.bandLayout.componentCount !== bands.length) {
    throw invalidInput('Geo target band layout must match selected source bands')
  }
  if (
    targetGrid.bandLayout.sourceBands !== undefined &&
    !targetGrid.bandLayout.sourceBands.every((band, index) => band === bands[index])
  ) {
    throw invalidInput('Geo target source-band layout does not match the read request')
  }
  const limits = resolvedLimits(request.limits)
  const outputPixels = targetRegion.width * targetRegion.height
  const outputSamples = outputPixels * bands.length
  if (!Number.isSafeInteger(outputPixels) || outputPixels > limits.maxOutputPixels) {
    throw limitExceeded('Reprojected target region exceeds maxOutputPixels')
  }
  if (!Number.isSafeInteger(outputSamples) || outputSamples > limits.maxOutputSamples) {
    throw limitExceeded('Reprojected target region exceeds maxOutputSamples')
  }
  const outputBytes = outputSamples * numericSampleBytes(targetGrid.sampleType)
  if (!Number.isSafeInteger(outputBytes) || outputBytes > limits.maxOutputBytes) {
    throw limitExceeded('Reprojected target region exceeds maxOutputBytes')
  }
  if (view.selection.nonSpatial.some((entry) => entry.kind === 'range')) {
    throw unsupportedOperation('Reprojected reads require fixed indices for non-spatial dimensions')
  }
  const sourceSampleType = numericSampleType(view.dataset.descriptor.sampleType)
  const policies = normalizeNoDataPolicies(view, bands, request.noData, targetGrid)
  if (
    request.resampling === 'bilinear' &&
    targetGrid.sampleType !== 'float32' &&
    targetGrid.sampleType !== 'float64'
  ) {
    throw invalidInput('Bilinear Geo reprojection requires a float32 or float64 target grid')
  }
  if (request.resampling === 'nearest' && targetGrid.sampleType !== sourceSampleType) {
    throw invalidInput(
      'Nearest Geo reprojection preserves categorical values and requires the native sample type',
    )
  }
  const sourceGrid = geoTargetGridFromGeometry(
    view.level.geometry,
    view.dataset.descriptor.spatialReference,
    {
      sampleType: sourceSampleType,
      noData: policies.source[0] ?? Object.freeze({ kind: 'none' }),
      bandLayout: { componentCount: bands.length, layout: 'interleaved', sourceBands: bands },
    },
  )
  const resolved = await resolveGeoCoordinateTransformer(sourceGrid.crs, targetGrid.crs, {
    ...(request.transformer === undefined ? {} : { transformer: request.transformer }),
    ...(request.transformProvider === undefined ? {} : { provider: request.transformProvider }),
    ...(request.signal === undefined ? {} : { signal: request.signal }),
  })
  const transformer = resolved.transformer
  if (transformer.inverse === undefined) {
    if (resolved.owned) await transformer.dispose?.()
    throw unsupportedOperation('Reprojected reads require a coordinate transform with an inverse')
  }
  const inverseTransform = transformer.inverse
  const transformProvenance: GeoReprojectionTransformProvenance = Object.freeze({
    transformIdentity: transformer.transformIdentity,
    implementationIdentity: transformer.implementationIdentity,
    accuracy: Object.freeze({ ...transformer.accuracy }),
    warnings: Object.freeze([...transformer.warnings]),
  })
  const provenance: GeoReprojectionProvenance = Object.freeze({
    schemaVersion: geoReprojectionSchemaVersion,
    sourceGridIdentity: canonicalizeGeoTargetGrid(sourceGrid),
    targetGridIdentity: canonicalizeGeoTargetGrid(targetGrid),
    transform: transformProvenance,
    resampling: request.resampling,
    minimumValidWeight: policies.minimumValidWeight,
  })
  try {
    const sourceRegion = requiredSourceRegion(
      sourceGrid,
      targetGrid,
      targetRegion,
      transformer,
      request.resampling,
      request.signal,
    )
    const fixedIndices = Object.freeze(
      view.selection.nonSpatial.map((entry) =>
        Object.freeze({
          axisId: entry.axisId,
          index: entry.kind === 'index' ? entry.index : entry.start,
        }),
      ),
    )
    let sourceBytes = 0
    let coverageBytes = 0
    const singleBandOutputBytes = outputPixels * numericSampleBytes(targetGrid.sampleType)
    if (sourceRegion !== undefined) {
      const sourcePixels = sourceRegion.width * sourceRegion.height
      if (!Number.isSafeInteger(sourcePixels) || sourcePixels > limits.maxSourcePixels) {
        throw limitExceeded('Reprojected source window exceeds maxSourcePixels')
      }
      sourceBytes = sourcePixels * bands.length * numericSampleBytes(sourceSampleType)
      coverageBytes = sourcePixels
      const workingBytes = outputBytes + sourceBytes + coverageBytes + singleBandOutputBytes
      if (!Number.isSafeInteger(workingBytes) || workingBytes > limits.maxWorkingBytes) {
        throw limitExceeded('Reprojected read exceeds maxWorkingBytes')
      }
      admitRasterAllocation(
        targetRegion,
        targetGrid.sampleType,
        bands.length,
        rasterLimits(limits),
        sourceBytes + coverageBytes + singleBandOutputBytes,
      )
    } else if (outputBytes > limits.maxWorkingBytes) {
      throw limitExceeded('Reprojected read exceeds maxWorkingBytes')
    }
    const output = allocateNumericArray(targetGrid.sampleType, outputSamples)
    writeNoData(output, policies.output)
    if (sourceRegion !== undefined) {
      const mosaic = await readSourceMosaic(
        view,
        sourceRegion,
        bands,
        sourceSampleType,
        request.signal,
      )
      for (let component = 0; component < bands.length; component += 1) {
        throwIfAborted(request.signal)
        const plan = createRasterTargetGridPlan({
          sourceGrid: geoTargetGridToNumericRasterGrid(sourceGrid, request.resampling),
          targetGrid: geoTargetGridToNumericRasterGrid(targetGrid, request.resampling),
          sourceComponent: component,
          resampling: request.resampling,
          sourceNoData: policies.source[component] ?? Object.freeze({ kind: 'none' }),
          outputNoData: policies.output,
          minimumValidWeight: policies.minimumValidWeight,
          ...(resolved.identity
            ? {}
            : {
                transform: {
                  id: transformer.transformIdentity,
                  version: transformer.implementationIdentity,
                  accuracy: transformer.accuracy,
                },
              }),
        })
        const transform =
          plan.transform === undefined
            ? undefined
            : {
                descriptor: plan.transform,
                inverse: (x: number, y: number) => inverseTransform(x, y),
              }
        const componentTile = resampleRasterTileToGrid(plan, mosaic.tile, targetRegion, {
          ...(transform === undefined ? {} : { transform }),
          ...(request.signal === undefined ? {} : { signal: request.signal }),
          limits: rasterLimits(limits),
        })
        try {
          for (let pixel = 0; pixel < outputPixels; pixel += 1) {
            const value = componentTile.data[pixel]
            if (value === undefined) throw invalidInput('Reprojected component tile is truncated')
            writeValue(output, outputOffset(targetGrid, pixel, component, outputPixels), value)
          }
        } finally {
          componentTile.release()
        }
      }
      if (!sameFixedIndices(fixedIndices, mosaic.fixedIndices)) {
        throw unsupportedOperation('Reprojected reads require one fixed non-spatial plane')
      }
    }
    const rowStrideElements =
      targetGrid.bandLayout.layout === 'interleaved'
        ? targetRegion.width * bands.length
        : targetRegion.width
    yield Object.freeze({
      x: targetRegion.x,
      y: targetRegion.y,
      width: targetRegion.width,
      height: targetRegion.height,
      sampleType: targetGrid.sampleType,
      componentCount: bands.length,
      layout: targetGrid.bandLayout.layout,
      rowStrideElements,
      ...(targetGrid.bandLayout.layout === 'planar' ? { planeStrideElements: outputPixels } : {}),
      data: output,
      release() {},
      fixedIndices,
      sourceBands: bands,
      levelId: view.level.id,
      provenance,
    })
  } finally {
    if (resolved.owned) await transformer.dispose?.()
  }
}
