import { describe, expect, it, vi } from 'vitest'
import {
  measureScientificPlaneWithResults,
  scientificPlaneMeasurementToResult,
  summarizeResult,
} from '../src/analysis/index.ts'
import type { ResultCollection } from '../src/analysis/index.ts'
import type { RasterBlock } from '../src/raster.ts'
import type {
  MultidimensionalRasterDataset,
  RasterPlaneRequest,
} from '../src/scientific/legacy-dataset.ts'
import { toScientificDataset } from '../src/scientific/dataset-adapters.ts'

class CountingDataset implements MultidimensionalRasterDataset {
  readonly sizeX: number
  readonly sizeY = 1
  readonly sizeZ = 1
  readonly sizeC = 1
  readonly sizeT = 1
  readonly sampleType = 'float32' as const
  readonly dimensionOrder = 'XYZCT'
  readonly channels = Object.freeze([{ name: 'temperature', unit: 'K', samplesPerPixel: 1 }])
  readonly noDataValue = -9_999
  readonly reads = vi.fn()
  readonly releases = vi.fn()
  readonly #values: readonly number[]

  constructor(values: readonly number[]) {
    this.#values = values
    this.sizeX = values.length
  }

  async *readPlane(request: Readonly<RasterPlaneRequest>): AsyncGenerator<RasterBlock> {
    request.signal?.throwIfAborted()
    this.reads()
    const data = new Uint8Array(this.#values.length * 4)
    const view = new DataView(data.buffer)
    for (let index = 0; index < this.#values.length; index += 1) {
      view.setFloat32(index * 4, this.#values[index] ?? Number.NaN, false)
    }
    yield {
      x: 0,
      y: 0,
      width: this.#values.length,
      height: 1,
      stride: data.byteLength,
      format: { sampleType: 'float32', channels: 1, planar: false },
      data,
      release: this.releases,
    }
  }
}

const entry = (collection: ResultCollection, name: string) =>
  collection.results.find((candidate) => candidate.name === name)?.result

describe('scientific measurement result adapter', () => {
  it('returns measurement and result semantics from one execution', async () => {
    const source = new CountingDataset([1, 2, 3, 4, Number.NaN, -9_999])
    const analysis = await measureScientificPlaneWithResults(toScientificDataset(source), {
      plane: { displayAxes: ['x', 'y'], fixedIndices: [] },
      range: { mode: 'explicit', min: 1, max: 5 },
      statistics: {
        mean: true,
        standardDeviation: true,
        invalidSamples: true,
        percentiles: [0, 50, 100],
        percentileMaxSamples: 8,
        histogram: { bins: 2 },
      },
    })

    expect(source.reads).toHaveBeenCalledTimes(1)
    expect(source.releases).toHaveBeenCalledTimes(1)
    expect(analysis.measurement).toMatchObject({
      mean: 2.5,
      invalidSamples: 2,
      range: { min: 1, max: 5 },
    })
    expect(analysis.measurement.standardDeviation).toBeCloseTo(Math.sqrt(1.25))
    expect(analysis.measurement.percentiles).toEqual([
      { percentile: 0, value: 1 },
      { percentile: 50, value: 3 },
      { percentile: 100, value: 4 },
    ])
    expect(analysis.measurement.histogram?.binEdges).toEqual(new Float64Array([1, 3, 5]))
    expect(analysis.measurement.histogram?.counts).toEqual(new Float64Array([2, 2]))

    expect(entry(analysis.result, 'mean')).toMatchObject({ kind: 'scalar', value: 2.5, unit: 'K' })
    expect(entry(analysis.result, 'percentiles')).toMatchObject({
      kind: 'profile',
      axis: { unit: '%' },
    })
    const histogram = entry(analysis.result, 'histogram')
    expect(histogram).toMatchObject({ kind: 'histogram', unit: 'K' })
    if (histogram?.kind !== 'histogram') throw new Error('Missing histogram result')
    expect(histogram.counts).toBe(analysis.measurement.histogram?.counts)
    expect(histogram.binEdges).toBe(analysis.measurement.histogram?.binEdges)
    expect(JSON.parse(JSON.stringify(summarizeResult(analysis.result)))).toBeDefined()
  })

  it('adapts a measurement without source access and allows an explicit unit override', async () => {
    const source = new CountingDataset([2, 4])
    const analysis = await measureScientificPlaneWithResults(toScientificDataset(source), {
      plane: { displayAxes: ['x', 'y'], fixedIndices: [] },
      range: { mode: 'dataset' },
    })
    const reads = source.reads.mock.calls.length
    const adapted = scientificPlaneMeasurementToResult(analysis.measurement, { unit: 'counts' })
    expect(source.reads).toHaveBeenCalledTimes(reads)
    expect(entry(adapted, 'rangeMinimum')).toMatchObject({ value: 2, unit: 'counts' })
  })

  it('propagates cancellation before source work begins', async () => {
    const source = new CountingDataset([1, 2, 3])
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    await expect(
      measureScientificPlaneWithResults(toScientificDataset(source), {
        plane: { displayAxes: ['x', 'y'], fixedIndices: [], signal: controller.signal },
        range: { mode: 'dataset' },
      }),
    ).rejects.toThrow('cancelled')
    expect(source.reads).not.toHaveBeenCalled()
    expect(source.releases).not.toHaveBeenCalled()
  })
})
