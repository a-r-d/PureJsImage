import { describe, expect, it } from 'vitest'
import { rasterSampleBytes, type RasterBlock, type RasterSampleType } from '../src/raster.ts'
import type {
  MultidimensionalRasterDataset,
  RasterChannelInfo,
  RasterPlaneRequest,
} from '../src/scientific/dataset.ts'
import { readRasterSample, writeRasterSample } from '../src/scientific/samples.ts'
import { projectScientificVolume, sliceScientificVolume } from '../src/scientific/volume.ts'

class VolumeDataset implements MultidimensionalRasterDataset {
  readonly sizeX: number
  readonly sizeY: number
  readonly sizeZ: number
  readonly sizeC = 1
  readonly sizeT = 1
  readonly sampleType: RasterSampleType
  readonly dimensionOrder = 'XYZCT'
  readonly channels: readonly RasterChannelInfo[] = Object.freeze([{ samplesPerPixel: 1 }])
  readonly physicalSizeX = Object.freeze({ value: 1, unit: 'µm' })
  readonly physicalSizeY = Object.freeze({ value: 2, unit: 'µm' })
  readonly physicalSizeZ = Object.freeze({ value: 3, unit: 'µm' })
  readonly noDataValue?: number
  readonly requests: RasterPlaneRequest[] = []
  readonly #values: readonly number[]

  constructor(
    width: number,
    height: number,
    depth: number,
    values: readonly number[],
    sampleType: RasterSampleType = 'float32',
    noDataValue?: number,
  ) {
    this.sizeX = width
    this.sizeY = height
    this.sizeZ = depth
    this.#values = values
    this.sampleType = sampleType
    if (noDataValue !== undefined) this.noDataValue = noDataValue
  }

  async *readPlane(request: Readonly<RasterPlaneRequest>): AsyncGenerator<RasterBlock> {
    this.requests.push(request)
    const x = request.x ?? 0
    const y = request.y ?? 0
    const width = request.width ?? this.sizeX - x
    const height = request.height ?? this.sizeY - y
    const bytes = rasterSampleBytes(this.sampleType)
    for (let localY = 0; localY < height; localY += 2) {
      const blockHeight = Math.min(2, height - localY)
      const output = new Uint8Array(width * blockHeight * bytes)
      const view = new DataView(output.buffer)
      for (let row = 0; row < blockHeight; row += 1) {
        for (let column = 0; column < width; column += 1) {
          const source = (request.z * this.sizeY + y + localY + row) * this.sizeX + x + column
          writeRasterSample(
            view,
            (row * width + column) * bytes,
            this.sampleType,
            this.#values[source] ?? Number.NaN,
          )
        }
      }
      yield {
        x,
        y: y + localY,
        width,
        height: blockHeight,
        stride: width * bytes,
        format: { sampleType: this.sampleType, channels: 1, planar: false },
        data: output,
      }
    }
  }
}

const collect = async (dataset: MultidimensionalRasterDataset): Promise<number[]> => {
  const values: number[] = []
  for await (const block of dataset.readPlane({ z: 0, c: 0, t: 0 })) {
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

describe('generic scientific volume operations', () => {
  it('extracts XY, XZ, and YZ slices with logical spacing and bounded source regions', async () => {
    const source = new VolumeDataset(3, 2, 2, [0, 1, 2, 3, 4, 5, 10, 11, 12, 13, 14, 15])
    const xy = sliceScientificVolume(source, { axis: 'xy', index: 1 })
    const xz = sliceScientificVolume(source, { axis: 'xz', index: 1 })
    const yz = sliceScientificVolume(source, { axis: 'yz', index: 2 })
    expect(await collect(xy)).toEqual([10, 11, 12, 13, 14, 15])
    expect(await collect(xz)).toEqual([3, 4, 5, 13, 14, 15])
    expect(await collect(yz)).toEqual([2, 5, 12, 15])
    expect([xz.sizeX, xz.sizeY, xz.physicalSizeX, xz.physicalSizeY]).toEqual([
      3,
      2,
      { value: 1, unit: 'µm' },
      { value: 3, unit: 'µm' },
    ])
    expect([yz.sizeX, yz.sizeY, yz.physicalSizeX, yz.physicalSizeY]).toEqual([
      2,
      2,
      { value: 2, unit: 'µm' },
      { value: 3, unit: 'µm' },
    ])
    expect(source.requests.some((request) => request.width === 1)).toBe(true)
    expect(
      source.requests.every((request) => request.height === undefined || request.height <= 2),
    ).toBe(true)
  })

  it('computes max, min, and float64 mean Z projections in output-row blocks', async () => {
    const source = new VolumeDataset(3, 2, 2, [0, 1, 2, 3, 4, 5, 10, 11, 12, 13, 14, 15], 'int16')
    const maximum = projectScientificVolume(source, { mode: 'max', rowsPerBlock: 1 })
    const minimum = projectScientificVolume(source, { mode: 'min', rowsPerBlock: 1 })
    const mean = projectScientificVolume(source, { mode: 'mean', rowsPerBlock: 1 })
    expect(maximum.sampleType).toBe('float64')
    expect(minimum.sampleType).toBe('float64')
    expect(await collect(maximum)).toEqual([10, 11, 12, 13, 14, 15])
    expect(await collect(minimum)).toEqual([0, 1, 2, 3, 4, 5])
    expect(mean.sampleType).toBe('float64')
    expect(await collect(mean)).toEqual([5, 6, 7, 8, 9, 10])
    expect(source.requests.every((request) => request.height === 1)).toBe(true)
  })

  it('ignores NaN, infinity, and no-data values and emits NaN with no valid sample', async () => {
    const source = new VolumeDataset(
      2,
      1,
      3,
      [Number.NaN, -999, 5, Number.POSITIVE_INFINITY, 7, -999],
      'float32',
      -999,
    )
    const maximum = await collect(projectScientificVolume(source, { mode: 'max' }))
    const mean = await collect(projectScientificVolume(source, { mode: 'mean' }))
    expect(maximum[0]).toBe(7)
    expect(maximum[1]).toBeNaN()
    expect(mean[0]).toBe(6)
    expect(mean[1]).toBeNaN()
  })

  it('supports degenerate 1x1x1 volumes and rejects invalid coordinates', async () => {
    const source = new VolumeDataset(1, 1, 1, [42])
    expect(await collect(sliceScientificVolume(source, { axis: 'yz', index: 0 }))).toEqual([42])
    expect(await collect(projectScientificVolume(source, { mode: 'mean' }))).toEqual([42])
    expect(() => sliceScientificVolume(source, { axis: 'xz', index: 1 })).toThrowError(
      expect.objectContaining({ code: 'INVALID_INPUT' }),
    )
  })
})
