import { describe, expect, it } from 'vitest'
import { rasterSampleBytes, type RasterSampleType } from '../src/raster.ts'
import { openMrc, type MrcMode } from '../src/scientific/formats/mrc.ts'
import { toScientificDataset } from '../src/scientific/dataset-adapters.ts'
import { readRasterSample, writeRasterSample } from '../src/scientific/samples.ts'
import type { ImageSource } from '../src/source.ts'

interface MrcFixtureOptions {
  readonly storedSize?: readonly [number, number, number]
  readonly mode?: MrcMode
  readonly littleEndian?: boolean
  readonly axes?: readonly [1 | 2 | 3, 1 | 2 | 3, 1 | 2 | 3]
  readonly extendedHeaderBytes?: number
  readonly labels?: readonly string[]
  readonly value?: (x: number, y: number, z: number) => number
}

const modeSampleType = (mode: MrcMode): RasterSampleType => {
  if (mode === 0) return 'int8'
  if (mode === 1) return 'int16'
  if (mode === 2) return 'float32'
  if (mode === 6) return 'uint16'
  return 'float16'
}

const fixture = (options: MrcFixtureOptions = {}): Uint8Array => {
  const storedSize = options.storedSize ?? [3, 2, 2]
  const mode = options.mode ?? 1
  const littleEndian = options.littleEndian ?? true
  const axes = options.axes ?? [1, 2, 3]
  const extendedHeaderBytes = options.extendedHeaderBytes ?? 0
  const labels = options.labels ?? []
  const sampleType = modeSampleType(mode)
  const bytesPerSample = rasterSampleBytes(sampleType)
  const sampleCount = storedSize[0] * storedSize[1] * storedSize[2]
  const output = new Uint8Array(1_024 + extendedHeaderBytes + sampleCount * bytesPerSample)
  const view = new DataView(output.buffer)
  const integer = (offset: number, value: number): void =>
    view.setInt32(offset, value, littleEndian)
  const real = (offset: number, value: number): void => view.setFloat32(offset, value, littleEndian)
  integer(0, storedSize[0])
  integer(4, storedSize[1])
  integer(8, storedSize[2])
  integer(12, mode)
  integer(16, -1)
  integer(20, 2)
  integer(24, 3)
  const logicalSizes = [0, 0, 0]
  logicalSizes[axes[0] - 1] = storedSize[0]
  logicalSizes[axes[1] - 1] = storedSize[1]
  logicalSizes[axes[2] - 1] = storedSize[2]
  integer(28, logicalSizes[0] ?? 1)
  integer(32, logicalSizes[1] ?? 1)
  integer(36, logicalSizes[2] ?? 1)
  real(40, 30)
  real(44, 40)
  real(48, 50)
  real(52, 90)
  real(56, 90)
  real(60, 90)
  integer(64, axes[0])
  integer(68, axes[1])
  integer(72, axes[2])
  real(76, -10)
  real(80, 200)
  real(84, 50)
  integer(88, 1)
  integer(92, extendedHeaderBytes)
  output.set(new TextEncoder().encode('TEST'), 104)
  integer(108, 20_141)
  real(196, 1.5)
  real(200, -2.5)
  real(204, 3.5)
  output.set(new TextEncoder().encode('MAP '), 208)
  output.set(littleEndian ? [0x44, 0x44, 0, 0] : [0x11, 0x11, 0, 0], 212)
  real(216, 4.25)
  integer(220, labels.length)
  labels.forEach((label, index) => {
    output.set(new TextEncoder().encode(label.slice(0, 80).padEnd(80, ' ')), 224 + index * 80)
  })
  output.fill(0xa5, 1_024, 1_024 + extendedHeaderBytes)
  const canonical = new Uint8Array(bytesPerSample)
  const canonicalView = new DataView(canonical.buffer)
  const value = options.value ?? ((x: number, y: number, z: number) => z * 100 + y * 10 + x)
  let sample = 0
  for (let section = 0; section < storedSize[2]; section += 1) {
    for (let row = 0; row < storedSize[1]; row += 1) {
      for (let column = 0; column < storedSize[0]; column += 1) {
        const logical = [0, 0, 0]
        logical[axes[0] - 1] = column
        logical[axes[1] - 1] = row
        logical[axes[2] - 1] = section
        writeRasterSample(
          canonicalView,
          0,
          sampleType,
          value(logical[0] ?? 0, logical[1] ?? 0, logical[2] ?? 0),
        )
        const target = 1_024 + extendedHeaderBytes + sample * bytesPerSample
        for (let byte = 0; byte < bytesPerSample; byte += 1) {
          output[target + byte] = littleEndian
            ? (canonical[bytesPerSample - byte - 1] ?? 0)
            : (canonical[byte] ?? 0)
        }
        sample += 1
      }
    }
  }
  return output
}

const collect = async (
  dataset: Awaited<ReturnType<typeof openMrc>>,
  request: {
    readonly z?: number
    readonly x?: number
    readonly y?: number
    readonly width?: number
    readonly height?: number
  } = {},
): Promise<number[]> => {
  const values: number[] = []
  for await (const block of dataset.readPlane({ z: request.z ?? 0, c: 0, t: 0, ...request })) {
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

class RecordingSource implements ImageSource {
  readonly size: number
  readonly reads: { readonly offset: number; readonly length: number }[] = []
  readonly #data: Uint8Array

  constructor(data: Uint8Array) {
    this.#data = data
    this.size = data.byteLength
  }

  async read(offset: number, length: number): Promise<Uint8Array> {
    this.reads.push({ offset, length })
    return this.#data.subarray(offset, offset + length)
  }
}

describe('MRC2014 and CCP4 scientific volumes', () => {
  it.each([
    [0, 'int8', [-3, 0, 7]],
    [1, 'int16', [-300, 0, 700]],
    [2, 'float32', [-1.5, 0.25, 7.75]],
    [6, 'uint16', [0, 40_000, 65_535]],
    [12, 'float16', [-1.5, 0.25, 7.75]],
  ] as const)('reads MODE %i as %s', async (mode, sampleType, expected) => {
    const dataset = await openMrc(
      fixture({
        storedSize: [3, 1, 1],
        mode,
        value: (x) => expected[x] ?? 0,
      }),
    )
    expect(dataset.sampleType).toBe(sampleType)
    const values = await collect(dataset)
    for (const [index, value] of expected.entries()) {
      expect(values[index]).toBeCloseTo(value, 3)
    }
  })

  it('handles big-endian data, selected Z planes, and bounded default-axis ROIs', async () => {
    const bytes = fixture({ storedSize: [8, 4, 3], mode: 1, littleEndian: false })
    const source = new RecordingSource(bytes)
    const dataset = await openMrc(source, { rowsPerBlock: 1 })
    const before = dataset.sourceBytesRead
    expect(await collect(dataset, { z: 2, x: 2, y: 1, width: 3, height: 2 })).toEqual([
      212, 213, 214, 222, 223, 224,
    ])
    expect(dataset.sourceBytesRead - before).toBe(12)
    expect(source.reads.length).toBeGreaterThan(0)
  })

  it('maps arbitrary stored axes to logical XYZ coordinates', async () => {
    const dataset = await openMrc(fixture({ storedSize: [2, 2, 3], axes: [2, 3, 1], mode: 2 }))
    expect([dataset.sizeX, dataset.sizeY, dataset.sizeZ]).toEqual([3, 2, 2])
    expect(await collect(dataset, { z: 1 })).toEqual([100, 101, 102, 110, 111, 112])
  })

  it('exposes voxel spacing, origin, header fields, labels, and skips the extended header', async () => {
    const dataset = await openMrc(
      fixture({ extendedHeaderBytes: 128, labels: ['first label', 'second label'] }),
    )
    expect(dataset.physicalSizeX).toEqual({ value: 10, unit: 'Å' })
    expect(dataset.physicalSizeY).toEqual({ value: 20, unit: 'Å' })
    expect(dataset.physicalSizeZ).toEqual({ value: 25, unit: 'Å' })
    expect([dataset.originX, dataset.originY, dataset.originZ]).toEqual([
      { value: 1.5, unit: 'Å' },
      { value: -2.5, unit: 'Å' },
      { value: 3.5, unit: 'Å' },
    ])
    expect(dataset.header).toMatchObject({
      NXSTART: -1,
      NYSTART: 2,
      NZSTART: 3,
      NSYMBT: 128,
      EXTTYP: 'TEST',
      NVERSION: 20_141,
      labels: ['first label', 'second label'],
    })
    expect((await collect(dataset)).slice(0, 3)).toEqual([0, 1, 2])

    const scientific = toScientificDataset(dataset, { semanticSingletonAxes: ['z'] })
    expect(
      scientific.descriptor.axes
        .filter(({ id }) => id === 'x' || id === 'y' || id === 'z')
        .map(({ id, unit, coordinates }) => ({ id, unit, coordinates })),
    ).toEqual([
      { id: 'x', unit: 'Å', coordinates: { type: 'linear', origin: 1.5, step: 10 } },
      { id: 'y', unit: 'Å', coordinates: { type: 'linear', origin: -2.5, step: 20 } },
      { id: 'z', unit: 'Å', coordinates: { type: 'linear', origin: 3.5, step: 25 } },
    ])
  })

  it('opens a two-dimensional image with sizeZ 1', async () => {
    const dataset = await openMrc(fixture({ storedSize: [3, 2, 1], mode: 6 }))
    expect([dataset.sizeX, dataset.sizeY, dataset.sizeZ]).toEqual([3, 2, 1])
    expect(await collect(dataset)).toEqual([0, 1, 2, 10, 11, 12])
  })

  it('rejects malformed headers, unsupported modes, truncation, and hostile sizes', async () => {
    const valid = fixture()
    await expect(openMrc(valid.subarray(0, 1_023))).rejects.toMatchObject({
      code: 'TRUNCATED_INPUT',
    })
    const signature = valid.slice()
    signature[208] = 0
    await expect(openMrc(signature)).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    const dimensions = valid.slice()
    new DataView(dimensions.buffer).setInt32(0, 0, true)
    await expect(openMrc(dimensions)).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    const mode = valid.slice()
    new DataView(mode.buffer).setInt32(12, 3, true)
    await expect(openMrc(mode)).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' })
    const axes = valid.slice()
    new DataView(axes.buffer).setInt32(68, 1, true)
    await expect(openMrc(axes)).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    const extended = valid.slice()
    new DataView(extended.buffer).setInt32(92, 2_000_000_000, true)
    await expect(openMrc(extended)).rejects.toMatchObject({ code: 'TRUNCATED_INPUT' })
    await expect(openMrc(valid.subarray(0, valid.byteLength - 1))).rejects.toMatchObject({
      code: 'TRUNCATED_INPUT',
    })
    await expect(openMrc(valid, { maxPixels: 2 })).rejects.toMatchObject({
      code: 'LIMIT_EXCEEDED',
    })
  })
})
