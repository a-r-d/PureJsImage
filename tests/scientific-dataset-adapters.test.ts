import { describe, expect, it } from 'vitest'
import type { RasterBlock, RasterSampleType } from '../src/raster.ts'
import type {
  MultidimensionalRasterDataset,
  RasterChannelInfo,
  RasterPlaneRequest,
} from '../src/scientific/dataset.ts'
import type {
  ScientificDataset,
  ScientificDatasetDescriptor,
  ScientificPlaneReadRequest,
} from '../src/scientific/dataset-v2.ts'
import { normalizeScientificDatasetDescriptor } from '../src/scientific/dataset-v2.ts'
import {
  toMultidimensionalRasterDataset,
  toScientificDataset,
} from '../src/scientific/dataset-adapters.ts'

const collect = async (blocks: AsyncIterable<RasterBlock>): Promise<readonly RasterBlock[]> => {
  const output: RasterBlock[] = []
  for await (const block of blocks) output.push(block)
  return output
}

class FixedAxisFixture implements MultidimensionalRasterDataset {
  readonly sizeX = 2
  readonly sizeY = 1
  readonly sizeZ = 2
  readonly sizeC: number
  readonly sizeT = 2
  readonly dimensionOrder = 'XYCZT'
  readonly physicalSizeX = Object.freeze({ value: 0.25, unit: 'µm' })
  readonly physicalSizeY = Object.freeze({ value: 0.5, unit: 'µm' })
  readonly physicalSizeZ = Object.freeze({ value: 1.5, unit: 'µm' })
  readonly originX = Object.freeze({ value: -2, unit: 'µm' })
  readonly originY = Object.freeze({ value: 3, unit: 'µm' })
  readonly originZ = Object.freeze({ value: 4, unit: 'µm' })
  readonly noDataValue = -1
  readonly metadata = Object.freeze({ instrument: 'synthetic', operator: 'test' })
  readonly sampleType: RasterSampleType
  readonly channels: readonly RasterChannelInfo[]
  readonly block: RasterBlock
  readonly requests: RasterPlaneRequest[] = []
  iterations = 0

  constructor(
    sampleType: RasterSampleType,
    channels: readonly RasterChannelInfo[],
    block: RasterBlock,
  ) {
    this.sampleType = sampleType
    this.channels = channels
    this.block = block
    this.sizeC = channels.reduce((total, channel) => total + channel.samplesPerPixel, 0)
  }

  async *readPlane(options: Readonly<RasterPlaneRequest>): AsyncIterable<RasterBlock> {
    this.iterations += 1
    this.requests.push(options)
    options.signal?.throwIfAborted()
    yield this.block
  }
}

const blockFixture = (
  sampleType: RasterSampleType,
  channels: number,
  planar: boolean,
  data: readonly number[],
  release?: () => void,
): RasterBlock =>
  Object.freeze({
    x: 0,
    y: 0,
    width: 2,
    height: 1,
    stride: planar ? data.length / channels : data.length,
    ...(planar ? { planeStride: data.length / channels } : {}),
    format: Object.freeze({ sampleType, channels, planar }),
    data: Uint8Array.from(data),
    ...(release === undefined ? {} : { release }),
  })

describe('fixed-axis to labeled-axis adapter', () => {
  it.each([
    {
      name: 'uint8 interleaved',
      sampleType: 'uint8' as const,
      samplesPerPixel: 1,
      block: blockFixture('uint8', 1, false, [3, 7]),
    },
    {
      name: 'uint16 planar',
      sampleType: 'uint16' as const,
      samplesPerPixel: 2,
      block: blockFixture('uint16', 2, true, [0, 3, 0, 7, 0, 5, 0, 9]),
    },
    {
      name: 'float32 interleaved',
      sampleType: 'float32' as const,
      samplesPerPixel: 3,
      block: blockFixture(
        'float32',
        3,
        false,
        [63, 128, 0, 0, 64, 0, 0, 0, 64, 64, 0, 0, 64, 128, 0, 0, 64, 160, 0, 0, 64, 192, 0, 0],
      ),
    },
  ])('preserves exact $name blocks and lazy reads', async (fixture) => {
    const source = new FixedAxisFixture(
      fixture.sampleType,
      Object.freeze([{ name: 'Signal', samplesPerPixel: fixture.samplesPerPixel, unit: 'V' }]),
      fixture.block,
    )
    const adapted = toScientificDataset(source)
    expect(source.iterations).toBe(0)
    const blocks = await collect(
      adapted.readPlane({
        displayAxes: ['x', 'y'],
        fixedIndices: [
          { axisId: 'z', index: 1 },
          { axisId: 'time', index: 1 },
        ],
      }),
    )
    expect(blocks).toEqual([fixture.block])
    expect(blocks[0]).toBe(fixture.block)
    expect(source.requests[0]).toMatchObject({ z: 1, t: 1, x: 0, y: 0, width: 2, height: 1 })
    expect(source.requests[0]?.c).toEqual(
      fixture.samplesPerPixel === 1
        ? 0
        : Array.from({ length: fixture.samplesPerPixel }, (_, index) => index),
    )
  })

  it('maps calibration, channel entries, spectral coordinates, and metadata losslessly', () => {
    const channels = Object.freeze([
      Object.freeze({
        id: 'band-450',
        name: 'Blue',
        samplesPerPixel: 1,
        unit: 'reflectance',
        color: 0x2244ff,
        spectral: Object.freeze({ center: 450, unit: 'nm', fwhm: 10 }),
      }),
      Object.freeze({
        id: 'band-650',
        name: 'Red',
        samplesPerPixel: 1,
        unit: 'reflectance',
        color: 0xff4422,
        spectral: Object.freeze({ center: 650, unit: 'nm', fwhm: 12 }),
      }),
    ])
    const source = new FixedAxisFixture(
      'uint16',
      channels,
      blockFixture('uint16', 1, false, [0, 1, 0, 2]),
    )
    const adapted = toScientificDataset(source)
    expect(adapted.descriptor.axes.find((axis) => axis.id === 'x')).toMatchObject({
      unit: 'µm',
      coordinates: { type: 'linear', origin: -2, step: 0.25 },
    })
    expect(adapted.descriptor.axes.find((axis) => axis.id === 'channel')).toMatchObject({
      kind: 'spectral',
      unit: 'nm',
      coordinates: { type: 'lookup', values: [450, 650] },
      entries: channels.map(({ samplesPerPixel: _samplesPerPixel, ...entry }) => entry),
    })
    expect(adapted.descriptor.noDataValue).toBe(-1)
    expect(adapted.descriptor.metadata).toMatchObject({
      'purejsimage:multidimensional-raster-dataset': {
        sourceMetadata: source.metadata,
      },
    })
    expect(toMultidimensionalRasterDataset(adapted)).toBe(source)

    const rehydrated = new LabeledFixture(adapted.descriptor, source.block)
    const restored = toMultidimensionalRasterDataset(rehydrated)
    expect({
      dimensionOrder: restored.dimensionOrder,
      channels: restored.channels,
      physicalSizeX: restored.physicalSizeX,
      originZ: restored.originZ,
      metadata: restored.metadata,
    }).toEqual({
      dimensionOrder: source.dimensionOrder,
      channels: source.channels,
      physicalSizeX: source.physicalSizeX,
      originZ: source.originZ,
      metadata: source.metadata,
    })
  })

  it('preserves release callbacks without wrapping blocks', async () => {
    let releases = 0
    const block = blockFixture('uint8', 1, false, [1, 2], () => {
      releases += 1
    })
    const source = new FixedAxisFixture('uint8', Object.freeze([{ samplesPerPixel: 1 }]), block)
    const [adaptedBlock] = await collect(
      toScientificDataset(source).readPlane({
        displayAxes: ['x', 'y'],
        fixedIndices: [
          { axisId: 'z', index: 0 },
          { axisId: 'time', index: 0 },
        ],
      }),
    )
    adaptedBlock?.release?.()
    expect(releases).toBe(1)
    expect(adaptedBlock?.release).toBe(block.release)
  })

  it('passes declared resolution levels through to the fixed-axis reader', async () => {
    const source = new FixedAxisFixture(
      'uint8',
      Object.freeze([{ samplesPerPixel: 1 }]),
      blockFixture('uint8', 1, false, [1, 2]),
    )
    const adapted = toScientificDataset(source, {
      levels: [
        {
          level: 0,
          axisLengths: [
            { axisId: 'x', length: 2 },
            { axisId: 'y', length: 1 },
            { axisId: 'z', length: 2 },
            { axisId: 'channel', length: 1 },
            { axisId: 'time', length: 2 },
          ],
        },
        {
          level: 1,
          axisLengths: [
            { axisId: 'x', length: 1 },
            { axisId: 'y', length: 1 },
            { axisId: 'z', length: 2 },
            { axisId: 'channel', length: 1 },
            { axisId: 'time', length: 2 },
          ],
        },
      ],
    })
    await collect(
      adapted.readPlane({
        displayAxes: ['x', 'y'],
        fixedIndices: [
          { axisId: 'z', index: 0 },
          { axisId: 'time', index: 0 },
        ],
        resolutionLevel: 1,
      }),
    )
    expect(source.requests[0]?.resolutionLevel).toBe(1)
  })

  it('passes AbortSignal into the fixed-axis read and stops before iteration', async () => {
    const source = new FixedAxisFixture(
      'uint8',
      Object.freeze([{ samplesPerPixel: 1 }]),
      blockFixture('uint8', 1, false, [1, 2]),
    )
    const controller = new AbortController()
    controller.abort(new Error('stop'))
    await expect(
      collect(
        toScientificDataset(source).readPlane({
          displayAxes: ['x', 'y'],
          fixedIndices: [
            { axisId: 'z', index: 0 },
            { axisId: 'time', index: 0 },
          ],
          signal: controller.signal,
        }),
      ),
    ).rejects.toThrow('stop')
    expect(source.iterations).toBe(0)
  })
})

class LabeledFixture implements ScientificDataset {
  readonly descriptor
  readonly block: RasterBlock
  readonly requests: ScientificPlaneReadRequest[] = []

  constructor(descriptor: ScientificDatasetDescriptor, block: RasterBlock) {
    this.descriptor = normalizeScientificDatasetDescriptor(descriptor)
    this.block = block
  }

  async *readPlane(request: Readonly<ScientificPlaneReadRequest>): AsyncIterable<RasterBlock> {
    this.requests.push(request)
    request.signal?.throwIfAborted()
    yield this.block
  }
}

const xyDescriptor = (
  overrides: Partial<ScientificDatasetDescriptor> = {},
): ScientificDatasetDescriptor => ({
  schemaVersion: 2 as const,
  axes: [
    {
      id: 'x',
      kind: 'space' as const,
      length: 2,
      unit: 'mm',
      coordinates: { type: 'linear' as const, origin: 10, step: 0.5 },
    },
    {
      id: 'y',
      kind: 'space' as const,
      length: 1,
      unit: 'mm',
      coordinates: { type: 'linear' as const, origin: -4, step: 2 },
    },
  ],
  sampleType: 'float32' as const,
  components: [{ id: 'value', kind: 'scalar' as const, unit: 'K' }],
  capabilities: {
    regionReads: true,
    resolutionLevels: false,
    planeReads: { kind: 'any-axis-pair' },
  },
  ...overrides,
})

describe('labeled-axis to fixed-axis adapter', () => {
  it('preserves lazy blocks, calibration, metadata, release, and abort signals', async () => {
    let releases = 0
    const block = blockFixture('float32', 1, false, [63, 128, 0, 0, 64, 0, 0, 0], () => {
      releases += 1
    })
    const source = new LabeledFixture(
      xyDescriptor({
        metadata: {
          'purejsimage:multidimensional-raster-dataset': {
            schemaVersion: 1,
            dimensionOrder: 'XYCZT',
            sourceMetadata: { instrument: 'synthetic' },
          },
        },
      }),
      block,
    )
    const legacy = toMultidimensionalRasterDataset(source)
    expect({
      sizes: [legacy.sizeX, legacy.sizeY, legacy.sizeZ, legacy.sizeC, legacy.sizeT],
      physicalSizeX: legacy.physicalSizeX,
      originY: legacy.originY,
      metadata: legacy.metadata,
    }).toEqual({
      sizes: [2, 1, 1, 1, 1],
      physicalSizeX: { value: 0.5, unit: 'mm' },
      originY: { value: -4, unit: 'mm' },
      metadata: { instrument: 'synthetic' },
    })
    const controller = new AbortController()
    const [legacyBlock] = await collect(
      legacy.readPlane({ z: 0, c: 0, t: 0, signal: controller.signal }),
    )
    expect(legacyBlock).toBe(block)
    expect(source.requests[0]?.signal).toBe(controller.signal)
    legacyBlock?.release?.()
    expect(releases).toBe(1)
  })

  it('rejects a 4D-STEM descriptor instead of flattening arbitrary axes', () => {
    const source = new LabeledFixture(
      xyDescriptor({
        axes: ['scanX', 'scanY', 'kx', 'ky'].map((id) => ({
          id,
          kind: id.startsWith('k') ? ('reciprocal-space' as const) : ('space' as const),
          length: 2,
          coordinates: { type: 'index' as const },
        })),
      }),
      blockFixture('float32', 1, false, [0, 0, 0, 0, 0, 0, 0, 0]),
    )
    expect(() => toMultidimensionalRasterDataset(source)).toThrow(
      'cannot be relabeled or flattened',
    )
  })

  it('rejects multi-component samples and rich metadata that V1 cannot select or preserve', () => {
    const multiComponent = new LabeledFixture(
      xyDescriptor({
        components: [
          { id: 'red', kind: 'red' },
          { id: 'green', kind: 'green' },
          { id: 'blue', kind: 'blue' },
        ],
      }),
      blockFixture('float32', 3, false, new Array<number>(24).fill(0)),
    )
    expect(() => toMultidimensionalRasterDataset(multiComponent)).toThrow(
      'cannot select one component',
    )

    const richMetadata = new LabeledFixture(
      xyDescriptor({ metadata: { acquisition: { exposure: 5 } } }),
      blockFixture('float32', 1, false, new Array<number>(8).fill(0)),
    )
    expect(() => toMultidimensionalRasterDataset(richMetadata)).toThrow(
      'metadata must be a flat string record',
    )
  })
})

describe('axis entry validation', () => {
  it('rejects entry arrays with the wrong length or unsafe values', () => {
    const descriptor = xyDescriptor()
    expect(() =>
      normalizeScientificDatasetDescriptor({
        ...descriptor,
        axes: [{ ...descriptor.axes[0], entries: [{ name: 'only one' }] }, descriptor.axes[1]],
      }),
    ).toThrow('must contain exactly 2 entries')
    expect(() =>
      normalizeScientificDatasetDescriptor({
        ...descriptor,
        axes: [
          {
            ...descriptor.axes[0],
            entries: [{ spectral: { center: Number.NaN } }, {}],
          },
          descriptor.axes[1],
        ],
      }),
    ).toThrow('spectral.center must be finite')
  })
})
