import { describe, expect, it } from 'vitest'
import { createGeneratedVeloxEmdFixture } from '../benchmark/velox-emd/generated-fixture.ts'
import { createVeloxEmdReader } from '../src/scientific/readers/velox-emd.ts'
import { MemorySource } from '../src/source.ts'

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
