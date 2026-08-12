import { describe, expect, it } from 'vitest'
import {
  canonicalRoiJson,
  canonicalRoiSemanticsJson,
  canonicalRoiSetJson,
  clipRoiBoundingBox,
  createRoiValueTypeDefinitions,
  normalizeRoi,
  normalizeRoiSet,
  physicalToPixelPoint,
  pixelToPhysicalPoint,
  roiBoundingBox,
  roiValueTypeId,
  validateRoi,
} from '../src/analysis/index.ts'
import { normalizeScientificDatasetDescriptor } from '../src/scientific/index.ts'

const descriptor = normalizeScientificDatasetDescriptor({
  schemaVersion: 2,
  axes: [
    {
      id: 'x',
      kind: 'space',
      length: 5,
      unit: 'um',
      coordinates: { type: 'linear', origin: 10, step: 2 },
    },
    {
      id: 'y',
      kind: 'space',
      length: 4,
      unit: 'um',
      coordinates: { type: 'lookup', values: [30, 20, 10, 0] },
    },
    { id: 'scanX', kind: 'space', length: 3, coordinates: { type: 'index' } },
    { id: 'scanY', kind: 'space', length: 2, coordinates: { type: 'index' } },
    { id: 'channel', kind: 'channel', length: 1, coordinates: { type: 'labels', values: ['I'] } },
  ],
  sampleType: 'float32',
  components: [{ id: 'value', kind: 'scalar' }],
  capabilities: { regionReads: true, resolutionLevels: false },
})

const fixedIndices = [
  { axisId: 'scanX', index: 1 },
  { axisId: 'scanY', index: 0 },
]

const base = {
  schemaVersion: 1,
  id: 'roi-1',
  axisIds: ['x', 'y'],
  fixedIndices,
  coordinateSpace: 'pixel',
}

describe('ROI geometry and calibrated coordinates', () => {
  it('normalizes every geometry and explicit 4D-STEM fixed indices', () => {
    const geometries: readonly unknown[] = [
      { kind: 'point', point: { x: 0.5, y: 1.5 } },
      { kind: 'line-segment', start: { x: 0.5, y: 0.5 }, end: { x: 2.5, y: 1.5 } },
      {
        kind: 'polyline',
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 2 },
          { x: 3, y: 2 },
        ],
      },
      { kind: 'rectangle', x: 0, y: 1, width: 2, height: 3 },
      { kind: 'ellipse', center: { x: 2, y: 2 }, radiusX: 1, radiusY: 0.5 },
      {
        kind: 'polygon',
        points: [
          { x: 0, y: 0 },
          { x: 3, y: 0 },
          { x: 1, y: 2 },
        ],
      },
    ]
    for (let index = 0; index < geometries.length; index += 1) {
      const roi = normalizeRoi(
        { ...base, id: `roi-${index}`, geometry: geometries[index] },
        descriptor,
      )
      expect(roi.geometry).toEqual(geometries[index])
      expect(roi.fixedIndices).toEqual(fixedIndices)
      expect(Object.isFrozen(roi)).toBe(true)
    }
  })

  it('maps pixel centers through exact linear and descending lookup calibration', () => {
    expect(pixelToPhysicalPoint(descriptor, ['x', 'y'], { x: 0.5, y: 0.5 })).toEqual({
      point: { x: 10, y: 30 },
      units: ['um', 'um'],
    })
    expect(pixelToPhysicalPoint(descriptor, ['x', 'y'], { x: 1.5, y: 1.5 }).point).toEqual({
      x: 12,
      y: 20,
    })
    expect(physicalToPixelPoint(descriptor, ['x', 'y'], { x: 12, y: 20 }, ['um', 'um'])).toEqual({
      x: 1.5,
      y: 1.5,
    })
    expect(() =>
      physicalToPixelPoint(descriptor, ['x', 'y'], { x: 12, y: 20 }, ['nm', 'um']),
    ).toThrow('exactly match')
  })

  it('rejects missing or out-of-range fixed indices, duplicate ids, and invalid geometry', () => {
    expect(
      validateRoi(
        { ...base, fixedIndices: [], geometry: { kind: 'point', point: { x: 1, y: 1 } } },
        descriptor,
      ),
    ).toMatchObject({
      valid: false,
      issues: [{ code: 'missing-required', path: '/fixedIndices' }],
    })
    expect(() =>
      normalizeRoi(
        {
          ...base,
          fixedIndices: [
            { axisId: 'scanX', index: 3 },
            { axisId: 'scanY', index: 0 },
          ],
          geometry: { kind: 'point', point: { x: 1, y: 1 } },
        },
        descriptor,
      ),
    ).toThrow('outside axis scanX')
    expect(() =>
      normalizeRoi(
        { ...base, geometry: { kind: 'rectangle', x: 0, y: 0, width: 0, height: 1 } },
        descriptor,
      ),
    ).toThrow('positive')
    expect(() =>
      normalizeRoi(
        {
          ...base,
          geometry: {
            kind: 'polygon',
            points: [
              { x: 0, y: 0 },
              { x: 1, y: 1 },
            ],
          },
        },
        descriptor,
      ),
    ).toThrow('at least 3')
    expect(() =>
      normalizeRoiSet(
        {
          schemaVersion: 1,
          rois: [
            { ...base, geometry: { kind: 'point', point: { x: 1, y: 1 } } },
            { ...base, geometry: { kind: 'point', point: { x: 2, y: 2 } } },
          ],
        },
        descriptor,
      ),
    ).toThrow('Duplicate ROI id')
  })

  it('requires monotonic physical axes and exact declared units', () => {
    const nonMonotonic = normalizeScientificDatasetDescriptor({
      ...descriptor,
      axes: descriptor.axes.map((axis) =>
        axis.id === 'y' ? { ...axis, coordinates: { type: 'lookup', values: [0, 2, 1, 3] } } : axis,
      ),
    })
    const physical = {
      ...base,
      coordinateSpace: 'physical',
      units: ['um', 'um'],
      geometry: { kind: 'point', point: { x: 10, y: 20 } },
    }
    expect(() => normalizeRoi(physical, nonMonotonic)).toThrow('invertible')
    expect(() => normalizeRoi({ ...physical, units: ['nm', 'um'] }, descriptor)).toThrow(
      'does not match',
    )
  })

  it('computes and clips pixel and physical bounds with descending axes', () => {
    const roi = normalizeRoi(
      { ...base, geometry: { kind: 'rectangle', x: -1, y: 0.5, width: 3, height: 2 } },
      descriptor,
    )
    expect(roiBoundingBox(roi, descriptor)).toEqual({ xMin: -1, yMin: 0.5, xMax: 2, yMax: 2.5 })
    expect(roiBoundingBox(roi, descriptor, 'physical')).toEqual({
      xMin: 7,
      yMin: 10,
      xMax: 13,
      yMax: 30,
    })
    const bounds = roiBoundingBox(roi, descriptor)
    if (bounds === undefined) throw new Error('Expected pixel bounds')
    expect(clipRoiBoundingBox(bounds, 5, 4)).toEqual({
      xMin: 0,
      yMin: 0.5,
      xMax: 2,
      yMax: 2.5,
    })
    expect(() => clipRoiBoundingBox({ xMin: 2, yMin: 0, xMax: 1, yMax: 1 }, 5, 4)).toThrow(
      'finite and ordered',
    )
    expect(() => clipRoiBoundingBox({ xMin: 0, yMin: 0, xMax: Number.NaN, yMax: 1 }, 5, 4)).toThrow(
      'finite and ordered',
    )
  })

  it('canonicalizes storage while excluding presentation from quantitative semantics', () => {
    const first = {
      ...base,
      name: 'First name',
      presentation: { label: 'Visible label', style: { color: '#ff0000', width: 2 } },
      geometry: { kind: 'point', point: { y: 1.5, x: 0.5 } },
    }
    const second = {
      ...first,
      name: 'Renamed',
      presentation: { label: 'Another label', style: { color: '#00ff00' } },
    }
    expect(canonicalRoiJson(first, descriptor)).not.toBe(canonicalRoiJson(second, descriptor))
    expect(canonicalRoiSemanticsJson(first, descriptor)).toBe(
      canonicalRoiSemanticsJson(second, descriptor),
    )
    expect(canonicalRoiJson(first, descriptor)).toContain('"point":{"x":0.5,"y":1.5}')
    expect(canonicalRoiSetJson({ schemaVersion: 1, rois: [first] }, descriptor)).toContain(
      '"schemaVersion":1',
    )
  })

  it('enforces hostile point, magnitude, metadata, and set limits', () => {
    expect(() =>
      normalizeRoi(
        {
          ...base,
          get geometry() {
            return { kind: 'point', point: { x: 0, y: 0 } }
          },
        },
        descriptor,
      ),
    ).toThrow('JSON data property')
    expect(() =>
      normalizeRoi(
        {
          ...base,
          geometry: {
            kind: 'polygon',
            points: [
              { x: 0, y: 0 },
              { x: 1, y: 0 },
              { x: 1, y: 1 },
              { x: 0, y: 1 },
            ],
          },
        },
        descriptor,
        { maxPointsPerGeometry: 3 },
      ),
    ).toThrow('maxPointsPerGeometry')
    expect(() =>
      normalizeRoi({ ...base, geometry: { kind: 'point', point: { x: 101, y: 0 } } }, descriptor, {
        maxCoordinateMagnitude: 100,
      }),
    ).toThrow('maxCoordinateMagnitude')
    expect(() =>
      normalizeRoi(
        {
          ...base,
          geometry: { kind: 'point', point: { x: 1, y: 1 } },
          presentation: { style: { nested: { too: { deep: true } } } },
        },
        descriptor,
        { maxMetadataDepth: 2 },
      ),
    ).toThrow('nesting limit')
    expect(() =>
      normalizeRoiSet({ schemaVersion: 1, rois: [] }, descriptor, {
        maxRois: 1,
        maxMetadataBytes: 1,
      }),
    ).not.toThrow()
    expect(() =>
      normalizeRoi(
        {
          ...base,
          geometry: { kind: 'point', point: { x: 1, y: 1 } },
          presentation: { label: 'too large' },
        },
        descriptor,
        { maxMetadataBytes: 4 },
      ),
    ).toThrow('maxMetadataBytes')
    expect(() =>
      normalizeRoiSet(
        {
          schemaVersion: 1,
          rois: [
            { ...base, geometry: { kind: 'point', point: { x: 1, y: 1 } } },
            {
              ...base,
              id: 'roi-2',
              geometry: { kind: 'point', point: { x: 2, y: 2 } },
            },
          ],
        },
        descriptor,
        { maxRois: 1 },
      ),
    ).toThrow('maxRois')
  })

  it('keeps value-type validation aligned with configured ROI point limits', () => {
    const definition = createRoiValueTypeDefinitions(descriptor, {
      maxPointsPerGeometry: 20_000,
    }).find((entry) => entry.descriptor.id === roiValueTypeId)
    const result = definition?.validate?.({
      ...base,
      geometry: {
        kind: 'polygon',
        points: Array.from({ length: 16_385 }, (_, index) => ({
          x: index % 2,
          y: Math.floor(index / 2) % 2,
        })),
      },
    })
    expect(result?.valid).toBe(true)
    expect(result?.value).toBeDefined()
  })
})
