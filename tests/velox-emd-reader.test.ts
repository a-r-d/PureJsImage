import { describe, expect, it } from 'vitest'
import { createGeneratedVeloxEmdFixture } from '../benchmark/velox-emd/generated-fixture.ts'
import { createVeloxEmdReader } from '../src/scientific/readers/velox-emd.ts'
import type { ImageSource, ImageSourceReadOptions } from '../src/source.ts'
import { MemorySource } from '../src/source.ts'

class CountingSource implements ImageSource {
  readonly size: number
  readonly #bytes: Uint8Array
  reads = 0
  readonly requests: Array<Readonly<{ readonly offset: number; readonly length: number }>> = []

  constructor(bytes: Uint8Array) {
    this.#bytes = bytes
    this.size = bytes.byteLength
  }

  async read(
    offset: number,
    length: number,
    options: Readonly<ImageSourceReadOptions> = {},
  ): Promise<Uint8Array> {
    options.signal?.throwIfAborted()
    this.reads += 1
    this.requests.push(Object.freeze({ offset, length }))
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

describe('Velox EMD scientific reader', () => {
  it('probes the HDF5 hierarchy and exposes calibrated detector frames without summing', async () => {
    const fixture = createGeneratedVeloxEmdFixture()
    const reader = createVeloxEmdReader()
    await expect(
      reader.probe({
        primary: { id: 'not-an-emd-name.bin', source: new MemorySource(fixture.bytes) },
      }),
    ).resolves.toMatchObject({ confidence: 0.995 })
    const document = await reader.open({
      primary: { id: 'generated', source: new MemorySource(fixture.bytes) },
    })
    expect(document.datasets).toHaveLength(1)
    expect(document.datasets[0]).toMatchObject({
      id: fixture.datasetId,
      name: 'Generated detector',
      descriptor: {
        sampleType: 'uint16',
        axes: [
          {
            id: 'x',
            kind: 'space',
            length: 3,
            unit: 'm',
            coordinates: { type: 'linear', origin: -1, step: 0.5 },
          },
          {
            id: 'y',
            kind: 'space',
            length: 2,
            unit: 'm',
            coordinates: { type: 'linear', origin: 2, step: 0.25 },
          },
          {
            id: 'frame',
            kind: 'time',
            length: 2,
            unit: 's',
            coordinates: { type: 'linear', origin: 0, step: 0.125 },
          },
        ],
      },
    })
    expect(document.datasets[0]?.descriptor.metadata).toMatchObject({
      veloxEmd: {
        metadataScope: 'per-frame',
        calibrationInvariant: true,
        frameMetadata: expect.any(Array),
      },
    })
    const dataset = await document.openDataset(fixture.datasetId ?? '')
    await expect(
      collectBytes(
        dataset.readPlane({
          displayAxes: ['x', 'y'],
          fixedIndices: [{ axisId: 'frame', index: 0 }],
          width: 3,
          height: 2,
        }),
      ),
    ).resolves.toEqual([0, 1, 0, 3, 0, 5, 0, 7, 0, 9, 0, 11])
    await expect(
      collectBytes(
        dataset.readPlane({
          displayAxes: ['x', 'y'],
          fixedIndices: [{ axisId: 'frame', index: 1 }],
          width: 3,
          height: 2,
        }),
      ),
    ).resolves.toEqual([0, 2, 0, 4, 0, 6, 0, 8, 0, 10, 0, 12])
    document.close?.()
  })

  it('preserves complex positive-frequency FFT storage and sample values', async () => {
    const fixture = createGeneratedVeloxEmdFixture({ variant: 'fft' })
    const document = await createVeloxEmdReader().open({
      primary: { id: 'fft', source: new MemorySource(fixture.bytes) },
    })
    expect(document.datasets[0]?.descriptor).toMatchObject({
      sampleType: 'float32',
      components: [
        { id: 'real', name: 'Real' },
        { id: 'imaginary', name: 'Imaginary' },
      ],
      metadata: {
        veloxEmd: {
          frequencyDomain: {
            positiveFrequencyOnly: true,
            centered: false,
            storage: 'half-even',
          },
        },
      },
    })
    const dataset = await document.openDataset(fixture.datasetId ?? '')
    const bytes = await collectBytes(
      dataset.readPlane({
        displayAxes: ['x', 'y'],
        fixedIndices: [{ axisId: 'frame', index: 0 }],
        width: 1,
        height: 1,
      }),
    )
    expect(bytes).toEqual([0x3e, 0x80, 0, 0, 0xbf, 0, 0, 0])
    document.close?.()
  })

  it('bounds JSON and output allocations and reports malformed metadata', async () => {
    const fixture = createGeneratedVeloxEmdFixture()
    await expect(
      createVeloxEmdReader({ limits: { maxJsonBytes: 128 } }).open({
        primary: { id: 'json-limit', source: new MemorySource(fixture.bytes) },
      }),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })

    await expect(
      createVeloxEmdReader({ limits: { maxTotalJsonBytes: 1_000 } }).open({
        primary: { id: 'total-json-limit', source: new MemorySource(fixture.bytes) },
      }),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })

    const document = await createVeloxEmdReader({ limits: { maxOutputBytes: 4 } }).open({
      primary: { id: 'output-limit', source: new MemorySource(fixture.bytes) },
    })
    const dataset = await document.openDataset(fixture.datasetId ?? '')
    await expect(
      collectBytes(
        dataset.readPlane({
          displayAxes: ['x', 'y'],
          fixedIndices: [{ axisId: 'frame', index: 0 }],
          width: 3,
          height: 1,
        }),
      ),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
    document.close?.()

    const invalid = createGeneratedVeloxEmdFixture({ invalidJson: true })
    await expect(
      createVeloxEmdReader().open({
        primary: { id: 'invalid-json', source: new MemorySource(invalid.bytes) },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('applies the total JSON budget across every image in one document', async () => {
    const fixture = createGeneratedVeloxEmdFixture({ imageCount: 2, metadataBytes: 400 })
    const source = new CountingSource(fixture.bytes)
    const reader = createVeloxEmdReader({ limits: { maxTotalJsonBytes: 1_000 } })
    await expect(
      reader.open({
        primary: { id: 'aggregate-json-limit', source },
      }),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
    expect(source.requests.every(({ offset }) => offset < 24_576)).toBe(true)
  })

  it('batches large metadata columns and exposes frame calibration conflicts honestly', async () => {
    const large = createGeneratedVeloxEmdFixture({ metadataBytes: 100_000 })
    const source = new CountingSource(large.bytes)
    const document = await createVeloxEmdReader().open({
      primary: { id: 'large-metadata', source },
    })
    expect(source.reads).toBeLessThan(40)
    expect(document.datasets[0]?.descriptor.metadata).toMatchObject({
      veloxEmd: { metadataScope: 'per-frame', frameMetadata: expect.any(Array) },
    })
    document.close?.()

    const conflicting = createGeneratedVeloxEmdFixture({ conflictingFrameCalibration: true })
    const conflictDocument = await createVeloxEmdReader().open({
      primary: { id: 'conflicting-metadata', source: new MemorySource(conflicting.bytes) },
    })
    expect(conflictDocument.datasets[0]?.descriptor.axes).toMatchObject([
      { id: 'x', coordinates: { type: 'index' } },
      { id: 'y', coordinates: { type: 'index' } },
      { id: 'frame', coordinates: { type: 'index' } },
    ])
    expect(conflictDocument.datasets[0]?.descriptor.metadata).toMatchObject({
      veloxEmd: {
        calibrationInvariant: false,
        warnings: expect.arrayContaining([
          expect.objectContaining({ code: 'frame-calibration-conflict' }),
        ]),
      },
    })
    conflictDocument.close?.()

    const incomplete = createGeneratedVeloxEmdFixture({ zeroPixelWidth: true })
    const incompleteDocument = await createVeloxEmdReader().open({
      primary: { id: 'incomplete-metadata', source: new MemorySource(incomplete.bytes) },
    })
    const xAxis = incompleteDocument.datasets[0]?.descriptor.axes[0]
    expect(xAxis).toMatchObject({ id: 'x', coordinates: { type: 'index' } })
    expect(xAxis).not.toHaveProperty('unit')
    expect(xAxis).not.toHaveProperty('calibration')
    expect(incompleteDocument.datasets[0]?.descriptor.metadata).toMatchObject({
      veloxEmd: {
        frameMetadata: expect.any(Array),
        warnings: expect.arrayContaining([
          expect.objectContaining({ code: 'incomplete-axis-calibration', axisId: 'x' }),
        ]),
      },
    })
    incompleteDocument.close?.()
  })

  it('reports pruned spectrum images as a specific unsupported variant', async () => {
    const fixture = createGeneratedVeloxEmdFixture({ variant: 'pruned' })
    await expect(
      createVeloxEmdReader().open({
        primary: { id: 'pruned', source: new MemorySource(fixture.bytes) },
      }),
    ).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
      message: expect.stringContaining('pruned spectrum image'),
    })
  })
})
