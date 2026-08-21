import { describe, expect, it } from 'vitest'
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
  createProj4CompatibleTransformProvider,
  createGeoReprojectionPlan,
  createNormalizedDifferencePlan,
  estimateGeoOutputDimensions,
  geoTargetGridFromGeometry,
  geoTargetGridsEqual,
  normalizeGeoTargetGrid,
  normalizeGeoSpatialReference,
  overlappingGeoGridExtent,
  proposeGeoTargetGrid,
  readReprojectedGeoRegion,
  transformGeoBounds,
} from '../src/geo/index.ts'

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

const arrayFor = (sampleType: NumericSampleType, values: readonly number[]): NumericArray => {
  if (sampleType === 'uint8') return Uint8Array.from(values)
  if (sampleType === 'float32') return Float32Array.from(values)
  throw new Error(`Unsupported test sample type ${sampleType}`)
}

const createGeoDataset = (
  width: number,
  height: number,
  sampleType: 'uint8' | 'float32',
  pixelToWorld: GeoAffineTransform,
  values: readonly number[],
  noData?: number,
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
      const selected: number[] = []
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
