import { describe, expect, it } from 'vitest'
import {
  admitRasterAllocation,
  assertTileCoversRegion,
  computeRasterRegionStatistics,
  createLinearCombinationPlan,
  createRasterBandMathPlan,
  createRasterLineProfilePlan,
  createRasterRegionStatisticsPlan,
  createRasterSubtractionPlan,
  createRasterTargetGridPlan,
  createRasterTerrainPlan,
  defaultRasterOperationLimits,
  estimateRasterTargetGridTile,
  evaluateRasterBandMathTile,
  evaluateRasterTerrainTile,
  normalizeNumericRasterGrid,
  normalizeRasterNoData,
  normalizeRasterTileRegion,
  numericRasterGridsEqual,
  numericSampleBytes,
  rasterLengthUnitMetres,
  rasterNoDataNumber,
  rasterSampleIsNoData,
  resampleRasterTileToGrid,
  resolveRasterOperationLimits,
  sampleRasterLineProfile,
  type NumericRasterGrid,
  type RasterBandMathPlan,
  type RasterCoordinateTransform,
  type RasterLineProfilePlan,
  type RasterNoData,
  type RasterRegionStatisticsPlan,
  type RasterTargetGridPlan,
  type RasterTerrainPlan,
} from '../src/analysis/index.ts'
import type { NumericArray, NumericSampleType, NumericTile } from '../src/scientific/index.ts'

const numericTile = (
  width: number,
  height: number,
  components: number,
  sampleType: NumericSampleType,
  data: NumericArray,
  origin: Readonly<{ x?: number; y?: number }> = {},
): NumericTile =>
  Object.freeze({
    x: origin.x ?? 0,
    y: origin.y ?? 0,
    width,
    height,
    sampleType,
    componentCount: components,
    layout: 'interleaved',
    rowStrideElements: width * components,
    data,
    release() {},
  })

const floatTile = (
  width: number,
  height: number,
  components: number,
  sample: (x: number, y: number, component: number) => number,
  origin: Readonly<{ x?: number; y?: number }> = {},
): NumericTile => {
  const data = new Float32Array(width * height * components)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      for (let component = 0; component < components; component += 1) {
        data[(y * width + x) * components + component] = sample(x, y, component)
      }
    }
  }
  return numericTile(width, height, components, 'float32', data, origin)
}

const rasterGrid = (overrides: Partial<NumericRasterGrid> = {}): NumericRasterGrid => ({
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

const invalidNoData = (kind: string): RasterNoData => ({ kind }) as unknown as RasterNoData

describe('numeric raster contracts', () => {
  it('normalizes limits, grids, nodata, and exact alignment deterministically', () => {
    const limits = resolveRasterOperationLimits({ maxTilePixels: 4, maxInputs: 2 })
    expect(limits).toMatchObject({ maxTilePixels: 4, maxInputs: 2 })
    expect(limits.maxOutputBytes).toBe(defaultRasterOperationLimits.maxOutputBytes)

    const normalized = normalizeNumericRasterGrid(
      rasterGrid({ crs: '  EPSG:32616  ', noData: { kind: 'value', value: -999 } }),
    )
    expect(normalized.crs).toBe('EPSG:32616')
    expect(normalized.noData).toEqual({ kind: 'value', value: -999 })
    expect(Object.isFrozen(normalized.affine)).toBe(true)
    expect(numericRasterGridsEqual(normalized, rasterGrid())).toBe(true)
    expect(numericRasterGridsEqual(normalized, rasterGrid({ affine: [2, 0, 0, 0, 1, 0] }))).toBe(
      false,
    )
    expect(numericRasterGridsEqual(normalized, rasterGrid({ crs: 'EPSG:4326' }))).toBe(false)
    expect(numericRasterGridsEqual(normalized, rasterGrid({ width: 4 }))).toBe(false)
    expect(numericRasterGridsEqual(normalized, rasterGrid({ height: 4 }))).toBe(false)
    expect(numericRasterGridsEqual(normalized, rasterGrid({ pixelInterpretation: 'area' }))).toBe(
      false,
    )
    expect(normalizeRasterNoData({ kind: 'none' })).toEqual({ kind: 'none' })
    expect(normalizeRasterNoData({ kind: 'nan' })).toEqual({ kind: 'nan' })
    expect(rasterNoDataNumber({ kind: 'value', value: 7 })).toBe(7)
    expect(Number.isNaN(rasterNoDataNumber({ kind: 'none' }))).toBe(true)
    expect(rasterSampleIsNoData(-1, { kind: 'value', value: -1 })).toBe(true)
    expect(rasterSampleIsNoData(Number.NaN, { kind: 'none' })).toBe(true)
  })

  it.each([
    ['schema version', rasterGrid({ schemaVersion: 2 as 1 }), /schema version/u],
    ['width', rasterGrid({ width: 0 }), /width/u],
    ['height', rasterGrid({ height: 0 }), /height/u],
    ['affine', rasterGrid({ affine: [1, 2, 0, 2, 4, 0] }), /invertible/u],
    ['extent', rasterGrid({ extent: [2, 0, 1, 2] }), /extent/u],
    [
      'pixel interpretation',
      rasterGrid({ pixelInterpretation: 'corner' as NumericRasterGrid['pixelInterpretation'] }),
      /pixel interpretation/u,
    ],
    [
      'resampling',
      rasterGrid({ resampling: 'cubic' as NumericRasterGrid['resampling'] }),
      /resampling/u,
    ],
    [
      'sample type',
      rasterGrid({ sampleType: 'float16' as NumericRasterGrid['sampleType'] }),
      /sample type/u,
    ],
    ['CRS', rasterGrid({ crs: ' ' }), /CRS/u],
  ])('rejects an invalid %s grid', (_name, candidate, expected) => {
    expect(() => normalizeNumericRasterGrid(candidate)).toThrow(expected)
  })

  it('rejects invalid nodata and operation limits', () => {
    expect(() => normalizeRasterNoData(invalidNoData('sentinel'))).toThrow(/nodata/u)
    expect(() => normalizeRasterNoData({ kind: 'value', value: Number.POSITIVE_INFINITY })).toThrow(
      /finite/u,
    )
    expect(() => resolveRasterOperationLimits({ maxTilePixels: 0 })).toThrow(/positive/u)
    expect(() => resolveRasterOperationLimits({ maxInputs: 1.5 })).toThrow(/positive/u)
  })

  it('normalizes regions, measures sample storage, and enforces allocation budgets', () => {
    expect(normalizeRasterTileRegion({ x: 1, y: 1, width: 2, height: 2 }, rasterGrid())).toEqual({
      x: 1,
      y: 1,
      width: 2,
      height: 2,
    })
    expect(() => normalizeRasterTileRegion({ x: -1, y: 0, width: 1, height: 1 })).toThrow(
      /invalid/u,
    )
    expect(() =>
      normalizeRasterTileRegion({ x: 2, y: 2, width: 2, height: 1 }, rasterGrid()),
    ).toThrow(/outside/u)
    expect([
      numericSampleBytes('uint8'),
      numericSampleBytes('int8'),
      numericSampleBytes('int16'),
      numericSampleBytes('uint32'),
      numericSampleBytes('float32'),
      numericSampleBytes('float64'),
      numericSampleBytes('uint64'),
    ]).toEqual([1, 1, 2, 4, 4, 8, 8])
    expect(admitRasterAllocation({ x: 0, y: 0, width: 2, height: 2 }, 'float32', 2)).toEqual({
      outputBytes: 32,
      peakWorkingBytes: 32,
    })
    expect(() => admitRasterAllocation({ x: 0, y: 0, width: 2, height: 2 }, 'float32', 0)).toThrow(
      /component count/u,
    )
    expect(() =>
      admitRasterAllocation({ x: 0, y: 0, width: 2, height: 2 }, 'float32', 1, {
        maxTilePixels: 3,
      }),
    ).toThrow(/maxTilePixels/u)
    expect(() =>
      admitRasterAllocation({ x: 0, y: 0, width: 2, height: 2 }, 'float32', 1, {
        maxOutputBytes: 15,
      }),
    ).toThrow(/maxOutputBytes/u)
    expect(() =>
      admitRasterAllocation(
        { x: 0, y: 0, width: 2, height: 2 },
        'float32',
        1,
        { maxWorkingBytes: 16 },
        1,
      ),
    ).toThrow(/maxWorkingBytes/u)
  })

  it('rejects tiles that do not cover a requested global region', () => {
    const source = floatTile(2, 2, 1, () => 1, { x: 2, y: 3 })
    expect(assertTileCoversRegion(source, { x: 2, y: 3, width: 2, height: 2 })).toEqual({
      x: 2,
      y: 3,
      width: 2,
      height: 2,
    })
    expect(() => assertTileCoversRegion(source, { x: 1, y: 3, width: 2, height: 2 })).toThrow(
      /does not cover/u,
    )
  })
})

describe('band-math parser and validation', () => {
  const one = floatTile(1, 1, 1, () => 1)

  it('evaluates precedence, scientific literals, unary operators, and every audited function', () => {
    const plan = createRasterBandMathPlan({
      expression: '+pow(a, 2) + abs(-3) + sqrt(4) + log(exp(1)) + min(8, 5) + max(2, 4) + 1e1',
      inputs: [{ name: 'a', valueMode: 'raw' }],
      outputSampleType: 'float64',
    })
    expect(Number(evaluateRasterBandMathTile(plan, [one]).data[0])).toBeCloseTo(26)
    const precedence = createRasterBandMathPlan({
      expression: '1 + 2 * 3 - 8 / 4',
      inputs: [{ name: 'unused', valueMode: 'raw' }],
      outputSampleType: 'float64',
    })
    expect(Number(evaluateRasterBandMathTile(precedence, [one]).data[0])).toBe(5)
  })

  it('builds subtraction and linear-combination helpers with scaled provenance', () => {
    const left = floatTile(1, 1, 1, () => 10)
    const right = floatTile(1, 1, 1, () => 3)
    const subtraction = createRasterSubtractionPlan(
      { name: 'left', valueMode: 'raw' },
      { name: 'right', valueMode: 'raw' },
      { outputSampleType: 'float64' },
    )
    expect(Number(evaluateRasterBandMathTile(subtraction, [left, right]).data[0])).toBe(7)
    const linear = createLinearCombinationPlan(
      [
        { name: 'left', valueMode: 'scaled', scale: 2, offset: 1, coefficient: 0.5 },
        { name: 'right', valueMode: 'raw', coefficient: -1 },
      ],
      2,
      { outputSampleType: 'float64' },
    )
    expect(linear.inputs[0]?.valueMode).toBe('scaled')
    expect(Number(evaluateRasterBandMathTile(linear, [left, right]).data[0])).toBe(9.5)
  })

  it.each([
    ['invalid token', 'a % 2', /Invalid band-math token/u],
    ['invalid decimal', '.', /Invalid band-math token/u],
    ['invalid exponent', '1e', /Invalid exponent/u],
    ['non-finite literal', '1e999', /Non-finite literal/u],
    ['unknown function', 'round(a)', /Unknown band-math function/u],
    ['wrong arity', 'min(a)', /requires 2/u],
    ['missing parenthesis', 'max(a, 2', /Expected '\)'/u],
    ['missing grouped parenthesis', '(a + 2', /Expected '\)'/u],
    ['unexpected token', 'a 2', /Unexpected token/u],
    ['missing expression', '()', /Expected band-math expression/u],
  ])('rejects %s', (_name, expression, expected) => {
    expect(() =>
      createRasterBandMathPlan({ expression, inputs: [{ name: 'a', valueMode: 'raw' }] }),
    ).toThrow(expected)
  })

  it('rejects invalid input definitions, policies, clamps, and parser budgets', () => {
    expect(() =>
      createRasterBandMathPlan({ expression: '', inputs: [{ name: 'a', valueMode: 'raw' }] }),
    ).toThrow(/expression length/u)
    expect(() => createRasterBandMathPlan({ expression: '1', inputs: [] })).toThrow(/input count/u)
    expect(() =>
      createRasterBandMathPlan({
        expression: 'a',
        inputs: [
          { name: 'a', valueMode: 'raw' },
          { name: 'a', valueMode: 'raw' },
        ],
      }),
    ).toThrow(/Duplicate/u)
    expect(() =>
      createRasterBandMathPlan({ expression: 'a-b', inputs: [{ name: 'a-b', valueMode: 'raw' }] }),
    ).toThrow(/bounded identifiers/u)
    expect(() =>
      createRasterBandMathPlan({
        expression: 'a',
        inputs: [{ name: 'a', component: -1, valueMode: 'raw' }],
      }),
    ).toThrow(/component/u)
    expect(() =>
      createRasterBandMathPlan({
        expression: 'a',
        inputs: [{ name: 'a', valueMode: 'physical' as 'raw' }],
      }),
    ).toThrow(/value mode/u)
    expect(() =>
      createRasterBandMathPlan({
        expression: 'a',
        inputs: [{ name: 'a', valueMode: 'scaled', scale: Number.NaN }],
      }),
    ).toThrow(/finite/u)
    expect(() =>
      createRasterBandMathPlan({
        expression: 'a',
        inputs: [{ name: 'a', valueMode: 'raw' }],
        clamp: [2, 1],
      }),
    ).toThrow(/clamp/u)
    expect(() =>
      createRasterBandMathPlan({
        expression: 'a',
        inputs: [{ name: 'a', valueMode: 'raw' }],
        divideByZero: 'infinity' as 'zero',
      }),
    ).toThrow(/divide-by-zero/u)
    expect(() =>
      createRasterBandMathPlan({
        expression: 'a',
        inputs: [{ name: 'a', valueMode: 'raw' }],
        nonFinite: 'reject' as 'nodata',
      }),
    ).toThrow(/non-finite/u)
    expect(() =>
      createRasterBandMathPlan({
        expression: 'a + 1 + 2',
        inputs: [{ name: 'a', valueMode: 'raw' }],
        limits: { maxExpressionOperations: 1 },
      }),
    ).toThrow(/maxExpressionOperations/u)
  })

  it('rejects invalid execution plans, inputs, regions, uint64 precision, and memory', () => {
    const plan = createRasterBandMathPlan({
      expression: 'a',
      inputs: [{ name: 'a', valueMode: 'raw' }],
    })
    const wrongPlan = {
      ...plan,
      algorithm: { ...plan.algorithm, version: 2 },
    } as unknown as RasterBandMathPlan
    expect(() => evaluateRasterBandMathTile(wrongPlan, [one])).toThrow(/Unsupported/u)
    expect(() => evaluateRasterBandMathTile(plan, [])).toThrow(/tile count/u)
    const componentPlan = createRasterBandMathPlan({
      expression: 'a',
      inputs: [{ name: 'a', component: 1, valueMode: 'raw' }],
    })
    expect(() => evaluateRasterBandMathTile(componentPlan, [one])).toThrow(/unavailable/u)
    expect(() =>
      evaluateRasterBandMathTile(plan, [one], { x: 0, y: 0, width: 2, height: 1 }),
    ).toThrow(/does not cover/u)
    expect(() =>
      evaluateRasterBandMathTile(plan, [one], undefined, { limits: { maxOutputBytes: 3 } }),
    ).toThrow(/maxOutputBytes/u)
    const unsafeUint64 = numericTile(
      1,
      1,
      1,
      'uint64',
      new BigUint64Array([BigInt(Number.MAX_SAFE_INTEGER) + 1n]),
    )
    expect(() => evaluateRasterBandMathTile(plan, [unsafeUint64])).toThrow(/uint64/u)
    const safeUint64 = numericTile(1, 1, 1, 'uint64', new BigUint64Array([7n]))
    expect(Number(evaluateRasterBandMathTile(plan, [safeUint64]).data[0])).toBe(7)
    expect(() => createLinearCombinationPlan([], 0)).toThrow(/at least one/u)
    expect(() =>
      createLinearCombinationPlan(
        [{ name: 'a', valueMode: 'raw', coefficient: Number.POSITIVE_INFINITY }],
        0,
      ),
    ).toThrow(/coefficient/u)
    expect(() =>
      createLinearCombinationPlan([{ name: 'a', valueMode: 'raw', coefficient: 1 }], Number.NaN),
    ).toThrow(/constant/u)
  })
})

describe('terrain validation and boundary policies', () => {
  const common = {
    operation: 'slope' as const,
    sourceWidth: 3,
    sourceHeight: 3,
    xSpacing: 1,
    ySpacing: 1,
    xUnit: { kind: 'metre' } as const,
    yUnit: { kind: 'metre' } as const,
    verticalUnit: { kind: 'metre' } as const,
    rowDirection: 'south' as const,
  }

  it('converts every supported unit and emits radians, percent, and flat aspect nodata', () => {
    expect(rasterLengthUnitMetres({ kind: 'metre' })).toBe(1)
    expect(rasterLengthUnitMetres({ kind: 'international-foot' })).toBe(0.3048)
    expect(rasterLengthUnitMetres({ kind: 'us-survey-foot' })).toBeCloseTo(1200 / 3937)
    expect(
      rasterLengthUnitMetres({ kind: 'custom', name: 'centimetre', metresPerUnit: 0.01 }),
    ).toBe(0.01)
    const plane = floatTile(3, 3, 1, (x) => x)
    const radians = evaluateRasterTerrainTile(
      createRasterTerrainPlan({ ...common, slopeUnit: 'radians' }),
      plane,
      { x: 1, y: 1, width: 1, height: 1 },
    )
    const percent = evaluateRasterTerrainTile(
      createRasterTerrainPlan({ ...common, slopeUnit: 'percent' }),
      plane,
      { x: 1, y: 1, width: 1, height: 1 },
    )
    expect(Number(radians.data[0])).toBeCloseTo(Math.PI / 4)
    expect(Number(percent.data[0])).toBeCloseTo(100)
    const flat = floatTile(3, 3, 1, () => 2)
    const aspect = evaluateRasterTerrainTile(
      createRasterTerrainPlan({
        ...common,
        operation: 'aspect',
        outputNoData: { kind: 'value', value: -1 },
      }),
      flat,
      { x: 1, y: 1, width: 1, height: 1 },
    )
    expect(Number(aspect.data[0])).toBe(-1)
  })

  it('distinguishes outer-edge clamp from nodata', () => {
    const source = floatTile(3, 3, 1, (x) => x)
    const clamp = evaluateRasterTerrainTile(
      createRasterTerrainPlan({ ...common, edge: 'clamp' }),
      source,
      { x: 0, y: 0, width: 1, height: 1 },
    )
    const nodata = evaluateRasterTerrainTile(
      createRasterTerrainPlan({
        ...common,
        edge: 'nodata',
        outputNoData: { kind: 'value', value: -9 },
      }),
      source,
      { x: 0, y: 0, width: 1, height: 1 },
    )
    expect(Number.isFinite(Number(clamp.data[0]))).toBe(true)
    expect(Number(nodata.data[0])).toBe(-9)
  })

  it.each([
    [{ ...common, operation: 'curvature' as 'slope' }, /operation/u],
    [{ ...common, component: -1 }, /component/u],
    [{ ...common, slopeUnit: 'grade' as 'degrees' }, /slope output/u],
    [{ ...common, azimuthDegrees: 360 }, /azimuth/u],
    [{ ...common, altitudeDegrees: -1 }, /altitude/u],
    [{ ...common, rowDirection: 'east' as 'south' }, /row direction/u],
    [{ ...common, edge: 'wrap' as 'clamp' }, /edge policy/u],
    [{ ...common, sourceWidth: 0 }, /sourceWidth/u],
    [{ ...common, xSpacing: 0 }, /xSpacing/u],
    [{ ...common, xUnit: { kind: 'custom' as const, name: '', metresPerUnit: 1 } }, /name/u],
    [
      { ...common, xUnit: { kind: 'custom' as const, name: 'bad', metresPerUnit: 0 } },
      /metresPerUnit/u,
    ],
  ])('rejects an invalid terrain plan', (options, expected) => {
    expect(() => createRasterTerrainPlan(options)).toThrow(expected)
  })

  it('rejects missing halos, components, unsafe uint64 values, limits, and plan versions', () => {
    const plan = createRasterTerrainPlan({ ...common, sourceWidth: 5, sourceHeight: 5 })
    const partial = floatTile(2, 3, 1, (x) => x, { x: 1, y: 1 })
    expect(() =>
      evaluateRasterTerrainTile(plan, partial, { x: 1, y: 1, width: 2, height: 3 }),
    ).toThrow(/halo/u)
    const twoByTwo = floatTile(2, 2, 1, (x) => x)
    expect(() =>
      evaluateRasterTerrainTile(
        createRasterTerrainPlan({ ...common, sourceWidth: 2, sourceHeight: 2, component: 1 }),
        twoByTwo,
        { x: 0, y: 0, width: 1, height: 1 },
      ),
    ).toThrow(/component/u)
    expect(() =>
      evaluateRasterTerrainTile(
        createRasterTerrainPlan({ ...common, sourceWidth: 2, sourceHeight: 2 }),
        twoByTwo,
        { x: 0, y: 0, width: 2, height: 2 },
        { limits: { maxTilePixels: 3 } },
      ),
    ).toThrow(/maxTilePixels/u)
    const unsafe = numericTile(
      1,
      1,
      1,
      'uint64',
      new BigUint64Array([BigInt(Number.MAX_SAFE_INTEGER) + 1n]),
    )
    expect(() =>
      evaluateRasterTerrainTile(
        createRasterTerrainPlan({ ...common, sourceWidth: 1, sourceHeight: 1 }),
        unsafe,
        { x: 0, y: 0, width: 1, height: 1 },
      ),
    ).toThrow(/uint64/u)
    const safe = numericTile(1, 1, 1, 'uint64', new BigUint64Array([7n]))
    expect(
      Number(
        evaluateRasterTerrainTile(
          createRasterTerrainPlan({ ...common, sourceWidth: 1, sourceHeight: 1 }),
          safe,
          { x: 0, y: 0, width: 1, height: 1 },
        ).data[0],
      ),
    ).toBe(0)
    const wrongPlan = {
      ...createRasterTerrainPlan(common),
      schemaVersion: 2,
    } as unknown as RasterTerrainPlan
    expect(() =>
      evaluateRasterTerrainTile(
        wrongPlan,
        floatTile(3, 3, 1, () => 1),
        {
          x: 1,
          y: 1,
          width: 1,
          height: 1,
        },
      ),
    ).toThrow(/Unsupported/u)
  })
})

describe('statistics and line-profile refusal paths', () => {
  it('reports all-invalid regions and histogram underflow, overflow, and inclusive maximum', () => {
    const invalid = floatTile(2, 1, 1, () => -1)
    expect(
      computeRasterRegionStatistics(
        createRasterRegionStatisticsPlan({ noData: { kind: 'value', value: -1 } }),
        invalid,
      ),
    ).toMatchObject({
      count: 0,
      invalidCount: 2,
      minimum: null,
      maximum: null,
      mean: null,
      variance: null,
    })
    const source = floatTile(4, 1, 1, (x) => [-1, 0, 2, 3][x] ?? 0)
    const result = computeRasterRegionStatistics(
      createRasterRegionStatisticsPlan({ histogram: { bins: 2, minimum: 0, maximum: 2 } }),
      source,
    )
    expect(result.histogram?.underflow).toBe(1)
    expect(result.histogram?.overflow).toBe(1)
    expect(Array.from(result.histogram?.counts ?? [])).toEqual([1, 1])
  })

  it('validates statistics plans and execution limits', () => {
    expect(() => createRasterRegionStatisticsPlan({ component: -1 })).toThrow(/component/u)
    expect(() =>
      createRasterRegionStatisticsPlan({ histogram: { bins: 0, minimum: 0, maximum: 1 } }),
    ).toThrow(/Histogram/u)
    expect(() =>
      createRasterRegionStatisticsPlan({
        histogram: { bins: 2, minimum: 1, maximum: 1 },
      }),
    ).toThrow(/Histogram/u)
    const source = floatTile(2, 2, 1, () => 1)
    const wrongPlan = {
      ...createRasterRegionStatisticsPlan(),
      algorithm: { id: 'wrong', version: 1 },
    } as unknown as RasterRegionStatisticsPlan
    expect(() => computeRasterRegionStatistics(wrongPlan, source)).toThrow(/Unsupported/u)
    expect(() =>
      computeRasterRegionStatistics(createRasterRegionStatisticsPlan({ component: 1 }), source),
    ).toThrow(/unavailable/u)
    expect(() =>
      computeRasterRegionStatistics(createRasterRegionStatisticsPlan(), source, undefined, {
        limits: { maxTilePixels: 3 },
      }),
    ).toThrow(/maxTilePixels/u)
    expect(() =>
      computeRasterRegionStatistics(
        createRasterRegionStatisticsPlan({ histogram: { bins: 2, minimum: 0, maximum: 2 } }),
        source,
        undefined,
        { limits: { maxWorkingBytes: 7 } },
      ),
    ).toThrow(/maxWorkingBytes/u)
    const unsafe = numericTile(
      1,
      1,
      1,
      'uint64',
      new BigUint64Array([BigInt(Number.MAX_SAFE_INTEGER) + 1n]),
    )
    expect(() => computeRasterRegionStatistics(createRasterRegionStatisticsPlan(), unsafe)).toThrow(
      /uint64/u,
    )
  })

  it('marks out-of-bounds and insufficient-weight profile samples invalid', () => {
    const source = floatTile(2, 2, 1, (x, y) => (x === 0 && y === 0 ? -1 : x + y))
    const nearest = sampleRasterLineProfile(
      createRasterLineProfilePlan({
        start: { x: -2, y: 0 },
        end: { x: 3, y: 0 },
        sampleCount: 2,
      }),
      source,
    )
    expect(Array.from(nearest.valid)).toEqual([0, 0])
    const bilinear = sampleRasterLineProfile(
      createRasterLineProfilePlan({
        start: { x: 0.25, y: 0.25 },
        end: { x: 0.25, y: 0.25 },
        sampleCount: 1,
        resampling: 'bilinear',
        noData: { kind: 'value', value: -1 },
        minimumValidWeight: 0.5,
      }),
      source,
    )
    expect(Array.from(bilinear.valid)).toEqual([0])
    expect(Number.isNaN(bilinear.values[0])).toBe(true)
  })

  it('validates line plans, components, output budgets, and uint64 precision', () => {
    expect(() =>
      createRasterLineProfilePlan({
        start: { x: Number.NaN, y: 0 },
        end: { x: 1, y: 1 },
        sampleCount: 2,
      }),
    ).toThrow(/finite/u)
    expect(() =>
      createRasterLineProfilePlan({ start: { x: 0, y: 0 }, end: { x: 1, y: 1 }, sampleCount: 0 }),
    ).toThrow(/sample count/u)
    expect(() =>
      createRasterLineProfilePlan({
        start: { x: 0, y: 0 },
        end: { x: 1, y: 1 },
        sampleCount: 2,
        component: -1,
      }),
    ).toThrow(/component/u)
    expect(() =>
      createRasterLineProfilePlan({
        start: { x: 0, y: 0 },
        end: { x: 1, y: 1 },
        sampleCount: 2,
        resampling: 'cubic' as 'nearest',
      }),
    ).toThrow(/resampling/u)
    expect(() =>
      createRasterLineProfilePlan({
        start: { x: 0, y: 0 },
        end: { x: 1, y: 1 },
        sampleCount: 2,
        minimumValidWeight: 0,
      }),
    ).toThrow(/minimumValidWeight/u)
    const source = floatTile(1, 1, 1, () => 1)
    const plan = createRasterLineProfilePlan({
      start: { x: 0, y: 0 },
      end: { x: 0, y: 0 },
      sampleCount: 1,
    })
    const wrongPlan = { ...plan, schemaVersion: 2 } as unknown as RasterLineProfilePlan
    expect(() => sampleRasterLineProfile(wrongPlan, source)).toThrow(/Unsupported/u)
    const componentPlan = createRasterLineProfilePlan({
      start: { x: 0, y: 0 },
      end: { x: 0, y: 0 },
      sampleCount: 1,
      component: 1,
    })
    expect(() => sampleRasterLineProfile(componentPlan, source)).toThrow(/unavailable/u)
    expect(() => sampleRasterLineProfile(plan, source, { limits: { maxOutputBytes: 16 } })).toThrow(
      /maxOutputBytes/u,
    )
    const unsafe = numericTile(
      1,
      1,
      1,
      'uint64',
      new BigUint64Array([BigInt(Number.MAX_SAFE_INTEGER) + 1n]),
    )
    expect(() => sampleRasterLineProfile(plan, unsafe)).toThrow(/uint64/u)
  })
})

describe('target-grid resampling validation and nodata', () => {
  it('normalizes estimated transform identity and rejects incomplete descriptors', () => {
    const descriptor = {
      id: ' test.transform ',
      version: ' 2 ',
      accuracy: { kind: 'estimated' as const, maximumError: 0.25, unit: ' metre ' },
    }
    const plan = createRasterTargetGridPlan({
      sourceGrid: rasterGrid(),
      targetGrid: rasterGrid({ crs: 'EPSG:4326' }),
      transform: descriptor,
    })
    expect(plan.transform).toEqual({
      id: 'test.transform',
      version: '2',
      accuracy: { kind: 'estimated', maximumError: 0.25, unit: 'metre' },
    })
    expect(() =>
      createRasterTargetGridPlan({
        sourceGrid: rasterGrid(),
        targetGrid: rasterGrid({ crs: 'EPSG:4326' }),
        transform: { id: 'x', version: '1', accuracy: { kind: 'estimated' } },
      }),
    ).toThrow(/accuracy/u)
    expect(
      createRasterTargetGridPlan({
        sourceGrid: rasterGrid(),
        targetGrid: rasterGrid({ crs: 'EPSG:4326' }),
        transform: { id: 'x', version: '1', accuracy: { kind: 'unknown' } },
      }).transform,
    ).toEqual({ id: 'x', version: '1', accuracy: { kind: 'unknown' } })
  })

  it('applies bilinear nodata weighting and emits nodata outside the source grid', () => {
    const source = floatTile(2, 2, 1, (x, y) => (x === 0 && y === 0 ? -999 : x + y * 2))
    const plan = createRasterTargetGridPlan({
      sourceGrid: rasterGrid({ width: 2, height: 2, extent: [0, 0, 1, 1] }),
      targetGrid: rasterGrid({
        width: 2,
        height: 1,
        affine: [1, 0, 0.5, 0, 1, 0.5],
        extent: [0.5, 0.5, 1.5, 0.5],
        resampling: 'bilinear',
        noData: { kind: 'value', value: -7 },
      }),
      resampling: 'bilinear',
      sourceNoData: { kind: 'value', value: -999 },
      minimumValidWeight: 0.5,
    })
    const result = resampleRasterTileToGrid(plan, source, { x: 0, y: 0, width: 2, height: 1 })
    expect(Number(result.data[0])).toBeCloseTo(2)
    expect(Number(result.data[1])).toBe(-7)

    const nearestPlan = createRasterTargetGridPlan({
      sourceGrid: rasterGrid({ width: 1, height: 1, extent: [0, 0, 0, 0] }),
      targetGrid: rasterGrid({
        width: 1,
        height: 1,
        extent: [0, 0, 0, 0],
        noData: { kind: 'value', value: -7 },
      }),
      sourceNoData: { kind: 'value', value: -999 },
    })
    const selectedNoData = resampleRasterTileToGrid(
      nearestPlan,
      floatTile(1, 1, 1, () => -999),
      { x: 0, y: 0, width: 1, height: 1 },
    )
    expect(Number(selectedNoData.data[0])).toBe(-7)
  })

  it('checks transform identity, accuracy, availability, and return values', () => {
    const descriptor = { id: 'shift', version: '1', accuracy: { kind: 'exact' as const } }
    const plan = createRasterTargetGridPlan({
      sourceGrid: rasterGrid(),
      targetGrid: rasterGrid({ crs: 'EPSG:4326' }),
      transform: descriptor,
    })
    const source = floatTile(3, 3, 1, (x, y) => x + y)
    const mismatch: RasterCoordinateTransform = {
      descriptor: { ...descriptor, version: '2' },
      inverse: (x, y) => [x, y],
    }
    expect(() =>
      resampleRasterTileToGrid(
        plan,
        source,
        { x: 0, y: 0, width: 1, height: 1 },
        { transform: mismatch },
      ),
    ).toThrow(/does not match/u)
    const invalidReturn: RasterCoordinateTransform = {
      descriptor,
      inverse: () => [Number.NaN, 0],
    }
    const result = resampleRasterTileToGrid(
      plan,
      source,
      { x: 0, y: 0, width: 1, height: 1 },
      { transform: invalidReturn },
    )
    expect(Number.isNaN(Number(result.data[0]))).toBe(true)
    const sameCrsPlan = createRasterTargetGridPlan({
      sourceGrid: rasterGrid(),
      targetGrid: rasterGrid(),
    })
    expect(() =>
      resampleRasterTileToGrid(
        sameCrsPlan,
        source,
        { x: 0, y: 0, width: 1, height: 1 },
        { transform: invalidReturn },
      ),
    ).toThrow(/Unplanned/u)
  })

  it('rejects invalid target-grid plans and unsafe execution combinations', () => {
    expect(() =>
      createRasterTargetGridPlan({
        sourceGrid: rasterGrid(),
        targetGrid: rasterGrid(),
        sourceComponent: -1,
      }),
    ).toThrow(/component/u)
    expect(() =>
      createRasterTargetGridPlan({
        sourceGrid: rasterGrid(),
        targetGrid: rasterGrid(),
        resampling: 'cubic' as 'nearest',
      }),
    ).toThrow(/resampling/u)
    expect(() =>
      createRasterTargetGridPlan({
        sourceGrid: rasterGrid(),
        targetGrid: rasterGrid({ sampleType: 'uint8', resampling: 'bilinear' }),
      }),
    ).toThrow(/Bilinear/u)
    expect(() =>
      createRasterTargetGridPlan({
        sourceGrid: rasterGrid(),
        targetGrid: rasterGrid(),
        minimumValidWeight: 2,
      }),
    ).toThrow(/minimumValidWeight/u)
    const source = floatTile(3, 3, 1, (x, y) => x + y)
    const plan = createRasterTargetGridPlan({ sourceGrid: rasterGrid(), targetGrid: rasterGrid() })
    const wrongPlan = { ...plan, schemaVersion: 2 } as unknown as RasterTargetGridPlan
    expect(() =>
      resampleRasterTileToGrid(wrongPlan, source, { x: 0, y: 0, width: 1, height: 1 }),
    ).toThrow(/Unsupported/u)
    const componentPlan = createRasterTargetGridPlan({
      sourceGrid: rasterGrid(),
      targetGrid: rasterGrid(),
      sourceComponent: 1,
    })
    expect(() =>
      resampleRasterTileToGrid(componentPlan, source, { x: 0, y: 0, width: 1, height: 1 }),
    ).toThrow(/component/u)
    expect(() =>
      resampleRasterTileToGrid(
        plan,
        source,
        { x: 0, y: 0, width: 1, height: 1 },
        { limits: { maxOutputBytes: 3 } },
      ),
    ).toThrow(/maxOutputBytes/u)
    const integerPlan = createRasterTargetGridPlan({
      sourceGrid: rasterGrid({ sampleType: 'uint8', noData: { kind: 'value', value: 255 } }),
      targetGrid: rasterGrid({ sampleType: 'uint8', noData: { kind: 'value', value: -1 } }),
      outputNoData: { kind: 'value', value: -1 },
    })
    const bytes = numericTile(3, 3, 1, 'uint8', new Uint8Array(9))
    const outsidePlan = createRasterTargetGridPlan({
      sourceGrid: integerPlan.sourceGrid,
      targetGrid: rasterGrid({
        sampleType: 'uint8',
        noData: { kind: 'value', value: -1 },
        affine: [1, 0, 10, 0, 1, 10],
      }),
      outputNoData: { kind: 'value', value: -1 },
    })
    expect(() =>
      resampleRasterTileToGrid(outsidePlan, bytes, { x: 0, y: 0, width: 1, height: 1 }),
    ).toThrow(/outside its integer sample type/u)
    const floatSourceIntegerTarget = createRasterTargetGridPlan({
      sourceGrid: rasterGrid(),
      targetGrid: rasterGrid({ sampleType: 'uint8', noData: { kind: 'value', value: 0 } }),
    })
    expect(() =>
      resampleRasterTileToGrid(floatSourceIntegerTarget, source, {
        x: 0,
        y: 0,
        width: 1,
        height: 1,
      }),
    ).toThrow(/matching source and target types/u)

    const uint64Grid = rasterGrid({
      width: 1,
      height: 1,
      extent: [0, 0, 0, 0],
      sampleType: 'uint64',
      noData: { kind: 'value', value: 0 },
    })
    const uint64Result = resampleRasterTileToGrid(
      createRasterTargetGridPlan({ sourceGrid: uint64Grid, targetGrid: uint64Grid }),
      numericTile(1, 1, 1, 'uint64', new BigUint64Array([7n])),
      { x: 0, y: 0, width: 1, height: 1 },
    )
    expect(uint64Result.data[0]).toBe(7n)

    const noIntegerNoDataPlan = createRasterTargetGridPlan({
      sourceGrid: rasterGrid({
        width: 1,
        height: 1,
        extent: [0, 0, 0, 0],
        sampleType: 'uint8',
      }),
      targetGrid: rasterGrid({
        width: 1,
        height: 1,
        extent: [0, 0, 0, 0],
        sampleType: 'uint8',
      }),
    })
    expect(() =>
      resampleRasterTileToGrid(
        noIntegerNoDataPlan,
        numericTile(1, 1, 1, 'uint8', new Uint8Array([1])),
        { x: 0, y: 0, width: 1, height: 1 },
      ),
    ).toThrow(/finite output nodata/u)
  })

  it('estimates target allocations and validates source tile placement', () => {
    const plan = createRasterTargetGridPlan({ sourceGrid: rasterGrid(), targetGrid: rasterGrid() })
    expect(estimateRasterTargetGridTile(plan, { x: 0, y: 0, width: 2, height: 2 })).toEqual({
      outputBytes: 16,
      peakWorkingBytes: 16,
    })
    const outside = floatTile(2, 2, 1, () => 1, { x: 2, y: 2 })
    expect(() =>
      resampleRasterTileToGrid(plan, outside, { x: 0, y: 0, width: 1, height: 1 }),
    ).toThrow(/outside the grid/u)
  })
})
