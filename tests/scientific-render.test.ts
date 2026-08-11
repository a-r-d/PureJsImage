import { describe, expect, it } from 'vitest'
import type { PixelBlock } from '../src/pixel.ts'
import type { RasterBlock } from '../src/raster.ts'
import type {
  MultidimensionalRasterDataset,
  RasterChannelInfo,
  RasterPlaneRequest,
} from '../src/scientific/dataset.ts'
import { renderScientificPlane } from '../src/scientific/render.ts'
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
})
