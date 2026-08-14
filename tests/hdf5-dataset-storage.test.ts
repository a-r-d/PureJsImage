import { describe, expect, it } from 'vitest'
import {
  createGeneratedChunkedLayoutMessage,
  createGeneratedCompactLayoutMessage,
  createGeneratedContiguousLayoutMessage,
  createGeneratedDataspaceMessage,
  createGeneratedFillValueMessage,
  createGeneratedIntegerDatatypeMessage,
  createGeneratedOldFillValueMessage,
  type GeneratedChunkIndex,
} from '../benchmark/hdf5/generated-dataset-fixture.ts'
import { createGeneratedHdf5Fixture } from '../benchmark/hdf5/generated-fixture.ts'
import {
  createGeneratedVersion2ObjectHeader,
  type GeneratedHdf5ObjectMessage,
} from '../benchmark/hdf5/generated-object-fixture.ts'
import {
  parseHdf5DataspaceMessage,
  parseHdf5DatatypeMessage,
  readHdf5DatasetMetadata,
} from '../src/scientific/formats/hdf5-dataset.ts'
import {
  parseHdf5FillValueMessage,
  parseHdf5LayoutMessage,
  parseHdf5OldFillValueMessage,
} from '../src/scientific/formats/hdf5-layout.ts'
import { readHdf5ObjectHeader } from '../src/scientific/formats/hdf5-object.ts'
import { openHdf5FileLayer } from '../src/scientific/formats/hdf5.ts'
import { MemorySource } from '../src/source.ts'

const simpleSpace = (dimensions: readonly bigint[]) =>
  parseHdf5DataspaceMessage(
    createGeneratedDataspaceMessage({ version: 2, lengthSize: 8, dimensions }),
    8,
  )

const uint16Type = () =>
  parseHdf5DatatypeMessage(
    createGeneratedIntegerDatatypeMessage({ byteLength: 2, bitPrecision: 16 }),
  )

const parseLayout = (bytes: Uint8Array, dimensions: readonly bigint[] = [2n, 3n]) =>
  parseHdf5LayoutMessage(bytes, 8, 8, simpleSpace(dimensions), uint16Type())

const openObject = async (messages: readonly GeneratedHdf5ObjectMessage[]) => {
  const fixture = createGeneratedHdf5Fixture({ version: 2, fileBytes: 1_024 })
  if (fixture.rootObjectOffset === undefined)
    throw new Error('Generated root offset is unavailable')
  fixture.bytes.set(createGeneratedVersion2ObjectHeader(messages), fixture.rootObjectOffset)
  const file = await openHdf5FileLayer(new MemorySource(fixture.bytes), {
    pageBytes: 32,
    maxBytes: 256,
  })
  const object = await readHdf5ObjectHeader(file, file.superblock.rootObjectAddress, {
    objectPath: '/entry/data',
  })
  return { file, object }
}

const datasetMessages = (
  layout: Uint8Array,
  fill?: Uint8Array,
): readonly GeneratedHdf5ObjectMessage[] => {
  const messages: GeneratedHdf5ObjectMessage[] = [
    {
      type: 0x0001,
      data: createGeneratedDataspaceMessage({
        version: 2,
        lengthSize: 8,
        dimensions: [2n, 3n],
      }),
    },
    { type: 0x0003, data: createGeneratedIntegerDatatypeMessage({ byteLength: 2 }) },
    { type: 0x0008, data: layout },
  ]
  if (fill !== undefined) messages.push({ type: 0x0005, data: fill })
  return Object.freeze(messages)
}

describe('HDF5 D3 dataset layouts', () => {
  it('parses legacy and modern compact storage with an owned exact payload', () => {
    const data = Uint8Array.of(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11)
    for (const version of [1, 2, 3, 4] as const) {
      const encoded = createGeneratedCompactLayoutMessage({
        version,
        dimensions: [2, 3],
        data,
      })
      const layout = parseLayout(encoded)
      expect(layout).toMatchObject({ kind: 'compact', version, storageBytes: 12 })
      if (layout.kind !== 'compact') throw new Error('Expected compact HDF5 layout')
      expect(layout.data).toEqual(data)
      encoded.fill(255)
      expect(layout.data).toEqual(Uint8Array.of(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11))
    }
  })

  it('parses allocated and unallocated contiguous storage across layout generations', () => {
    const legacy = parseLayout(
      createGeneratedContiguousLayoutMessage({
        version: 1,
        offsetSize: 8,
        lengthSize: 8,
        dimensions: [2, 3],
        address: 900n,
        storageBytes: 12n,
      }),
    )
    expect(legacy).toEqual({
      kind: 'contiguous',
      version: 1,
      address: 900n,
      storageBytes: 12,
    })

    for (const version of [3, 4] as const) {
      expect(
        parseLayout(
          createGeneratedContiguousLayoutMessage({
            version,
            offsetSize: 8,
            lengthSize: 8,
            dimensions: [],
            storageBytes: 12n,
          }),
        ),
      ).toEqual({
        kind: 'contiguous',
        version,
        address: undefined,
        storageBytes: 12,
      })
    }
  })

  it('parses classic chunk B-trees and every version 4 chunk-index descriptor', () => {
    for (const version of [1, 2, 3] as const) {
      expect(
        parseLayout(
          createGeneratedChunkedLayoutMessage({
            version,
            offsetSize: 8,
            lengthSize: 8,
            chunkDimensions: [1, 3],
            elementBytes: 2,
            address: 700n,
          }),
        ),
      ).toMatchObject({
        kind: 'chunked',
        version,
        chunkDimensions: [1, 3],
        elementBytes: 2,
        chunkBytes: 6,
        index: { kind: 'btree-v1', address: 700n },
      })
    }

    const indexes: readonly GeneratedChunkIndex[] = [
      { kind: 'single' },
      { kind: 'single', filteredBytes: 5n, filterMask: 3 },
      { kind: 'implicit' },
      { kind: 'fixed-array', pageBits: 10 },
      {
        kind: 'extensible-array',
        maxBits: 32,
        indexElements: 4,
        minPointers: 2,
        minElements: 8,
        pageBits: 10,
      },
      { kind: 'btree-v2', nodeBytes: 4_096, splitPercent: 100, mergePercent: 40 },
    ]
    for (const index of indexes) {
      const layout = parseLayout(
        createGeneratedChunkedLayoutMessage({
          version: 4,
          offsetSize: 8,
          lengthSize: 8,
          chunkDimensions: [2, 2],
          elementBytes: 2,
          address: 800n,
          partialEdgeChunksFiltered: false,
          index,
        }),
      )
      expect(layout).toMatchObject({
        kind: 'chunked',
        version: 4,
        chunkDimensions: [2, 2],
        chunkBytes: 8,
        partialEdgeChunksFiltered: false,
        index: { kind: index.kind, address: 800n },
      })
      if (index.kind === 'single' && index.filteredBytes !== undefined) {
        expect(layout).toMatchObject({ index: { filteredChunkBytes: 5, filterMask: 3 } })
      }
    }
  })

  it('rejects inconsistent geometry, hostile chunk sizes, virtual storage, and bad indexes', () => {
    const wrongDimensions = createGeneratedCompactLayoutMessage({
      version: 1,
      dimensions: [3, 2],
      data: new Uint8Array(12),
    })
    expect(() => parseLayout(wrongDimensions)).toThrowError(
      expect.objectContaining({
        code: 'INVALID_INPUT',
        message: expect.stringContaining('dimensions'),
      }),
    )

    const largeChunk = createGeneratedChunkedLayoutMessage({
      version: 3,
      offsetSize: 8,
      lengthSize: 8,
      chunkDimensions: [1_024, 1_024],
      elementBytes: 2,
    })
    expect(() =>
      parseHdf5LayoutMessage(largeChunk, 8, 8, simpleSpace([2n, 3n]), uint16Type(), {
        maxChunkBytes: 1_000,
      }),
    ).toThrowError(expect.objectContaining({ code: 'LIMIT_EXCEEDED' }))

    const virtual = Uint8Array.of(4, 3)
    expect(() => parseLayout(virtual)).toThrowError(
      expect.objectContaining({
        code: 'UNSUPPORTED_OPERATION',
        message: expect.stringContaining('virtual'),
      }),
    )

    const badIndex = createGeneratedChunkedLayoutMessage({
      version: 4,
      offsetSize: 8,
      lengthSize: 8,
      chunkDimensions: [1, 3],
      elementBytes: 2,
      index: { kind: 'btree-v2', nodeBytes: 0, splitPercent: 50, mergePercent: 40 },
    })
    expect(() => parseLayout(badIndex)).toThrowError(
      expect.objectContaining({
        code: 'INVALID_INPUT',
        message: expect.stringContaining('parameters'),
      }),
    )
  })
})

describe('HDF5 D3 fill values', () => {
  it('parses old and version 1-3 defined fill values without aliasing input bytes', () => {
    const value = Uint8Array.of(0x34, 0x12)
    const oldBytes = createGeneratedOldFillValueMessage(value)
    const old = parseHdf5OldFillValueMessage(oldBytes)
    expect(old).toMatchObject({ version: 'old', status: 'defined', value })
    oldBytes.fill(255)
    expect(old.value).toEqual(value)

    for (const version of [1, 2, 3] as const) {
      expect(
        parseHdf5FillValueMessage(
          createGeneratedFillValueMessage({
            version,
            allocation: 'incremental',
            writeTime: 'if-set',
            status: 'defined',
            value,
          }),
        ),
      ).toMatchObject({
        version,
        status: 'defined',
        allocation: 'incremental',
        writeTime: 'if-set',
        value,
      })
    }
  })

  it('distinguishes absent/default, undefined, and malformed fill metadata', () => {
    expect(
      parseHdf5FillValueMessage(
        createGeneratedFillValueMessage({ version: 2, status: 'undefined' }),
      ),
    ).toMatchObject({
      version: 2,
      status: 'undefined',
      allocation: 'unused',
      value: undefined,
    })
    expect(
      parseHdf5FillValueMessage(
        createGeneratedFillValueMessage({ version: 3, status: 'default-zero' }),
      ),
    ).toMatchObject({
      version: 3,
      status: 'default-zero',
      allocation: 'unused',
      value: undefined,
    })

    const invalidFlags = createGeneratedFillValueMessage({
      version: 3,
      status: 'defined',
      value: Uint8Array.of(0),
    })
    invalidFlags[1] = 0x30
    expect(() => parseHdf5FillValueMessage(invalidFlags)).toThrowError(
      expect.objectContaining({ code: 'INVALID_INPUT', message: expect.stringContaining('flags') }),
    )

    const oversized = createGeneratedOldFillValueMessage(new Uint8Array(8))
    expect(() => parseHdf5OldFillValueMessage(oversized, { maxFillValueBytes: 4 })).toThrowError(
      expect.objectContaining({ code: 'LIMIT_EXCEEDED' }),
    )
  })
})

describe('HDF5 D3 complete dataset metadata', () => {
  it('combines type, space, compact layout, and defined fill semantics from one object', async () => {
    const layout = createGeneratedCompactLayoutMessage({
      version: 4,
      dimensions: [],
      data: Uint8Array.of(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11),
    })
    const fill = createGeneratedFillValueMessage({
      version: 3,
      status: 'defined',
      allocation: 'early',
      writeTime: 'on-allocation',
      value: Uint8Array.of(0xff, 0xff),
    })
    const { file, object } = await openObject(datasetMessages(layout, fill))
    const metadata = await readHdf5DatasetMetadata(file, object, { objectPath: '/entry/data' })
    expect(metadata).toMatchObject({
      dataspace: { kind: 'simple', dimensions: [2, 3] },
      datatype: { kind: 'integer', byteLength: 2 },
      layout: { kind: 'compact', version: 4, storageBytes: 12 },
      fillValue: {
        version: 3,
        status: 'defined',
        allocation: 'early',
        value: Uint8Array.of(0xff, 0xff),
      },
    })
  })

  it('rejects external storage, contradictory fill messages, bad fill sizes, and aborts', async () => {
    const layout = createGeneratedCompactLayoutMessage({
      version: 3,
      dimensions: [],
      data: new Uint8Array(12),
    })
    const external = await openObject([
      ...datasetMessages(layout),
      { type: 0x0007, data: new Uint8Array(8) },
    ])
    await expect(readHdf5DatasetMetadata(external.file, external.object)).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
      message: expect.stringContaining('external raw data'),
    })

    const contradictory = await openObject([
      ...datasetMessages(
        layout,
        createGeneratedFillValueMessage({
          version: 3,
          status: 'defined',
          value: Uint8Array.of(1, 0),
        }),
      ),
      { type: 0x0004, data: createGeneratedOldFillValueMessage(Uint8Array.of(2, 0)) },
    ])
    await expect(
      readHdf5DatasetMetadata(contradictory.file, contradictory.object),
    ).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: expect.stringContaining('contradictory'),
    })

    const badFill = await openObject(
      datasetMessages(
        layout,
        createGeneratedFillValueMessage({
          version: 3,
          status: 'defined',
          value: Uint8Array.of(1),
        }),
      ),
    )
    await expect(readHdf5DatasetMetadata(badFill.file, badFill.object)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: expect.stringContaining('byte length'),
    })

    const normal = await openObject(datasetMessages(layout))
    const controller = new AbortController()
    controller.abort(new Error('stop HDF5 storage metadata'))
    await expect(
      readHdf5DatasetMetadata(normal.file, normal.object, { signal: controller.signal }),
    ).rejects.toThrow('stop HDF5 storage metadata')
  })
})
