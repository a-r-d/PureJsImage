import { describe, expect, it } from 'vitest'
import {
  geoZarrMultiscalesConvention,
  geoZarrProjConvention,
  parseGeoZarrConventionMetadata,
} from '../src/geo/conventions/geozarr/index.ts'
import { openGeoZarrObjectStore } from '../src/geo/readers/geozarr/index.ts'
import { openNetCdfClassic } from '../src/netcdf/classic.ts'
import { MemorySource } from '../src/source.ts'
import { HttpRangeSource } from '../src/sources/http-range.ts'
import {
  discoverZarrRoot,
  type ZarrObject,
  type ZarrObjectStore,
  type ZarrStoreLimits,
} from '../src/zarr/index.ts'
import { zarrV3ArrayMetadata, zarrV3GroupMetadata } from './helpers/zarr-metadata-fixtures.ts'

const limits: Readonly<ZarrStoreLimits> = {
  maxMetadataBytes: 1_024,
  maxDimensions: 8,
  maxChunkBytes: 1_024,
  maxDecodedChunkBytes: 1_024,
  maxOpenSources: 8,
  maxCachedChunkBytes: 4_096,
  maxStoreResolutions: 32,
}

const store = (
  files: Readonly<Record<string, Uint8Array>>,
  close?: () => void,
): ZarrObjectStore => ({
  async resolve(relative: string): Promise<ZarrObject | undefined> {
    const bytes = files[relative]
    return bytes === undefined ? undefined : { id: relative, source: new MemorySource(bytes) }
  },
  ...(close === undefined ? {} : { close }),
})

const registration = (
  definition: typeof geoZarrProjConvention | typeof geoZarrMultiscalesConvention,
) => ({
  schema_url: definition.schemaUrl,
  spec_url: definition.specUrl,
  uuid: definition.uuid,
  name: definition.name,
  description: definition.description,
})

describe('geo hostile-input and boundedness gates', () => {
  it('cancels an HTTP range body that exceeds the requested response length', async () => {
    let cancelled = false
    const fetcher: typeof fetch = async (_input, init) => {
      const match = new Headers(init?.headers).get('range')?.match(/^bytes=(\d+)-(\d+)$/u)
      if (match === undefined || match === null) return new Response(null, { status: 416 })
      const start = Number(match[1])
      const end = Number(match[2])
      if (start === 0 && end === 0) {
        return new Response(Uint8Array.of(1), {
          status: 206,
          headers: { 'content-range': 'bytes 0-0/128' },
        })
      }
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(end - start + 2))
          },
          cancel() {
            cancelled = true
          },
        }),
        { status: 206, headers: { 'content-range': `bytes ${start}-${end}/128` } },
      )
    }
    const source = await HttpRangeSource.open('https://example.test/oversized-geo.bin', {
      fetch: fetcher,
      blockBytes: 16,
    })
    await expect(source.read(16, 1)).rejects.toThrow('more than the expected 16 bytes')
    expect(cancelled).toBe(true)
  })

  it('rejects oversized metadata and excessive shard chunk counts before allocation', async () => {
    await expect(
      discoverZarrRoot(
        store({ 'zarr.json': new Uint8Array(limits.maxMetadataBytes + 1) }),
        'zarr.json',
        limits,
      ),
    ).rejects.toThrow('exceeds')

    const sharding = {
      name: 'sharding_indexed',
      configuration: {
        chunk_shape: [1, 1],
        codecs: [{ name: 'bytes', configuration: { endian: 'little' } }],
        index_codecs: [{ name: 'bytes', configuration: { endian: 'little' } }],
        index_location: 'end',
      },
    }
    const root = await discoverZarrRoot(
      store({
        'zarr.json': zarrV3GroupMetadata(),
        'image/zarr.json': zarrV3ArrayMetadata({
          shape: [65_536, 65_536],
          chunkShape: [65_536, 65_536],
          dimensionNames: ['Y', 'X'],
          codecs: [sharding],
        }),
        'image/c/0/0': Uint8Array.of(0),
      }),
      'zarr.json',
      limits,
    )
    const image = await root.store.openArray('image')
    await expect(root.store.readRegion(image, [0, 0], [1, 1])).rejects.toThrow(
      /index|safe integer|exceeds/u,
    )
  })

  it('rejects excessive pyramid levels and deeply nested convention attributes', () => {
    const multiscale = {
      zarrFormat: 3 as const,
      nodeType: 'group' as const,
      path: '',
      metadata: {
        zarr_format: 3,
        node_type: 'group',
        attributes: {
          zarr_conventions: [registration(geoZarrMultiscalesConvention)],
          multiscales: { layout: [{ asset: '0' }, { asset: '1' }, { asset: '2' }] },
        },
      },
    }
    expect(() =>
      parseGeoZarrConventionMetadata({ group: multiscale }, { limits: { maxLevels: 2 } }),
    ).toThrow('maxLevels')

    const deep = {
      zarrFormat: 3 as const,
      nodeType: 'group' as const,
      path: '',
      metadata: {
        zarr_format: 3,
        node_type: 'group',
        attributes: {
          zarr_conventions: [registration(geoZarrProjConvention)],
          'proj:projjson': { type: 'ProjectedCRS', name: 'deep', a: { b: { c: { d: true } } } },
        },
      },
    }
    expect(() =>
      parseGeoZarrConventionMetadata({ group: deep }, { limits: { maxJsonDepth: 3 } }),
    ).toThrow(/Depth/u)
  })

  it('rejects malicious NetCDF counts and preserves cancellation and closure', async () => {
    const malformed = new Uint8Array(16)
    malformed.set([0x43, 0x44, 0x46, 1])
    const view = new DataView(malformed.buffer)
    view.setUint32(8, 10, false)
    view.setUint32(12, 0xffff_ffff, false)
    await expect(
      openNetCdfClassic(new MemorySource(malformed), { maxDimensions: 8 }),
    ).rejects.toThrow()

    let closes = 0
    const controller = new AbortController()
    controller.abort(new Error('cancel hostile geo read'))
    await expect(
      openGeoZarrObjectStore(
        store({ 'zarr.json': zarrV3GroupMetadata() }, () => {
          closes += 1
        }),
        {
          primaryName: 'zarr.json',
          signal: controller.signal,
        },
      ),
    ).rejects.toThrow('cancel hostile geo read')
    expect(closes).toBe(1)
  })

  it('rejects unsupported Zarr codecs explicitly', async () => {
    const root = await discoverZarrRoot(
      store({
        'zarr.json': zarrV3GroupMetadata(),
        'image/zarr.json': zarrV3ArrayMetadata({
          shape: [2, 2],
          chunkShape: [2, 2],
          dimensionNames: ['Y', 'X'],
          codecs: [{ name: 'future_codec' }],
        }),
        'image/c/0/0': Uint8Array.of(1, 2, 3, 4),
      }),
      'zarr.json',
      limits,
    )
    await expect(root.store.openArray('image')).rejects.toThrow(/codec/u)
  })
})
