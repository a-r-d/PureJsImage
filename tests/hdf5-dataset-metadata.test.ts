import { describe, expect, it } from 'vitest'
import {
  createGeneratedDataspaceMessage,
  createGeneratedFloatDatatypeMessage,
  createGeneratedIntegerDatatypeMessage,
  createGeneratedStringDatatypeMessage,
} from '../benchmark/hdf5/generated-dataset-fixture.ts'
import { createGeneratedHdf5Fixture } from '../benchmark/hdf5/generated-fixture.ts'
import { createGeneratedVersion2ObjectHeader } from '../benchmark/hdf5/generated-object-fixture.ts'
import {
  parseHdf5DataspaceMessage,
  parseHdf5DatatypeMessage,
  readHdf5DatasetTypeAndSpace,
} from '../src/scientific/formats/hdf5-dataset.ts'
import { readHdf5ObjectHeader } from '../src/scientific/formats/hdf5-object.ts'
import { openHdf5FileLayer } from '../src/scientific/formats/hdf5.ts'
import { MemorySource } from '../src/source.ts'

const openDatasetObject = async (dataspace: Uint8Array, datatype: Uint8Array, flags = 0) => {
  const fixture = createGeneratedHdf5Fixture({ version: 2, fileBytes: 1_024 })
  if (fixture.rootObjectOffset === undefined)
    throw new Error('Generated root offset is unavailable')
  const header = createGeneratedVersion2ObjectHeader([
    { type: 0x0001, flags, data: dataspace },
    { type: 0x0003, flags, data: datatype },
  ])
  fixture.bytes.set(header, fixture.rootObjectOffset)
  const file = await openHdf5FileLayer(new MemorySource(fixture.bytes), {
    pageBytes: 32,
    maxBytes: 256,
  })
  const object = await readHdf5ObjectHeader(file, file.superblock.rootObjectAddress, {
    objectPath: '/entry/data',
  })
  return { file, object }
}

describe('HDF5 D3 dataspaces', () => {
  it('parses version 1 and 2 scalar and simple extents without losing unlimited maxima', () => {
    expect(
      parseHdf5DataspaceMessage(createGeneratedDataspaceMessage({ version: 1, lengthSize: 8 }), 8),
    ).toEqual({
      kind: 'scalar',
      version: 1,
      rank: 0,
      dimensions: [],
      maximumDimensions: [],
      elementCount: 1,
    })

    expect(
      parseHdf5DataspaceMessage(
        createGeneratedDataspaceMessage({
          version: 2,
          lengthSize: 8,
          dimensions: [0n, 4n, 5n],
          maximumDimensions: ['unlimited', 8n, 5n],
        }),
        8,
      ),
    ).toEqual({
      kind: 'simple',
      version: 2,
      rank: 3,
      dimensions: [0, 4, 5],
      maximumDimensions: ['unlimited', 8, 5],
      elementCount: 0,
    })
  })

  it('bounds rank, dimensions, and finite current element counts', () => {
    const message = createGeneratedDataspaceMessage({
      version: 2,
      lengthSize: 4,
      dimensions: [100n, 200n],
    })
    expect(() => parseHdf5DataspaceMessage(message, 4, { maxRank: 1 })).toThrowError(
      expect.objectContaining({ code: 'LIMIT_EXCEEDED' }),
    )
    expect(() => parseHdf5DataspaceMessage(message, 4, { maxDimension: 150 })).toThrowError(
      expect.objectContaining({ code: 'LIMIT_EXCEEDED' }),
    )
    expect(() => parseHdf5DataspaceMessage(message, 4, { maxElements: 19_999 })).toThrowError(
      expect.objectContaining({ code: 'LIMIT_EXCEEDED' }),
    )
  })

  it('rejects null, permutation, inconsistent, and malformed dataspaces explicitly', () => {
    const nullSpace = createGeneratedDataspaceMessage({
      version: 2,
      lengthSize: 8,
      type: 'null',
    })
    expect(() => parseHdf5DataspaceMessage(nullSpace, 8)).toThrowError(
      expect.objectContaining({
        code: 'UNSUPPORTED_OPERATION',
        message: expect.stringContaining('null'),
      }),
    )

    const permutation = createGeneratedDataspaceMessage({
      version: 1,
      lengthSize: 4,
      dimensions: [2n],
    })
    permutation[2] = 2
    const withPermutation = new Uint8Array(permutation.byteLength + 4)
    withPermutation.set(permutation)
    expect(() => parseHdf5DataspaceMessage(withPermutation, 4)).toThrowError(
      expect.objectContaining({
        code: 'UNSUPPORTED_OPERATION',
        message: expect.stringContaining('permutation'),
      }),
    )

    const maximumTooSmall = createGeneratedDataspaceMessage({
      version: 2,
      lengthSize: 4,
      dimensions: [4n],
      maximumDimensions: [3n],
    })
    expect(() => parseHdf5DataspaceMessage(maximumTooSmall, 4)).toThrowError(
      expect.objectContaining({ code: 'INVALID_INPUT' }),
    )

    const trailing = createGeneratedDataspaceMessage({ version: 2, lengthSize: 4 })
    const malformed = new Uint8Array(trailing.byteLength + 1)
    malformed.set(trailing)
    malformed[malformed.byteLength - 1] = 1
    expect(() => parseHdf5DataspaceMessage(malformed, 4)).toThrowError(
      expect.objectContaining({
        code: 'INVALID_INPUT',
        message: expect.stringContaining('trailing'),
      }),
    )
  })
})

describe('HDF5 D3 primitive datatypes', () => {
  it('parses fixed signed and unsigned integers with byte order, precision, offset, and padding', () => {
    expect(
      parseHdf5DatatypeMessage(
        createGeneratedIntegerDatatypeMessage({ byteLength: 2, bitPrecision: 16 }),
      ),
    ).toMatchObject({
      kind: 'integer',
      version: 1,
      byteLength: 2,
      signed: false,
      byteOrder: 'little-endian',
      bitOffset: 0,
      bitPrecision: 16,
      lowPadding: 0,
      highPadding: 0,
    })
    expect(
      parseHdf5DatatypeMessage(
        createGeneratedIntegerDatatypeMessage({
          version: 3,
          byteLength: 4,
          signed: true,
          byteOrder: 'big-endian',
          bitOffset: 3,
          bitPrecision: 24,
          lowPadding: 1,
        }),
      ),
    ).toMatchObject({
      kind: 'integer',
      version: 3,
      signed: true,
      byteOrder: 'big-endian',
      bitOffset: 3,
      bitPrecision: 24,
      lowPadding: 1,
    })
  })

  it('accepts exact IEEE binary16/32/64 layouts and fixed ASCII/UTF-8 strings', () => {
    const formats = [
      ['binary16', 1],
      ['binary32', 2],
      ['binary64', 3],
    ] as const
    for (const [format, version] of formats) {
      for (const byteOrder of ['little-endian', 'big-endian'] as const) {
        expect(
          parseHdf5DatatypeMessage(
            createGeneratedFloatDatatypeMessage({ version, format, byteOrder }),
          ),
        ).toMatchObject({ kind: 'float', version, format, byteOrder })
      }
    }
    expect(
      parseHdf5DatatypeMessage(
        createGeneratedStringDatatypeMessage({ byteLength: 12, padding: 'space-padded' }),
      ),
    ).toEqual({
      kind: 'fixed-string',
      version: 1,
      byteLength: 12,
      padding: 'space-padded',
      characterSet: 'ascii',
    })
    expect(
      parseHdf5DatatypeMessage(
        createGeneratedStringDatatypeMessage({
          version: 3,
          byteLength: 64,
          padding: 'null-padded',
          characterSet: 'utf-8',
        }),
      ),
    ).toMatchObject({
      kind: 'fixed-string',
      version: 3,
      padding: 'null-padded',
      characterSet: 'utf-8',
    })
  })

  it('separates malformed primitive layouts from valid but unsupported datatype classes', () => {
    const badPrecision = createGeneratedIntegerDatatypeMessage({
      byteLength: 2,
      bitOffset: 1,
      bitPrecision: 16,
    })
    expect(() => parseHdf5DatatypeMessage(badPrecision)).toThrowError(
      expect.objectContaining({
        code: 'INVALID_INPUT',
        message: expect.stringContaining('precision'),
      }),
    )

    const nonIeee = createGeneratedFloatDatatypeMessage({ format: 'binary32' })
    nonIeee[16] = 126
    expect(() => parseHdf5DatatypeMessage(nonIeee)).toThrowError(
      expect.objectContaining({
        code: 'UNSUPPORTED_OPERATION',
        message: expect.stringContaining('IEEE'),
      }),
    )

    const compound = createGeneratedIntegerDatatypeMessage({ byteLength: 4 })
    compound[0] = ((compound[0] ?? 0) & 0xf0) | 6
    expect(() => parseHdf5DatatypeMessage(compound)).toThrowError(
      expect.objectContaining({
        code: 'UNSUPPORTED_OPERATION',
        message: expect.stringContaining('class 6'),
      }),
    )

    const oversized = createGeneratedStringDatatypeMessage({ byteLength: 1_024 })
    expect(() => parseHdf5DatatypeMessage(oversized, { maxElementBytes: 32 })).toThrowError(
      expect.objectContaining({ code: 'LIMIT_EXCEEDED' }),
    )
  })
})

describe('HDF5 D3 dataset object integration', () => {
  it('reads one bounded dataspace and datatype message from an object header', async () => {
    const dataspace = createGeneratedDataspaceMessage({
      version: 2,
      lengthSize: 8,
      dimensions: [3n, 5n],
    })
    const datatype = createGeneratedFloatDatatypeMessage({ format: 'binary32' })
    const { file, object } = await openDatasetObject(dataspace, datatype)

    await expect(
      readHdf5DatasetTypeAndSpace(file, object, { objectPath: '/entry/data' }),
    ).resolves.toMatchObject({
      dataspace: { kind: 'simple', dimensions: [3, 5], elementCount: 15 },
      datatype: { kind: 'float', format: 'binary32', byteOrder: 'little-endian' },
      metadataBytes: dataspace.byteLength + datatype.byteLength,
    })
  })

  it('rejects shared messages, duplicates, metadata limits, and cancellation before metadata I/O', async () => {
    const dataspace = createGeneratedDataspaceMessage({ version: 2, lengthSize: 8 })
    const datatype = createGeneratedIntegerDatatypeMessage({ byteLength: 1 })
    const shared = await openDatasetObject(dataspace, datatype, 2)
    await expect(readHdf5DatasetTypeAndSpace(shared.file, shared.object)).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
      message: expect.stringContaining('shared'),
    })

    const normal = await openDatasetObject(dataspace, datatype)
    await expect(
      readHdf5DatasetTypeAndSpace(normal.file, normal.object, { maxMessageBytes: 4 }),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })

    const controller = new AbortController()
    controller.abort(new Error('stop HDF5 dataset metadata'))
    await expect(
      readHdf5DatasetTypeAndSpace(normal.file, normal.object, { signal: controller.signal }),
    ).rejects.toThrow('stop HDF5 dataset metadata')

    const duplicateHeader = createGeneratedVersion2ObjectHeader([
      { type: 0x0001, data: dataspace },
      { type: 0x0001, data: dataspace },
      { type: 0x0003, data: datatype },
    ])
    const fixture = createGeneratedHdf5Fixture({ version: 2, fileBytes: 1_024 })
    if (fixture.rootObjectOffset === undefined)
      throw new Error('Generated root offset is unavailable')
    fixture.bytes.set(duplicateHeader, fixture.rootObjectOffset)
    const file = await openHdf5FileLayer(new MemorySource(fixture.bytes))
    const object = await readHdf5ObjectHeader(file, file.superblock.rootObjectAddress)
    await expect(readHdf5DatasetTypeAndSpace(file, object)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: expect.stringContaining('exactly one dataspace'),
    })
  })
})
