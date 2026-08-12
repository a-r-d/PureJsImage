import { describe, expect, it } from 'vitest'
import type { PixelBlock } from '../src/pixel.ts'
import type { RasterBlock } from '../src/raster.ts'
import type {
  MultidimensionalRasterDataset,
  RasterChannelInfo,
  RasterPlaneRequest,
} from '../src/scientific/dataset.ts'
import type {
  NormalizedScientificDatasetDescriptor,
  ScientificAxisDescriptor,
  ScientificDataset,
  ScientificPlaneReadRequest,
} from '../src/scientific/dataset-v2.ts'
import {
  normalizeScientificDatasetDescriptor,
  normalizeScientificPlaneReadRequest,
} from '../src/scientific/dataset-v2.ts'
import { measureScientificPlane, renderScientificPlane } from '../src/scientific/render.ts'
import {
  bandRatio,
  integrateSpectralRange,
  nearestSpectralChannel,
  renderSpectralBand,
  renderSpectralComposite,
} from '../src/scientific/spectral.ts'

class SyntheticDataset implements MultidimensionalRasterDataset {
  readonly sizeX: number
  readonly sizeY: number
  readonly sizeZ = 1
  readonly sizeC: number
  readonly sizeT = 1
  readonly sampleType = 'float32' as const
  readonly dimensionOrder = 'XYCZT'
  readonly channels: readonly RasterChannelInfo[]
  readonly noDataValue?: number
  readonly #values: Float32Array

  constructor(
    width: number,
    height: number,
    channels: readonly RasterChannelInfo[],
    values: Float32Array,
    noDataValue?: number,
  ) {
    this.sizeX = width
    this.sizeY = height
    this.sizeC = channels.length
    this.channels = channels
    this.#values = values
    if (noDataValue !== undefined) this.noDataValue = noDataValue
  }

  async *readPlane(request: Readonly<RasterPlaneRequest>): AsyncGenerator<RasterBlock> {
    const selected =
      request.c === undefined
        ? Array.from({ length: this.sizeC }, (_, index) => index)
        : typeof request.c === 'number'
          ? [request.c]
          : [...request.c]
    const x = request.x ?? 0
    const y = request.y ?? 0
    const width = request.width ?? this.sizeX - x
    const height = request.height ?? this.sizeY - y
    for (let localY = 0; localY < height; localY += 2) {
      const blockHeight = Math.min(2, height - localY)
      const stride = width * 4
      const planeStride = stride * blockHeight
      const data = new Uint8Array(planeStride * selected.length)
      const view = new DataView(data.buffer)
      for (let channel = 0; channel < selected.length; channel += 1) {
        const sourceChannel = selected[channel] ?? 0
        for (let row = 0; row < blockHeight; row += 1) {
          for (let column = 0; column < width; column += 1) {
            const source = (sourceChannel * this.sizeY + y + localY + row) * this.sizeX + x + column
            view.setFloat32(
              channel * planeStride + row * stride + column * 4,
              this.#values[source] ?? Number.NaN,
              false,
            )
          }
        }
      }
      yield {
        x,
        y: y + localY,
        width,
        height: blockHeight,
        stride,
        planeStride,
        format: { sampleType: 'float32', channels: selected.length, planar: true },
        data,
      }
    }
  }
}

class LabeledPlaneDataset implements ScientificDataset {
  readonly descriptor: NormalizedScientificDatasetDescriptor
  readonly requests: ScientificPlaneReadRequest[] = []

  constructor(axes: readonly ScientificAxisDescriptor[]) {
    this.descriptor = normalizeScientificDatasetDescriptor({
      schemaVersion: 2,
      axes,
      sampleType: 'float32',
      components: [{ id: 'value', kind: 'scalar', unit: 'counts' }],
      capabilities: { regionReads: true, resolutionLevels: false },
    })
  }

  async *readPlane(request: Readonly<ScientificPlaneReadRequest>): AsyncGenerator<RasterBlock> {
    const normalized = normalizeScientificPlaneReadRequest(this.descriptor, request)
    this.requests.push(normalized)
    const data = new Uint8Array(normalized.width * normalized.height * 4)
    const view = new DataView(data.buffer)
    for (let index = 0; index < normalized.width * normalized.height; index += 1) {
      view.setFloat32(index * 4, index + 1, false)
    }
    yield {
      x: normalized.x,
      y: normalized.y,
      width: normalized.width,
      height: normalized.height,
      stride: normalized.width * 4,
      format: { sampleType: 'float32', channels: 1, planar: false },
      data,
    }
  }
}

const labeledAxis = (
  id: string,
  kind: ScientificAxisDescriptor['kind'],
  length: number,
): ScientificAxisDescriptor => ({ id, kind, length, coordinates: { type: 'index' } })

class LabeledSpectralDataset implements ScientificDataset {
  readonly descriptor = normalizeScientificDatasetDescriptor({
    schemaVersion: 2,
    axes: [
      labeledAxis('x', 'space', 2),
      labeledAxis('y', 'space', 1),
      {
        id: 'energy',
        kind: 'spectral',
        length: 3,
        unit: 'nm',
        coordinates: { type: 'lookup', values: [450, 550, 650] },
      },
    ],
    sampleType: 'float32',
    components: [{ id: 'value', kind: 'scalar' }],
    capabilities: { regionReads: true, resolutionLevels: false },
  })

  async *readPlane(request: Readonly<ScientificPlaneReadRequest>): AsyncGenerator<RasterBlock> {
    const normalized = normalizeScientificPlaneReadRequest(this.descriptor, request)
    const energy = normalized.fixedIndices.find((fixed) => fixed.axisId === 'energy')?.index ?? 0
    const multiplier = 2 ** energy
    const data = new Uint8Array(normalized.width * normalized.height * 4)
    const view = new DataView(data.buffer)
    for (let index = 0; index < normalized.width * normalized.height; index += 1) {
      view.setFloat32(index * 4, (normalized.x + index + 1) * 2 * multiplier, false)
    }
    yield {
      x: normalized.x,
      y: normalized.y,
      width: normalized.width,
      height: normalized.height,
      stride: normalized.width * 4,
      format: { sampleType: 'float32', channels: 1, planar: false },
      data,
    }
  }
}

class ExclusiveReadDataset implements MultidimensionalRasterDataset {
  readonly sizeX: number
  readonly sizeY: number
  readonly sizeZ: number
  readonly sizeC: number
  readonly sizeT: number
  readonly sampleType: MultidimensionalRasterDataset['sampleType']
  readonly dimensionOrder: string
  readonly channels: readonly RasterChannelInfo[]
  #reading = false
  readonly #source: MultidimensionalRasterDataset

  constructor(source: MultidimensionalRasterDataset) {
    this.#source = source
    this.sizeX = source.sizeX
    this.sizeY = source.sizeY
    this.sizeZ = source.sizeZ
    this.sizeC = source.sizeC
    this.sizeT = source.sizeT
    this.sampleType = source.sampleType
    this.dimensionOrder = source.dimensionOrder
    this.channels = source.channels
  }

  async *readPlane(request: Readonly<RasterPlaneRequest>): AsyncGenerator<RasterBlock> {
    const iterator = this.#source.readPlane(request)[Symbol.asyncIterator]()
    while (true) {
      if (this.#reading) throw new Error('Concurrent source read')
      this.#reading = true
      let result: IteratorResult<RasterBlock>
      try {
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        result = await iterator.next()
      } finally {
        this.#reading = false
      }
      if (result.done) return
      yield result.value
    }
  }
}

const scalarDataset = (width: number, height: number, values: readonly number[], noData?: number) =>
  new SyntheticDataset(
    width,
    height,
    [{ name: 'Signal', samplesPerPixel: 1, unit: 'V' }],
    Float32Array.from(values),
    noData,
  )

const collectPixels = async (blocks: AsyncIterable<PixelBlock>): Promise<number[]> => {
  const values: number[] = []
  for await (const block of blocks) values.push(...block.data)
  return values
}

const collectFloat64 = async (dataset: MultidimensionalRasterDataset): Promise<number[]> => {
  const values: number[] = []
  for await (const block of dataset.readPlane({ z: 0, c: 0, t: 0 })) {
    const view = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength)
    for (let offset = 0; offset < block.data.byteLength; offset += 8) {
      values.push(view.getFloat64(offset, false))
    }
  }
  return values
}

const spectralDataset = (): SyntheticDataset => {
  const channels: RasterChannelInfo[] = [450, 550, 650].map((center, index) => ({
    id: `Band:${index + 1}`,
    name: `Band ${index + 1}`,
    samplesPerPixel: 1,
    spectral: { center, unit: 'nm', fwhm: 10 + index },
  }))
  return new SyntheticDataset(
    3,
    2,
    channels,
    Float32Array.from([
      0, 1, 2, 10, 11, 12, 100, 101, 102, 110, 111, 112, 200, 201, 202, 210, 211, 212,
    ]),
  )
}

describe('scientific display mapping', () => {
  it('uses the same measurement and rendering path for labeled XY, energy, and 4D-STEM planes', async () => {
    const cases = [
      {
        axes: [labeledAxis('x', 'space', 3), labeledAxis('y', 'space', 2)],
        displayAxes: ['x', 'y'] as const,
        fixedIndices: [],
      },
      {
        axes: [
          labeledAxis('x', 'space', 3),
          labeledAxis('y', 'space', 2),
          labeledAxis('energy', 'spectral', 4),
        ],
        displayAxes: ['x', 'y'] as const,
        fixedIndices: [{ axisId: 'energy', index: 2 }],
      },
      {
        axes: [
          labeledAxis('scanX', 'space', 3),
          labeledAxis('scanY', 'space', 2),
          labeledAxis('kx', 'reciprocal-space', 3),
          labeledAxis('ky', 'reciprocal-space', 2),
        ],
        displayAxes: ['kx', 'ky'] as const,
        fixedIndices: [
          { axisId: 'scanX', index: 1 },
          { axisId: 'scanY', index: 0 },
        ],
      },
      {
        axes: [
          labeledAxis('scanX', 'space', 3),
          labeledAxis('scanY', 'space', 2),
          labeledAxis('kx', 'reciprocal-space', 3),
          labeledAxis('ky', 'reciprocal-space', 2),
        ],
        displayAxes: ['scanX', 'scanY'] as const,
        fixedIndices: [
          { axisId: 'kx', index: 2 },
          { axisId: 'ky', index: 1 },
        ],
      },
    ]
    for (const fixture of cases) {
      const dataset = new LabeledPlaneDataset(fixture.axes)
      const plane = { displayAxes: fixture.displayAxes, fixedIndices: fixture.fixedIndices }
      const measurement = await measureScientificPlane(dataset, {
        plane,
        range: { mode: 'dataset' },
        statistics: { mean: true, histogram: { bins: 3 } },
      })
      expect(measurement).toMatchObject({
        range: { min: 1, max: 6 },
        finiteSamples: 6,
        mean: 3.5,
        selection: { displayAxes: fixture.displayAxes, fixedIndices: fixture.fixedIndices },
      })
      const rendered = await renderScientificPlane(dataset, {
        plane,
        range: { mode: 'explicit', min: 1, max: 6 },
      })
      const blocks: PixelBlock[] = []
      for await (const block of rendered.pixels) blocks.push(block)
      expect(blocks).toHaveLength(2)
      expect(blocks.every((block) => block.width === 3 && block.height === 1)).toBe(true)
    }
  })

  it('maps native scalar values without mutating NaN/Infinity source samples', async () => {
    const sourceValues = [0, 0.5, 1, Number.NaN, Number.POSITIVE_INFINITY, -1]
    const dataset = scalarDataset(3, 2, sourceValues)
    const rendered = await renderScientificPlane(dataset, {
      plane: { z: 0, c: 0, t: 0 },
      range: { mode: 'explicit', min: 0, max: 1 },
      palette: 'grayscale',
    })
    expect(await collectPixels(rendered.pixels)).toEqual([
      0, 0, 0, 128, 128, 128, 255, 255, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ])
    expect(sourceValues[3]).toBeNaN()
    expect(sourceValues[4]).toBe(Number.POSITIVE_INFINITY)
  })

  it('computes dataset and bounded approximate percentile ranges while excluding nodata', async () => {
    const values = Array.from({ length: 10_000 }, (_, index) => index)
    values[500] = -9_999
    values[501] = Number.NaN
    const dataset = scalarDataset(100, 100, values, -9_999)
    const datasetRange = await renderScientificPlane(dataset, {
      plane: { z: 0, c: 0, t: 0 },
      range: { mode: 'dataset' },
      palette: 'viridis',
      scale: 'asinh',
    })
    expect(datasetRange.range).toEqual({ min: 0, max: 9_999 })
    expect(datasetRange.finiteSamples).toBe(9_998)
    const percentile = await renderScientificPlane(dataset, {
      plane: { z: 0, c: 0, t: 0 },
      range: { mode: 'percentile', low: 10, high: 90, maxSamples: 64 },
      palette: 'magma',
      scale: 'log',
    })
    expect(percentile.sampledValues).toBeLessThanOrEqual(64)
    expect(percentile.range.min).toBeGreaterThan(0)
    expect(percentile.range.max).toBeLessThan(9_999)
  })

  it('measures a reusable range without consuming render pixels', async () => {
    const dataset = scalarDataset(4, 2, [0, 1, 2, 3, 4, 5, 6, 7])
    const measured = await measureScientificPlane(dataset, {
      plane: { z: 0, c: 0, t: 0 },
      x: 1,
      width: 2,
      range: { mode: 'dataset' },
    })
    expect(measured).toEqual({
      range: { min: 1, max: 6 },
      finiteSamples: 4,
      sampledValues: 0,
      roi: { x: 1, y: 0, width: 2, height: 2 },
      channel: 0,
    })
    const rendered = await renderScientificPlane(dataset, {
      plane: { z: 0, c: 0, t: 0 },
      x: measured.roi.x,
      width: measured.roi.width,
      range: { mode: 'explicit', ...measured.range },
      palette: 'grayscale',
    })
    expect(rendered.finiteSamples).toBe(0)
    expect(await collectPixels(rendered.pixels)).toHaveLength(12)
  })

  it('computes requested bounded statistics without collecting the complete value set', async () => {
    const dataset = scalarDataset(6, 1, [1, 2, 3, 4, Number.NaN, -9_999], -9_999)
    const measured = await measureScientificPlane(dataset, {
      plane: { z: 0, c: 0, t: 0 },
      range: { mode: 'dataset' },
      statistics: {
        mean: true,
        standardDeviation: true,
        invalidSamples: true,
        percentiles: [0, 50, 100],
        percentileMaxSamples: 8,
        histogram: { bins: 2, range: { min: 1, max: 5 } },
      },
    })
    expect(measured.mean).toBe(2.5)
    expect(measured.standardDeviation).toBeCloseTo(Math.sqrt(1.25))
    expect(measured.invalidSamples).toBe(2)
    expect(measured.percentiles).toEqual([
      { percentile: 0, value: 1 },
      { percentile: 50, value: 3 },
      { percentile: 100, value: 4 },
    ])
    expect([...(measured.histogram?.counts ?? new Uint32Array())]).toEqual([2, 2])
    expect(measured.histogram).toMatchObject({ underflow: 0, overflow: 0 })
  })

  it('renders deterministic row-bounded relief while retaining false color', async () => {
    const dataset = scalarDataset(3, 3, [0, 1, 2, 1, 2, 3, 2, 3, 4])
    const flat = await renderScientificPlane(dataset, {
      plane: { z: 0, c: 0, t: 0 },
      range: { mode: 'explicit', min: 0, max: 4 },
      palette: 'plasma',
    })
    const relief = await renderScientificPlane(dataset, {
      plane: { z: 0, c: 0, t: 0 },
      range: { mode: 'explicit', min: 0, max: 4 },
      palette: 'plasma',
      relief: { azimuth: 315, elevation: 45, strength: 0.8 },
    })
    const flatPixels = await collectPixels(flat.pixels)
    const reliefPixels = await collectPixels(relief.pixels)
    expect(reliefPixels).not.toEqual(flatPixels)
    expect(reliefPixels).toHaveLength(27)
    expect(await collectPixels(relief.pixels)).toEqual(reliefPixels)
  })
})

describe('hyperspectral helpers', () => {
  it('selects, renders, integrates, and ratios an explicit labeled spectral axis', async () => {
    const source = new LabeledSpectralDataset()
    expect(nearestSpectralChannel(source, 535, 'energy')).toEqual({
      requested: 535,
      channel: 1,
      selected: 550,
      unit: 'nm',
      axisId: 'energy',
    })
    const band = await renderSpectralBand(source, {
      wavelength: 535,
      spectralAxis: 'energy',
      plane: { displayAxes: ['x', 'y'], fixedIndices: [] },
      range: { mode: 'explicit', min: 0, max: 16 },
    })
    expect(band.image.selection.fixedIndices).toContainEqual({ axisId: 'energy', index: 1 })
    const composite = await renderSpectralComposite(source, {
      red: 650,
      green: 550,
      blue: 450,
      spectralAxis: 'energy',
      plane: { displayAxes: ['x', 'y'], fixedIndices: [] },
      range: { mode: 'explicit', min: 0, max: 16 },
    })
    const compositeBlocks: PixelBlock[] = []
    for await (const block of composite.pixels) compositeBlocks.push(block)
    expect(compositeBlocks).toHaveLength(1)

    const integrated = integrateSpectralRange(source, {
      spectralAxis: 'energy',
      from: 450,
      to: 650,
    })
    const ratio = bandRatio(source, {
      spectralAxis: 'energy',
      numerator: 650,
      denominator: 450,
    })
    const readDerived = async (dataset: ScientificDataset): Promise<number[]> => {
      const output: number[] = []
      for await (const block of dataset.readPlane({
        displayAxes: ['x', 'y'],
        fixedIndices: [],
      })) {
        const view = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength)
        for (let index = 0; index < block.width * block.height; index += 1) {
          output.push(view.getFloat64(index * 8, false))
        }
      }
      return output
    }
    expect(await readDerived(integrated)).toEqual([900, 1800])
    expect(await readDerived(ratio)).toEqual([4, 4])
  })

  it('selects and reports the nearest actual spectral channel', async () => {
    const dataset = spectralDataset()
    expect(nearestSpectralChannel(dataset, 575)).toEqual({
      requested: 575,
      channel: 1,
      selected: 550,
      unit: 'nm',
    })
    const result = await renderSpectralBand(dataset, {
      wavelength: 640,
      range: { mode: 'dataset' },
      palette: 'inferno',
    })
    expect(result.selection).toEqual({ requested: 640, channel: 2, selected: 650, unit: 'nm' })
    expect(await collectPixels(result.image.pixels)).toHaveLength(18)
  })

  it('renders a false-color composite from nearest wavelength channels', async () => {
    const composite = await renderSpectralComposite(spectralDataset(), {
      red: 660,
      green: 540,
      blue: 460,
      range: { mode: 'dataset' },
    })
    expect([composite.red.channel, composite.green.channel, composite.blue.channel]).toEqual([
      2, 1, 0,
    ])
    const pixels = await collectPixels(composite.pixels)
    expect(pixels).toHaveLength(18)
    expect(pixels.slice(0, 3)).toEqual([0, 0, 0])
    expect(pixels.slice(-3)).toEqual([255, 255, 255])
  })

  it('serializes composite reads for single-reader raster sources', async () => {
    const composite = await renderSpectralComposite(new ExclusiveReadDataset(spectralDataset()), {
      red: 650,
      green: 550,
      blue: 450,
      range: { mode: 'dataset' },
    })
    expect(await collectPixels(composite.pixels)).toHaveLength(18)
  })

  it('integrates spectral ranges and computes ratios as native float64 rasters', async () => {
    const dataset = spectralDataset()
    const integrated = integrateSpectralRange(dataset, { from: 440, to: 660 })
    expect(integrated.sourceChannels).toEqual([0, 1, 2])
    expect((await collectFloat64(integrated)).slice(0, 3)).toEqual([20_000, 20_200, 20_400])
    const ratio = bandRatio(dataset, { numerator: 645, denominator: 455 })
    const ratioValues = await collectFloat64(ratio)
    expect(Number.isNaN(ratioValues[0])).toBe(true)
    expect(ratioValues[1]).toBe(201)
    expect(ratioValues[2]).toBe(101)
  })

  it('propagates source no-data samples through spectral math', async () => {
    const channels: RasterChannelInfo[] = [500, 600].map((center) => ({
      samplesPerPixel: 1,
      spectral: { center, unit: 'nm' },
    }))
    const dataset = new SyntheticDataset(
      2,
      1,
      channels,
      Float32Array.from([1, -9_999, 2, 4]),
      -9_999,
    )
    const integrated = await collectFloat64(integrateSpectralRange(dataset, { from: 500, to: 600 }))
    const ratio = await collectFloat64(bandRatio(dataset, { numerator: 600, denominator: 500 }))
    expect(integrated[0]).toBe(150)
    expect(integrated[1]).toBeNaN()
    expect(ratio[0]).toBe(2)
    expect(ratio[1]).toBeNaN()
  })
})
