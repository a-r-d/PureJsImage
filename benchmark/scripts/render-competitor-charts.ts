import { readFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import type { BenchmarkReport, BenchmarkResult } from '../types.ts'

const benchmarkDirectory = dirname(dirname(fileURLToPath(import.meta.url)))
const defaultReportPath = join(benchmarkDirectory, 'results', 'competitors-2026-08-08.json')
const reportPath = process.argv[2] ?? defaultReportPath
const outputDirectory = join(benchmarkDirectory, 'results')

const engines = [
  { id: 'purejsimage', label: 'PureJsImage · pure JS', color: '#2563eb' },
  { id: 'jimp', label: 'Jimp · pure JS', color: '#7c3aed' },
  { id: 'sharp', label: 'Sharp · native/libvips', color: '#ea580c' },
  {
    id: 'sharp-single-thread',
    label: 'Sharp 1 thread · native/libvips',
    color: '#dc2626',
  },
  { id: 'image-js', label: 'image-js · pure JS', color: '#059669' },
] as const

const workflows = [
  { id: 'metadata-jpeg-large', label: 'Large JPEG metadata' },
  { id: 'jpeg-resize-1200', label: 'JPEG resize → JPEG' },
  { id: 'northstar-photo-pipeline', label: 'Northstar photo pipeline' },
  { id: 'jpeg-crop-resize', label: 'JPEG crop + resize' },
  { id: 'png-resize-1000', label: 'Large PNG resize' },
  { id: 'png-alpha-resize', label: 'Transparent PNG resize' },
  { id: 'jpeg-to-png', label: 'JPEG → PNG' },
  { id: 'tiff-large-resize-jpeg', label: 'TIFF resize → JPEG' },
  { id: 'stress-100mp-downscale', label: '100 MP PNG downscale' },
] as const

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isBenchmarkResult = (value: unknown): value is BenchmarkResult => {
  if (!isRecord(value) || !isRecord(value.summary)) return false
  return (
    typeof value.engine === 'string' &&
    typeof value.workflow === 'string' &&
    typeof value.title === 'string' &&
    typeof value.runs === 'number' &&
    typeof value.warmups === 'number' &&
    Array.isArray(value.samples) &&
    typeof value.summary.status === 'string' &&
    Array.isArray(value.summary.errors)
  )
}

const isBenchmarkReport = (value: unknown): value is BenchmarkReport => {
  return (
    isRecord(value) &&
    typeof value.schemaVersion === 'number' &&
    typeof value.createdAt === 'string' &&
    typeof value.profile === 'string' &&
    isRecord(value.environment) &&
    typeof value.environment.node === 'string' &&
    typeof value.environment.platform === 'string' &&
    typeof value.environment.architecture === 'string' &&
    Array.isArray(value.results) &&
    value.results.every(isBenchmarkResult)
  )
}

const reportSource = await readFile(reportPath, 'utf8')
const parsedReport: unknown = JSON.parse(reportSource)
if (!isBenchmarkReport(parsedReport)) {
  throw new Error(`Invalid benchmark report: ${reportPath}`)
}
const report = parsedReport

const resultByKey = new Map(
  report.results.map((result) => [`${result.engine}:${result.workflow}`, result]),
)

type Metric = 'memory' | 'speed'

const metricValue = (result: BenchmarkResult, metric: Metric): number => {
  if (result.summary.status !== 'pass') {
    throw new Error(`${result.engine}/${result.workflow} did not pass output validation`)
  }
  const value =
    metric === 'speed'
      ? result.summary.wallMilliseconds?.median
      : result.summary.peakRssBytes?.median
  if (value === undefined || !Number.isFinite(value) || value < 0) {
    throw new Error(`${result.engine}/${result.workflow} has no valid ${metric} metric`)
  }
  return metric === 'memory' ? value / (1024 * 1024) : value
}

const escapeXml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')

const formatMetric = (value: number, metric: Metric): string => {
  if (metric === 'memory') return `${value.toFixed(1)} MiB`
  if (value < 10) return `${value.toFixed(1)} ms`
  return `${Math.round(value).toLocaleString('en-US')} ms`
}

const chartSvg = (metric: Metric): string => {
  const width = 2400
  const height = 2070
  const plotLeft = 760
  const plotRight = 2220
  const plotWidth = plotRight - plotLeft
  const plotTop = 300
  const groupHeight = 178
  const barHeight = 19
  const rowHeight = 26
  const gridBottom = plotTop + workflows.length * groupHeight - 28
  const speedTicks = [0.1, 1, 10, 100, 1000, 10_000]
  const memoryTicks = [0, 200, 400, 600, 800, 1000, 1200, 1400]
  const ticks = metric === 'speed' ? speedTicks : memoryTicks
  const title = metric === 'speed' ? 'Image workflow speed' : 'Image workflow memory'
  const subtitle =
    metric === 'speed'
      ? 'Median wall time · logarithmic scale · lower is better'
      : 'Median absolute peak RSS · linear scale · lower is better'
  const valueToX = (value: number): number => {
    if (metric === 'memory') return plotLeft + (value / 1400) * plotWidth
    const minimum = Math.log10(0.1)
    const maximum = Math.log10(10_000)
    return (
      plotLeft + ((Math.log10(Math.max(value, 0.1)) - minimum) / (maximum - minimum)) * plotWidth
    )
  }

  const grid = ticks
    .map((tick) => {
      const x = valueToX(tick)
      const label = metric === 'memory' ? `${tick}` : tick.toLocaleString('en-US')
      return `<line x1="${x}" y1="${plotTop - 22}" x2="${x}" y2="${gridBottom}" stroke="#dbe3ef" stroke-width="2" />
        <text x="${x}" y="${plotTop - 38}" text-anchor="middle" class="tick">${label}</text>`
    })
    .join('\n')

  const legend = engines
    .map((engine, index) => {
      const x = 54 + index * 455
      return `<rect x="${x}" y="218" width="24" height="24" rx="5" fill="${engine.color}" />
        <text x="${x + 36}" y="237" class="legend">${escapeXml(engine.label)}</text>`
    })
    .join('\n')

  const bars = workflows
    .map((workflow, workflowIndex) => {
      const groupTop = plotTop + workflowIndex * groupHeight
      const rows = engines
        .map((engine, engineIndex) => {
          const result = resultByKey.get(`${engine.id}:${workflow.id}`)
          if (result === undefined) {
            throw new Error(`Missing ${engine.id}/${workflow.id} in ${reportPath}`)
          }
          const value = metricValue(result, metric)
          const endX = valueToX(value)
          const y = groupTop + 28 + engineIndex * rowHeight
          const widthValue = Math.max(endX - plotLeft, 3)
          return `<text x="730" y="${y + 15}" text-anchor="end" class="engine">${escapeXml(engine.label)}</text>
            <rect x="${plotLeft}" y="${y}" width="${widthValue}" height="${barHeight}" rx="4" fill="${engine.color}" />
            <text x="${Math.min(endX + 12, 2290)}" y="${y + 15}" class="value">${escapeXml(formatMetric(value, metric))}</text>`
        })
        .join('\n')
      return `<text x="54" y="${groupTop + 17}" class="workflow">${escapeXml(workflow.label)}</text>
        <line x1="54" y1="${groupTop + groupHeight - 17}" x2="2328" y2="${groupTop + groupHeight - 17}" stroke="#e8edf5" stroke-width="2" />
        ${rows}`
    })
    .join('\n')

  const environment = `${report.environment.platform} ${report.environment.architecture} · ${report.environment.node}`
  const footer =
    metric === 'speed'
      ? 'Sharp and Sharp 1 thread use native libvips code. All other engines are pure JavaScript. Timings include encoding; lossy quality scales are not matched across encoders.'
      : 'Absolute process RSS from isolated workers. Sharp and Sharp 1 thread use native libvips code; all other engines are pure JavaScript.'

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="${width}" height="${height}" fill="#f8fafc" />
    <style>
      text { font-family: Inter, Arial, sans-serif; fill: #172033; }
      .title { font-size: 56px; font-weight: 750; }
      .subtitle { font-size: 28px; fill: #526077; }
      .legend { font-size: 20px; font-weight: 650; }
      .tick { font-size: 19px; fill: #64748b; }
      .workflow { font-size: 24px; font-weight: 750; }
      .engine { font-size: 18px; fill: #40506a; }
      .value { font-size: 17px; font-weight: 700; fill: #273449; }
      .footer { font-size: 20px; fill: #526077; }
      .source { font-size: 18px; fill: #718096; }
    </style>
    <text x="54" y="78" class="title">${title}</text>
    <text x="54" y="124" class="subtitle">${subtitle}</text>
    <text x="54" y="168" class="source">Validated competitors profile · ${escapeXml(new Date(report.createdAt).toISOString().slice(0, 10))} · ${escapeXml(environment)}</text>
    ${legend}
    ${grid}
    ${bars}
    <text x="54" y="1980" class="footer">${escapeXml(footer)}</text>
    <text x="54" y="2020" class="source">Source: ${escapeXml(basename(reportPath))} · Only workflows that passed equivalent-output validation for all five engines are shown.</text>
  </svg>`
}

const speedPath = join(outputDirectory, 'competitors-speed-2026-08-08.png')
const memoryPath = join(outputDirectory, 'competitors-memory-2026-08-08.png')

await Promise.all([
  sharp(Buffer.from(chartSvg('speed')))
    .png()
    .toFile(speedPath),
  sharp(Buffer.from(chartSvg('memory')))
    .png()
    .toFile(memoryPath),
])

console.log(speedPath)
console.log(memoryPath)
