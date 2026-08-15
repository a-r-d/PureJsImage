import { describe, expect, it } from 'vitest'
import { createGeneratedVeloxSpectrumFixture } from '../benchmark/velox-emd/generated-spectrum-fixture.ts'
import { openHdf5File } from '../src/scientific/formats/hdf5-file.ts'
import {
  inspectVeloxEmdSpectra,
  readVeloxPointSpectrum,
} from '../src/scientific/formats/velox-emd.ts'
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

const openGenerated = async (
  options: Parameters<typeof createGeneratedVeloxSpectrumFixture>[0] = {},
) => {
  const fixture = createGeneratedVeloxSpectrumFixture(options)
  const file = await openHdf5File(new MemorySource(fixture.bytes))
  return { fixture, file }
}

const inspectStream = async (
  options: Parameters<typeof createGeneratedVeloxSpectrumFixture>[0] = {},
) => {
  const opened = await openGenerated(options)
  const inspection = await inspectVeloxEmdSpectra(opened.file)
  const stream = inspection.spectrumStreams[0]
  if (stream === undefined) throw new Error('Generated Velox stream is unavailable')
  return { ...opened, inspection, stream }
}

const uint32Values = (bytes: Uint8Array): readonly number[] => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const values: number[] = []
  for (let offset = 0; offset < bytes.byteLength; offset += 4) {
    values.push(view.getUint32(offset, false))
  }
  return values
}

describe('Velox EMD E3 spectrum substrate', () => {
  it('indexes dense and sparse spectra without reading sparse events', async () => {
    const fixture = createGeneratedVeloxSpectrumFixture()
    const source = new CountingSource(fixture.bytes)
    const file = await openHdf5File(source)
    const inspection = await inspectVeloxEmdSpectra(file)

    expect(inspection.denseSpectra).toHaveLength(1)
    expect(inspection.denseSpectra[0]).toMatchObject({
      id: fixture.denseId,
      energyBins: 8,
      storedSeries: 1,
      detector: 'EDS-A',
      energyCalibration: { origin: -100, step: 5, unit: 'eV' },
      datatype: { kind: 'integer', byteLength: 4, signed: false },
    })
    expect(inspection.spectrumStreams).toEqual([
      expect.objectContaining({
        id: fixture.streamId,
        detector: 'EDS-A',
        energyBins: 8,
        width: 2,
        height: 2,
        eventCount: 17,
        frameOffsets: [0, 10],
        energyCalibration: { origin: -100, step: 5, unit: 'eV' },
      }),
    ])
    expect(
      source.reads.some(
        ({ offset, length }) =>
          offset < fixture.eventDataAddress + 34 && offset + length > fixture.eventDataAddress,
      ),
    ).toBe(false)
    file.close()
  })

  it('enforces separate metadata, stream, frame, event, and spatial limits', async () => {
    const cases: ReadonlyArray<Readonly<Record<string, number>>> = [
      { maxJsonBytes: 1_023 },
      { maxTotalJsonBytes: 1_024 },
      { maxSettingsBytes: 8 },
      { maxSettingsHeapBytes: 128 },
      { maxEnergyBins: 4 },
      { maxFrames: 1 },
      { maxFrameTableBytes: 8 },
      { maxEvents: 16 },
      { maxSpatialPixels: 3 },
    ]
    for (const limits of cases) {
      const { file } = await openGenerated()
      await expect(inspectVeloxEmdSpectra(file, limits)).rejects.toMatchObject({
        code: 'LIMIT_EXCEEDED',
      })
      file.close()
    }
  })

  it('rejects unsupported encoding, invalid frame tables, and fractional crop geometry', async () => {
    const unsupported = await openGenerated({ streamEncoding: 'uint32' })
    await expect(inspectVeloxEmdSpectra(unsupported.file)).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
    })
    unsupported.file.close()

    for (const options of [
      { frameOffsets: [1n, 10n] },
      { frameOffsets: [0n, 17n] },
      { scanRight: '0.6' },
    ] as const) {
      const { file } = await openGenerated(options)
      await expect(inspectVeloxEmdSpectra(file)).rejects.toMatchObject({ code: 'INVALID_INPUT' })
      file.close()
    }
  })

  it('honors cancellation while indexing spectra', async () => {
    const { file } = await openGenerated()
    const controller = new AbortController()
    controller.abort(new Error('stop Velox spectrum inspection'))
    await expect(inspectVeloxEmdSpectra(file, { signal: controller.signal })).rejects.toThrow(
      'stop Velox spectrum inspection',
    )
    file.close()
  })

  it('bins only the selected point and native energy interval in bounded event blocks', async () => {
    const fixture = createGeneratedVeloxSpectrumFixture()
    const source = new CountingSource(fixture.bytes)
    const file = await openHdf5File(source)
    const inspection = await inspectVeloxEmdSpectra(file)
    const stream = inspection.spectrumStreams[0]
    if (stream === undefined) throw new Error('Generated Velox stream is unavailable')
    source.reads.length = 0

    const first = await readVeloxPointSpectrum(file, stream, {
      frame: 0,
      x: 0,
      y: 0,
      start: 1,
      length: 3,
      maxEventBlockEvents: 2,
    })
    expect(uint32Values(first.data)).toEqual([2, 0, 1])
    expect(first).toMatchObject({ start: 1, length: 3, scannedEvents: 4, eventReadOperations: 2 })
    expect(
      source.reads
        .filter(
          ({ offset, length }) =>
            offset < fixture.eventDataAddress + 34 && offset + length > fixture.eventDataAddress,
        )
        .reduce((sum, { length }) => sum + length, 0),
    ).toBeLessThanOrEqual(8)

    const empty = await readVeloxPointSpectrum(file, stream, { frame: 0, x: 1, y: 0 })
    expect(uint32Values(empty.data)).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
    const last = await readVeloxPointSpectrum(file, stream, { frame: 1, x: 1, y: 1 })
    expect(uint32Values(last.data)).toEqual([0, 0, 0, 0, 0, 0, 0, 1])
    file.close()
  })

  it('checks point selection, output, event, operation, channel, and count limits', async () => {
    const { file, stream } = await inspectStream()
    for (const request of [
      { frame: 2, x: 0, y: 0 },
      { frame: 0, x: 2, y: 0 },
      { frame: 0, x: 0, y: 0, start: 8, length: 1 },
    ] as const) {
      await expect(readVeloxPointSpectrum(file, stream, request)).rejects.toMatchObject({
        code: 'INVALID_INPUT',
      })
    }
    for (const request of [
      { frame: 0, x: 0, y: 0, maxSelectedFrameEvents: 9 },
      { frame: 0, x: 1, y: 0, maxEventBlockEvents: 2, maxEventReadOperations: 2 },
      { frame: 0, x: 0, y: 0, length: 3, maxOutputBytes: 11 },
      { frame: 0, x: 0, y: 0, maxCountPerBin: 1 },
    ] as const) {
      await expect(readVeloxPointSpectrum(file, stream, request)).rejects.toMatchObject({
        code: 'LIMIT_EXCEEDED',
      })
    }
    file.close()

    const invalidChannel = await inspectStream({ energyBins: 4 })
    await expect(
      readVeloxPointSpectrum(invalidChannel.file, invalidChannel.stream, {
        frame: 0,
        x: 1,
        y: 1,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    invalidChannel.file.close()
  })

  it('accepts a missing final gate only for the last pixel and checks cancellation', async () => {
    const missingFinal = await inspectStream({
      streamEvents: [65_535, 65_535, 65_535, 7],
      frameOffsets: [0n],
    })
    const result = await readVeloxPointSpectrum(missingFinal.file, missingFinal.stream, {
      frame: 0,
      x: 1,
      y: 1,
    })
    expect(uint32Values(result.data)).toEqual([0, 0, 0, 0, 0, 0, 0, 1])
    const missingMiddleGate = await inspectStream({
      streamEvents: [65_535, 65_535, 7],
      frameOffsets: [0n],
    })
    await expect(
      readVeloxPointSpectrum(missingMiddleGate.file, missingMiddleGate.stream, {
        frame: 0,
        x: 0,
        y: 1,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    missingMiddleGate.file.close()

    const controller = new AbortController()
    controller.abort(new Error('stop Velox point spectrum'))
    await expect(
      readVeloxPointSpectrum(missingFinal.file, missingFinal.stream, {
        frame: 0,
        x: 1,
        y: 1,
        signal: controller.signal,
      }),
    ).rejects.toThrow('stop Velox point spectrum')
    missingFinal.file.close()
  })
})
