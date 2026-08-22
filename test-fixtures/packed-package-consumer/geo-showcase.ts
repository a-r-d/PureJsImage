import {
  canonicalizeGeoTargetGrid,
  geoTargetGridFromGeometry,
  normalizeGeoTargetGrid,
  readReprojectedGeoRegion,
  type GeoCoordinateTransformProvider,
  type GeoRasterDataset,
  type GeoRasterView,
} from 'purejsimage/geo'
import {
  createTileDatasetIdentityForScientificDataset,
  createTileRuntime,
  numericTileSourceToTileSource,
} from 'purejsimage/analysis/runtime'
import { HttpRangeSource, MemorySource } from 'purejsimage/geo/browser'
import { createGeoTiffReader } from 'purejsimage/geo/readers/geotiff'
import { openGeoZarrObjectStore, type GeoZarrObjectStore } from 'purejsimage/geo/readers/geozarr'
import {
  getScientificDatasetIdentity,
  resolveNumericTileSource,
  type NumericTile,
  type ScientificDatasetIdentity,
} from 'purejsimage/scientific'
import { cogFixtureBytes } from './geo-showcase-data.js'

const cogUrl = 'https://packed-consumer.invalid/rotated-cog.tif'
const convention = {
  proj: {
    schema_url:
      'https://raw.githubusercontent.com/zarr-conventions/proj/refs/tags/v0.1/schema.json',
    spec_url: 'https://github.com/zarr-conventions/proj/blob/v0.1/README.md',
    uuid: 'f17cb550-5864-4468-aeb7-f3180cfb622f',
    name: 'proj',
    description: 'Coordinate reference system information for geospatial data',
  },
  spatial: {
    schema_url:
      'https://raw.githubusercontent.com/zarr-conventions/spatial/refs/tags/v0.1/schema.json',
    spec_url: 'https://github.com/zarr-conventions/spatial/blob/v0.1/README.md',
    uuid: '689b58e2-cf7b-45e0-9fff-9cfc0883d6b4',
    name: 'spatial',
    description: 'Spatial coordinate information',
  },
} as const

export interface GeoConsumerProofReport {
  readonly cog: {
    readonly likelyCog: boolean
    readonly rangeRequests: number
    readonly fullRequests: number
    readonly maximumRangeBytes: number
    readonly transferredBytes: number
    readonly identityStable: boolean
    readonly identityChanged: boolean
    readonly selectedLevel: string
    readonly selectedBands: readonly number[]
    readonly runtimeValues: readonly number[]
    readonly canonicalGridStable: boolean
    readonly identityTransform: string
    readonly providerTransform: string
    readonly cancellationRecovered: boolean
  }
  readonly geozarr: {
    readonly zarrFormat: 3
    readonly selectedTime: number
    readonly selectedBand: number
    readonly values: readonly number[]
  }
  readonly cleanup: Readonly<CleanupTelemetry>
}

interface RangeTelemetry {
  requests: number
  fullRequests: number
  maximumRangeBytes: number
}

interface CleanupTelemetry {
  tilesReleased: number
  documentsClosed: number
  runtimesDisposed: number
  transformProvidersDisposed: number
  objectStoresClosed: number
  sourceLifetimesAborted: number
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const numericValues = (tile: NumericTile): readonly number[] => {
  const values: number[] = []
  for (let index = 0; index < tile.data.length; index += 1) {
    values.push(Number(tile.data[index]))
  }
  return Object.freeze(values)
}

const release = (tile: NumericTile, cleanup: CleanupTelemetry): void => {
  cleanup.tilesReleased += 1
  tile.release()
}

const responseBody = (bytes: Uint8Array): ArrayBuffer => {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return buffer
}

const takeSingleTile = async <Tile extends NumericTile>(
  tiles: AsyncIterable<Tile>,
): Promise<Tile> => {
  let selected: Tile | undefined
  for await (const tile of tiles) {
    if (selected !== undefined) {
      tile.release()
      selected.release()
      throw new Error('Bounded consumer read emitted more than one tile')
    }
    selected = tile
  }
  assert(selected !== undefined, 'Bounded consumer read emitted no tile')
  return selected
}

const createRangeFetch =
  (bytes: Uint8Array, etag: string, telemetry: RangeTelemetry): typeof fetch =>
  async (_input, init) => {
    init?.signal?.throwIfAborted()
    const range = new Headers(init?.headers).get('range')
    if (range === null) {
      telemetry.fullRequests += 1
      return new Response(responseBody(bytes), {
        status: 200,
        headers: { 'content-length': String(bytes.byteLength), etag },
      })
    }
    const match = /^bytes=(\d+)-(\d+)$/u.exec(range)
    assert(match !== null, `Unexpected packed-consumer range ${range}`)
    const start = Number(match[1])
    const end = Math.min(Number(match[2]), bytes.byteLength - 1)
    const body = bytes.slice(start, end + 1)
    telemetry.requests += 1
    telemetry.maximumRangeBytes = Math.max(telemetry.maximumRangeBytes, body.byteLength)
    return new Response(responseBody(body), {
      status: 206,
      headers: {
        'accept-ranges': 'bytes',
        'content-length': String(body.byteLength),
        'content-range': `bytes ${start}-${end}/${bytes.byteLength}`,
        etag,
      },
    })
  }

const openCog = async (
  etag: string,
): Promise<{
  readonly dataset: GeoRasterDataset
  readonly document: Awaited<ReturnType<ReturnType<typeof createGeoTiffReader>['open']>>
  readonly source: HttpRangeSource
  readonly lifetime: AbortController
  readonly telemetry: RangeTelemetry
}> => {
  const telemetry: RangeTelemetry = { requests: 0, fullRequests: 0, maximumRangeBytes: 0 }
  const lifetime = new AbortController()
  const source = await HttpRangeSource.open(cogUrl, {
    blockBytes: 128,
    maxCacheBytes: 1_024,
    fetch: createRangeFetch(cogFixtureBytes, etag, telemetry),
    lifetimeSignal: lifetime.signal,
    openSignal: new AbortController().signal,
  })
  const reader = createGeoTiffReader({ limits: { maxInputBytes: 1_024 * 1_024 } })
  const document = await reader.open({ primary: { id: 'cog', source } })
  const summary = document.datasets[0]
  assert(summary !== undefined, 'Packed COG dataset is missing')
  return {
    dataset: await document.openDataset(summary.id),
    document,
    source,
    lifetime,
    telemetry,
  }
}

const closeCog = async (
  opened: Awaited<ReturnType<typeof openCog>>,
  cleanup: CleanupTelemetry,
): Promise<void> => {
  await opened.document.close?.()
  cleanup.documentsClosed += 1
  opened.lifetime.abort('packed consumer source lifetime ended')
  cleanup.sourceLifetimesAborted += 1
}

const identityForCog = async (
  etag: string,
  cleanup: CleanupTelemetry,
): Promise<ScientificDatasetIdentity> => {
  const opened = await openCog(etag)
  try {
    const identity = getScientificDatasetIdentity(opened.dataset.scientificDataset)
    assert(identity !== undefined, 'GeoTIFF scientific dataset identity is missing')
    return identity
  } finally {
    await closeCog(opened, cleanup)
  }
}

const fixedScientificIndices = (
  dataset: GeoRasterDataset,
): readonly { axisId: string; index: number }[] =>
  Object.freeze(
    dataset.scientificDataset.descriptor.axes
      .filter(
        (axis) =>
          axis.id !== dataset.descriptor.spatialDimensions.x.id &&
          axis.id !== dataset.descriptor.spatialDimensions.y.id,
      )
      .map((axis) => Object.freeze({ axisId: axis.id, index: 0 })),
  )

const createFixtureTransformProvider = (
  cleanup: CleanupTelemetry,
): GeoCoordinateTransformProvider => ({
  implementationIdentity: 'packed-consumer.fixture-transform-provider.v1',
  createTransformer(sourceCrs, destinationCrs) {
    const point = (x: number, y: number): readonly [number, number] => Object.freeze([x, y])
    return Object.freeze({
      sourceCrs,
      destinationCrs,
      transformIdentity: 'packed-consumer.fixture-coordinate-transform.v1',
      implementationIdentity: 'packed-consumer.fixture-transform-provider.v1',
      accuracy: Object.freeze({ kind: 'exact' as const }),
      warnings: Object.freeze([]),
      forward: point,
      inverse: point,
      dispose() {
        cleanup.transformProvidersDisposed += 1
      },
    })
  },
})

const zarrResources = (): ReadonlyMap<string, Uint8Array> =>
  new Map([
    [
      'zarr.json',
      new TextEncoder().encode(
        JSON.stringify({
          zarr_format: 3,
          node_type: 'array',
          shape: [2, 2, 2, 3],
          data_type: 'uint8',
          chunk_grid: { name: 'regular', configuration: { chunk_shape: [2, 2, 2, 3] } },
          chunk_key_encoding: { name: 'default', configuration: { separator: '.' } },
          fill_value: 0,
          codecs: [{ name: 'bytes', configuration: { endian: 'little' } }],
          dimension_names: ['time', 'band', 'Y', 'X'],
          attributes: {
            zarr_conventions: [convention.proj, convention.spatial],
            'proj:code': 'EPSG:32632',
            'spatial:dimensions': ['Y', 'X'],
            'spatial:transform': [30, 0, 500_000, 0, -30, 4_600_000],
            'spatial:registration': 'pixel',
            band_names: ['red', 'nir'],
            time_values: ['2026-01-01T00:00:00Z', '2026-07-01T00:00:00Z'],
          },
        }),
      ),
    ],
    ['c.0.0.0.0', Uint8Array.from({ length: 24 }, (_value, index) => index)],
  ])

const createZarrStore = (cleanup: CleanupTelemetry): GeoZarrObjectStore => {
  const resources = zarrResources()
  let closed = false
  return {
    async resolve(relative, signal) {
      signal?.throwIfAborted()
      assert(!closed, 'Packed GeoZarr store was used after close')
      const bytes = resources.get(relative)
      if (bytes === undefined) return undefined
      return {
        id: relative,
        source: new MemorySource(bytes, {
          identity: {
            kind: 'content',
            strength: 'strong',
            stability: 'content-addressed',
            algorithm: 'sha256',
            digest: (relative === 'zarr.json' ? '0' : '1').repeat(64),
            size: bytes.byteLength,
          },
        }),
      }
    },
    close() {
      assert(!closed, 'Packed GeoZarr store was closed more than once')
      closed = true
      cleanup.objectStoresClosed += 1
    },
  }
}

const consumeGeoZarr = async (
  cleanup: CleanupTelemetry,
): Promise<GeoConsumerProofReport['geozarr']> => {
  const document = await openGeoZarrObjectStore(createZarrStore(cleanup), {
    primaryName: 'zarr.json',
    limits: { maxRegionBytes: 1_024, rowsPerBlock: 2 },
  })
  try {
    const structure = document.inspectStructure()
    assert(structure.zarrFormat === 3, 'Packed GeoZarr fixture did not open as Zarr v3')
    const summary = document.datasets[0]
    assert(summary !== undefined, 'Packed GeoZarr dataset is missing')
    const dataset = await document.openDataset(summary.id)
    const time = dataset.descriptor.axes.find((axis) => axis.kind === 'time')
    const band = dataset.descriptor.axes.find((axis) => axis.kind === 'band')
    assert(time !== undefined, 'Packed GeoZarr time axis is missing')
    assert(band !== undefined, 'Packed GeoZarr band axis is missing')
    const view = dataset.createView({
      spatialDimensions: [
        dataset.descriptor.spatialDimensions.x.id,
        dataset.descriptor.spatialDimensions.y.id,
      ],
      nonSpatial: [
        { kind: 'index', axisId: time.id, index: 1 },
        { kind: 'index', axisId: band.id, index: 0 },
      ],
      sourceBands: [0],
      levelId: dataset.descriptor.primaryLevelId,
    })
    const tile = await takeSingleTile(
      view.readPixelRegion({ region: { x: 0, y: 0, width: 2, height: 2 } }),
    )
    try {
      const values = numericValues(tile)
      assert(JSON.stringify(values) === '[12,13,15,16]', 'GeoZarr selection read changed')
      return Object.freeze({ zarrFormat: 3, selectedTime: 1, selectedBand: 0, values })
    } finally {
      release(tile, cleanup)
    }
  } finally {
    await document.close?.()
    cleanup.documentsClosed += 1
  }
}

export const runGeoConsumerProof = async (
  progress: (step: string) => void = () => {},
): Promise<GeoConsumerProofReport> => {
  const cleanup: CleanupTelemetry = {
    tilesReleased: 0,
    documentsClosed: 0,
    runtimesDisposed: 0,
    transformProvidersDisposed: 0,
    objectStoresClosed: 0,
    sourceLifetimesAborted: 0,
  }
  progress('open-cog')
  const opened = await openCog('"packed-cog-v1"')
  let cogReport: GeoConsumerProofReport['cog']
  try {
    const structure = await opened.document.inspectStructure()
    progress('inspect-cog')
    assert(structure.rangeReadSuitability === 'suitable', 'Packed COG is not range-suitable')
    assert(structure.likelyCog, 'Packed GeoTIFF fixture is no longer a likely COG')
    const identity = getScientificDatasetIdentity(opened.dataset.scientificDataset)
    assert(identity !== undefined, 'GeoTIFF scientific dataset identity is missing')
    assert(Object.isFrozen(identity), 'GeoTIFF scientific dataset identity must be immutable')

    const level = opened.dataset.descriptor.levels.find((candidate) => candidate.sourceOrder === 1)
    assert(level !== undefined, 'Packed COG overview is missing')
    const view = opened.dataset.createView({
      spatialDimensions: [
        opened.dataset.descriptor.spatialDimensions.x.id,
        opened.dataset.descriptor.spatialDimensions.y.id,
      ],
      nonSpatial: opened.dataset.descriptor.axes
        .filter(
          (axis) =>
            axis.id !== opened.dataset.descriptor.spatialDimensions.x.id &&
            axis.id !== opened.dataset.descriptor.spatialDimensions.y.id &&
            axis.kind !== 'band',
        )
        .map((axis) => ({ kind: 'index' as const, axisId: axis.id, index: 0 })),
      sourceBands: [0, 2],
      levelId: level.id,
    })

    release(
      await takeSingleTile(view.readPixelRegion({ region: { x: 0, y: 0, width: 2, height: 2 } })),
      cleanup,
    )
    progress('read-cog-view')

    const cancelled = new AbortController()
    cancelled.abort('cancel only this operation')
    let cancellationObserved = false
    try {
      await takeSingleTile(
        view.readPixelRegion({
          region: { x: 0, y: 0, width: 2, height: 2 },
          signal: cancelled.signal,
        }),
      )
    } catch {
      cancellationObserved = true
    }
    assert(cancellationObserved, 'Packed Geo operation cancellation was not observed')
    release(
      await takeSingleTile(view.readPixelRegion({ region: { x: 1, y: 1, width: 2, height: 2 } })),
      cleanup,
    )
    progress('cancel-cog-view')

    const runtime = createTileRuntime({ limits: { maxCacheBytes: 4_096, maxTileBytes: 4_096 } })
    let runtimeValues: readonly number[]
    try {
      progress('request-cog-runtime')
      const runtimeRequest = runtime.request(
        numericTileSourceToTileSource(resolveNumericTileSource(opened.dataset.scientificDataset)),
        {
          address: {
            cacheClass: 'source',
            namespace: 'packed-consumer-cog',
            dataset: createTileDatasetIdentityForScientificDataset(
              opened.dataset.scientificDataset,
              { sessionId: 'packed-consumer' },
            ),
            displayAxes: view.selection.spatialDimensions,
            fixedIndices: fixedScientificIndices(opened.dataset),
            resolutionLevel: 0,
            x: 0,
            y: 0,
            width: 2,
            height: 2,
          },
          priority: 'visible',
          signal: new AbortController().signal,
        },
      )
      let timeout: ReturnType<typeof setTimeout> | undefined
      const runtimeTile = await Promise.race([
        runtimeRequest,
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new Error('Packed tile runtime request timed out')),
            5_000,
          )
        }),
      ]).finally(() => {
        if (timeout !== undefined) clearTimeout(timeout)
      })
      try {
        runtimeValues = numericValues(runtimeTile)
      } finally {
        release(runtimeTile, cleanup)
      }
    } finally {
      await runtime.dispose()
      cleanup.runtimesDisposed += 1
    }
    progress('read-cog-runtime')

    const reprojectionView: GeoRasterView = opened.dataset.createView({
      ...view.selection,
      sourceBands: [0],
    })
    const targetGrid = geoTargetGridFromGeometry(
      reprojectionView.level.geometry,
      opened.dataset.descriptor.spatialReference,
      {
        sampleType: 'uint8',
        noData: { kind: 'value', value: 255 },
        bandLayout: { componentCount: 1, layout: 'interleaved', sourceBands: [0] },
      },
    )
    const canonical = canonicalizeGeoTargetGrid(targetGrid)
    const identityTile = await takeSingleTile(
      readReprojectedGeoRegion(reprojectionView, {
        targetGrid,
        targetRegion: { x: 0, y: 0, width: 2, height: 2 },
        sourceBands: [0],
        resampling: 'nearest',
      }),
    )
    const identityTransform = identityTile.provenance.transform.transformIdentity
    release(identityTile, cleanup)
    progress('reproject-cog-identity')

    const providerGrid = normalizeGeoTargetGrid({
      ...targetGrid,
      crs: {
        ...targetGrid.crs,
        authority: 'EPSG',
        code: 32619,
        name: 'Packed consumer fixture CRS',
        evidence: [
          {
            kind: 'user-supplied',
            sourceId: 'packed-consumer',
            locator: 'packed consumer deterministic transform provider',
          },
        ],
      },
    })
    const providerTile = await takeSingleTile(
      readReprojectedGeoRegion(reprojectionView, {
        targetGrid: providerGrid,
        targetRegion: { x: 0, y: 0, width: 2, height: 2 },
        sourceBands: [0],
        resampling: 'nearest',
        transformProvider: createFixtureTransformProvider(cleanup),
      }),
    )
    const providerTransform = providerTile.provenance.transform.transformIdentity
    release(providerTile, cleanup)
    progress('reproject-cog-provider')

    const sameIdentity = await identityForCog('"packed-cog-v1"', cleanup)
    const changedIdentity = await identityForCog('"packed-cog-v2"', cleanup)
    progress('compare-cog-identities')
    const identityJson = JSON.stringify(identity)
    const stable = identityJson === JSON.stringify(sameIdentity)
    const changed = identityJson !== JSON.stringify(changedIdentity)
    assert(stable, 'Same GeoTIFF resource identity changed across opens')
    assert(changed, 'Changed GeoTIFF resource identity did not invalidate the dataset identity')
    assert(opened.telemetry.fullRequests === 0, 'Range-backed COG made a full-object request')
    assert(
      opened.telemetry.maximumRangeBytes < cogFixtureBytes.byteLength,
      'Range-backed COG fetched the complete object in one request',
    )

    cogReport = Object.freeze({
      likelyCog: structure.likelyCog,
      rangeRequests: opened.telemetry.requests,
      fullRequests: opened.telemetry.fullRequests,
      maximumRangeBytes: opened.telemetry.maximumRangeBytes,
      transferredBytes: opened.source.stats.transferBytes,
      identityStable: stable,
      identityChanged: changed,
      selectedLevel: level.id,
      selectedBands: view.selection.sourceBands,
      runtimeValues,
      canonicalGridStable:
        canonical === canonicalizeGeoTargetGrid(normalizeGeoTargetGrid(targetGrid)),
      identityTransform,
      providerTransform,
      cancellationRecovered: cancellationObserved,
    })
  } finally {
    await closeCog(opened, cleanup)
  }

  progress('open-geozarr')
  const geozarr = await consumeGeoZarr(cleanup)
  progress('read-geozarr')
  assert(cleanup.tilesReleased === 6, 'Packed consumer tile release count changed')
  assert(cleanup.documentsClosed === 4, 'Packed consumer document close count changed')
  assert(cleanup.runtimesDisposed === 1, 'Packed consumer runtime dispose count changed')
  assert(
    cleanup.transformProvidersDisposed === 1,
    'Packed consumer transform provider dispose count changed',
  )
  assert(cleanup.objectStoresClosed === 1, 'Packed consumer object store close count changed')
  assert(cleanup.sourceLifetimesAborted === 3, 'Packed consumer source lifetime count changed')
  return Object.freeze({ cog: cogReport, geozarr, cleanup: Object.freeze({ ...cleanup }) })
}
