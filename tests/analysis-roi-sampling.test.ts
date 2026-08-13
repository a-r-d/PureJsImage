import { describe, expect, it } from 'vitest'
import { createRoiLineSamplingPlan, createRoiMask, normalizeRoi } from '../src/analysis/index.ts'
import type { Roi } from '../src/analysis/index.ts'
import { normalizeScientificDatasetDescriptor } from '../src/scientific/index.ts'

const descriptor = normalizeScientificDatasetDescriptor({
  schemaVersion: 2,
  axes: [
    {
      id: 'x',
      kind: 'space',
      length: 6,
      unit: 'um',
      coordinates: { type: 'linear', origin: 0, step: 2 },
    },
    {
      id: 'y',
      kind: 'space',
      length: 5,
      unit: 'um',
      coordinates: { type: 'lookup', values: [8, 6, 4, 2, 0] },
    },
  ],
  sampleType: 'float32',
  components: [{ id: 'value', kind: 'scalar' }],
  capabilities: {
    regionReads: true,
    resolutionLevels: false,
    planeReads: { kind: 'any-axis-pair' },
  },
})

const roi = (geometry: unknown, extra: Readonly<Record<string, unknown>> = {}): Roi =>
  normalizeRoi(
    {
      schemaVersion: 1,
      id: 'roi',
      axisIds: ['x', 'y'],
      fixedIndices: [],
      coordinateSpace: 'pixel',
      geometry,
      ...extra,
    },
    descriptor,
  )

const mask = (value: Roi, tile: { x: number; y: number; width: number; height: number }) =>
  createRoiMask(value, descriptor, { plane: { width: 6, height: 5 }, tile })

describe('tile-local ROI masks', () => {
  it('includes polygon boundaries on pixel centers with the even-odd rule', () => {
    const value = roi({
      kind: 'polygon',
      points: [
        { x: 0.5, y: 0.5 },
        { x: 2.5, y: 0.5 },
        { x: 2.5, y: 2.5 },
        { x: 0.5, y: 2.5 },
      ],
    })
    expect([...mask(value, { x: 0, y: 0, width: 4, height: 4 }).data]).toEqual([
      1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 0, 0, 0, 0,
    ])
  })

  it('fills concave polygons identically across tile partitions', () => {
    const value = roi({
      kind: 'polygon',
      points: [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 5, y: 2 },
        { x: 2, y: 2 },
        { x: 2, y: 5 },
        { x: 0, y: 5 },
      ],
    })
    const whole = mask(value, { x: 0, y: 0, width: 6, height: 5 })
    const combined = new Uint8Array(30)
    for (const tile of [
      { x: 0, y: 0, width: 3, height: 2 },
      { x: 3, y: 0, width: 3, height: 2 },
      { x: 0, y: 2, width: 3, height: 3 },
      { x: 3, y: 2, width: 3, height: 3 },
    ]) {
      const part = mask(value, tile)
      for (let y = 0; y < part.height; y += 1) {
        for (let x = 0; x < part.width; x += 1) {
          combined[(tile.y + y) * 6 + tile.x + x] = part.data[y * part.stride + x] ?? 0
        }
      }
    }
    expect(combined).toEqual(whole.data)
  })

  it('uses inclusive ellipse boundaries and clips off-image tiles', () => {
    const value = roi({ kind: 'ellipse', center: { x: 1.5, y: 1.5 }, radiusX: 1, radiusY: 1 })
    expect([...mask(value, { x: 0, y: 0, width: 3, height: 3 }).data]).toEqual([
      0, 1, 0, 1, 1, 1, 0, 1, 0,
    ])
    expect([...mask(value, { x: -3, y: -2, width: 2, height: 2 }).data]).toEqual([0, 0, 0, 0])
  })

  it('evaluates physical rectangle boundaries on descending calibration', () => {
    const value = normalizeRoi(
      {
        schemaVersion: 1,
        id: 'physical-rectangle',
        axisIds: ['x', 'y'],
        fixedIndices: [],
        coordinateSpace: 'physical',
        units: ['um', 'um'],
        geometry: { kind: 'rectangle', x: 0, y: 2, width: 4, height: 4 },
      },
      descriptor,
    )
    expect([...mask(value, { x: 0, y: 0, width: 4, height: 5 }).data]).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0,
    ])
  })

  it('rejects holes, non-area geometry, oversized masks, and cancellation', () => {
    expect(() =>
      roi({
        kind: 'polygon',
        points: [
          { x: 0, y: 0 },
          { x: 2, y: 0 },
          { x: 1, y: 1 },
        ],
        holes: [[{ x: 0, y: 0 }]],
      }),
    ).toThrow('Unknown field holes')
    expect(() =>
      mask(roi({ kind: 'point', point: { x: 1, y: 1 } }), { x: 0, y: 0, width: 2, height: 2 }),
    ).toThrow('not an area mask')
    expect(() =>
      createRoiMask(roi({ kind: 'rectangle', x: 0, y: 0, width: 2, height: 2 }), descriptor, {
        plane: { width: 6, height: 5 },
        tile: { x: 0, y: 0, width: 2, height: 2 },
        maxMaskPixels: 3,
      }),
    ).toThrow('maxMaskPixels')
    const controller = new AbortController()
    controller.abort(new Error('stop mask'))
    expect(() =>
      createRoiMask(roi({ kind: 'rectangle', x: 0, y: 0, width: 2, height: 2 }), descriptor, {
        plane: { width: 6, height: 5 },
        tile: { x: 0, y: 0, width: 2, height: 2 },
        signal: controller.signal,
      }),
    ).toThrow('stop mask')
  })
})

describe('deterministic ROI line sampling plans', () => {
  it('builds nearest plans using pixel-center coordinates', () => {
    const plan = createRoiLineSamplingPlan(
      roi({ kind: 'line-segment', start: { x: 0.5, y: 0.5 }, end: { x: 3.5, y: 0.5 } }),
      descriptor,
      { spacing: 1, spacingSpace: 'pixel', interpolation: 'nearest' },
    )
    expect(plan.sampleCount).toBe(4)
    expect([...plan.distances]).toEqual([0, 1, 2, 3])
    expect([...plan.pixelCoordinates]).toEqual([0.5, 0.5, 1.5, 0.5, 2.5, 0.5, 3.5, 0.5])
    expect(plan.sampling.interpolation).toBe('nearest')
    if (plan.sampling.interpolation === 'nearest') {
      expect([...plan.sampling.indices]).toEqual([0, 0, 1, 0, 2, 0, 3, 0])
    }
    expect([...(plan.physicalCoordinates ?? [])]).toEqual([0, 8, 2, 8, 4, 8, 6, 8])
  })

  it('builds bilinear weights relative to pixel centers', () => {
    const plan = createRoiLineSamplingPlan(
      roi({ kind: 'line-segment', start: { x: 1, y: 1 }, end: { x: 2, y: 1 } }),
      descriptor,
      { spacing: 1, spacingSpace: 'pixel', interpolation: 'bilinear' },
    )
    expect(plan.sampling.interpolation).toBe('bilinear')
    if (plan.sampling.interpolation === 'bilinear') {
      expect([...plan.sampling.indices.slice(0, 4)]).toEqual([0, 0, 1, 1])
      expect([...plan.sampling.weights.slice(0, 4)]).toEqual([0.25, 0.25, 0.25, 0.25])
    }
  })

  it('supports descending calibrated axes and physical-distance spacing', () => {
    const physical = normalizeRoi(
      {
        schemaVersion: 1,
        id: 'physical-line',
        axisIds: ['x', 'y'],
        fixedIndices: [],
        coordinateSpace: 'physical',
        units: ['um', 'um'],
        geometry: { kind: 'line-segment', start: { x: 0, y: 8 }, end: { x: 0, y: 0 } },
      },
      descriptor,
    )
    const plan = createRoiLineSamplingPlan(physical, descriptor, {
      spacing: 2,
      spacingSpace: 'physical',
      interpolation: 'nearest',
    })
    expect(plan.distanceUnit).toBe('um')
    expect([...(plan.physicalCoordinates ?? [])]).toEqual([0, 8, 0, 6, 0, 4, 0, 2, 0, 0])
    expect([...plan.pixelCoordinates]).toEqual([0.5, 0.5, 0.5, 1.5, 0.5, 2.5, 0.5, 3.5, 0.5, 4.5])
  })

  it('bounds samples and observes cancellation', () => {
    const value = roi({
      kind: 'polyline',
      points: [
        { x: 0.5, y: 0.5 },
        { x: 5.5, y: 0.5 },
      ],
    })
    expect(() =>
      createRoiLineSamplingPlan(value, descriptor, {
        spacing: 0.01,
        spacingSpace: 'pixel',
        interpolation: 'nearest',
        maxSamples: 10,
      }),
    ).toThrow('maxSamples')
    const controller = new AbortController()
    controller.abort(new Error('stop line'))
    expect(() =>
      createRoiLineSamplingPlan(value, descriptor, {
        spacing: 1,
        spacingSpace: 'pixel',
        interpolation: 'nearest',
        signal: controller.signal,
      }),
    ).toThrow('stop line')
    expect(() =>
      Reflect.apply(createRoiLineSamplingPlan, undefined, [
        value,
        descriptor,
        {
          spacing: 1,
          spacingSpace: 'pixel',
          interpolation: 'cubic',
        },
      ]),
    ).toThrow('interpolation')
  })

  it('preserves exact integer indices beyond the signed 32-bit range', () => {
    const plan = createRoiLineSamplingPlan(
      roi({
        kind: 'line-segment',
        start: { x: 3_000_000_000.5, y: 0.5 },
        end: { x: 3_000_000_001.5, y: 0.5 },
      }),
      descriptor,
      { spacing: 1, spacingSpace: 'pixel', interpolation: 'nearest' },
    )
    expect(plan.sampling.interpolation).toBe('nearest')
    if (plan.sampling.interpolation === 'nearest') {
      expect([...plan.sampling.indices]).toEqual([3_000_000_000, 0, 3_000_000_001, 0])
    }
  })

  it('rejects sampling coordinates outside the safe integer range', () => {
    const physicalDescriptor = normalizeScientificDatasetDescriptor({
      ...descriptor,
      axes: descriptor.axes.map((entry) => ({
        ...entry,
        coordinates: { type: 'linear' as const, origin: 0, step: 1e-20 },
      })),
    })
    const value = normalizeRoi(
      {
        schemaVersion: 1,
        id: 'unsafe-index-line',
        axisIds: ['x', 'y'],
        fixedIndices: [],
        coordinateSpace: 'physical',
        units: ['um', 'um'],
        geometry: {
          kind: 'line-segment',
          start: { x: 1, y: 1 },
          end: { x: 2, y: 1 },
        },
      },
      physicalDescriptor,
    )
    expect(() =>
      createRoiLineSamplingPlan(value, physicalDescriptor, {
        spacing: 1,
        spacingSpace: 'physical',
        interpolation: 'nearest',
      }),
    ).toThrow('safe integer range')
  })

  it('keeps pixel-distance plans available when physical calibration does not exist', () => {
    const indexDescriptor = normalizeScientificDatasetDescriptor({
      ...descriptor,
      axes: descriptor.axes.map((entry) => ({
        ...entry,
        coordinates: { type: 'index' as const },
      })),
    })
    const value = normalizeRoi(
      {
        schemaVersion: 1,
        id: 'index-line',
        axisIds: ['x', 'y'],
        fixedIndices: [],
        coordinateSpace: 'pixel',
        geometry: {
          kind: 'line-segment',
          start: { x: 0.5, y: 0.5 },
          end: { x: 2.5, y: 0.5 },
        },
      },
      indexDescriptor,
    )
    const plan = createRoiLineSamplingPlan(value, indexDescriptor, {
      spacing: 1,
      spacingSpace: 'pixel',
      interpolation: 'nearest',
    })
    expect(plan.physicalCoordinates).toBeNull()
    expect(() =>
      createRoiLineSamplingPlan(value, indexDescriptor, {
        spacing: 1,
        spacingSpace: 'physical',
        interpolation: 'nearest',
      }),
    ).toThrow('calibration')
  })
})
