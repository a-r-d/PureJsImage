import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { number, object, string } from '../comparison/model.ts'
import { type BdRateSummary, type QualityMetric, summarizeBdRates } from './metrics.ts'
import type { Engine } from './model.ts'

const metrics: readonly QualityMetric[] = ['ssimulacra2', 'butteraugliMax', 'butteraugliNorm3']
const peers = ['jsquash', 'vips'] as const
const engines: readonly Engine[] = ['purejsimage', ...peers]
const metricNames = {
  ssimulacra2: 'SSIMULACRA2',
  butteraugliMax: 'Butteraugli max',
  butteraugliNorm3: 'Butteraugli 3-norm',
}
const engineNames = { purejsimage: 'PureJsImage', jsquash: 'jSquash', vips: 'wasm-vips' }

function array(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`)
  return value
}

function count(value: unknown, name: string): number {
  const result = number(value)
  if (!Number.isSafeInteger(result) || result < 0) throw new Error(`Invalid ${name}`)
  return result
}

function nonnegative(value: unknown, name: string): number {
  const result = number(value)
  if (result < 0) throw new Error(`Invalid ${name}`)
  return result
}

function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('Expected boolean')
  return value
}

function engine(value: unknown): Engine {
  if (value !== 'purejsimage' && value !== 'jsquash' && value !== 'vips')
    throw new Error('Unknown engine')
  return value
}

function metric(value: unknown): QualityMetric {
  if (value !== 'ssimulacra2' && value !== 'butteraugliMax' && value !== 'butteraugliNorm3')
    throw new Error('Unknown metric')
  return value
}

function markdownText(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').replace(/[\\`*_[\]<>|#]/g, '\\$&')
}

function percent(value: number): string {
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`
}

function memory(value: unknown): string {
  return value === undefined || value === null
    ? 'Not reported'
    : `${(nonnegative(value, 'peak memory') / 1_048_576).toFixed(2)} MiB`
}

interface Comparison {
  id: string
  peer: 'jsquash' | 'vips'
  metric: QualityMetric
  percent: number
  coversRequiredRange: boolean
}

function comparisons(value: unknown, selected: number): Comparison[] {
  const seen = new Set<string>()
  const ids = new Set<string>()
  return array(value, 'Comparisons').map((value) => {
    const row = object(value)
    const id = string(row.id)
    if (id.length === 0) throw new Error('Empty comparison image ID')
    const peer = engine(row.peer)
    if (peer === 'purejsimage') throw new Error('Comparison peer must be jSquash or vips')
    const quality = metric(row.metric)
    const key = JSON.stringify([id, peer, quality])
    if (seen.has(key)) throw new Error('Duplicate image/peer/metric comparison')
    seen.add(key)
    ids.add(id)
    if (ids.size > selected) throw new Error('More compared images than selected images')
    return {
      id,
      peer,
      metric: quality,
      percent: number(row.percent),
      coversRequiredRange: boolean(row.coversRequiredRange),
    }
  })
}

function diagnostics(value: unknown, field: 'detail' | 'reason'): string[] {
  return array(value, field === 'detail' ? 'Failures' : 'Omissions').map((value) => {
    const row = object(value)
    return `${markdownText(string(row.id))} / ${engineNames[engine(row.engine)]}: ${markdownText(string(row[field]))}`
  })
}

function timing(value: unknown): BdRateSummary | null {
  if (value === null) return null
  const row = object(value)
  const result = {
    count: count(row.count, 'timing count'),
    mean: nonnegative(row.mean, 'mean time'),
    median: nonnegative(row.median, 'median time'),
    p90: nonnegative(row.p90, 'p90 time'),
    worst: nonnegative(row.worst, 'worst time'),
  }
  if (result.count === 0 || result.median === 0) throw new Error('Empty or zero timing summary')
  return result
}

function speedReport(value: unknown, variant: string): string[] {
  const summary = object(value)
  if (summary.mode !== 'speed' || summary.workers !== 1)
    throw new Error('Speed summary must use mode=speed and one isolated worker')
  if (summary.variant !== variant) throw new Error('Speed and curve variants differ')
  const declaredComplete = boolean(summary.complete)
  const rows = new Map<Engine, { lab: BdRateSummary | null; watch: BdRateSummary | null }>()
  for (const value of array(summary.speed, 'Speed')) {
    const row = object(value)
    const name = engine(row.engine)
    if (rows.has(name)) throw new Error('Duplicate speed engine')
    rows.set(name, { lab: timing(row.lab), watch: timing(row.watch) })
  }
  const failures = diagnostics(summary.failures, 'detail')
  const omissions = diagnostics(summary.omissions, 'reason')
  const ownLabCount = rows.get('purejsimage')?.lab?.count
  const complete =
    declaredComplete &&
    failures.length === 0 &&
    omissions.length === 0 &&
    ownLabCount !== undefined &&
    engines.every(
      (name) => rows.get(name)?.lab?.count === ownLabCount && rows.get(name)?.watch?.count === 2,
    )
  const lines = [
    '',
    '## Isolated encode speed',
    '',
    `Speed run: ${complete ? 'complete' : 'incomplete'}; one worker. Ratios are median PureJsImage time / median peer time.`,
    '',
    '| Set | Peer | Own median | Peer median | Ratio | Own / peer samples |',
    '| --- | --- | ---: | ---: | ---: | ---: |',
  ]
  for (const scope of ['lab', 'watch'] as const) {
    for (const peer of peers) {
      const own = rows.get('purejsimage')?.[scope]
      const reference = rows.get(peer)?.[scope]
      const matched = own && reference && own.count === reference.count
      lines.push(
        `| ${scope === 'lab' ? 'Lab' : 'Full-resolution originals'} | ${engineNames[peer]} | ${own ? `${own.median.toFixed(2)} ms` : 'N/A'} | ${reference ? `${reference.median.toFixed(2)} ms` : 'N/A'} | ${matched ? `${(own.median / reference.median).toFixed(2)}x` : 'N/A'} | ${own?.count ?? 0} / ${reference?.count ?? 0} |`,
      )
    }
  }
  const watchCount = rows.get('purejsimage')?.watch?.count ?? 0
  if (watchCount !== 2)
    lines.push('', `Two-original speed coverage is incomplete: ${watchCount}/2 own samples.`)
  for (const name of engines) {
    if (!rows.has(name)) lines.push('', `Missing speed engine: ${engineNames[name]}.`)
  }
  if (failures.length || omissions.length) {
    lines.push('', 'Speed failures and omissions:', '')
    for (const line of [...failures, ...omissions]) lines.push(`- ${line}`)
  }
  lines.push(
    '',
    `Speed managed peak: ${memory(summary.managedPeakBytes)}; process peak RSS: ${memory(summary.processPeakRssBytes)}.`,
  )
  return lines
}

/** Render all computable intervals, retaining incomplete coverage in the table. */
export function renderBaselineReport(value: unknown, speedSummary?: unknown): string {
  const summary = object(value)
  const mode = string(summary.mode)
  if (mode !== 'screen' && mode !== 'lab' && mode !== 'holdout')
    throw new Error('Baseline report requires a curve run')
  const variant = string(summary.variant)
  if (summary.intervalPolicy !== undefined && summary.intervalPolicy !== 'required-ranges')
    throw new Error('Unknown quality interval policy')
  const selected = count(summary.selectedImages, 'selected images')
  if (selected === 0) throw new Error('No selected images')
  const rows = comparisons(summary.comparisons, selected)
  const failures = diagnostics(summary.failures, 'detail')
  const omissions = diagnostics(summary.omissions, 'reason')
  const covered = rows.filter((row) => row.coversRequiredRange).length
  const expected = selected * 6
  const complete =
    boolean(summary.complete) &&
    rows.length === expected &&
    covered === expected &&
    failures.length === 0 &&
    omissions.length === 0
  const lines = [
    '# JPEG XL lossy baseline',
    '',
    `Variant: ${markdownText(variant)}. Mode: ${mode}. Selected images: ${selected}. Elapsed: ${nonnegative(summary.elapsedSeconds, 'elapsed time').toFixed(1)} s.`,
    '',
    `Status: **${complete ? 'complete for selected images' : 'incomplete'}**. Computed comparisons: ${rows.length}/${expected}; required-range coverage: ${covered}/${expected}; failures: ${failures.length}; omissions: ${omissions.length}.`,
    '',
    summary.intervalPolicy === 'required-ranges'
      ? 'Negative BD-rate means fewer bytes at equal quality. SSIMULACRA2 integrates over 60–90 and Butteraugli max over 0.5–3; Butteraugli 3-norm uses the common measured interval. Partial band coverage remains in the aggregates and is reported. Target conclusions remain pending until coverage is complete.'
      : 'Negative BD-rate means fewer bytes at equal quality. Every computable common interval remains in the aggregates, including partial coverage. Target conclusions remain pending until coverage is complete.',
    '',
    '| Metric | Peer | Mean | Median | p90 | Worst | Computed images | Required coverage |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |',
  ]
  const missing: string[] = []
  for (const peer of peers) {
    for (const quality of metrics) {
      const values = rows.filter((row) => row.peer === peer && row.metric === quality)
      const stats = summarizeBdRates(values.map((row) => row.percent))
      const coverage = values.filter((row) => row.coversRequiredRange).length
      lines.push(
        `| ${metricNames[quality]} | ${engineNames[peer]} | ${stats ? percent(stats.mean) : 'N/A'} | ${stats ? percent(stats.median) : 'N/A'} | ${stats ? percent(stats.p90) : 'N/A'} | ${stats ? percent(stats.worst) : 'N/A'} | ${values.length}/${selected} | ${coverage}/${selected} |`,
      )
      if (values.length < selected)
        missing.push(
          `${engineNames[peer]} / ${metricNames[quality]}: ${selected - values.length} missing image comparisons`,
        )
    }
  }
  lines.push(
    '',
    'Required overlap: SSIMULACRA2 60–90; Butteraugli max 0.5–3. Butteraugli 3-norm requires positive common width.',
    '',
    '## Failures and overlap omissions',
    '',
  )
  if (!failures.length && !omissions.length && !missing.length && covered === expected)
    lines.push('None.')
  for (const line of failures) lines.push(`- Failure: ${line}`)
  for (const line of omissions) lines.push(`- Omission: ${line}`)
  for (const row of rows) {
    if (!row.coversRequiredRange)
      lines.push(
        `- Partial overlap: ${markdownText(row.id)} / ${engineNames[row.peer]} / ${metricNames[row.metric]}.`,
      )
  }
  for (const line of missing) lines.push(`- ${line}.`)
  const drops = summary.drops === undefined ? [] : array(summary.drops, 'Corpus reductions')
  if (drops.length) {
    lines.push('', 'Corpus reductions:', '')
    for (const value of drops) {
      const row = object(value)
      lines.push(
        `- ${markdownText(string(row.id))} / ${markdownText(string(row.kind))}: ${markdownText(string(row.reason))}`,
      )
    }
  }
  lines.push(
    '',
    '## Memory',
    '',
    `Curve run managed peak: ${memory(summary.managedPeakBytes)}; process peak RSS: ${memory(summary.processPeakRssBytes)}.`,
  )
  if (speedSummary !== undefined) lines.push(...speedReport(speedSummary, variant))
  else
    lines.push(
      '',
      'Isolated speed summary not supplied; curve-sweep timings are excluded from speed ratios.',
    )
  return `${lines.join('\n')}\n`
}

async function main(args: readonly string[]): Promise<void> {
  const options = new Map<string, string>()
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i]
    const path = args[i + 1]
    if (
      (flag !== '--summary' && flag !== '--speed' && flag !== '--out') ||
      path === undefined ||
      path.startsWith('--') ||
      options.has(flag)
    )
      throw new Error('Usage: report.ts --summary path [--speed path] --out path')
    options.set(flag, path)
  }
  const source = options.get('--summary')
  const target = options.get('--out')
  if (source === undefined || target === undefined)
    throw new Error('Usage: report.ts --summary path [--speed path] --out path')
  const speedPath = options.get('--speed')
  const summary: unknown = JSON.parse(await readFile(source, 'utf8'))
  const speed: unknown =
    speedPath === undefined ? undefined : JSON.parse(await readFile(speedPath, 'utf8'))
  const report = renderBaselineReport(summary, speed)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, report)
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  await main(process.argv.slice(2))
