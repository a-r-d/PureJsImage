import { describe, expect, it } from 'vitest'
import { createGeneratedNcemEmdFixture } from '../benchmark/ncem-emd/generated-fixture.ts'
import { independentNcemEmdMetadataFixture } from '../benchmark/ncem-emd/independent-metadata-fixture.ts'
import { createNcemEmdReader } from '../src/scientific/readers/ncem-emd.ts'
import type { ScientificSeriesBlock } from '../src/scientific/dataset.ts'
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

const collectBytes = async (
  blocks: AsyncIterable<Readonly<{ readonly data: Uint8Array }>>,
): Promise<readonly number[]> => {
  const output: number[] = []
  for await (const block of blocks) output.push(...block.data)
  return output
}

describe('NCEM EMD E1 scientific dataset adapter', () => {
  it('probes version 0.2 and exposes labeled datasets with bounded canonical region reads', async () => {
    const fixture = createGeneratedNcemEmdFixture({ acquisitionMetadata: true })
    const reader = createNcemEmdReader()
    await expect(
      reader.probe({ primary: { id: 'fixture', source: new MemorySource(fixture.bytes) } }),
    ).resolves.toMatchObject({ confidence: 0.99 })

    const source = new CountingSource(fixture.bytes)
    const document = await reader.open({ primary: { id: 'fixture', source } })
    expect(document.metadata).toMatchObject({
      version: '0.2',
      numericGroupCount: 1,
      acquisition: {
        microscope: { accelerating_voltage: 200_000, operator: 'Ada Lovelace' },
        sample: { material: 'Si3N4' },
        user: { name: 'Microscopist' },
        comments: { note: 'generated fixture' },
      },
    })
    expect(document.datasets).toHaveLength(1)
    const summary = document.datasets[0]
    expect(summary).toMatchObject({
      id: '/data/image',
      name: 'image',
      descriptor: {
        sampleType: 'uint16',
        axes: [
          {
            id: 'dim1',
            name: 'Position Y',
            kind: 'space',
            length: 3,
            unit: '[n_m]',
            coordinates: { type: 'linear', origin: 0, step: 0.5 },
          },
          {
            id: 'dim2',
            name: 'Position X',
            kind: 'space',
            length: 4,
            unit: '[n_m]',
            coordinates: { type: 'linear', origin: -1, step: 0.25 },
          },
        ],
        capabilities: {
          regionReads: true,
          planeReads: { kind: 'any-axis-pair' },
          seriesReads: { kind: 'axes', axes: ['dim1', 'dim2'] },
        },
      },
      identity: {
        kind: 'scientific-dataset',
        datasetId: '/data/image',
        reader: { id: 'purejsimage/ncem-emd' },
      },
    })
    const dataset = await document.openDataset('/data/image')
    const beforePayloadReads = source.reads.length
    await expect(
      collectBytes(
        dataset.readPlane({
          displayAxes: ['dim2', 'dim1'],
          fixedIndices: [],
          x: 1,
          y: 1,
          width: 2,
          height: 1,
        }),
      ),
    ).resolves.toEqual([0, 6, 0, 7])
    expect(source.reads.slice(beforePayloadReads)).toEqual([
      { offset: fixture.rawDataAddress + 10, length: 4 },
    ])

    const transposed: Array<
      Readonly<{
        x: number
        y: number
        width: number
        height: number
        data: readonly number[]
      }>
    > = []
    for await (const block of dataset.readPlane({
      displayAxes: ['dim1', 'dim2'],
      fixedIndices: [],
      x: 0,
      y: 1,
      width: 2,
      height: 2,
    })) {
      transposed.push({
        x: block.x,
        y: block.y,
        width: block.width,
        height: block.height,
        data: [...block.data],
      })
    }
    expect(transposed).toEqual([
      { x: 0, y: 1, width: 2, height: 2, data: [0, 2, 0, 6, 0, 3, 0, 7] },
    ])

    const series: ScientificSeriesBlock[] = []
    if (dataset.readSeries === undefined) throw new Error('Expected NCEM EMD series reads')
    for await (const block of dataset.readSeries({
      axisId: 'dim2',
      fixedIndices: [{ axisId: 'dim1', index: 1 }],
      start: 1,
      length: 2,
    })) {
      series.push(block)
    }
    expect(series.map(({ start, length, data }) => ({ start, length, data: [...data] }))).toEqual([
      { start: 1, length: 2, data: [0, 6, 0, 7] },
    ])
    document.close?.()
  })

  it('enforces adapter output limits and rejects non-NCEM sources without a public claim', async () => {
    const fixture = createGeneratedNcemEmdFixture()
    const reader = createNcemEmdReader({ maxPlaneBytes: 2 })
    await expect(
      reader.probe({ primary: { id: 'not-hdf5', source: new MemorySource(Uint8Array.of(1, 2)) } }),
    ).resolves.toMatchObject({ confidence: 0 })
    const document = await reader.open({
      primary: { id: 'fixture', source: new MemorySource(fixture.bytes) },
    })
    const dataset = await document.openDataset('/data/image')
    await expect(
      collectBytes(
        dataset.readPlane({
          displayAxes: ['dim2', 'dim1'],
          fixedIndices: [],
          width: 2,
          height: 1,
        }),
      ),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
    document.close?.()
  })

  it('probes application-style NCEM string versions and /signals roots', async () => {
    const fixture = createGeneratedNcemEmdFixture({
      versionStrings: true,
      numericRoot: 'signals',
    })
    const reader = createNcemEmdReader()
    await expect(
      reader.probe({
        primary: { id: 'application-style', source: new MemorySource(fixture.bytes) },
      }),
    ).resolves.toMatchObject({ confidence: 0.99 })
  })

  it('reads an independently generated filtered h5py region through the scientific contract', async () => {
    const source = new CountingSource(independentNcemEmdMetadataFixture.bytes())
    const document = await createNcemEmdReader().open({
      primary: { id: 'independent-h5py', source },
    })
    const dataset = await document.openDataset('/data/image')
    const before = source.reads.length
    await expect(
      collectBytes(
        dataset.readPlane({
          displayAxes: ['dim2', 'dim1'],
          fixedIndices: [],
          x: 1,
          y: 1,
          width: 2,
          height: 1,
        }),
      ),
    ).resolves.toEqual([0, 6, 0, 7])
    const payloadReads = source.reads.slice(before)
    expect(payloadReads.length).toBeGreaterThan(0)
    expect(payloadReads.every(({ length }) => length < 4_096)).toBe(true)
    document.close?.()
  })
})
