import { describe, expect, it } from 'vitest'
import {
  createGeneratedDenseGroupFixture,
  type GeneratedDenseGroupFixtureOptions,
  type GeneratedDenseGroupLink,
} from '../benchmark/hdf5/generated-dense-group-fixture.ts'
import { createGeneratedHdf5Fixture } from '../benchmark/hdf5/generated-fixture.ts'
import { createGeneratedVersion2ObjectHeader } from '../benchmark/hdf5/generated-object-fixture.ts'
import { readHdf5DenseGroup } from '../src/scientific/formats/hdf5-dense-group.ts'
import {
  readHdf5ObjectHeader,
  type Hdf5DenseLinkStorage,
} from '../src/scientific/formats/hdf5-object.ts'
import {
  hdf5MetadataChecksum,
  openHdf5FileLayer,
  type Hdf5FileLayer,
} from '../src/scientific/formats/hdf5.ts'
import { HostileSource } from './hostile-source.ts'

const basicLinks: readonly GeneratedDenseGroupLink[] = [
  { kind: 'hard', name: 'dataset', objectAddress: 20_000n, creationOrder: 0n },
  { kind: 'soft', name: 'alias', target: '/dataset', creationOrder: 1n },
  {
    kind: 'hard',
    name: 'μ-map',
    objectAddress: 20_001n,
    characterSet: 'utf-8',
    creationOrder: 2n,
  },
]

const writeDenseLinkInfo = (
  fractalHeapAddress: bigint,
  nameIndexAddress: bigint,
): Uint8Array<ArrayBuffer> => {
  const output = new Uint8Array(18)
  const view = new DataView(output.buffer)
  view.setBigUint64(2, fractalHeapAddress, true)
  view.setBigUint64(10, nameIndexAddress, true)
  return output
}

const createFile = async (
  options: Readonly<GeneratedDenseGroupFixtureOptions>,
  mutate?: (blocks: Map<bigint, Uint8Array<ArrayBuffer>>) => void,
): Promise<{ readonly file: Hdf5FileLayer; readonly storage: Hdf5DenseLinkStorage }> => {
  const group = createGeneratedDenseGroupFixture(options)
  const fixture = createGeneratedHdf5Fixture({ version: 2, fileBytes: 32_768 })
  const rootHeader = createGeneratedVersion2ObjectHeader([
    {
      type: 0x0002,
      data: writeDenseLinkInfo(group.fractalHeapAddress, group.nameIndexAddress),
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
    maxBytes: 1_024,
  })
  const object = await readHdf5ObjectHeader(file, file.superblock.rootObjectAddress)
  if (object.linkStorage?.kind !== 'dense') {
    throw new Error('Generated object did not expose dense link storage')
  }
  return { file, storage: object.linkStorage }
}

describe('HDF5 modern dense groups', () => {
  it('reads managed hard, soft, and UTF-8 links through a fractal heap and B-tree v2 leaf', async () => {
    const { file, storage } = await createFile({ links: basicLinks })
    const group = await readHdf5DenseGroup(file, storage, { objectPath: '/modern' })

    expect(group).toMatchObject({
      heapHeaderBytes: 146,
      btreeNodes: 1,
      directBlocks: 1,
      indirectBlocks: 1,
    })
    expect(group.links).toHaveLength(3)
    expect(group.links.find(({ name }) => name === 'dataset')).toEqual({
      kind: 'hard',
      name: 'dataset',
      characterSet: 'ascii',
      creationOrder: 0n,
      objectAddress: 20_000n,
    })
    expect(group.links.find(({ name }) => name === 'alias')).toEqual({
      kind: 'soft',
      name: 'alias',
      characterSet: 'ascii',
      creationOrder: 1n,
      target: '/dataset',
    })
    expect(group.links.find(({ name }) => name === 'μ-map')).toMatchObject({
      kind: 'hard',
      characterSet: 'utf-8',
      creationOrder: 2n,
    })
  })

  it('reads managed links from a root direct heap block', async () => {
    const { file, storage } = await createFile({ links: basicLinks, rootBlock: 'direct' })
    const group = await readHdf5DenseGroup(file, storage)

    expect(group).toMatchObject({ btreeNodes: 1, directBlocks: 1, indirectBlocks: 0 })
    expect(new Set(group.links.map(({ name }) => name))).toEqual(
      new Set(basicLinks.map(({ name }) => name)),
    )
  })

  it('traverses internal B-tree v2 nodes and multiple managed direct blocks', async () => {
    const links: GeneratedDenseGroupLink[] = Array.from({ length: 60 }, (_, index) => ({
      kind: 'hard',
      name: `item-${index.toString().padStart(2, '0')}`,
      objectAddress: BigInt(20_000 + index),
    }))
    const { file, storage } = await createFile({ links, depth: 1 })
    const group = await readHdf5DenseGroup(file, storage)

    expect(group).toMatchObject({ btreeNodes: 3, indirectBlocks: 1 })
    expect(group.directBlocks).toBeGreaterThan(1)
    expect(new Set(group.links.map(({ name }) => name))).toEqual(
      new Set(links.map(({ name }) => name)),
    )
  })

  it('enforces heap, B-tree, link, table, and aggregate metadata limits', async () => {
    const links: GeneratedDenseGroupLink[] = Array.from({ length: 20 }, (_, index) => ({
      kind: 'hard',
      name: `bounded-${index}`,
      objectAddress: BigInt(20_000 + index),
    }))
    const { file, storage } = await createFile({ links, depth: 1 })
    await expect(
      readHdf5DenseGroup(file, storage, { maxHeapHeaderBytes: 64 }),
    ).rejects.toMatchObject({
      code: 'LIMIT_EXCEEDED',
    })
    await expect(
      readHdf5DenseGroup(file, storage, { maxDirectBlockBytes: 256 }),
    ).rejects.toMatchObject({
      code: 'LIMIT_EXCEEDED',
    })
    await expect(
      readHdf5DenseGroup(file, storage, { maxBtreeNodeBytes: 256 }),
    ).rejects.toMatchObject({
      code: 'LIMIT_EXCEEDED',
    })
    await expect(readHdf5DenseGroup(file, storage, { maxBtreeNodes: 1 })).rejects.toMatchObject({
      code: 'LIMIT_EXCEEDED',
    })
    await expect(readHdf5DenseGroup(file, storage, { maxBtreeDepth: 1 })).rejects.toMatchObject({
      code: 'LIMIT_EXCEEDED',
    })
    await expect(readHdf5DenseGroup(file, storage, { maxLinks: 5 })).rejects.toMatchObject({
      code: 'LIMIT_EXCEEDED',
    })
    await expect(readHdf5DenseGroup(file, storage, { maxTableWidth: 2 })).rejects.toMatchObject({
      code: 'LIMIT_EXCEEDED',
    })
    await expect(readHdf5DenseGroup(file, storage, { maxHeapSizeBits: 16 })).rejects.toMatchObject({
      code: 'LIMIT_EXCEEDED',
    })
    await expect(
      readHdf5DenseGroup(file, storage, { maxMetadataBytes: 700 }),
    ).rejects.toMatchObject({
      code: 'LIMIT_EXCEEDED',
    })
  })

  it('rejects corrupt heap, direct-block, and B-tree metadata checksums', async () => {
    const corruptHeap = await createFile({ links: basicLinks }, (blocks) => {
      const heap = blocks.get(4_096n)
      if (heap === undefined) throw new Error('Generated heap header is unavailable')
      heap[heap.byteLength - 1] = (heap[heap.byteLength - 1] ?? 0) ^ 1
    })
    await expect(readHdf5DenseGroup(corruptHeap.file, corruptHeap.storage)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: expect.stringContaining('checksum'),
    })

    const corruptDirect = await createFile({ links: basicLinks }, (blocks) => {
      const direct = blocks.get(8_192n)
      if (direct === undefined) throw new Error('Generated direct block is unavailable')
      direct[direct.byteLength - 1] = (direct[direct.byteLength - 1] ?? 0) ^ 1
    })
    await expect(
      readHdf5DenseGroup(corruptDirect.file, corruptDirect.storage),
    ).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: expect.stringContaining('checksum'),
    })

    const corruptTree = await createFile({ links: basicLinks }, (blocks) => {
      const leaf = blocks.get(12_288n)
      if (leaf === undefined) throw new Error('Generated B-tree leaf is unavailable')
      leaf[6] = (leaf[6] ?? 0) ^ 1
    })
    await expect(readHdf5DenseGroup(corruptTree.file, corruptTree.storage)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: expect.stringContaining('checksum'),
    })
  })

  it('rejects B-tree cycles, huge heap IDs, invalid hashes, and malformed signatures', async () => {
    const links: GeneratedDenseGroupLink[] = Array.from({ length: 8 }, (_, index) => ({
      kind: 'hard',
      name: `cycle-${index}`,
      objectAddress: BigInt(20_000 + index),
    }))
    const cyclic = await createFile({ links, depth: 1 }, (blocks) => {
      const root = blocks.get(12_288n)
      if (root === undefined) throw new Error('Generated B-tree root is unavailable')
      new DataView(root.buffer, root.byteOffset, root.byteLength).setBigUint64(17, 12_288n, true)
      const checksumOffset = 35
      new DataView(root.buffer, root.byteOffset, root.byteLength).setUint32(
        checksumOffset,
        hdf5MetadataChecksum(root.subarray(0, checksumOffset)),
        true,
      )
    })
    await expect(readHdf5DenseGroup(cyclic.file, cyclic.storage)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: expect.stringContaining('cyclic'),
    })

    const huge = await createFile({ links: basicLinks }, (blocks) => {
      const leaf = blocks.get(12_288n)
      if (leaf === undefined) throw new Error('Generated B-tree leaf is unavailable')
      leaf[10] = 0x10
      const checksumOffset = 6 + basicLinks.length * 11
      new DataView(leaf.buffer, leaf.byteOffset, leaf.byteLength).setUint32(
        checksumOffset,
        hdf5MetadataChecksum(leaf.subarray(0, checksumOffset)),
        true,
      )
    })
    await expect(readHdf5DenseGroup(huge.file, huge.storage)).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
      message: expect.stringContaining('huge'),
    })

    const invalidHash = await createFile({ links: basicLinks }, (blocks) => {
      const leaf = blocks.get(12_288n)
      if (leaf === undefined) throw new Error('Generated B-tree leaf is unavailable')
      leaf[6] = (leaf[6] ?? 0) ^ 1
      const checksumOffset = 6 + basicLinks.length * 11
      new DataView(leaf.buffer, leaf.byteOffset, leaf.byteLength).setUint32(
        checksumOffset,
        hdf5MetadataChecksum(leaf.subarray(0, checksumOffset)),
        true,
      )
    })
    await expect(readHdf5DenseGroup(invalidHash.file, invalidHash.storage)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: expect.stringContaining('name hash'),
    })

    const malformed = await createFile({ links: basicLinks }, (blocks) => {
      const indirect = blocks.get(4_608n)
      if (indirect === undefined) throw new Error('Generated indirect block is unavailable')
      indirect[0] = 0
    })
    await expect(readHdf5DenseGroup(malformed.file, malformed.storage)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: expect.stringContaining('FHIB signature'),
    })

    const outOfOrder = await createFile({ links: basicLinks }, (blocks) => {
      const leaf = blocks.get(12_288n)
      if (leaf === undefined) throw new Error('Generated B-tree leaf is unavailable')
      const first = leaf.slice(6, 17)
      leaf.copyWithin(6, 17, 28)
      leaf.set(first, 17)
      const checksumOffset = 6 + basicLinks.length * 11
      new DataView(leaf.buffer, leaf.byteOffset, leaf.byteLength).setUint32(
        checksumOffset,
        hdf5MetadataChecksum(leaf.subarray(0, checksumOffset)),
        true,
      )
    })
    await expect(readHdf5DenseGroup(outOfOrder.file, outOfOrder.storage)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: expect.stringContaining('out of order'),
    })
  })

  it('honors cancellation while using weakest-lifetime source buffers', async () => {
    const { file, storage } = await createFile({ links: basicLinks })
    const controller = new AbortController()
    controller.abort(new Error('stop dense group'))
    await expect(readHdf5DenseGroup(file, storage, { signal: controller.signal })).rejects.toThrow(
      'stop dense group',
    )
  })
})
