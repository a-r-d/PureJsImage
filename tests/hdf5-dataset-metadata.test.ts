import { describe, expect, it } from 'vitest'
import {
  createGeneratedCompoundDatatypeMessage,
  createGeneratedDataspaceMessage,
  createGeneratedEnumDatatypeMessage,
  createGeneratedFloatDatatypeMessage,
  createGeneratedIntegerDatatypeMessage,
  createGeneratedStringDatatypeMessage,
  createGeneratedVariableStringDatatypeMessage,
} from '../benchmark/hdf5/generated-dataset-fixture.ts'
import { createGeneratedHdf5Fixture } from '../benchmark/hdf5/generated-fixture.ts'
import {
  createGeneratedSharedMessageLocator,
  createGeneratedVersion2ObjectHeader,
} from '../benchmark/hdf5/generated-object-fixture.ts'
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

const openCommittedDatatype = async (
  dataspace: Uint8Array,
  datatype: Uint8Array,
  locator: Uint8Array,
  committedAddress = 700,
) => {
  const fixture = createGeneratedHdf5Fixture({ version: 2, fileBytes: 2_048 })
  if (fixture.rootObjectOffset === undefined) {
    throw new Error('Generated root offset is unavailable')
  }
  fixture.bytes.set(
    createGeneratedVersion2ObjectHeader([
      { type: 0x0001, data: dataspace },
      { type: 0x0003, flags: 2, data: locator },
    ]),
    fixture.rootObjectOffset,
  )
  fixture.bytes.set(
    createGeneratedVersion2ObjectHeader([{ type: 0x0003, data: datatype }]),
    committedAddress,
  )
  const file = await openHdf5FileLayer(new MemorySource(fixture.bytes), {
    pageBytes: 32,
    maxBytes: 256,
  })
  const object = await readHdf5ObjectHeader(file, file.superblock.rootObjectAddress, {
    objectPath: '/entry/data',
  })
  return { file, object, sourceBytes: fixture.bytes }
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

    const array = createGeneratedIntegerDatatypeMessage({ byteLength: 4 })
    array[0] = ((array[0] ?? 0) & 0xf0) | 10
    expect(() => parseHdf5DatatypeMessage(array)).toThrowError(
      expect.objectContaining({
        code: 'UNSUPPORTED_OPERATION',
        message: expect.stringContaining('class 10'),
      }),
    )

    const oversized = createGeneratedStringDatatypeMessage({ byteLength: 1_024 })
    expect(() => parseHdf5DatatypeMessage(oversized, { maxElementBytes: 32 })).toThrowError(
      expect.objectContaining({ code: 'LIMIT_EXCEEDED' }),
    )
  })

  it('parses variable-length string descriptors and rejects unsupported sequences and bases', () => {
    const string = createGeneratedVariableStringDatatypeMessage({
      version: 1,
      descriptorBytes: 16,
      characterSet: 'utf-8',
    })
    expect(parseHdf5DatatypeMessage(string)).toMatchObject({
      kind: 'variable-string',
      version: 1,
      byteLength: 16,
      characterSet: 'utf-8',
      base: { kind: 'integer', byteLength: 1, bitPrecision: 8 },
    })

    const sequence = Uint8Array.from(string)
    sequence[1] = 0
    expect(() => parseHdf5DatatypeMessage(sequence)).toThrowError(
      expect.objectContaining({ code: 'UNSUPPORTED_OPERATION' }),
    )

    const invalidBase = Uint8Array.from(string)
    new DataView(invalidBase.buffer).setUint32(12, 2, true)
    expect(() => parseHdf5DatatypeMessage(invalidBase)).toThrowError(
      expect.objectContaining({ code: 'UNSUPPORTED_OPERATION' }),
    )
  })
})

describe('HDF5 D3 enum and simple compound datatypes', () => {
  it('preserves exact enum values and flat compound member offsets across datatype versions', () => {
    const enumType = createGeneratedEnumDatatypeMessage({
      version: 3,
      base: createGeneratedIntegerDatatypeMessage({
        version: 3,
        byteLength: 2,
        signed: true,
        byteOrder: 'big-endian',
      }),
      members: [
        { name: 'zero', value: Uint8Array.of(0, 0) },
        { name: 'negative', value: Uint8Array.of(0xff, 0xff) },
      ],
    })
    expect(parseHdf5DatatypeMessage(enumType)).toMatchObject({
      kind: 'enum',
      version: 3,
      byteLength: 2,
      base: { kind: 'integer', signed: true, byteOrder: 'big-endian' },
      members: [
        { name: 'zero', value: 0n },
        { name: 'negative', value: -1n },
      ],
    })

    for (const version of [2, 3] as const) {
      const compound = createGeneratedCompoundDatatypeMessage({
        version,
        byteLength: 8,
        members: [
          {
            name: 'count',
            offset: 0,
            datatype: createGeneratedIntegerDatatypeMessage({ byteLength: 2, signed: true }),
          },
          {
            name: 'weight',
            offset: 4,
            datatype: createGeneratedFloatDatatypeMessage({ format: 'binary32' }),
          },
        ],
      })
      expect(parseHdf5DatatypeMessage(compound)).toMatchObject({
        kind: 'compound',
        version,
        byteLength: 8,
        members: [
          { name: 'count', offset: 0, datatype: { kind: 'integer', byteLength: 2 } },
          { name: 'weight', offset: 4, datatype: { kind: 'float', byteLength: 4 } },
        ],
      })
    }
  })

  it('bounds member metadata and rejects duplicate, overlapping, nested, and noncanonical forms', () => {
    const base = createGeneratedIntegerDatatypeMessage({ byteLength: 1 })
    const duplicateNames = createGeneratedEnumDatatypeMessage({
      version: 3,
      base,
      members: [
        { name: 'same', value: Uint8Array.of(0) },
        { name: 'same', value: Uint8Array.of(1) },
      ],
    })
    expect(() => parseHdf5DatatypeMessage(duplicateNames)).toThrowError(
      expect.objectContaining({
        code: 'INVALID_INPUT',
        message: expect.stringContaining('repeats'),
      }),
    )
    expect(() => parseHdf5DatatypeMessage(duplicateNames, { maxDatatypeMembers: 1 })).toThrowError(
      expect.objectContaining({ code: 'LIMIT_EXCEEDED' }),
    )

    const overlapping = createGeneratedCompoundDatatypeMessage({
      version: 3,
      byteLength: 4,
      members: [
        { name: 'left', offset: 0, datatype: base },
        {
          name: 'right',
          offset: 0,
          datatype: createGeneratedIntegerDatatypeMessage({ byteLength: 2 }),
        },
      ],
    })
    expect(() => parseHdf5DatatypeMessage(overlapping)).toThrowError(
      expect.objectContaining({
        code: 'UNSUPPORTED_OPERATION',
        message: expect.stringContaining('Overlapping'),
      }),
    )

    const inner = createGeneratedCompoundDatatypeMessage({
      version: 3,
      byteLength: 1,
      members: [{ name: 'value', offset: 0, datatype: base }],
    })
    const nested = createGeneratedCompoundDatatypeMessage({
      version: 3,
      byteLength: 1,
      members: [{ name: 'inner', offset: 0, datatype: inner }],
    })
    expect(() => parseHdf5DatatypeMessage(nested)).toThrowError(
      expect.objectContaining({
        code: 'UNSUPPORTED_OPERATION',
        message: expect.stringContaining('Nested'),
      }),
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

  it('resolves bounded committed datatype messages and rejects SOHM heap locators and cycles', async () => {
    const dataspace = createGeneratedDataspaceMessage({ version: 2, lengthSize: 8 })
    const datatype = createGeneratedIntegerDatatypeMessage({ byteLength: 1 })
    for (const version of [1, 2, 3] as const) {
      const committed = await openCommittedDatatype(
        dataspace,
        datatype,
        createGeneratedSharedMessageLocator({
          version,
          offsetSize: 8,
          lengthSize: 8,
          address: 700n,
        }),
      )
      await expect(
        readHdf5DatasetTypeAndSpace(committed.file, committed.object),
      ).resolves.toMatchObject({
        datatype: { kind: 'integer', byteLength: 1 },
      })
    }

    const heapShared = await openCommittedDatatype(
      dataspace,
      datatype,
      createGeneratedSharedMessageLocator({
        version: 3,
        type: 1,
        offsetSize: 8,
        lengthSize: 8,
        address: 0n,
      }),
    )
    await expect(
      readHdf5DatasetTypeAndSpace(heapShared.file, heapShared.object),
    ).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
      message: expect.stringContaining('shared-object-header-message heap'),
    })

    const cycleLocator = createGeneratedSharedMessageLocator({
      version: 3,
      offsetSize: 8,
      lengthSize: 8,
      address: 700n,
    })
    const cyclic = await openCommittedDatatype(dataspace, datatype, cycleLocator)
    cyclic.sourceBytes.set(
      createGeneratedVersion2ObjectHeader([{ type: 0x0003, flags: 2, data: cycleLocator }]),
      700,
    )
    await expect(readHdf5DatasetTypeAndSpace(cyclic.file, cyclic.object)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: expect.stringContaining('cyclic shared-message'),
    })
  })

  it('rejects duplicates, metadata limits, and cancellation before metadata I/O', async () => {
    const dataspace = createGeneratedDataspaceMessage({ version: 2, lengthSize: 8 })
    const datatype = createGeneratedIntegerDatatypeMessage({ byteLength: 1 })
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
