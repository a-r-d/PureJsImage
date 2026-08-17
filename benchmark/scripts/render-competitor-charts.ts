import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BenchmarkReport, BenchmarkResult } from '../types.ts'

const benchmarkDirectory = dirname(dirname(fileURLToPath(import.meta.url)))
const outputDirectory = join(benchmarkDirectory, 'results')

const argument = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`)
  return index < 0 ? undefined : process.argv[index + 1]
}

const profile = argument('profile') ?? 'competitors'
if (profile !== 'competitors' && profile !== 'web-codecs') {
  throw new Error(`Chart profile must be competitors or web-codecs, received ${profile}`)
}

const latestCompetitorReport = async (): Promise<string> => {
  const candidates = (await readdir(outputDirectory))
    .filter((file) => file.endsWith('.json'))
    .map((file) => join(outputDirectory, file))
  const reports: { readonly path: string; readonly createdAt: string }[] = []
  for (const path of candidates) {
    try {
      const value: unknown = JSON.parse(await readFile(path, 'utf8'))
      if (
        typeof value === 'object' &&
        value !== null &&
        'profile' in value &&
        value.profile === profile &&
        'createdAt' in value &&
        typeof value.createdAt === 'string'
      ) {
        reports.push({ path, createdAt: value.createdAt })
      }
    } catch {
      // Ignore non-report JSON artifacts.
    }
  }
  const latest = reports.sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]
  if (latest === undefined) throw new Error(`No ${profile} report found in ${outputDirectory}`)
  return latest.path
}

const positionalReport = process.argv
  .slice(2)
  .find((value, index, values) => !value.startsWith('--') && values[index - 1] !== '--profile')
const reportPath = argument('report') ?? positionalReport ?? (await latestCompetitorReport())

const engines = [
  { id: 'purejsimage', label: 'PureJsImage · pure JS', color: '#2563eb' },
  {
    id: 'purejsimage-wasm',
    label: 'PureJsImage · WASM opt-in (JPEG/PNG)',
    color: '#c026d3',
  },
  { id: 'jimp', label: 'Jimp · pure JS', color: '#7c3aed' },
  { id: 'sharp', label: 'Sharp · native/libvips', color: '#ea580c' },
  {
    id: 'sharp-single-thread',
    label: 'Sharp 1 thread · native/libvips',
    color: '#dc2626',
  },
  { id: 'image-js', label: 'image-js · pure JS', color: '#059669' },
  { id: 'jsquash', label: 'jSquash · WebAssembly', color: '#0891b2' },
] as const

const competitorWorkflowCandidates = [
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

const webCodecWorkflowCandidates = [
  { id: 'jpeg-resize-1200', label: 'JPEG resize → JPEG' },
  { id: 'png-resize-1000', label: 'PNG resize → PNG' },
  { id: 'webp-large-resize-jpeg', label: 'WebP resize → JPEG' },
  { id: 'tiff-large-resize-jpeg', label: 'TIFF resize → JPEG' },
  { id: 'avif-fox-full-png', label: 'AVIF full decode → PNG' },
  { id: 'avif-fox-resize-jpeg', label: 'AVIF resize → JPEG' },
] as const

const workflowCandidates =
  profile === 'web-codecs' ? webCodecWorkflowCandidates : competitorWorkflowCandidates

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
if (report.profile !== profile) {
  throw new Error(`Expected ${profile} report, received ${report.profile}`)
}
const reportDate = new Date(report.createdAt).toISOString().slice(0, 10)
const reportStem = basename(reportPath).replace(/\.json$/u, '')

const resultByKey = new Map(
  report.results.map((result) => [`${result.engine}:${result.workflow}`, result]),
)

for (const workflow of workflowCandidates) {
  for (const engine of engines) {
    if (!resultByKey.has(`${engine.id}:${workflow.id}`)) {
      throw new Error(`Missing ${engine.id}/${workflow.id} in ${reportPath}`)
    }
  }
}

const passingResults = (workflowId: string): readonly BenchmarkResult[] =>
  engines.flatMap((engine) => {
    const result = resultByKey.get(`${engine.id}:${workflowId}`)
    return result?.summary.status === 'pass' ? [result] : []
  })

const performanceWorkflows = workflowCandidates.filter((workflow) => {
  const passing = passingResults(workflow.id)
  if (profile === 'competitors') return passing.length === engines.length
  return passing.some(({ engine }) => engine === 'purejsimage') && passing.length >= 2
})
if (performanceWorkflows.length === 0) {
  throw new Error('No workflow passed validation for every chart engine')
}
const qualityWorkflows = performanceWorkflows.filter((workflow) => {
  const measured = passingResults(workflow.id).filter(
    ({ summary }) => summary.qualityPsnrDb !== undefined,
  )
  return profile === 'competitors' ? measured.length === engines.length : measured.length >= 2
})
if (qualityWorkflows.length === 0) {
  throw new Error('No workflow reported quality for every chart engine')
}
const finiteQualityValues = qualityWorkflows.flatMap((workflow) =>
  passingResults(workflow.id).flatMap((result) => {
    const quality = result.summary.qualityPsnrDb
    return typeof quality === 'number' ? [quality] : []
  }),
)
if (finiteQualityValues.length === 0) throw new Error('No finite quality values are available')
const qualityMinimum = Math.max(0, Math.floor(Math.min(...finiteQualityValues) / 5) * 5 - 5)
const qualityMaximum = Math.ceil((Math.max(...finiteQualityValues) + 5) / 5) * 5

type Metric = 'memory' | 'quality' | 'speed'

const metricValue = (result: BenchmarkResult, metric: Metric): number => {
  if (result.summary.status !== 'pass') {
    throw new Error(`${result.engine}/${result.workflow} did not pass output validation`)
  }
  let value: number | undefined
  if (metric === 'speed') value = result.summary.wallMilliseconds?.median
  else if (metric === 'memory') value = result.summary.peakRssBytes?.median
  else {
    const quality = result.summary.qualityPsnrDb
    value = quality === 'exact' ? qualityMaximum : quality
  }
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

const formatMetric = (result: BenchmarkResult, value: number, metric: Metric): string => {
  if (metric === 'memory') return `${value.toFixed(1)} MiB`
  if (metric === 'quality') {
    return result.summary.qualityPsnrDb === 'exact' ? 'exact' : `${value.toFixed(2)} dB`
  }
  if (value < 10) return `${value.toFixed(1)} ms`
  return `${Math.round(value).toLocaleString('en-US')} ms`
}

const chartSvg = (metric: Metric): string => {
  const workflows = metric === 'quality' ? qualityWorkflows : performanceWorkflows
  const width = 2400
  const groupHeight = 204
  const height = 490 + workflows.length * groupHeight
  const plotLeft = 760
  const plotRight = 2220
  const plotWidth = plotRight - plotLeft
  const plotTop = 330
  const barHeight = 19
  const rowHeight = 26
  const gridBottom = plotTop + workflows.length * groupHeight - 28
  const speedTicks = [0.1, 1, 10, 100, 1000, 10_000]
  const largestMemory = Math.max(
    ...workflows.flatMap((workflow) =>
      passingResults(workflow.id).map((result) => metricValue(result, 'memory')),
    ),
  )
  const memoryStep = largestMemory > 2000 ? 500 : 200
  const memoryMaximum = Math.ceil(largestMemory / memoryStep) * memoryStep
  const memoryTicks = Array.from(
    { length: memoryMaximum / memoryStep + 1 },
    (_, index) => index * memoryStep,
  )
  const qualityTicks = Array.from(
    { length: (qualityMaximum - qualityMinimum) / 5 + 1 },
    (_, index) => qualityMinimum + index * 5,
  )
  const ticks = metric === 'speed' ? speedTicks : metric === 'memory' ? memoryTicks : qualityTicks
  const title =
    metric === 'speed'
      ? profile === 'web-codecs'
        ? 'Common web codec speed'
        : 'Image workflow speed'
      : metric === 'memory'
        ? profile === 'web-codecs'
          ? 'Common web codec memory'
          : 'Image workflow memory'
        : profile === 'web-codecs'
          ? 'Common web codec quality'
          : 'Image workflow quality'
  const subtitle =
    metric === 'speed'
      ? 'Median wall time · logarithmic scale · lower is better'
      : metric === 'memory'
        ? 'Median absolute peak RSS · linear scale · lower is better'
        : 'Premultiplied RGBA PSNR · linear scale · higher is better'
  const valueToX = (value: number): number => {
    if (metric === 'memory') return plotLeft + (value / memoryMaximum) * plotWidth
    if (metric === 'quality') {
      return plotLeft + ((value - qualityMinimum) / (qualityMaximum - qualityMinimum)) * plotWidth
    }
    const minimum = Math.log10(0.1)
    const maximum = Math.log10(10_000)
    return (
      plotLeft + ((Math.log10(Math.max(value, 0.1)) - minimum) / (maximum - minimum)) * plotWidth
    )
  }

  const grid = ticks
    .map((tick) => {
      const x = valueToX(tick)
      const label =
        metric === 'memory'
          ? `${tick}`
          : metric === 'quality'
            ? `${tick} dB`
            : tick.toLocaleString('en-US')
      return `<line x1="${x}" y1="${plotTop - 22}" x2="${x}" y2="${gridBottom}" stroke="#dbe3ef" stroke-width="2" />
        <text x="${x}" y="${plotTop - 38}" text-anchor="middle" class="tick">${label}</text>`
    })
    .join('\n')

  const legend = engines
    .map((engine, index) => {
      const x = 54 + (index % 3) * 780
      const y = 214 + Math.floor(index / 3) * 38
      return `<rect x="${x}" y="${y}" width="24" height="24" rx="5" fill="${engine.color}" />
        <text x="${x + 36}" y="${y + 19}" class="legend">${escapeXml(engine.label)}</text>`
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
          const y = groupTop + 28 + engineIndex * rowHeight
          if (result.summary.status !== 'pass') {
            return `<text x="730" y="${y + 15}" text-anchor="end" class="engine">${escapeXml(engine.label)}</text>
              <text x="${plotLeft + 12}" y="${y + 15}" class="unsupported">unsupported</text>`
          }
          if (metric === 'quality' && result.summary.qualityPsnrDb === undefined) {
            return `<text x="730" y="${y + 15}" text-anchor="end" class="engine">${escapeXml(engine.label)}</text>
              <text x="${plotLeft + 12}" y="${y + 15}" class="unsupported">not measured</text>`
          }
          const value = metricValue(result, metric)
          const endX = valueToX(value)
          const widthValue = Math.max(endX - plotLeft, 3)
          return `<text x="730" y="${y + 15}" text-anchor="end" class="engine">${escapeXml(engine.label)}</text>
            <rect x="${plotLeft}" y="${y}" width="${widthValue}" height="${barHeight}" rx="4" fill="${engine.color}" />
            <text x="${Math.min(endX + 12, 2290)}" y="${y + 15}" class="value">${escapeXml(formatMetric(result, value, metric))}</text>`
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
      ? 'Resize uses engine defaults: PureJsImage and Sharp use Lanczos 3; Jimp uses bilinear. Timings include encoding and are not matched quality across kernels or lossy encoders.'
      : metric === 'memory'
        ? 'Absolute process RSS from isolated workers. PureJsImage WASM accelerates JPEG/PNG only and uses TypeScript fallback for WebP, TIFF, and AVIF; jSquash AVIF is WebAssembly.'
        : 'Premultiplied-RGBA PSNR against an independently decoded exact-area reference. Exact means every compared channel matched. Quality measurement is outside timing.'

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title subtitle">
    <title id="title">${escapeXml(title)}</title>
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
      .unsupported { font-size: 17px; font-weight: 700; fill: #94a3b8; }
      .footer { font-size: 20px; fill: #526077; }
      .source { font-size: 18px; fill: #718096; }
    </style>
    <text x="54" y="78" class="title" id="heading">${title}</text>
    <text x="54" y="124" class="subtitle" id="subtitle">${subtitle}</text>
    <text x="54" y="168" class="source">Validated ${escapeXml(profile)} profile · ${escapeXml(reportDate)} · ${escapeXml(environment)}</text>
    ${legend}
    ${grid}
    ${bars}
    <text x="54" y="${height - 90}" class="footer">${escapeXml(footer)}</text>
    <text x="54" y="${height - 50}" class="source">Source: ${escapeXml(basename(reportPath))} · Unsupported rows are explicit; only validated outputs contribute performance bars.</text>
  </svg>`
}

const chartPrefix = profile === 'competitors' ? 'competitors' : 'web-codecs'
const speedPath = join(outputDirectory, `${chartPrefix}-speed-${reportStem}.svg`)
const memoryPath = join(outputDirectory, `${chartPrefix}-memory-${reportStem}.svg`)
const qualityPath = join(outputDirectory, `${chartPrefix}-quality-${reportStem}.svg`)

const writeSvg = async (path: string, svg: string): Promise<void> => {
  await writeFile(path, `${svg.trimEnd()}\n`)
}

await mkdir(outputDirectory, { recursive: true })
await Promise.all([
  writeSvg(speedPath, chartSvg('speed')),
  writeSvg(memoryPath, chartSvg('memory')),
  writeSvg(qualityPath, chartSvg('quality')),
])

console.log(speedPath)
console.log(memoryPath)
console.log(qualityPath)
