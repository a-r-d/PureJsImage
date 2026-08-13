import type { ScientificDataset } from '../scientific/dataset.ts'
import type {
  ScientificPlaneMeasurement,
  ScientificPlaneMeasureOptions,
} from '../scientific/render.ts'
import { measureScientificPlane } from '../scientific/render.ts'
import type {
  AnalysisResultLimits,
  HistogramResult,
  ProfileResult,
  ResultCollection,
  ResultCollectionEntry,
  ScalarResult,
} from './result.ts'
import {
  histogramResultValueTypeId,
  profileResultValueTypeId,
  resultCollectionValueTypeId,
  scalarResultValueTypeId,
  validateHistogramResult,
  validateProfileResult,
  validateResultCollection,
  validateScalarResult,
} from './result.ts'

export interface ScientificMeasurementResultOptions {
  readonly unit?: string
  readonly limits?: Readonly<AnalysisResultLimits>
}

export interface ScientificPlaneAnalysis {
  readonly measurement: ScientificPlaneMeasurement
  readonly result: ResultCollection
}

const scalar = (
  value: number,
  unit: string | undefined,
  limits: Readonly<AnalysisResultLimits> | undefined,
): ScalarResult =>
  validateScalarResult(
    {
      kind: 'scalar',
      valueType: scalarResultValueTypeId,
      value,
      nanPolicy: Number.isNaN(value) ? 'allow' : 'forbid',
      ...(unit === undefined ? {} : { unit }),
    },
    limits,
  )

const explicitHistogramEdges = (
  range: Readonly<{ readonly min: number; readonly max: number }>,
  bins: number,
): Float64Array => {
  const edges = new Float64Array(bins + 1)
  const width = (range.max - range.min) / bins
  for (let index = 0; index <= bins; index += 1) {
    edges[index] = index === bins ? range.max : range.min + width * index
  }
  return edges
}

/**
 * Adapts an existing plane measurement without reading its source again. Typed
 * histogram counts are retained by reference; callers must treat result payload
 * arrays as read-only.
 */
export const scientificPlaneMeasurementToResult = (
  measurement: ScientificPlaneMeasurement,
  options: Readonly<ScientificMeasurementResultOptions> = {},
): ResultCollection => {
  const entries: ResultCollectionEntry[] = [
    Object.freeze({
      name: 'rangeMinimum',
      result: scalar(measurement.range.min, options.unit, options.limits),
    }),
    Object.freeze({
      name: 'rangeMaximum',
      result: scalar(measurement.range.max, options.unit, options.limits),
    }),
    Object.freeze({
      name: 'finiteSamples',
      result: scalar(measurement.finiteSamples, undefined, options.limits),
    }),
    Object.freeze({
      name: 'sampledValues',
      result: scalar(measurement.sampledValues, undefined, options.limits),
    }),
  ]
  if (measurement.mean !== undefined) {
    entries.push(
      Object.freeze({
        name: 'mean',
        result: scalar(measurement.mean, options.unit, options.limits),
      }),
    )
  }
  if (measurement.standardDeviation !== undefined) {
    entries.push(
      Object.freeze({
        name: 'standardDeviation',
        result: scalar(measurement.standardDeviation, options.unit, options.limits),
      }),
    )
  }
  if (measurement.invalidSamples !== undefined) {
    entries.push(
      Object.freeze({
        name: 'invalidSamples',
        result: scalar(measurement.invalidSamples, undefined, options.limits),
      }),
    )
  }
  if (measurement.percentiles !== undefined) {
    const percentiles = new Float64Array(measurement.percentiles.length)
    const values = new Float64Array(measurement.percentiles.length)
    for (let index = 0; index < measurement.percentiles.length; index += 1) {
      const percentile = measurement.percentiles[index]
      percentiles[index] = percentile?.percentile ?? Number.NaN
      values[index] = percentile?.value ?? Number.NaN
    }
    const result: ProfileResult = validateProfileResult(
      {
        kind: 'profile',
        valueType: profileResultValueTypeId,
        axis: { name: 'percentile', values: percentiles, unit: '%', nanPolicy: 'forbid' },
        series: [
          {
            name: 'value',
            values,
            nanPolicy: values.some((value) => Number.isNaN(value)) ? 'allow' : 'forbid',
            ...(options.unit === undefined ? {} : { unit: options.unit }),
          },
        ],
      },
      options.limits,
    )
    entries.push(Object.freeze({ name: 'percentiles', result }))
  }
  if (measurement.histogram !== undefined) {
    const binEdges =
      measurement.histogram.binEdges ??
      explicitHistogramEdges(measurement.histogram.range, measurement.histogram.counts.length)
    const result: HistogramResult = validateHistogramResult(
      {
        kind: 'histogram',
        valueType: histogramResultValueTypeId,
        binEdges,
        counts: measurement.histogram.counts,
        underflow: measurement.histogram.underflow,
        overflow: measurement.histogram.overflow,
        ...(options.unit === undefined ? {} : { unit: options.unit }),
      },
      options.limits,
    )
    entries.push(Object.freeze({ name: 'histogram', result }))
  }
  return validateResultCollection(
    {
      kind: 'collection',
      valueType: resultCollectionValueTypeId,
      results: entries,
      metadata: {
        sourceMeasurement: 'measureScientificPlane',
        roi: measurement.roi,
      },
    },
    options.limits,
  )
}

const scientificUnit = (dataset: ScientificDataset): string | undefined =>
  dataset.descriptor.components[0]?.unit

const withResolvedUnit = (
  options: Readonly<ScientificMeasurementResultOptions>,
  unit: string | undefined,
): Readonly<ScientificMeasurementResultOptions> => {
  const resolvedUnit = options.unit ?? unit
  return {
    ...options,
    ...(resolvedUnit === undefined ? {} : { unit: resolvedUnit }),
  }
}

export const measureScientificPlaneWithResults = async (
  dataset: ScientificDataset,
  options: Readonly<ScientificPlaneMeasureOptions>,
  resultOptions: Readonly<ScientificMeasurementResultOptions> = {},
): Promise<ScientificPlaneAnalysis> => {
  const measurement = await measureScientificPlane(dataset, options)
  return Object.freeze({
    measurement,
    result: scientificPlaneMeasurementToResult(
      measurement,
      withResolvedUnit(resultOptions, scientificUnit(dataset)),
    ),
  })
}
