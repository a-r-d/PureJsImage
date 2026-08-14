import { describe, expect, it } from 'vitest'
import {
  createGeneratedLegacyGroupFixture,
  type GeneratedLegacyGroupFixtureOptions,
  type GeneratedLegacyGroupLink,
} from '../benchmark/hdf5/generated-legacy-group-fixture.ts'
import { createGeneratedHdf5Fixture } from '../benchmark/hdf5/generated-fixture.ts'
import {
  createGeneratedSymbolTableMessage,
  createGeneratedVersion2ObjectHeader,
} from '../benchmark/hdf5/generated-object-fixture.ts'
import { readHdf5LegacyGroup } from '../src/scientific/formats/hdf5-legacy-group.ts'
import {
  readHdf5ObjectHeader,
  type Hdf5LegacyLinkStorage,
} from '../src/scientific/formats/hdf5-object.ts'
import { openHdf5FileLayer, type Hdf5FileLayer } from '../src/scientific/formats/hdf5.ts'
import { MemorySource } from '../src/source.ts'
import { HostileSource } from './hostile-source.ts'

const hardLinks: readonly GeneratedLegacyGroupLink[] = [
  { kind: 'hard', name: 'entry', objectAddress: 7_000n },
  {
    kind: 'hard',
    name: 'nested',
    objectAddress: 7_100n,
    cachedGroup: { btreeAddress: 6_000n, localHeapAddress: 6_200n },
  },
]

const createFile = async (
  options: Readonly<GeneratedLegacyGroupFixtureOptions>,
  mutate?: (blocks: Map<bigint, Uint8Array<ArrayBuffer>>) => void,
): Promise<{ readonly file: Hdf5FileLayer; readonly storage: Hdf5LegacyLinkStorage }> => {
  const group = createGeneratedLegacyGroupFixture(options)
  const fixture = createGeneratedHdf5Fixture({ version: 2, fileBytes: 8_192 })
  const rootHeader = createGeneratedVersion2ObjectHeader([
    {
      type: 0x0011,
      data: createGeneratedSymbolTableMessage(group.btreeAddress, group.localHeapAddress, 8),
    },
  ])
  if (fixture.rootObjectOffset === undefined)
    throw new Error('Generated root offset is unavailable')
  fixture.bytes.set(rootHeader, fixture.rootObjectOffset)
  const blocks = new Map(group.blocks.map(([address, bytes]) => [address, bytes.slice()] as const))
  mutate?.(blocks)
  for (const [address, bytes] of blocks) fixture.bytes.set(bytes, Number(address))
  for (const link of options.links) {
    if (link.kind === 'hard') fixture.bytes[Number(link.objectAddress)] = 1
  }
  const file = await openHdf5FileLayer(new HostileSource(fixture.bytes), {
    pageBytes: 64,
    maxBytes: 512,
  })
  const object = await readHdf5ObjectHeader(file, file.superblock.rootObjectAddress)
  if (object.linkStorage?.kind !== 'legacy') {
    throw new Error('Generated object did not expose legacy link storage')
  }
  return { file, storage: object.linkStorage }
}

describe('HDF5 legacy symbol-table groups', () => {
  it('reads hard, cached-group, and soft links through a local heap and B-tree v1 leaf', async () => {
    const { file, storage } = await createFile({
      links: [...hardLinks, { kind: 'soft', name: 'alias', target: '/entry' }],
    })
    const group = await readHdf5LegacyGroup(file, storage, { objectPath: '/legacy' })

    expect(group).toMatchObject({
      heapBytes: 512,
      btreeNodes: 1,
      symbolTableNodes: 1,
    })
    expect(group.links).toEqual([
      {
        kind: 'hard',
        name: 'entry',
        characterSet: 'ascii',
        creationOrder: undefined,
        objectAddress: 7_000n,
      },
      {
        kind: 'hard',
        name: 'nested',
        characterSet: 'ascii',
        creationOrder: undefined,
        objectAddress: 7_100n,
      },
      {
        kind: 'soft',
        name: 'alias',
        characterSet: 'ascii',
        creationOrder: undefined,
        target: '/entry',
      },
    ])
  })

  it('traverses internal B-tree nodes in bounded order', async () => {
    const links: GeneratedLegacyGroupLink[] = Array.from({ length: 10 }, (_, index) => ({
      kind: 'hard',
      name: `item-${index.toString().padStart(2, '0')}`,
      objectAddress: BigInt(7_000 + index),
    }))
    const { file, storage } = await createFile({ links, depth: 1 })
    const group = await readHdf5LegacyGroup(file, storage)

    expect(group).toMatchObject({ btreeNodes: 3, symbolTableNodes: 2 })
    expect(group.links.map(({ name }) => name)).toEqual(links.map(({ name }) => name))
  })

  it('enforces heap, tree depth, node, link, and aggregate metadata limits', async () => {
    const { file, storage } = await createFile({ links: hardLinks, depth: 1 })
    await expect(readHdf5LegacyGroup(file, storage, { maxHeapBytes: 128 })).rejects.toMatchObject({
      code: 'LIMIT_EXCEEDED',
    })
    await expect(readHdf5LegacyGroup(file, storage, { maxBtreeDepth: 1 })).rejects.toMatchObject({
      code: 'LIMIT_EXCEEDED',
    })
    await expect(readHdf5LegacyGroup(file, storage, { maxBtreeNodes: 1 })).rejects.toMatchObject({
      code: 'LIMIT_EXCEEDED',
    })
    await expect(readHdf5LegacyGroup(file, storage, { maxLinks: 1 })).rejects.toMatchObject({
      code: 'LIMIT_EXCEEDED',
    })
    await expect(
      readHdf5LegacyGroup(file, storage, { maxMetadataBytes: 600 }),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
  })

  it('rejects cyclic B-trees, cyclic heap free lists, and unsupported symbol cache types', async () => {
    const cyclicTree = await createFile({ links: hardLinks, depth: 1 }, (blocks) => {
      const root = blocks.get(2_048n)
      if (root === undefined) throw new Error('Generated root B-tree is unavailable')
      new DataView(root.buffer).setBigUint64(32, 2_048n, true)
    })
    await expect(
      readHdf5LegacyGroup(cyclicTree.file, cyclicTree.storage, { objectPath: '/cycle' }),
    ).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: expect.stringContaining('cyclic'),
    })

    const cyclicHeap = await createFile({ links: hardLinks }, (blocks) => {
      const header = blocks.get(1_024n)
      const data = blocks.get(1_280n)
      if (header === undefined || data === undefined) {
        throw new Error('Generated local heap is unavailable')
      }
      new DataView(header.buffer).setBigUint64(16, 64n, true)
      new DataView(data.buffer).setBigUint64(64, 64n, true)
      new DataView(data.buffer).setBigUint64(72, 16n, true)
    })
    await expect(readHdf5LegacyGroup(cyclicHeap.file, cyclicHeap.storage)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: expect.stringContaining('free list is cyclic'),
    })

    const unsupportedCache = await createFile({ links: hardLinks }, (blocks) => {
      const symbols = blocks.get(4_608n)
      if (symbols === undefined) throw new Error('Generated symbol node is unavailable')
      new DataView(symbols.buffer).setUint32(24, 3, true)
    })
    await expect(
      readHdf5LegacyGroup(unsupportedCache.file, unsupportedCache.storage),
    ).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
      message: expect.stringContaining('cache type 3'),
    })
  })

  it('rejects malformed signatures and honors cancellation with weakest-lifetime source buffers', async () => {
    const malformed = await createFile({ links: hardLinks }, (blocks) => {
      const heap = blocks.get(1_024n)
      if (heap === undefined) throw new Error('Generated local heap is unavailable')
      heap[0] = 0
    })
    await expect(readHdf5LegacyGroup(malformed.file, malformed.storage)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: expect.stringContaining('HEAP signature'),
    })

    const group = createGeneratedLegacyGroupFixture({ links: hardLinks })
    const fixture = createGeneratedHdf5Fixture({ version: 2, fileBytes: 8_192 })
    for (const [address, bytes] of group.blocks) fixture.bytes.set(bytes, Number(address))
    const file = await openHdf5FileLayer(new MemorySource(fixture.bytes))
    const controller = new AbortController()
    controller.abort(new Error('stop legacy group'))
    await expect(
      readHdf5LegacyGroup(
        file,
        {
          kind: 'legacy',
          btreeAddress: group.btreeAddress,
          localHeapAddress: group.localHeapAddress,
        },
        { signal: controller.signal },
      ),
    ).rejects.toThrow('stop legacy group')
  })
})
