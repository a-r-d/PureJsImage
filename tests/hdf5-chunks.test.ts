import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { independentHdf5ChunkIndexFixture } from '../benchmark/hdf5/independent-chunk-fixture.ts'
import { createGeneratedHdf5Fixture } from '../benchmark/hdf5/generated-fixture.ts'
import type { Hdf5DatasetMetadata } from '../src/scientific/formats/hdf5-dataset.ts'
import { readHdf5DatasetMetadata } from '../src/scientific/formats/hdf5-dataset.ts'
import type { Hdf5ChunkIndex } from '../src/scientific/formats/hdf5-layout.ts'
import {
  locateHdf5Chunk,
  planHdf5ChunkHyperslab,
  readHdf5EncodedChunkBlocks,
} from '../src/scientific/formats/hdf5-chunks.ts'
import { hdf5MetadataChecksum, openHdf5FileLayer } from '../src/scientific/formats/hdf5.ts'
import { openHdf5ObjectGraph } from '../src/scientific/formats/hdf5-graph.ts'
import { MemorySource } from '../src/source.ts'

const writeUnsigned = (bytes: Uint8Array, offset: number, width: number, value: bigint): void => {
  let remaining = value
  for (let index = 0; index < width; index += 1) {
    bytes[offset + index] = Number(remaining & 0xffn)
    remaining >>= 8n
  }
}

const writeUint16 = (bytes: Uint8Array, offset: number, value: number): void =>
  new DataView(bytes.buffer).setUint16(offset, value, true)

const writeUint32 = (bytes: Uint8Array, offset: number, value: number): void =>
  new DataView(bytes.buffer).setUint32(offset, value, true)

const writeSignature = (bytes: Uint8Array, offset: number, value: string): void => {
  for (let index = 0; index < value.length; index += 1) {
    bytes[offset + index] = value.charCodeAt(index)
  }
}

const writeChecksum = (bytes: Uint8Array, start: number, checksumOffset: number): void =>
  writeUint32(bytes, checksumOffset, hdf5MetadataChecksum(bytes.subarray(start, checksumOffset)))

const metadata = (
  index: Hdf5ChunkIndex,
  dimensions: readonly number[] = Object.freeze([8, 8]),
  maximumDimensions: readonly (number | 'unlimited')[] = dimensions,
): Hdf5DatasetMetadata =>
  Object.freeze({
    dataspace: Object.freeze({
      kind: 'simple',
      version: 2,
      rank: 2,
      dimensions,
      maximumDimensions,
      elementCount: (dimensions[0] ?? 0) * (dimensions[1] ?? 0),
    }),
    datatype: Object.freeze({
      kind: 'integer',
      version: 1,
      byteLength: 4,
      signed: true,
      byteOrder: 'little-endian',
      bitOffset: 0,
      bitPrecision: 32,
      lowPadding: 0,
      highPadding: 0,
    }),
    metadataBytes: 0,
    layout: Object.freeze({
      kind: 'chunked',
      version: 4,
      chunkDimensions: Object.freeze([4, 4]),
      elementBytes: 4,
      chunkBytes: 64,
      partialEdgeChunksFiltered: true,
      index,
    }),
    fillValue: Object.freeze({
      version: 3,
      status: 'default-zero',
      allocation: 'incremental',
      writeTime: 'if-set',
      value: undefined,
    }),
    filterPipeline: undefined,
  })

const generatedFile = async () => {
  const fixture = createGeneratedHdf5Fixture({ version: 3, fileBytes: 8_192 })
  return { bytes: fixture.bytes, file: await openHdf5FileLayer(new MemorySource(fixture.bytes)) }
}

describe('HDF5 D4 hyperslab planning', () => {
  it('enumerates only intersecting chunks and preserves partial edges and output order', () => {
    const value = metadata(
      Object.freeze({ kind: 'implicit', address: 2_000n }),
      Object.freeze([7, 9]),
    )
    const plans = planHdf5ChunkHyperslab(value, { start: [2, 3], shape: [5, 5] })
    expect(plans.map(({ scaledCoordinates }) => scaledCoordinates)).toEqual([
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ])
    expect(plans[3]).toMatchObject({
      chunkStart: [4, 4],
      chunkShape: [3, 4],
      selectionStart: [0, 0],
      selectionShape: [3, 4],
      outputStart: [2, 1],
      outputBytes: 48,
    })
    expect(() =>
      planHdf5ChunkHyperslab(value, { start: [0, 0], shape: [7, 9] }, { maxSelectedChunks: 3 }),
    ).toThrowError(expect.objectContaining({ code: 'LIMIT_EXCEEDED' }))
  })

  it('streams one bounded encoded chunk at a time and observes cancellation', async () => {
    const { bytes, file } = await generatedFile()
    for (let index = 0; index < 4; index += 1)
      bytes.fill(index + 1, 2_000 + index * 64, 2_064 + index * 64)
    const value = metadata(Object.freeze({ kind: 'implicit', address: 2_000n }))
    const blocks = []
    for await (const block of readHdf5EncodedChunkBlocks(
      file,
      value,
      { start: [3, 3], shape: [2, 2] },
      { maxLiveEncodedBytes: 64, maxDecodedChunkBytes: 64, maxFilterScratchBytes: 64 },
    )) {
      blocks.push(block)
    }
    expect(blocks.map(({ encoded }) => encoded?.[0])).toEqual([1, 2, 3, 4])

    const controller = new AbortController()
    controller.abort(new Error('stop chunk reads'))
    const iterator = readHdf5EncodedChunkBlocks(
      file,
      value,
      { start: [0, 0], shape: [1, 1] },
      { signal: controller.signal },
    )[Symbol.asyncIterator]()
    await expect(iterator.next()).rejects.toThrow('stop chunk reads')
  })
})

describe('HDF5 D4 modern chunk indexes', () => {
  it('locates every modern index in an independent h5py/HDF5 fixture', async () => {
    const bytes = independentHdf5ChunkIndexFixture.bytes()
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      independentHdf5ChunkIndexFixture.sha256,
    )
    const file = await openHdf5FileLayer(new MemorySource(bytes))
    const graph = await openHdf5ObjectGraph(file)
    const expectations = Object.freeze([
      Object.freeze({
        path: '/single',
        kind: 'single',
        coordinates: Object.freeze([0, 0]),
        first: 0,
      }),
      Object.freeze({
        path: '/implicit',
        kind: 'implicit',
        coordinates: Object.freeze([1, 1]),
        first: 36,
      }),
      Object.freeze({
        path: '/fixed',
        kind: 'fixed-array',
        coordinates: Object.freeze([1, 1]),
        first: 36,
      }),
      Object.freeze({
        path: '/extensible',
        kind: 'extensible-array',
        coordinates: Object.freeze([1, 1]),
        first: 36,
      }),
      Object.freeze({
        path: '/btree-v2',
        kind: 'btree-v2',
        coordinates: Object.freeze([1, 1]),
        first: 36,
      }),
    ])
    for (const expected of expectations) {
      const object = await graph.get(expected.path)
      if (object === undefined) throw new Error(`Independent HDF5 fixture lacks ${expected.path}`)
      const dataset = await readHdf5DatasetMetadata(file, object.header, {
        objectPath: expected.path,
      })
      expect(dataset.layout).toMatchObject({ kind: 'chunked', index: { kind: expected.kind } })
      const chunk = await locateHdf5Chunk(file, dataset, expected.coordinates, {
        objectPath: expected.path,
      })
      if (chunk.address === undefined) throw new Error(`${expected.path} chunk is unallocated`)
      const raw = await file.readRaw(chunk.address, chunk.encodedBytes)
      expect(new DataView(raw.buffer, raw.byteOffset, raw.byteLength).getInt32(0, true)).toBe(
        expected.first,
      )
    }

    const filteredObject = await graph.get('/filtered-fixed')
    if (filteredObject === undefined)
      throw new Error('Independent HDF5 fixture lacks filtered data')
    const filtered = await readHdf5DatasetMetadata(file, filteredObject.header)
    await expect(locateHdf5Chunk(file, filtered, [1, 1])).resolves.toMatchObject({
      address: 3_328n,
      encodedBytes: 64,
      filterMask: 0,
    })
  })

  it('locates single and implicit chunks without index metadata reads', async () => {
    const { file } = await generatedFile()
    await expect(
      locateHdf5Chunk(
        file,
        metadata(
          Object.freeze({ kind: 'single', address: 2_000n, filteredChunkBytes: 31, filterMask: 5 }),
          [4, 4],
          [4, 4],
        ),
        [0, 0],
      ),
    ).resolves.toMatchObject({ address: 2_000n, encodedBytes: 31, filterMask: 5, indexNodes: 0 })
    await expect(
      locateHdf5Chunk(file, metadata(Object.freeze({ kind: 'implicit', address: 2_000n })), [1, 1]),
    ).resolves.toMatchObject({ address: 2_192n, encodedBytes: 64, indexNodes: 0 })
    await expect(
      locateHdf5Chunk(
        file,
        metadata(Object.freeze({ kind: 'implicit', address: undefined })),
        [0, 0],
        { maxLiveEncodedBytes: 1 },
      ),
    ).resolves.toMatchObject({ address: undefined })
    await expect(
      locateHdf5Chunk(
        file,
        metadata(Object.freeze({ kind: 'implicit', address: 2_000n })),
        [0.5, 0],
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('validates and locates fixed-array and extensible-array entries', async () => {
    const fixed = await generatedFile()
    writeSignature(fixed.bytes, 600, 'FAHD')
    fixed.bytes.set([0, 0, 8, 10], 604)
    writeUnsigned(fixed.bytes, 608, 8, 4n)
    writeUnsigned(fixed.bytes, 616, 8, 700n)
    writeChecksum(fixed.bytes, 600, 624)
    writeSignature(fixed.bytes, 700, 'FADB')
    fixed.bytes.set([0, 0], 704)
    writeUnsigned(fixed.bytes, 706, 8, 600n)
    for (let index = 0; index < 4; index += 1)
      writeUnsigned(fixed.bytes, 714 + index * 8, 8, BigInt(2_000 + index * 64))
    writeChecksum(fixed.bytes, 700, 746)
    fixed.file.metadataCache.clear()
    await expect(
      locateHdf5Chunk(
        fixed.file,
        metadata(Object.freeze({ kind: 'fixed-array', address: 600n, pageBits: 10 })),
        [1, 1],
      ),
    ).resolves.toMatchObject({ address: 2_192n, indexNodes: 2 })

    const extensible = await generatedFile()
    writeSignature(extensible.bytes, 600, 'EAHD')
    extensible.bytes.set([0, 0, 8, 32, 4, 16, 4, 10], 604)
    writeUnsigned(extensible.bytes, 660, 8, 1_000n)
    writeChecksum(extensible.bytes, 600, 668)
    writeSignature(extensible.bytes, 1_000, 'EAIB')
    extensible.bytes.set([0, 0], 1_004)
    writeUnsigned(extensible.bytes, 1_006, 8, 600n)
    for (let index = 0; index < 4; index += 1)
      writeUnsigned(extensible.bytes, 1_014 + index * 8, 8, BigInt(2_000 + index * 64))
    extensible.bytes.fill(0xff, 1_046, 1_294)
    writeChecksum(extensible.bytes, 1_000, 1_294)
    extensible.file.metadataCache.clear()
    await expect(
      locateHdf5Chunk(
        extensible.file,
        metadata(
          Object.freeze({
            kind: 'extensible-array',
            address: 600n,
            maxBits: 32,
            indexElements: 4,
            minPointers: 4,
            minElements: 16,
            pageBits: 10,
          }),
          [8, 8],
          ['unlimited', 8],
        ),
        [1, 1],
      ),
    ).resolves.toMatchObject({ address: 2_192n, indexNodes: 2 })

    fixed.bytes[624] = (fixed.bytes[624] ?? 0) ^ 1
    fixed.file.metadataCache.clear()
    await expect(
      locateHdf5Chunk(
        fixed.file,
        metadata(Object.freeze({ kind: 'fixed-array', address: 600n, pageBits: 10 })),
        [0, 0],
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT', message: expect.stringContaining('checksum') })
  })

  it('reads initialized fixed-array and extensible-array pages by exact page address', async () => {
    const fixed = await generatedFile()
    writeSignature(fixed.bytes, 600, 'FAHD')
    fixed.bytes.set([0, 0, 8, 1], 604)
    writeUnsigned(fixed.bytes, 608, 8, 4n)
    writeUnsigned(fixed.bytes, 616, 8, 700n)
    writeChecksum(fixed.bytes, 600, 624)
    writeSignature(fixed.bytes, 700, 'FADB')
    fixed.bytes.set([0, 0], 704)
    writeUnsigned(fixed.bytes, 706, 8, 600n)
    fixed.bytes[714] = 3
    writeChecksum(fixed.bytes, 700, 715)
    for (let index = 0; index < 2; index += 1) {
      writeUnsigned(fixed.bytes, 719 + index * 8, 8, BigInt(2_000 + index * 64))
      writeUnsigned(fixed.bytes, 739 + index * 8, 8, BigInt(2_128 + index * 64))
    }
    writeChecksum(fixed.bytes, 719, 735)
    writeChecksum(fixed.bytes, 739, 755)
    fixed.file.metadataCache.clear()
    await expect(
      locateHdf5Chunk(
        fixed.file,
        metadata(Object.freeze({ kind: 'fixed-array', address: 600n, pageBits: 1 })),
        [1, 1],
      ),
    ).resolves.toMatchObject({ address: 2_192n, indexNodes: 3 })

    const extensible = await generatedFile()
    writeSignature(extensible.bytes, 600, 'EAHD')
    extensible.bytes.set([0, 0, 8, 32, 4, 16, 4, 6], 604)
    writeUnsigned(extensible.bytes, 660, 8, 1_000n)
    writeChecksum(extensible.bytes, 600, 668)
    writeSignature(extensible.bytes, 1_000, 'EAIB')
    extensible.bytes.set([0, 0], 1_004)
    writeUnsigned(extensible.bytes, 1_006, 8, 600n)
    extensible.bytes.fill(0xff, 1_014, 1_294)
    writeUnsigned(extensible.bytes, 1_110, 8, 1_400n)
    writeChecksum(extensible.bytes, 1_000, 1_294)

    writeSignature(extensible.bytes, 1_400, 'EASB')
    extensible.bytes.set([0, 0], 1_404)
    writeUnsigned(extensible.bytes, 1_406, 8, 600n)
    writeUnsigned(extensible.bytes, 1_414, 4, 1_008n)
    extensible.bytes.fill(0, 1_418, 1_426)
    extensible.bytes[1_418] = 1
    extensible.bytes.fill(0xff, 1_426, 1_490)
    writeUnsigned(extensible.bytes, 1_426, 8, 1_600n)
    writeChecksum(extensible.bytes, 1_400, 1_490)

    writeSignature(extensible.bytes, 1_600, 'EADB')
    extensible.bytes.set([0, 0], 1_604)
    writeUnsigned(extensible.bytes, 1_606, 8, 600n)
    writeUnsigned(extensible.bytes, 1_614, 4, 1_008n)
    extensible.bytes.fill(0xff, 1_618, 2_130)
    writeUnsigned(extensible.bytes, 1_618 + 11 * 8, 8, 4_000n)
    writeChecksum(extensible.bytes, 1_618, 2_130)
    extensible.file.metadataCache.clear()
    await expect(
      locateHdf5Chunk(
        extensible.file,
        metadata(
          Object.freeze({
            kind: 'extensible-array',
            address: 600n,
            maxBits: 32,
            indexElements: 4,
            minPointers: 4,
            minElements: 16,
            pageBits: 6,
          }),
          [128, 128],
          ['unlimited', 128],
        ),
        [31, 31],
      ),
    ).resolves.toMatchObject({ address: 4_000n, indexNodes: 4 })
  })

  it('traverses a checksummed chunk B-tree v2 leaf and rejects tight metadata limits', async () => {
    const { bytes, file } = await generatedFile()
    writeSignature(bytes, 600, 'BTHD')
    bytes.set([0, 10], 604)
    writeUint32(bytes, 606, 256)
    writeUint16(bytes, 610, 24)
    writeUint16(bytes, 612, 0)
    bytes.set([100, 40], 614)
    writeUnsigned(bytes, 616, 8, 1_000n)
    writeUint16(bytes, 624, 1)
    writeUnsigned(bytes, 626, 8, 1n)
    writeChecksum(bytes, 600, 634)
    writeSignature(bytes, 1_000, 'BTLF')
    bytes.set([0, 10], 1_004)
    writeUnsigned(bytes, 1_006, 8, 2_000n)
    writeUnsigned(bytes, 1_014, 8, 1n)
    writeUnsigned(bytes, 1_022, 8, 1n)
    writeChecksum(bytes, 1_000, 1_030)
    file.metadataCache.clear()
    const value = metadata(
      Object.freeze({
        kind: 'btree-v2',
        address: 600n,
        nodeBytes: 256,
        splitPercent: 100,
        mergePercent: 40,
      }),
    )
    await expect(locateHdf5Chunk(file, value, [1, 1])).resolves.toMatchObject({
      address: 2_000n,
      encodedBytes: 64,
      indexNodes: 2,
    })
    await expect(
      locateHdf5Chunk(file, value, [1, 1], { maxIndexMetadataBytes: 200 }),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
  })

  it('selects one branch of an internal B-tree v2 without scanning sibling leaves', async () => {
    const { bytes, file } = await generatedFile()
    writeSignature(bytes, 600, 'BTHD')
    bytes.set([0, 10], 604)
    writeUint32(bytes, 606, 256)
    writeUint16(bytes, 610, 24)
    writeUint16(bytes, 612, 1)
    bytes.set([100, 40], 614)
    writeUnsigned(bytes, 616, 8, 1_000n)
    writeUint16(bytes, 624, 1)
    writeUnsigned(bytes, 626, 8, 3n)
    writeChecksum(bytes, 600, 634)

    writeSignature(bytes, 1_000, 'BTIN')
    bytes.set([0, 10], 1_004)
    writeUnsigned(bytes, 1_006, 8, 3_000n)
    writeUnsigned(bytes, 1_014, 8, 1n)
    writeUnsigned(bytes, 1_022, 8, 0n)
    writeUnsigned(bytes, 1_030, 8, 1_300n)
    bytes[1_038] = 1
    writeUnsigned(bytes, 1_039, 8, 1_600n)
    bytes[1_047] = 1
    writeChecksum(bytes, 1_000, 1_048)

    for (const [address, coordinates, rawAddress] of [
      [1_300, [0, 0], 2_000],
      [1_600, [1, 1], 4_000],
    ] as const) {
      writeSignature(bytes, address, 'BTLF')
      bytes.set([0, 10], address + 4)
      writeUnsigned(bytes, address + 6, 8, BigInt(rawAddress))
      writeUnsigned(bytes, address + 14, 8, BigInt(coordinates[0]))
      writeUnsigned(bytes, address + 22, 8, BigInt(coordinates[1]))
      writeChecksum(bytes, address, address + 30)
    }
    file.metadataCache.clear()
    const value = metadata(
      Object.freeze({
        kind: 'btree-v2',
        address: 600n,
        nodeBytes: 256,
        splitPercent: 100,
        mergePercent: 40,
      }),
    )
    await expect(locateHdf5Chunk(file, value, [0, 0])).resolves.toMatchObject({
      address: 2_000n,
      indexNodes: 3,
    })
    await expect(locateHdf5Chunk(file, value, [1, 0])).resolves.toMatchObject({
      address: 3_000n,
      indexNodes: 2,
    })
    bytes[1_600] = 0
    file.metadataCache.clear()
    await expect(locateHdf5Chunk(file, value, [0, 0])).resolves.toMatchObject({
      address: 2_000n,
    })
  })

  it('follows extensible-array super blocks to one data block', async () => {
    const { bytes, file } = await generatedFile()
    writeSignature(bytes, 600, 'EAHD')
    bytes.set([0, 0, 8, 32, 4, 16, 4, 10], 604)
    writeUnsigned(bytes, 660, 8, 1_000n)
    writeChecksum(bytes, 600, 668)
    writeSignature(bytes, 1_000, 'EAIB')
    bytes.set([0, 0], 1_004)
    writeUnsigned(bytes, 1_006, 8, 600n)
    bytes.fill(0xff, 1_014, 1_294)
    writeUnsigned(bytes, 1_110, 8, 1_400n)
    writeChecksum(bytes, 1_000, 1_294)

    writeSignature(bytes, 1_400, 'EASB')
    bytes.set([0, 0], 1_404)
    writeUnsigned(bytes, 1_406, 8, 600n)
    writeUnsigned(bytes, 1_414, 4, 1_008n)
    bytes.fill(0xff, 1_418, 1_482)
    writeUnsigned(bytes, 1_418, 8, 1_600n)
    writeChecksum(bytes, 1_400, 1_482)

    writeSignature(bytes, 1_600, 'EADB')
    bytes.set([0, 0], 1_604)
    writeUnsigned(bytes, 1_606, 8, 600n)
    writeUnsigned(bytes, 1_614, 4, 1_008n)
    bytes.fill(0xff, 1_618, 2_642)
    writeUnsigned(bytes, 1_618 + 11 * 8, 8, 4_000n)
    writeChecksum(bytes, 1_600, 2_642)
    file.metadataCache.clear()
    const value = metadata(
      Object.freeze({
        kind: 'extensible-array',
        address: 600n,
        maxBits: 32,
        indexElements: 4,
        minPointers: 4,
        minElements: 16,
        pageBits: 10,
      }),
      [128, 128],
      ['unlimited', 128],
    )
    await expect(locateHdf5Chunk(file, value, [31, 31])).resolves.toMatchObject({
      address: 4_000n,
      indexNodes: 4,
    })
  })
})
