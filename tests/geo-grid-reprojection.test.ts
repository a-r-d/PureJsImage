import { describe, expect, it } from 'vitest'
import type {
  GeoAffineTransform,
  GeoCoordinateTransformer,
  GeoRasterDataset,
  GeoSpatialReference,
  GeoTargetGrid,
} from '../src/geo/index.ts'
import {
  adaptScientificDatasetToGeo,
  areGeoGridsPixelAligned,
  areGeoPyramidLevelsCompatible,
  canonicalizeGeoReprojectionPlan,
  canonicalizeGeoTargetGrid,
  classifyGeoGridRelationship,
  createGeoGridGeometry,
  createGeoReprojectionPlan,
  createNormalizedDifferencePlan,
  createProj4CompatibleTransformProvider,
  estimateGeoOutputDimensions,
  geoTargetGridFromGeometry,
  geoTargetGridsEqual,
  normalizeGeoSpatialReference,
  normalizeGeoTargetGrid,
  overlappingGeoGridExtent,
  proposeGeoTargetGrid,
  readReprojectedGeoRegion,
  resolveGeoCoordinateTransformer,
  transformGeoBounds,
} from '../src/geo/index.ts'
import type { RasterBlock } from '../src/raster.ts'
import type {
  DirectNumericTileDataset,
  NumericArray,
  NumericSampleType,
  NumericTile,
  NumericTileReadRequest,
  ScientificPlaneReadRequest,
} from '../src/scientific/index.ts'
import { normalizeScientificDatasetDescriptor } from '../src/scientific/index.ts'

const crs = (
  code = 32618,
  projJson: GeoSpatialReference['projJson'] = undefined,
): GeoSpatialReference =>
  normalizeGeoSpatialReference({
    schemaVersion: 1,
    coordinateSystemType: 'projected',
    authority: 'EPSG',
    code,
    name: `Test CRS ${code}`,
    ...(projJson === undefined ? {} : { projJson }),
    formalAxes: [],
    applicationAxes: { x: { name: 'easting' }, y: { name: 'northing' } },
    evidence: [],
    state: 'complete',
    diagnostics: [],
  })

const arrayFor = (
  sampleType: NumericSampleType,
  values: readonly (number | bigint)[],
): NumericArray => {
  if (sampleType === 'uint8') return Uint8Array.from(values, Number)
  if (sampleType === 'int16') return Int16Array.from(values, Number)
  if (sampleType === 'float32') return Float32Array.from(values, Number)
  if (sampleType === 'int64') return BigInt64Array.from(values, BigInt)
  if (sampleType === 'uint64') return BigUint64Array.from(values, BigInt)
  throw new Error(`Unsupported test sample type ${sampleType}`)
}

const createGeoDataset = (
  width: number,
  height: number,
  sampleType: 'uint8' | 'int16' | 'float32' | 'int64' | 'uint64',
  pixelToWorld: GeoAffineTransform,
  values: readonly (number | bigint)[],
  noData?: number | string,
  registration: 'pixel-is-area' | 'pixel-is-point' = 'pixel-is-point',
): GeoRasterDataset => {
  const descriptor = normalizeScientificDatasetDescriptor({
    schemaVersion: 1,
    axes: [
      { id: 'y', kind: 'space', length: height, coordinates: { type: 'index' } },
      { id: 'x', kind: 'space', length: width, coordinates: { type: 'index' } },
    ],
    sampleType,
    components: [{ id: 'band-0', name: 'Band 1', kind: 'scalar' }],
    spatialReference: {
      crs: { kind: 'projected', authority: 'EPSG', code: 32618, name: 'Test CRS 32618' },
      pixelInterpretation: registration,
      pixelToModel: pixelToWorld,
      ...(noData === undefined ? {} : { noData: { kind: 'scalar' as const, value: noData } }),
    },
    capabilities: {
      regionReads: true,
      resolutionLevels: false,
      planeReads: { kind: 'ordered-axis-pairs', pairs: [['x', 'y']] },
    },
  })
  const source = Object.freeze({
    descriptor,
    directSemantics: {
      sourceSampleType: sampleType,
      nativeSampleType: sampleType,
      componentCount: 1,
      layout: 'interleaved' as const,
      supportedTargetSampleTypes: [sampleType],
    },
    async *readNumericTiles(
      request: Readonly<NumericTileReadRequest>,
    ): AsyncGenerator<NumericTile> {
      const x = request.x ?? 0
      const y = request.y ?? 0
      const tileWidth = request.width ?? width
      const tileHeight = request.height ?? height
      const selected: (number | bigint)[] = []
      for (let row = 0; row < tileHeight; row += 1) {
        for (let column = 0; column < tileWidth; column += 1) {
          selected.push(values[(y + row) * width + x + column] ?? 0)
        }
      }
      yield Object.freeze({
        x,
        y,
        width: tileWidth,
        height: tileHeight,
        sampleType,
        componentCount: 1,
        layout: 'interleaved' as const,
        rowStrideElements: tileWidth,
        data: arrayFor(sampleType, selected),
        release() {},
      })
    },
  })
  const scientific: DirectNumericTileDataset = Object.freeze({
    descriptor,
    numericTileSource: source,
    async *readPlane(
      _request: Readonly<ScientificPlaneReadRequest>,
    ): AsyncGenerator<RasterBlock> {},
  })
  const adapted = adaptScientificDatasetToGeo(scientific, { datasetId: 'test-grid' })
  if (!adapted.ok) throw new Error(adapted.diagnostics[0]?.message ?? 'Geo adaptation failed')
  return adapted.dataset
}

const viewFor = (dataset: GeoRasterDataset) =>
  dataset.createView({
    spatialDimensions: ['x', 'y'],
    nonSpatial: [],
    sourceBands: [0],
    levelId: '0',
  })

const targetFor = (
  dataset: GeoRasterDataset,
  options: Readonly<{
    affine?: GeoAffineTransform
    width?: number
    height?: number
    sampleType?: NumericSampleType
    noData?: GeoTargetGrid['noData']
    crs?: GeoSpatialReference
    registration?: 'pixel-is-area' | 'pixel-is-point'
  }> = {},
): GeoTargetGrid => {
  const level = dataset.descriptor.levels[0]
  if (level === undefined) throw new Error('Missing test level')
  const registration = options.registration ?? level.geometry.pixelRegistration
  if (registration === 'unknown') throw new Error('Test grid registration is unknown')
  const geometry = createGeoGridGeometry({
    width: options.width ?? level.width,
    height: options.height ?? level.height,
    spatialDimensions: level.geometry.spatialDimensions,
    pixelToWorld: options.affine ?? level.geometry.pixelToWorld,
    pixelRegistration: registration,
  })
  return geoTargetGridFromGeometry(geometry, options.crs ?? dataset.descriptor.spatialReference, {
    sampleType:
      options.sampleType ??
      (dataset.descriptor.sampleType === 'float16' ? 'float32' : dataset.descriptor.sampleType),
    noData:
      options.noData ??
      (options.sampleType === undefined && dataset.descriptor.sampleType !== 'float32'
        ? { kind: 'value', value: 0 }
        : { kind: 'nan' }),
    bandLayout: { componentCount: 1, layout: 'interleaved', sourceBands: [0] },
  })
}

const collectOne = async <Tile extends NumericTile>(source: AsyncIterable<Tile>): Promise<Tile> => {
  const tiles: Tile[] = []
  for await (const tile of source) tiles.push(tile)
  const tile = tiles[0]
  if (tile === undefined || tiles.length !== 1) throw new Error('Expected one output tile')
  return tile
}

const valuesOf = (tile: NumericTile): readonly number[] => Array.from(tile.data, Number)
const exactValuesOf = (tile: NumericTile): readonly (number | bigint)[] =>
  tile.data instanceof BigInt64Array || tile.data instanceof BigUint64Array
    ? Array.from(tile.data)
    : Array.from(tile.data)

describe('Geo target grids and alignment', () => {
  it('distinguishes exact grids, same-CRS grids, overlap, and pixel alignment', () => {
    const dataset = createGeoDataset(4, 4, 'float32', [1, 0, 0, 0, 1, 0], new Array(16).fill(1))
    const base = targetFor(dataset)
    const same = targetFor(dataset)
    const shifted = targetFor(dataset, { affine: [1, 0, 1, 0, 1, 0] })
    const otherCrs = targetFor(dataset, { crs: crs(3857) })

    expect(geoTargetGridsEqual(base, same)).toBe(true)
    expect(classifyGeoGridRelationship(base, shifted)).toBe('same-crs-different-grid')
    expect(classifyGeoGridRelationship(base, otherCrs)).toBe('different-crs')
    expect(overlappingGeoGridExtent(base, shifted)).toEqual({ minX: 1, minY: 0, maxX: 3, maxY: 3 })
    expect(areGeoGridsPixelAligned(base, shifted)).toBe(true)
    expect(
      areGeoGridsPixelAligned(base, targetFor(dataset, { affine: [1, 0, 0.25, 0, 1, 0] })),
    ).toBe(false)
    expect(
      areGeoPyramidLevelsCompatible(
        base,
        targetFor(dataset, { width: 2, height: 2, affine: [2, 0, 0, 0, 2, 0] }),
      ),
    ).toBe(true)
  })

  it('canonicalizes semantic CRS metadata and grid recipes deterministically', () => {
    const firstCrs = crs(32618, { b: 2, a: 1 })
    const secondCrs = crs(32618, { a: 1, b: 2 })
    const dataset = createGeoDataset(2, 2, 'float32', [1, 0, 0, 0, 1, 0], [1, 2, 3, 4])
    const first = targetFor(dataset, { crs: firstCrs })
    const second = targetFor(dataset, { crs: secondCrs })
    expect(canonicalizeGeoTargetGrid(first)).toBe(canonicalizeGeoTargetGrid(second))

    const plan = createGeoReprojectionPlan({
      schemaVersion: 1,
      sourceGridIdentity: canonicalizeGeoTargetGrid(first),
      targetGridIdentity: canonicalizeGeoTargetGrid(second),
      targetRegion: { x: 0, y: 0, width: 2, height: 2 },
      sourceBands: [0],
      resampling: 'nearest',
      sourceNoData: [{ kind: 'none' }],
      outputNoData: { kind: 'nan' },
      minimumValidWeight: 0.5,
      transform: {
        transformIdentity: 'identity',
        implementationIdentity: 'test',
        accuracy: { kind: 'exact' },
        warnings: [],
      },
    })
    expect(canonicalizeGeoReprojectionPlan(plan)).toBe(canonicalizeGeoReprojectionPlan({ ...plan }))
  })

  it('proposes explicit grid orientation and enforces dimension limits', () => {
    expect(
      estimateGeoOutputDimensions(
        { minX: 0, minY: 0, maxX: 10, maxY: 5 },
        { x: 2, y: 1 },
        'pixel-is-area',
      ),
    ).toEqual({ width: 5, height: 5, pixelCount: 25 })
    const target = proposeGeoTargetGrid({
      crs: crs(),
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 5 },
      width: 5,
      height: 5,
      origin: 'upper-left',
      pixelRegistration: 'pixel-is-area',
      sampleType: 'float32',
      noData: { kind: 'nan' },
      bandLayout: { componentCount: 1, layout: 'interleaved' },
    })
    expect(target.pixelToWorld).toEqual([2, 0, 0, 0, -1, 5])
    expect(() =>
      estimateGeoOutputDimensions(
        { minX: 0, minY: 0, maxX: 10, maxY: 10 },
        { x: 1, y: 1 },
        'pixel-is-area',
        { maxOutputPixels: 10 },
      ),
    ).toThrow(/maxOutputPixels/u)
  })

  it('rejects malformed inverses, duplicate recipe bands, and unbounded transform identities', () => {
    const dataset = createGeoDataset(2, 2, 'float32', [1, 0, 0, 0, 1, 0], [1, 2, 3, 4])
    const target = targetFor(dataset)
    expect(() => normalizeGeoTargetGrid({ ...target, worldToPixel: [1, 0, 1, 0, 1, 0] })).toThrow(
      /exact inverse/u,
    )
    expect(() =>
      createGeoReprojectionPlan({
        schemaVersion: 1,
        sourceGridIdentity: 'source',
        targetGridIdentity: 'target',
        targetRegion: { x: 0, y: 0, width: 1, height: 1 },
        sourceBands: [0, 0],
        resampling: 'nearest',
        sourceNoData: [{ kind: 'none' }, { kind: 'none' }],
        outputNoData: { kind: 'nan' },
        minimumValidWeight: 0.5,
        transform: {
          transformIdentity: 'identity',
          implementationIdentity: 'test',
          accuracy: { kind: 'exact' },
          warnings: [],
        },
      }),
    ).toThrow(/source bands/u)
    expect(() =>
      createProj4CompatibleTransformProvider(
        { transform: (_source, _destination, coordinate) => coordinate },
        { implementationIdentity: 'x'.repeat(4_097) },
      ),
    ).toThrow(/identity/u)
  })
})

describe('bounded Geo reprojection reads', () => {
  it('uses the shared inverse-mapped kernel for a rotated source affine', async () => {
    const dataset = createGeoDataset(2, 2, 'float32', [1, 0.25, 10, 0.5, -1, 20], [1, 2, 3, 4])
    const target = targetFor(dataset)
    const tile = await collectOne(
      readReprojectedGeoRegion(viewFor(dataset), {
        targetGrid: target,
        targetRegion: { x: 0, y: 0, width: 2, height: 2 },
        sourceBands: [0],
        resampling: 'nearest',
      }),
    )
    expect(valuesOf(tile)).toEqual([1, 2, 3, 4])
  })

  it('supports caller-supplied cross-CRS transforms and records provenance', async () => {
    const dataset = createGeoDataset(2, 2, 'float32', [1, 0, 0, 0, 1, 0], [1, 2, 3, 4])
    const destination = crs(3857)
    const target = targetFor(dataset, { affine: [1, 0, 10, 0, 1, 0], crs: destination })
    const transformer: GeoCoordinateTransformer = {
      sourceCrs: dataset.descriptor.spatialReference,
      destinationCrs: destination,
      transformIdentity: 'test.shift-x-10',
      implementationIdentity: 'test-transform@1',
      accuracy: { kind: 'estimated', maximumError: 0.25, unit: 'm' },
      warnings: ['test transform'],
      forward: (x: number, y: number) => [x + 10, y],
      inverse: (x: number, y: number) => [x - 10, y],
    }
    const tile = await collectOne(
      readReprojectedGeoRegion(viewFor(dataset), {
        targetGrid: target,
        targetRegion: { x: 0, y: 0, width: 2, height: 2 },
        sourceBands: [0],
        resampling: 'nearest',
        transformer,
      }),
    )
    expect(valuesOf(tile)).toEqual([1, 2, 3, 4])
    expect(tile.provenance.transform).toEqual({
      transformIdentity: 'test.shift-x-10',
      implementationIdentity: 'test-transform@1',
      accuracy: { kind: 'estimated', maximumError: 0.25, unit: 'm' },
      warnings: ['test transform'],
    })
    expect(
      transformGeoBounds({ minX: 0, minY: 0, maxX: 1, maxY: 1 }, transformer, {
        samplesPerEdge: 1,
      }),
    ).toEqual({ minX: 10, minY: 0, maxX: 11, maxY: 1 })

    const provider = createProj4CompatibleTransformProvider(
      {
        transform: (source, _destination, coordinate) =>
          source === 'EPSG:32618'
            ? [coordinate[0] + 10, coordinate[1]]
            : [coordinate[0] - 10, coordinate[1]],
      },
      { implementationIdentity: 'external-proj4-test@1' },
    )
    const providerTile = await collectOne(
      readReprojectedGeoRegion(viewFor(dataset), {
        targetGrid: target,
        targetRegion: { x: 0, y: 0, width: 2, height: 2 },
        sourceBands: [0],
        resampling: 'nearest',
        transformProvider: provider,
      }),
    )
    expect(valuesOf(providerTile)).toEqual([1, 2, 3, 4])
    expect(providerTile.provenance.transform.implementationIdentity).toBe('external-proj4-test@1')
  })

  it('rejects transforms without inverse mapping', async () => {
    const dataset = createGeoDataset(1, 1, 'float32', [1, 0, 0, 0, 1, 0], [1])
    const destination = crs(3857)
    const transformer: GeoCoordinateTransformer = {
      sourceCrs: dataset.descriptor.spatialReference,
      destinationCrs: destination,
      transformIdentity: 'forward-only',
      implementationIdentity: 'test@1',
      accuracy: { kind: 'unknown' },
      warnings: [],
      forward: (x: number, y: number) => [x, y],
    }
    await expect(async () =>
      collectOne(
        readReprojectedGeoRegion(viewFor(dataset), {
          targetGrid: targetFor(dataset, { crs: destination }),
          targetRegion: { x: 0, y: 0, width: 1, height: 1 },
          sourceBands: [0],
          resampling: 'nearest',
          transformer,
        }),
      ),
    ).rejects.toThrow(/inverse/u)
  })

  it('disposes provider-created transformers when validation or cancellation fails', async () => {
    const source = crs(32618)
    const destination = crs(3857)
    let invalidDisposals = 0
    await expect(
      resolveGeoCoordinateTransformer(source, destination, {
        provider: {
          implementationIdentity: 'invalid-provider@1',
          createTransformer: () => ({
            sourceCrs: crs(4326),
            destinationCrs: destination,
            transformIdentity: 'invalid-source',
            implementationIdentity: 'invalid-provider@1',
            accuracy: { kind: 'unknown' },
            warnings: [],
            forward: (x, y) => [x, y],
            dispose: () => {
              invalidDisposals += 1
            },
          }),
        },
      }),
    ).rejects.toThrow(/source CRS/u)
    expect(invalidDisposals).toBe(1)

    const controller = new AbortController()
    let abortedDisposals = 0
    await expect(
      resolveGeoCoordinateTransformer(source, destination, {
        signal: controller.signal,
        provider: {
          implementationIdentity: 'aborting-provider@1',
          createTransformer: () => {
            controller.abort(new Error('cancel after create'))
            return {
              sourceCrs: source,
              destinationCrs: destination,
              transformIdentity: 'cancelled-transform',
              implementationIdentity: 'aborting-provider@1',
              accuracy: { kind: 'unknown' },
              warnings: [],
              forward: (x, y) => [x, y],
              dispose: () => {
                abortedDisposals += 1
              },
            }
          },
        },
      }),
    ).rejects.toThrow('cancel after create')
    expect(abortedDisposals).toBe(1)
  })

  it('preserves this binding for proj4-compatible inverse methods', async () => {
    const source = crs(32618)
    const destination = crs(3857)
    const provider = createProj4CompatibleTransformProvider(
      {
        create: () => {
          const transform = {
            offset: 10,
            forward(coordinate: readonly [number, number]): readonly [number, number] {
              return [coordinate[0] + this.offset, coordinate[1]]
            },
            inverse(coordinate: readonly [number, number]): readonly [number, number] {
              return [coordinate[0] - this.offset, coordinate[1]]
            },
          }
          return transform
        },
      },
      { implementationIdentity: 'stateful-proj4-test@1' },
    )
    const resolved = await resolveGeoCoordinateTransformer(source, destination, { provider })
    expect(resolved.transformer.forward(2, 3)).toEqual([12, 3])
    expect(resolved.transformer.inverse?.(12, 3)).toEqual([2, 3])
    await resolved.transformer.dispose?.()
  })

  it('preserves nearest categorical values and excludes nodata from bilinear weights', async () => {
    const categorical = createGeoDataset(2, 2, 'uint8', [1, 0, 0, 0, 1, 0], [1, 9, 4, 7])
    const nearest = await collectOne(
      readReprojectedGeoRegion(viewFor(categorical), {
        targetGrid: targetFor(categorical),
        targetRegion: { x: 0, y: 0, width: 2, height: 2 },
        sourceBands: [0],
        resampling: 'nearest',
      }),
    )
    expect(valuesOf(nearest)).toEqual([1, 9, 4, 7])

    const continuous = createGeoDataset(2, 2, 'float32', [1, 0, 0, 0, 1, 0], [1, -999, 3, 5], -999)
    const bilinear = await collectOne(
      readReprojectedGeoRegion(viewFor(continuous), {
        targetGrid: targetFor(continuous, { width: 1, height: 1, affine: [1, 0, 0.5, 0, 1, 0.5] }),
        targetRegion: { x: 0, y: 0, width: 1, height: 1 },
        sourceBands: [0],
        resampling: 'bilinear',
        noData: { minimumValidWeight: 0.5 },
      }),
    )
    expect(valuesOf(bilinear)[0]).toBeCloseTo(3)
  })

  it('requires representable nodata for uncovered integer output', async () => {
    const uint8 = createGeoDataset(2, 1, 'uint8', [1, 0, 0, 0, 1, 0], [7, 9])
    await expect(async () =>
      collectOne(
        readReprojectedGeoRegion(viewFor(uint8), {
          targetGrid: targetFor(uint8, {
            width: 2,
            height: 1,
            affine: [1, 0, 10, 0, 1, 0],
            noData: { kind: 'none' },
          }),
          targetRegion: { x: 0, y: 0, width: 2, height: 1 },
          sourceBands: [0],
          resampling: 'nearest',
        }),
      ),
    ).rejects.toThrow(/explicit representable output nodata/u)

    const uint8Uncovered = await collectOne(
      readReprojectedGeoRegion(viewFor(uint8), {
        targetGrid: targetFor(uint8, {
          width: 2,
          height: 1,
          affine: [1, 0, 10, 0, 1, 0],
          noData: { kind: 'value', value: 255 },
        }),
        targetRegion: { x: 0, y: 0, width: 2, height: 1 },
        sourceBands: [0],
        resampling: 'nearest',
      }),
    )
    expect(valuesOf(uint8Uncovered)).toEqual([255, 255])

    const int16 = createGeoDataset(2, 1, 'int16', [1, 0, 0, 0, 1, 0], [100, -20])
    const int16Partial = await collectOne(
      readReprojectedGeoRegion(viewFor(int16), {
        targetGrid: targetFor(int16, {
          width: 4,
          height: 1,
          noData: { kind: 'value', value: -32_768 },
        }),
        targetRegion: { x: 0, y: 0, width: 4, height: 1 },
        sourceBands: [0],
        resampling: 'nearest',
      }),
    )
    expect(valuesOf(int16Partial)).toEqual([100, -20, -32_768, -32_768])

    const float32 = createGeoDataset(1, 1, 'float32', [1, 0, 0, 0, 1, 0], [5])
    const float32Uncovered = await collectOne(
      readReprojectedGeoRegion(viewFor(float32), {
        targetGrid: targetFor(float32, {
          affine: [1, 0, 10, 0, 1, 0],
          noData: { kind: 'none' },
        }),
        targetRegion: { x: 0, y: 0, width: 1, height: 1 },
        sourceBands: [0],
        resampling: 'nearest',
      }),
    )
    expect(Number.isNaN(valuesOf(float32Uncovered)[0] ?? 0)).toBe(true)
  })

  it('copies int64 and uint64 nearest samples exactly', async () => {
    const int64Values = [9_007_199_254_740_993n, -9_007_199_254_740_993n] as const
    const int64 = createGeoDataset(2, 1, 'int64', [1, 0, 0, 0, 1, 0], int64Values)
    const int64Tile = await collectOne(
      readReprojectedGeoRegion(viewFor(int64), {
        targetGrid: targetFor(int64, { noData: { kind: 'value', value: -1 } }),
        targetRegion: { x: 0, y: 0, width: 2, height: 1 },
        sourceBands: [0],
        resampling: 'nearest',
      }),
    )
    expect(exactValuesOf(int64Tile)).toEqual(int64Values)

    const uint64Values = [18_446_744_073_709_551_615n] as const
    const uint64 = createGeoDataset(1, 1, 'uint64', [1, 0, 0, 0, 1, 0], uint64Values)
    const uint64Tile = await collectOne(
      readReprojectedGeoRegion(viewFor(uint64), {
        targetGrid: targetFor(uint64, { noData: { kind: 'value', value: 0 } }),
        targetRegion: { x: 0, y: 0, width: 1, height: 1 },
        sourceBands: [0],
        resampling: 'nearest',
      }),
    )
    expect(exactValuesOf(uint64Tile)).toEqual(uint64Values)

    const int64Uncovered = await collectOne(
      readReprojectedGeoRegion(viewFor(int64), {
        targetGrid: targetFor(int64, {
          affine: [1, 0, 10, 0, 1, 0],
          noData: { kind: 'value', value: -1 },
        }),
        targetRegion: { x: 0, y: 0, width: 2, height: 1 },
        sourceBands: [0],
        resampling: 'nearest',
      }),
    )
    expect(exactValuesOf(int64Uncovered)).toEqual([-1n, -1n])

    await expect(async () =>
      collectOne(
        readReprojectedGeoRegion(viewFor(uint64), {
          targetGrid: targetFor(uint64, { noData: { kind: 'none' } }),
          targetRegion: { x: 0, y: 0, width: 1, height: 1 },
          sourceBands: [0],
          resampling: 'nearest',
        }),
      ),
    ).rejects.toThrow(/explicit representable output nodata/u)

    await expect(async () =>
      collectOne(
        readReprojectedGeoRegion(viewFor(uint64), {
          targetGrid: targetFor(uint64, {
            sampleType: 'float32',
            noData: { kind: 'nan' },
          }),
          targetRegion: { x: 0, y: 0, width: 1, height: 1 },
          sourceBands: [0],
          resampling: 'bilinear',
        }),
      ),
    ).rejects.toThrow(/does not support int64 or uint64/u)
  })

  it('recognizes exact int64 and uint64 source nodata outside the safe-integer range', async () => {
    const uint64NoData = 18_446_744_073_709_551_615n
    const uint64 = createGeoDataset(
      2,
      1,
      'uint64',
      [1, 0, 0, 0, 1, 0],
      [uint64NoData, 7n],
      uint64NoData.toString(),
    )
    const uint64Tile = await collectOne(
      readReprojectedGeoRegion(viewFor(uint64), {
        targetGrid: targetFor(uint64, { noData: { kind: 'value', value: 0 } }),
        targetRegion: { x: 0, y: 0, width: 2, height: 1 },
        sourceBands: [0],
        resampling: 'nearest',
      }),
    )
    expect(exactValuesOf(uint64Tile)).toEqual([0n, 7n])

    const int64NoData = -9_223_372_036_854_775_808n
    const int64 = createGeoDataset(
      2,
      1,
      'int64',
      [1, 0, 0, 0, 1, 0],
      [int64NoData, 7n],
      int64NoData.toString(),
    )
    const int64Tile = await collectOne(
      readReprojectedGeoRegion(viewFor(int64), {
        targetGrid: targetFor(int64, { noData: { kind: 'value', value: -1 } }),
        targetRegion: { x: 0, y: 0, width: 2, height: 1 },
        sourceBands: [0],
        resampling: 'nearest',
      }),
    )
    expect(exactValuesOf(int64Tile)).toEqual([-1n, 7n])
  })

  it('keeps pixel registration explicit and rejects wrapped geographic requests', async () => {
    const dataset = createGeoDataset(2, 2, 'float32', [1, 0, 0, 0, 1, 0], [1, 2, 3, 4])
    const area = targetFor(dataset, { registration: 'pixel-is-area' })
    const point = targetFor(dataset, { registration: 'pixel-is-point' })
    expect(geoTargetGridsEqual(area, point)).toBe(false)

    const areaDataset = createGeoDataset(
      2,
      2,
      'float32',
      [1, 0, 0, 0, 1, 0],
      [1, 2, 3, 4],
      undefined,
      'pixel-is-area',
    )
    const areaTile = await collectOne(
      readReprojectedGeoRegion(viewFor(areaDataset), {
        targetGrid: targetFor(areaDataset, { registration: 'pixel-is-area' }),
        targetRegion: { x: 0, y: 0, width: 2, height: 2 },
        sourceBands: [0],
        resampling: 'nearest',
      }),
    )
    const pointTile = await collectOne(
      readReprojectedGeoRegion(viewFor(dataset), {
        targetGrid: point,
        targetRegion: { x: 0, y: 0, width: 2, height: 2 },
        sourceBands: [0],
        resampling: 'nearest',
      }),
    )
    expect(valuesOf(areaTile)).toEqual([1, 2, 3, 4])
    expect(valuesOf(pointTile)).toEqual([1, 2, 3, 4])

    const geographic = normalizeGeoSpatialReference({
      ...crs(4326),
      coordinateSystemType: 'geographic',
      name: 'WGS 84',
    })
    const wrapped = proposeGeoTargetGrid({
      crs: geographic,
      bounds: { minX: 170, minY: -10, maxX: 190, maxY: 10 },
      width: 20,
      height: 20,
      origin: 'upper-left',
      pixelRegistration: 'pixel-is-area',
      sampleType: 'float32',
      noData: { kind: 'nan' },
      bandLayout: { componentCount: 1, layout: 'interleaved' },
      geographicBounds: { west: 170, south: -10, east: -170, north: 10, crossesAntimeridian: true },
    })
    await expect(async () =>
      collectOne(
        readReprojectedGeoRegion(viewFor(dataset), {
          targetGrid: wrapped,
          targetRegion: { x: 0, y: 0, width: 1, height: 1 },
          sourceBands: [0],
          resampling: 'nearest',
        }),
      ),
    ).rejects.toThrow(/split/u)
  })

  it('enforces target limits and cancellation before source allocation', async () => {
    const dataset = createGeoDataset(4, 4, 'float32', [1, 0, 0, 0, 1, 0], new Array(16).fill(1))
    await expect(async () =>
      collectOne(
        readReprojectedGeoRegion(viewFor(dataset), {
          targetGrid: targetFor(dataset),
          targetRegion: { x: 0, y: 0, width: 4, height: 4 },
          sourceBands: [0],
          resampling: 'nearest',
          limits: { maxOutputPixels: 4 },
        }),
      ),
    ).rejects.toThrow(/maxOutputPixels/u)
    await expect(async () =>
      collectOne(
        readReprojectedGeoRegion(viewFor(dataset), {
          targetGrid: targetFor(dataset),
          targetRegion: { x: 0, y: 0, width: 2, height: 2 },
          sourceBands: [0],
          resampling: 'nearest',
          limits: { maxWorkingBytes: 8 },
        }),
      ),
    ).rejects.toThrow(/maxWorkingBytes/u)

    const controller = new AbortController()
    controller.abort(new Error('stop'))
    await expect(async () =>
      collectOne(
        readReprojectedGeoRegion(viewFor(dataset), {
          targetGrid: targetFor(dataset),
          targetRegion: { x: 0, y: 0, width: 1, height: 1 },
          sourceBands: [0],
          resampling: 'nearest',
          signal: controller.signal,
        }),
      ),
    ).rejects.toThrow('stop')
  })
})

describe('Geo analysis operation exports', () => {
  it('keeps existing band math available through the geo entry', () => {
    expect(
      createNormalizedDifferencePlan(
        { name: 'red', valueMode: 'raw' },
        { name: 'nir', valueMode: 'raw' },
      ).algorithm.id,
    ).toBe('purejsimage.raster.band-math')
  })
})
