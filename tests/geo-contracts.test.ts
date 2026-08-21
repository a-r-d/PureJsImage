import { describe, expect, it } from 'vitest'
import type {
  GeoAffineTransform,
  GeoGridGeometry,
  GeoNumericTile,
  GeoRasterDescriptor,
} from '../src/geo/index.ts'
import {
  adaptScientificDatasetToGeo,
  adaptScientificDocumentDatasetToGeo,
  calculateGeoWorldBounds,
  createGeoGridGeometry,
  geoSpatialReferenceToScientific,
  geoWorldBoundsToPixelRegion,
  invertGeoAffine,
  normalizeGeoRasterDescriptor,
  normalizeGeoSpatialReference,
} from '../src/geo/index.ts'
import type { RasterBlock } from '../src/raster.ts'
import type {
  DirectNumericTileDataset,
  NumericTile,
  NumericTileReadRequest,
  ScientificAxisDescriptor,
  ScientificDocument,
  ScientificPlaneReadRequest,
  ScientificResolutionLevel,
  ScientificSpatialReference,
} from '../src/scientific/index.ts'
import { normalizeScientificDatasetDescriptor } from '../src/scientific/index.ts'

const xAxis = (length: number): ScientificAxisDescriptor => ({
  id: 'x',
  name: 'raster X',
  kind: 'space',
  length,
  unit: 'm',
  coordinates: { type: 'index' },
})

const yAxis = (length: number): ScientificAxisDescriptor => ({
  id: 'y',
  name: 'raster Y',
  kind: 'space',
  length,
  unit: 'm',
  coordinates: { type: 'index' },
})

const geoReference = (
  pixelToModel: GeoAffineTransform,
  pixelInterpretation: ScientificSpatialReference['pixelInterpretation'] = 'pixel-is-area',
): ScientificSpatialReference => ({
  crs: { kind: 'projected', authority: 'EPSG', code: 32618, name: 'WGS 84 / UTM zone 18N' },
  pixelInterpretation,
  pixelToModel,
  noData: { kind: 'scalar', value: 0 },
})

interface SyntheticDatasetOptions {
  readonly axes?: readonly ScientificAxisDescriptor[]
  readonly components?: number
  readonly spatialReference?: ScientificSpatialReference
  readonly levels?: readonly ScientificResolutionLevel[]
  readonly sampleType?: 'uint8' | 'uint16' | 'float32'
}

interface SyntheticDatasetResult {
  readonly dataset: DirectNumericTileDataset
  readonly reads: NumericTileReadRequest[]
  readonly emittedData: Array<Uint8Array | Uint16Array | Float32Array>
  readonly releases: number[]
}

const syntheticDataset = (
  options: Readonly<SyntheticDatasetOptions> = {},
): SyntheticDatasetResult => {
  const axes = options.axes ?? [yAxis(3), xAxis(4)]
  const componentCount = options.components ?? 1
  const sampleType = options.sampleType ?? 'uint16'
  const descriptor = normalizeScientificDatasetDescriptor({
    schemaVersion: 1,
    axes,
    sampleType,
    components: Array.from({ length: componentCount }, (_, index) => ({
      id: `component-${index}`,
      name: `Band ${index + 1}`,
      kind:
        index === 0
          ? 'red'
          : index === 1
            ? 'green'
            : index === 2
              ? 'blue'
              : index === 3
                ? 'alpha'
                : 'scalar',
    })),
    ...(options.levels === undefined ? {} : { levels: options.levels }),
    ...(options.spatialReference === undefined
      ? {}
      : { spatialReference: options.spatialReference }),
    capabilities: {
      regionReads: true,
      resolutionLevels: (options.levels?.length ?? 1) > 1,
      planeReads: { kind: 'ordered-axis-pairs', pairs: [['x', 'y']] },
    },
  })
  const reads: NumericTileReadRequest[] = []
  const emittedData: Array<Uint8Array | Uint16Array | Float32Array> = []
  const releases: number[] = []
  const source = {
    descriptor,
    directSemantics: {
      sourceSampleType: sampleType,
      nativeSampleType: sampleType,
      componentCount,
      layout: 'interleaved' as const,
      supportedTargetSampleTypes: [sampleType],
    },
    async *readNumericTiles(
      request: Readonly<NumericTileReadRequest>,
    ): AsyncGenerator<NumericTile> {
      reads.push(request)
      const width = request.width ?? 1
      const height = request.height ?? 1
      const length = width * height * componentCount
      const data =
        sampleType === 'uint8'
          ? new Uint8Array(length)
          : sampleType === 'uint16'
            ? new Uint16Array(length)
            : new Float32Array(length)
      data.fill(7)
      emittedData.push(data)
      yield Object.freeze({
        x: request.x ?? 0,
        y: request.y ?? 0,
        width,
        height,
        sampleType,
        componentCount,
        layout: 'interleaved' as const,
        rowStrideElements: width * componentCount,
        data,
        release: () => releases.push(1),
      })
    },
  }
  const dataset: DirectNumericTileDataset = Object.freeze({
    descriptor,
    numericTileSource: source,
    async *readPlane(
      _request: Readonly<ScientificPlaneReadRequest>,
    ): AsyncGenerator<RasterBlock> {},
  })
  return { dataset, reads, emittedData, releases }
}

const dimensionsFor = (xIndex = 1, yIndex = 0): GeoGridGeometry['spatialDimensions'] => ({
  x: { id: 'x', name: 'raster X', dimensionIndex: xIndex },
  y: { id: 'y', name: 'raster Y', dimensionIndex: yIndex },
})

const collectTiles = async (
  source: AsyncIterable<GeoNumericTile>,
): Promise<readonly GeoNumericTile[]> => {
  const tiles: GeoNumericTile[] = []
  for await (const tile of source) tiles.push(tile)
  return tiles
}

describe('Geo grid geometry', () => {
  it('handles north-up negative-Y grids for area and point registration', () => {
    const transform: GeoAffineTransform = [10, 0, 100, 0, -10, 200]
    const area = createGeoGridGeometry({
      width: 4,
      height: 3,
      spatialDimensions: dimensionsFor(),
      pixelToWorld: transform,
      pixelRegistration: 'pixel-is-area',
    })
    const point = createGeoGridGeometry({
      width: 4,
      height: 3,
      spatialDimensions: dimensionsFor(),
      pixelToWorld: transform,
      pixelRegistration: 'pixel-is-point',
    })

    expect(area.worldBounds).toEqual({ minX: 100, minY: 170, maxX: 140, maxY: 200 })
    expect(point.worldBounds).toEqual({ minX: 100, minY: 180, maxX: 130, maxY: 200 })
    expect(area.worldToPixel).toEqual([0.1, 0, -10, 0, -0.1, 20])
  })

  it('calculates transformed-corner bounds for rotated and sheared grids', () => {
    const transform: GeoAffineTransform = [2, 1, 10, 0.5, -3, 20]
    expect(calculateGeoWorldBounds(transform, 4, 2, 'pixel-is-area')).toEqual({
      minX: 10,
      minY: 14,
      maxX: 20,
      maxY: 22,
    })
    const inverse = invertGeoAffine(transform)
    expect(inverse).toBeDefined()
    const geometry = createGeoGridGeometry({
      width: 4,
      height: 2,
      spatialDimensions: dimensionsFor(),
      pixelToWorld: transform,
      pixelRegistration: 'pixel-is-area',
    })
    expect(geoWorldBoundsToPixelRegion(geometry.worldBounds, geometry, true)).toEqual({
      x: 0,
      y: 0,
      width: 4,
      height: 2,
    })
  })

  it('keeps singular geometry but reports that world reads are unavailable', () => {
    const geometry = createGeoGridGeometry({
      width: 4,
      height: 3,
      spatialDimensions: dimensionsFor(),
      pixelToWorld: [1, 2, 0, 2, 4, 0],
      pixelRegistration: 'unknown',
    })

    expect(geometry.worldToPixel).toBeUndefined()
    expect(geometry.warnings.map(({ code }) => code)).toEqual([
      'non-invertible-affine',
      'unknown-pixel-registration',
    ])
    expect(() => geoWorldBoundsToPixelRegion(geometry.worldBounds, geometry)).toThrow(
      'requires an invertible affine',
    )
  })
})

describe('scientific Geo adapter', () => {
  it('adapts a four-band pyramid with non-power-of-two levels and per-level transforms', () => {
    const base = geoReference([10, 0, 100, 0, -10, 200])
    const overview = geoReference([15, 1, 100, 0.5, -40 / 3, 200])
    const source = syntheticDataset({
      axes: [yAxis(4), xAxis(6)],
      components: 4,
      spatialReference: base,
      levels: [
        {
          level: 0,
          axisLengths: [
            { axisId: 'y', length: 4 },
            { axisId: 'x', length: 6 },
          ],
          spatialReference: base,
        },
        {
          level: 3,
          axisLengths: [
            { axisId: 'y', length: 3 },
            { axisId: 'x', length: 4 },
          ],
          spatialReference: overview,
        },
      ],
    })

    const result = adaptScientificDatasetToGeo(source.dataset, { datasetId: 'four-band-cog' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.dataset.scientificDataset).toBe(source.dataset)
    expect(source.reads).toEqual([])
    expect(
      result.dataset.descriptor.bands.map(({ colorInterpretation }) => colorInterpretation),
    ).toEqual(['red', 'green', 'blue', 'alpha'])
    expect(
      result.dataset.descriptor.levels.map(({ id, width, height }) => ({ id, width, height })),
    ).toEqual([
      { id: '0', width: 6, height: 4 },
      { id: '3', width: 4, height: 3 },
    ])
    expect(result.dataset.descriptor.levels[1]?.geometry.pixelToWorld).toEqual(
      overview.pixelToModel,
    )
    expect(result.dataset.descriptor.levels[1]?.downsample).toEqual({ x: 1.5, y: 4 / 3 })
  })

  it('preserves time/Y/X dimensions, native tiles, cancellation, and release ownership', async () => {
    const source = syntheticDataset({
      axes: [
        {
          id: 'time',
          kind: 'time',
          length: 2,
          unit: 'day',
          coordinates: { type: 'lookup', values: [0, 1] },
        },
        yAxis(3),
        xAxis(4),
      ],
      spatialReference: geoReference([1, 0, 0, 0, -1, 3]),
      sampleType: 'uint16',
    })
    const result = adaptScientificDatasetToGeo(source.dataset, { datasetId: 'time-cube' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.dataset.descriptor.dimensions.map(({ id }) => id)).toEqual(['time', 'y', 'x'])
    expect(result.dataset.descriptor.axes.map(({ id, kind }) => ({ id, kind }))).toEqual([
      { id: 'time', kind: 'time' },
    ])
    const view = result.dataset.createView({
      spatialDimensions: ['x', 'y'],
      nonSpatial: [{ kind: 'range', axisId: 'time', start: 0, length: 2 }],
      sourceBands: [0],
      levelId: '0',
    })
    const tiles = await collectTiles(
      view.readPixelRegion({ region: { x: 1, y: 1, width: 2, height: 1 } }),
    )
    expect(tiles).toHaveLength(2)
    expect(tiles.map((tile) => tile.fixedIndices)).toEqual([
      [{ axisId: 'time', index: 0 }],
      [{ axisId: 'time', index: 1 }],
    ])
    expect(tiles[0]?.data).toBe(source.emittedData[0])
    expect(tiles[0]?.sampleType).toBe('uint16')
    tiles.forEach((tile) => {
      tile.release()
    })
    expect(source.releases).toHaveLength(2)

    const controller = new AbortController()
    controller.abort(new Error('cancel geo read'))
    await expect(
      collectTiles(
        view.readWorldRegion({
          bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
          signal: controller.signal,
        }),
      ),
    ).rejects.toThrow('cancel geo read')
  })

  it('keeps band/time/Y/X axes first class and reads large coordinates lazily', async () => {
    const times = Array.from({ length: 5_000 }, (_, index) => index * 0.25)
    const source = syntheticDataset({
      axes: [
        { id: 'band', kind: 'channel', length: 3, coordinates: { type: 'index' } },
        {
          id: 'time',
          kind: 'time',
          length: times.length,
          coordinates: { type: 'lookup', values: times },
        },
        yAxis(2),
        xAxis(3),
      ],
      spatialReference: geoReference([0.5, 0, -180, 0, -0.5, 90]),
      sampleType: 'float32',
    })
    const result = adaptScientificDatasetToGeo(source.dataset, { datasetId: 'geozarr-cube' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.dataset.descriptor.dimensions.map(({ id }) => id)).toEqual([
      'band',
      'time',
      'y',
      'x',
    ])
    expect(result.dataset.descriptor.axes.map(({ id, kind }) => ({ id, kind }))).toEqual([
      { id: 'band', kind: 'band' },
      { id: 'time', kind: 'time' },
    ])
    expect(result.dataset.descriptor.axes[1]?.coordinates).toEqual({
      kind: 'lazy',
      valueType: 'number',
    })
    await expect(
      result.dataset.readAxisCoordinates({ axisId: 'time', start: 4_998, length: 2 }),
    ).resolves.toEqual({ axisId: 'time', start: 4_998, values: [1_249.5, 1_249.75] })
  })

  it('does not reinterpret microscope calibration without explicit geo evidence', () => {
    const source = syntheticDataset({
      axes: [
        {
          ...yAxis(3),
          unit: 'um',
          coordinates: { type: 'linear', origin: 0, step: 0.25 },
          calibration: { kind: 'embedded', resourceId: 'microscope', locator: 'pixel-size-y' },
        },
        {
          ...xAxis(4),
          unit: 'um',
          coordinates: { type: 'linear', origin: 0, step: 0.25 },
          calibration: { kind: 'embedded', resourceId: 'microscope', locator: 'pixel-size-x' },
        },
      ],
    })

    const result = adaptScientificDatasetToGeo(source.dataset, { datasetId: 'microscope-image' })
    expect(result).toEqual({
      ok: false,
      diagnostics: [
        expect.objectContaining({ code: 'scientific-geo-evidence-missing', severity: 'error' }),
      ],
    })
  })

  it('represents an explicitly unknown CRS without inventing an authority', () => {
    const source = syntheticDataset({
      spatialReference: {
        ...geoReference([1, 0, 0, 0, -1, 3]),
        crs: { kind: 'unknown' },
      },
    })
    const result = adaptScientificDatasetToGeo(source.dataset, { datasetId: 'unknown-crs' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.dataset.descriptor.spatialReference).toEqual(
      expect.objectContaining({
        coordinateSystemType: 'unknown',
        state: 'unknown',
        diagnostics: [expect.objectContaining({ code: 'unknown-crs' })],
      }),
    )
    expect(result.dataset.descriptor.spatialReference.authority).toBeUndefined()
  })

  it('leaves document ownership with the caller and preserves open cancellation', async () => {
    const source = syntheticDataset({
      spatialReference: geoReference([1, 0, 0, 0, -1, 3]),
    })
    let closes = 0
    let openSignal: AbortSignal | undefined
    const document: ScientificDocument = {
      reader: { id: 'example/geo', version: '1.0.0' },
      format: 'Example Geo raster',
      metadata: {},
      datasets: [],
      async openDataset(_id, options) {
        openSignal = options?.signal
        return source.dataset
      },
      close() {
        closes += 1
      },
    }
    const controller = new AbortController()
    const result = await adaptScientificDocumentDatasetToGeo(document, 'document-raster', {
      signal: controller.signal,
    })
    expect(result.ok).toBe(true)
    expect(openSignal).toBe(controller.signal)
    expect(closes).toBe(0)
    await document.close?.()
    expect(closes).toBe(1)
  })

  it('round-trips the smaller scientific spatial contract with typed loss diagnostics', () => {
    const source = syntheticDataset({
      axes: [yAxis(3), xAxis(4)],
      spatialReference: geoReference([30, 2, 400_000, 1, -30, 4_500_000], 'pixel-is-point'),
    })
    const result = adaptScientificDatasetToGeo(source.dataset, { datasetId: 'round-trip' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const converted = geoSpatialReferenceToScientific(
      result.dataset.descriptor.spatialReference,
      result.dataset.descriptor.grid,
    )

    expect(converted.spatialReference.crs).toEqual(source.dataset.descriptor.spatialReference?.crs)
    expect(converted.spatialReference.pixelToModel).toEqual(
      source.dataset.descriptor.spatialReference?.pixelToModel,
    )
    expect(converted.spatialReference.pixelInterpretation).toBe('pixel-is-point')
    expect(converted.spatialReference.noData).toEqual({ kind: 'scalar', value: 0 })
    expect(converted.diagnostics).toEqual([
      expect.objectContaining({ code: 'scientific-contract-loss', severity: 'info' }),
    ])
  })
})

describe('Geo descriptor validation', () => {
  const adaptedDescriptor = (): GeoRasterDescriptor => {
    const result = adaptScientificDatasetToGeo(
      syntheticDataset({
        axes: [yAxis(3), xAxis(4)],
        spatialReference: geoReference([1, 0, 0, 0, -1, 3]),
        sampleType: 'uint8',
      }).dataset,
      { datasetId: 'validation-source' },
    )
    if (!result.ok) throw new Error('Synthetic Geo adaptation failed')
    return result.dataset.descriptor
  }

  it('rejects shape, band index, scale, nodata, level, and bounded-metadata errors', () => {
    const descriptor = adaptedDescriptor()
    const firstBand = descriptor.bands[0]
    if (firstBand === undefined) throw new Error('Synthetic Geo descriptor has no band')
    expect(() => normalizeGeoRasterDescriptor({ ...descriptor, shape: [3, 5] }, 1)).toThrow(
      'must match dimension length',
    )
    expect(() =>
      normalizeGeoRasterDescriptor(
        {
          ...descriptor,
          bands: [{ ...firstBand, sourceComponentIndex: 1 }],
        },
        1,
      ),
    ).toThrow('sourceComponentIndex is unavailable')
    expect(() =>
      normalizeGeoRasterDescriptor({ ...descriptor, bands: [{ ...firstBand, scale: 0 }] }, 1),
    ).toThrow('scale must be finite and non-zero')
    expect(() =>
      normalizeGeoRasterDescriptor(
        { ...descriptor, bands: [{ ...firstBand, offset: Number.POSITIVE_INFINITY }] },
        1,
      ),
    ).toThrow('offset must be finite')
    expect(() =>
      normalizeGeoRasterDescriptor({ ...descriptor, bands: [{ ...firstBand, noData: 256 }] }, 1),
    ).toThrow('outside uint8')
    expect(() =>
      normalizeGeoRasterDescriptor(
        {
          ...descriptor,
          levels: descriptor.levels.map((level) => ({
            ...level,
            downsample: { x: 2, y: 1 },
          })),
        },
        1,
      ),
    ).toThrow('downsample does not match its dimensions')
    expect(() =>
      normalizeGeoRasterDescriptor(
        { ...descriptor, formatEvidence: { note: 'x'.repeat(4_097) } },
        1,
      ),
    ).toThrow('longer than maxStringLength')
    expect(() =>
      createGeoGridGeometry({
        width: 4,
        height: 3,
        spatialDimensions: dimensionsFor(0, 0),
        pixelToWorld: [1, 0, 0, 0, 1, 0],
        pixelRegistration: 'pixel-is-area',
      }),
    ).toThrow('spatial dimensions must be unique')
    expect(() =>
      normalizeGeoSpatialReference({
        ...descriptor.spatialReference,
        coordinateSystemType: 'unknown',
        state: 'complete',
      }),
    ).toThrow('must use unknown diagnostic state')
  })
})
