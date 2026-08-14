import { describe, expect, it } from 'vitest'

import { rasterSampleBytes } from '../src/raster.ts'
import {
  renderScientificPlane,
  ScientificReaderRegistry,
  sliceScientificVolume,
  type ScientificDataset,
} from '../src/scientific/index.ts'
import { cbfReader } from '../src/scientific/readers/cbf.ts'
import { encodeGsf, gsfReader } from '../src/scientific/readers/gsf.ts'
import { mrcReader } from '../src/scientific/readers/mrc.ts'
import { openGsf } from '../src/scientific/formats/gsf.ts'
import { readRasterSample } from '../src/scientific/samples.ts'
import { MemorySource, type ImageSource } from '../src/source.ts'

const mrcFixture = (extendedHeaderBytes = 0): Uint8Array => {
  const output = new Uint8Array(1_024 + extendedHeaderBytes + 8)
  const view = new DataView(output.buffer)
  const integer = (offset: number, value: number): void => view.setInt32(offset, value, true)
  const real = (offset: number, value: number): void => view.setFloat32(offset, value, true)
  integer(0, 2)
  integer(4, 2)
  integer(8, 1)
  integer(12, 1)
  integer(28, 2)
  integer(32, 2)
  integer(36, 1)
  real(40, 4)
  real(44, 6)
  real(48, 1)
  real(52, 90)
  real(56, 90)
  real(60, 90)
  integer(64, 1)
  integer(68, 2)
  integer(72, 3)
  integer(92, extendedHeaderBytes)
  output.set(new TextEncoder().encode('MAP '), 208)
  output.set([0x44, 0x44, 0, 0], 212)
  const values = [10, 20, 30, 40]
  values.forEach((value, index) => {
    view.setInt16(1_024 + extendedHeaderBytes + index * 2, value, true)
  })
  return output
}

const mrcVolumeFixture = (): Uint8Array => {
  const output = new Uint8Array(1_024 + 2 * 2 * 3 * 2)
  const view = new DataView(output.buffer)
  const integer = (offset: number, value: number): void => view.setInt32(offset, value, true)
  const real = (offset: number, value: number): void => view.setFloat32(offset, value, true)
  integer(0, 2)
  integer(4, 2)
  integer(8, 3)
  integer(12, 1)
  integer(28, 2)
  integer(32, 2)
  integer(36, 3)
  real(40, 2)
  real(44, 2)
  real(48, 3)
  real(52, 90)
  real(56, 90)
  real(60, 90)
  integer(64, 1)
  integer(68, 2)
  integer(72, 3)
  output.set(new TextEncoder().encode('MAP '), 208)
  output.set([0x44, 0x44, 0, 0], 212)
  for (let index = 0; index < 12; index += 1) {
    view.setInt16(1_024 + index * 2, index, true)
  }
  return output
}

const encodeByteOffset = (values: readonly number[]): Uint8Array => {
  const output: number[] = []
  let previous = 0
  for (const value of values) {
    const delta = value - previous
    previous = value
    if (delta < -127 || delta > 127) throw new Error('Test fixture delta is too large')
    output.push(delta & 0xff)
  }
  return Uint8Array.from(output)
}

const cbfFixture = (): Uint8Array => {
  const binary = encodeByteOffset([1, 3, 6, 10])
  const header = new TextEncoder().encode(`###CBF: VERSION 1.5
data_test
_diffrn_detector.detector 'TEST DETECTOR'
_array_data.data
;
--CIF-BINARY-FORMAT-SECTION--
Content-Type: application/octet-stream; conversions="x-CBF_BYTE_OFFSET"
Content-Transfer-Encoding: BINARY
X-Binary-Size: ${binary.byteLength}
X-Binary-ID: 1
X-Binary-Element-Type: "signed 32-bit integer"
X-Binary-Element-Byte-Order: LITTLE_ENDIAN
X-Binary-Number-of-Elements: 4
X-Binary-Size-Fastest-Dimension: 2
X-Binary-Size-Second-Dimension: 2
X-Binary-Size-Padding: 0

`)
  const marker = Uint8Array.of(0x0c, 0x1a, 0x04, 0xd5)
  const footer = new TextEncoder().encode('\n--CIF-BINARY-FORMAT-SECTION----\n;\n')
  const output = new Uint8Array(header.length + marker.length + binary.length + footer.length)
  output.set(header)
  output.set(marker, header.length)
  output.set(binary, header.length + marker.length)
  output.set(footer, header.length + marker.length + binary.length)
  return output
}

class RecordingSource implements ImageSource {
  readonly size: number
  readonly reads: { readonly offset: number; readonly length: number }[] = []
  readonly #bytes: Uint8Array

  constructor(bytes: Uint8Array) {
    this.#bytes = bytes
    this.size = bytes.byteLength
  }

  async read(offset: number, length: number): Promise<Uint8Array> {
    this.reads.push(Object.freeze({ offset, length }))
    return this.#bytes.subarray(offset, offset + length)
  }
}

const collect = async (dataset: ScientificDataset): Promise<number[]> => {
  const values: number[] = []
  const fixedIndices = dataset.descriptor.axes
    .filter(({ id }) => id !== 'x' && id !== 'y')
    .map(({ id }) => Object.freeze({ axisId: id, index: 0 }))
  for await (const block of dataset.readPlane({
    displayAxes: ['x', 'y'],
    fixedIndices,
  })) {
    const bytes = rasterSampleBytes(block.format.sampleType)
    const view = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength)
    for (let y = 0; y < block.height; y += 1) {
      for (let x = 0; x < block.width; x += 1) {
        values.push(
          readRasterSample(block.data, view, y * block.stride + x * bytes, block.format.sampleType),
        )
      }
    }
  }
  return values
}

const collectPlane = async (
  dataset: ScientificDataset,
  displayAxes: readonly [string, string],
  fixedIndices: readonly { readonly axisId: string; readonly index: number }[],
): Promise<number[]> => {
  const values: number[] = []
  for await (const block of dataset.readPlane({ displayAxes, fixedIndices })) {
    const bytes = rasterSampleBytes(block.format.sampleType)
    const view = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength)
    for (let y = 0; y < block.height; y += 1) {
      for (let x = 0; x < block.width; x += 1) {
        values.push(
          readRasterSample(block.data, view, y * block.stride + x * bytes, block.format.sampleType),
        )
      }
    }
  }
  return values
}

const registry = new ScientificReaderRegistry([gsfReader, mrcReader, cbfReader])

describe('first-party scientific reader adapters', () => {
  it.each([
    ['purejsimage/gsf', encodeGsf({ width: 2, height: 1, values: [1, 2] })],
    ['purejsimage/mrc', mrcFixture()],
    ['purejsimage/cbf', cbfFixture()],
  ] as const)('detects %s from bytes without an extension', async (id, bytes) => {
    await expect(
      registry.detect({ primary: { id: 'fixture', source: new MemorySource(bytes) } }),
    ).resolves.toMatchObject({ reader: { id } })
  })

  it('does not allow a misleading extension to override GSF bytes', async () => {
    const bytes = encodeGsf({ width: 1, height: 1, values: [9] })
    await expect(
      registry.detect({
        primary: { id: 'misleading', name: 'surface.mrc', source: new MemorySource(bytes) },
      }),
    ).resolves.toMatchObject({ reader: { id: 'purejsimage/gsf' }, confidence: 0.99 })
  })

  it('lists a stable typed MRC summary and stays lazy through openDataset', async () => {
    const source = new RecordingSource(mrcFixture(300_000))
    const document = await registry.open({
      primary: { id: 'mrc', source },
      readerId: 'purejsimage/mrc',
      readerVersion: '1.0.0',
    })
    expect(document.datasets).toHaveLength(1)
    expect(document.datasets[0]).toMatchObject({ id: 'volume' })
    expect(document.datasets[0]?.descriptor.metadata?.['purejsimage:mrc']).toMatchObject({
      mode: 1,
      header: { NX: 2, NY: 2, NZ: 1, cellDimensions: { x: 4, y: 6, z: 1 } },
    })
    const readsBeforeDataset = source.reads.length
    const dataset = await document.openDataset('volume')
    expect(source.reads).toHaveLength(readsBeforeDataset)
    expect(await collect(dataset)).toEqual([10, 20, 30, 40])
    expect(source.reads.length).toBeGreaterThan(readsBeforeDataset)
  })

  it('exposes real axes and bounded ordered MRC XY, XZ, and YZ planes', async () => {
    const document = await registry.open({
      primary: { id: 'mrc-volume', source: new MemorySource(mrcVolumeFixture()) },
      readerId: 'purejsimage/mrc',
    })
    const dataset = await document.openDataset('volume')
    expect(dataset.descriptor.axes.map(({ id }) => id)).toEqual(['x', 'y', 'z'])
    expect(dataset.descriptor.axes.map(({ id, calibration }) => ({ id, calibration }))).toEqual([
      {
        id: 'x',
        calibration: {
          kind: 'derived',
          resourceId: 'mrc-volume',
          locator: 'mrc:header:cellDimensions.x,MX,origin.x',
          formula: 'mrc-cell-dimension-per-sample-v1',
        },
      },
      {
        id: 'y',
        calibration: {
          kind: 'derived',
          resourceId: 'mrc-volume',
          locator: 'mrc:header:cellDimensions.y,MY,origin.y',
          formula: 'mrc-cell-dimension-per-sample-v1',
        },
      },
      {
        id: 'z',
        calibration: {
          kind: 'derived',
          resourceId: 'mrc-volume',
          locator: 'mrc:header:cellDimensions.z,MZ,origin.z',
          formula: 'mrc-cell-dimension-per-sample-v1',
        },
      },
    ])
    expect(dataset.descriptor.capabilities.planeReads).toEqual({
      kind: 'ordered-axis-pairs',
      pairs: [
        ['x', 'y'],
        ['x', 'z'],
        ['y', 'z'],
      ],
    })
    await expect(collectPlane(dataset, ['x', 'z'], [{ axisId: 'y', index: 1 }])).resolves.toEqual([
      2, 3, 6, 7, 10, 11,
    ])
    await expect(collectPlane(dataset, ['y', 'z'], [{ axisId: 'x', index: 1 }])).resolves.toEqual([
      1, 3, 5, 7, 9, 11,
    ])
    const yz = sliceScientificVolume(dataset, {
      displayAxes: ['y', 'z'],
      fixedIndices: [{ axisId: 'x', index: 1 }],
    })
    await expect(collectPlane(yz, ['y', 'z'], [])).resolves.toEqual([1, 3, 5, 7, 9, 11])
    const rendered = await renderScientificPlane(yz, {
      plane: { displayAxes: ['y', 'z'], fixedIndices: [] },
      range: { mode: 'percentile', low: 1, high: 99 },
    })
    for await (const block of rendered.pixels) block.release?.()
    await expect(collectPlane(dataset, ['z', 'x'], [{ axisId: 'y', index: 0 }])).rejects.toThrow(
      'does not support display axes z/x',
    )
  })

  it('preserves GSF values and CBF detector metadata through labeled datasets', async () => {
    const gsfBytes = encodeGsf({
      width: 2,
      height: 1,
      values: [1.25, -2.5],
      xyUnit: 'm',
      xReal: 4,
      yReal: 3,
      valueUnit: 'V',
    })
    const direct = await openGsf(gsfBytes)
    const directBlocks = []
    for await (const block of direct.readPlane({ z: 0, c: 0, t: 0 })) directBlocks.push(block)
    const gsfDocument = await registry.open({
      primary: { id: 'gsf', source: new MemorySource(gsfBytes) },
    })
    const gsfDataset = await gsfDocument.openDataset('surface')
    expect(gsfDataset.descriptor.axes.map(({ id }) => id)).toEqual(['x', 'y'])
    expect(await collect(gsfDataset)).toEqual([1.25, -2.5])
    expect(gsfDataset.descriptor.axes.find(({ id }) => id === 'x')).toMatchObject({
      coordinates: { type: 'linear', step: 2 },
      unit: 'm',
      calibration: {
        kind: 'derived',
        resourceId: 'gsf',
        locator: 'gsf:header:XReal,XRes,XOffset,XYUnits',
        formula: 'gsf-extent-per-sample-v1',
      },
    })
    expect(directBlocks).toHaveLength(1)

    const cbfDocument = await registry.open({
      primary: { id: 'cbf', source: new MemorySource(cbfFixture()) },
    })
    expect(cbfDocument.metadata).toMatchObject({
      detector: { detectorName: 'TEST DETECTOR' },
      elementType: 'signed 32-bit integer',
    })
    const cbfDataset = await cbfDocument.openDataset('detector-frame')
    expect(cbfDataset.descriptor.axes.map(({ id }) => id)).toEqual(['x', 'y'])
    expect(await collect(cbfDataset)).toEqual([1, 3, 6, 10])
  })

  it('retains existing error categories for explicit malformed opens', async () => {
    await expect(
      registry.open({
        primary: { id: 'short-mrc', source: new MemorySource(new Uint8Array(100)) },
        readerId: 'purejsimage/mrc',
        readerVersion: '1.0.0',
      }),
    ).rejects.toMatchObject({ code: 'TRUNCATED_INPUT' })

    const malformedCbf = new TextEncoder().encode('###CBF: VERSION 1.5\nno binary section')
    await expect(
      registry.open({
        primary: { id: 'bad-cbf', source: new MemorySource(malformedCbf) },
        readerId: 'purejsimage/cbf',
        readerVersion: '1.0.0',
      }),
    ).rejects.toMatchObject({ code: 'TRUNCATED_INPUT' })
  })

  it('propagates a scientific plane AbortSignal into an in-flight format source read', async () => {
    const bytes = mrcFixture(300_000)
    let payloadReadStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => {
      payloadReadStarted = resolve
    })
    const source: ImageSource = {
      size: bytes.byteLength,
      async read(offset, length, options) {
        if (offset + length <= 301_024) return bytes.subarray(offset, offset + length)
        payloadReadStarted?.()
        return new Promise<Uint8Array>((_resolve, reject) => {
          const signal = options?.signal
          if (signal === undefined) {
            reject(new Error('Expected the scientific read AbortSignal at the MRC source'))
            return
          }
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
      },
    }
    const document = await registry.open({
      primary: { id: 'cancellable-mrc', source },
      readerId: 'purejsimage/mrc',
      readerVersion: '1.0.0',
    })
    const dataset = await document.openDataset('volume')
    const controller = new AbortController()
    const reading = collectWithSignal(dataset, controller.signal)
    await started
    controller.abort(new Error('stop plane read'))
    await expect(reading).rejects.toThrow('stop plane read')
  })
})

const collectWithSignal = async (
  dataset: ScientificDataset,
  signal: AbortSignal,
): Promise<void> => {
  const fixedIndices = dataset.descriptor.axes
    .filter(({ id }) => id !== 'x' && id !== 'y')
    .map(({ id }) => Object.freeze({ axisId: id, index: 0 }))
  for await (const _block of dataset.readPlane({
    displayAxes: ['x', 'y'],
    fixedIndices,
    signal,
  })) {
    // Exhaust the read.
  }
}
