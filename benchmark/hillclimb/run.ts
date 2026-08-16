import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { workloadsForScientificProfile } from '../scientific-readers/workloads.ts'
import { workflowsForProfile } from '../workflows.ts'
import { compareHillclimbTrials, type HillclimbGoal, type HillclimbTrial } from './compare.ts'

type Suite = 'scientific' | 'web'

interface Options {
  readonly suite: Suite
  readonly goal: HillclimbGoal
  readonly workload: string | undefined
  readonly baseRef: string
  readonly trials: number
  readonly warmups: number
  readonly materialSpeedPercent: number
  readonly materialMemoryPercent: number
  readonly maximumRegressionPercent: number
  readonly maximumCvPercent: number
  readonly allowedProtectedMetricRegressions: readonly string[]
}

interface CommandResult {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

interface TrialContext {
  readonly label: 'base' | 'candidate'
  readonly directory: string
  readonly revision: string
  readonly dirty: boolean
}

class HillclimbRunError extends Error {
  readonly exitCode: 1 | 2

  constructor(message: string, exitCode: 1 | 2) {
    super(message)
    this.exitCode = exitCode
  }
}

const benchmarkDirectory = dirname(dirname(fileURLToPath(import.meta.url)))
const repositoryDirectory = dirname(benchmarkDirectory)

const argument = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}

const positiveNumber = (name: string, fallback: number): number => {
  const value = Number(argument(name) ?? fallback)
  if (!Number.isFinite(value) || value <= 0) throw new Error(`--${name} must be positive`)
  return value
}

const nonNegativeInteger = (name: string, fallback: number): number => {
  const value = Number(argument(name) ?? fallback)
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`--${name} must be a non-negative integer`)
  return value
}

const positiveInteger = (name: string, fallback: number): number => {
  const value = Number(argument(name) ?? fallback)
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error(`--${name} must be a positive integer`)
  return value
}

const parseOptions = (): Options => {
  const suite = argument('suite') ?? 'web'
  if (suite !== 'web' && suite !== 'scientific')
    throw new Error('--suite must be web or scientific')
  const goal = argument('goal') ?? 'speed'
  if (goal !== 'speed' && goal !== 'memory') throw new Error('--goal must be speed or memory')
  return Object.freeze({
    suite,
    goal,
    workload: argument('workload'),
    baseRef: argument('base-ref') ?? 'origin/main',
    trials: positiveInteger('trials', 7),
    warmups: nonNegativeInteger('warmups', 1),
    materialSpeedPercent: positiveNumber('material-speed-percent', 3),
    materialMemoryPercent: positiveNumber('material-memory-percent', 5),
    maximumRegressionPercent: positiveNumber('maximum-regression-percent', 5),
    maximumCvPercent: positiveNumber('maximum-cv-percent', 10),
    allowedProtectedMetricRegressions: Object.freeze(
      (argument('allow-protected-regression') ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  })
}

const runCommand = (
  command: string,
  args: readonly string[],
  options: { readonly cwd: string; readonly env?: NodeJS.ProcessEnv },
): Promise<CommandResult> =>
  new Promise((resolveCommand, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', reject)
    child.on('exit', (code) => resolveCommand({ code: code ?? 1, stdout, stderr }))
  })

const checkedCommand = async (
  command: string,
  args: readonly string[],
  cwd: string,
): Promise<string> => {
  const result = await runCommand(command, args, { cwd })
  if (result.code !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed: ${result.stderr.trim()}`)
  }
  return result.stdout.trim()
}

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

const text = (value: unknown, label: string): string => {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`)
  return value
}

const number = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error(`${label} must be finite`)
  return value
}

const optionalNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

const stableJson = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  const valueRecord = value as Readonly<Record<string, unknown>>
  return `{${Object.keys(valueRecord)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(valueRecord[key])}`)
    .join(',')}}`
}

const hash = (value: unknown): string =>
  createHash('sha256').update(stableJson(value)).digest('hex')

const reportPath = (stdout: string): string => {
  const path = /^JSON: (.+)$/mu.exec(stdout)?.[1]
  if (path === undefined) throw new Error('Benchmark harness did not report a JSON artifact path')
  return path
}

const canonicalScientificEnvironment = (report: Readonly<Record<string, unknown>>): string => {
  const environment = record(report.environment, 'scientific.environment')
  const configuration = record(report.configuration, 'scientific.configuration')
  return hash({
    configuration: {
      profile: report.profile,
      runs: configuration.runs,
      warmups: configuration.warmups,
      fragmentBytes: configuration.fragmentBytes ?? 0,
      sourceLatencies: configuration.sourceLatencies ?? [0],
      isolatedProcessPerRun: configuration.isolatedProcessPerRun,
    },
    environment: {
      operatingSystem: environment.operatingSystem,
      operatingSystemVersion: environment.operatingSystemVersion,
      architecture: environment.architecture,
      nodeVersion: environment.nodeVersion,
      v8Version: environment.v8Version,
      cpuModel: environment.cpuModel,
      logicalCpuCount: environment.logicalCpuCount,
      platform: environment.platform,
      runnerClass: environment.runnerClass ?? 'local',
    },
  })
}

const canonicalScientificFixtures = (report: Readonly<Record<string, unknown>>): string => {
  const preparation = record(report.fixturePreparation, 'scientific.fixturePreparation')
  return hash(
    array(preparation.fixtures, 'scientific.fixturePreparation.fixtures').map((fixtureValue) => {
      const fixture = record(fixtureValue, 'scientific.fixture')
      return {
        fixtureId: fixture.id,
        resources: array(fixture.resources, 'scientific.fixture.resources').map((resourceValue) => {
          const resource = record(resourceValue, 'scientific.fixture.resource')
          return {
            resourceId: resource.id,
            name: resource.name,
            sha256: resource.sha256,
            sizeBytes: resource.sizeBytes,
            payloadRanges: resource.payloadRanges ?? [],
          }
        }),
      }
    }),
  )
}

const parseWebTrial = (
  report: Readonly<Record<string, unknown>>,
  workload: string,
  label: 'base' | 'candidate',
): HillclimbTrial => {
  const resultValue = array(report.results, 'web.results').find(
    (value) => isRecord(value) && value.engine === 'purejsimage' && value.workflow === workload,
  )
  const result = record(resultValue, `web result ${workload}`)
  const sample = record(array(result.samples, 'web.samples')[0], 'web.sample')
  if (sample.status !== 'pass') throw new Error(`${label} web trial is ${String(sample.status)}`)
  const environment = record(report.environment, 'web.environment')
  const output = record(sample.output, 'web.output')
  const protectedMetrics: Record<string, number> = {
    outputBytes: number(sample.outputBytes, 'web.outputBytes'),
  }
  const sourceBytesRead = optionalNumber(sample.sourceBytesRead)
  const maximumDecodedBlockBytes = optionalNumber(sample.maximumDecodedBlockBytes)
  if (sourceBytesRead !== undefined) protectedMetrics.sourceBytesRead = sourceBytesRead
  if (maximumDecodedBlockBytes !== undefined)
    protectedMetrics.maximumDecodedBlockBytes = maximumDecodedBlockBytes
  return Object.freeze({
    label,
    status: 'supported',
    environmentFingerprint: text(
      environment.environmentFingerprint,
      'web.environment.environmentFingerprint',
    ),
    fixtureFingerprint: text(environment.fixtureManifestHash, 'web.fixtureManifestHash'),
    correctnessSignature: hash({
      format: output.format,
      width: output.width,
      height: output.height,
      bytes: output.bytes,
      sha256: output.sha256,
    }),
    operationSignature: hash({ suite: 'web', profile: report.profile, workload }),
    wallMilliseconds: number(sample.wallMilliseconds, 'web.wallMilliseconds'),
    peakRssBytes: number(sample.peakRssBytes, 'web.peakRssBytes'),
    protectedMetrics: Object.freeze(protectedMetrics),
  })
}

const parseScientificTrial = (
  report: Readonly<Record<string, unknown>>,
  workload: string,
  label: 'base' | 'candidate',
): HillclimbTrial => {
  const result = record(array(report.results, 'scientific.results')[0], 'scientific.result')
  if (result.status !== 'supported')
    throw new Error(`${label} scientific trial is ${String(result.status)}`)
  const identity = record(result.identity, 'scientific.identity')
  if (identity.workloadId !== workload)
    throw new Error(`Scientific report returned ${String(identity.workloadId)}`)
  const run = record(array(result.runs, 'scientific.runs')[0], 'scientific.run')
  if (run.status !== 'supported')
    throw new Error(`${label} scientific run is ${String(run.status)}`)
  const timing = record(run.timing, 'scientific.timing')
  const memory = record(run.memory, 'scientific.memory')
  const source = record(run.source, 'scientific.source')
  const protectedMetrics: Record<string, number> = {
    sourceReadCalls: number(source.readCalls, 'scientific.source.readCalls'),
    sourceRequestedBytes: number(source.requestedBytes, 'scientific.source.requestedBytes'),
    sourceReturnedBytes: number(source.returnedBytes, 'scientific.source.returnedBytes'),
    uniqueSourceBytesTouched: number(
      source.uniqueSourceBytesTouched,
      'scientific.source.uniqueSourceBytesTouched',
    ),
    outputBytes: number(memory.outputBytes, 'scientific.memory.outputBytes'),
    maximumEmittedBlockBytes: number(
      memory.maximumEmittedBlockBytes,
      'scientific.memory.maximumEmittedBlockBytes',
    ),
  }
  const overfetchRatio = optionalNumber(source.overfetchRatio)
  if (overfetchRatio !== undefined) protectedMetrics.overfetchRatio = overfetchRatio
  return Object.freeze({
    label,
    status: 'supported',
    environmentFingerprint: canonicalScientificEnvironment(report),
    fixtureFingerprint: canonicalScientificFixtures(report),
    correctnessSignature: hash(run.correctness),
    operationSignature: hash({
      suite: 'scientific',
      profile: report.profile,
      workload,
      operation: identity.operation,
      sourceLatencyMilliseconds: identity.sourceLatencyMilliseconds,
    }),
    wallMilliseconds: number(timing.totalWallMilliseconds, 'scientific.totalWallMilliseconds'),
    peakRssBytes: number(memory.absolutePeakRssBytes, 'scientific.absolutePeakRssBytes'),
    protectedMetrics: Object.freeze(protectedMetrics),
  })
}

const harnessArguments = (options: Options, workload: string, stem: string): readonly string[] =>
  options.suite === 'web'
    ? [
        'benchmark/run.ts',
        '--engines',
        'purejsimage',
        '--profile',
        'web-codecs',
        '--workflow',
        workload,
        '--runs',
        '1',
        '--warmups',
        String(options.warmups),
        '--output',
        stem,
      ]
    : [
        'benchmark/scientific-readers/run.ts',
        '--profile',
        'scaling',
        '--workload',
        workload,
        '--runs',
        '1',
        '--warmups',
        String(options.warmups),
        '--timeout-ms',
        '300000',
      ]

const runTrial = async (
  options: Options,
  workload: string,
  context: TrialContext,
  rawDirectory: string,
  trial: string,
): Promise<HillclimbTrial> => {
  const outputDirectory = join(rawDirectory, `${trial}-${context.label}`)
  await mkdir(outputDirectory, { recursive: true })
  const result = await runCommand(process.execPath, harnessArguments(options, workload, trial), {
    cwd: context.directory,
    env: {
      ...process.env,
      PUREJSIMAGE_BENCHMARK_GIT_COMMIT: context.revision,
      PUREJSIMAGE_BENCHMARK_GIT_DIRTY: String(context.dirty),
      PUREJSIMAGE_BENCHMARK_OUTPUT_DIRECTORY: outputDirectory,
      PUREJSIMAGE_ENTRY: './dist/index.js',
    },
  })
  let path: string
  let parsed: HillclimbTrial
  try {
    path = reportPath(result.stdout)
    const report: unknown = JSON.parse(await readFile(path, 'utf8'))
    parsed =
      options.suite === 'web'
        ? parseWebTrial(record(report, path), workload, context.label)
        : parseScientificTrial(record(report, path), workload, context.label)
  } catch (error) {
    throw new HillclimbRunError(
      error instanceof Error ? error.message : String(error),
      context.label === 'candidate' ? 1 : 2,
    )
  }
  await writeFile(
    join(rawDirectory, `${trial}-${context.label}-sample.json`),
    `${JSON.stringify(parsed, null, 2)}\n`,
  )
  if (result.code !== 0)
    throw new HillclimbRunError(
      `${context.label} harness exited ${result.code}`,
      context.label === 'candidate' ? 1 : 2,
    )
  return parsed
}

const currentEnvironmentMatches = (environment: Readonly<Record<string, unknown>>): boolean =>
  environment.architecture === process.arch &&
  (environment.node === process.version || environment.nodeVersion === process.version) &&
  (environment.cpu === os.cpus()[0]?.model || environment.cpuModel === os.cpus()[0]?.model) &&
  (environment.osRelease === os.release() || environment.operatingSystemVersion === os.release()) &&
  (environment.v8Version === process.versions.v8 || environment.v8 === process.versions.v8)

const recentJsonFiles = async (directory: string): Promise<readonly string[]> => {
  const names = await readdir(directory).catch(() => [])
  const entries = await Promise.all(
    names
      .filter((name) => name.endsWith('.json') && name !== 'latest.json')
      .map(async (name) => {
        const path = join(directory, name)
        return { path, modified: (await stat(path)).mtimeMs }
      }),
  )
  return entries.sort((left, right) => right.modified - left.modified).map(({ path }) => path)
}

const freshWorkload = async (
  options: Options,
  revision: string,
): Promise<{ readonly workload: string; readonly reason: string } | undefined> => {
  const directory =
    options.suite === 'web'
      ? join(repositoryDirectory, 'benchmark', 'results')
      : join(
          repositoryDirectory,
          'benchmark',
          'scientific-readers',
          'results',
          'artifacts',
          'scientific-readers',
        )
  for (const path of await recentJsonFiles(directory)) {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
    if (
      !isRecord(parsed) ||
      parsed.profile !== (options.suite === 'web' ? 'web-codecs' : 'scaling')
    )
      continue
    const environment = isRecord(parsed.environment) ? parsed.environment : {}
    const reportRevision =
      isRecord(parsed.revision) && typeof parsed.revision.gitCommit === 'string'
        ? parsed.revision.gitCommit
        : typeof environment.gitRevision === 'string'
          ? environment.gitRevision
          : typeof environment.gitCommit === 'string'
            ? environment.gitCommit
            : ''
    if (
      reportRevision.length === 0 ||
      (!revision.startsWith(reportRevision) && !reportRevision.startsWith(revision))
    )
      continue
    if (!currentEnvironmentMatches(environment)) continue
    const candidates = array(parsed.results, `${path}.results`).flatMap((value) => {
      if (!isRecord(value)) return []
      if (options.suite === 'web') {
        if (
          value.engine !== 'purejsimage' ||
          !isRecord(value.summary) ||
          value.summary.status !== 'pass'
        )
          return []
        if (
          typeof value.workflow !== 'string' ||
          !new Set(surveyWorkloads('web')).has(value.workflow)
        )
          return []
        const summary = value.summary
        const metric =
          options.goal === 'speed'
            ? isRecord(summary.wallMilliseconds)
              ? optionalNumber(summary.wallMilliseconds.median)
              : undefined
            : isRecord(summary.peakRssBytes)
              ? optionalNumber(summary.peakRssBytes.median)
              : undefined
        return typeof value.workflow === 'string' && metric !== undefined
          ? [{ workload: value.workflow, metric }]
          : []
      }
      if (
        value.status !== 'supported' ||
        value.measurementClass !== 'representative' ||
        !isRecord(value.identity)
      )
        return []
      const metricContainer =
        options.goal === 'speed' && isRecord(value.timing)
          ? value.timing.totalWallMilliseconds
          : isRecord(value.memory)
            ? value.memory.absolutePeakRssBytes
            : undefined
      const metric = isRecord(metricContainer) ? optionalNumber(metricContainer.median) : undefined
      return typeof value.identity.workloadId === 'string' && metric !== undefined
        ? [{ workload: value.identity.workloadId, metric }]
        : []
    })
    const selected = candidates.sort((left, right) => right.metric - left.metric)[0]
    if (selected !== undefined) {
      return {
        workload: selected.workload,
        reason: `fresh current-revision ${options.suite} result with the largest ${options.goal === 'speed' ? 'end-to-end runtime' : 'peak RSS'}`,
      }
    }
  }
  return undefined
}

const surveyWorkloads = (suite: Suite): readonly string[] =>
  suite === 'scientific'
    ? workloadsForScientificProfile('scaling').map(({ id }) => id)
    : workflowsForProfile('web-codecs')
        .filter(({ id }) => !id.includes('metadata'))
        .map(({ id }) => id)

const selectWorkload = async (
  options: Options,
  candidate: TrialContext,
  rawDirectory: string,
): Promise<{ readonly workload: string; readonly reason: string }> => {
  if (options.workload !== undefined)
    return { workload: options.workload, reason: 'explicit CLI target' }
  const fresh = await freshWorkload(options, candidate.revision)
  if (fresh !== undefined) return fresh
  const surveyed: { readonly workload: string; readonly metric: number }[] = []
  for (const workload of surveyWorkloads(options.suite)) {
    const result = await runTrial(options, workload, candidate, rawDirectory, `survey-${workload}`)
    surveyed.push({
      workload,
      metric: options.goal === 'speed' ? result.wallMilliseconds : result.peakRssBytes,
    })
  }
  const selected = surveyed.sort((left, right) => right.metric - left.metric)[0]
  if (selected === undefined) throw new Error('Representative workload survey produced no result')
  return {
    workload: selected.workload,
    reason: `one-sample representative survey with the largest ${options.goal === 'speed' ? 'absolute end-to-end runtime' : 'peak RSS'}`,
  }
}

const overlayHarness = async (suite: Suite, baseDirectory: string): Promise<void> => {
  const paths =
    suite === 'web'
      ? ['benchmark/run.ts']
      : [
          'benchmark/scientific-readers/integrity.ts',
          'benchmark/scientific-readers/run.ts',
          'benchmark/scientific-readers/types.ts',
          'benchmark/scientific-readers/worker.ts',
        ]
  for (const path of paths) {
    const destination = join(baseDirectory, path)
    await mkdir(dirname(destination), { recursive: true })
    await copyFile(join(repositoryDirectory, path), destination)
  }
}

const shareFixtureBytes = async (suite: Suite, baseDirectory: string): Promise<void> => {
  const candidatePath =
    suite === 'web'
      ? join(repositoryDirectory, 'benchmark', 'corpus', 'files')
      : join(repositoryDirectory, 'benchmark', 'scientific-readers', '.tmp')
  const basePath =
    suite === 'web'
      ? join(baseDirectory, 'benchmark', 'corpus', 'files')
      : join(baseDirectory, 'benchmark', 'scientific-readers', '.tmp')
  await mkdir(candidatePath, { recursive: true })
  await rm(basePath, { recursive: true, force: true })
  await symlink(candidatePath, basePath, 'dir')
}

const format = (value: number): string => value.toFixed(2)

const markdownReport = (report: Readonly<Record<string, unknown>>): string => {
  const comparison = record(report.comparison, 'comparison')
  const speed = record(comparison.speed, 'comparison.speed')
  const memory = record(comparison.memory, 'comparison.memory')
  const speedBase = record(speed.base, 'comparison.speed.base')
  const speedCandidate = record(speed.candidate, 'comparison.speed.candidate')
  const memoryBase = record(memory.base, 'comparison.memory.base')
  const memoryCandidate = record(memory.candidate, 'comparison.memory.candidate')
  return `# Benchmark hillclimb comparison\n\n- Suite: ${String(report.suite)}\n- Workload: ${String(report.workload)}\n- Selection: ${String(report.selectionReason)}\n- Goal: ${String(report.goal)}\n- Base revision: ${String(report.baseRevision)}\n- Candidate revision: ${String(report.candidateRevision)} (${report.candidateDirty === true ? 'dirty' : 'clean'})\n- Verdict: **${String(comparison.verdict)}**\n\n| Metric | Base median | Candidate median | Delta | Base MAD | Candidate MAD |\n| --- | ---: | ---: | ---: | ---: | ---: |\n| Wall ms | ${format(number(speedBase.median, 'speed base'))} | ${format(number(speedCandidate.median, 'speed candidate'))} | ${format(number(speed.medianDeltaPercent, 'speed delta'))}% | ${format(number(speedBase.mad, 'speed base MAD'))} | ${format(number(speedCandidate.mad, 'speed candidate MAD'))} |\n| Peak RSS bytes | ${format(number(memoryBase.median, 'memory base'))} | ${format(number(memoryCandidate.median, 'memory candidate'))} | ${format(number(memory.medianDeltaPercent, 'memory delta'))}% | ${format(number(memoryBase.mad, 'memory base MAD'))} | ${format(number(memoryCandidate.mad, 'memory candidate MAD'))} |\n\n## Decision\n\n${array(
    comparison.reasons,
    'comparison.reasons',
  )
    .map((reason) => `- ${String(reason)}`)
    .join(
      '\n',
    )}\n\nCorrectness signatures, operation semantics, support status, environment fingerprints, fixture fingerprints, and protected metrics must match before an improvement is accepted. Full raw samples remain under this run's \`raw/\` directory.\n`
}

const main = async (): Promise<void> => {
  const options = parseOptions()
  const createdAt = new Date().toISOString()
  const runDirectory = join(
    repositoryDirectory,
    '.tmp',
    'hillclimb',
    createdAt.replaceAll(/[:.]/gu, '-'),
  )
  const rawDirectory = join(runDirectory, 'raw')
  const baseDirectory = join(runDirectory, 'base-worktree')
  await mkdir(rawDirectory, { recursive: true })
  const candidateRevision = await checkedCommand('git', ['rev-parse', 'HEAD'], repositoryDirectory)
  const baseRevision = await checkedCommand(
    'git',
    ['rev-parse', options.baseRef],
    repositoryDirectory,
  )
  const candidateDirty =
    (await checkedCommand('git', ['status', '--porcelain'], repositoryDirectory)).length > 0
  let worktreeCreated = false
  try {
    await checkedCommand(
      'git',
      ['worktree', 'add', '--detach', baseDirectory, baseRevision],
      repositoryDirectory,
    )
    worktreeCreated = true
    await overlayHarness(options.suite, baseDirectory)
    await shareFixtureBytes(options.suite, baseDirectory)
    process.stdout.write('Building candidate with the current Node runtime.\n')
    await checkedCommand('npm', ['run', 'build'], repositoryDirectory)
    process.stdout.write('Building base with the current Node runtime.\n')
    await checkedCommand('npm', ['run', 'build'], baseDirectory)
    const candidate: TrialContext = {
      label: 'candidate',
      directory: repositoryDirectory,
      revision: candidateRevision,
      dirty: candidateDirty,
    }
    const base: TrialContext = {
      label: 'base',
      directory: baseDirectory,
      revision: baseRevision,
      dirty: false,
    }
    const selection = await selectWorkload(options, candidate, rawDirectory)
    process.stdout.write(`Selected ${selection.workload}: ${selection.reason}.\n`)
    const baseTrials: HillclimbTrial[] = []
    const candidateTrials: HillclimbTrial[] = []
    for (let index = 0; index < options.trials; index += 1) {
      const order = index % 2 === 0 ? [base, candidate] : [candidate, base]
      const pair = new Map<'base' | 'candidate', HillclimbTrial>()
      for (const context of order) {
        process.stdout.write(
          `Pair ${index + 1}/${options.trials}: ${context.label} (${index % 2 === 0 ? 'base-first' : 'candidate-first'}).\n`,
        )
        pair.set(
          context.label,
          await runTrial(
            options,
            selection.workload,
            context,
            rawDirectory,
            `trial-${String(index + 1).padStart(2, '0')}`,
          ),
        )
      }
      const baseTrial = pair.get('base')
      const candidateTrial = pair.get('candidate')
      if (baseTrial === undefined || candidateTrial === undefined)
        throw new Error('Balanced trial pair is incomplete')
      baseTrials.push(baseTrial)
      candidateTrials.push(candidateTrial)
    }
    const comparison = compareHillclimbTrials(baseTrials, candidateTrials, {
      goal: options.goal,
      materialSpeedPercent: options.materialSpeedPercent,
      materialMemoryPercent: options.materialMemoryPercent,
      maximumRegressionPercent: options.maximumRegressionPercent,
      maximumCoefficientOfVariationPercent: options.maximumCvPercent,
      allowedProtectedMetricRegressions: options.allowedProtectedMetricRegressions,
    })
    const report = Object.freeze({
      schemaVersion: 1,
      createdAt,
      suite: options.suite,
      workload: selection.workload,
      selectionReason: selection.reason,
      goal: options.goal,
      reproductionCommand: `npm run bench:hillclimb -- --suite ${options.suite} --workload ${selection.workload} --goal ${options.goal} --base-ref ${options.baseRef}`,
      baseRef: options.baseRef,
      baseRevision,
      candidateRevision,
      candidateDirty,
      nodeVersion: process.version,
      trials: options.trials,
      warmups: options.warmups,
      interleaveOrder: 'balanced-alternating',
      baseTrials: Object.freeze(baseTrials),
      candidateTrials: Object.freeze(candidateTrials),
      comparison,
    })
    const jsonPath = join(runDirectory, 'comparison.json')
    const markdownPath = join(runDirectory, 'comparison.md')
    await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`)
    await writeFile(markdownPath, markdownReport(report))
    console.log(
      `${comparison.verdict.toUpperCase()}: speed ${comparison.speed.medianDeltaPercent.toFixed(2)}%, peak RSS ${comparison.memory.medianDeltaPercent.toFixed(2)}%.`,
    )
    console.log(`JSON: ${relative(repositoryDirectory, jsonPath)}`)
    console.log(`Markdown: ${relative(repositoryDirectory, markdownPath)}`)
    process.exitCode = comparison.exitCode
  } finally {
    if (worktreeCreated) {
      const cleanup = await runCommand('git', ['worktree', 'remove', '--force', baseDirectory], {
        cwd: repositoryDirectory,
      })
      if (cleanup.code !== 0) {
        process.stderr.write(`Could not remove temporary worktree: ${cleanup.stderr}\n`)
        if (process.exitCode === undefined || process.exitCode === 0) process.exitCode = 2
      }
    }
  }
}

try {
  await main()
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`Hillclimb failed: ${message}\n`)
  process.exitCode = error instanceof HillclimbRunError ? error.exitCode : 2
}
