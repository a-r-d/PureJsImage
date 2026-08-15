import { describe, expect, it } from 'vitest'
import { createGeneratedHdf5Fixture } from '../benchmark/hdf5/generated-fixture.ts'
import {
  createGeneratedContinuationMessage,
  createGeneratedHardLink,
  createGeneratedSoftLink,
  createGeneratedVersion1ObjectHeader,
  createGeneratedVersion2Continuation,
  createGeneratedVersion2ObjectHeader,
  type GeneratedHdf5ObjectMessage,
} from '../benchmark/hdf5/generated-object-fixture.ts'
import { readHdf5ObjectHeader } from '../src/scientific/formats/hdf5-object.ts'
import { openHdf5FileLayer } from '../src/scientific/formats/hdf5.ts'
import { MemorySource } from '../src/source.ts'
import { HostileSource } from './hostile-source.ts'

const targetAddress = 900n
const continuationAddress = 500n
const nestedContinuationAddress = 700n

const openFixture = async (header: Uint8Array, extras: readonly [bigint, Uint8Array][] = []) => {
  const fixture = createGeneratedHdf5Fixture({ version: 2, fileBytes: 1_024 })
  if (fixture.rootObjectOffset === undefined)
    throw new Error('Generated root offset is unavailable')
  fixture.bytes.set(header, fixture.rootObjectOffset)
  fixture.bytes[Number(targetAddress)] = 1
  for (const [address, bytes] of extras) fixture.bytes.set(bytes, Number(address))
  return openHdf5FileLayer(new HostileSource(fixture.bytes), {
    pageBytes: 32,
    maxBytes: 256,
  })
}

const hardLinkMessage = (name = 'data'): GeneratedHdf5ObjectMessage => ({
  type: 0x0006,
  data: createGeneratedHardLink({ name }, targetAddress, 8),
})

const nestedVersion2Continuation = (): Uint8Array<ArrayBuffer> =>
  createGeneratedVersion2Continuation([
    {
      type: 0x0010,
      data: createGeneratedContinuationMessage(nestedContinuationAddress, 8, 8, 8),
    },
  ])

const version2RootWithNestedContinuation = (): Uint8Array<ArrayBuffer> => {
  const continuation = nestedVersion2Continuation()
  return createGeneratedVersion2ObjectHeader([
    {
      type: 0x0010,
      data: createGeneratedContinuationMessage(continuationAddress, continuation.byteLength, 8, 8),
    },
  ])
}

describe('HDF5 object headers and compact links', () => {
  it('reads a version 1 object header and its aligned compact hard link', async () => {
    const header = createGeneratedVersion1ObjectHeader([hardLinkMessage()], 3)
    const file = await openFixture(header)

    await expect(
      readHdf5ObjectHeader(file, file.superblock.rootObjectAddress, { objectPath: '/' }),
    ).resolves.toMatchObject({
      version: 1,
      referenceCount: 3,
      continuationBlocks: 0,
      links: [{ kind: 'hard', name: 'data', objectAddress: targetAddress }],
      messages: [{ type: 0x0006, chunkIndex: 0 }],
    })
  })

  it('reads packed version 2 links, optional prefix fields, creation order, and reference count', async () => {
    const header = createGeneratedVersion2ObjectHeader(
      [
        {
          type: 0x0006,
          creationOrder: 4,
          data: createGeneratedHardLink(
            { name: 'μ-data', creationOrder: 7n, utf8: true },
            targetAddress,
            8,
          ),
        },
        {
          type: 0x0006,
          creationOrder: 5,
          data: createGeneratedSoftLink({ name: 'alias', utf8: true }, '/μ-data'),
        },
      ],
      {
        trackCreationOrder: true,
        includeTimes: true,
        includeAttributePhaseChange: true,
        referenceCount: 9,
      },
    )
    const file = await openFixture(header)
    const object = await readHdf5ObjectHeader(file, file.superblock.rootObjectAddress)

    expect(object).toMatchObject({ version: 2, flags: 0x35, referenceCount: 9 })
    expect(object.messages.map(({ type, creationOrder }) => ({ type, creationOrder }))).toEqual([
      { type: 0x0006, creationOrder: 4 },
      { type: 0x0006, creationOrder: 5 },
      { type: 0x0016, creationOrder: 0 },
    ])
    expect(object.links).toEqual([
      {
        kind: 'hard',
        name: 'μ-data',
        characterSet: 'utf-8',
        creationOrder: 7n,
        objectAddress: targetAddress,
      },
      {
        kind: 'soft',
        name: 'alias',
        characterSet: 'utf-8',
        creationOrder: undefined,
        target: '/μ-data',
      },
    ])
  })

  it('follows version 1 and checksummed version 2 continuation chunks', async () => {
    const version1Continuation = createGeneratedVersion1ObjectHeader([
      hardLinkMessage('v1'),
    ]).subarray(16)
    const version1Root = createGeneratedVersion1ObjectHeader(
      [
        {
          type: 0x0010,
          data: createGeneratedContinuationMessage(
            continuationAddress,
            version1Continuation.byteLength,
            8,
            8,
          ),
        },
      ],
      1,
      2,
    )
    const version1File = await openFixture(version1Root, [
      [continuationAddress, version1Continuation],
    ])
    const version1 = await readHdf5ObjectHeader(
      version1File,
      version1File.superblock.rootObjectAddress,
    )
    expect(version1.continuationBlocks).toBe(1)
    expect(version1.links[0]).toMatchObject({ name: 'v1', objectAddress: targetAddress })

    const version2Continuation = createGeneratedVersion2Continuation([hardLinkMessage('v2')])
    const version2Root = createGeneratedVersion2ObjectHeader([
      {
        type: 0x0010,
        data: createGeneratedContinuationMessage(
          continuationAddress,
          version2Continuation.byteLength,
          8,
          8,
        ),
      },
    ])
    const version2File = await openFixture(version2Root, [
      [continuationAddress, version2Continuation],
    ])
    const version2 = await readHdf5ObjectHeader(
      version2File,
      version2File.superblock.rootObjectAddress,
    )
    expect(version2.continuationBlocks).toBe(1)
    expect(version2.links[0]).toMatchObject({ name: 'v2', objectAddress: targetAddress })
  })

  it('classifies compact and dense link-info storage without traversing dense indexes yet', async () => {
    const compactInfo = new Uint8Array(18)
    compactInfo.fill(0xff, 2)
    const compactHeader = createGeneratedVersion2ObjectHeader([{ type: 0x0002, data: compactInfo }])
    const compactFile = await openFixture(compactHeader)
    await expect(
      readHdf5ObjectHeader(compactFile, compactFile.superblock.rootObjectAddress),
    ).resolves.toMatchObject({ linkStorage: { kind: 'compact' } })

    const denseInfo = new Uint8Array(18)
    new DataView(denseInfo.buffer).setBigUint64(2, 700n, true)
    new DataView(denseInfo.buffer).setBigUint64(10, 800n, true)
    const denseHeader = createGeneratedVersion2ObjectHeader([{ type: 0x0002, data: denseInfo }])
    const denseFile = await openFixture(denseHeader)
    await expect(
      readHdf5ObjectHeader(denseFile, denseFile.superblock.rootObjectAddress),
    ).resolves.toMatchObject({
      linkStorage: {
        kind: 'dense',
        fractalHeapAddress: 700n,
        nameIndexAddress: 800n,
      },
    })
  })

  it('rejects corrupt checksums, cyclic continuations, and metadata limits', async () => {
    const corrupt = createGeneratedVersion2ObjectHeader([hardLinkMessage()])
    corrupt[corrupt.byteLength - 1] = (corrupt[corrupt.byteLength - 1] ?? 0) ^ 1
    const corruptFile = await openFixture(corrupt)
    await expect(
      readHdf5ObjectHeader(corruptFile, corruptFile.superblock.rootObjectAddress),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT', message: expect.stringContaining('checksum') })

    const corruptContinuation = createGeneratedVersion2Continuation([hardLinkMessage()])
    corruptContinuation[corruptContinuation.byteLength - 1] =
      (corruptContinuation[corruptContinuation.byteLength - 1] ?? 0) ^ 1
    const continuationRoot = createGeneratedVersion2ObjectHeader([
      {
        type: 0x0010,
        data: createGeneratedContinuationMessage(
          continuationAddress,
          corruptContinuation.byteLength,
          8,
          8,
        ),
      },
    ])
    const corruptContinuationFile = await openFixture(continuationRoot, [
      [continuationAddress, corruptContinuation],
    ])
    await expect(
      readHdf5ObjectHeader(
        corruptContinuationFile,
        corruptContinuationFile.superblock.rootObjectAddress,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT', message: expect.stringContaining('checksum') })

    const fixture = createGeneratedHdf5Fixture({ version: 2, fileBytes: 1_024 })
    const rootAddress = fixture.rootObjectAddress
    const cyclic = createGeneratedVersion2ObjectHeader([
      {
        type: 0x0010,
        data: createGeneratedContinuationMessage(rootAddress, 16, 8, 8),
      },
    ])
    if (fixture.rootObjectOffset === undefined)
      throw new Error('Generated root offset is unavailable')
    fixture.bytes.set(cyclic, fixture.rootObjectOffset)
    const cyclicFile = await openHdf5FileLayer(new MemorySource(fixture.bytes))
    await expect(readHdf5ObjectHeader(cyclicFile, rootAddress)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: expect.stringContaining('cyclic'),
    })

    const limitedFile = await openFixture(createGeneratedVersion2ObjectHeader([hardLinkMessage()]))
    await expect(
      readHdf5ObjectHeader(limitedFile, limitedFile.superblock.rootObjectAddress, {
        maxHeaderBytes: 8,
      }),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })

    const limitedContinuationsFile = await openFixture(version2RootWithNestedContinuation(), [
      [continuationAddress, nestedVersion2Continuation()],
    ])
    await expect(
      readHdf5ObjectHeader(
        limitedContinuationsFile,
        limitedContinuationsFile.superblock.rootObjectAddress,
        { maxContinuationBlocks: 1 },
      ),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
  })

  it('rejects mandatory unknown messages, unsupported link classes, and hostile link data', async () => {
    const mandatory = createGeneratedVersion2ObjectHeader([
      { type: 0x0042, flags: 0x80, data: new Uint8Array() },
    ])
    const mandatoryFile = await openFixture(mandatory)
    await expect(
      readHdf5ObjectHeader(mandatoryFile, mandatoryFile.superblock.rootObjectAddress, {
        objectPath: '/entry',
      }),
    ).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
      message: expect.stringMatching(/entry.*0x0042/u),
    })

    const externalLink = createGeneratedSoftLink({ name: 'outside' }, 'file.h5')
    externalLink[2] = 64
    const externalFile = await openFixture(
      createGeneratedVersion2ObjectHeader([{ type: 0x0006, data: externalLink }]),
    )
    await expect(
      readHdf5ObjectHeader(externalFile, externalFile.superblock.rootObjectAddress),
    ).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
      message: expect.stringContaining('external link'),
    })

    const duplicateFile = await openFixture(
      createGeneratedVersion2ObjectHeader([hardLinkMessage(), hardLinkMessage()]),
    )
    await expect(
      readHdf5ObjectHeader(duplicateFile, duplicateFile.superblock.rootObjectAddress),
    ).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: expect.stringContaining('repeats compact link'),
    })
  })

  it('honors cancellation and configurable message and link limits', async () => {
    const header = createGeneratedVersion2ObjectHeader([hardLinkMessage('long-name')])
    const file = await openFixture(header)
    await expect(
      readHdf5ObjectHeader(file, file.superblock.rootObjectAddress, { maxMessages: 1 }),
    ).resolves.toMatchObject({ messages: [{ type: 0x0006 }] })
    await expect(
      readHdf5ObjectHeader(file, file.superblock.rootObjectAddress, { maxLinkNameBytes: 4 }),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })

    const controller = new AbortController()
    controller.abort(new Error('stop object graph'))
    await expect(
      readHdf5ObjectHeader(file, file.superblock.rootObjectAddress, {
        signal: controller.signal,
      }),
    ).rejects.toThrow('stop object graph')
  })
})
