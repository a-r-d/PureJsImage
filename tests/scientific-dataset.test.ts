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
} from '../src/scientific/index.ts'
import {
  normalizeScientificDatasetDescriptor,
  normalizeScientificPlaneReadRequest,
  supportsScientificPlaneRead,
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

const firstBlock = async (
  dataset: ScientificDataset,
  request: Readonly<ScientificPlaneReadRequest>,
): Promise<RasterBlock> => {
  for await (const block of dataset.readPlane(request)) return block
  throw new Error('Synthetic scientific dataset returned no block')
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
