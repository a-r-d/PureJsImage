import { describe, expect, it } from 'vitest'
import {
  computeRasterRegionStatistics,
  createNormalizedDifferencePlan,
  createRasterBandMathPlan,
  createRasterLineProfilePlan,
  createRasterRegionStatisticsPlan,
  createRasterTargetGridPlan,
  createRasterTerrainPlan,
  evaluateRasterBandMathTile,
  evaluateRasterTerrainTile,
  resampleRasterTileToGrid,
  sampleRasterLineProfile,
  type NumericRasterGrid,
  type RasterCoordinateTransform,
} from '../src/analysis/index.ts'
import type { NumericSampleType, NumericTile } from '../src/scientific/index.ts'

const tile = (
  width: number,
  height: number,
  components: number,
  sample: (x: number, y: number, component: number) => number,
  options: Readonly<{ x?: number; y?: number; sampleType?: NumericSampleType }> = {},
): NumericTile => {
  const data = new Float32Array(width * height * components)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      for (let component = 0; component < components; component += 1) {
        data[(y * width + x) * components + component] = sample(x, y, component)
      }
    }
  }
  return Object.freeze({
    x: options.x ?? 0,
    y: options.y ?? 0,
    width,
    height,
    sampleType: options.sampleType ?? 'float32',
    componentCount: components,
    layout: 'interleaved',
    rowStrideElements: width * components,
    data,
    release() {},
  })
}

const values = (value: NumericTile): readonly number[] => {
  const result: number[] = []
  for (let index = 0; index < value.data.length; index += 1) {
    result.push(Number(value.data[index] ?? 0))
  }
  return result
}

const grid = (overrides: Partial<NumericRasterGrid> = {}): NumericRasterGrid => ({
  schemaVersion: 1,
  crs: 'EPSG:32616',
  width: 3,
  height: 3,
  affine: [1, 0, 0, 0, 1, 0],
  pixelInterpretation: 'point',
  extent: [0, 0, 2, 2],
  sampleType: 'float32',
  noData: { kind: 'nan' },
  resampling: 'nearest',
  ...overrides,
})

describe('bounded raster band math', () => {
  it('parses and evaluates exact expressions with raw and scaled inputs', () => {
    const source = tile(2, 1, 2, (x, _y, component) => (component === 0 ? x + 1 : x + 3))
    const plan = createRasterBandMathPlan({
      expression: 'max(red * 2, nir) + 1',
      inputs: [
        { name: 'red', component: 0, valueMode: 'raw' },
        { name: 'nir', component: 1, valueMode: 'scaled', scale: 10, offset: -1 },
      ],
      outputSampleType: 'float64',
    })
    expect(plan.ast.kind).toBe('binary')
    expect(values(evaluateRasterBandMathTile(plan, [source, source]))).toEqual([30, 40])
  })

  it('defines divide-by-zero, non-finite, clamp, and nodata behavior', () => {
    const numerator = tile(3, 1, 1, (x) => [2, -999, 8][x] ?? 0)
    const denominator = tile(3, 1, 1, (x) => [0, 2, 2][x] ?? 0)
    const plan = createRasterBandMathPlan({
      expression: 'a / b',
      inputs: [
        { name: 'a', valueMode: 'raw', noData: { kind: 'value', value: -999 } },
        { name: 'b', valueMode: 'raw' },
      ],
      outputNoData: { kind: 'value', value: -1 },
      clamp: [0, 3],
    })
    expect(values(evaluateRasterBandMathTile(plan, [numerator, denominator]))).toEqual([-1, -1, 3])

    const zeroPlan = createRasterBandMathPlan({
      expression: 'a / b',
      inputs: [
        { name: 'a', valueMode: 'raw' },
        { name: 'b', valueMode: 'raw' },
      ],
      divideByZero: 'zero',
    })
    expect(values(evaluateRasterBandMathTile(zeroPlan, [numerator, denominator]))[0]).toBe(0)
  })

  it('provides normalized difference and bounded parser/cancellation failures', () => {
    const left = tile(2, 1, 1, (x) => x + 3)
    const right = tile(2, 1, 1, () => 1)
    const plan = createNormalizedDifferencePlan(
      { name: 'nir', valueMode: 'raw' },
      { name: 'red', valueMode: 'raw' },
    )
    expect(values(evaluateRasterBandMathTile(plan, [left, right]))).toEqual([
      0.5, 0.6000000238418579,
    ])
    expect(() =>
      createRasterBandMathPlan({
        expression: 'unknown + 1',
        inputs: [{ name: 'known', valueMode: 'raw' }],
      }),
    ).toThrow(/Unknown band-math identifier/u)
    expect(() =>
      createRasterBandMathPlan({
        expression: '((((known))))',
        inputs: [{ name: 'known', valueMode: 'raw' }],
        limits: { maxExpressionDepth: 3 },
      }),
    ).toThrow(/maxExpressionDepth/u)
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    expect(() =>
      evaluateRasterBandMathTile(plan, [left, right], undefined, { signal: controller.signal }),
    ).toThrow('cancelled')
    expect(() =>
      evaluateRasterBandMathTile(plan, [left, right], undefined, { limits: { maxTilePixels: 1 } }),
    ).toThrow(/maxTilePixels/u)
  })
})

describe('bounded raster terrain', () => {
  const plane = tile(7, 7, 1, (x, y) => x + 2 * y)
  const common = {
    sourceWidth: 7,
    sourceHeight: 7,
    xSpacing: 1,
    ySpacing: 1,
    xUnit: { kind: 'metre' } as const,
    yUnit: { kind: 'metre' } as const,
    verticalUnit: { kind: 'metre' } as const,
    rowDirection: 'north' as const,
  }

  it('matches known planar slope, aspect, and hillshade conventions', () => {
    const region = { x: 1, y: 1, width: 5, height: 5 }
    const slope = evaluateRasterTerrainTile(
      createRasterTerrainPlan({ operation: 'slope', slopeUnit: 'degrees', ...common }),
      plane,
      region,
    )
    const aspect = evaluateRasterTerrainTile(
      createRasterTerrainPlan({ operation: 'aspect', ...common }),
      plane,
      region,
    )
    const hillshade = evaluateRasterTerrainTile(
      createRasterTerrainPlan({
        operation: 'hillshade',
        azimuthDegrees: 225,
        altitudeDegrees: 45,
        ...common,
      }),
      plane,
      region,
    )
    expect(Number(slope.data[12])).toBeCloseTo((Math.atan(Math.sqrt(5)) * 180) / Math.PI, 5)
    expect(Number(aspect.data[12])).toBeCloseTo(206.565051, 5)
    const length = Math.sqrt(6)
    const expected =
      255 * ((-1 / length) * -0.5 + (-2 / length) * -0.5 + (1 / length) * Math.SQRT1_2)
    expect(Number(hillshade.data[12])).toBeCloseTo(expected, 4)
  })

  it('is tile-edge invariant with halos and avoids nodata contamination', () => {
    const plan = createRasterTerrainPlan({ operation: 'slope', ...common })
    const full = evaluateRasterTerrainTile(plan, plane, { x: 1, y: 1, width: 5, height: 5 })
    const leftSource = tile(4, 7, 1, (x, y) => x + 2 * y)
    const rightSource = tile(5, 7, 1, (x, y) => x + 2 + 2 * y, { x: 2 })
    const left = evaluateRasterTerrainTile(plan, leftSource, { x: 1, y: 1, width: 2, height: 5 })
    const right = evaluateRasterTerrainTile(plan, rightSource, { x: 3, y: 1, width: 3, height: 5 })
    expect([...values(left), ...values(right)]).toHaveLength(values(full).length)
    for (const value of [...values(left), ...values(right)]) {
      expect(value).toBeCloseTo(Number(full.data[0]), 6)
    }

    const nodataPlane = tile(5, 5, 1, (x, y) => (x === 2 && y === 2 ? -999 : x))
    const nodata = evaluateRasterTerrainTile(
      createRasterTerrainPlan({
        ...common,
        operation: 'slope',
        inputNoData: { kind: 'value', value: -999 },
        sourceWidth: 5,
        sourceHeight: 5,
      }),
      nodataPlane,
      { x: 1, y: 1, width: 3, height: 3 },
    )
    expect(Number.isNaN(Number(nodata.data[4]))).toBe(true)
    expect(Number.isFinite(Number(nodata.data[3]))).toBe(true)
  })

  it('converts declared units and observes cancellation', () => {
    const metreSlope = evaluateRasterTerrainTile(
      createRasterTerrainPlan({ operation: 'slope', ...common }),
      plane,
      { x: 1, y: 1, width: 1, height: 1 },
    )
    const surveyFootSlope = evaluateRasterTerrainTile(
      createRasterTerrainPlan({
        operation: 'slope',
        ...common,
        xSpacing: 1 / (1200 / 3937),
        ySpacing: 1 / (1200 / 3937),
        xUnit: { kind: 'us-survey-foot' },
        yUnit: { kind: 'us-survey-foot' },
      }),
      plane,
      { x: 1, y: 1, width: 1, height: 1 },
    )
    expect(Number(surveyFootSlope.data[0])).toBeCloseTo(Number(metreSlope.data[0]), 6)
    const controller = new AbortController()
    controller.abort(new Error('stop'))
    expect(() =>
      evaluateRasterTerrainTile(
        createRasterTerrainPlan({ operation: 'slope', ...common }),
        plane,
        { x: 1, y: 1, width: 1, height: 1 },
        { signal: controller.signal },
      ),
    ).toThrow('stop')
  })
})

describe('bounded raster reductions and sampling', () => {
  it('computes deterministic regional statistics and histograms', () => {
    const source = tile(3, 2, 1, (x, y) => (x === 2 && y === 1 ? -1 : y * 3 + x + 1))
    const result = computeRasterRegionStatistics(
      createRasterRegionStatisticsPlan({
        noData: { kind: 'value', value: -1 },
        histogram: { bins: 5, minimum: 1, maximum: 5 },
      }),
      source,
    )
    expect(result).toMatchObject({
      count: 5,
      invalidCount: 1,
      minimum: 1,
      maximum: 5,
      mean: 3,
      variance: 2,
    })
    expect(Array.from(result.histogram?.counts ?? [])).toEqual([1, 1, 1, 1, 1])
  })

  it('samples nearest and nodata-aware bilinear line profiles', () => {
    const source = tile(3, 3, 1, (x, y) => x + y * 3)
    const nearest = sampleRasterLineProfile(
      createRasterLineProfilePlan({
        start: { x: 0, y: 0 },
        end: { x: 2, y: 2 },
        sampleCount: 3,
      }),
      source,
    )
    expect(Array.from(nearest.values)).toEqual([0, 4, 8])
    expect(Array.from(nearest.distances)).toEqual([0, Math.SQRT2, 2 * Math.SQRT2])
    const bilinear = sampleRasterLineProfile(
      createRasterLineProfilePlan({
        start: { x: 0.5, y: 0.5 },
        end: { x: 0.5, y: 0.5 },
        sampleCount: 1,
        resampling: 'bilinear',
      }),
      source,
    )
    expect(bilinear.values[0]).toBe(2)
  })

  it('cancels bounded reductions and profiles before scanning', () => {
    const source = tile(3, 3, 1, (x, y) => x + y)
    const controller = new AbortController()
    controller.abort(new Error('stop'))
    expect(() =>
      computeRasterRegionStatistics(createRasterRegionStatisticsPlan(), source, undefined, {
        signal: controller.signal,
      }),
    ).toThrow('stop')
    expect(() =>
      sampleRasterLineProfile(
        createRasterLineProfilePlan({
          start: { x: 0, y: 0 },
          end: { x: 2, y: 2 },
          sampleCount: 3,
        }),
        source,
        { signal: controller.signal },
      ),
    ).toThrow('stop')
  })
})

describe('explicit target-grid resampling and reprojection', () => {
  const source = tile(3, 3, 1, (x, y) => x + y * 10)

  it('resamples a same-CRS target grid explicitly', () => {
    const plan = createRasterTargetGridPlan({
      sourceGrid: grid(),
      targetGrid: grid({ affine: [1, 0, 0.5, 0, 1, 0.5], resampling: 'bilinear' }),
      resampling: 'bilinear',
    })
    const result = resampleRasterTileToGrid(plan, source, { x: 0, y: 0, width: 2, height: 2 })
    expect(values(result)).toEqual([5.5, 6.5, 15.5, 16.5])
  })

  it('requires and records cross-CRS inverse transforms', () => {
    expect(() =>
      createRasterTargetGridPlan({
        sourceGrid: grid(),
        targetGrid: grid({ crs: 'EPSG:4326' }),
      }),
    ).toThrow(/requires an inverse coordinate transform/u)
    const transform: RasterCoordinateTransform = {
      descriptor: { id: 'test.shift', version: '1', accuracy: { kind: 'exact' } },
      inverse: (x, y) => [x - 1, y],
    }
    const plan = createRasterTargetGridPlan({
      sourceGrid: grid(),
      targetGrid: grid({ crs: 'EPSG:4326', affine: [1, 0, 1, 0, 1, 0] }),
      transform: transform.descriptor,
    })
    expect(
      values(
        resampleRasterTileToGrid(plan, source, { x: 0, y: 0, width: 3, height: 3 }, { transform }),
      ),
    ).toEqual(values(source))
    expect(() =>
      resampleRasterTileToGrid(plan, source, { x: 0, y: 0, width: 1, height: 1 }),
    ).toThrow(/unavailable/u)
  })

  it('cancels target-grid execution and rejects incomplete source windows', () => {
    const plan = createRasterTargetGridPlan({ sourceGrid: grid(), targetGrid: grid() })
    const controller = new AbortController()
    controller.abort(new Error('stop'))
    expect(() =>
      resampleRasterTileToGrid(
        plan,
        source,
        { x: 0, y: 0, width: 1, height: 1 },
        {
          signal: controller.signal,
        },
      ),
    ).toThrow('stop')
    const partial = tile(1, 1, 1, () => 0)
    expect(() =>
      resampleRasterTileToGrid(plan, partial, { x: 1, y: 1, width: 1, height: 1 }),
    ).toThrow(/does not cover/u)
  })
})
