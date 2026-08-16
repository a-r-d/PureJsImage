import { createHash } from 'node:crypto'
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

interface ResultIndexEntry {
  readonly profile: string
  readonly date: string
  readonly commit: string
  readonly environmentFingerprint: string
  readonly resultPaths: readonly string[]
  readonly engineVersions: Readonly<Record<string, string>>
  readonly fixtureManifestHash: string
  readonly validationStatus: 'passed' | 'failed' | 'partial' | 'unverified'
  readonly eligibleForDocumentationHeadlines: boolean
}

const benchmarkDirectory = dirname(dirname(fileURLToPath(import.meta.url)))
const repositoryDirectory = dirname(benchmarkDirectory)
const roots = [
  join(benchmarkDirectory, 'results'),
  join(benchmarkDirectory, 'scientific-readers', 'results', 'artifacts'),
]

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const stringValue = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined

const hashJson = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex')

const walk = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => null)
  if (entries === null) return []
  const files: string[] = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory() && entry.name !== 'public') files.push(...(await walk(path)))
    else if (
      entry.isFile() &&
      extname(entry.name) === '.json' &&
      entry.name !== 'latest.json' &&
      !entry.name.startsWith('result-index-')
    )
      files.push(path)
  }
  return files
}

const engineVersions = (value: Record<string, unknown>): Readonly<Record<string, string>> => {
  const output: Record<string, string> = {}
  if (isRecord(value.engineVersions)) {
    for (const [id, version] of Object.entries(value.engineVersions)) {
      const text = stringValue(version)
      if (text !== undefined) output[id] = text
    }
  }
  if (Array.isArray(value.startup)) {
    for (const entry of value.startup) {
      if (!isRecord(entry) || !isRecord(entry.engine)) continue
      const id = stringValue(entry.engine.id)
      const version = stringValue(entry.engine.version)
      if (id !== undefined && version !== undefined) output[id] = version
    }
  }
  if (Array.isArray(value.engines)) {
    for (const entry of value.engines) {
      if (!isRecord(entry)) continue
      const id = stringValue(entry.id)
      const version = stringValue(entry.packageVersion) ?? stringValue(entry.version)
      if (id !== undefined && version !== undefined) output[id] = version
    }
  }
  if (isRecord(value.configuration) && isRecord(value.configuration.engine)) {
    const id = stringValue(value.configuration.engine.id)
    const version = stringValue(value.configuration.engine.version)
    if (id !== undefined && version !== undefined) output[id] = version
  }
  if (isRecord(value.environment) && isRecord(value.environment.provider)) {
    const id = stringValue(value.environment.provider.id)
    const version = value.environment.provider.version
    if (id !== undefined && (typeof version === 'string' || typeof version === 'number')) {
      output[id] = String(version)
    }
  }
  for (const key of ['encoder', 'avifenc', 'ffmpeg'] as const) {
    const version = stringValue(value[key])
    if (version !== undefined) output[key] = version
  }
  return output
}

const validationStatus = (value: Record<string, unknown>): ResultIndexEntry['validationStatus'] => {
  if (isRecord(value.validation) && typeof value.validation.passed === 'boolean') {
    return value.validation.passed ? 'passed' : 'failed'
  }
  if (typeof value.eligibleForDocumentationHeadlines === 'boolean') {
    if (isRecord(value.validation) && value.validation.passed === true) return 'passed'
    return 'failed'
  }
  if (isRecord(value.correctness) && value.correctness.passed === true) return 'passed'
  if (Array.isArray(value.results)) {
    let supported = 0
    let failed = 0
    let unsupported = 0
    for (const result of value.results) {
      if (!isRecord(result)) continue
      const summary = isRecord(result.summary) ? result.summary : result
      const status = stringValue(summary.status) ?? stringValue(result.status)
      if (status === 'pass' || status === 'supported') supported += 1
      else if (status === 'unsupported' || status === 'not-applicable') unsupported += 1
      else if (status !== undefined) failed += 1
    }
    if (failed > 0) return 'failed'
    if (supported > 0) return 'passed'
    if (unsupported > 0) return 'partial'
  }
  return 'unverified'
}

const profile = (value: Record<string, unknown>, file: string): string => {
  const scientificProfile = stringValue(value.profile)
  if (file.includes('/scientific-readers/results/artifacts/scientific-competitors/')) {
    return scientificProfile === undefined
      ? 'scientific-competitors'
      : `scientific-competitors-${scientificProfile}`
  }
  if (file.includes('/scientific-readers/results/artifacts/scientific-readers/')) {
    return scientificProfile === undefined
      ? 'scientific-readers'
      : `scientific-readers-${scientificProfile}`
  }
  const recorded = stringValue(value.profile)
  if (recorded !== undefined) return recorded
  const filename = file.split('/').at(-1) ?? ''
  if (/^application-platform-/u.test(filename)) return 'application-platform'
  if (/^avif-memory-/u.test(filename)) return 'avif-memory'
  if (/^jpegxl-memory-/u.test(filename)) return 'jpegxl-memory'
  if (/^jpeg2000-rss-/u.test(filename)) return 'jpeg2000-rss'
  return filename.replace(/\.json$/u, '') || 'unknown'
}

const entryFor = async (file: string): Promise<ResultIndexEntry> => {
  const parsed: unknown = JSON.parse(await readFile(file, 'utf8'))
  const value = isRecord(parsed) ? parsed : {}
  const environment = isRecord(value.environment) ? value.environment : {}
  const createdAt =
    stringValue(value.createdAt) ??
    stringValue(value.generatedAt) ??
    (await stat(file)).mtime.toISOString()
  const commit =
    stringValue(value.commit) ??
    stringValue(environment.gitRevision) ??
    stringValue(environment.commit) ??
    stringValue(environment.gitCommit) ??
    'not-recorded'
  const environmentFingerprint =
    stringValue(value.environmentFingerprint) ??
    stringValue(environment.environmentFingerprint) ??
    hashJson(environment)
  const fixtureManifestHash =
    stringValue(value.fixtureManifestHash) ??
    stringValue(environment.fixtureManifestHash) ??
    (isRecord(value.fixturePreparation) && Array.isArray(value.fixturePreparation.fixtures)
      ? hashJson(value.fixturePreparation.fixtures)
      : undefined) ??
    (Array.isArray(value.fixtures) ? hashJson(value.fixtures) : undefined) ??
    (Array.isArray(value.results)
      ? hashJson(
          value.results.flatMap((result) =>
            isRecord(result) && isRecord(result.fixture) ? [result.fixture] : [],
          ),
        )
      : undefined) ??
    'not-recorded'
  const path = relative(repositoryDirectory, file)
  const markdownPath = file.replace(/\.json$/u, '.md')
  const resultPaths = [path]
  try {
    await stat(markdownPath)
    resultPaths.push(relative(repositoryDirectory, markdownPath))
  } catch {
    // Some specialized runners historically emitted JSON only.
  }
  return {
    profile: profile(value, path),
    date: createdAt,
    commit,
    environmentFingerprint,
    resultPaths,
    engineVersions: engineVersions(value),
    fixtureManifestHash,
    validationStatus: validationStatus(value),
    eligibleForDocumentationHeadlines:
      value.eligibleForDocumentationHeadlines === true ||
      (validationStatus(value) === 'passed' &&
        (profile(value, path) === 'competitors' ||
          profile(value, path) === 'scientific-readers-baseline')),
  }
}

const timestamp = new Date().toISOString().replaceAll(/[:.]/gu, '-')
const outputStemArgument = process.argv.indexOf('--output')
const requestedStem = outputStemArgument === -1 ? undefined : process.argv[outputStemArgument + 1]
const outputStem = requestedStem ?? join(benchmarkDirectory, 'results', `result-index-${timestamp}`)
const jsonPath = outputStem.endsWith('.json') ? outputStem : `${outputStem}.json`
const markdownPath = jsonPath.replace(/\.json$/u, '.md')

const files = [...new Set((await Promise.all(roots.map((root) => walk(root)))).flat())].sort()
const entries = await Promise.all(files.map((file) => entryFor(file)))
entries.sort((left, right) => right.date.localeCompare(left.date))
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  repository: 'a-r-d/PureJsImage',
  resultCount: entries.length,
  results: entries,
}
const markdown = [
  '# Benchmark result index',
  '',
  `Generated: ${report.generatedAt}`,
  '',
  '| Profile | Date | Commit | Environment | Validation | Headline eligible | Engine versions | Fixture manifest | Result paths |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ...entries.map(
    (entry) =>
      `| ${entry.profile} | ${entry.date} | ${entry.commit} | ${entry.environmentFingerprint} | ${entry.validationStatus} | ${entry.eligibleForDocumentationHeadlines ? 'yes' : 'no'} | ${
        Object.entries(entry.engineVersions)
          .map(([id, version]) => `${id}=${version}`)
          .join('<br>') || '—'
      } | ${entry.fixtureManifestHash} | ${entry.resultPaths.join('<br>')} |`,
  ),
  '',
  'Historical rows are retained. A missing fixture hash, unknown validation, or different environment fingerprint prevents strong cross-date performance claims.',
  '',
].join('\n')
await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`)
await writeFile(markdownPath, markdown)
console.log(jsonPath)
console.log(markdownPath)
