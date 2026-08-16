import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

interface SampleProjection {
  readonly engine: string
  readonly workload: string
  readonly status: string
  readonly requests: number
  readonly returnedBytes: number
  readonly stableMilliseconds: number | null
}

interface ReportProjection {
  readonly browser: string
  readonly phase: string
  readonly latencyMilliseconds: number
  readonly cacheMode: string
  readonly throughputBytesPerSecond: number | null
  readonly samples: readonly SampleProjection[]
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const finiteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const parseReport = (value: unknown): ReportProjection | undefined => {
  if (
    !isRecord(value) ||
    typeof value.browser !== 'string' ||
    typeof value.phase !== 'string' ||
    typeof value.scope !== 'string' ||
    value.scope === 'all' ||
    !finiteNumber(value.latencyProfileMilliseconds) ||
    !Array.isArray(value.samples)
  )
    return undefined
  const cacheMode = typeof value.cacheMode === 'string' ? value.cacheMode : 'immutable'
  const throughputBytesPerSecond =
    value.throughputBytesPerSecond === undefined || value.throughputBytesPerSecond === null
      ? null
      : value.throughputBytesPerSecond
  if (throughputBytesPerSecond !== null && !finiteNumber(throughputBytesPerSecond)) {
    return undefined
  }
  const samples: SampleProjection[] = []
  for (const entry of value.samples) {
    if (
      !isRecord(entry) ||
      !isRecord(entry.engine) ||
      !isRecord(entry.workload) ||
      !isRecord(entry.data) ||
      !isRecord(entry.latency)
    )
      return undefined
    if (
      typeof entry.engine.id !== 'string' ||
      typeof entry.workload.id !== 'string' ||
      typeof entry.status !== 'string' ||
      !finiteNumber(entry.data.requests) ||
      !finiteNumber(entry.data.returnedBytes)
    )
      return undefined
    const stable = entry.latency.stableCompletedViewportMilliseconds
    if (stable !== null && !finiteNumber(stable)) return undefined
    samples.push({
      engine: entry.engine.id,
      workload: entry.workload.id,
      status: entry.status,
      requests: entry.data.requests,
      returnedBytes: entry.data.returnedBytes,
      stableMilliseconds: stable,
    })
  }
  return Object.freeze({
    browser: value.browser,
    phase: value.phase,
    latencyMilliseconds: value.latencyProfileMilliseconds,
    cacheMode,
    throughputBytesPerSecond,
    samples: Object.freeze(samples),
  })
}

const median = (values: readonly number[]): number | null => {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? null)
}

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')

const directory = resolve(process.env.PUREJSIMAGE_VIEWER_RESULTS ?? 'benchmark/viewers/results')
await mkdir(directory, { recursive: true })
const files = await readdir(directory)
const reports: ReportProjection[] = []
for (const file of files.filter(
  (name) => name.endsWith('.json') && !name.includes('charts') && !name.includes('footprint'),
)) {
  const parsedJson: unknown = JSON.parse(await readFile(resolve(directory, file), 'utf8'))
  const parsed = parseReport(parsedJson)
  if (parsed !== undefined) reports.push(parsed)
}

const grouped = new Map<
  string,
  {
    readonly engine: string
    readonly browser: string
    readonly phase: string
    readonly latency: number
    readonly cacheMode: string
    readonly throughputBytesPerSecond: number | null
    requests: number[]
    bytes: number[]
    stable: number[]
    supported: number
    unsupported: number
  }
>()
for (const report of reports) {
  for (const sample of report.samples) {
    const key = `${report.browser}|${report.phase}|${report.latencyMilliseconds}|${report.cacheMode}|${report.throughputBytesPerSecond ?? 'unlimited'}|${sample.engine}`
    const existing = grouped.get(key)
    if (existing === undefined) {
      grouped.set(key, {
        engine: sample.engine,
        browser: report.browser,
        phase: report.phase,
        latency: report.latencyMilliseconds,
        cacheMode: report.cacheMode,
        throughputBytesPerSecond: report.throughputBytesPerSecond,
        requests: [sample.requests],
        bytes: [sample.returnedBytes],
        stable: sample.stableMilliseconds === null ? [] : [sample.stableMilliseconds],
        supported: sample.status === 'supported' ? 1 : 0,
        unsupported: sample.status === 'unsupported' ? 1 : 0,
      })
    } else {
      existing.requests.push(sample.requests)
      existing.bytes.push(sample.returnedBytes)
      if (sample.stableMilliseconds !== null) existing.stable.push(sample.stableMilliseconds)
      if (sample.status === 'supported') existing.supported += 1
      if (sample.status === 'unsupported') existing.unsupported += 1
    }
  }
}

const rows = [...grouped.values()].map((entry) => ({
  browser: entry.browser,
  phase: entry.phase,
  latencyProfileMilliseconds: entry.latency,
  cacheMode: entry.cacheMode,
  throughputBytesPerSecond: entry.throughputBytesPerSecond,
  engine: entry.engine,
  medianRequests: median(entry.requests),
  medianReturnedBytes: median(entry.bytes),
  medianStableViewportMilliseconds: median(entry.stable),
  supportedSamples: entry.supported,
  unsupportedSamples: entry.unsupported,
}))
const chartData = Object.freeze({ schemaVersion: 1, generatedAt: new Date().toISOString(), rows })
await writeFile(resolve(directory, 'viewer-charts.json'), `${JSON.stringify(chartData, null, 2)}\n`)

const table = rows
  .map(
    (row) =>
      `<tr><td>${escapeHtml(row.browser)}</td><td>${escapeHtml(row.phase)}</td><td>${row.latencyProfileMilliseconds}</td><td>${escapeHtml(row.cacheMode)}</td><td>${row.throughputBytesPerSecond ?? 'unlimited'}</td><td>${escapeHtml(row.engine)}</td><td>${row.medianRequests ?? '-'}</td><td>${row.medianReturnedBytes ?? '-'}</td><td>${row.medianStableViewportMilliseconds ?? '-'}</td><td>${row.supportedSamples}</td><td>${row.unsupportedSamples}</td></tr>`,
  )
  .join('')
await writeFile(
  resolve(directory, 'viewer-charts.html'),
  `<!doctype html><meta charset="utf-8"><title>PureJsImage viewer benchmark charts</title><style>body{font:14px system-ui;margin:2rem}table{border-collapse:collapse}td,th{border:1px solid #bbb;padding:.35rem .55rem;text-align:right}td:nth-child(6),th:nth-child(6){text-align:left}</style><h1>Scientific viewer benchmark reports</h1><p>Separate engine-family diagnostics; no universal score.</p><table><thead><tr><th>Browser</th><th>Phase</th><th>Latency ms</th><th>Cache mode</th><th>Throughput B/s</th><th>Engine</th><th>Median requests</th><th>Median returned bytes</th><th>Median stable viewport ms</th><th>Supported samples</th><th>Unsupported samples</th></tr></thead><tbody>${table}</tbody></table>`,
)

const readJsonRecord = async (path: string): Promise<Readonly<Record<string, unknown>>> => {
  const value: unknown = JSON.parse(await readFile(path, 'utf8'))
  if (!isRecord(value)) throw new Error(`${path} must contain a JSON object`)
  return value
}

const rootPackage = await readJsonRecord(resolve('package.json'))
const viewerPackage = await readJsonRecord(resolve('benchmark/viewers/package.json'))
const rootDependencies = isRecord(rootPackage.dependencies)
  ? Object.keys(rootPackage.dependencies)
  : []
const viewerDependencies = isRecord(viewerPackage.devDependencies)
  ? Object.keys(viewerPackage.devDependencies)
  : []
const lockPath = resolve('benchmark/viewers/package-lock.json')
const lockBytes = (await stat(lockPath)).size
const assetBytes = (
  await Promise.all(
    (
      await readdir(directory)
    )
      .filter((name) => name.endsWith('.json') || name.endsWith('.md'))
      .map(async (name) => (await stat(resolve(directory, name))).size),
  )
).reduce((total, size) => total + size, 0)
const footprint = Object.freeze({
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  publishedPackage: {
    runtimeDependencyCount: rootDependencies.length,
    runtimeDependencies: rootDependencies,
  },
  viewerBenchmarkPackage: {
    devOnlyDependencyCount: viewerDependencies.length,
    devDependencies: viewerDependencies,
    packageLockBytes: lockBytes,
  },
  generatedReportAssetBytes: assetBytes,
  note: 'Viewer dependencies are isolated under benchmark/viewers and are not published package runtime dependencies.',
})
await writeFile(
  resolve(directory, 'package-footprint.json'),
  `${JSON.stringify(footprint, null, 2)}\n`,
)
