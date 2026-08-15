import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createGeneratedNcemEmdFixture } from '../benchmark/ncem-emd/generated-fixture.ts'
import { independentNcemEmdFixture } from '../benchmark/ncem-emd/independent-fixture.ts'
import { independentNcemEmdMetadataFixture } from '../benchmark/ncem-emd/independent-metadata-fixture.ts'
import { openHdf5File, type Hdf5Block } from '../src/scientific/formats/hdf5-file.ts'
import { inspectNcemEmd } from '../src/scientific/formats/ncem-emd.ts'
import type { ImageSource, ImageSourceReadOptions } from '../src/source.ts'
import { MemorySource } from '../src/source.ts'

class CountingSource implements ImageSource {
  readonly size: number
  readonly reads: Array<Readonly<{ readonly offset: number; readonly length: number }>> = []
  readonly #bytes: Uint8Array

  constructor(bytes: Uint8Array) {
    this.#bytes = bytes
    this.size = bytes.byteLength
  }

  async read(
    offset: number,
    length: number,
    options: Readonly<ImageSourceReadOptions> = {},
  ): Promise<Uint8Array> {
    if (options.signal?.aborted === true) throw options.signal.reason
    this.reads.push(Object.freeze({ offset, length }))
    return this.#bytes.slice(offset, offset + length)
  }
}

const collect = async (blocks: AsyncIterable<Hdf5Block>): Promise<readonly Hdf5Block[]> => {
  const output: Hdf5Block[] = []
  for await (const block of blocks) output.push(block)
  return output
}

const globalHeapOffset = (bytes: Uint8Array): number => {
  for (let offset = 0; offset <= bytes.byteLength - 4; offset += 1) {
    if (
      bytes[offset] === 0x47 &&
      bytes[offset + 1] === 0x43 &&
      bytes[offset + 2] === 0x4f &&
      bytes[offset + 3] === 0x4c
    ) {
      return offset
    }
  }
  throw new Error('Expected an HDF5 global heap fixture')
}

describe('NCEM EMD E1 structural inspection', () => {
  it('identifies version 0.2 numeric groups without reading sample payloads', async () => {
    const fixture = createGeneratedNcemEmdFixture()
    const source = new CountingSource(fixture.bytes)
    const file = await openHdf5File(source)
    await expect(inspectNcemEmd(file)).resolves.toEqual({
      version: { major: 0, minor: 2 },
      numericGroups: [
        {
          path: '/data/image',
          dataPath: '/data/image/data',
          dimensionPaths: ['/data/image/dim1', '/data/image/dim2'],
          dimensions: [
            {
              path: '/data/image/dim1',
              name: 'Position Y',
              unit: '[n_m]',
              length: 3,
              coordinates: { type: 'linear', origin: 0, step: 0.5 },
            },
            {
              path: '/data/image/dim2',
              name: 'Position X',
              unit: '[n_m]',
              length: 4,
              coordinates: { type: 'linear', origin: -1, step: 0.25 },
            },
          ],
          shape: [3, 4],
        },
      ],
      metadata: {},
    })
    expect(source.reads.some(({ offset }) => offset >= fixture.rawDataAddress)).toBe(false)

    const blocks = await collect(
      file.readDataset('/data/image/data', { start: [1, 1], shape: [1, 2] }),
    )
    expect(blocks).toHaveLength(1)
    expect(Array.from(blocks[0]?.data ?? [])).toEqual([6, 0, 7, 0])
    expect(source.reads.some(({ offset }) => offset === fixture.rawDataAddress + 10)).toBe(true)
  })

  it('distinguishes unsupported versions and invalid numeric-group structure', async () => {
    const future = await openHdf5File(
      new MemorySource(createGeneratedNcemEmdFixture({ versionMajor: 1n, versionMinor: 0n }).bytes),
    )
    await expect(inspectNcemEmd(future)).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
      message: expect.stringContaining('version 1.0'),
    })
    const noNumericGroups = await openHdf5File(
      new MemorySource(createGeneratedNcemEmdFixture({ groupType: 2n }).bytes),
    )
    await expect(inspectNcemEmd(noNumericGroups)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: expect.stringContaining('no numeric groups'),
    })
  })

  it('preserves bounded non-linear dimension lookup coordinates exactly', async () => {
    const file = await openHdf5File(
      new MemorySource(createGeneratedNcemEmdFixture({ dim1Values: [0, 1, 4] }).bytes),
    )
    const inspection = await inspectNcemEmd(file)
    expect(inspection.numericGroups[0]?.dimensions[0]?.coordinates).toEqual({
      type: 'lookup',
      values: [0, 1, 4],
    })
  })

  it('matches an independently generated h5py 3.12.1 NCEM hierarchy and samples', async () => {
    const bytes = independentNcemEmdFixture.bytes()
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(independentNcemEmdFixture.sha256)
    const file = await openHdf5File(new MemorySource(bytes))
    const inspection = await inspectNcemEmd(file)
    expect(inspection.numericGroups).toEqual([
      {
        path: '/data/image',
        dataPath: '/data/image/data',
        dimensionPaths: ['/data/image/dim1', '/data/image/dim2'],
        dimensions: [
          {
            path: '/data/image/dim1',
            name: 'Position Y',
            unit: '[n_m]',
            length: 3,
            coordinates: { type: 'linear', origin: 0, step: 0.5 },
          },
          {
            path: '/data/image/dim2',
            name: 'Position X',
            unit: '[n_m]',
            length: 4,
            coordinates: { type: 'linear', origin: -1, step: 0.25 },
          },
        ],
        shape: [3, 4],
      },
    ])
    const blocks = await collect(
      file.readDataset('/data/image/data', { start: [1, 1], shape: [1, 2] }),
    )
    expect(blocks.map(({ data }) => Array.from(data))).toEqual([
      [6, 0],
      [7, 0],
    ])
  })

  it('preserves independently generated scalar acquisition metadata and global-heap strings', async () => {
    const bytes = independentNcemEmdMetadataFixture.bytes()
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      independentNcemEmdMetadataFixture.sha256,
    )
    const source = new CountingSource(bytes)
    const file = await openHdf5File(source)
    await expect(inspectNcemEmd(file)).resolves.toMatchObject({
      metadata: {
        microscope: { accelerating_voltage: 200_000, operator: 'Ada Lovelace' },
        sample: { material: 'Si3N4' },
        comments: { note: 'independent fixture' },
      },
    })
    expect(source.reads.length).toBeLessThanOrEqual(4)

    for (const attributes of [
      { maxGlobalHeapCollectionBytes: 1_024 },
      { maxGlobalHeapObjectBytes: 8 },
      { maxGlobalHeapObjects: 2 },
      { maxAttributeMetadataBytes: 1_000 },
      { maxAttributeReadOperations: 2 },
    ]) {
      const limited = await openHdf5File(new MemorySource(bytes), { attributes })
      await expect(inspectNcemEmd(limited)).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
    }

    const corruptBytes = independentNcemEmdMetadataFixture.bytes()
    corruptBytes[globalHeapOffset(corruptBytes)] = 0
    const corrupt = await openHdf5File(new MemorySource(corruptBytes))
    await expect(inspectNcemEmd(corrupt)).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('accepts string version attributes and preserves bounded acquisition arrays', async () => {
    const file = await openHdf5File(
      new MemorySource(
        createGeneratedNcemEmdFixture({
          versionStrings: true,
          acquisitionMetadata: true,
          acquisitionArrays: true,
        }).bytes,
      ),
    )
    await expect(inspectNcemEmd(file)).resolves.toMatchObject({
      version: { major: 0, minor: 2 },
      metadata: {
        microscope: {
          stage_position: [1.25, -2.5, 3.75],
          detectors: ['BF', 'HAADF'],
        },
      },
    })
  })

  it('enforces traversal, attribute-operation, and cancellation limits', async () => {
    const bytes = createGeneratedNcemEmdFixture().bytes
    const objectLimited = await openHdf5File(new MemorySource(bytes))
    await expect(inspectNcemEmd(objectLimited, { maxObjects: 1 })).rejects.toMatchObject({
      code: 'LIMIT_EXCEEDED',
    })
    const dimensionLimited = await openHdf5File(new MemorySource(bytes))
    await expect(inspectNcemEmd(dimensionLimited, { maxDimensionValues: 2 })).rejects.toMatchObject(
      {
        code: 'LIMIT_EXCEEDED',
      },
    )
    const attributeLimited = await openHdf5File(new MemorySource(bytes), {
      attributes: { maxAttributeReadOperations: 1 },
    })
    await expect(inspectNcemEmd(attributeLimited)).rejects.toMatchObject({
      code: 'LIMIT_EXCEEDED',
    })
    const totalDimensionLimited = await openHdf5File(new MemorySource(bytes))
    await expect(
      inspectNcemEmd(totalDimensionLimited, { maxTotalDimensionValues: 4 }),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
    const metadataEntryLimited = await openHdf5File(
      new MemorySource(independentNcemEmdMetadataFixture.bytes()),
    )
    await expect(
      inspectNcemEmd(metadataEntryLimited, { maxMetadataEntries: 2 }),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
    const metadataByteLimited = await openHdf5File(
      new MemorySource(independentNcemEmdMetadataFixture.bytes()),
    )
    await expect(
      inspectNcemEmd(metadataByteLimited, { maxMetadataBytes: 16 }),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
    const controller = new AbortController()
    controller.abort(new Error('stop NCEM EMD inspection'))
    const cancelled = await openHdf5File(new MemorySource(bytes))
    await expect(inspectNcemEmd(cancelled, { signal: controller.signal })).rejects.toThrow(
      'stop NCEM EMD inspection',
    )
  })
})
