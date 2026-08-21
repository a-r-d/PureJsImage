import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { geoTargetGridFromGeometry, readReprojectedGeoRegion } from '../../src/geo/index.ts'
import type { GeoRasterDataset, GeoRasterView } from '../../src/geo/contracts.ts'
import { geoEnviReader } from '../../src/geo/readers/envi.ts'
import { geoTiffReader } from '../../src/geo/readers/geotiff.ts'
import { openGeoZarrHttp } from '../../src/geo/readers/geozarr/index.ts'
import { geoNetCdfReader } from '../../src/geo/readers/netcdf.ts'
import type { ScientificOpenContext, ScientificResource } from '../../src/scientific/reader.ts'
import { MemorySource } from '../../src/source.ts'
import { HttpRangeSource } from '../../src/sources/http-range.ts'
import { zarrV3ArrayMetadata } from '../../tests/helpers/zarr-metadata-fixtures.ts'
import {
  createNetCdfClassicFixture,
  type FixtureNetCdfAttribute,
} from '../../tests/helpers/netcdf-classic-fixture.ts'
import { CountingImageSource } from '../scientific-readers/sources.ts'
import {
  byteAsset,
  DeterministicObjectStoreServer,
  DeterministicRangeServer,
} from './deterministic-servers.ts'
import {
  parseGeoBenchmarkReport,
  type GeoBenchmarkMeasurements,
  type GeoBenchmarkReport,
  type GeoBenchmarkResult,
} from './types.ts'

const encoder = new TextEncoder()
const writeOutputs = process.argv.includes('--write')

const memoryBytes = (): number => {
  const usage = process.memoryUsage()
  return usage.heapUsed + usage.external + usage.arrayBuffers
}

const elapsed = (start: number): number => Number((performance.now() - start).toFixed(3))

const viewFor = (
  dataset: GeoRasterDataset,
  options: Readonly<{
    readonly levelId?: string
    readonly indices?: Readonly<Record<string, number>>
  }> = {},
): GeoRasterView =>
  dataset.createView({
    spatialDimensions: [
      dataset.descriptor.spatialDimensions.x.id,
      dataset.descriptor.spatialDimensions.y.id,
    ],
    nonSpatial: dataset.descriptor.axes.map((axis) => ({
      kind: 'index' as const,
      axisId: axis.id,
      index: options.indices?.[axis.id] ?? 0,
    })),
    sourceBands: [0],
    levelId: options.levelId ?? dataset.descriptor.primaryLevelId,
  })

const readRegion = async (
  view: GeoRasterView,
  region: Readonly<{
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
  }>,
): Promise<{ readonly pixels: number; readonly checksum: number }> => {
  let pixels = 0
  let checksum = 0
  for await (const tile of view.readPixelRegion({ region })) {
    pixels += tile.width * tile.height * tile.componentCount
    for (let index = 0; index < tile.data.length; index += 1)
      checksum += Number(tile.data[index] ?? 0)
    tile.release()
  }
  return { pixels, checksum }
}

const measurements = (values: Partial<GeoBenchmarkMeasurements>): GeoBenchmarkMeasurements => ({
  openMetadataMs: values.openMetadataMs ?? 0,
  timeToFirstTileMs: values.timeToFirstTileMs ?? 0,
  requestsToFirstTile: values.requestsToFirstTile ?? 0,
  transferredBytes: values.transferredBytes ?? 0,
  uniqueBytes: values.uniqueBytes ?? 0,
  decodedPixels: values.decodedPixels ?? 0,
  cacheHits: values.cacheHits ?? 0,
  peakManagedMemoryBytes: values.peakManagedMemoryBytes ?? 0,
  reprojectionOverheadMs: values.reprojectionOverheadMs ?? 0,
  overviewSelection: values.overviewSelection ?? null,
  zarrChunksAccessed: values.zarrChunksAccessed ?? 0,
  zarrShardsAccessed: values.zarrShardsAccessed ?? 0,
  zarrUniqueShardObjects: values.zarrUniqueShardObjects ?? 0,
  zarrShardIndexReads: values.zarrShardIndexReads ?? 0,
  zarrShardPayloadRanges: values.zarrShardPayloadRanges ?? 0,
})

const conventions = {
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

const geoAttributes = (dimensions: readonly [string, string]) => ({
  zarr_conventions: [conventions.proj, conventions.spatial],
  'proj:code': 'EPSG:32632',
  'spatial:dimensions': dimensions,
  'spatial:transform': [1, 0, 500000, 0, -1, 4100000],
})

const shard = (chunks: readonly Uint8Array[]): Uint8Array => {
  const payloadBytes = chunks.reduce((total, chunk) => total + chunk.byteLength, 0)
  const index = new Uint8Array(chunks.length * 16)
  const view = new DataView(index.buffer)
  let offset = 0
  for (const [entry, chunk] of chunks.entries()) {
    view.setUint32(entry * 16, offset, true)
    view.setUint32(entry * 16 + 8, chunk.byteLength, true)
    offset += chunk.byteLength
  }
  const output = new Uint8Array(payloadBytes + index.byteLength)
  offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  output.set(index, payloadBytes)
  return output
}

const remoteCog = async (): Promise<GeoBenchmarkResult> => {
  const bytes = new Uint8Array(await readFile('tests/fixtures/cog/subifd-deflate-rotated.tif'))
  const server = new DeterministicRangeServer({
    'large-remote-cog.tif': byteAsset(bytes, 64 * 1024 * 1024),
  })
  const source = await HttpRangeSource.open('https://geo-benchmark.test/large-remote-cog.tif', {
    fetch: server.fetch,
    blockBytes: 512,
    maxCacheBytes: 16_384,
  })
  let peak = memoryBytes()
  const openStart = performance.now()
  const document = await geoTiffReader.open({
    primary: { id: 'large-remote-cog', name: 'large-remote-cog.tif', source },
  })
  const datasetId = document.datasets[0]?.id
  if (datasetId === undefined) throw new Error('COG benchmark has no dataset')
  const dataset = await document.openDataset(datasetId)
  const openMetadataMs = elapsed(openStart)
  peak = Math.max(peak, memoryBytes())
  const level = dataset.descriptor.levels.at(-1)
  if (level === undefined) throw new Error('COG benchmark has no overview')
  const tileStart = performance.now()
  const output = await readRegion(viewFor(dataset, { levelId: level.id }), {
    x: 0,
    y: 0,
    width: Math.min(2, level.width),
    height: Math.min(2, level.height),
  })
  const timeToFirstTileMs = elapsed(tileStart)
  peak = Math.max(peak, memoryBytes())
  const stats = source.stats
  await document.close?.()
  return {
    id: 'remote-cog-viewport',
    name: 'Large remote COG viewport',
    status: 'passed',
    fixtureIdentity: 'subifd-deflate-rotated.tif in a 64 MiB sparse deterministic object',
    correctness: `sample-sum:${output.checksum}`,
    measurements: measurements({
      openMetadataMs,
      timeToFirstTileMs,
      requestsToFirstTile: stats.requests,
      transferredBytes: stats.transferBytes,
      uniqueBytes: stats.uniqueBytes,
      decodedPixels: output.pixels,
      cacheHits: stats.cacheHits,
      peakManagedMemoryBytes: peak,
      overviewSelection: level.id,
    }),
    notes: ['The sparse logical size makes a full-source fallback fail the selective-access gate.'],
  }
}

const shardedFiles = (): Readonly<Record<string, Uint8Array>> => {
  const sharding = {
    name: 'sharding_indexed',
    configuration: {
      chunk_shape: [2, 2],
      codecs: [{ name: 'bytes', configuration: { endian: 'little' } }],
      index_codecs: [{ name: 'bytes', configuration: { endian: 'little' } }],
      index_location: 'end',
    },
  }
  return {
    'sharded/zarr.json': zarrV3ArrayMetadata({
      shape: [4, 4],
      chunkShape: [4, 4],
      dimensionNames: ['Y', 'X'],
      codecs: [sharding],
      attributes: geoAttributes(['Y', 'X']),
    }),
    'sharded/c/0/0': shard([
      Uint8Array.of(1, 2, 5, 6),
      Uint8Array.of(3, 4, 7, 8),
      Uint8Array.of(9, 10, 13, 14),
      Uint8Array.of(11, 12, 15, 16),
    ]),
  }
}

const remoteShardedZarr = async (): Promise<GeoBenchmarkResult> => {
  const files = shardedFiles()
  const server = new DeterministicObjectStoreServer(
    Object.fromEntries(Object.entries(files).map(([path, bytes]) => [path, byteAsset(bytes)])),
  )
  let peak = memoryBytes()
  const openStart = performance.now()
  const document = await openGeoZarrHttp('https://geo-benchmark.test/sharded', {
    http: { fetch: server.fetch, blockBytes: 64, maxCacheBytesPerSource: 256 },
  })
  const dataset = await document.openDataset('root')
  const openMetadataMs = elapsed(openStart)
  const tileStart = performance.now()
  const output = await readRegion(viewFor(dataset), { x: 1, y: 1, width: 2, height: 2 })
  const timeToFirstTileMs = elapsed(tileStart)
  peak = Math.max(peak, memoryBytes())
  const report = document.inspectStructure()
  const serverStats = server.stats
  await document.close?.()
  return {
    id: 'remote-sharded-geozarr-viewport',
    name: 'Remote sharded GeoZarr viewport',
    status: 'passed',
    fixtureIdentity: 'deterministic-zarr-v3-sharding-indexed-4x4',
    correctness: `sample-sum:${output.checksum}`,
    measurements: measurements({
      openMetadataMs,
      timeToFirstTileMs,
      requestsToFirstTile: serverStats.requests,
      transferredBytes: serverStats.transferredBytes,
      uniqueBytes: serverStats.uniqueBytes,
      decodedPixels: output.pixels,
      cacheHits: report.io.cacheHits,
      peakManagedMemoryBytes: peak,
      zarrChunksAccessed: report.io.logicalChunkReads,
      zarrShardsAccessed: report.io.outerShardAccesses,
      zarrUniqueShardObjects: report.io.uniqueShardObjects,
      zarrShardIndexReads: report.io.shardIndexReads,
      zarrShardPayloadRanges: report.io.shardPayloadRanges,
    }),
    notes: ['Logical chunks, outer shards, shard indexes, and payload ranges are observed.'],
  }
}

const multidimensionalZarr = async (): Promise<GeoBenchmarkResult> => {
  const files = {
    'cube/zarr.json': zarrV3ArrayMetadata({
      shape: [2, 2, 4, 4],
      chunkShape: [1, 1, 2, 2],
      dimensionNames: ['time', 'band', 'Y', 'X'],
      attributes: { ...geoAttributes(['Y', 'X']), band_names: ['neutral-0', 'neutral-1'] },
    }),
    'cube/c/1/1/0/0': Uint8Array.of(21, 22, 25, 26),
  }
  const server = new DeterministicObjectStoreServer(
    Object.fromEntries(Object.entries(files).map(([path, bytes]) => [path, byteAsset(bytes)])),
  )
  let peak = memoryBytes()
  const openStart = performance.now()
  const document = await openGeoZarrHttp('https://geo-benchmark.test/cube', {
    http: { fetch: server.fetch, blockBytes: 64, maxCacheBytesPerSource: 256 },
  })
  const dataset = await document.openDataset('root')
  const openMetadataMs = elapsed(openStart)
  const tileStart = performance.now()
  const output = await readRegion(viewFor(dataset, { indices: { time: 1, band: 1 } }), {
    x: 0,
    y: 0,
    width: 2,
    height: 2,
  })
  const timeToFirstTileMs = elapsed(tileStart)
  peak = Math.max(peak, memoryBytes())
  const report = document.inspectStructure()
  const stats = server.stats
  await document.close?.()
  return {
    id: 'geozarr-time-band-selection',
    name: 'Multidimensional GeoZarr time and band selection',
    status: 'passed',
    fixtureIdentity: 'deterministic-zarr-v3-time-band-y-x',
    correctness: `sample-sum:${output.checksum}`,
    measurements: measurements({
      openMetadataMs,
      timeToFirstTileMs,
      requestsToFirstTile: stats.requests,
      transferredBytes: stats.transferredBytes,
      uniqueBytes: stats.uniqueBytes,
      decodedPixels: output.pixels,
      cacheHits: report.io.cacheHits,
      peakManagedMemoryBytes: peak,
      zarrChunksAccessed: report.io.chunkRequests,
    }),
    notes: ['Only the selected time, band, and spatial chunk key may be requested.'],
  }
}

const enviFixture = (): { readonly header: Uint8Array; readonly data: Uint8Array } => {
  const width = 64
  const height = 64
  const data = new Uint8Array(width * height * 2)
  const view = new DataView(data.buffer)
  for (let index = 0; index < width * height; index += 1) view.setUint16(index * 2, index, true)
  const header = encoder.encode(
    [
      'ENVI',
      `samples = ${width}`,
      `lines = ${height}`,
      'bands = 1',
      'header offset = 0',
      'file type = ENVI Standard',
      'data type = 12',
      'interleave = bsq',
      'byte order = 0',
      'map info = {UTM, 1, 1, 500000, 4100000, 30, 30, 11, North, WGS-84, units=Meters}',
      'data ignore value = 65535',
    ].join('\n'),
  )
  return { header, data }
}

const openEnvi = async (): Promise<{
  readonly dataset: GeoRasterDataset
  readonly header: CountingImageSource
  readonly data: CountingImageSource
  readonly openMetadataMs: number
  readonly close?: () => void | Promise<void>
}> => {
  const fixture = enviFixture()
  const header = new CountingImageSource(new MemorySource(fixture.header))
  const data = new CountingImageSource(new MemorySource(fixture.data))
  const primary: ScientificResource = { id: 'subset-header', name: 'subset.hdr', source: header }
  const context: ScientificOpenContext = {
    primary,
    companions: {
      async resolve() {
        return { id: 'subset-data', name: 'subset', source: data }
      },
    },
  }
  const start = performance.now()
  const document = await geoEnviReader.open(context)
  const dataset = await document.openDataset('raster')
  return {
    dataset,
    header,
    data,
    openMetadataMs: elapsed(start),
    ...(document.close === undefined ? {} : { close: document.close }),
  }
}

const localEnvi = async (): Promise<GeoBenchmarkResult> => {
  let peak = memoryBytes()
  const opened = await openEnvi()
  const tileStart = performance.now()
  const output = await readRegion(viewFor(opened.dataset), { x: 20, y: 20, width: 8, height: 8 })
  const timeToFirstTileMs = elapsed(tileStart)
  peak = Math.max(peak, memoryBytes())
  const stats = [opened.header.snapshot, opened.data.snapshot]
  await opened.close?.()
  return {
    id: 'local-envi-subset',
    name: 'Local ENVI subset',
    status: 'passed',
    fixtureIdentity: 'deterministic-envi-bsq-uint16-64x64',
    correctness: `sample-sum:${output.checksum}`,
    measurements: measurements({
      openMetadataMs: opened.openMetadataMs,
      timeToFirstTileMs,
      requestsToFirstTile: stats.reduce((sum, item) => sum + item.readCalls, 0),
      transferredBytes: stats.reduce((sum, item) => sum + item.returnedBytes, 0),
      uniqueBytes: stats.reduce((sum, item) => sum + item.uniqueSourceBytesTouched, 0),
      decodedPixels: output.pixels,
      peakManagedMemoryBytes: peak,
    }),
    notes: ['BSQ subset reads reuse the scientific ENVI decoder.'],
  }
}

const textAttribute = (name: string, value: string): FixtureNetCdfAttribute => ({
  name,
  type: 'char',
  values: value,
})

const remoteNetCdf = async (): Promise<GeoBenchmarkResult> => {
  const width = 64
  const height = 64
  const fixture = createNetCdfClassicFixture({
    version: 2,
    dimensions: [
      { name: 'lat', length: height },
      { name: 'lon', length: width },
    ],
    variables: [
      {
        name: 'lat',
        dimensions: ['lat'],
        type: 'float',
        attributes: [
          textAttribute('standard_name', 'latitude'),
          textAttribute('units', 'degrees_north'),
        ],
        values: Array.from({ length: height }, (_, index) => 50 - index),
      },
      {
        name: 'lon',
        dimensions: ['lon'],
        type: 'float',
        attributes: [
          textAttribute('standard_name', 'longitude'),
          textAttribute('units', 'degrees_east'),
        ],
        values: Array.from({ length: width }, (_, index) => -123 + index),
      },
      {
        name: 'temperature',
        dimensions: ['lat', 'lon'],
        type: 'short',
        attributes: [{ name: '_FillValue', type: 'short', values: [-9999] }],
        values: Array.from({ length: width * height }, (_, index) => index),
      },
    ],
  })
  if (fixture.bytes === undefined) throw new Error('NetCDF benchmark fixture was not materialized')
  const server = new DeterministicRangeServer({
    'remote-subset.nc': byteAsset(fixture.bytes, 32 * 1024 * 1024),
  })
  const source = await HttpRangeSource.open('https://geo-benchmark.test/remote-subset.nc', {
    fetch: server.fetch,
    blockBytes: 512,
    maxCacheBytes: 8_192,
  })
  let peak = memoryBytes()
  const openStart = performance.now()
  const document = await geoNetCdfReader.open({
    primary: { id: 'remote-netcdf', name: 'remote-subset.nc', source },
  })
  const dataset = await document.openDataset('temperature')
  const openMetadataMs = elapsed(openStart)
  const tileStart = performance.now()
  const output = await readRegion(viewFor(dataset), { x: 24, y: 24, width: 8, height: 8 })
  const timeToFirstTileMs = elapsed(tileStart)
  peak = Math.max(peak, memoryBytes())
  const stats = source.stats
  await document.close?.()
  return {
    id: 'remote-netcdf-variable-subset',
    name: 'Remote NetCDF variable subset',
    status: 'passed',
    fixtureIdentity: 'deterministic-cdf2-64x64 in a 32 MiB sparse object',
    correctness: `sample-sum:${output.checksum}`,
    measurements: measurements({
      openMetadataMs,
      timeToFirstTileMs,
      requestsToFirstTile: stats.requests,
      transferredBytes: stats.transferBytes,
      uniqueBytes: stats.uniqueBytes,
      decodedPixels: output.pixels,
      cacheHits: stats.cacheHits,
      peakManagedMemoryBytes: peak,
    }),
    notes: [
      'Metadata and one variable subset must remain below one percent of logical object size.',
    ],
  }
}

const targetGridReprojection = async (): Promise<GeoBenchmarkResult> => {
  let peak = memoryBytes()
  const opened = await openEnvi()
  const view = viewFor(opened.dataset)
  const nativeStart = performance.now()
  const native = await readRegion(view, { x: 8, y: 8, width: 32, height: 32 })
  const nativeMs = elapsed(nativeStart)
  const level = opened.dataset.descriptor.levels[0]
  if (level === undefined) throw new Error('ENVI reprojection benchmark has no level')
  const sourceType = opened.dataset.descriptor.sampleType
  if (sourceType === 'float16') throw new Error('Unexpected float16 ENVI sample type')
  const target = geoTargetGridFromGeometry(
    level.geometry,
    opened.dataset.descriptor.spatialReference,
    {
      sampleType: sourceType,
      noData: { kind: 'value', value: 65535 },
      bandLayout: { componentCount: 1, layout: 'interleaved', sourceBands: [0] },
    },
  )
  const reprojectionStart = performance.now()
  let pixels = 0
  let checksum = 0
  for await (const tile of readReprojectedGeoRegion(view, {
    targetGrid: target,
    targetRegion: { x: 8, y: 8, width: 32, height: 32 },
    sourceBands: [0],
    resampling: 'nearest',
  })) {
    pixels += tile.width * tile.height * tile.componentCount
    for (let index = 0; index < tile.data.length; index += 1)
      checksum += Number(tile.data[index] ?? 0)
    tile.release()
  }
  const reprojectionMs = elapsed(reprojectionStart)
  peak = Math.max(peak, memoryBytes())
  const stats = [opened.header.snapshot, opened.data.snapshot]
  await opened.close?.()
  if (checksum !== native.checksum) throw new Error('Identity reprojection changed samples')
  return {
    id: 'target-grid-reprojection',
    name: 'Target-grid reprojection',
    status: 'passed',
    fixtureIdentity: 'deterministic-envi-bsq-uint16-64x64',
    correctness: `identity-sample-sum:${checksum}`,
    measurements: measurements({
      openMetadataMs: opened.openMetadataMs,
      timeToFirstTileMs: reprojectionMs,
      requestsToFirstTile: stats.reduce((sum, item) => sum + item.readCalls, 0),
      transferredBytes: stats.reduce((sum, item) => sum + item.returnedBytes, 0),
      uniqueBytes: stats.reduce((sum, item) => sum + item.uniqueSourceBytesTouched, 0),
      decodedPixels: pixels,
      peakManagedMemoryBytes: peak,
      reprojectionOverheadMs: Number(Math.max(0, reprojectionMs - nativeMs).toFixed(3)),
    }),
    notes: ['Overhead is measured against a native read of the same source window and samples.'],
  }
}

const scenarios: readonly (() => Promise<GeoBenchmarkResult>)[] = [
  remoteCog,
  remoteShardedZarr,
  multidimensionalZarr,
  localEnvi,
  remoteNetCdf,
  targetGridReprojection,
]

const results: GeoBenchmarkResult[] = []
for (const scenario of scenarios) results.push(await scenario())

const report: GeoBenchmarkReport = {
  schemaVersion: 1,
  harnessVersion: 1,
  generatedAt: new Date().toISOString(),
  deterministicServers: true,
  results,
}

const failures = results.filter(({ status }) => status !== 'passed')
if (failures.length > 0)
  throw new Error(`Geo benchmark failures: ${failures.map(({ id }) => id).join(', ')}`)
const cog = results.find(({ id }) => id === 'remote-cog-viewport')
const netcdf = results.find(({ id }) => id === 'remote-netcdf-variable-subset')
if (cog === undefined || cog.measurements.transferredBytes >= 64 * 1024 * 1024)
  throw new Error('COG selective access gate failed')
if (netcdf === undefined || netcdf.measurements.transferredBytes >= 32 * 1024 * 1024 * 0.01)
  throw new Error('NetCDF selective access gate failed')

const markdown = [
  '<!-- Generated by npm run bench:geo:write. Do not edit directly. -->',
  '# Geo benchmark evidence',
  '',
  '## Quick Answer',
  '',
  'All required scenarios passed against deterministic in-process range and object-store servers.',
  'Timing is a local snapshot. Requests, bytes, selected chunks, selected shards, decoded pixels,',
  'and correctness gates are the stable CI evidence.',
  '',
  '| Scenario | Open ms | First tile ms | Requests | Transfer bytes | Unique bytes | Pixels | Cache hits | Reprojection overhead ms | Overview | Zarr chunks | Zarr shard accesses | Unique shard objects | Shard index reads | Shard payload ranges |',
  '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: |',
  ...results.map(
    ({ name, measurements: item }) =>
      `| ${name} | ${item.openMetadataMs} | ${item.timeToFirstTileMs} | ${item.requestsToFirstTile} | ${item.transferredBytes} | ${item.uniqueBytes} | ${item.decodedPixels} | ${item.cacheHits} | ${item.reprojectionOverheadMs} | ${item.overviewSelection ?? 'n/a'} | ${item.zarrChunksAccessed} | ${item.zarrShardsAccessed} | ${item.zarrUniqueShardObjects} | ${item.zarrShardIndexReads} | ${item.zarrShardPayloadRanges} |`,
  ),
  '',
  'Peak managed memory is recorded in the JSON artifact as sampled V8 heap, external, and ArrayBuffer',
  'memory. It is not presented as process peak RSS.',
  '',
].join('\n')

if (writeOutputs) {
  const outputs = new Map([
    ['benchmark/generated/geo-benchmark.json', `${JSON.stringify(report, null, 2)}\n`],
    ['docs/generated/geo-benchmark.md', markdown],
  ])
  for (const [path, contents] of outputs) {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, contents)
  }
} else {
  const retainedValue: unknown = JSON.parse(
    await readFile('benchmark/generated/geo-benchmark.json', 'utf8'),
  )
  const retained = parseGeoBenchmarkReport(retainedValue)
  const stableEvidence = (result: GeoBenchmarkResult) => ({
    id: result.id,
    status: result.status,
    fixtureIdentity: result.fixtureIdentity,
    correctness: result.correctness,
    requestsToFirstTile: result.measurements.requestsToFirstTile,
    transferredBytes: result.measurements.transferredBytes,
    uniqueBytes: result.measurements.uniqueBytes,
    decodedPixels: result.measurements.decodedPixels,
    cacheHits: result.measurements.cacheHits,
    overviewSelection: result.measurements.overviewSelection,
    zarrChunksAccessed: result.measurements.zarrChunksAccessed,
    zarrShardsAccessed: result.measurements.zarrShardsAccessed,
    zarrUniqueShardObjects: result.measurements.zarrUniqueShardObjects,
    zarrShardIndexReads: result.measurements.zarrShardIndexReads,
    zarrShardPayloadRanges: result.measurements.zarrShardPayloadRanges,
  })
  if (
    JSON.stringify(retained.results.map(stableEvidence)) !==
    JSON.stringify(results.map(stableEvidence))
  ) {
    throw new Error('Generated geo benchmark evidence is stale. Run npm run bench:geo:write.')
  }
}

console.log(JSON.stringify({ passed: results.length, deterministicServers: true, writeOutputs }))
