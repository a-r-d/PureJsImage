import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { MemorySource } from '../src/source.ts'
import {
  createZarrStore,
  discoverZarrRoot,
  type ZarrObject,
  type ZarrObjectStore,
  type ZarrStoreLimits,
} from '../src/zarr/index.ts'
import { ZarrDirectoryObjectStore } from '../src/zarr/node.ts'
import {
  encodeZarrJson,
  zarrV2ArrayMetadata,
  zarrV2GroupMetadata,
  zarrV3ArrayMetadata,
  zarrV3GroupMetadata,
} from './helpers/zarr-metadata-fixtures.ts'

const limits: Readonly<ZarrStoreLimits> = Object.freeze({
  maxMetadataBytes: 65_536,
  maxDimensions: 8,
  maxChunkBytes: 65_536,
  maxDecodedChunkBytes: 65_536,
  maxOpenSources: 8,
  maxCachedChunkBytes: 65_536,
  maxStoreResolutions: 64,
})

const memoryStore = (
  files: Readonly<Record<string, Uint8Array>>,
  onClose?: () => void,
): ZarrObjectStore =>
  Object.freeze({
    async resolve(relative: string, signal?: AbortSignal): Promise<ZarrObject | undefined> {
      if (signal?.aborted) throw signal.reason
      const bytes = files[relative]
      return bytes === undefined
        ? undefined
        : Object.freeze({ id: relative, source: new MemorySource(bytes) })
    },
    ...(onClose === undefined ? {} : { close: onClose }),
  })

const createShard = (chunks: readonly Uint8Array[]): Uint8Array => {
  const payloadBytes = chunks.reduce((total, chunk) => total + chunk.byteLength, 0)
  const index = new Uint8Array(chunks.length * 16)
  const view = new DataView(index.buffer)
  let offset = 0
  for (const [entry, chunk] of chunks.entries()) {
    view.setUint32(entry * 16, offset, true)
    view.setUint32(entry * 16 + 8, chunk.byteLength, true)
    offset += chunk.byteLength
  }
  const shard = new Uint8Array(payloadBytes + index.byteLength)
  offset = 0
  for (const chunk of chunks) {
    shard.set(chunk, offset)
    offset += chunk.byteLength
  }
  shard.set(index, payloadBytes)
  return shard
}

describe('generic Zarr substrate', () => {
  it('discovers v2 groups, preserves generic attributes, and reads chunk subsets', async () => {
    const objectStore = memoryStore({
      '.zgroup': zarrV2GroupMetadata(),
      '.zattrs': encodeZarrJson({ title: 'generic cube', convention: 'not-ome' }),
      'cube/.zarray': zarrV2ArrayMetadata({ shape: [2, 3], chunks: [2, 3] }),
      'cube/.zattrs': encodeZarrJson({ _ARRAY_DIMENSIONS: ['row', 'column'], unit: 'count' }),
      'cube/0/0': Uint8Array.of(1, 2, 3, 4, 5, 6),
    })
    const root = await discoverZarrRoot(objectStore, '.zgroup', limits)
    expect(root.format).toBe(2)
    expect(root.nodeType).toBe('group')
    expect(root.metadata.attributes).toEqual({ title: 'generic cube', convention: 'not-ome' })

    const array = await root.store.openArray('cube')
    expect(array.dimensionNames).toEqual(['row', 'column'])
    expect(array.attributes).toEqual({ _ARRAY_DIMENSIONS: ['row', 'column'], unit: 'count' })
    await expect(root.store.readRegion(array, [0, 1], [2, 2])).resolves.toEqual(
      Uint8Array.of(2, 3, 5, 6),
    )
  })

  it('opens v3 arrays with different dimension layouts and fills missing chunks', async () => {
    const objectStore = memoryStore({
      'zarr.json': zarrV3GroupMetadata({ purpose: 'generic metadata' }),
      'time/zarr.json': zarrV3ArrayMetadata({
        shape: [2, 2, 3],
        chunkShape: [1, 2, 3],
        dimensionNames: ['time', 'y', 'x'],
        fillValue: 7,
      }),
      'time/c/0/0/0': Uint8Array.of(1, 2, 3, 4, 5, 6),
      'cube/zarr.json': zarrV3ArrayMetadata({
        shape: [2, 3, 2, 2],
        chunkShape: [1, 1, 2, 2],
        dimensionNames: ['band', null, 'y', 'x'],
      }),
    })
    const root = await discoverZarrRoot(objectStore, undefined, limits)
    const time = await root.store.openArray('time')
    const cube = await root.store.openArray('cube')
    expect(time.dimensionNames).toEqual(['time', 'y', 'x'])
    expect(cube.dimensionNames).toEqual(['band', null, 'y', 'x'])
    await expect(root.store.readRegion(time, [0, 0, 1], [2, 2, 2])).resolves.toEqual(
      Uint8Array.of(2, 3, 5, 6, 7, 7, 7, 7),
    )
  })

  it('decodes logical chunks inside a v3 shard for a bounded region', async () => {
    const sharding = {
      name: 'sharding_indexed',
      configuration: {
        chunk_shape: [2, 2],
        codecs: [{ name: 'bytes', configuration: { endian: 'little' } }],
        index_codecs: [{ name: 'bytes', configuration: { endian: 'little' } }],
        index_location: 'end',
      },
    }
    const objectStore = memoryStore({
      'zarr.json': zarrV3GroupMetadata(),
      'image/zarr.json': zarrV3ArrayMetadata({
        shape: [4, 4],
        chunkShape: [4, 4],
        dimensionNames: ['y', 'x'],
        codecs: [sharding],
      }),
      'image/c/0/0': createShard([
        Uint8Array.of(1, 2, 5, 6),
        Uint8Array.of(3, 4, 7, 8),
        Uint8Array.of(9, 10, 13, 14),
        Uint8Array.of(11, 12, 15, 16),
      ]),
    })
    const root = await discoverZarrRoot(objectStore, 'zarr.json', limits)
    const image = await root.store.openArray('image')
    await expect(root.store.readRegion(image, [1, 1], [2, 2])).resolves.toEqual(
      Uint8Array.of(6, 7, 10, 11),
    )
  })

  it('propagates cancellation and closes the underlying object store once', async () => {
    let closes = 0
    const objectStore = memoryStore({ 'zarr.json': zarrV3GroupMetadata() }, () => {
      closes += 1
    })
    const controller = new AbortController()
    const reason = new Error('test cancellation')
    controller.abort(reason)
    await expect(discoverZarrRoot(objectStore, undefined, limits, controller.signal)).rejects.toBe(
      reason,
    )

    const root = await discoverZarrRoot(objectStore, undefined, limits)
    expect(root.store.diagnostics()).toMatchObject({ closed: false, format: 3 })
    await root.store.close()
    await root.store.close()
    expect(closes).toBe(1)
    expect(root.store.diagnostics()).toMatchObject({ closed: true, metadataCacheEntries: 0 })
    await expect(root.store.openGroup('')).rejects.toThrow('closed')
  })

  it('reports malformed hierarchy and codec failures without OME interpretation', async () => {
    await expect(
      discoverZarrRoot(
        memoryStore({ 'zarr.json': encodeZarrJson({ node_type: 'group', attributes: {} }) }),
        undefined,
        limits,
      ),
    ).rejects.toThrow('does not describe a v2 or v3 node')

    const objectStore = memoryStore({
      'zarr.json': zarrV3GroupMetadata(),
      'bad/zarr.json': zarrV3ArrayMetadata({
        shape: [2, 2],
        chunkShape: [2, 2],
        codecs: [{ name: 'example.codec', configuration: {} }],
      }),
    })
    const store = createZarrStore(objectStore, 'zarr.json', limits, 3)
    await expect(store.openArray('bad')).rejects.toThrow('Zarr codec example.codec is unsupported')

    const rankStore = createZarrStore(
      memoryStore({
        'cube/zarr.json': zarrV3ArrayMetadata({
          shape: [1, 1, 1],
          chunkShape: [1, 1, 1],
        }),
      }),
      'zarr.json',
      { ...limits, maxDimensions: 2 },
      3,
    )
    await expect(rankStore.openArray('cube')).rejects.toThrow('rank exceeds 2 dimensions')
  })

  it('uses the same substrate through the Node local-directory adapter', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'purejsimage-zarr-'))
    try {
      await mkdir(join(rootPath, 'image'))
      await mkdir(join(rootPath, 'image', 'c'))
      await mkdir(join(rootPath, 'image', 'c', '0'))
      await writeFile(join(rootPath, 'zarr.json'), zarrV3GroupMetadata())
      await writeFile(
        join(rootPath, 'image', 'zarr.json'),
        zarrV3ArrayMetadata({ shape: [2, 2], chunkShape: [2, 2] }),
      )
      await writeFile(join(rootPath, 'image', 'c', '0', '0'), Uint8Array.of(4, 3, 2, 1))
      const objectStore = await ZarrDirectoryObjectStore.open(rootPath)
      const root = await discoverZarrRoot(objectStore, undefined, limits)
      const array = await root.store.openArray('image')
      await expect(root.store.readRegion(array, [0, 0], [2, 2])).resolves.toEqual(
        Uint8Array.of(4, 3, 2, 1),
      )
      await root.store.close()
    } finally {
      await rm(rootPath, { recursive: true, force: true })
    }
  })
})
