import { describe, expect, it } from 'vitest'

import type { RasterBlock, RasterSampleType } from '../src/raster.ts'
import { rasterSampleBytes } from '../src/raster.ts'
import type {
  DirectNumericTileDataset,
  NormalizedScientificDatasetDescriptor,
  NumericArray,
  NumericTile,
  NumericTileReadRequest,
  NumericTileSource,
  ScientificDataset,
  ScientificPlaneReadRequest,
} from '../src/scientific/index.ts'
import {
  measureScientificPlane,
  normalizeScientificDatasetDescriptor,
  normalizeScientificPlaneReadRequest,
  numericTileSampleOffset,
  rasterBlockToNumericTile,
  renderScientificPlane,
  resolveNumericTileSource,
  scientificDatasetToNumericTileSource,
  validateNumericTile,
  writeRasterBigIntSample,
} from '../src/scientific/index.ts'

const descriptorFor = (
  sampleType: RasterSampleType = 'uint16',
  componentCount = 1,
): NormalizedScientificDatasetDescriptor =>
  normalizeScientificDatasetDescriptor({
    schemaVersion: 1,
    axes: [
      { id: 'x', kind: 'space', length: 4, coordinates: { type: 'index' } },
      { id: 'y', kind: 'space', length: 3, coordinates: { type: 'index' } },
    ],
    sampleType,
    components: Array.from({ length: componentCount }, (_, index) => ({
      id: `component-${index}`,
      kind: 'scalar' as const,
    })),
    capabilities: {
      regionReads: true,
      resolutionLevels: false,
      planeReads: { kind: 'any-axis-pair' },
    },
  })

const writeCanonical = (
  view: DataView,
  offset: number,
  sampleType: RasterSampleType,
  value: number | bigint,
): void => {
  if (sampleType === 'uint8') view.setUint8(offset, Number(value))
  else if (sampleType === 'uint16') view.setUint16(offset, Number(value), false)
  else if (sampleType === 'uint32') view.setUint32(offset, Number(value), false)
  else if (sampleType === 'uint64') view.setBigUint64(offset, BigInt(value), false)
  else if (sampleType === 'int8') view.setInt8(offset, Number(value))
  else if (sampleType === 'int16') view.setInt16(offset, Number(value), false)
  else if (sampleType === 'int32') view.setInt32(offset, Number(value), false)
  else if (sampleType === 'int64') view.setBigInt64(offset, BigInt(value), false)
  else if (sampleType === 'float16') view.setUint16(offset, Number(value), false)
  else if (sampleType === 'float32') view.setFloat32(offset, Number(value), false)
  else view.setFloat64(offset, Number(value), false)
}

const blockFor = (
  sampleType: RasterSampleType,
  values: readonly (number | bigint)[],
  options: {
    readonly width?: number
    readonly height?: number
    readonly components?: number
    readonly planar?: boolean
    readonly rowPaddingBytes?: number
    readonly planePaddingBytes?: number
    readonly prefixBytes?: number
    readonly release?: () => void
  } = {},
): RasterBlock => {
  const width = options.width ?? values.length
  const height = options.height ?? 1
  const components = options.components ?? 1
  const planar = options.planar ?? false
  const bytes = rasterSampleBytes(sampleType)
  const rowBytes = width * bytes * (planar ? 1 : components)
  const stride = rowBytes + (options.rowPaddingBytes ?? 0)
  const occupiedPlane = stride * (height - 1) + rowBytes
  const planeStride = occupiedPlane + (options.planePaddingBytes ?? 0)
  const required = planar ? planeStride * (components - 1) + occupiedPlane : occupiedPlane
  const prefix = options.prefixBytes ?? 0
  const backing = new Uint8Array(prefix + required + 3)
  backing.fill(0xa5)
  const data = backing.subarray(prefix, prefix + required)
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let valueIndex = 0
  for (let component = 0; component < components; component += 1) {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = planar
          ? component * planeStride + y * stride + x * bytes
          : y * stride + (x * components + component) * bytes
        const value = values[valueIndex]
        if (value === undefined) throw new Error('Synthetic block does not contain enough values')
        writeCanonical(view, offset, sampleType, value)
        valueIndex += 1
      }
    }
  }
  return {
    x: 2,
    y: 3,
    width,
    height,
    stride,
    ...(planar ? { planeStride } : {}),
    format: { sampleType, channels: components, planar },
    data,
    ...(options.release === undefined ? {} : { release: options.release }),
  }
}

const tileValues = (tile: NumericTile): readonly (number | bigint)[] => {
  const values: (number | bigint)[] = []
  for (let component = 0; component < tile.componentCount; component += 1) {
    for (let y = 0; y < tile.height; y += 1) {
      for (let x = 0; x < tile.width; x += 1) {
        const value = tile.data[numericTileSampleOffset(tile, x, y, component)]
        if (value === undefined) throw new Error('Synthetic tile is truncated')
        values.push(value)
      }
    }
  }
  return values
}

const arrayName = (array: NumericArray): string => array.constructor.name

describe('RasterBlock to NumericTile conversion', () => {
  const cases: readonly {
    readonly sampleType: RasterSampleType
    readonly values: readonly (number | bigint)[]
    readonly array: string
    readonly output: readonly (number | bigint)[]
  }[] = [
    { sampleType: 'uint8', values: [0, 255], array: 'Uint8Array', output: [0, 255] },
    { sampleType: 'uint16', values: [1, 65535], array: 'Uint16Array', output: [1, 65535] },
    {
      sampleType: 'uint32',
      values: [1, 4_294_967_295],
      array: 'Uint32Array',
      output: [1, 4_294_967_295],
    },
    {
      sampleType: 'uint64',
      values: [1n, 9_007_199_254_740_993n],
      array: 'BigUint64Array',
      output: [1n, 9_007_199_254_740_993n],
    },
    { sampleType: 'int8', values: [-128, 127], array: 'Int8Array', output: [-128, 127] },
    { sampleType: 'int16', values: [-32768, 32767], array: 'Int16Array', output: [-32768, 32767] },
    {
      sampleType: 'int32',
      values: [-2_147_483_648, 2_147_483_647],
      array: 'Int32Array',
      output: [-2_147_483_648, 2_147_483_647],
    },
    {
      sampleType: 'int64',
      values: [-(1n << 63n), (1n << 63n) - 1n],
      array: 'BigInt64Array',
      output: [-(1n << 63n), (1n << 63n) - 1n],
    },
    {
      sampleType: 'float16',
      values: [0x3e00, 0x0001, 0x7c00, 0xfc00],
      array: 'Float32Array',
      output: [1.5, 2 ** -24, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY],
    },
    {
      sampleType: 'float32',
      values: [1.5, -2.25],
      array: 'Float32Array',
      output: [1.5, -2.25],
    },
    {
      sampleType: 'float64',
      values: [Math.PI, Number.MIN_VALUE],
      array: 'Float64Array',
      output: [Math.PI, Number.MIN_VALUE],
    },
  ]

  for (const testCase of cases) {
    it(`converts canonical ${testCase.sampleType} to native ${testCase.array}`, () => {
      const tile = rasterBlockToNumericTile(blockFor(testCase.sampleType, testCase.values))
      expect(arrayName(tile.data)).toBe(testCase.array)
      expect(tile.sampleType).toBe(
        testCase.sampleType === 'float16' ? 'float32' : testCase.sampleType,
      )
      expect(tileValues(tile)).toEqual(testCase.output)
      tile.release()
    })
  }

  it('preserves NaN and signed zero while promoting float16', () => {
    const tile = rasterBlockToNumericTile(blockFor('float16', [0x7e00, 0x8000]))
    const values = tileValues(tile)
    expect(Number.isNaN(values[0])).toBe(true)
    expect(Object.is(values[1], -0)).toBe(true)
  })

  it('uses a zero-copy view for byte-sized preserved samples and releases once', () => {
    let releases = 0
    const uint8Block = blockFor('uint8', [1, 2], { release: () => (releases += 1) })
    const uint8 = rasterBlockToNumericTile(uint8Block)
    expect(uint8.data.buffer).toBe(uint8Block.data.buffer)
    expect(uint8.data.byteOffset).toBe(uint8Block.data.byteOffset)
    expect(releases).toBe(0)
    uint8.release()
    uint8.release()
    expect(releases).toBe(1)

    const int8Block = blockFor('int8', [-1, 2], { prefixBytes: 3 })
    const int8 = rasterBlockToNumericTile(int8Block)
    expect(int8.data).toBeInstanceOf(Int8Array)
    expect(int8.data.buffer).toBe(int8Block.data.buffer)
    expect(int8.data.byteOffset).toBe(int8Block.data.byteOffset)
  })

  it('honors interleaved row padding and a non-zero subarray offset', () => {
    const tile = rasterBlockToNumericTile(
      blockFor('uint16', [1, 2, 3, 4, 5, 6, 7, 8], {
        width: 2,
        height: 2,
        components: 2,
        rowPaddingBytes: 4,
        prefixBytes: 5,
      }),
    )
    expect(tile.layout).toBe('interleaved')
    expect(tile.rowStrideElements).toBe(6)
    expect(tileValues(tile)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('honors planar row and plane padding', () => {
    const tile = rasterBlockToNumericTile(
      blockFor('int16', [1, 2, 3, 4, -1, -2, -3, -4], {
        width: 2,
        height: 2,
        components: 2,
        planar: true,
        rowPaddingBytes: 2,
        planePaddingBytes: 4,
      }),
    )
    expect(tile.layout).toBe('planar')
    expect(tile.rowStrideElements).toBe(3)
    expect(tile.planeStrideElements).toBe(7)
    expect(tileValues(tile)).toEqual([1, 2, 3, 4, -1, -2, -3, -4])
  })

  it('packs values safely when byte padding cannot become an element stride', () => {
    const tile = rasterBlockToNumericTile(
      blockFor('uint16', [1, 2, 3, 4], { width: 2, height: 2, rowPaddingBytes: 1 }),
    )
    expect(tile.rowStrideElements).toBe(2)
    expect(tileValues(tile)).toEqual([1, 2, 3, 4])
  })

  it('performs checked target conversion and refuses precision loss', () => {
    const float64 = rasterBlockToNumericTile(blockFor('uint16', [1, 65535]), {
      targetSampleType: 'float64',
    })
    expect(float64.data).toBeInstanceOf(Float64Array)
    expect(tileValues(float64)).toEqual([1, 65535])
    expect(() =>
      rasterBlockToNumericTile(blockFor('uint16', [257]), { targetSampleType: 'uint8' }),
    ).toThrow(/outside uint8/)
    expect(() =>
      rasterBlockToNumericTile(blockFor('uint64', [9_007_199_254_740_993n]), {
        targetSampleType: 'float64',
      }),
    ).toThrow(/cannot be represented exactly/)
    expect(() =>
      rasterBlockToNumericTile(blockFor('int64', [-1n]), { targetSampleType: 'uint64' }),
    ).toThrow(/outside uint64/)
    expect(() =>
      rasterBlockToNumericTile(blockFor('float64', [0.1]), { targetSampleType: 'float32' }),
    ).toThrow(/cannot be represented exactly/)
  })

  it('writes exact 64-bit integers without modulo wrapping', () => {
    const bytes = new Uint8Array(16)
    const view = new DataView(bytes.buffer)
    writeRasterBigIntSample(view, 0, 'int64', -(1n << 63n))
    writeRasterBigIntSample(view, 8, 'uint64', (1n << 64n) - 1n)
    expect(view.getBigInt64(0, false)).toBe(-(1n << 63n))
    expect(view.getBigUint64(8, false)).toBe((1n << 64n) - 1n)
    expect(() => writeRasterBigIntSample(view, 0, 'int64', 1n << 63n)).toThrow('outside int64')
    expect(() => writeRasterBigIntSample(view, 0, 'uint64', -1n)).toThrow('outside uint64')
  })

  it('uses caller-owned destination storage and an explicit allocator', () => {
    let sourceReleases = 0
    const destination = new Uint16Array(8)
    const reused = rasterBlockToNumericTile(
      blockFor('uint16', [7, 8], { release: () => (sourceReleases += 1) }),
      { destination },
    )
    expect(reused.data).toBe(destination)
    expect(sourceReleases).toBe(1)

    let storageReleases = 0
    const allocated = rasterBlockToNumericTile(blockFor('uint32', [9, 10]), {
      allocator: {
        allocate({ minimumElements, sampleType }) {
          expect(sampleType).toBe('uint32')
          return {
            data: new Uint32Array(minimumElements + 4),
            release: () => (storageReleases += 1),
          }
        },
      },
    })
    allocated.release()
    allocated.release()
    expect(storageReleases).toBe(1)
  })

  it('releases source and allocated storage once on validation or conversion errors', () => {
    let sourceReleases = 0
    let storageReleases = 0
    expect(() =>
      rasterBlockToNumericTile(
        blockFor('uint16', [500], { release: () => (sourceReleases += 1) }),
        {
          targetSampleType: 'uint8',
          allocator: {
            allocate() {
              return {
                data: new Uint8Array(1),
                release: () => (storageReleases += 1),
              }
            },
          },
        },
      ),
    ).toThrow()
    expect(sourceReleases).toBe(1)
    expect(storageReleases).toBe(1)
  })

  it('rejects invalid and truncated blocks', () => {
    const valid = blockFor('uint16', [1, 2])
    expect(() => rasterBlockToNumericTile({ ...valid, width: 0 })).toThrow(/invalid dimensions/)
    expect(() => rasterBlockToNumericTile({ ...valid, stride: 1 })).toThrow(/row stride/)
    expect(() => rasterBlockToNumericTile({ ...valid, data: valid.data.subarray(0, 3) })).toThrow(
      /truncated/,
    )
    expect(() =>
      validateNumericTile({
        x: 0,
        y: 0,
        width: 2,
        height: 1,
        sampleType: 'uint16',
        componentCount: 1,
        layout: 'interleaved',
        rowStrideElements: 2,
        data: new Uint16Array(1),
        release() {},
      }),
    ).toThrow(/truncated/)
  })

  it('checks cancellation before conversion and releases exactly once', () => {
    const controller = new AbortController()
    controller.abort(new Error('stop'))
    let releases = 0
    expect(() =>
      rasterBlockToNumericTile(blockFor('uint16', [1], { release: () => (releases += 1) }), {
        signal: controller.signal,
      }),
    ).toThrow('stop')
    expect(releases).toBe(1)
  })
})

class SyntheticDataset implements ScientificDataset {
  readonly descriptor: NormalizedScientificDatasetDescriptor
  reads = 0
  releases = 0

  constructor(sampleType: RasterSampleType = 'uint16') {
    this.descriptor = descriptorFor(sampleType)
  }

  async *readPlane(request: Readonly<ScientificPlaneReadRequest>): AsyncGenerator<RasterBlock> {
    const normalized = normalizeScientificPlaneReadRequest(this.descriptor, request)
    this.reads += 1
    const values = Array.from(
      { length: normalized.width * normalized.height },
      (_, index) => index + 1,
    )
    const block = blockFor(this.descriptor.sampleType, values, {
      width: normalized.width,
      height: normalized.height,
      release: () => (this.releases += 1),
    })
    yield { ...block, x: normalized.x, y: normalized.y }
  }
}

const request: NumericTileReadRequest = {
  displayAxes: ['x', 'y'],
  fixedIndices: [],
  x: 1,
  y: 1,
  width: 2,
  height: 2,
}

const firstTile = async (
  source: NumericTileSource,
  tileRequest: Readonly<NumericTileReadRequest> = request,
): Promise<NumericTile> => {
  for await (const tile of source.readNumericTiles(tileRequest)) return tile
  throw new Error('Synthetic tile source emitted no tile')
}

describe('NumericTileSource bridge and direct capability', () => {
  it('adapts lazy bounded dataset reads and propagates release', async () => {
    const dataset = new SyntheticDataset()
    const source = scientificDatasetToNumericTileSource(dataset)
    expect(dataset.reads).toBe(0)
    const tile = await firstTile(source)
    expect(dataset.reads).toBe(1)
    expect(tile.x).toBe(1)
    expect(tile.y).toBe(1)
    expect(tile.width).toBe(2)
    expect(tile.height).toBe(2)
    expect(tileValues(tile)).toEqual([1, 2, 3, 4])
    expect(dataset.releases).toBe(1)
    tile.release()
  })

  it('propagates cancellation without reading source pixels', async () => {
    const dataset = new SyntheticDataset()
    const controller = new AbortController()
    controller.abort(new Error('cancel tiles'))
    await expect(
      firstTile(scientificDatasetToNumericTileSource(dataset), {
        ...request,
        signal: controller.signal,
      }),
    ).rejects.toThrow('cancel tiles')
    expect(dataset.reads).toBe(0)
  })

  it('selects an exact direct source and matches fallback values and metadata', async () => {
    const fallbackDataset = new SyntheticDataset()
    let directReads = 0
    const directSource: NumericTileSource = {
      descriptor: fallbackDataset.descriptor,
      directSemantics: {
        sourceSampleType: 'uint16',
        nativeSampleType: 'uint16',
        componentCount: 1,
        layout: 'interleaved',
        supportedTargetSampleTypes: ['uint16'],
      },
      async *readNumericTiles(tileRequest) {
        directReads += 1
        const normalized = normalizeScientificPlaneReadRequest(this.descriptor, tileRequest)
        yield {
          x: normalized.x,
          y: normalized.y,
          width: normalized.width,
          height: normalized.height,
          sampleType: 'uint16',
          componentCount: 1,
          layout: 'interleaved',
          rowStrideElements: normalized.width,
          data: Uint16Array.of(1, 2, 3, 4),
          release() {},
        }
      },
    }
    const directDataset: DirectNumericTileDataset = Object.assign(fallbackDataset, {
      numericTileSource: directSource,
    })
    const selected = resolveNumericTileSource(directDataset)
    const directTile = await firstTile(selected)
    const fallbackTile = await firstTile(scientificDatasetToNumericTileSource(fallbackDataset))
    expect(directReads).toBe(1)
    expect({
      x: directTile.x,
      y: directTile.y,
      width: directTile.width,
      height: directTile.height,
      sampleType: directTile.sampleType,
      layout: directTile.layout,
      values: tileValues(directTile),
    }).toEqual({
      x: fallbackTile.x,
      y: fallbackTile.y,
      width: fallbackTile.width,
      height: fallbackTile.height,
      sampleType: fallbackTile.sampleType,
      layout: fallbackTile.layout,
      values: tileValues(fallbackTile),
    })
  })

  it('falls back without invoking a direct provider that declines the requested target', async () => {
    const fallbackDataset = new SyntheticDataset('float32')
    let directReads = 0
    let directPlans = 0
    const directSource: NumericTileSource = {
      descriptor: fallbackDataset.descriptor,
      directSemantics: {
        sourceSampleType: 'float32',
        nativeSampleType: 'float32',
        componentCount: 1,
        layout: 'interleaved',
        supportedTargetSampleTypes: ['float32'],
      },
      planRead() {
        directPlans += 1
        throw new Error('Direct source plan should not be called')
      },
      readNumericTiles() {
        directReads += 1
        throw new Error('Direct source should not be called')
      },
    }
    const dataset: DirectNumericTileDataset = Object.assign(fallbackDataset, {
      numericTileSource: directSource,
    })
    const source = resolveNumericTileSource(dataset)
    expect(source.planRead?.({ ...request, targetSampleType: 'float64' })).toEqual({
      delivery: 'streamed',
      maximumEmittedTileRetainedBytes: 32,
    })
    const tile = await firstTile(source, { ...request, targetSampleType: 'float64' })
    expect(directPlans).toBe(0)
    expect(directReads).toBe(0)
    expect(tile.sampleType).toBe('float64')
    expect(tileValues(tile)).toEqual([1, 2, 3, 4])
  })

  it('rejects and releases a direct tile that violates declared semantics', async () => {
    const fallbackDataset = new SyntheticDataset()
    let releases = 0
    const directSource: NumericTileSource = {
      descriptor: fallbackDataset.descriptor,
      directSemantics: {
        sourceSampleType: 'uint16',
        nativeSampleType: 'uint16',
        componentCount: 1,
        layout: 'interleaved',
        supportedTargetSampleTypes: ['uint16'],
      },
      async *readNumericTiles() {
        yield {
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          sampleType: 'uint16',
          componentCount: 1,
          layout: 'planar',
          rowStrideElements: 1,
          planeStrideElements: 1,
          data: Uint16Array.of(1),
          release: () => (releases += 1),
        }
      },
    }
    const dataset: DirectNumericTileDataset = Object.assign(fallbackDataset, {
      numericTileSource: directSource,
    })
    await expect(firstTile(resolveNumericTileSource(dataset))).rejects.toThrow(
      /undeclared tile semantics/,
    )
    expect(releases).toBe(1)
  })

  it('drives statistics, histograms, and rendering directly with padded row tiles', async () => {
    const descriptor = descriptorFor('uint16')
    let directReads = 0
    let tileReleases = 0
    const source: NumericTileSource = {
      descriptor,
      directSemantics: {
        sourceSampleType: 'uint16',
        nativeSampleType: 'uint16',
        componentCount: 1,
        layout: 'interleaved',
        supportedTargetSampleTypes: ['uint16'],
      },
      async *readNumericTiles(tileRequest) {
        directReads += 1
        const normalized = normalizeScientificPlaneReadRequest(descriptor, tileRequest)
        for (let localY = 0; localY < normalized.height; localY += 1) {
          const data = new Uint16Array(normalized.width + 2)
          for (let x = 0; x < normalized.width; x += 1) {
            data[x] = (normalized.y + localY) * 4 + normalized.x + x + 1
          }
          data.fill(65_535, normalized.width)
          yield {
            x: normalized.x,
            y: normalized.y + localY,
            width: normalized.width,
            height: 1,
            sampleType: 'uint16',
            componentCount: 1,
            layout: 'interleaved',
            rowStrideElements: normalized.width + 2,
            data,
            release: () => (tileReleases += 1),
          }
        }
      },
    }
    const dataset: DirectNumericTileDataset = {
      descriptor,
      numericTileSource: source,
      readPlane() {
        throw new Error('Canonical fallback should not be read')
      },
    }
    const measured = await measureScientificPlane(dataset, {
      plane: { displayAxes: ['x', 'y'], fixedIndices: [] },
      range: { mode: 'dataset' },
      statistics: {
        mean: true,
        percentiles: [0, 50, 100],
        histogram: { bins: 3 },
      },
    })
    expect(measured.range).toEqual({ min: 1, max: 12 })
    expect(measured.mean).toBe(6.5)
    expect(measured.percentiles).toEqual([
      { percentile: 0, value: 1 },
      { percentile: 50, value: 7 },
      { percentile: 100, value: 12 },
    ])
    expect([...(measured.histogram?.counts ?? [])]).toEqual([4, 4, 4])

    const rendered = await renderScientificPlane(dataset, {
      plane: { displayAxes: ['x', 'y'], fixedIndices: [] },
      range: { mode: 'explicit', min: 1, max: 12 },
      palette: 'grayscale',
    })
    const rows: Uint8Array[] = []
    for await (const block of rendered.pixels) rows.push(block.data)
    expect(rows).toHaveLength(3)
    expect(rows[0]?.slice(0, 3)).toEqual(Uint8Array.of(0, 0, 0))
    expect(rows[2]?.slice(-3)).toEqual(Uint8Array.of(255, 255, 255))
    expect(directReads).toBe(3)
    expect(tileReleases).toBe(9)
  })
})
