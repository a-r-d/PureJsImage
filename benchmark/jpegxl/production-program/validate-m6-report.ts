import sources from './m6-native-sources.json' with { type: 'json' }
import encodings from './m6-native-encodings.json' with { type: 'json' }

export function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('Expected report object')
  return Object.fromEntries(Object.entries(value))
}
function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('Expected report list')
  return value
}
function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
    throw new Error('Expected finite nonnegative measurement')
  return value
}
function median(values: number[]): number {
  values.sort((a, b) => a - b)
  return ((values[4] ?? 0) + (values[5] ?? 0)) / 2
}
export function validateM6Report(input: unknown) {
  const report = record(input)
  if (typeof report.revision !== 'string' || !/^[0-9a-f]{40}$/.test(report.revision))
    throw new Error('Missing implementation revision')
  if (report.selectionFrozenAt !== sources.frozenAt) throw new Error('Source selection changed')
  const correctness = record(report.correctness)
  if (correctness.revision !== report.revision) throw new Error('Correctness revision mismatch')
  const comparisons = list(correctness.results).map(record)
  const measurements = list(record(report.measurements).results).map(record)
  if (comparisons.length !== 50 || measurements.length !== 60)
    throw new Error('Incomplete native cohort')
  const previewRatios: number[] = [],
    viewportRatios: number[] = [],
    memoryRatios: number[] = []
  const misses: { id: string; previewRatio: number; viewportRatio: number }[] = []
  for (const source of sources.entries) {
    for (const mode of ['dc', 'pass1', 'pass2', 'viewport', 'final']) {
      const rows = comparisons.filter((row) => row.id === source.id && row.mode === mode)
      const row = rows[0]
      if (rows.length !== 1 || !row || row.status !== 'pass')
        throw new Error(`Missing or failed comparison: ${source.id}/${mode}`)
      if (row.width !== source.width || row.height !== source.height)
        throw new Error('Native dimensions changed')
      if (number(row.maximum) > 1 || number(row.rmse) > 0.55 || number(row.samples) === 0)
        throw new Error('Independent stage tolerance failed')
      if (mode === 'dc' && (row.repeatDcSectionBytes !== 0 || row.lfDecodes !== 1))
        throw new Error('LF cache gate failed')
      if (
        !encodings.cases.some(
          (entry) => entry.id === source.id && entry.jxlSha256 === row.inputSha256,
        )
      )
        throw new Error('Encoding provenance mismatch')
    }
    const selected = (mode: string, temperature: string) => {
      const rows = measurements.filter(
        (row) =>
          row.input === `.tmp/jpegxl-m6-native/encoded/${source.id}.jxl` &&
          row.mode === mode &&
          row.temperature === temperature,
      )
      const row = rows[0]
      if (rows.length !== 1 || !row || row.error || row.revision !== report.revision)
        throw new Error(`Missing or failed measurement: ${source.id}/${mode}/${temperature}`)
      for (const field of [
        'requestedBytes',
        'inputBytes',
        'managedPeakBytes',
        'absolutePeakRssBytes',
        'elapsedMs',
        'firstPixelMs',
        'outputBytes',
      ])
        number(row[field])
      if (number(row.inputBytes) === 0 || number(row.managedPeakBytes) === 0)
        throw new Error('Empty measurement')
      return row
    }
    for (const mode of ['preview', 'viewport', 'final']) {
      const cold = selected(mode, 'cold'),
        warm = selected(mode, 'warm')
      if (
        typeof cold.sha256 !== 'string' ||
        !/^[0-9a-f]{64}$/.test(cold.sha256) ||
        cold.sha256 !== warm.sha256
      )
        throw new Error('Cold/warm output mismatch')
    }
    const preview = selected('preview', 'cold'),
      viewport = selected('viewport', 'cold'),
      final = selected('final', 'cold')
    const previewRatio = number(preview.requestedBytes) / number(preview.inputBytes)
    const viewportRatio = number(viewport.requestedBytes) / number(viewport.inputBytes)
    previewRatios.push(previewRatio)
    viewportRatios.push(viewportRatio)
    for (const temperature of ['cold', 'warm']) {
      const ratio =
        number(selected('preview', temperature).managedPeakBytes) /
        number(selected('final', temperature).managedPeakBytes)
      if (ratio > 0.5) throw new Error(`Preview memory gate failed: ${source.id}`)
      memoryRatios.push(ratio)
    }
    if (number(final.outputBytes) !== source.width * source.height * 3)
      throw new Error('Final output geometry mismatch')
    if (previewRatio > 0.25 || viewportRatio > 0.35)
      misses.push({ id: source.id, previewRatio, viewportRatio })
  }
  const previewMedian = median(previewRatios),
    viewportMedian = median(viewportRatios)
  if (previewMedian > 0.25 || viewportMedian > 0.35)
    throw new Error('Median Range byte gate failed')
  return {
    nativePhotos: 10,
    stageComparisons: 50,
    isolatedRuns: 60,
    previewMedian,
    viewportMedian,
    minimumPreviewMemoryReduction: 1 - Math.max(...memoryRatios),
    misses,
  }
}
