import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { crc32 } from '../src/codecs/crc32.ts'
import {
  createGeoZarrReader,
  type GeoZarrDocument,
  openGeoZarrHttp,
  openGeoZarrObjectStore,
} from '../src/geo/readers/geozarr/index.ts'
import { openGeoZarrDirectory } from '../src/geo/readers/geozarr/node.ts'
import type {
  ScientificCompanionRequest,
  ScientificOpenContext,
  ScientificResource,
} from '../src/scientific/reader.ts'
import { MemorySource } from '../src/source.ts'
import type { ZarrObject, ZarrObjectStore } from '../src/zarr/core.ts'
import {
  encodeZarrJson,
  zarrV2ArrayMetadata,
  zarrV3ArrayMetadata,
  zarrV3GroupMetadata,
} from './helpers/zarr-metadata-fixtures.ts'

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
  multiscales: {
    schema_url:
      'https://raw.githubusercontent.com/zarr-conventions/multiscales/refs/tags/v0.1/schema.json',
    spec_url: 'https://github.com/zarr-conventions/multiscales/blob/v0.1/README.md',
    uuid: 'd35379db-88df-4056-af3a-620245f8e347',
    name: 'multiscales',
    description: 'Multiscale layout of zarr datasets',
  },
} as const

const geoAttributes = (
  dimensions: readonly [string, string],
  transform: readonly [number, number, number, number, number, number],
  extras: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> => ({
  zarr_conventions: [conventions.proj, conventions.spatial],
  'proj:code': 'EPSG:32632',
  'spatial:dimensions': dimensions,
  'spatial:transform': transform,
  ...extras,
})

const resource = (name: string, bytes: Uint8Array): ScientificResource =>
  Object.freeze({ id: name, name, source: new MemorySource(bytes) })

const trackingContext = (
  files: Readonly<Record<string, Uint8Array>>,
  primaryName: string,
): { readonly context: ScientificOpenContext; readonly resolutions: string[] } => {
  const primary = files[primaryName]
  if (primary === undefined) throw new Error(`Missing ${primaryName}`)
  const resolutions: string[] = []
  return {
    resolutions,
    context: {
      primary: resource(primaryName, primary),
      companions: {
        async resolve(request: Readonly<ScientificCompanionRequest>) {
          const name = request.kind === 'relative-name' ? request.name : request.relativeName
          if (name === undefined) return undefined
          resolutions.push(name)
          const bytes = files[name]
          return bytes === undefined ? undefined : resource(name, bytes)
        },
      },
    },
  }
}

const memoryStore = (
  files: Readonly<Record<string, Uint8Array>>,
  resolutions: string[] = [],
  close?: () => void,
): ZarrObjectStore =>
  Object.freeze({
    async resolve(relative: string, signal?: AbortSignal): Promise<ZarrObject | undefined> {
      signal?.throwIfAborted()
      resolutions.push(relative)
      const bytes = files[relative]
      return bytes === undefined
        ? undefined
        : Object.freeze({ id: relative, source: new MemorySource(bytes) })
    },
    ...(close === undefined ? {} : { close }),
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

const zipArchive = (files: Readonly<Record<string, Uint8Array>>): Uint8Array => {
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  for (const [name, value] of Object.entries(files)) {
    const nameBytes = new TextEncoder().encode(name)
    const checksum = crc32(value)
    const local = new Uint8Array(30 + nameBytes.byteLength + value.byteLength)
    const localView = new DataView(local.buffer)
    localView.setUint32(0, 0x0403_4b50, true)
    localView.setUint16(4, 20, true)
    localView.setUint32(14, checksum, true)
    localView.setUint32(18, value.byteLength, true)
    localView.setUint32(22, value.byteLength, true)
    localView.setUint16(26, nameBytes.byteLength, true)
    local.set(nameBytes, 30)
    local.set(value, 30 + nameBytes.byteLength)
    locals.push(local)
    const central = new Uint8Array(46 + nameBytes.byteLength)
    const centralView = new DataView(central.buffer)
    centralView.setUint32(0, 0x0201_4b50, true)
    centralView.setUint16(4, 20, true)
    centralView.setUint16(6, 20, true)
    centralView.setUint32(16, checksum, true)
    centralView.setUint32(20, value.byteLength, true)
    centralView.setUint32(24, value.byteLength, true)
    centralView.setUint16(28, nameBytes.byteLength, true)
    centralView.setUint32(42, offset, true)
    central.set(nameBytes, 46)
    centrals.push(central)
    offset += local.byteLength
  }
  const centralBytes = centrals.reduce((total, value) => total + value.byteLength, 0)
  const output = new Uint8Array(offset + centralBytes + 22)
  let cursor = 0
  for (const local of locals) {
    output.set(local, cursor)
    cursor += local.byteLength
  }
  const centralOffset = cursor
  for (const central of centrals) {
    output.set(central, cursor)
    cursor += central.byteLength
  }
  const view = new DataView(output.buffer)
  view.setUint32(cursor, 0x0605_4b50, true)
  view.setUint16(cursor + 8, centrals.length, true)
  view.setUint16(cursor + 10, centrals.length, true)
  view.setUint32(cursor + 12, centralBytes, true)
  view.setUint32(cursor + 16, centralOffset, true)
  return output
}

const mockFetch = (
  files: Readonly<Record<string, Uint8Array>>,
): { readonly fetch: typeof fetch; readonly requests: string[] } => {
  const requests: string[] = []
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input))
    const path = url.pathname.replace('/store/', '')
    requests.push(`${init?.method ?? 'GET'} ${path}`)
    const bytes = files[path]
    if (bytes === undefined) return new Response(null, { status: 404 })
    if (init?.method === 'HEAD') {
      return new Response(null, {
        status: 200,
        headers: { 'content-length': String(bytes.length) },
      })
    }
    const range = new Headers(init?.headers).get('range')?.match(/^bytes=(\d+)-(\d+)$/u)
    if (range === undefined || range === null) return new Response(null, { status: 400 })
    const start = Number(range[1])
    const end = Math.min(Number(range[2]), bytes.length - 1)
    return new Response(bytes.slice(start, end + 1), {
      status: 206,
      headers: {
        'content-length': String(end - start + 1),
        'content-range': `bytes ${start}-${end}/${bytes.length}`,
        etag: '"geozarr-fixture"',
      },
    })
  }
  return { fetch: fetcher, requests }
}

const values = async (
  document: GeoZarrDocument,
  datasetId: string,
  options: {
    readonly levelId?: string
    readonly nonSpatial?: readonly {
      readonly kind: 'index'
      readonly axisId: string
      readonly index: number
    }[]
    readonly x?: number
    readonly y?: number
    readonly width?: number
    readonly height?: number
  } = {},
): Promise<readonly number[]> => {
  const dataset = await document.openDataset(datasetId)
  const view = dataset.createView({
    spatialDimensions: [
      dataset.descriptor.spatialDimensions.x.id,
      dataset.descriptor.spatialDimensions.y.id,
    ],
    nonSpatial: options.nonSpatial ?? [],
    sourceBands: [0],
    levelId: options.levelId ?? dataset.descriptor.primaryLevelId,
  })
  const output: number[] = []
  for await (const tile of view.readPixelRegion({
    region: {
      x: options.x ?? 0,
      y: options.y ?? 0,
      width: options.width ?? view.level.width,
      height: options.height ?? view.level.height,
    },
  })) {
    output.push(...Array.from(tile.data, Number))
    tile.release()
  }
  return output
}

const rootArrayV3 = (
  shape: readonly number[],
  dimensionNames: readonly string[],
  transform: readonly [number, number, number, number, number, number],
  extras: Readonly<Record<string, unknown>> = {},
): Uint8Array =>
  zarrV3ArrayMetadata({
    shape,
    chunkShape: shape,
    dimensionNames,
    attributes: geoAttributes(
      [dimensionNames[shape.length - 2] ?? 'Y', dimensionNames[shape.length - 1] ?? 'X'],
      transform,
      extras,
    ),
  })

describe('GeoZarr geo reader', () => {
  it('opens a v3 root raster, preserves a rotated affine, and reads a bounded viewport', async () => {
    const files = {
      'zarr.json': rootArrayV3([4, 5], ['Y', 'X'], [2, 0.5, 100, -0.25, -3, 200]),
      'c/0/0': Uint8Array.from({ length: 20 }, (_value, index) => index),
    }
    const resolved: string[] = []
    const document = await openGeoZarrObjectStore(memoryStore(files, resolved), {
      primaryName: 'zarr.json',
    })
    const dataset = await document.openDataset('root')
    expect(dataset.descriptor.grid.pixelToWorld).toEqual([2, 0.5, 100, -0.25, -3, 200])
    expect(dataset.descriptor.spatialReference).toMatchObject({ authority: 'EPSG', code: '32632' })
    expect(await values(document, 'root', { x: 1, y: 1, width: 2, height: 2 })).toEqual([
      6, 7, 11, 12,
    ])
    expect(resolved.filter((name) => name === 'c/0/0')).toHaveLength(1)
    expect(document.inspectStructure()).toMatchObject({
      zarrFormat: 3,
      rootNodeType: 'array',
      datasets: [
        {
          levels: [
            {
              array: { logicalChunkShape: [4, 5], sharded: false, codecs: ['bytes'] },
            },
          ],
        },
      ],
    })
  })

  it('opens a v2 node-registered raster and preserves fill, nodata, scale, and offset evidence', async () => {
    const files = {
      '.zarray': zarrV2ArrayMetadata({ shape: [2, 3], chunks: [2, 3], fillValue: 9 }),
      '.zattrs': encodeZarrJson({
        _ARRAY_DIMENSIONS: ['Y', 'X'],
        ...geoAttributes(['Y', 'X'], [1, 0, 10, 0, -1, 20], {
          'spatial:registration': 'node',
          _FillValue: 9,
          scale_factor: 0.5,
          add_offset: 2,
        }),
      }),
      '0/0': Uint8Array.of(1, 2, 3, 4, 5, 6),
    }
    const opened = trackingContext(files, '.zarray')
    const document = await createGeoZarrReader().open(opened.context)
    const dataset = await document.openDataset('root')
    expect(dataset.descriptor.grid).toMatchObject({
      pixelRegistration: 'pixel-is-point',
      noData: { kind: 'scalar', value: 9 },
    })
    expect(dataset.descriptor.bands[0]).toMatchObject({ scale: 0.5, offset: 2, noData: 9 })
    expect(await values(document, 'root')).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('keeps time and band dimensions selectable instead of flattening them', async () => {
    const files = {
      'zarr.json': rootArrayV3([2, 2, 2, 3], ['time', 'band', 'Y', 'X'], [1, 0, 0, 0, -1, 2], {
        band_names: ['coastal', 'quality'],
      }),
      'c/0/0/0/0': Uint8Array.from({ length: 24 }, (_value, index) => index),
    }
    const document = await openGeoZarrObjectStore(memoryStore(files), {
      primaryName: 'zarr.json',
    })
    const dataset = await document.openDataset('root')
    expect(dataset.descriptor.axes).toMatchObject([
      { id: 'time', kind: 'time', length: 2 },
      { id: 'band', kind: 'band', length: 2, coordinates: { kind: 'values' } },
    ])
    expect(
      await values(document, 'root', {
        nonSpatial: [
          { kind: 'index', axisId: 'time', index: 1 },
          { kind: 'index', axisId: 'band', index: 0 },
        ],
      }),
    ).toEqual([12, 13, 14, 15, 16, 17])
  })

  it('opens explicit non-power-of-two multiscales and validates per-level origins', async () => {
    const attributes = {
      ...geoAttributes(['Y', 'X'], [3, 0, 100, 0, -3, 200]),
      zarr_conventions: [conventions.proj, conventions.spatial, conventions.multiscales],
      multiscales: {
        resampling_method: 'average',
        layout: [
          {
            asset: 'fine',
            transform: { scale: [1, 1], translation: [0, 0] },
            'spatial:transform': [3, 0, 100, 0, -3, 200],
          },
          {
            asset: 'coarse',
            derived_from: 'fine',
            transform: { scale: [3, 3], translation: [2, 1] },
            resampling_method: 'mode',
          },
        ],
      },
    }
    const files = {
      'zarr.json': zarrV3GroupMetadata(attributes),
      'fine/zarr.json': zarrV3ArrayMetadata({
        shape: [6, 6],
        chunkShape: [3, 3],
        dimensionNames: ['Y', 'X'],
      }),
      'coarse/zarr.json': zarrV3ArrayMetadata({
        shape: [2, 3],
        chunkShape: [2, 3],
        dimensionNames: ['Y', 'X'],
      }),
      'fine/c/0/0': Uint8Array.of(1, 2, 3, 7, 8, 9, 13, 14, 15),
      'fine/c/0/1': Uint8Array.of(4, 5, 6, 10, 11, 12, 16, 17, 18),
      'fine/c/1/0': Uint8Array.of(19, 20, 21, 25, 26, 27, 31, 32, 33),
      'fine/c/1/1': Uint8Array.of(22, 23, 24, 28, 29, 30, 34, 35, 36),
      'coarse/c/0/0': Uint8Array.of(1, 2, 3, 7, 8, 9),
    }
    const document = await openGeoZarrObjectStore(memoryStore(files), {
      primaryName: 'zarr.json',
    })
    const dataset = await document.openDataset('multiscales')
    expect(dataset.descriptor.levels).toMatchObject([
      { id: '0', width: 6, height: 6 },
      {
        id: '1',
        width: 3,
        height: 2,
        downsample: { x: 3, y: 3 },
        geometry: { pixelToWorld: [9, 0, 103, 0, -9, 194] },
        storage: { metadata: { resamplingMethod: 'mode' } },
      },
    ])
    expect(await values(document, 'multiscales', { levelId: '1' })).toEqual([1, 2, 3, 7, 8, 9])
    expect(document.inspectStructure().datasets[0]?.diagnostics).toEqual([])
  })

  it('keeps semantic assets separate from group-based multiscale array paths', async () => {
    const attributes = {
      ...geoAttributes(['Y', 'X'], [1, 0, 0, 0, -1, 4]),
      zarr_conventions: [conventions.proj, conventions.spatial, conventions.multiscales],
      multiscales: {
        layout: [
          {
            asset: 'fine',
            'spatial:transform': [1, 0, 0, 0, -1, 4],
          },
          {
            asset: 'coarse',
            derived_from: 'fine',
            transform: { scale: [4, 4] },
            'spatial:transform': [0, -4, 40, 4, 0, 0],
          },
        ],
      },
    }
    const files = {
      'zarr.json': zarrV3GroupMetadata(attributes),
      'fine/zarr.json': zarrV3GroupMetadata(),
      'fine/data/zarr.json': zarrV3ArrayMetadata({
        shape: [4, 4],
        chunkShape: [4, 4],
        dimensionNames: ['Y', 'X'],
      }),
      'coarse/zarr.json': zarrV3GroupMetadata(),
      'coarse/data/zarr.json': zarrV3ArrayMetadata({
        shape: [1, 1],
        chunkShape: [1, 1],
        dimensionNames: ['Y', 'X'],
      }),
    }
    const document = await openGeoZarrObjectStore(memoryStore(files), {
      primaryName: 'zarr.json',
    })
    const dataset = await document.openDataset('multiscales')
    expect(dataset.descriptor.levels).toMatchObject([
      { id: '0', arrayPath: 'fine/data' },
      { id: '1', arrayPath: 'coarse/data', downsample: { x: 4, y: 4 } },
    ])
  })

  it('reads declared lazy coordinates only when requested', async () => {
    const files = {
      'zarr.json': rootArrayV3([2, 2, 2], ['time', 'Y', 'X'], [1, 0, 0, 0, -1, 2], {
        coordinates: 'time',
      }),
      'time/zarr.json': zarrV3ArrayMetadata({
        shape: [2],
        chunkShape: [2],
        dataType: 'float32',
        dimensionNames: ['time'],
      }),
      'time/c/0': Uint8Array.of(0, 0, 0, 0, 0, 0, 32, 65),
      'c/0/0/0': Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8),
    }
    const resolutions: string[] = []
    const document = await openGeoZarrObjectStore(memoryStore(files, resolutions), {
      primaryName: 'zarr.json',
    })
    const dataset = await document.openDataset('root')
    expect(dataset.descriptor.axes[0]?.coordinates).toEqual({ kind: 'lazy', valueType: 'number' })
    expect(resolutions).not.toContain('time/c/0')
    await expect(
      dataset.readAxisCoordinates({ axisId: 'time', start: 0, length: 2 }),
    ).resolves.toEqual({
      axisId: 'time',
      start: 0,
      values: [0, 10],
    })
    expect(resolutions).toContain('time/c/0')
  })

  it('uses the generic v3 shard decoder and reports logical chunks separately from outer shards', async () => {
    const sharding = {
      name: 'sharding_indexed',
      configuration: {
        chunk_shape: [2, 2],
        codecs: [{ name: 'bytes', configuration: { endian: 'little' } }],
        index_codecs: [{ name: 'bytes', configuration: { endian: 'little' } }],
        index_location: 'end',
      },
    }
    const files = {
      'zarr.json': zarrV3ArrayMetadata({
        shape: [4, 4],
        chunkShape: [4, 4],
        dimensionNames: ['Y', 'X'],
        codecs: [sharding],
        attributes: geoAttributes(['Y', 'X'], [1, 0, 0, 0, -1, 4]),
      }),
      'c/0/0': shard([
        Uint8Array.of(1, 2, 5, 6),
        Uint8Array.of(3, 4, 7, 8),
        Uint8Array.of(9, 10, 13, 14),
        Uint8Array.of(11, 12, 15, 16),
      ]),
    }
    const document = await openGeoZarrObjectStore(memoryStore(files), { primaryName: 'zarr.json' })
    expect(await values(document, 'root', { x: 1, y: 1, width: 2, height: 2 })).toEqual([
      6, 7, 10, 11,
    ])
    expect(document.inspectStructure().datasets[0]?.levels[0]?.array).toMatchObject({
      logicalChunkShape: [2, 2],
      outerShardShape: [4, 4],
      sharded: true,
      codecs: ['sharding_indexed', 'bytes'],
    })
    expect(document.inspectStructure().io).toMatchObject({
      logicalChunkReads: 4,
      outerShardAccesses: 1,
      uniqueShardObjects: 1,
      shardIndexReads: 1,
      shardPayloadRanges: 4,
    })
  })

  it('opens ZIP and remote HTTP stores without enumerating sibling objects', async () => {
    const files = {
      'zarr.json': rootArrayV3([2, 2], ['Y', 'X'], [1, 0, 0, 0, -1, 2]),
      'c/0/0': Uint8Array.of(1, 2, 3, 4),
      'unrelated/zarr.json': zarrV3GroupMetadata({ title: 'must not be opened' }),
    }
    const zipContext: ScientificOpenContext = {
      primary: resource('map.zarr.zip', zipArchive(files)),
    }
    const zipped = await createGeoZarrReader().open(zipContext)
    expect(await values(zipped, 'root')).toEqual([1, 2, 3, 4])
    expect(zipped.inspectStructure().storeKind).toBe('zip')

    const mocked = mockFetch(files)
    const remote = await openGeoZarrHttp('https://example.test/store', {
      http: { fetch: mocked.fetch, blockBytes: 64, maxCacheBytesPerSource: 128 },
    })
    expect(await values(remote, 'root', { x: 1, y: 0, width: 1, height: 2 })).toEqual([2, 4])
    expect(mocked.requests.some((entry) => entry.includes('unrelated'))).toBe(false)
    expect(remote.inspectStructure().io).toMatchObject({
      metadataRequests: expect.any(Number),
      chunkRequests: expect.any(Number),
      coalescedConsumers: expect.any(Number),
    })
    expect(remote.inspectStructure().io.chunkBytes).toBeGreaterThan(0)
  })

  it('keeps unknown CRS and vertical axes explicit and rejects unsupported codecs', async () => {
    const spatialOnly = {
      zarr_conventions: [conventions.spatial],
      'spatial:dimensions': ['Y', 'X'],
      'spatial:transform': [1, 0, 0, 0, -1, 2],
    }
    const unknownFiles = {
      'zarr.json': zarrV3ArrayMetadata({
        shape: [3, 2, 2],
        chunkShape: [3, 2, 2],
        dimensionNames: ['vertical', 'Y', 'X'],
        attributes: spatialOnly,
      }),
      'c/0/0/0': Uint8Array.from({ length: 12 }, (_value, index) => index),
    }
    const unknown = await openGeoZarrObjectStore(memoryStore(unknownFiles), {
      primaryName: 'zarr.json',
    })
    const dataset = await unknown.openDataset('root')
    expect(dataset.descriptor.spatialReference.state).toBe('unknown')
    expect(dataset.descriptor.axes).toMatchObject([{ id: 'vertical', kind: 'vertical' }])

    const unsupported = {
      'zarr.json': zarrV3ArrayMetadata({
        shape: [2, 2],
        chunkShape: [2, 2],
        dimensionNames: ['Y', 'X'],
        codecs: [{ name: 'made_up_codec' }],
        attributes: geoAttributes(['Y', 'X'], [1, 0, 0, 0, -1, 2]),
      }),
    }
    await expect(
      openGeoZarrObjectStore(memoryStore(unsupported), { primaryName: 'zarr.json' }),
    ).rejects.toThrow('made_up_codec')
  })

  it('opens only explicit independent candidates and never combines shape-matched siblings', async () => {
    const groupAttributes = {
      zarr_conventions: [conventions.proj, conventions.spatial],
      'proj:code': 'EPSG:32632',
      'spatial:dimensions': ['Y', 'X'],
      'spatial:transform': [2, 0, 10, 0, -2, 20],
    }
    const files = {
      'zarr.json': zarrV3GroupMetadata(groupAttributes),
      'elevation/zarr.json': zarrV3ArrayMetadata({
        shape: [2, 2],
        chunkShape: [2, 2],
        dimensionNames: ['Y', 'X'],
      }),
      'temperature/zarr.json': zarrV3ArrayMetadata({
        shape: [2, 2],
        chunkShape: [2, 2],
        dimensionNames: ['Y', 'X'],
      }),
      'lookalike/zarr.json': zarrV3ArrayMetadata({
        shape: [2, 2],
        chunkShape: [2, 2],
        dimensionNames: ['Y', 'X'],
      }),
      'elevation/c/0/0': Uint8Array.of(1, 2, 3, 4),
      'temperature/c/0/0': Uint8Array.of(5, 6, 7, 8),
    }
    const resolved: string[] = []
    const document = await openGeoZarrObjectStore(memoryStore(files, resolved), {
      primaryName: 'zarr.json',
      candidateArrayPaths: ['elevation', 'temperature'],
    })
    expect(document.datasets.map((entry) => entry.id)).toEqual(['elevation', 'temperature'])
    expect(resolved.some((name) => name.startsWith('lookalike/'))).toBe(false)
    expect(await values(document, 'temperature')).toEqual([5, 6, 7, 8])
  })

  it('supports local directories, cancellation, closure, malformed conventions, and bounded candidates', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'purejsimage-geozarr-'))
    try {
      await mkdir(join(directory, 'c', '0'), { recursive: true })
      await writeFile(
        join(directory, 'zarr.json'),
        rootArrayV3([2, 2], ['Y', 'X'], [1, 0, 0, 0, -1, 2]),
      )
      await writeFile(join(directory, 'c', '0', '0'), Uint8Array.of(1, 2, 3, 4))
      const local = await openGeoZarrDirectory(directory)
      expect(await values(local, 'root')).toEqual([1, 2, 3, 4])
      await local.close?.()
      await expect(local.openDataset('root')).rejects.toThrow('closed')
    } finally {
      await rm(directory, { force: true, recursive: true })
    }

    const cancelled = new AbortController()
    cancelled.abort(new Error('cancelled'))
    await expect(
      openGeoZarrObjectStore(memoryStore({}), { signal: cancelled.signal }),
    ).rejects.toThrow()

    const malformed = {
      'zarr.json': zarrV3ArrayMetadata({
        shape: [2, 2],
        chunkShape: [2, 2],
        dimensionNames: ['Y', 'X'],
        attributes: {
          ...geoAttributes(['Y', 'X'], [1, 0, 0, 0, -1, 2]),
          zarr_conventions: [{ ...conventions.spatial, uuid: 'not-a-uuid' }],
        },
      }),
    }
    await expect(
      openGeoZarrObjectStore(memoryStore(malformed), { primaryName: 'zarr.json' }),
    ).rejects.toThrow()

    const groupOnly = {
      'zarr.json': zarrV3GroupMetadata(geoAttributes(['Y', 'X'], [1, 0, 0, 0, -1, 2])),
    }
    await expect(
      openGeoZarrObjectStore(memoryStore(groupOnly), { primaryName: 'zarr.json' }),
    ).rejects.toThrow('candidateArrayPaths')
  })
})
