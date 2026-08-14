import { describe, expect, it } from 'vitest'

import type { RasterBlock, RasterFormat } from '../src/raster.ts'
import { rasterSampleBytes } from '../src/raster.ts'
import type {
  NormalizedScientificDatasetDescriptor,
  ScientificAxisCoordinates,
  ScientificAxisDescriptor,
  ScientificAxisKind,
  ScientificDataset,
  ScientificDatasetDescriptor,
  ScientificPlaneReadRequest,
  ScientificSeriesBlock,
  ScientificSeriesReadRequest,
} from '../src/scientific/index.ts'
import {
  normalizeScientificDatasetDescriptor,
  normalizeScientificPlaneReadRequest,
  normalizeScientificSeriesReadRequest,
  readScientificSeriesFromPlane,
  resolveScientificAxisAtResolutionLevel,
  resolveScientificDescriptorAtResolutionLevel,
  supportsScientificPlaneRead,
  supportsScientificSeriesRead,
  validateScientificDatasetDescriptor,
} from '../src/scientific/index.ts'

const axis = (
  id: string,
  kind: ScientificAxisKind,
  length: number,
  coordinates: ScientificAxisCoordinates = { type: 'index' },
): ScientificAxisDescriptor => ({ id, kind, length, coordinates })

const descriptorInput = (
  axes: readonly ScientificAxisDescriptor[],
  overrides: Partial<
    Pick<
      ScientificDatasetDescriptor,
      'capabilities' | 'components' | 'levels' | 'metadata' | 'noDataValue' | 'sampleType'
    >
  > = {},
): ScientificDatasetDescriptor => ({
  schemaVersion: 1,
  axes,
  sampleType: overrides.sampleType ?? 'uint8',
  components: overrides.components ?? [{ id: 'value', kind: 'scalar' }],
  capabilities: overrides.capabilities ?? {
    regionReads: true,
    resolutionLevels: false,
    planeReads: { kind: 'any-axis-pair' },
  },
  ...(overrides.levels === undefined ? {} : { levels: overrides.levels }),
  ...(overrides.noDataValue === undefined ? {} : { noDataValue: overrides.noDataValue }),
  ...(overrides.metadata === undefined ? {} : { metadata: overrides.metadata }),
})

class SyntheticScientificDataset implements ScientificDataset {
  readonly descriptor: NormalizedScientificDatasetDescriptor
  reads = 0
  releases = 0

  constructor(descriptor: ScientificDatasetDescriptor) {
    this.descriptor = normalizeScientificDatasetDescriptor(descriptor)
  }

  async *readPlane(request: Readonly<ScientificPlaneReadRequest>): AsyncGenerator<RasterBlock> {
    const normalized = normalizeScientificPlaneReadRequest(this.descriptor, request)
    normalized.signal?.throwIfAborted()
    this.reads += 1
    const bytesPerSample = rasterSampleBytes(this.descriptor.sampleType)
    const stride = normalized.width * this.descriptor.components.length * bytesPerSample
    const format: RasterFormat = Object.freeze({
      sampleType: this.descriptor.sampleType,
      channels: this.descriptor.components.length,
      planar: false,
    })
    yield {
      x: normalized.x,
      y: normalized.y,
      width: normalized.width,
      height: normalized.height,
      stride,
      format,
      data: new Uint8Array(stride * normalized.height),
      release: () => {
        this.releases += 1
      },
    }
  }
}

class SyntheticScientificSeriesDataset implements ScientificDataset {
  readonly descriptor: NormalizedScientificDatasetDescriptor
  reads = 0
  releases = 0

  constructor() {
    this.descriptor = normalizeScientificDatasetDescriptor({
      schemaVersion: 1,
      axes: [axis('energy', 'spectral', 5, { type: 'linear', origin: 100, step: 0.5 })],
      sampleType: 'uint16',
      components: [{ id: 'intensity', kind: 'intensity', unit: 'counts' }],
      capabilities: {
        regionReads: true,
        resolutionLevels: false,
        planeReads: { kind: 'none' },
        seriesReads: { kind: 'axes', axes: ['energy'] },
      },
    })
  }

  readPlane(_request: Readonly<ScientificPlaneReadRequest>): AsyncIterable<RasterBlock> {
    throw new Error('Synthetic one-dimensional dataset does not support plane reads')
  }

  async *readSeries(
    request: Readonly<ScientificSeriesReadRequest>,
  ): AsyncGenerator<ScientificSeriesBlock> {
    const normalized = normalizeScientificSeriesReadRequest(this.descriptor, request)
    normalized.signal?.throwIfAborted()
    this.reads += 1
    const data = new Uint8Array(normalized.length * 2)
    const view = new DataView(data.buffer)
    for (let index = 0; index < normalized.length; index += 1) {
      view.setUint16(index * 2, normalized.start + index + 1, false)
    }
    yield {
      start: normalized.start,
      length: normalized.length,
      format: { sampleType: 'uint16', channels: 1, planar: false },
      data,
      release: () => {
        this.releases += 1
      },
    }
  }
}

class SyntheticPlaneSeriesSource implements ScientificDataset {
  readonly descriptor = normalizeScientificDatasetDescriptor(
    descriptorInput([axis('x', 'space', 4), axis('y', 'space', 3)], {
      sampleType: 'uint16',
    }),
  )
  releases = 0

  async *readPlane(request: Readonly<ScientificPlaneReadRequest>): AsyncGenerator<RasterBlock> {
    const normalized = normalizeScientificPlaneReadRequest(this.descriptor, request)
    normalized.signal?.throwIfAborted()
    const stride = normalized.width * 2 + 2
    const data = new Uint8Array(stride * normalized.height)
    const view = new DataView(data.buffer)
    for (let y = 0; y < normalized.height; y += 1) {
      for (let x = 0; x < normalized.width; x += 1) {
        view.setUint16(y * stride + x * 2, (normalized.y + y) * 10 + normalized.x + x, false)
      }
    }
    yield {
      x: normalized.x,
      y: normalized.y,
      width: normalized.width,
      height: normalized.height,
      stride,
      format: { sampleType: 'uint16', channels: 1, planar: false },
      data,
      release: () => {
        this.releases += 1
      },
    }
  }
}

class SyntheticPlanarSeriesSource implements ScientificDataset {
  readonly descriptor = normalizeScientificDatasetDescriptor(
    descriptorInput([axis('x', 'space', 2), axis('y', 'space', 2)], {
      components: [
        { id: 'a', kind: 'scalar' },
        { id: 'b', kind: 'scalar' },
      ],
    }),
  )

  async *readPlane(request: Readonly<ScientificPlaneReadRequest>): AsyncGenerator<RasterBlock> {
    const normalized = normalizeScientificPlaneReadRequest(this.descriptor, request)
    const stride = normalized.width + 1
    const occupiedPlaneBytes = stride * (normalized.height - 1) + normalized.width
    const planeStride = occupiedPlaneBytes + 1
    const data = new Uint8Array(planeStride + occupiedPlaneBytes)
    for (let channel = 0; channel < 2; channel += 1) {
      for (let y = 0; y < normalized.height; y += 1) {
        for (let x = 0; x < normalized.width; x += 1) {
          data[channel * planeStride + y * stride + x] =
            channel * 100 + (normalized.y + y) * 10 + normalized.x + x
        }
      }
    }
    yield {
      x: normalized.x,
      y: normalized.y,
      width: normalized.width,
      height: normalized.height,
      stride,
      planeStride,
      format: { sampleType: 'uint8', channels: 2, planar: true },
      data,
    }
  }
}

const firstBlock = async (
  dataset: ScientificDataset,
  request: Readonly<ScientificPlaneReadRequest>,
): Promise<RasterBlock> => {
  for await (const block of dataset.readPlane(request)) return block
  throw new Error('Synthetic scientific dataset returned no block')
}

const firstSeriesBlock = async (
  dataset: ScientificDataset,
  request: Readonly<ScientificSeriesReadRequest>,
): Promise<ScientificSeriesBlock> => {
  if (dataset.readSeries === undefined) throw new Error('Dataset does not implement series reads')
  for await (const block of dataset.readSeries(request)) return block
  throw new Error('Synthetic scientific dataset returned no series block')
}

describe('ScientificDataset descriptors', () => {
  it('normalizes an ordinary X/Y scalar dataset and explicit level zero', () => {
    const input = descriptorInput([axis('x', 'space', 5), axis('y', 'space', 3)], {
      metadata: { acquisition: { instrument: 'synthetic', voltage: 200 }, tags: ['test'] },
      noDataValue: Number.NaN,
    })

    const descriptor = normalizeScientificDatasetDescriptor(input)

    expect(descriptor.schemaVersion).toBe(1)
    expect(descriptor.levels).toEqual([
      {
        level: 0,
        axisLengths: [
          { axisId: 'x', length: 5 },
          { axisId: 'y', length: 3 },
        ],
      },
    ])
    expect(Number.isNaN(descriptor.noDataValue)).toBe(true)
    expect(Object.isFrozen(descriptor)).toBe(true)
    expect(Object.isFrozen(descriptor.metadata?.acquisition)).toBe(true)
  })

  it('normalizes an honest one-dimensional spectral dataset without a synthetic axis', () => {
    const descriptor = new SyntheticScientificSeriesDataset().descriptor
    const lookup = normalizeScientificDatasetDescriptor({
      ...descriptor,
      axes: [axis('energy', 'spectral', 3, { type: 'lookup', values: [100, 100.6, 102.1] })],
      levels: undefined,
    })

    expect(descriptor.axes).toEqual([
      {
        id: 'energy',
        kind: 'spectral',
        length: 5,
        coordinates: { type: 'linear', origin: 100, step: 0.5 },
      },
    ])
    expect(descriptor.capabilities).toEqual({
      regionReads: true,
      resolutionLevels: false,
      planeReads: { kind: 'none' },
      seriesReads: { kind: 'axes', axes: ['energy'] },
    })
    expect(supportsScientificPlaneRead(descriptor, ['energy', 'energy'])).toBe(false)
    expect(supportsScientificSeriesRead(descriptor, 'energy')).toBe(true)
    expect(supportsScientificSeriesRead(descriptor, 'unknown')).toBe(false)
    expect(lookup.axes[0]?.coordinates).toEqual({ type: 'lookup', values: [100, 100.6, 102.1] })
  })

  it('rejects unusable or contradictory one-dimensional capabilities', () => {
    const base = {
      schemaVersion: 1,
      axes: [axis('energy', 'spectral', 5)],
      sampleType: 'uint16',
      components: [{ id: 'intensity', kind: 'intensity' }],
    }

    expect(() =>
      normalizeScientificDatasetDescriptor({
        ...base,
        capabilities: {
          regionReads: true,
          resolutionLevels: false,
          planeReads: { kind: 'none' },
        },
      }),
    ).toThrow('must support plane reads or series reads')
    expect(() =>
      normalizeScientificDatasetDescriptor({
        ...base,
        capabilities: {
          regionReads: true,
          resolutionLevels: false,
          planeReads: { kind: 'any-axis-pair' },
          seriesReads: { kind: 'any-axis' },
        },
      }),
    ).toThrow('any-axis-pair capability requires at least two axes')
    expect(() =>
      normalizeScientificDatasetDescriptor({
        ...base,
        capabilities: {
          regionReads: true,
          resolutionLevels: false,
          planeReads: { kind: 'none' },
          seriesReads: { kind: 'axes', axes: ['unknown'] },
        },
      }),
    ).toThrow('seriesReads names unknown axis unknown')
  })

  it('copies nonlinear and label coordinates once during normalization', () => {
    const energyValues = [10, 10.5, 12, 18]
    const labels = ['before', 'after']
    const input = descriptorInput([
      axis('x', 'space', 2),
      axis('energy', 'spectral', 4, { type: 'lookup', values: energyValues }),
      axis('state', 'other', 2, { type: 'labels', values: labels }),
    ])

    validateScientificDatasetDescriptor(input)
    expect(energyValues).toEqual([10, 10.5, 12, 18])

    const descriptor = normalizeScientificDatasetDescriptor(input)
    const energy = descriptor.axes[1]?.coordinates
    const state = descriptor.axes[2]?.coordinates
    expect(energy).toEqual({ type: 'lookup', values: [10, 10.5, 12, 18] })
    expect(state).toEqual({ type: 'labels', values: ['before', 'after'] })
    if (energy?.type !== 'lookup' || state?.type !== 'labels') {
      throw new Error('Expected normalized lookup and label coordinates')
    }
    expect(energy.values).not.toBe(energyValues)
    expect(state.values).not.toBe(labels)
    energyValues[0] = 99
    labels[0] = 'changed'
    expect(energy.values[0]).toBe(10)
    expect(state.values[0]).toBe('before')
  })

  it('normalizes, freezes, and serializes calibration evidence', () => {
    const calibration = {
      kind: 'derived' as const,
      resourceId: 'volume-1',
      locator: 'mrc:header:cellDimensions.x,MX,origin.x',
      formula: 'mrc-cell-dimension-per-sample-v1',
      note: 'Spacing is derived from the declared grid sampling.',
    }
    const descriptor = normalizeScientificDatasetDescriptor(
      descriptorInput([
        {
          ...axis('x', 'space', 2, { type: 'linear', origin: 1, step: 0.5 }),
          unit: 'Å',
          calibration,
        },
        axis('y', 'space', 2),
      ]),
    )
    const normalized = descriptor.axes[0]?.calibration

    expect(normalized).toEqual(calibration)
    expect(normalized).not.toBe(calibration)
    expect(Object.isFrozen(normalized)).toBe(true)
    expect(JSON.parse(JSON.stringify(descriptor))).toEqual(descriptor)
  })

  it.each([
    [{ kind: 'unknown', resourceId: 'source', locator: 'format:field' }, 'kind'],
    [{ kind: 'embedded', resourceId: '', locator: 'format:field' }, 'resourceId'],
    [{ kind: 'embedded', resourceId: 'source', locator: '' }, 'locator'],
    [{ kind: 'embedded', resourceId: 'source', locator: 'format:field', extra: true }, 'extra'],
  ])('rejects malformed calibration evidence %#', (calibration, message) => {
    expect(() =>
      normalizeScientificDatasetDescriptor(
        descriptorInput([
          {
            ...axis('x', 'space', 2, { type: 'linear', origin: 0, step: 1 }),
            calibration: calibration as never,
          },
          axis('y', 'space', 2),
        ]),
      ),
    ).toThrow(message)
  })

  it('describes components independently from selectable channel axes', () => {
    const descriptor = normalizeScientificDatasetDescriptor(
      descriptorInput(
        [
          axis('x', 'space', 4),
          axis('y', 'space', 3),
          axis('channel', 'channel', 8, {
            type: 'labels',
            values: ['405', '445', '488', '514', '561', '594', '640', '730'],
          }),
          axis('time', 'time', 2, { type: 'linear', origin: 0, step: 0.5 }),
        ],
        {
          components: [
            { id: 'red', kind: 'red', color: 0xff0000 },
            { id: 'green', kind: 'green', color: 0x00ff00 },
            { id: 'blue', kind: 'blue', color: 0x0000ff },
          ],
        },
      ),
    )

    expect(descriptor.axes.find(({ id }) => id === 'channel')?.length).toBe(8)
    expect(descriptor.components.map(({ id }) => id)).toEqual(['red', 'green', 'blue'])
  })

  it('allows resolution levels to change any declared axis', () => {
    const descriptor = normalizeScientificDatasetDescriptor(
      descriptorInput([axis('scanX', 'space', 8), axis('energy', 'spectral', 16)], {
        capabilities: {
          regionReads: true,
          resolutionLevels: true,
          planeReads: { kind: 'any-axis-pair' },
        },
        levels: [
          {
            level: 0,
            axisLengths: [
              { axisId: 'scanX', length: 8 },
              { axisId: 'energy', length: 16 },
            ],
          },
          {
            level: 1,
            axisLengths: [
              { axisId: 'scanX', length: 4 },
              { axisId: 'energy', length: 8 },
            ],
          },
        ],
      }),
    )

    expect(
      normalizeScientificPlaneReadRequest(descriptor, {
        displayAxes: ['scanX', 'energy'],
        fixedIndices: [],
        resolutionLevel: 1,
      }),
    ).toMatchObject({ width: 4, height: 8, resolutionLevel: 1 })
  })

  it('resolves level-specific dimensions and calibrated coordinates canonically', () => {
    const descriptor = normalizeScientificDatasetDescriptor(
      descriptorInput(
        [
          { ...axis('x', 'space', 8, { type: 'linear', origin: 1, step: 0.5 }), unit: 'µm' },
          { ...axis('y', 'space', 6, { type: 'linear', origin: 2, step: 0.75 }), unit: 'µm' },
        ],
        {
          capabilities: {
            regionReads: true,
            resolutionLevels: true,
            planeReads: { kind: 'ordered-axis-pairs', pairs: [['x', 'y']] },
          },
          levels: [
            {
              level: 0,
              axisLengths: [
                { axisId: 'x', length: 8 },
                { axisId: 'y', length: 6 },
              ],
            },
            {
              level: 1,
              axisLengths: [
                { axisId: 'x', length: 4 },
                { axisId: 'y', length: 2 },
              ],
              axisCoordinates: [
                { axisId: 'x', coordinates: { type: 'linear', origin: 1, step: 1 } },
                { axisId: 'y', coordinates: { type: 'linear', origin: 2, step: 2.25 } },
              ],
            },
          ],
        },
      ),
    )
    expect(resolveScientificAxisAtResolutionLevel(descriptor, 'x', 1)).toMatchObject({
      length: 4,
      unit: 'µm',
      coordinates: { type: 'linear', origin: 1, step: 1 },
    })
    const selected = resolveScientificDescriptorAtResolutionLevel(descriptor, 1)
    expect(selected.axes.map(({ length, coordinates }) => ({ length, coordinates }))).toEqual([
      { length: 4, coordinates: { type: 'linear', origin: 1, step: 1 } },
      { length: 2, coordinates: { type: 'linear', origin: 2, step: 2.25 } },
    ])
    expect(selected.levels).toEqual([
      {
        level: 0,
        axisLengths: [
          { axisId: 'x', length: 4 },
          { axisId: 'y', length: 2 },
        ],
      },
    ])
  })

  it.each([
    ['duplicate axis ids', descriptorInput([axis('x', 'space', 2), axis('x', 'space', 2)])],
    ['empty axis ids', descriptorInput([axis(' ', 'space', 2), axis('y', 'space', 2)])],
    ['invalid axis lengths', descriptorInput([axis('x', 'space', 0), axis('y', 'space', 2)])],
    [
      'non-finite calibration',
      descriptorInput([
        axis('x', 'space', 2, { type: 'linear', origin: Number.POSITIVE_INFINITY, step: 1 }),
        axis('y', 'space', 2),
      ]),
    ],
    [
      'zero calibration steps',
      descriptorInput([
        axis('x', 'space', 2, { type: 'linear', origin: 0, step: 0 }),
        axis('y', 'space', 2),
      ]),
    ],
    [
      'wrong lookup lengths',
      descriptorInput([
        axis('x', 'space', 2, { type: 'lookup', values: [1] }),
        axis('y', 'space', 2),
      ]),
    ],
    [
      'non-finite lookup values',
      descriptorInput([
        axis('x', 'space', 2, { type: 'lookup', values: [1, Number.NaN] }),
        axis('y', 'space', 2),
      ]),
    ],
    [
      'duplicate components',
      descriptorInput([axis('x', 'space', 2), axis('y', 'space', 2)], {
        components: [
          { id: 'value', kind: 'scalar' },
          { id: 'value', kind: 'scalar' },
        ],
      }),
    ],
  ])('rejects %s', (_name, input) => {
    expect(() => normalizeScientificDatasetDescriptor(input)).toThrow()
  })

  it('rejects malformed and inconsistent resolution levels', () => {
    const axes = [axis('x', 'space', 4), axis('y', 'space', 3)]
    const capabilities = {
      regionReads: true,
      resolutionLevels: true,
      planeReads: { kind: 'any-axis-pair' as const },
    }
    const levelZero = {
      level: 0,
      axisLengths: [
        { axisId: 'x', length: 4 },
        { axisId: 'y', length: 3 },
      ],
    }

    expect(() =>
      normalizeScientificDatasetDescriptor(
        descriptorInput(axes, {
          capabilities,
          levels: [levelZero, { level: 0, axisLengths: levelZero.axisLengths }],
        }),
      ),
    ).toThrow('level 0 is duplicated')
    expect(() =>
      normalizeScientificDatasetDescriptor(
        descriptorInput(axes, {
          capabilities,
          levels: [levelZero, { level: 1, axisLengths: [{ axisId: 'x', length: 2 }] }],
        }),
      ),
    ).toThrow('must describe every dataset axis exactly once')
    expect(() =>
      normalizeScientificDatasetDescriptor(
        descriptorInput(axes, {
          capabilities,
          levels: [
            levelZero,
            {
              level: 1,
              axisLengths: [
                { axisId: 'x', length: 2 },
                { axisId: 'unknown', length: 2 },
              ],
            },
          ],
        }),
      ),
    ).toThrow('unknown axis unknown')
    expect(() =>
      normalizeScientificDatasetDescriptor(
        descriptorInput(axes, {
          capabilities: {
            regionReads: true,
            resolutionLevels: false,
            planeReads: { kind: 'any-axis-pair' },
          },
          levels: [
            levelZero,
            {
              level: 1,
              axisLengths: [
                { axisId: 'x', length: 2 },
                { axisId: 'y', length: 2 },
              ],
            },
          ],
        }),
      ),
    ).toThrow('capability must match')
    expect(() =>
      normalizeScientificDatasetDescriptor(
        descriptorInput(
          [axis('x', 'space', 4, { type: 'lookup', values: [0, 1, 2, 3] }), axis('y', 'space', 3)],
          {
            capabilities,
            levels: [
              levelZero,
              {
                level: 1,
                axisLengths: [
                  { axisId: 'x', length: 2 },
                  { axisId: 'y', length: 2 },
                ],
              },
            ],
          },
        ),
      ),
    ).toThrow('must override coordinates for resized axis x')
  })

  it('rejects non-JSON metadata values and cycles', () => {
    const axes = [axis('x', 'space', 2), axis('y', 'space', 2)]
    const cyclic: { self?: unknown } = {}
    cyclic.self = cyclic
    const invalidValues: readonly unknown[] = [
      undefined,
      1n,
      Symbol('metadata'),
      (): void => {},
      Number.NaN,
      Number.POSITIVE_INFINITY,
      cyclic,
    ]

    for (const value of invalidValues) {
      expect(() =>
        normalizeScientificDatasetDescriptor({
          ...descriptorInput(axes),
          metadata: { value },
        }),
      ).toThrow()
    }
  })
})

describe('ScientificDataset plane requests', () => {
  it('enforces supported ordered display-axis pairs before reader execution', () => {
    const descriptor = normalizeScientificDatasetDescriptor(
      descriptorInput([axis('x', 'space', 3), axis('y', 'space', 2), axis('z', 'space', 4)], {
        capabilities: {
          regionReads: true,
          resolutionLevels: false,
          planeReads: {
            kind: 'ordered-axis-pairs',
            pairs: [
              ['x', 'y'],
              ['x', 'z'],
            ],
          },
        },
      }),
    )
    expect(
      normalizeScientificPlaneReadRequest(descriptor, {
        displayAxes: ['x', 'z'],
        fixedIndices: [{ axisId: 'y', index: 0 }],
      }),
    ).toMatchObject({ width: 3, height: 4 })
    expect(() =>
      normalizeScientificPlaneReadRequest(descriptor, {
        displayAxes: ['z', 'x'],
        fixedIndices: [{ axisId: 'y', index: 0 }],
      }),
    ).toThrow('does not support display axes z/x')
  })

  it('reports exact FITS-like and MRC-style plane-read capabilities', () => {
    const fits = normalizeScientificDatasetDescriptor(
      descriptorInput([axis('x', 'space', 3), axis('y', 'space', 2), axis('axis-3', 'other', 4)], {
        capabilities: {
          regionReads: true,
          resolutionLevels: false,
          planeReads: { kind: 'ordered-axis-pairs', pairs: [['x', 'y']] },
        },
      }),
    )
    expect(supportsScientificPlaneRead(fits, ['x', 'y'])).toBe(true)
    expect(supportsScientificPlaneRead(fits, ['x', 'axis-3'])).toBe(false)
    expect(() =>
      normalizeScientificPlaneReadRequest(fits, {
        displayAxes: ['x', 'axis-3'],
        fixedIndices: [{ axisId: 'y', index: 0 }],
      }),
    ).toThrow('does not support display axes x/axis-3')

    const mrc = normalizeScientificDatasetDescriptor(
      descriptorInput([axis('x', 'space', 3), axis('y', 'space', 2), axis('z', 'space', 4)], {
        capabilities: {
          regionReads: true,
          resolutionLevels: false,
          planeReads: {
            kind: 'ordered-axis-pairs',
            pairs: [
              ['x', 'y'],
              ['x', 'z'],
              ['y', 'z'],
            ],
          },
        },
      }),
    )
    for (const pair of [
      ['x', 'y'],
      ['x', 'z'],
      ['y', 'z'],
    ] as const) {
      expect(supportsScientificPlaneRead(mrc, pair)).toBe(true)
    }
    expect(supportsScientificPlaneRead(mrc, ['z', 'x'])).toBe(false)
    expect(supportsScientificPlaneRead(mrc, ['z', 'y'])).toBe(false)
  })

  it('accepts any two distinct known axes for an any-axis-pair descriptor', () => {
    const descriptor = normalizeScientificDatasetDescriptor(
      descriptorInput([axis('x', 'space', 3), axis('y', 'space', 2), axis('z', 'space', 4)]),
    )
    expect(supportsScientificPlaneRead(descriptor, ['z', 'x'])).toBe(true)
    expect(supportsScientificPlaneRead(descriptor, ['x', 'x'])).toBe(false)
    expect(supportsScientificPlaneRead(descriptor, ['x', 'missing'])).toBe(false)
  })

  it('normalizes X/Y/Z and singleton selections explicitly', () => {
    const descriptor = normalizeScientificDatasetDescriptor(
      descriptorInput([
        axis('x', 'space', 6),
        axis('y', 'space', 4),
        axis('z', 'space', 3),
        axis('time', 'time', 1),
      ]),
    )

    expect(
      normalizeScientificPlaneReadRequest(descriptor, {
        displayAxes: ['x', 'y'],
        fixedIndices: [{ axisId: 'z', index: 2 }],
        x: 1,
        y: 1,
        width: 3,
        height: 2,
      }),
    ).toEqual({
      displayAxes: ['x', 'y'],
      fixedIndices: [
        { axisId: 'z', index: 2 },
        { axisId: 'time', index: 0 },
      ],
      resolutionLevel: 0,
      x: 1,
      y: 1,
      width: 3,
      height: 2,
    })
  })

  it('selects either reciprocal or scan planes from 4D-STEM data', () => {
    const descriptor = normalizeScientificDatasetDescriptor(
      descriptorInput([
        axis('scanX', 'space', 3),
        axis('scanY', 'space', 2),
        axis('kx', 'reciprocal-space', 5, { type: 'linear', origin: -2, step: 1 }),
        axis('ky', 'reciprocal-space', 4, { type: 'linear', origin: -1.5, step: 1 }),
      ]),
    )

    const diffraction = normalizeScientificPlaneReadRequest(descriptor, {
      displayAxes: ['kx', 'ky'],
      fixedIndices: [
        { axisId: 'scanX', index: 2 },
        { axisId: 'scanY', index: 1 },
      ],
    })
    const scan = normalizeScientificPlaneReadRequest(descriptor, {
      displayAxes: ['scanX', 'scanY'],
      fixedIndices: [
        { axisId: 'kx', index: 3 },
        { axisId: 'ky', index: 2 },
      ],
    })

    expect([diffraction.width, diffraction.height]).toEqual([5, 4])
    expect([scan.width, scan.height]).toEqual([3, 2])
  })

  it('supports X/Y/energy and X/Y/channel/time selections', () => {
    const energy = normalizeScientificDatasetDescriptor(
      descriptorInput([
        axis('x', 'space', 3),
        axis('y', 'space', 2),
        axis('energy', 'spectral', 4, { type: 'lookup', values: [10, 11, 13, 17] }),
      ]),
    )
    const timeSeries = normalizeScientificDatasetDescriptor(
      descriptorInput([
        axis('x', 'space', 3),
        axis('y', 'space', 2),
        axis('channel', 'channel', 2, { type: 'labels', values: ['DAPI', 'FITC'] }),
        axis('time', 'time', 3, { type: 'linear', origin: 0, step: 1 }),
      ]),
    )

    expect(
      normalizeScientificPlaneReadRequest(energy, {
        displayAxes: ['x', 'y'],
        fixedIndices: [{ axisId: 'energy', index: 2 }],
      }).fixedIndices,
    ).toEqual([{ axisId: 'energy', index: 2 }])
    expect(
      normalizeScientificPlaneReadRequest(timeSeries, {
        displayAxes: ['x', 'y'],
        fixedIndices: [
          { axisId: 'channel', index: 1 },
          { axisId: 'time', index: 2 },
        ],
      }).fixedIndices,
    ).toEqual([
      { axisId: 'channel', index: 1 },
      { axisId: 'time', index: 2 },
    ])
  })

  const invalidRequests: readonly (readonly [string, ScientificPlaneReadRequest])[] = [
    [
      'unknown display axes',
      { displayAxes: ['x', 'unknown'], fixedIndices: [{ axisId: 'z', index: 0 }] },
    ],
    [
      'repeated display axes',
      { displayAxes: ['x', 'x'], fixedIndices: [{ axisId: 'z', index: 0 }] },
    ],
    ['missing fixed axes', { displayAxes: ['x', 'y'], fixedIndices: [] }],
    [
      'out-of-range fixed indices',
      { displayAxes: ['x', 'y'], fixedIndices: [{ axisId: 'z', index: 2 }] },
    ],
    ['fixed display axes', { displayAxes: ['x', 'y'], fixedIndices: [{ axisId: 'x', index: 0 }] }],
    [
      'duplicate fixed axes',
      {
        displayAxes: ['x', 'y'],
        fixedIndices: [
          { axisId: 'z', index: 0 },
          { axisId: 'z', index: 0 },
        ],
      },
    ],
    [
      'outside regions',
      {
        displayAxes: ['x', 'y'],
        fixedIndices: [{ axisId: 'z', index: 0 }],
        x: 3,
        width: 2,
      },
    ],
    [
      'unknown levels',
      {
        displayAxes: ['x', 'y'],
        fixedIndices: [{ axisId: 'z', index: 0 }],
        resolutionLevel: 1,
      },
    ],
  ]

  it.each(invalidRequests)('rejects %s', (_name, request) => {
    const descriptor = normalizeScientificDatasetDescriptor(
      descriptorInput([axis('x', 'space', 4), axis('y', 'space', 3), axis('z', 'space', 2)]),
    )
    expect(() => normalizeScientificPlaneReadRequest(descriptor, request)).toThrow()
  })

  it('enforces the region-read capability', () => {
    const descriptor = normalizeScientificDatasetDescriptor(
      descriptorInput([axis('x', 'space', 4), axis('y', 'space', 3)], {
        capabilities: {
          regionReads: false,
          resolutionLevels: false,
          planeReads: { kind: 'any-axis-pair' },
        },
      }),
    )

    expect(() =>
      normalizeScientificPlaneReadRequest(descriptor, {
        displayAxes: ['x', 'y'],
        fixedIndices: [],
        width: 2,
      }),
    ).toThrow('does not support region reads')
    expect(
      normalizeScientificPlaneReadRequest(descriptor, {
        displayAxes: ['x', 'y'],
        fixedIndices: [],
      }),
    ).toMatchObject({ width: 4, height: 3 })
  })

  it('normalizes malformed JavaScript requests into validation errors', () => {
    const descriptor = normalizeScientificDatasetDescriptor(
      descriptorInput([axis('x', 'space', 4), axis('y', 'space', 3)]),
    )
    const malformed: readonly unknown[] = [
      {},
      { displayAxes: ['x'], fixedIndices: [] },
      { displayAxes: ['x', 'y'], fixedIndices: null },
      { displayAxes: ['x', 'y'], fixedIndices: [], signal: {} },
      { displayAxes: ['x', 'y'], fixedIndices: [], extra: true },
    ]

    for (const request of malformed) {
      expect(() => normalizeScientificPlaneReadRequest(descriptor, request)).toThrow()
    }
  })

  it('keeps reads lazy and propagates abort and block release contracts', async () => {
    const dataset = new SyntheticScientificDataset(
      descriptorInput([axis('x', 'space', 4), axis('y', 'space', 3)]),
    )
    const request = {
      displayAxes: ['x', 'y'],
      fixedIndices: [],
    } satisfies ScientificPlaneReadRequest
    const iterable = dataset.readPlane(request)
    expect(dataset.reads).toBe(0)

    const block = await firstBlock(dataset, request)
    expect(dataset.reads).toBe(1)
    expect([block.width, block.height, block.stride]).toEqual([4, 3, 4])
    block.release?.()
    expect(dataset.releases).toBe(1)

    const controller = new AbortController()
    controller.abort(new Error('cancel scientific read'))
    await expect(firstBlock(dataset, { ...request, signal: controller.signal })).rejects.toThrow(
      'cancel scientific read',
    )
    expect(iterable).toBeDefined()
  })
})

describe('ScientificDataset series requests', () => {
  it('rejects an unsupported plane pair before adapter I/O', async () => {
    let reads = 0
    const dataset: ScientificDataset = {
      descriptor: normalizeScientificDatasetDescriptor(
        descriptorInput([axis('x', 'space', 4), axis('y', 'space', 3)], {
          capabilities: {
            regionReads: true,
            resolutionLevels: false,
            planeReads: { kind: 'ordered-axis-pairs', pairs: [['x', 'y']] },
          },
        }),
      ),
      readPlane() {
        reads += 1
        return {
          async *[Symbol.asyncIterator]() {},
        }
      },
    }

    const read = async (): Promise<void> => {
      for await (const _block of readScientificSeriesFromPlane(dataset, ['y', 'x'], {
        axisId: 'y',
        fixedIndices: [{ axisId: 'x', index: 0 }],
      })) {
        // The unsupported pair must be rejected before the source is called.
      }
    }

    await expect(read()).rejects.toThrow('does not support plane axes y/x')
    expect(reads).toBe(0)
  })

  it('adapts bounded rows and columns from existing plane readers', async () => {
    const dataset = new SyntheticPlaneSeriesSource()
    const row: ScientificSeriesBlock[] = []
    for await (const block of readScientificSeriesFromPlane(dataset, ['x', 'y'], {
      axisId: 'x',
      fixedIndices: [{ axisId: 'y', index: 2 }],
      start: 1,
      length: 3,
    })) {
      row.push(block)
    }
    const column: ScientificSeriesBlock[] = []
    for await (const block of readScientificSeriesFromPlane(dataset, ['x', 'y'], {
      axisId: 'y',
      fixedIndices: [{ axisId: 'x', index: 2 }],
    })) {
      column.push(block)
    }

    expect(row.map(({ start, length, data }) => ({ start, length, data: [...data] }))).toEqual([
      { start: 1, length: 3, data: [0, 21, 0, 22, 0, 23] },
    ])
    expect(column.map(({ start, length, data }) => ({ start, length, data: [...data] }))).toEqual([
      { start: 0, length: 3, data: [0, 2, 0, 12, 0, 22] },
    ])
    expect(dataset.releases).toBe(2)
  })

  it('compacts padded planar components without changing canonical sample order', async () => {
    const blocks: ScientificSeriesBlock[] = []
    for await (const block of readScientificSeriesFromPlane(
      new SyntheticPlanarSeriesSource(),
      ['x', 'y'],
      {
        axisId: 'y',
        fixedIndices: [{ axisId: 'x', index: 1 }],
      },
    )) {
      blocks.push(block)
    }

    expect(
      blocks.map(({ start, length, format, data }) => ({
        start,
        length,
        format,
        data: [...data],
      })),
    ).toEqual([
      {
        start: 0,
        length: 2,
        format: { sampleType: 'uint8', channels: 2, planar: true },
        data: [1, 11, 101, 111],
      },
    ])
  })

  it('normalizes bounded one-dimensional reads without adding a fake display axis', () => {
    const descriptor = new SyntheticScientificSeriesDataset().descriptor

    expect(
      normalizeScientificSeriesReadRequest(descriptor, {
        axisId: 'energy',
        fixedIndices: [],
        start: 1,
        length: 3,
      }),
    ).toEqual({
      axisId: 'energy',
      fixedIndices: [],
      resolutionLevel: 0,
      start: 1,
      length: 3,
    })
  })

  it('uses the selected resolution-level length for one-dimensional reads', () => {
    const descriptor = normalizeScientificDatasetDescriptor({
      schemaVersion: 1,
      axes: [axis('energy', 'spectral', 4, { type: 'linear', origin: 100, step: 0.5 })],
      sampleType: 'uint16',
      components: [{ id: 'intensity', kind: 'intensity' }],
      levels: [
        { level: 0, axisLengths: [{ axisId: 'energy', length: 4 }] },
        { level: 1, axisLengths: [{ axisId: 'energy', length: 2 }] },
      ],
      capabilities: {
        regionReads: true,
        resolutionLevels: true,
        planeReads: { kind: 'none' },
        seriesReads: { kind: 'axes', axes: ['energy'] },
      },
    })

    expect(
      normalizeScientificSeriesReadRequest(descriptor, {
        axisId: 'energy',
        fixedIndices: [],
        resolutionLevel: 1,
      }),
    ).toMatchObject({ resolutionLevel: 1, start: 0, length: 2 })
  })

  it('fixes every other non-singleton axis for a selected series', () => {
    const descriptor = normalizeScientificDatasetDescriptor(
      descriptorInput(
        [axis('scan', 'space', 3), axis('energy', 'spectral', 5), axis('detector', 'channel', 1)],
        {
          capabilities: {
            regionReads: true,
            resolutionLevels: false,
            planeReads: { kind: 'ordered-axis-pairs', pairs: [['scan', 'energy']] },
            seriesReads: { kind: 'axes', axes: ['energy'] },
          },
        },
      ),
    )

    expect(
      normalizeScientificSeriesReadRequest(descriptor, {
        axisId: 'energy',
        fixedIndices: [{ axisId: 'scan', index: 2 }],
      }),
    ).toEqual({
      axisId: 'energy',
      fixedIndices: [
        { axisId: 'scan', index: 2 },
        { axisId: 'detector', index: 0 },
      ],
      resolutionLevel: 0,
      start: 0,
      length: 5,
    })
    expect(() =>
      normalizeScientificSeriesReadRequest(descriptor, {
        axisId: 'scan',
        fixedIndices: [{ axisId: 'energy', index: 0 }],
      }),
    ).toThrow('does not support series axis scan')
    expect(() =>
      normalizeScientificSeriesReadRequest(descriptor, {
        axisId: 'energy',
        fixedIndices: [],
      }),
    ).toThrow('must fix non-singleton axis scan')
  })

  it('rejects malformed, outside, and unsupported partial series requests', () => {
    const series = new SyntheticScientificSeriesDataset().descriptor
    const wholeOnly = normalizeScientificDatasetDescriptor({
      ...series,
      capabilities: { ...series.capabilities, regionReads: false },
    })

    expect(() =>
      normalizeScientificSeriesReadRequest(series, {
        axisId: 'energy',
        fixedIndices: [],
        start: 4,
        length: 2,
      }),
    ).toThrow('outside the selected resolution level')
    expect(() =>
      normalizeScientificSeriesReadRequest(series, {
        axisId: 'energy',
        fixedIndices: [{ axisId: 'energy', index: 0 }],
      }),
    ).toThrow('must not also be fixed')
    expect(() =>
      normalizeScientificSeriesReadRequest(wholeOnly, {
        axisId: 'energy',
        fixedIndices: [],
        length: 2,
      }),
    ).toThrow('does not support region reads')
    expect(() =>
      normalizeScientificSeriesReadRequest(series, {
        axisId: 'energy',
        fixedIndices: [],
        signal: {},
      }),
    ).toThrow('must be an AbortSignal')
  })

  it('keeps one-dimensional reads lazy and preserves abort and release ownership', async () => {
    const dataset = new SyntheticScientificSeriesDataset()
    const request = {
      axisId: 'energy',
      fixedIndices: [],
      start: 1,
      length: 3,
    } satisfies ScientificSeriesReadRequest
    const iterable = dataset.readSeries(request)
    expect(dataset.reads).toBe(0)

    const block = await firstSeriesBlock(dataset, request)
    expect(dataset.reads).toBe(1)
    expect([block.start, block.length]).toEqual([1, 3])
    expect([...block.data]).toEqual([0, 2, 0, 3, 0, 4])
    block.release?.()
    expect(dataset.releases).toBe(1)

    const controller = new AbortController()
    controller.abort(new Error('cancel scientific series read'))
    await expect(
      firstSeriesBlock(dataset, { ...request, signal: controller.signal }),
    ).rejects.toThrow('cancel scientific series read')
    expect(iterable).toBeDefined()
  })
})
