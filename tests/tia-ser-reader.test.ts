import { describe, expect, it } from 'vitest'
import {
  generateTiaSerFixture,
  generatedTiaSerImageSeries,
  generatedTiaSerPointSpectrum,
  generatedTiaSerSpectrumImage,
} from '../benchmark/tia-ser/generated-fixture.ts'
import { createTiaSerReader, tiaSerReader } from '../src/scientific/readers/tia-ser.ts'
import type { ScientificDataset, ScientificSeriesReadRequest } from '../src/scientific/dataset.ts'
import type { ImageSource, ImageSourceReadOptions } from '../src/source.ts'
import { MemorySource } from '../src/source.ts'

interface SourceRead {
  readonly offset: number
  readonly length: number
}

class TrackingSource implements ImageSource {
  readonly size: number
  readonly reads: SourceRead[] = []
  readonly #source: MemorySource

  constructor(bytes: Uint8Array) {
    this.size = bytes.byteLength
    this.#source = new MemorySource(bytes)
  }

  async read(
    offset: number,
    length: number,
    options: Readonly<ImageSourceReadOptions> = {},
  ): Promise<Uint8Array> {
    this.reads.push(Object.freeze({ offset, length }))
    return this.#source.read(offset, length, options)
  }
}

class WeakLifetimeSource implements ImageSource {
  readonly size: number
  readonly #bytes: Uint8Array
  readonly #scratch: Uint8Array

  constructor(bytes: Uint8Array) {
    this.size = bytes.byteLength
    this.#bytes = bytes
    this.#scratch = new Uint8Array(bytes.byteLength)
  }

  async read(offset: number, length: number): Promise<Uint8Array> {
    const available = Math.min(length, this.size - offset)
    this.#scratch.fill(0xa5)
    this.#scratch.set(this.#bytes.subarray(offset, offset + available), 0)
    return this.#scratch.subarray(0, available)
  }
}

const context = (bytes: Uint8Array, name?: string, source?: ImageSource) => ({
  primary: {
    id: 'fixture',
    ...(name === undefined ? {} : { name }),
    source: source ?? new MemorySource(bytes),
  },
})

const seriesBytes = async (
  dataset: ScientificDataset,
  request: Readonly<ScientificSeriesReadRequest>,
): Promise<number[]> => {
  if (dataset.readSeries === undefined) throw new Error('Expected native series reads')
  const data: number[] = []
  for await (const block of dataset.readSeries(request)) data.push(...block.data)
  return data
}

describe('TIA SER scientific reader', () => {
  it('probes the binary signature rather than trusting a filename extension', async () => {
    await expect(
      tiaSerReader.probe(context(generatedTiaSerPointSpectrum())),
    ).resolves.toMatchObject({
      confidence: 0.99,
    })
    await expect(
      tiaSerReader.probe(context(new Uint8Array(32), 'not-ser.ser')),
    ).resolves.toMatchObject({ confidence: 0 })
  })

  it('opens a v528 point spectrum as a calibrated rank-one native series without eager payload reads', async () => {
    const bytes = generatedTiaSerPointSpectrum()
    const source = new TrackingSource(bytes)
    const document = await tiaSerReader.open(context(bytes, 'point.ser', source))
    expect(document).toMatchObject({
      format: 'FEI/Thermo TIA SER',
      metadata: { seriesVersion: 528, totalElements: 1, declaredValidElements: 1 },
      datasets: [
        {
          id: 'spectra',
          descriptor: {
            sampleType: 'int32',
            axes: [
              {
                id: 'energy',
                kind: 'spectral',
                length: 4,
                unit: 'eV',
                coordinates: { type: 'linear', origin: 99.5, step: 0.5 },
              },
            ],
          },
        },
      ],
    })
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const offsetArrayOffset = view.getUint32(22, true)
    const payloadOffset = view.getUint32(offsetArrayOffset, true) + 26
    expect(source.reads.some(({ offset }) => offset === payloadOffset)).toBe(false)

    const dataset = await document.openDataset('spectra')
    expect(
      await seriesBytes(dataset, { axisId: 'energy', fixedIndices: [], start: 0, length: 4 }),
    ).toEqual([0, 0, 0, 1, 255, 255, 255, 254, 0, 0, 0, 3, 0, 0, 0, 4])
  })

  it('reads v544 spectrum-image native series and arbitrary calibrated planes', async () => {
    const document = await tiaSerReader.open(context(generatedTiaSerSpectrumImage(), 'si.ser'))
    expect(document.datasets[0]).toMatchObject({
      id: 'spectra',
      descriptor: {
        axes: [
          { id: 'x', length: 2, coordinates: { type: 'linear', origin: 1, step: 1 } },
          { id: 'y', length: 2, coordinates: { type: 'linear', origin: 10, step: 10 } },
          { id: 'energy', length: 3, coordinates: { origin: 99.5, step: 0.5 } },
        ],
      },
    })
    const dataset = await document.openDataset('spectra')
    expect(
      await seriesBytes(dataset, {
        axisId: 'energy',
        fixedIndices: [
          { axisId: 'x', index: 1 },
          { axisId: 'y', index: 1 },
        ],
        start: 0,
        length: 3,
      }),
    ).toEqual([0, 31, 0, 32, 0, 33])

    const rows: number[][] = []
    for await (const block of dataset.readPlane({
      displayAxes: ['x', 'y'],
      fixedIndices: [{ axisId: 'energy', index: 1 }],
      width: 2,
      height: 2,
    })) {
      rows.push(Array.from(block.data))
    }
    expect(rows).toEqual([
      [0, 2, 0, 12],
      [0, 22, 0, 32],
    ])
  })

  it('reads image-series rows in display order while preserving the native bottom-up storage', async () => {
    const document = await tiaSerReader.open(context(generatedTiaSerImageSeries(), 'images.ser'))
    expect(document.datasets[0]).toMatchObject({
      id: 'images',
      descriptor: {
        axes: [
          { id: 'element', length: 2 },
          { id: 'x', length: 2, coordinates: { origin: 0, step: 0.25 } },
          { id: 'y', length: 2, coordinates: { origin: 0, step: 0.5 } },
        ],
      },
    })
    const dataset = await document.openDataset('images')
    const rows: number[][] = []
    for await (const block of dataset.readPlane({
      displayAxes: ['x', 'y'],
      fixedIndices: [{ axisId: 'element', index: 1 }],
      width: 2,
      height: 2,
    })) {
      rows.push(Array.from(block.data))
    }
    expect(rows).toEqual([
      [0, 11, 0, 12],
      [0, 13, 0, 14],
    ])
  })

  it('reports declared invalid or truncated elements without hiding readable elements', async () => {
    const declaredInvalid = generateTiaSerFixture({
      version: 528,
      dataKind: 'spectrum',
      tagKind: 'time',
      totalElements: 3,
      dimensions: [{ size: 3, offset: 0, delta: 1, element: 0, description: 'Number', unit: '' }],
      elements: [
        {
          calibrations: [{ offset: 0, delta: 1, element: 0 }],
          dataType: 1,
          shape: [2],
          payload: Uint8Array.of(4, 5),
          tag: { time: 1 },
        },
      ],
    })
    const declaredDocument = await tiaSerReader.open(context(declaredInvalid))
    expect(declaredDocument.metadata).toMatchObject({ totalElements: 3, declaredValidElements: 1 })

    const complete = generatedTiaSerImageSeries()
    const completeView = new DataView(complete.buffer, complete.byteOffset, complete.byteLength)
    const completeOffsetArray = completeView.getUint32(22, true)
    const secondPayloadOffset = completeView.getUint32(completeOffsetArray + 4, true) + 50
    const truncated = complete.slice(0, secondPayloadOffset + 1)
    const truncatedDocument = await tiaSerReader.open(context(truncated))
    expect(truncatedDocument.datasets.map(({ id }) => id)).toEqual(['element-0'])
    expect(truncatedDocument.metadata).toMatchObject({
      indexedElements: 1,
      invalidElements: [{ elementIndex: 1, reason: expect.stringContaining('truncated') }],
    })
  })

  it('rejects unsupported element types and hostile structural limits explicitly', async () => {
    const complex = generateTiaSerFixture({
      version: 544,
      dataKind: 'spectrum',
      tagKind: 'time',
      dimensions: [{ size: 1, offset: 0, delta: 1, element: 0, description: 'Number', unit: '' }],
      elements: [
        {
          calibrations: [{ offset: 0, delta: 1, element: 0 }],
          dataType: 9,
          shape: [1],
          payload: new Uint8Array(8),
          tag: { time: 0 },
        },
      ],
    })
    await expect(tiaSerReader.open(context(complex))).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
    })
    await expect(tiaSerReader.open(context(complex))).rejects.toThrow(
      'unsupported complex element type 9',
    )

    const constrained = createTiaSerReader({ limits: { maxElements: 1 } })
    await expect(constrained.open(context(generatedTiaSerImageSeries()))).rejects.toMatchObject({
      code: 'LIMIT_EXCEEDED',
    })
  })

  it('enforces every configurable admission and metadata projection limit', async () => {
    const point = generatedTiaSerPointSpectrum()
    const spectrumImage = generatedTiaSerSpectrumImage()
    for (const [reader, bytes] of [
      [createTiaSerReader({ limits: { maxSourceBytes: point.byteLength - 1 } }), point],
      [createTiaSerReader({ limits: { maxDimensions: 1 } }), spectrumImage],
      [createTiaSerReader({ limits: { maxDimensionLength: 3 } }), point],
      [createTiaSerReader({ limits: { maxStringBytes: 7 } }), point],
      [createTiaSerReader({ limits: { maxOffsetArrayBytes: 7 } }), point],
      [createTiaSerReader({ limits: { maxElementBytes: 15 } }), point],
      [createTiaSerReader({ limits: { maxMetadataBytes: 33 } }), point],
    ] as const) {
      await expect(reader.open(context(bytes))).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
    }
    expect(() => createTiaSerReader({ limits: { maxSourceBytes: 0 } })).toThrow(
      'must be a positive safe integer',
    )

    const incompatible = generateTiaSerFixture({
      version: 528,
      dataKind: 'spectrum',
      tagKind: 'time',
      dimensions: [{ size: 2, offset: 0, delta: 1, element: 0, description: 'Number', unit: '' }],
      elements: [0, 1].map((elementIndex) => ({
        calibrations: [{ offset: elementIndex, delta: 1, element: 0 }],
        dataType: 1,
        shape: [1] as const,
        payload: Uint8Array.of(elementIndex),
        tag: { time: elementIndex },
      })),
    })
    await expect(
      createTiaSerReader({ limits: { maxDatasets: 1 } }).open(context(incompatible)),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })

    const invalidElements = generateTiaSerFixture({
      version: 544,
      dataKind: 'spectrum',
      tagKind: 'time',
      dimensions: [{ size: 3, offset: 0, delta: 1, element: 0, description: 'Number', unit: '' }],
      elements: [
        {
          calibrations: [{ offset: 0, delta: 1, element: 0 }],
          dataType: 9,
          shape: [1],
          payload: new Uint8Array(8),
          tag: { time: 0 },
        },
        {
          calibrations: [{ offset: 0, delta: 1, element: 0 }],
          dataType: 10,
          shape: [1],
          payload: new Uint8Array(16),
          tag: { time: 1 },
        },
        {
          calibrations: [{ offset: 0, delta: 1, element: 0 }],
          dataType: 1,
          shape: [1],
          payload: Uint8Array.of(7),
          tag: { time: 2 },
        },
      ],
    })
    const boundedMetadata = await createTiaSerReader({
      limits: { maxInvalidMetadataEntries: 1 },
    }).open(context(invalidElements))
    expect(boundedMetadata.metadata).toMatchObject({
      invalidElements: [{ elementIndex: 0 }],
      omittedInvalidElements: 1,
    })

    const regionReader = createTiaSerReader({ limits: { maxRegionBytes: 1 } })
    const regionDocument = await regionReader.open(context(spectrumImage))
    const regionDataset = await regionDocument.openDataset('spectra')
    if (regionDataset.readSeries === undefined) throw new Error('Expected native series reads')
    const regionIterator = regionDataset
      .readSeries({
        axisId: 'energy',
        fixedIndices: [
          { axisId: 'x', index: 0 },
          { axisId: 'y', index: 0 },
        ],
        length: 1,
      })
      [Symbol.asyncIterator]()
    await expect(regionIterator.next()).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
  })

  it('honors abort signals, read limits, and weak ImageSource buffer lifetimes', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      tiaSerReader.open({
        ...context(generatedTiaSerPointSpectrum()),
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' })

    const weakBytes = generatedTiaSerSpectrumImage()
    const weakDocument = await tiaSerReader.open(
      context(weakBytes, 'weak.ser', new WeakLifetimeSource(weakBytes)),
    )
    expect(weakDocument.datasets[0]).toMatchObject({
      descriptor: { axes: [{ length: 2 }, { length: 2 }, { length: 3 }] },
    })

    const constrained = createTiaSerReader({ limits: { maxReadOperations: 1 } })
    const document = await constrained.open(context(generatedTiaSerSpectrumImage()))
    const dataset = await document.openDataset('spectra')
    const iterator = dataset
      .readPlane({
        displayAxes: ['x', 'y'],
        fixedIndices: [{ axisId: 'energy', index: 0 }],
        width: 2,
        height: 1,
      })
      [Symbol.asyncIterator]()
    await expect(iterator.next()).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })

    const seriesConstrained = createTiaSerReader({
      limits: { maxRegionBytes: 2, maxReadOperations: 1 },
    })
    const seriesDocument = await seriesConstrained.open(context(generatedTiaSerSpectrumImage()))
    const seriesDataset = await seriesDocument.openDataset('spectra')
    if (seriesDataset.readSeries === undefined) throw new Error('Expected native series reads')
    const seriesIterator = seriesDataset
      .readSeries({
        axisId: 'energy',
        fixedIndices: [
          { axisId: 'x', index: 0 },
          { axisId: 'y', index: 0 },
        ],
        length: 3,
      })
      [Symbol.asyncIterator]()
    await expect(seriesIterator.next()).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
  })
})
