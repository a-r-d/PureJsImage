import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative } from 'node:path'
import { jpegCodec } from '../src/codec-entries/jpeg.ts'
import { pngCodec } from '../src/codec-entries/png.ts'
import { createImageLibrary } from '../src/index.ts'
import { readCapabilityManifest } from './capability-manifest.ts'
import { formatKibibytes, formatMebibytes, parsePackageMetrics } from './bundle-size.ts'

const readmeAssetLibrary = createImageLibrary([jpegCodec, pngCodec])

const encodeReadmeRaster = async (
  source: Uint8Array,
  options: {
    readonly format: 'jpeg' | 'png'
    readonly quality?: number
    readonly width: number
  },
): Promise<Uint8Array> => {
  const image = await readmeAssetLibrary.open(source)
  const resized = image.resize({ width: options.width, withoutEnlargement: true })
  return options.format === 'jpeg'
    ? resized.jpeg({ quality: options.quality ?? 80 }).toUint8Array()
    : resized.png().toUint8Array()
}

type ValidationStatus = 'failed' | 'partial' | 'passed' | 'unverified'

interface ResultIndexEntry {
  readonly date: string
  readonly eligibleForDocumentationHeadlines: boolean
  readonly profile: string
  readonly resultPaths: readonly string[]
  readonly validationStatus: ValidationStatus
}

interface ResultIndex {
  readonly path: string
  readonly results: readonly ResultIndexEntry[]
}

interface OrdinaryResult {
  readonly engine: string
  readonly quality: number | 'exact' | null
  readonly peakRssBytes: number | null
  readonly status: string
  readonly wallMilliseconds: number | null
  readonly workflow: string
}

interface ScientificBaselineResult {
  readonly measurementClass: string
  readonly oracle: string
  readonly outputSampleType: string
  readonly readerId: string
  readonly status: string
  readonly workloadId: string
}

interface ScientificCompetitorEngine {
  readonly id: string
  readonly implementationClass: string
  readonly packageVersion: string
}

interface ScientificCompetitorResult {
  readonly correctnessStable: boolean
  readonly engineId: string
  readonly implementationClass: string
  readonly packageVersion: string
  readonly family: string
  readonly firstUsableDataCvPercent: number | null
  readonly firstUsableDataMilliseconds: number
  readonly inputCopyBytes: number
  readonly eligibleForCharts: boolean
  readonly peakRssCvPercent: number | null
  readonly peakRssBytes: number
  readonly lowNoise: boolean
  readonly requestCount: number
  readonly sourceBytesCvPercent: number | null
  readonly sourceBytes: number
  readonly representative: boolean
  readonly status: string
  readonly title: string
  readonly totalWallCvPercent: number | null
  readonly totalWallMilliseconds: number
  readonly workloadId: string
}

interface ScientificBundleMetric {
  readonly brotliJavaScriptBytes: number
  readonly engineId: string
  readonly gzipJavaScriptBytes: number
  readonly installedBytes: number
  readonly rawWasmBytes: number
}

interface GeneratedChart {
  readonly content: string
  readonly filename: string
  readonly title: string
}

const repositoryDirectory = process.cwd()
const checkOnly = process.argv.includes('--check')
const writeMode = process.argv.includes('--write')
if (checkOnly === writeMode) {
  throw new Error('Use exactly one of --write or --check')
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const stringValue = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} must be a string`)
  return value
}

const numberValue = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`)
  }
  return value
}

const booleanValue = (value: unknown, label: string): boolean => {
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean`)
  return value
}

const nullableNumber = (value: unknown, label: string): number | null =>
  value === null || value === undefined ? null : numberValue(value, label)

const recordValue = (value: unknown, label: string): Readonly<Record<string, unknown>> => {
  if (!isRecord(value)) throw new Error(`${label} must be an object`)
  return value
}

const arrayValue = (value: unknown, label: string): readonly unknown[] => {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  return value
}

const validationStatus = (value: unknown, label: string): ValidationStatus => {
  const status = stringValue(value, label)
  switch (status) {
    case 'failed':
    case 'partial':
    case 'passed':
    case 'unverified':
      return status
    default:
      throw new Error(`${label} has invalid validation status ${status}`)
  }
}

const readJson = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, 'utf8'))

const portablePath = (path: string): string =>
  relative(repositoryDirectory, path).replaceAll('\\', '/')

const pathExists = async (path: string): Promise<boolean> =>
  stat(path)
    .then(() => true)
    .catch(() => false)

const latestResultIndex = async (): Promise<ResultIndex> => {
  const path = join(repositoryDirectory, 'benchmark', 'results', 'public', 'index.json')
  const document = recordValue(await readJson(path), path)
  const results = arrayValue(document.results, `${path}.results`).map((entry, index) => {
    const value = recordValue(entry, `${path}.results[${index}]`)
    return {
      date: stringValue(value.date, `${path}.results[${index}].date`),
      eligibleForDocumentationHeadlines: booleanValue(
        value.eligibleForDocumentationHeadlines,
        `${path}.results[${index}].eligibleForDocumentationHeadlines`,
      ),
      profile: stringValue(value.profile, `${path}.results[${index}].profile`),
      resultPaths: arrayValue(value.resultPaths, `${path}.results[${index}].resultPaths`).map(
        (resultPath, pathIndex) =>
          stringValue(resultPath, `${path}.results[${index}].resultPaths[${pathIndex}]`),
      ),
      validationStatus: validationStatus(
        value.validationStatus,
        `${path}.results[${index}].validationStatus`,
      ),
    }
  })
  return { path, results }
}

const latestEntry = (index: ResultIndex, profile: string): ResultIndexEntry => {
  const entry = index.results
    .filter((candidate) => candidate.profile === profile)
    .sort((left, right) => right.date.localeCompare(left.date))[0]
  if (entry === undefined) throw new Error(`Result index has no ${profile} profile`)
  return entry
}

const jsonResultPath = (entry: ResultIndexEntry): string => {
  const path = entry.resultPaths.find((candidate) => candidate.endsWith('.json'))
  if (path === undefined) throw new Error(`${entry.profile} result has no JSON path`)
  return join(repositoryDirectory, path)
}

const parseOrdinaryReport = (value: unknown, path: string) => {
  const report = recordValue(value, path)
  const data = recordValue(report.data, `${path}.data`)
  const environment = recordValue(data.environment, `${path}.data.environment`)
  const results = arrayValue(data.results, `${path}.data.results`).map((entry, index) => {
    const result = recordValue(entry, `${path}.data.results[${index}]`)
    const qualityValue = result.quality
    return {
      engine: stringValue(result.engine, `${path}.data.results[${index}].engine`),
      peakRssBytes: nullableNumber(
        result.peakRssBytes,
        `${path}.data.results[${index}].peakRssBytes`,
      ),
      quality:
        qualityValue === 'exact'
          ? 'exact'
          : nullableNumber(qualityValue, `${path}.data.results[${index}].quality`),
      status: stringValue(result.status, `${path}.data.results[${index}].status`),
      wallMilliseconds: nullableNumber(
        result.wallMilliseconds,
        `${path}.data.results[${index}].wallMilliseconds`,
      ),
      workflow: stringValue(result.workflow, `${path}.data.results[${index}].workflow`),
    } satisfies OrdinaryResult
  })
  const invalid = results.filter(({ status }) => status !== 'pass' && status !== 'unsupported')
  if (invalid.length > 0) {
    throw new Error(`Ordinary headline report contains failed output: ${invalid[0]?.status}`)
  }
  const startup = arrayValue(data.engines, `${path}.data.engines`).map((entry, index) => {
    const engine = recordValue(entry, `${path}.data.engines[${index}]`)
    return {
      id: stringValue(engine.id, `${path}.data.engines[${index}].id`),
      kind: stringValue(engine.kind, `${path}.data.engines[${index}].kind`),
      version: stringValue(engine.version, `${path}.data.engines[${index}].version`),
    }
  })
  if (startup.length === 0) throw new Error('Ordinary headline report omits engine versions')
  return {
    charts: recordValue(data.charts, `${path}.data.charts`),
    createdAt: stringValue(data.createdAt, `${path}.data.createdAt`),
    environment: {
      architecture: stringValue(environment.architecture, `${path}.environment.architecture`),
      cpu: stringValue(environment.cpu, `${path}.environment.cpu`),
      fingerprint: stringValue(environment.fingerprint, `${path}.environment.fingerprint`),
      node: stringValue(environment.node, `${path}.environment.node`),
      os: stringValue(environment.os, `${path}.environment.os`),
      runner: stringValue(environment.runner, `${path}.environment.runner`),
      v8: stringValue(environment.v8, `${path}.environment.v8`),
    },
    fixtureManifestHash: stringValue(data.fixtureManifestHash, `${path}.data.fixtureManifestHash`),
    results,
    startup,
  }
}

const parseScientificReport = (value: unknown, path: string) => {
  const report = recordValue(value, path)
  const data = recordValue(report.data, `${path}.data`)
  const engine = recordValue(data.engine, `${path}.data.engine`)
  const environment = recordValue(data.environment, `${path}.data.environment`)
  const results = arrayValue(data.results, `${path}.data.results`).map((entry, index) => {
    const result = recordValue(entry, `${path}.data.results[${index}]`)
    return {
      measurementClass: stringValue(
        result.measurementClass,
        `${path}.data.results[${index}].measurementClass`,
      ),
      oracle: stringValue(result.oracle, `${path}.data.results[${index}].oracle`),
      outputSampleType: stringValue(
        result.outputSampleType,
        `${path}.data.results[${index}].outputSampleType`,
      ),
      readerId: stringValue(result.readerId, `${path}.data.results[${index}].readerId`),
      status: stringValue(result.status, `${path}.data.results[${index}].status`),
      workloadId: stringValue(result.workloadId, `${path}.data.results[${index}].workloadId`),
    }
  })
  const failed = results.filter(({ status }) => status !== 'supported')
  if (failed.length > 0) {
    throw new Error(`Scientific headline report contains failed output: ${failed[0]?.status}`)
  }
  return {
    createdAt: stringValue(data.createdAt, `${path}.data.createdAt`),
    engine: {
      id: stringValue(engine.id, `${path}.configuration.engine.id`),
      version: stringValue(engine.version, `${path}.configuration.engine.version`),
    },
    environment: {
      architecture: stringValue(environment.architecture, `${path}.environment.architecture`),
      cpu: stringValue(environment.cpu, `${path}.environment.cpu`),
      fingerprint: stringValue(environment.fingerprint, `${path}.environment.fingerprint`),
      node: stringValue(environment.node, `${path}.environment.node`),
      os: stringValue(environment.os, `${path}.environment.os`),
      v8: stringValue(environment.v8, `${path}.environment.v8`),
    },
    results,
  }
}

const parseScientificRangeReport = (value: unknown, path: string) => {
  const report = recordValue(value, path)
  const data = recordValue(report.data, `${path}.data`)
  return arrayValue(data.results, `${path}.data.results`).map((entry, index) => {
    const result = recordValue(entry, `${path}.data.results[${index}]`)
    return {
      readerId: stringValue(result.readerId, `${path}.data.results[${index}].readerId`),
      status: stringValue(result.status, `${path}.data.results[${index}].status`),
    }
  })
}

const parseScientificScalingReport = (value: unknown, path: string) => {
  const report = recordValue(value, path)
  const data = recordValue(report.data, `${path}.data`)
  const results = arrayValue(data.results, `${path}.data.results`).map((entry, index) => {
    const result = recordValue(entry, `${path}.data.results[${index}]`)
    return {
      eligibleForCharts: booleanValue(
        result.eligibleForCharts,
        `${path}.data.results[${index}].eligibleForCharts`,
      ),
      status: stringValue(result.status, `${path}.data.results[${index}].status`),
      workloadId: stringValue(result.workloadId, `${path}.data.results[${index}].workloadId`),
    }
  })
  if (results.some(({ status }) => status !== 'supported')) {
    throw new Error('Scientific scaling report contains failed output')
  }
  return {
    createdAt: stringValue(data.createdAt, `${path}.data.createdAt`),
    results,
  }
}

const parseScientificCompetitorReport = (value: unknown, path: string) => {
  const report = recordValue(value, path)
  const data = recordValue(report.data, `${path}.data`)
  const environment = recordValue(data.environment, `${path}.data.environment`)
  const engines = arrayValue(data.engines, `${path}.data.engines`).map((entry, index) => {
    const engine = recordValue(entry, `${path}.engines[${index}]`)
    return {
      id: stringValue(engine.id, `${path}.engines[${index}].id`),
      implementationClass: stringValue(
        engine.implementationClass,
        `${path}.engines[${index}].implementationClass`,
      ),
      packageVersion: stringValue(
        engine.packageVersion,
        `${path}.engines[${index}].packageVersion`,
      ),
    }
  })
  if (engines.length === 0) throw new Error('Scientific competitor report omits engine versions')
  const results = arrayValue(data.results, `${path}.data.results`).map((entry, index) => {
    const result = recordValue(entry, `${path}.results[${index}]`)
    const engineId = stringValue(result.engineId, `${path}.results[${index}].engineId`)
    const engineMetadata = engines.find((candidate) => candidate.id === engineId)
    if (engineMetadata === undefined) {
      throw new Error(`${path}.results[${index}] references unrecorded engine ${engineId}`)
    }
    return {
      correctnessStable: booleanValue(
        result.correctnessStable,
        `${path}.results[${index}].correctnessStable`,
      ),
      engineId,
      family: stringValue(result.family, `${path}.results[${index}].family`),
      firstUsableDataCvPercent: nullableNumber(
        result.firstUsableDataCvPercent,
        `${path}.results[${index}].firstUsableDataCvPercent`,
      ),
      firstUsableDataMilliseconds: numberValue(
        result.firstUsableDataMilliseconds,
        `${path}.results[${index}].firstUsableDataMilliseconds`,
      ),
      inputCopyBytes: numberValue(
        result.inputCopyBytes,
        `${path}.results[${index}].inputCopyBytes`,
      ),
      eligibleForCharts: booleanValue(
        result.eligibleForCharts,
        `${path}.results[${index}].eligibleForCharts`,
      ),
      implementationClass: engineMetadata.implementationClass,
      packageVersion: engineMetadata.packageVersion,
      peakRssCvPercent: nullableNumber(
        result.peakRssCvPercent,
        `${path}.results[${index}].peakRssCvPercent`,
      ),
      peakRssBytes: numberValue(result.peakRssBytes, `${path}.results[${index}].peakRssBytes`),
      lowNoise: booleanValue(result.lowNoise, `${path}.results[${index}].lowNoise`),
      requestCount: numberValue(result.requestCount, `${path}.results[${index}].requestCount`),
      sourceBytesCvPercent: nullableNumber(
        result.sourceBytesCvPercent,
        `${path}.results[${index}].sourceBytesCvPercent`,
      ),
      sourceBytes: numberValue(result.sourceBytes, `${path}.results[${index}].sourceBytes`),
      representative: booleanValue(
        result.representative,
        `${path}.results[${index}].representative`,
      ),
      status: stringValue(result.status, `${path}.results[${index}].status`),
      title: stringValue(result.title, `${path}.results[${index}].title`),
      totalWallCvPercent: nullableNumber(
        result.totalWallCvPercent,
        `${path}.results[${index}].totalWallCvPercent`,
      ),
      totalWallMilliseconds: numberValue(
        result.totalWallMilliseconds,
        `${path}.results[${index}].totalWallMilliseconds`,
      ),
      workloadId: stringValue(result.workloadId, `${path}.results[${index}].workloadId`),
    }
  })
  const bundles = arrayValue(data.bundles, `${path}.data.bundles`).map(
    (entry, index): ScientificBundleMetric => {
      const metric = recordValue(entry, `${path}.data.bundles[${index}]`)
      return {
        brotliJavaScriptBytes: numberValue(
          metric.brotliJavaScriptBytes,
          `${path}.bundles[${index}].brotliJavaScriptBytes`,
        ),
        engineId: stringValue(metric.engineId, `${path}.bundles[${index}].engineId`),
        gzipJavaScriptBytes: numberValue(
          metric.gzipJavaScriptBytes,
          `${path}.bundles[${index}].gzipJavaScriptBytes`,
        ),
        installedBytes: numberValue(
          metric.installedBytes,
          `${path}.bundles[${index}].installedBytes`,
        ),
        rawWasmBytes: numberValue(metric.rawWasmBytes, `${path}.bundles[${index}].rawWasmBytes`),
      }
    },
  )
  return {
    bundles,
    createdAt: stringValue(data.createdAt, `${path}.data.createdAt`),
    engines,
    environment: {
      architecture: stringValue(environment.architecture, `${path}.environment.architecture`),
      node: stringValue(environment.node, `${path}.environment.node`),
      platform: stringValue(environment.platform, `${path}.environment.platform`),
    },
    results,
  }
}

const escapeXml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')

const formatBytes = (bytes: number): string => {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MiB`
  return `${(bytes / 1024).toFixed(1)} KiB`
}

const familyLabel = (family: string): string =>
  ({
    'array-interchange': 'Raw numeric interchange',
    'hdf5-emd': 'Electron microscopy',
    'medical-volumetric': 'Medical and volume interchange',
    'tiff-whole-slide': 'Common raster and whole-slide',
  })[family] ?? family

const engineColors = ['#2563eb', '#c026d3', '#ea580c', '#059669', '#7c3aed', '#0891b2']

const metricChart = (options: {
  readonly date: string
  readonly environment: string
  readonly filename: string
  readonly footer: string
  readonly metric: 'bytes' | 'milliseconds' | 'rss'
  readonly rows: readonly ScientificCompetitorResult[]
  readonly subtitle: string
  readonly title: string
  readonly unsupported: number
  readonly value: (row: ScientificCompetitorResult) => number
  readonly variation: (row: ScientificCompetitorResult) => number | null
}): GeneratedChart => {
  const grouped = [...new Set(options.rows.map(({ workloadId }) => workloadId))].map(
    (workloadId) => ({
      rows: options.rows.filter((row) => row.workloadId === workloadId),
      workloadId,
    }),
  )
  const width = 1900
  const plotLeft = 690
  const plotWidth = 1040
  const rowHeight = 34
  const groupGap = 56
  const plotTop = 230
  const rowCount = options.rows.length
  const height = plotTop + rowCount * rowHeight + grouped.length * groupGap + 170
  const values = options.rows.map(options.value).filter((value) => value > 0)
  const maximum = Math.max(...values, 1)
  const minimum = Math.min(...values, maximum)
  const logarithmic = options.metric === 'milliseconds' || options.metric === 'bytes'
  const xFor = (value: number): number => {
    if (!logarithmic) return plotLeft + (value / maximum) * plotWidth
    const minLog = Math.log10(Math.max(minimum / 2, 0.001))
    const maxLog = Math.log10(maximum * 1.2)
    return (
      plotLeft + ((Math.log10(Math.max(value, 0.001)) - minLog) / (maxLog - minLog)) * plotWidth
    )
  }
  let cursor = plotTop
  const groups = grouped
    .map((group) => {
      const first = group.rows[0]
      if (first === undefined) return ''
      const heading = `<text x="40" y="${cursor}" class="group">${escapeXml(familyLabel(first.family))} · ${escapeXml(first.title)}</text>`
      cursor += 24
      const rows = group.rows
        .map((row, rowIndex) => {
          const value = options.value(row)
          const x = xFor(value)
          const y = cursor + rowIndex * rowHeight
          const color = engineColors[rowIndex % engineColors.length]
          const valueLabel =
            options.metric === 'milliseconds'
              ? `${value.toFixed(value < 10 ? 2 : 1)} ms`
              : options.metric === 'rss'
                ? `${(value / 1024 / 1024).toFixed(1)} MiB`
                : formatBytes(value)
          const copy =
            row.inputCopyBytes > 0 ? ` · input copy ${formatBytes(row.inputCopyBytes)}` : ''
          const requests = options.metric === 'bytes' ? ` · ${row.requestCount} requests` : ''
          const variation = options.variation(row)
          const noisy =
            variation !== null && variation >= 10 ? ` · noisy CV ${variation.toFixed(1)}%` : ''
          return `<text x="660" y="${y + 21}" text-anchor="end" class="engine">${escapeXml(`${row.engineId} ${row.packageVersion} · ${row.implementationClass}`)}</text>
            <rect x="${plotLeft}" y="${y + 5}" width="${Math.max(x - plotLeft, 3)}" height="20" rx="4" fill="${color}" />
            <text x="${Math.min(x + 12, 1760)}" y="${y + 21}" class="value">${escapeXml(`${valueLabel}${requests}${copy}${noisy}`)}</text>`
        })
        .join('\n')
      cursor += group.rows.length * rowHeight + groupGap
      return `${heading}\n${rows}`
    })
    .join('\n')
  const scale = logarithmic ? 'logarithmic scale' : 'linear scale'
  const content = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <title>${escapeXml(options.title)}</title>
    <rect width="${width}" height="${height}" fill="#f8fafc" />
    <style>
      text { font-family: Inter, Arial, sans-serif; fill: #172033; }
      .title { font-size: 46px; font-weight: 750; }
      .subtitle { font-size: 24px; fill: #526077; }
      .source { font-size: 18px; fill: #64748b; }
      .group { font-size: 22px; font-weight: 750; }
      .engine { font-size: 18px; fill: #40506a; }
      .value { font-size: 17px; font-weight: 650; fill: #273449; }
      .footer { font-size: 18px; fill: #526077; }
    </style>
    <text x="40" y="64" class="title">${escapeXml(options.title)}</text>
    <text x="40" y="105" class="subtitle">${escapeXml(`${options.subtitle} · ${scale}`)}</text>
    <text x="40" y="143" class="source">Scientific JS/WASM competitor profile · ${escapeXml(options.date)} · ${escapeXml(options.environment)}</text>
    <text x="40" y="177" class="source">Engine class is recorded per engine; unsupported rows: ${options.unsupported}. Only shared workloads with validated output are charted.</text>
    ${groups}
    <text x="40" y="${height - 72}" class="footer">${escapeXml(options.footer)}</text>
    <text x="40" y="${height - 38}" class="source">Input-copy bytes are shown when material; measured rows at or above 10% coefficient of variation are labeled noisy.</text>
  </svg>\n`
  return { content, filename: options.filename, title: options.title }
}

const footprintChart = (options: {
  readonly bundles: readonly ScientificBundleMetric[]
  readonly date: string
  readonly engines: readonly ScientificCompetitorEngine[]
  readonly environment: string
  readonly unsupported: number
}): GeneratedChart => {
  const width = 1900
  const height = 330 + options.bundles.length * 54
  const plotLeft = 600
  const plotWidth = 1090
  const totals = options.bundles.map(({ gzipJavaScriptBytes, rawWasmBytes }) =>
    Math.max(gzipJavaScriptBytes + rawWasmBytes, 1),
  )
  const maxLog = Math.log10(Math.max(...totals) * 1.2)
  const minLog = Math.log10(Math.min(...totals) / 2)
  const xFor = (value: number): number =>
    plotLeft + ((Math.log10(Math.max(value, 1)) - minLog) / (maxLog - minLog)) * plotWidth
  const rows = options.bundles
    .map((bundle, index) => {
      const engine = options.engines.find(({ id }) => id === bundle.engineId)
      if (engine === undefined) throw new Error(`Missing engine metadata for ${bundle.engineId}`)
      const total = bundle.gzipJavaScriptBytes + bundle.rawWasmBytes
      const x = xFor(total)
      const y = 215 + index * 54
      return `<text x="570" y="${y + 22}" text-anchor="end" class="engine">${escapeXml(`${engine.id} ${engine.packageVersion} · ${engine.implementationClass}`)}</text>
        <rect x="${plotLeft}" y="${y + 5}" width="${Math.max(x - plotLeft, 3)}" height="24" rx="4" fill="${engineColors[index % engineColors.length]}" />
        <text x="${Math.min(x + 12, 1740)}" y="${y + 23}" class="value">${escapeXml(`${formatBytes(bundle.gzipJavaScriptBytes)} gzip JS + ${formatBytes(bundle.rawWasmBytes)} external WASM · installed ${formatBytes(bundle.installedBytes)}`)}</text>`
    })
    .join('\n')
  const content = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <title>Scientific package and WASM footprint</title>
    <rect width="${width}" height="${height}" fill="#f8fafc" />
    <style>
      text { font-family: Inter, Arial, sans-serif; fill: #172033; }
      .title { font-size: 46px; font-weight: 750; }
      .subtitle { font-size: 24px; fill: #526077; }
      .source { font-size: 18px; fill: #64748b; }
      .engine { font-size: 17px; fill: #40506a; }
      .value { font-size: 16px; font-weight: 650; fill: #273449; }
    </style>
    <text x="40" y="64" class="title">Scientific package and WASM footprint</text>
    <text x="40" y="105" class="subtitle">gzip JavaScript plus raw external WASM · logarithmic scale · smaller is better</text>
    <text x="40" y="143" class="source">${escapeXml(`${options.date} · ${options.environment} · ${options.unsupported} unsupported workload rows`)}</text>
    <text x="40" y="177" class="source">Embedded WASM remains counted in JavaScript. Installed footprint is labeled separately and is not the bar length.</text>
    ${rows}
  </svg>\n`
  return {
    content,
    filename: 'scientific-package-wasm-footprint.svg',
    title: 'Scientific package and WASM footprint',
  }
}

const replaceRegion = (source: string, id: string, content: string): string => {
  const start = `<!-- documentation:${id}:start -->`
  const end = `<!-- documentation:${id}:end -->`
  const startIndex = source.indexOf(start)
  const endIndex = source.indexOf(end)
  if (startIndex < 0 || endIndex < 0 || endIndex < startIndex) {
    throw new Error(`README is missing documentation region ${id}`)
  }
  return `${source.slice(0, startIndex + start.length)}\n<!-- Generated by scripts/render-documentation.ts. Do not edit this block. -->\n${content.trimEnd()}\n${source.slice(endIndex)}`
}

const resultIndex = await latestResultIndex()
const ordinaryEntry = latestEntry(resultIndex, 'web-codecs')
const scientificEntry = latestEntry(resultIndex, 'scientific-readers-baseline')
const scientificScalingEntry = latestEntry(resultIndex, 'scientific-readers-scaling')
const rangeEntry = latestEntry(resultIndex, 'scientific-readers-range')
const scientificCompetitorEntry = latestEntry(resultIndex, 'scientific-competitors-baseline')
for (const entry of [ordinaryEntry, scientificEntry, scientificScalingEntry]) {
  if (entry.validationStatus !== 'passed' || !entry.eligibleForDocumentationHeadlines) {
    throw new Error(`${entry.profile} is not eligible for a documentation headline`)
  }
}
const ordinaryPath = jsonResultPath(ordinaryEntry)
const scientificPath = jsonResultPath(scientificEntry)
const scientificScalingPath = jsonResultPath(scientificScalingEntry)
const rangePath = jsonResultPath(rangeEntry)
const scientificCompetitorPath = jsonResultPath(scientificCompetitorEntry)
for (const path of [
  ordinaryPath,
  scientificPath,
  scientificScalingPath,
  rangePath,
  scientificCompetitorPath,
]) {
  if (!(await pathExists(path))) throw new Error(`Result index references missing result: ${path}`)
}

const [
  manifest,
  packageMetricsValue,
  ordinaryValue,
  scientificValue,
  scientificScalingValue,
  rangeValue,
  competitorValue,
] = await Promise.all([
  readCapabilityManifest(),
  readJson(join(repositoryDirectory, 'benchmark/generated/package-metrics.json')),
  readJson(ordinaryPath),
  readJson(scientificPath),
  readJson(scientificScalingPath),
  readJson(rangePath),
  readJson(scientificCompetitorPath),
])
const packageMetrics = parsePackageMetrics(packageMetricsValue)
const ordinary = parseOrdinaryReport(ordinaryValue, ordinaryPath)
const scientific = parseScientificReport(scientificValue, scientificPath)
const scientificScaling = parseScientificScalingReport(
  scientificScalingValue,
  scientificScalingPath,
)
const rangeResults = parseScientificRangeReport(rangeValue, rangePath)
const scientificCompetitors = parseScientificCompetitorReport(
  competitorValue,
  scientificCompetitorPath,
)

const stableCodecs = manifest.codecs.filter(
  ({ experimental, packageFormat }) => packageFormat !== undefined && !experimental,
)
const experimentalCodecs = manifest.codecs.filter(
  ({ experimental, packageFormat }) => packageFormat !== undefined && experimental,
)
const target = (id: string) => {
  const metric = packageMetrics.targets.find((candidate) => candidate.id === id)
  if (metric === undefined) throw new Error(`Package metrics omit ${id}`)
  return metric
}
const coreSize = target('core')
const allCodecSize = target('codecs-all')
const webCodecSize = target('codecs-web')
const scientificSize = target('scientific')
const allReaderSize = target('scientific-readers-all')
const installedSize = target('purejsimage-all')

const northstar = (engine: string): OrdinaryResult => {
  const result = ordinary.results.find(
    (candidate) => candidate.engine === engine && candidate.workflow === 'northstar-photo-pipeline',
  )
  if (result === undefined || result.status !== 'pass' || result.peakRssBytes === null) {
    throw new Error(`Validated northstar result is missing for ${engine}`)
  }
  return result
}
const northstarPure = northstar('purejsimage')
const northstarJimp = northstar('jimp')
const memoryReduction =
  ((northstarJimp.peakRssBytes ?? 0) - (northstarPure.peakRssBytes ?? 0)) /
  (northstarJimp.peakRssBytes ?? 1)
const ordinaryCounts = ordinary.results.reduce<Record<string, number>>((counts, result) => {
  counts[result.status] = (counts[result.status] ?? 0) + 1
  return counts
}, {})

const svgDimensions = (source: string, markup: string): { width: number; height: number } => {
  const viewBox = /viewBox="0 0 ([0-9]+) ([0-9]+)"/u.exec(markup)
  const width = Number(viewBox?.[1] ?? /(?:\s|^)width="([0-9]+)"/u.exec(markup)?.[1])
  const height = Number(viewBox?.[2] ?? /(?:\s|^)height="([0-9]+)"/u.exec(markup)?.[1])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error(`Chart ${source} is missing SVG dimensions`)
  }
  return { width, height }
}

const ordinaryCharts = await Promise.all(
  ['speed', 'quality', 'memory'].map(async (metric) => {
    const source = join(
      repositoryDirectory,
      stringValue(ordinary.charts[metric], `ordinary.charts.${metric}`),
    )
    if (!(await pathExists(source))) throw new Error(`Chart references missing result: ${source}`)
    const filename = basename(source)
    const dimensions = filename.endsWith('.svg')
      ? svgDimensions(source, await readFile(source, 'utf8'))
      : { width: 2400, height: 1510 }
    return { filename, metric, source, ...dimensions }
  }),
)

const sharedWorkloadCandidates = [
  'tiff-window',
  'nifti-full',
  'nrrd-full',
  'mrc-full',
  'npy-c-full',
]
const eligibleScientificRows = scientificCompetitors.results.filter(
  ({ eligibleForCharts, workloadId }) =>
    eligibleForCharts && sharedWorkloadCandidates.includes(workloadId),
)
const sharedWorkloadIds = sharedWorkloadCandidates.filter((workloadId) => {
  const workloadRows = eligibleScientificRows.filter((row) => row.workloadId === workloadId)
  return workloadRows.length >= 2 && workloadRows.some(({ engineId }) => engineId === 'purejsimage')
})
if (sharedWorkloadIds.length === 0) {
  throw new Error('Scientific charts have no stable shared workload with a PureJsImage row')
}
const chartRows = eligibleScientificRows.filter(({ workloadId }) =>
  sharedWorkloadIds.includes(workloadId),
)
const competitorCounts = scientificCompetitors.results.reduce<Record<string, number>>(
  (counts, result) => {
    counts[result.status] = (counts[result.status] ?? 0) + 1
    return counts
  },
  {},
)
if ((competitorCounts['invalid-output'] ?? 0) > 0 || (competitorCounts.error ?? 0) > 0) {
  throw new Error('Scientific charts cannot use a competitor report with failed output')
}
const scientificEnvironment = `${scientificCompetitors.environment.platform} ${scientificCompetitors.environment.architecture} · Node ${scientificCompetitors.environment.node}`
const scientificDate = scientificCompetitors.createdAt.slice(0, 10)
const unsupported = competitorCounts.unsupported ?? 0
const scientificCharts: readonly GeneratedChart[] = [
  metricChart({
    date: scientificDate,
    environment: scientificEnvironment,
    filename: 'scientific-first-block-latency.svg',
    footer:
      'First usable data is measured after open and initialization for the selected workload.',
    metric: 'milliseconds',
    rows: chartRows,
    subtitle: 'Time to first usable block · lower is better',
    title: 'Scientific first-block latency',
    unsupported,
    value: ({ firstUsableDataMilliseconds }) => firstUsableDataMilliseconds,
    variation: ({ firstUsableDataCvPercent }) => firstUsableDataCvPercent,
  }),
  metricChart({
    date: scientificDate,
    environment: scientificEnvironment,
    filename: 'scientific-selected-operation.svg',
    footer:
      'Selected-operation wall time includes the public open/read path but excludes validation.',
    metric: 'milliseconds',
    rows: chartRows,
    subtitle: 'Complete selected-operation wall time · lower is better',
    title: 'Scientific selected-operation time',
    unsupported,
    value: ({ totalWallMilliseconds }) => totalWallMilliseconds,
    variation: ({ totalWallCvPercent }) => totalWallCvPercent,
  }),
  metricChart({
    date: scientificDate,
    environment: scientificEnvironment,
    filename: 'scientific-absolute-peak-rss.svg',
    footer:
      'Absolute process RSS includes the runtime, JavaScript heap, native allocations, and WASM memory.',
    metric: 'rss',
    rows: chartRows,
    subtitle: 'Absolute process peak RSS · lower is better',
    title: 'Scientific absolute peak RSS',
    unsupported,
    value: ({ peakRssBytes }) => peakRssBytes,
    variation: ({ peakRssCvPercent }) => peakRssCvPercent,
  }),
  metricChart({
    date: scientificDate,
    environment: scientificEnvironment,
    filename: 'scientific-source-io.svg',
    footer:
      'Bars show returned source bytes; labels include source request count and required input copies.',
    metric: 'bytes',
    rows: chartRows,
    subtitle: 'Source bytes and request count · lower is better for equivalent selections',
    title: 'Scientific source I/O',
    unsupported,
    value: ({ sourceBytes }) => sourceBytes,
    variation: ({ sourceBytesCvPercent }) => sourceBytesCvPercent,
  }),
  footprintChart({
    bundles: scientificCompetitors.bundles,
    date: scientificDate,
    engines: scientificCompetitors.engines,
    environment: scientificEnvironment,
    unsupported,
  }),
]

const readerFamilyIds: Readonly<Record<string, readonly string[]>> = {
  'common-raster-whole-slide': [
    'purejsimage/png',
    'purejsimage/jpeg',
    'purejsimage/webp',
    'purejsimage/bmp',
    'purejsimage/jp2',
    'purejsimage/tiff',
    'purejsimage/ome-tiff',
    'purejsimage/aperio-svs',
  ],
  'electron-microscopy': [
    'purejsimage/digital-micrograph',
    'purejsimage/tia-ser',
    'purejsimage/tia-emi',
    'purejsimage/ncem-emd',
    'purejsimage/velox-emd',
    'purejsimage/blockfile',
    'purejsimage/mib',
  ],
  'afm-spm-surface-metrology': [
    'purejsimage/gsf',
    'purejsimage/nanonis-sxm',
    'purejsimage/igor-binary-wave',
    'purejsimage/digital-surf',
    'purejsimage/x3p',
  ],
  'medical-volume-interchange': [
    'purejsimage/mrc',
    'purejsimage/nrrd',
    'purejsimage/meta-image',
    'purejsimage/nifti',
  ],
  'spectroscopy-detector-interchange': [
    'purejsimage/envi',
    'purejsimage/fits',
    'purejsimage/cbf',
    'purejsimage/rpl',
    'purejsimage/emsa',
    'purejsimage/ebsd-text',
  ],
  'raw-numeric-interchange': ['purejsimage/npy'],
}
const readerFamilyLabels: Readonly<Record<string, string>> = {
  'common-raster-whole-slide': 'Common raster and whole-slide',
  'electron-microscopy': 'Electron microscopy',
  'afm-spm-surface-metrology': 'AFM, SPM, and surface metrology',
  'medical-volume-interchange': 'Medical and volume interchange',
  'spectroscopy-detector-interchange': 'Spectroscopy and detector interchange',
  'raw-numeric-interchange': 'Raw numeric interchange',
}
const assignedReaders = Object.values(readerFamilyIds).flat()
const manifestReaderIds = manifest.scientificReaders.map(({ id }) => id)
const missingReaderGroups = manifestReaderIds.filter((id) => !assignedReaders.includes(id))
const unknownReaderGroups = assignedReaders.filter((id) => !manifestReaderIds.includes(id))
if (missingReaderGroups.length > 0 || unknownReaderGroups.length > 0) {
  throw new Error(
    `Scientific family mapping is stale. Missing: ${missingReaderGroups.join(', ') || 'none'}; unknown: ${unknownReaderGroups.join(', ') || 'none'}`,
  )
}

const baselineByReader = new Map<string, ScientificBaselineResult[]>()
for (const result of scientific.results) {
  const values = baselineByReader.get(result.readerId) ?? []
  values.push(result)
  baselineByReader.set(result.readerId, values)
}
const rangeByReader = new Map<string, { readonly failed: number; readonly supported: number }>()
for (const result of rangeResults) {
  const counts = rangeByReader.get(result.readerId) ?? { failed: 0, supported: 0 }
  rangeByReader.set(
    result.readerId,
    result.status === 'supported'
      ? { ...counts, supported: counts.supported + 1 }
      : { ...counts, failed: counts.failed + 1 },
  )
}
const ordinaryAdapterIds = new Set([
  'purejsimage/png',
  'purejsimage/jpeg',
  'purejsimage/webp',
  'purejsimage/bmp',
  'purejsimage/jp2',
])
const scientificFormats = manifest.scientificReaders.map((reader) => {
  const baseline = baselineByReader.get(reader.id) ?? []
  const range = rangeByReader.get(reader.id) ?? { failed: 0, supported: 0 }
  const sampleTypes = [...new Set(baseline.map(({ outputSampleType }) => outputSampleType))].sort()
  const oracles = [...new Set(baseline.map(({ oracle }) => oracle))]
  const family = Object.entries(readerFamilyIds).find(([, ids]) => ids.includes(reader.id))?.[0]
  if (family === undefined) throw new Error(`Scientific reader ${reader.id} has no family`)
  return {
    benchmarkCoverage: {
      baselineFailed: baseline.filter(({ status }) => status !== 'supported').length,
      baselineSupported: baseline.filter(({ status }) => status === 'supported').length,
      rangeFailed: range.failed,
      rangeSupported: range.supported,
    },
    datasetKinds: reader.datasetKinds,
    directRangeReads: reader.directRangeReads,
    extensions: reader.extensions,
    family,
    format: reader.format,
    id: reader.id,
    nativePrecision: ordinaryAdapterIds.has(reader.id)
      ? `Canonical uint8 adapter${sampleTypes.length > 0 ? ` (${sampleTypes.join(', ')})` : ''}`
      : `Native numeric samples${sampleTypes.length > 0 ? ` (${sampleTypes.join(', ')})` : ''}`,
    oracle: oracles.join(' '),
    packageExport: reader.packageExport,
    resourceModel: reader.resourceModel,
    supportBoundary: reader.boundary,
  }
})

const scientificCounts = scientific.results.reduce<Record<string, number>>((counts, result) => {
  counts[result.status] = (counts[result.status] ?? 0) + 1
  return counts
}, {})
const rangeCounts = rangeResults.reduce<Record<string, number>>((counts, result) => {
  counts[result.status] = (counts[result.status] ?? 0) + 1
  return counts
}, {})
const representativeScientificCount = scientific.results.filter(
  ({ measurementClass }) => measurementClass === 'representative',
).length
const contractScientificCount = scientific.results.length - representativeScientificCount
const crossEnvironmentDisclaimer =
  ordinary.environment.fingerprint === scientific.environment.fingerprint
    ? null
    : 'Ordinary and scientific reports use separately fingerprinted harnesses. No cross-section speed or memory ratio is claimed.'

const documentation = {
  schemaVersion: 1,
  generatedFrom: {
    packageMetrics: 'benchmark/generated/package-metrics.json',
    resultIndex: portablePath(resultIndex.path),
  },
  support: {
    experimentalCodecs: experimentalCodecs.map(({ name }) => name),
    scientificReaderCount: manifest.scientificReaders.length,
    scientificReaderFamilies: Object.entries(readerFamilyIds).map(([id, readerIds]) => ({
      id,
      label: readerFamilyLabels[id],
      readerIds,
    })),
    stableCodecCount: stableCodecs.length,
    stableCodecNames: stableCodecs.map(({ name }) => name),
  },
  sizes: {
    allReaders: {
      brotliBytes: allReaderSize.brotliBytes,
      gzipBytes: allReaderSize.gzipBytes,
      minifiedBytes: allReaderSize.minifiedJsBytes,
    },
    allStableCodecs: {
      brotliBytes: allCodecSize.brotliBytes,
      gzipBytes: allCodecSize.gzipBytes,
      minifiedBytes: allCodecSize.minifiedJsBytes,
    },
    commonWebCodecs: {
      brotliBytes: webCodecSize.brotliBytes,
      gzipBytes: webCodecSize.gzipBytes,
      minifiedBytes: webCodecSize.minifiedJsBytes,
    },
    core: {
      brotliBytes: coreSize.brotliBytes,
      gzipBytes: coreSize.gzipBytes,
      minifiedBytes: coreSize.minifiedJsBytes,
    },
    installedPackage: {
      bytes: installedSize.unpackedPackageBytes,
      productionPackageCount: installedSize.productionPackageCount,
    },
    packageVersion: packageMetrics.package.version,
    scientificPlatform: {
      brotliBytes: scientificSize.brotliBytes,
      gzipBytes: scientificSize.gzipBytes,
      minifiedBytes: scientificSize.minifiedJsBytes,
    },
  },
  ordinary: {
    charts: Object.fromEntries(
      ordinaryCharts.map(({ filename, height, metric, width }) => [
        metric,
        { height, src: `assets/${filename}`, width },
      ]),
    ),
    createdAt: ordinary.createdAt,
    engineVersions: ordinary.startup,
    environment: ordinary.environment,
    fixtureManifestHash: ordinary.fixtureManifestHash,
    headline: {
      jimpPeakRssBytes: northstarJimp.peakRssBytes,
      memoryReductionPercent: memoryReduction * 100,
      pureJsImagePeakRssBytes: northstarPure.peakRssBytes,
      workflow: '24-megapixel northstar photo pipeline',
    },
    reportJson: portablePath(ordinaryPath),
    reportMarkdown: ordinaryEntry.resultPaths.find((path) => path.endsWith('.md')) ?? null,
    statusCounts: ordinaryCounts,
  },
  scientific: {
    baseline: {
      createdAt: scientific.createdAt,
      engine: scientific.engine,
      environment: scientific.environment,
      reportJson: portablePath(scientificPath),
      reportMarkdown: scientificEntry.resultPaths.find((path) => path.endsWith('.md')) ?? null,
      statusCounts: scientificCounts,
      contractWorkloadCount: contractScientificCount,
      representativeWorkloadCount: representativeScientificCount,
      workloadCount: scientific.results.length,
    },
    charts: Object.fromEntries(
      scientificCharts.map(({ filename, title }) => [title, `assets/${filename}`]),
    ),
    competitors: {
      createdAt: scientificCompetitors.createdAt,
      engineVersions: scientificCompetitors.engines,
      environment: scientificCompetitors.environment,
      noisyRows: scientificCompetitors.results
        .filter(
          ({ representative, status, workloadId }) =>
            representative &&
            status === 'supported' &&
            sharedWorkloadCandidates.includes(workloadId),
        )
        .flatMap((row) =>
          [
            ['first usable data', row.firstUsableDataCvPercent],
            ['selected operation', row.totalWallCvPercent],
            ['absolute peak RSS', row.peakRssCvPercent],
            ['source bytes', row.sourceBytesCvPercent],
          ].flatMap(([metric, variation]) =>
            typeof variation === 'number' && variation >= 10
              ? [
                  {
                    cvPercent: variation,
                    engineId: row.engineId,
                    metric,
                    workloadId: row.workloadId,
                  },
                ]
              : [],
          ),
        ),
      reportJson: portablePath(scientificCompetitorPath),
      reportMarkdown:
        scientificCompetitorEntry.resultPaths.find((path) => path.endsWith('.md')) ?? null,
      statusCounts: competitorCounts,
    },
    crossEnvironmentDisclaimer,
    range: {
      reportJson: portablePath(rangePath),
      reportMarkdown: rangeEntry.resultPaths.find((path) => path.endsWith('.md')) ?? null,
      statusCounts: rangeCounts,
    },
    scaling: {
      chartEligibleWorkloadCount: scientificScaling.results.filter(
        ({ eligibleForCharts }) => eligibleForCharts,
      ).length,
      createdAt: scientificScaling.createdAt,
      reportJson: portablePath(scientificScalingPath),
      reportMarkdown:
        scientificScalingEntry.resultPaths.find((path) => path.endsWith('.md')) ?? null,
      workloadCount: scientificScaling.results.length,
    },
  },
  scientificFormats,
}

const summaryBlock = [
  '## Current package surface',
  '',
  `PureJsImage ${packageMetrics.package.version} is a zero-runtime-dependency strict TypeScript image-processing package for Node.js and modern browsers. The default path uses portable TypeScript implementations; optional JPEG and PNG WASM accelerators require explicit registration.`,
  '',
  `**${stableCodecs.length} stable ordinary codecs:** ${stableCodecs.map(({ name }) => name).join(', ')}.`,
  '',
  `**Experimental:** ${experimentalCodecs.map(({ name }) => name).join(', ')} remains a separate explicit import, is excluded from \`allCodecs\`, and carries the documented HEVC/H.265 patent notice.`,
  '',
  `**${manifest.scientificReaders.length} scientific readers:** ${Object.entries(readerFamilyIds)
    .map(([id, ids]) => `${readerFamilyLabels[id]} (${ids.length})`)
    .join(
      '; ',
    )}. Direct-range readers request selected source spans, and specialized scientific readers retain native numeric precision instead of forcing data through RGBA.`,
  '',
  '| Current measured surface | Minified JS | gzip | Brotli |',
  '| --- | ---: | ---: | ---: |',
  `| Core API | ${formatKibibytes(coreSize.minifiedJsBytes)} | ${formatKibibytes(coreSize.gzipBytes)} | ${formatKibibytes(coreSize.brotliBytes)} |`,
  `| Common web codecs | ${formatKibibytes(webCodecSize.minifiedJsBytes)} | ${formatKibibytes(webCodecSize.gzipBytes)} | ${formatKibibytes(webCodecSize.brotliBytes)} |`,
  `| All stable codecs | ${formatKibibytes(allCodecSize.minifiedJsBytes)} | ${formatKibibytes(allCodecSize.gzipBytes)} | ${formatKibibytes(allCodecSize.brotliBytes)} |`,
  `| Scientific platform | ${formatKibibytes(scientificSize.minifiedJsBytes)} | ${formatKibibytes(scientificSize.gzipBytes)} | ${formatKibibytes(scientificSize.brotliBytes)} |`,
  `| All scientific readers | ${formatKibibytes(allReaderSize.minifiedJsBytes)} | ${formatKibibytes(allReaderSize.gzipBytes)} | ${formatKibibytes(allReaderSize.brotliBytes)} |`,
  '',
  `The extracted npm package is ${formatMebibytes(installedSize.unpackedPackageBytes)} with ${installedSize.productionPackageCount} production package. This is unpacked size, not the compressed npm tarball.`,
].join('\n')

const benchmarkBlock = [
  '## Current benchmark snapshots',
  '',
  `**Web codec benchmarks (${ordinary.createdAt.slice(0, 10)}):** ${ordinaryCounts.pass ?? 0} validated passes, ${ordinaryCounts.unsupported ?? 0} explicit unsupported rows, and no invalid outputs or errors across JPEG, PNG, WebP, TIFF, and AVIF workflows. On the ${documentation.ordinary.headline.workflow}, the TypeScript path used ${(memoryReduction * 100).toFixed(1)}% less absolute peak RSS than Jimp (${formatMebibytes(northstarPure.peakRssBytes ?? 0)} versus ${formatMebibytes(northstarJimp.peakRssBytes ?? 0)}).`,
  '',
  `**Scientific readers (${scientificScaling.createdAt.slice(0, 10)}):** ${scientificCounts.supported ?? 0} correctness and startup workflows passed across ${manifest.scientificReaders.length} readers. The separate medium/large scaling profile validated ${scientificScaling.results.length} representative workloads; ${scientificScaling.results.filter(({ eligibleForCharts }) => eligibleForCharts).length} met the under-10% CV publication threshold and the remaining rows stay visible as noisy. Results report first usable block, selected-operation time, absolute peak RSS, source requests and bytes, overfetch, import/initialization, and emitted-block correctness without collapsing formats into one winner score.`,
  '',
  crossEnvironmentDisclaimer === null ? '' : `> ${crossEnvironmentDisclaimer}`,
  '',
  '<p align="center">',
  '  <a href="https://purejsimage.com/performance/#web-codec-benchmarks">',
  '    <img src="docs-astro/public/assets/readme/web-codec-memory.svg" alt="Web codec benchmark peak RSS chart. Lower peak RSS is better. The chart includes validated shared JPEG, PNG, WebP, TIFF, and AVIF workloads. Sharp is native libvips and is not presented as pure JavaScript." width="100%">',
  '  </a>',
  '</p>',
  '<p align="center"><em>Absolute process peak RSS from the current validated web codec benchmark snapshot.</em></p>',
  '',
  `[Web codec benchmarks](https://purejsimage.com/performance/#web-codec-benchmarks) · [Scientific methodology and report](https://purejsimage.com/performance/#scientific-readers) · [Benchmark harness](benchmark/README.md) · [Generated result index](${portablePath(resultIndex.path)})`,
]
  .filter((line, index, lines) => line.length > 0 || lines[index - 1]?.length !== 0)
  .join('\n')

const readmePath = join(repositoryDirectory, 'README.md')
const currentReadme = await readFile(readmePath, 'utf8')
const expectedReadme = replaceRegion(
  replaceRegion(currentReadme, 'summary', summaryBlock),
  'benchmarks',
  benchmarkBlock,
)
const dataPath = join(repositoryDirectory, 'docs-astro', 'src', 'data', 'documentation-data.json')
const expectedData = `${JSON.stringify(documentation, null, 2)}\n`
const publicAssetsDirectory = join(repositoryDirectory, 'docs-astro', 'public', 'assets')
const readmeAssetsDirectory = join(publicAssetsDirectory, 'readme')
const memoryChart = ordinaryCharts.find((chart) => chart.metric === 'memory')
if (memoryChart === undefined) throw new Error('Validated web codec memory chart is missing')
const readmeAssets: readonly { readonly path: string; readonly bytes: Uint8Array }[] = [
  {
    path: join(readmeAssetsDirectory, 'whole-slide-viewer.jpg'),
    bytes: await encodeReadmeRaster(
      await readFile(join(publicAssetsDirectory, 'whole-slide-viewer-showcase.jpg')),
      { format: 'jpeg', quality: 78, width: 1400 },
    ),
  },
  {
    path: join(readmeAssetsDirectory, 'scientific-explorer.jpg'),
    bytes: await encodeReadmeRaster(
      await readFile(join(publicAssetsDirectory, 'scientific-hyperspectral-envi-viewer.png')),
      { format: 'jpeg', quality: 80, width: 1200 },
    ),
  },
  {
    path: join(readmeAssetsDirectory, 'web-codec-memory.svg'),
    bytes: await readFile(memoryChart.source),
  },
]
const readmeAssetBytes = readmeAssets.reduce((sum, asset) => sum + asset.bytes.byteLength, 0)
if (readmeAssetBytes > 1.2 * 1024 * 1024) {
  throw new Error(
    `README raster assets are ${readmeAssetBytes} bytes; keep the three visuals under 1.2 MiB`,
  )
}

const stale: string[] = []
const compareOrWrite = async (
  path: string,
  expected: string | Uint8Array,
  semanticJson = false,
): Promise<void> => {
  const current = await readFile(path).catch(() => undefined)
  const expectedBuffer =
    typeof expected === 'string' ? Buffer.from(expected) : Buffer.from(expected)
  let matches = current !== undefined && Buffer.compare(current, expectedBuffer) === 0
  if (!matches && semanticJson && current !== undefined) {
    try {
      const currentValue: unknown = JSON.parse(current.toString('utf8'))
      const expectedValue: unknown = JSON.parse(expectedBuffer.toString('utf8'))
      matches = JSON.stringify(currentValue) === JSON.stringify(expectedValue)
    } catch {
      matches = false
    }
  }
  if (checkOnly) {
    if (!matches) stale.push(portablePath(path))
  } else if (!matches) {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, expectedBuffer)
  }
}

await compareOrWrite(dataPath, expectedData, true)
await compareOrWrite(readmePath, expectedReadme)
for (const chart of ordinaryCharts) {
  await compareOrWrite(join(publicAssetsDirectory, chart.filename), await readFile(chart.source))
}
for (const chart of scientificCharts) {
  await compareOrWrite(join(publicAssetsDirectory, chart.filename), chart.content)
}
for (const asset of readmeAssets) {
  await compareOrWrite(asset.path, asset.bytes)
}

if (checkOnly && stale.length > 0) {
  throw new Error(`Generated documentation is stale:\n${stale.join('\n')}`)
}
if (!checkOnly) {
  console.log(`Wrote ${portablePath(dataPath)}`)
  console.log(`Updated ${portablePath(readmePath)}`)
  for (const chart of [...ordinaryCharts, ...scientificCharts]) {
    console.log(`Wrote docs-astro/public/assets/${chart.filename}`)
  }
  for (const asset of readmeAssets) {
    console.log(`Wrote ${portablePath(asset.path)}`)
  }
}
