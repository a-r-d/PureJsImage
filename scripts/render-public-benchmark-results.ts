import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { basename, join, relative } from 'node:path'

type ValidationStatus = 'failed' | 'partial' | 'passed' | 'unverified'

interface SourceEntry {
  readonly commit: string
  readonly date: string
  readonly eligibleForDocumentationHeadlines: boolean
  readonly engineVersions: Readonly<Record<string, string>>
  readonly environmentFingerprint: string
  readonly fixtureManifestHash: string
  readonly profile: string
  readonly resultPaths: readonly string[]
  readonly validationStatus: ValidationStatus
}

const repositoryDirectory = process.cwd()
const publicDirectory = join(repositoryDirectory, 'benchmark', 'results', 'public')
const checkOnly = process.argv.includes('--check')
const writeMode = process.argv.includes('--write')
if (checkOnly === writeMode) throw new Error('Use exactly one of --write or --check')

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const record = (value: unknown, label: string): Readonly<Record<string, unknown>> => {
  if (!isRecord(value)) throw new Error(`${label} must be an object`)
  return value
}

const array = (value: unknown, label: string): readonly unknown[] => {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  return value
}

const string = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} must be a string`)
  return value
}

const number = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error(`${label} must be a number`)
  return value
}

const optionalNumber = (value: unknown, label: string): number | null =>
  value === null || value === undefined ? null : number(value, label)

const boolean = (value: unknown, label: string): boolean => {
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean`)
  return value
}

const status = (value: unknown, label: string): ValidationStatus => {
  const parsed = string(value, label)
  if (
    parsed === 'failed' ||
    parsed === 'partial' ||
    parsed === 'passed' ||
    parsed === 'unverified'
  ) {
    return parsed
  }
  throw new Error(`${label} has invalid validation status ${parsed}`)
}

const readJson = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, 'utf8'))
const portable = (path: string): string => relative(repositoryDirectory, path).replaceAll('\\', '/')
const hash = (value: string | Uint8Array): string =>
  createHash('sha256').update(value).digest('hex')
const dateStem = (date: string): string => date.replaceAll(/[:.]/gu, '-').replace(/Z$/u, 'Z')
const exists = async (path: string): Promise<boolean> =>
  stat(path)
    .then(() => true)
    .catch(() => false)

const coefficientOfVariation = (values: readonly number[]): number | null => {
  if (values.length < 2) return null
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  if (mean === 0) return null
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length
  return (Math.sqrt(variance) / Math.abs(mean)) * 100
}

const latestSourceIndex = async (): Promise<{
  readonly generatedAt: string
  readonly path: string
  readonly results: readonly SourceEntry[]
}> => {
  const directory = join(repositoryDirectory, 'benchmark', 'results')
  const filename = (await readdir(directory))
    .filter((candidate) => /^result-index-.*\.json$/u.test(candidate))
    .sort()
    .at(-1)
  if (filename === undefined) throw new Error('No source benchmark result index exists')
  const path = join(directory, filename)
  const document = record(await readJson(path), path)
  const results = array(document.results, `${path}.results`).map((item, index): SourceEntry => {
    const value = record(item, `${path}.results[${index}]`)
    const versions = record(value.engineVersions, `${path}.results[${index}].engineVersions`)
    return {
      commit: string(value.commit, `${path}.results[${index}].commit`),
      date: string(value.date, `${path}.results[${index}].date`),
      eligibleForDocumentationHeadlines: boolean(
        value.eligibleForDocumentationHeadlines,
        `${path}.results[${index}].eligibleForDocumentationHeadlines`,
      ),
      engineVersions: Object.fromEntries(
        Object.entries(versions).map(([id, version]) => [id, string(version, `${path}.${id}`)]),
      ),
      environmentFingerprint: string(
        value.environmentFingerprint,
        `${path}.results[${index}].environmentFingerprint`,
      ),
      fixtureManifestHash: string(
        value.fixtureManifestHash,
        `${path}.results[${index}].fixtureManifestHash`,
      ),
      profile: string(value.profile, `${path}.results[${index}].profile`),
      resultPaths: array(value.resultPaths, `${path}.results[${index}].resultPaths`).map(
        (resultPath, pathIndex) =>
          string(resultPath, `${path}.results[${index}].resultPaths[${pathIndex}]`),
      ),
      validationStatus: status(
        value.validationStatus,
        `${path}.results[${index}].validationStatus`,
      ),
    }
  })
  return { generatedAt: string(document.generatedAt, `${path}.generatedAt`), path, results }
}

const latestEntry = (entries: readonly SourceEntry[], profile: string): SourceEntry => {
  const entry = entries
    .filter((candidate) => candidate.profile === profile)
    .sort((left, right) => right.date.localeCompare(left.date))[0]
  if (entry === undefined) throw new Error(`Source result index has no ${profile} profile`)
  return entry
}

const sourceJson = async (entry: SourceEntry): Promise<Readonly<Record<string, unknown>>> => {
  const path = entry.resultPaths.find((candidate) => candidate.endsWith('.json'))
  if (path === undefined) throw new Error(`${entry.profile} has no JSON result`)
  return record(await readJson(join(repositoryDirectory, path)), path)
}

const ordinarySnapshot = async (entry: SourceEntry) => {
  const report = await sourceJson(entry)
  const environment = record(report.environment, 'ordinary.environment')
  const results = array(report.results, 'ordinary.results').map((item, index) => {
    const result = record(item, `ordinary.results[${index}]`)
    const summary = record(result.summary, `ordinary.results[${index}].summary`)
    const wall = isRecord(summary.wallMilliseconds)
      ? optionalNumber(summary.wallMilliseconds.median, 'wall median')
      : null
    const rss = isRecord(summary.peakRssBytes)
      ? optionalNumber(summary.peakRssBytes.median, 'rss median')
      : null
    const qualityValue = summary.qualityPsnrDb
    const quality = qualityValue === 'exact' ? 'exact' : optionalNumber(qualityValue, 'quality')
    return {
      engine: string(result.engine, `ordinary.results[${index}].engine`),
      peakRssBytes: rss,
      quality,
      status: string(summary.status, `ordinary.results[${index}].status`),
      wallMilliseconds: wall,
      workflow: string(result.workflow, `ordinary.results[${index}].workflow`),
    }
  })
  const invalid = results.filter(
    (result) => result.status !== 'pass' && result.status !== 'unsupported',
  )
  if (invalid.length > 0) throw new Error(`Ordinary publication contains ${invalid[0]?.status}`)
  const engines = array(report.startup, 'ordinary.startup').map((item, index) => {
    const engine = record(
      record(item, `ordinary.startup[${index}]`).engine,
      `ordinary.startup[${index}].engine`,
    )
    return {
      id: string(engine.id, `ordinary.startup[${index}].engine.id`),
      kind: string(engine.kind, `ordinary.startup[${index}].engine.kind`),
      version: string(engine.version, `ordinary.startup[${index}].engine.version`),
    }
  })
  if (engines.length === 0) throw new Error('Ordinary publication omits engine versions')
  const sourcePath = entry.resultPaths.find((candidate) => candidate.endsWith('.json')) ?? ''
  const sourceStem = basename(sourcePath, '.json')
  const charts = Object.fromEntries(
    ['speed', 'quality', 'memory'].map((metric) => {
      const chartPrefix = entry.profile === 'web-codecs' ? 'web-codecs' : 'competitors'
      const path = `benchmark/results/${chartPrefix}-${metric}-${sourceStem}.png`
      return [metric, path]
    }),
  )
  for (const path of Object.values(charts)) {
    if (!(await exists(join(repositoryDirectory, path))))
      throw new Error(`Missing ordinary chart ${path}`)
  }
  return {
    charts,
    createdAt: string(report.createdAt, 'ordinary.createdAt'),
    engines,
    environment: {
      architecture: string(environment.architecture, 'ordinary.environment.architecture'),
      cpu: string(environment.cpu, 'ordinary.environment.cpu'),
      fingerprint: string(environment.environmentFingerprint, 'ordinary.environment.fingerprint'),
      node: string(environment.node, 'ordinary.environment.node'),
      os: `${string(environment.osName, 'ordinary.environment.osName')} ${string(environment.osRelease, 'ordinary.environment.osRelease')}`,
      runner: string(environment.runner, 'ordinary.environment.runner'),
      v8: string(environment.v8Version, 'ordinary.environment.v8Version'),
    },
    fixtureManifestHash: string(environment.fixtureManifestHash, 'ordinary.fixtureManifestHash'),
    results,
  }
}

const scientificSnapshot = async (entry: SourceEntry) => {
  const report = await sourceJson(entry)
  const configuration = record(report.configuration, 'scientific.configuration')
  const engine = record(configuration.engine, 'scientific.configuration.engine')
  const environment = record(report.environment, 'scientific.environment')
  const results = array(report.results, 'scientific.results').map((item, index) => {
    const result = record(item, `scientific.results[${index}]`)
    const identity = record(result.identity, `scientific.results[${index}].identity`)
    const reader = record(identity.reader, `scientific.results[${index}].identity.reader`)
    const fixture = record(result.fixture, `scientific.results[${index}].fixture`)
    const correctness = record(result.correctness, `scientific.results[${index}].correctness`)
    return {
      measurementClass: string(
        result.measurementClass,
        `scientific.results[${index}].measurementClass`,
      ),
      oracle: string(fixture.expectedOracle, `scientific.results[${index}].expectedOracle`),
      outputSampleType:
        correctness.outputSampleType === null
          ? 'metadata-only'
          : string(correctness.outputSampleType, `scientific.results[${index}].outputSampleType`),
      readerId: string(reader.id, `scientific.results[${index}].reader.id`),
      status: string(result.status, `scientific.results[${index}].status`),
      workloadId: string(identity.workloadId, `scientific.results[${index}].workloadId`),
    }
  })
  if (results.some((result) => result.status !== 'supported')) {
    throw new Error('Scientific baseline publication contains a failed output')
  }
  return {
    createdAt: string(report.createdAt, 'scientific.createdAt'),
    engine: {
      id: string(engine.id, 'scientific.engine.id'),
      version: string(engine.version, 'scientific.engine.version'),
    },
    environment: {
      architecture: string(environment.architecture, 'scientific.environment.architecture'),
      cpu: string(environment.cpuModel, 'scientific.environment.cpuModel'),
      fingerprint: hash(JSON.stringify(environment)),
      node: string(environment.nodeVersion, 'scientific.environment.nodeVersion'),
      os: `${string(environment.operatingSystem, 'scientific.environment.operatingSystem')} ${string(environment.operatingSystemVersion, 'scientific.environment.operatingSystemVersion')}`,
      v8: string(environment.v8Version, 'scientific.environment.v8Version'),
    },
    results,
  }
}

const scientificScalingSnapshot = async (entry: SourceEntry) => {
  const report = await sourceJson(entry)
  const configuration = record(report.configuration, 'scaling.configuration')
  const engine = record(configuration.engine, 'scaling.configuration.engine')
  const environment = record(report.environment, 'scaling.environment')
  const median = (summary: unknown, label: string): number | null => {
    if (summary === null) return null
    return number(record(summary, label).median, `${label}.median`)
  }
  const results = array(report.results, 'scaling.results').map((item, index) => {
    const result = record(item, `scaling.results[${index}]`)
    const identity = record(result.identity, `scaling.results[${index}].identity`)
    const reader = record(identity.reader, `scaling.results[${index}].identity.reader`)
    const timing = record(result.timing, `scaling.results[${index}].timing`)
    const memory = record(result.memory, `scaling.results[${index}].memory`)
    const source = record(result.source, `scaling.results[${index}].source`)
    const correctness = record(result.correctness, `scaling.results[${index}].correctness`)
    const stability = record(result.stability, `scaling.results[${index}].stability`)
    const statusValue = string(result.status, `scaling.results[${index}].status`)
    const sampleHash = string(
      correctness.selectedSampleSha256,
      `scaling.results[${index}].correctness.selectedSampleSha256`,
    )
    return {
      absolutePeakRssBytes: median(
        memory.absolutePeakRssBytes,
        `scaling.results[${index}].absolutePeakRssBytes`,
      ),
      eligibleForCharts: boolean(
        stability.eligibleForDocumentationHeadlines,
        `scaling.results[${index}].eligibleForCharts`,
      ),
      firstBlockCvPercent: optionalNumber(
        stability.firstBlockCvPercent,
        `scaling.results[${index}].firstBlockCvPercent`,
      ),
      firstBlockMilliseconds: median(
        timing.timeToFirstEmittedBlockMilliseconds,
        `scaling.results[${index}].firstBlockMilliseconds`,
      ),
      fixtureId: string(identity.fixtureId, `scaling.results[${index}].fixtureId`),
      operation: string(identity.operation, `scaling.results[${index}].operation`),
      overfetchRatio: median(source.overfetchRatio, `scaling.results[${index}].overfetchRatio`),
      peakRssCvPercent: optionalNumber(
        stability.absolutePeakRssCvPercent,
        `scaling.results[${index}].peakRssCvPercent`,
      ),
      readerId: string(reader.id, `scaling.results[${index}].reader.id`),
      readCalls: median(source.readCalls, `scaling.results[${index}].readCalls`),
      sampleHash,
      selectedOperationCvPercent: optionalNumber(
        stability.selectedOperationCvPercent,
        `scaling.results[${index}].selectedOperationCvPercent`,
      ),
      selectedOperationMilliseconds: median(
        timing.completeSelectedOperationMilliseconds,
        `scaling.results[${index}].selectedOperationMilliseconds`,
      ),
      sourceBytes: median(source.returnedBytes, `scaling.results[${index}].sourceBytes`),
      sourceBytesCvPercent: optionalNumber(
        stability.sourceBytesCvPercent,
        `scaling.results[${index}].sourceBytesCvPercent`,
      ),
      status: statusValue,
      workloadId: string(identity.workloadId, `scaling.results[${index}].workloadId`),
    }
  })
  if (
    results.some(
      ({ status: resultStatus, sampleHash }) =>
        resultStatus !== 'supported' || sampleHash.length !== 64,
    )
  ) {
    throw new Error('Scientific scaling publication contains failed validation')
  }
  return {
    createdAt: string(report.createdAt, 'scaling.createdAt'),
    engine: {
      id: string(engine.id, 'scaling.engine.id'),
      version: string(engine.version, 'scaling.engine.version'),
    },
    environment: {
      architecture: string(environment.architecture, 'scaling.environment.architecture'),
      cpu: string(environment.cpuModel, 'scaling.environment.cpuModel'),
      fingerprint: hash(JSON.stringify(environment)),
      node: string(environment.nodeVersion, 'scaling.environment.nodeVersion'),
      os: `${string(environment.operatingSystem, 'scaling.environment.operatingSystem')} ${string(environment.operatingSystemVersion, 'scaling.environment.operatingSystemVersion')}`,
      v8: string(environment.v8Version, 'scaling.environment.v8Version'),
    },
    results,
  }
}

const rangeSnapshot = async (entry: SourceEntry) => {
  const report = await sourceJson(entry)
  const configuration = record(report.configuration, 'range.configuration')
  const engine = record(configuration.engine, 'range.configuration.engine')
  return {
    createdAt: string(report.createdAt, 'range.createdAt'),
    engine: {
      id: string(engine.id, 'range.engine.id'),
      version: string(engine.version, 'range.engine.version'),
    },
    results: array(report.results, 'range.results').map((item, index) => {
      const result = record(item, `range.results[${index}]`)
      const identity = record(result.identity, `range.results[${index}].identity`)
      const reader = record(identity.reader, `range.results[${index}].identity.reader`)
      return {
        readerId: string(reader.id, `range.results[${index}].reader.id`),
        status: string(result.status, `range.results[${index}].status`),
      }
    }),
  }
}

const competitorSnapshot = async (entry: SourceEntry) => {
  const report = await sourceJson(entry)
  const environment = record(report.environment, 'competitors.environment')
  const engines = array(report.engines, 'competitors.engines').map((item, index) => {
    const engine = record(item, `competitors.engines[${index}]`)
    return {
      id: string(engine.id, `competitors.engines[${index}].id`),
      implementationClass: string(
        engine.implementationClass,
        `competitors.engines[${index}].implementationClass`,
      ),
      packageVersion: string(engine.packageVersion, `competitors.engines[${index}].packageVersion`),
    }
  })
  const results = array(report.results, 'competitors.results').map((item, index) => {
    const result = record(item, `competitors.results[${index}]`)
    const engine = record(result.engine, `competitors.results[${index}].engine`)
    const workload = record(result.workload, `competitors.results[${index}].workload`)
    const summary = record(result.summary, `competitors.results[${index}].summary`)
    const details = array(result.runsDetail, `competitors.results[${index}].runsDetail`).map(
      (detail, detailIndex) =>
        record(detail, `competitors.results[${index}].runsDetail[${detailIndex}]`),
    )
    const stages = details.map((detail, detailIndex) =>
      record(detail.stages, `competitors.results[${index}].runsDetail[${detailIndex}].stages`),
    )
    const sources = details.map((detail, detailIndex) =>
      record(detail.source, `competitors.results[${index}].runsDetail[${detailIndex}].source`),
    )
    const values = (records: readonly Readonly<Record<string, unknown>>[], field: string) =>
      records
        .map((value, valueIndex) => optionalNumber(value[field], `${field}[${valueIndex}]`))
        .filter((value): value is number => value !== null)
    const firstSource = sources[0] ?? {}
    const engineId = string(engine.id, `competitors.results[${index}].engine.id`)
    const metadata = engines.find((candidate) => candidate.id === engineId)
    if (metadata === undefined)
      throw new Error(`Competitor result references unknown engine ${engineId}`)
    const correctness = details.map((detail, detailIndex) =>
      record(
        detail.correctness,
        `competitors.results[${index}].runsDetail[${detailIndex}].correctness`,
      ),
    )
    const correctnessStable =
      details.length >= 3 && new Set(correctness.map((value) => JSON.stringify(value))).size === 1
    const firstUsableDataCvPercent = coefficientOfVariation(
      values(stages, 'firstUsableDataMilliseconds'),
    )
    const peakRssCvPercent = coefficientOfVariation(values(details, 'peakRssBytes'))
    const sourceBytesCvPercent = coefficientOfVariation(values(sources, 'returnedBytes'))
    const totalWallCvPercent = coefficientOfVariation(values(stages, 'totalWallMilliseconds'))
    const lowNoise = [
      firstUsableDataCvPercent,
      peakRssCvPercent,
      sourceBytesCvPercent,
      totalWallCvPercent,
    ]
      .filter((value): value is number => value !== null)
      .every((value) => value < 10)
    const representative = boolean(
      workload.representative,
      `competitors.results[${index}].workload.representative`,
    )
    const resultStatus = string(result.status, `competitors.results[${index}].status`)
    return {
      correctnessStable,
      engineId,
      family: string(workload.family, `competitors.results[${index}].workload.family`),
      firstUsableDataCvPercent,
      firstUsableDataMilliseconds:
        optionalNumber(summary.firstUsableDataMilliseconds, 'firstUsableDataMilliseconds') ?? 0,
      inputCopyBytes:
        optionalNumber(firstSource.requiredInputCopyBytes, 'requiredInputCopyBytes') ?? 0,
      implementationClass: metadata.implementationClass,
      packageVersion: metadata.packageVersion,
      lowNoise,
      peakRssCvPercent,
      peakRssBytes: optionalNumber(summary.peakRssBytes, 'peakRssBytes') ?? 0,
      requestCount: optionalNumber(firstSource.requestCount, 'requestCount') ?? 0,
      representative,
      sourceBytesCvPercent,
      sourceBytes: optionalNumber(summary.sourceBytes, 'sourceBytes') ?? 0,
      status: resultStatus,
      title: string(workload.title, `competitors.results[${index}].workload.title`),
      totalWallCvPercent,
      totalWallMilliseconds:
        optionalNumber(summary.totalWallMilliseconds, 'totalWallMilliseconds') ?? 0,
      workloadId: string(workload.id, `competitors.results[${index}].workload.id`),
      eligibleForCharts:
        representative && resultStatus === 'supported' && correctnessStable && lowNoise,
    }
  })
  if (results.some((result) => result.status === 'invalid-output' || result.status === 'error')) {
    throw new Error('Scientific competitor publication contains failed output')
  }
  const bundle = record(report.bundle, 'competitors.bundle')
  const bundles = engines.map((engine) => {
    const metric = record(bundle[engine.id], `competitors.bundle.${engine.id}`)
    const rawWasmBytes = array(
      metric.wasmAssets,
      `competitors.bundle.${engine.id}.wasmAssets`,
    ).reduce<number>(
      (sum, item, index) =>
        sum +
        number(record(item, `wasmAssets[${index}]`).rawBytes, `wasmAssets[${index}].rawBytes`),
      0,
    )
    return {
      brotliJavaScriptBytes: number(metric.importedJavaScriptBrotliBytes, `${engine.id}.brotli`),
      engineId: engine.id,
      gzipJavaScriptBytes: number(metric.importedJavaScriptGzipBytes, `${engine.id}.gzip`),
      installedBytes: number(metric.installedBytes, `${engine.id}.installedBytes`),
      rawWasmBytes,
    }
  })
  return {
    bundles,
    createdAt: string(report.createdAt, 'competitors.createdAt'),
    engines,
    environment: {
      architecture: string(environment.architecture, 'competitors.environment.architecture'),
      node: string(environment.nodeVersion, 'competitors.environment.nodeVersion'),
      platform: string(environment.platform, 'competitors.environment.platform'),
    },
    results,
  }
}

const countStatuses = (
  results: readonly Readonly<Record<string, unknown>>[],
): Readonly<Record<string, number>> => {
  const counts: Record<string, number> = {}
  for (const result of results) {
    const value = string(result.status, 'published result status')
    counts[value] = (counts[value] ?? 0) + 1
  }
  return counts
}

const writePublicResults = async (): Promise<void> => {
  const sourceIndex = await latestSourceIndex()
  const definitions = [
    { profile: 'competitors', build: ordinarySnapshot, headline: true },
    { profile: 'web-codecs', build: ordinarySnapshot, headline: true },
    { profile: 'scientific-readers-baseline', build: scientificSnapshot, headline: true },
    { profile: 'scientific-readers-scaling', build: scientificScalingSnapshot, headline: true },
    { profile: 'scientific-readers-range', build: rangeSnapshot, headline: false },
    { profile: 'scientific-competitors-baseline', build: competitorSnapshot, headline: false },
  ] as const
  const indexEntries: Readonly<Record<string, unknown>>[] = []
  await mkdir(publicDirectory, { recursive: true })
  for (const definition of definitions) {
    const source = latestEntry(sourceIndex.results, definition.profile)
    const data = await definition.build(source)
    const dataRecord = record(data, `${definition.profile}.data`)
    const dataEngine = isRecord(dataRecord.engine) ? dataRecord.engine : undefined
    const engineVersions =
      Object.keys(source.engineVersions).length > 0
        ? source.engineVersions
        : dataEngine === undefined
          ? {}
          : {
              [string(dataEngine.id, `${definition.profile}.engine.id`)]: string(
                dataEngine.version,
                `${definition.profile}.engine.version`,
              ),
            }
    const stem = `${definition.profile}-${dateStem(source.date)}`
    const jsonPath = join(publicDirectory, `${stem}.json`)
    const markdownPath = join(publicDirectory, `${stem}.md`)
    const headlineEligible =
      definition.headline &&
      source.validationStatus === 'passed' &&
      source.eligibleForDocumentationHeadlines
    const document = {
      schemaVersion: 1,
      profile: definition.profile,
      publicationValidationStatus: 'passed',
      validationStatus: 'passed',
      source: {
        eligibleForDocumentationHeadlines: source.eligibleForDocumentationHeadlines,
        resultIndex: portable(sourceIndex.path),
        resultPaths: source.resultPaths,
        validationStatus: source.validationStatus,
      },
      data,
    }
    const json = `${JSON.stringify(document, null, 2)}\n`
    const results = record(data, `${definition.profile}.data`).results
    const statusCounts = Array.isArray(results)
      ? countStatuses(
          results.map((result, index) => record(result, `${definition.profile}.results[${index}]`)),
        )
      : {}
    const markdown = [
      `# ${definition.profile} public benchmark snapshot`,
      '',
      `- Date: ${source.date}`,
      `- Commit: ${source.commit}`,
      `- Environment fingerprint: ${source.environmentFingerprint}`,
      `- Publication validation: passed`,
      `- Source validation: ${source.validationStatus}`,
      `- Documentation headline eligible: ${headlineEligible ? 'yes' : 'no'}`,
      `- Status counts: ${
        Object.entries(statusCounts)
          .map(([key, value]) => `${key}=${value}`)
          .join(', ') || 'not applicable'
      }`,
      `- Source result index: ${portable(sourceIndex.path)}`,
      '',
      'This compact tracked snapshot contains only the fields consumed by generated public documentation. Raw benchmark output remains local and ignored.',
      '',
    ].join('\n')
    const existingJson = await readFile(jsonPath, 'utf8').catch(() => undefined)
    const existingMarkdown = await readFile(markdownPath, 'utf8').catch(() => undefined)
    const publishedJson = existingJson ?? json
    const publishedMarkdown = existingMarkdown ?? markdown
    if (existingJson === undefined) await writeFile(jsonPath, publishedJson)
    if (existingMarkdown === undefined) await writeFile(markdownPath, publishedMarkdown)
    indexEntries.push({
      commit: source.commit,
      date: source.date,
      eligibleForDocumentationHeadlines: headlineEligible,
      engineVersions,
      environmentFingerprint: source.environmentFingerprint,
      fixtureManifestHash: source.fixtureManifestHash,
      profile: definition.profile,
      publicationValidationStatus: 'passed',
      validationStatus: 'passed',
      resultPaths: [portable(jsonPath), portable(markdownPath)],
      sha256: { json: hash(publishedJson), markdown: hash(publishedMarkdown) },
      sourceEligibilityForDocumentationHeadlines: source.eligibleForDocumentationHeadlines,
      sourceResultPaths: source.resultPaths,
      sourceValidationStatus: source.validationStatus,
    })
  }
  const index = {
    schemaVersion: 1,
    generatedAt: sourceIndex.generatedAt,
    sourceResultIndex: portable(sourceIndex.path),
    results: indexEntries,
  }
  const indexJson = `${JSON.stringify(index, null, 2)}\n`
  const indexMarkdown = [
    '# Public benchmark result index',
    '',
    `Generated from \`${portable(sourceIndex.path)}\`.`,
    '',
    '| Profile | Date | Validation | Headline eligible | JSON | Markdown |',
    '| --- | --- | --- | --- | --- | --- |',
    ...indexEntries.map((item) => {
      const entry = record(item, 'index entry')
      const paths = array(entry.resultPaths, 'index entry paths').map((path, index) =>
        string(path, `path ${index}`),
      )
      return `| ${entry.profile} | ${entry.date} | passed | ${entry.eligibleForDocumentationHeadlines ? 'yes' : 'no'} | [JSON](./${basename(paths[0] ?? '')}) | [Markdown](./${basename(paths[1] ?? '')}) |`
    }),
    '',
  ].join('\n')
  await writeFile(join(publicDirectory, 'index.json'), indexJson)
  await writeFile(join(publicDirectory, 'index.md'), indexMarkdown)
  console.log(
    `Wrote ${portable(join(publicDirectory, 'index.json'))} and ${indexEntries.length} public snapshots`,
  )
}

const checkPublicResults = async (): Promise<void> => {
  const indexPath = join(publicDirectory, 'index.json')
  const document = record(await readJson(indexPath), indexPath)
  const entries = array(document.results, `${indexPath}.results`)
  const expectedProfiles = [
    'competitors',
    'web-codecs',
    'scientific-readers-baseline',
    'scientific-readers-scaling',
    'scientific-readers-range',
    'scientific-competitors-baseline',
  ]
  const seen = new Set<string>()
  const trackedPaths = [portable(indexPath), portable(join(publicDirectory, 'index.md'))]
  for (const [entryIndex, item] of entries.entries()) {
    const entry = record(item, `${indexPath}.results[${entryIndex}]`)
    const profile = string(entry.profile, `${indexPath}.results[${entryIndex}].profile`)
    seen.add(profile)
    if (entry.publicationValidationStatus !== 'passed')
      throw new Error(`${profile} public snapshot is not validated`)
    if (Object.keys(record(entry.engineVersions, `${profile}.engineVersions`)).length === 0) {
      throw new Error(`${profile} omits engine versions`)
    }
    const paths = array(entry.resultPaths, `${profile}.resultPaths`).map((path, pathIndex) =>
      string(path, `${profile}.resultPaths[${pathIndex}]`),
    )
    const hashes = record(entry.sha256, `${profile}.sha256`)
    for (const path of paths) {
      if (!path.startsWith('benchmark/results/public/'))
        throw new Error(`${profile} references non-public result ${path}`)
      trackedPaths.push(path)
      const contents = await readFile(join(repositoryDirectory, path))
      const key = path.endsWith('.json') ? 'json' : 'markdown'
      if (hash(contents) !== string(hashes[key], `${profile}.sha256.${key}`))
        throw new Error(`${path} hash does not match public index`)
    }
    const jsonPath = paths.find((path) => path.endsWith('.json'))
    if (jsonPath === undefined) throw new Error(`${profile} has no public JSON snapshot`)
    const snapshot = record(await readJson(join(repositoryDirectory, jsonPath)), jsonPath)
    if (snapshot.profile !== profile || snapshot.publicationValidationStatus !== 'passed')
      throw new Error(`${jsonPath} publication metadata is inconsistent`)
  }
  for (const profile of expectedProfiles)
    if (!seen.has(profile)) throw new Error(`Public result index omits ${profile}`)
  if (process.env.CI === 'true') {
    execFileSync('git', ['ls-files', '--error-unmatch', ...trackedPaths], {
      cwd: repositoryDirectory,
      stdio: 'ignore',
    })
  } else {
    for (const path of trackedPaths) {
      try {
        execFileSync('git', ['check-ignore', '--quiet', path], {
          cwd: repositoryDirectory,
          stdio: 'ignore',
        })
        throw new Error(`${path} is ignored and will be absent from a clean checkout`)
      } catch (error: unknown) {
        if (error instanceof Error && error.message.includes('is ignored')) throw error
      }
    }
  }
  console.log(`Validated ${entries.length} public benchmark snapshots`)
}

if (writeMode) await writePublicResults()
else await checkPublicResults()
