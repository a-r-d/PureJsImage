import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { arch, cpus, hostname, platform, release, tmpdir, totalmem } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  readStableCodecCapabilities,
  type StableCodecFixture,
  type StableCodecPlan,
  type StableFixtureSize,
  stableCodecProfile,
} from '../profiles.ts'

interface WorkerValidation {
  readonly dimensions: boolean
  readonly format: boolean
  readonly output: boolean
  readonly passed: boolean
  readonly sampleOrPixelHash: string
}

interface WorkerResult {
  readonly codec: string
  readonly fixture: string
  readonly operation: Operation
  readonly maximumRssBytes: number
  readonly validation: WorkerValidation
  readonly outputBytes?: number
  readonly outputSha256?: string
  readonly wallMilliseconds: number
}

type Operation =
  | 'import'
  | 'detect'
  | 'inspect'
  | 'decode'
  | 'region'
  | 'convert'
  | 'encode'
  | 'encode-stream'
type ResultStatus =
  | 'supported'
  | 'missing-fixture'
  | 'invalid-output'
  | 'error'
  | 'not-applicable'
  | 'no-quality-oracle'
  | 'unstable'

interface QualityResult {
  readonly exact: boolean
  readonly oracle: string
  readonly psnrDb: number | 'exact'
}

interface CaseResult {
  readonly codec: string
  readonly fixture: string
  readonly fixtureSize: StableFixtureSize
  readonly operation: Operation
  readonly variant?: string
  readonly status: ResultStatus
  readonly statusReason?: string
  readonly runs: number
  readonly warmups: number
  readonly medianWallMilliseconds: number | null
  readonly p95WallMilliseconds: number | null
  readonly coefficientOfVariation: number | null
  readonly medianMaximumRssBytes: number | null
  readonly outputSha256?: string
  readonly sampleOrPixelHash?: string
  readonly quality?: QualityResult
}

interface EnvironmentIdentity {
  readonly architecture: string
  readonly cpuModel: string
  readonly host: string
  readonly kernel: string
  readonly logicalCpus: number
  readonly memoryBytes: number
  readonly node: string
  readonly os: string
  readonly processIsolation: boolean
  readonly runner: 'github-hosted' | 'self-hosted' | 'local'
  readonly v8: string
  readonly virtualization: boolean | null
  readonly fixtureCachePolicy: string
  readonly runs: number
  readonly warmups: number
}

const repositoryDirectory = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const workerPath = join(repositoryDirectory, 'benchmark/stable-codecs/worker.ts')
const resultsDirectory = join(repositoryDirectory, 'benchmark/results')

const argument = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}

const integerArgument = (name: string, fallback: number): number => {
  const value = argument(name)
  const parsed = value === undefined ? fallback : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0)
    throw new Error(`--${name} must be a non-negative integer`)
  return parsed
}

const median = (values: readonly number[]): number | null => {
  if (values.length === 0) return null
  const ordered = [...values].sort((left, right) => left - right)
  return ordered[Math.floor(ordered.length / 2)] ?? null
}

const percentile95 = (values: readonly number[]): number | null => {
  if (values.length === 0) return null
  const ordered = [...values].sort((left, right) => left - right)
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * 0.95) - 1)] ?? null
}

const coefficientOfVariation = (values: readonly number[]): number | null => {
  if (values.length < 2) return null
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  if (mean === 0) return 0
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length
  return Math.sqrt(variance) / mean
}

const timestamp = (): string => new Date().toISOString().replaceAll(/[:.]/gu, '-')

const gitRevision = (): string => {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repositoryDirectory,
      encoding: 'utf8',
    }).trim()
  } catch {
    return 'unknown'
  }
}

const gitDirty = (): boolean => {
  try {
    return (
      execFileSync('git', ['status', '--short'], {
        cwd: repositoryDirectory,
        encoding: 'utf8',
      }).trim().length > 0
    )
  } catch {
    return true
  }
}

const virtualization = async (): Promise<boolean | null> => {
  try {
    const product = (await readFile('/sys/class/dmi/id/product_name', 'utf8')).toLowerCase()
    return /kvm|virtual|vmware|qemu|hyper-v|xen/u.test(product)
  } catch {
    return null
  }
}

const runner = (): EnvironmentIdentity['runner'] => {
  if (process.env.GITHUB_ACTIONS !== 'true') return 'local'
  return process.env.RUNNER_ENVIRONMENT === 'self-hosted' ? 'self-hosted' : 'github-hosted'
}

const environment = async (runs: number, warmups: number): Promise<EnvironmentIdentity> => ({
  architecture: arch(),
  cpuModel: cpus()[0]?.model ?? 'unknown',
  host: hostname(),
  kernel: release(),
  logicalCpus: cpus().length,
  memoryBytes: totalmem(),
  node: process.version,
  os: `${platform()} ${release()}`,
  processIsolation: true,
  runner: runner(),
  v8: process.versions.v8,
  virtualization: await virtualization(),
  fixtureCachePolicy:
    'Each isolated worker reads the pinned fixture before the timed operation; no decoded cache is shared between samples.',
  runs,
  warmups,
})

const environmentFingerprint = (identity: EnvironmentIdentity): string =>
  createHash('sha256').update(JSON.stringify(identity)).digest('hex')

const fixturePath = (fixture: StableCodecFixture): string =>
  isAbsolute(fixture.path) ? fixture.path : join(repositoryDirectory, fixture.path)

const fixtureAvailable = async (fixture: StableCodecFixture): Promise<boolean> => {
  try {
    await access(fixturePath(fixture))
    return true
  } catch {
    return false
  }
}

const workerOutput = (value: string): WorkerResult => {
  const lines = value.trim().split('\n').reverse()
  for (const line of lines) {
    try {
      const parsed: unknown = JSON.parse(line)
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        'validation' in parsed &&
        'wallMilliseconds' in parsed
      ) {
        return parsed as WorkerResult
      }
    } catch {
      // Codec diagnostics may precede the final JSON line.
    }
  }
  throw new Error(`Stable codec worker produced no JSON result: ${value.slice(-1_000)}`)
}

const runWorker = async (
  plan: StableCodecPlan,
  fixture: StableCodecFixture,
  operation: Operation,
  variant: string | undefined,
  outputPath: string | undefined,
): Promise<WorkerResult> => {
  const commandArguments = [
    '--expose-gc',
    workerPath,
    '--codec',
    plan.id,
    '--fixture',
    fixturePath(fixture),
    '--operation',
    operation,
    '--width',
    String(fixture.width),
    '--height',
    String(fixture.height),
    ...(fixture.frame === undefined ? [] : ['--frame', String(fixture.frame)]),
    ...(variant === undefined ? [] : ['--variant', variant]),
    ...(outputPath === undefined ? [] : ['--output', outputPath]),
  ]
  const child = spawnSync(process.execPath, commandArguments, {
    cwd: repositoryDirectory,
    encoding: 'utf8',
    maxBuffer: 4 * 1_024 * 1_024,
    timeout: 300_000,
  })
  if (child.error) throw child.error
  if (child.status !== 0) {
    throw new Error(
      `${plan.id}/${fixture.id}/${operation} exited ${child.status}: ${child.stderr.trim()}`,
    )
  }
  return workerOutput(child.stdout)
}

const regionCapable = new Set([
  'jpeg',
  'bmp',
  'tiff',
  'ico',
  'jpeg2000',
  'jpegxl',
  'hdr',
  'netpbm',
  'tga',
])
const encodeVariants = (plan: StableCodecPlan): readonly (string | undefined)[] => {
  if (plan.write === 'unsupported') return []
  if (plan.id === 'netpbm') return ['ppm', 'pfm', 'pam']
  return [undefined]
}

const losslessFixture = (plan: StableCodecPlan, fixture: StableCodecFixture): boolean =>
  plan.id === 'png' ||
  plan.id === 'bmp' ||
  plan.id === 'gif' ||
  plan.id === 'tiff' ||
  plan.id === 'ico' ||
  plan.id === 'jpeg2000' ||
  plan.id === 'jpegxl' ||
  plan.id === 'hdr' ||
  plan.id === 'qoi' ||
  plan.id === 'netpbm' ||
  plan.id === 'tga' ||
  (plan.id === 'webp' && fixture.id.includes('lossless')) ||
  (plan.id === 'avif' && fixture.id.includes('lossless'))

const qualityRequired = (
  plan: StableCodecPlan,
  fixture: StableCodecFixture,
  operation: Operation,
): boolean =>
  !losslessFixture(plan, fixture) &&
  plan.lossiness === 'independent-oracle' &&
  (operation === 'convert' || operation === 'encode' || operation === 'encode-stream')

const runCase = async (
  plan: StableCodecPlan,
  fixture: StableCodecFixture,
  operation: Operation,
  variant: string | undefined,
  runs: number,
  warmups: number,
  temporaryDirectory: string,
): Promise<CaseResult> => {
  if (!(await fixtureAvailable(fixture))) {
    return {
      codec: plan.id,
      fixture: fixture.id,
      fixtureSize: fixture.size,
      operation,
      ...(variant === undefined ? {} : { variant }),
      status: 'missing-fixture',
      statusReason: fixturePath(fixture),
      runs: 0,
      warmups: 0,
      medianWallMilliseconds: null,
      p95WallMilliseconds: null,
      coefficientOfVariation: null,
      medianMaximumRssBytes: null,
    }
  }
  for (let warmup = 0; warmup < warmups; warmup += 1) {
    try {
      await runWorker(plan, fixture, operation, variant, undefined)
    } catch (error: unknown) {
      return {
        codec: plan.id,
        fixture: fixture.id,
        fixtureSize: fixture.size,
        operation,
        ...(variant === undefined ? {} : { variant }),
        status: 'error',
        statusReason: error instanceof Error ? error.message : String(error),
        runs: 0,
        warmups,
        medianWallMilliseconds: null,
        p95WallMilliseconds: null,
        coefficientOfVariation: null,
        medianMaximumRssBytes: null,
      }
    }
  }
  const results: WorkerResult[] = []
  let targetRuns = runs
  let quality: QualityResult | undefined
  for (;;) {
    for (let run = results.length; run < targetRuns; run += 1) {
      const outputPath =
        operation === 'convert' || operation === 'encode' || operation === 'encode-stream'
          ? join(
              temporaryDirectory,
              `${plan.id}-${fixture.id}-${operation}-${variant ?? 'default'}-${run}.bin`,
            )
          : undefined
      try {
        const result = await runWorker(plan, fixture, operation, variant, outputPath)
        results.push(result)
        if (!result.validation.passed) {
          return {
            codec: plan.id,
            fixture: fixture.id,
            fixtureSize: fixture.size,
            operation,
            ...(variant === undefined ? {} : { variant }),
            status: 'invalid-output',
            statusReason: JSON.stringify(result.validation),
            runs: results.length,
            warmups,
            medianWallMilliseconds: median(results.map(({ wallMilliseconds }) => wallMilliseconds)),
            p95WallMilliseconds: percentile95(
              results.map(({ wallMilliseconds }) => wallMilliseconds),
            ),
            coefficientOfVariation: coefficientOfVariation(
              results.map(({ wallMilliseconds }) => wallMilliseconds),
            ),
            medianMaximumRssBytes: median(results.map(({ maximumRssBytes }) => maximumRssBytes)),
          }
        }
        if (
          outputPath !== undefined &&
          qualityRequired(plan, fixture, operation) &&
          quality === undefined
        ) {
          try {
            const { measureIndependentQuality } = await import('./quality.ts')
            quality = await measureIndependentQuality(
              new Uint8Array(await readFile(fixturePath(fixture))),
              new Uint8Array(await readFile(outputPath)),
            )
          } catch (error: unknown) {
            const reason = error instanceof Error ? error.message : String(error)
            return {
              codec: plan.id,
              fixture: fixture.id,
              fixtureSize: fixture.size,
              operation,
              ...(variant === undefined ? {} : { variant }),
              status: 'no-quality-oracle',
              statusReason: reason,
              runs: results.length,
              warmups,
              medianWallMilliseconds: median(
                results.map(({ wallMilliseconds }) => wallMilliseconds),
              ),
              p95WallMilliseconds: percentile95(
                results.map(({ wallMilliseconds }) => wallMilliseconds),
              ),
              coefficientOfVariation: coefficientOfVariation(
                results.map(({ wallMilliseconds }) => wallMilliseconds),
              ),
              medianMaximumRssBytes: median(results.map(({ maximumRssBytes }) => maximumRssBytes)),
            }
          }
        }
      } catch (error: unknown) {
        return {
          codec: plan.id,
          fixture: fixture.id,
          fixtureSize: fixture.size,
          operation,
          ...(variant === undefined ? {} : { variant }),
          status: 'error',
          statusReason: error instanceof Error ? error.message : String(error),
          runs: results.length,
          warmups,
          medianWallMilliseconds: median(results.map(({ wallMilliseconds }) => wallMilliseconds)),
          p95WallMilliseconds: percentile95(
            results.map(({ wallMilliseconds }) => wallMilliseconds),
          ),
          coefficientOfVariation: coefficientOfVariation(
            results.map(({ wallMilliseconds }) => wallMilliseconds),
          ),
          medianMaximumRssBytes: median(results.map(({ maximumRssBytes }) => maximumRssBytes)),
        }
      }
    }
    const times = results.map(({ wallMilliseconds }) => wallMilliseconds)
    const cv = coefficientOfVariation(times) ?? 0
    if (cv <= 0.15 || targetRuns >= 9) {
      const hashes = new Set(results.map(({ validation }) => validation.sampleOrPixelHash))
      const outputHashes = new Set(
        results
          .map(({ outputSha256: hash }) => hash)
          .filter((hash): hash is string => hash !== undefined),
      )
      const exactHashRequired = losslessFixture(plan, fixture)
      const stable = !exactHashRequired || hashes.size === 1
      const stableOutputHash = outputHashes.size === 1 ? [...outputHashes][0] : undefined
      const stableSampleHash = hashes.size === 1 ? [...hashes][0] : undefined
      return {
        codec: plan.id,
        fixture: fixture.id,
        fixtureSize: fixture.size,
        operation,
        ...(variant === undefined ? {} : { variant }),
        status: stable ? 'supported' : 'unstable',
        ...(stable
          ? {}
          : { statusReason: 'Lossless sample/pixel hash changed between isolated runs.' }),
        runs: results.length,
        warmups,
        medianWallMilliseconds: median(times),
        p95WallMilliseconds: percentile95(times),
        coefficientOfVariation: cv,
        medianMaximumRssBytes: median(results.map(({ maximumRssBytes }) => maximumRssBytes)),
        ...(stableOutputHash === undefined ? {} : { outputSha256: stableOutputHash }),
        ...(stableSampleHash === undefined ? {} : { sampleOrPixelHash: stableSampleHash }),
        ...(quality === undefined ? {} : { quality }),
      }
    }
    targetRuns = 9
  }
}

const operationsFor = (
  plan: StableCodecPlan,
  fixture: StableCodecFixture,
): readonly { readonly operation: Operation; readonly variant?: string }[] => {
  const operations: { readonly operation: Operation; readonly variant?: string }[] = [
    { operation: 'import' },
    { operation: 'detect' },
    { operation: 'inspect' },
    { operation: 'decode' },
  ]
  if (regionCapable.has(plan.id)) operations.push({ operation: 'region' })
  operations.push({ operation: 'convert' })
  for (const variant of encodeVariants(plan)) {
    if (plan.id === 'tiff' && fixture.id === 'libtiff-lzw-single-strip') continue
    operations.push({ operation: 'encode', ...(variant === undefined ? {} : { variant }) })
    if (plan.id === 'tiff')
      operations.push({ operation: 'encode-stream', ...(variant === undefined ? {} : { variant }) })
  }
  return operations
}

const renderMarkdown = (
  report: Readonly<Record<string, unknown>>,
  results: readonly CaseResult[],
): string => {
  const environment = report.environment as EnvironmentIdentity
  const lines = [
    '# Stable codec baseline benchmark',
    '',
    `- Profile: ${String(report.profile)}`,
    `- Date: ${String(report.createdAt)}`,
    `- Commit: ${String(report.commit)}${report.dirty === true ? ' (dirty)' : ''}`,
    `- Environment fingerprint: ${String(report.environmentFingerprint)}`,
    `- Fixture manifest hash: ${String(report.fixtureManifestHash)}`,
    `- Environment: ${environment.cpuModel}; ${environment.os}; Node ${environment.node}; V8 ${environment.v8}; ${environment.memoryBytes} bytes RAM`,
    `- Runner: ${environment.runner}; process isolation=${environment.processIsolation}; virtualization=${environment.virtualization === null ? 'unknown' : environment.virtualization ? 'yes' : 'no'}`,
    `- Runs/warmups: ${environment.runs}/${environment.warmups}; cache policy: ${environment.fixtureCachePolicy}`,
    '',
    '| Codec | Fixture | Size | Operation | Variant | Status | Median ms | P95 ms | CV | Median RSS | Validation | Quality |',
    '| --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- |',
  ]
  for (const result of results) {
    const quality =
      result.quality?.psnrDb === undefined
        ? '—'
        : result.quality.psnrDb === 'exact'
          ? 'exact'
          : `${result.quality.psnrDb.toFixed(2)} dB`
    lines.push(
      `| ${result.codec} | ${result.fixture} | ${result.fixtureSize} | ${result.operation} | ${result.variant ?? '—'} | ${result.status} | ${result.medianWallMilliseconds?.toFixed(3) ?? '—'} | ${result.p95WallMilliseconds?.toFixed(3) ?? '—'} | ${result.coefficientOfVariation === null ? '—' : `${(result.coefficientOfVariation * 100).toFixed(1)}%`} | ${result.medianMaximumRssBytes === null ? '—' : `${Math.round(result.medianMaximumRssBytes / 1_024 / 1_024)} MiB`} | ${result.sampleOrPixelHash ?? '—'} | ${quality} |`,
    )
  }
  lines.push(
    '',
    'The baseline is PureJsImage versus prior PureJsImage results. It is not a cross-library competitor table. Rows with invalid output, missing fixtures, unavailable quality oracles, unstable lossless hashes, or noisy samples are excluded from documentation headlines.',
    '',
  )
  return lines.join('\n')
}

const main = async (): Promise<void> => {
  const runs = Math.max(1, integerArgument('runs', 3))
  const warmups = integerArgument('warmups', 1)
  const capabilityBytes = new Uint8Array(
    await readFile(join(repositoryDirectory, 'capabilities/manifest.json')),
  )
  const corpusBytes = new Uint8Array(
    await readFile(join(repositoryDirectory, 'benchmark/corpus/manifest.json')),
  )
  const capabilities = readStableCodecCapabilities(
    JSON.parse(new TextDecoder().decode(capabilityBytes)) as unknown,
  )
  const plans = stableCodecProfile(capabilities)
  const selectedCodec = argument('codec')
  const selectedPlans =
    selectedCodec === undefined ? plans : plans.filter(({ id }) => id === selectedCodec)
  if (selectedPlans.length === 0) throw new Error(`Unknown stable codec: ${selectedCodec}`)
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'purejsimage-stable-codecs-'))
  const results: CaseResult[] = []
  try {
    for (const plan of selectedPlans) {
      if (plan.fixtures.length === 0) {
        results.push({
          codec: plan.id,
          fixture: 'manifest-fixture-missing',
          fixtureSize: 'small',
          operation: 'inspect',
          status: 'missing-fixture',
          statusReason:
            'The capability manifest names a stable codec but the baseline fixture map has no representative fixture.',
          runs: 0,
          warmups: 0,
          medianWallMilliseconds: null,
          p95WallMilliseconds: null,
          coefficientOfVariation: null,
          medianMaximumRssBytes: null,
        })
        continue
      }
      for (const fixture of plan.fixtures) {
        for (const { operation, variant } of operationsFor(plan, fixture)) {
          console.log(
            `Running ${plan.id}/${fixture.id}/${operation}${variant === undefined ? '' : `/${variant}`}`,
          )
          results.push(
            await runCase(plan, fixture, operation, variant, runs, warmups, temporaryDirectory),
          )
        }
      }
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
  const identity = await environment(runs, warmups)
  const createdAt = new Date().toISOString()
  const fixtureManifestHash = createHash('sha256')
    .update(capabilityBytes)
    .update(corpusBytes)
    .digest('hex')
  const validationPassed = results.every(
    ({ status }) => status === 'supported' || status === 'not-applicable',
  )
  const headlineEligible =
    validationPassed &&
    results.every(
      ({ coefficientOfVariation }) =>
        coefficientOfVariation === null || coefficientOfVariation <= 0.15,
    )
  const report = {
    schemaVersion: 1,
    profile: 'stable-codecs',
    createdAt,
    commit: gitRevision(),
    dirty: gitDirty(),
    environment: identity,
    environmentFingerprint: environmentFingerprint(identity),
    fixtureManifestHash,
    engineVersions: { purejsimage: 'package-local first-party TypeScript' },
    capabilities: capabilities.map(({ id, packageFormat, read, write, lossiness }) => ({
      id,
      packageFormat,
      read,
      write,
      lossiness,
    })),
    configuration: {
      runs,
      warmups,
      adaptiveNoiseThreshold: 0.15,
      maximumRuns: 9,
      isolatedProcessPerSample: true,
      validationBeforeAdmission: true,
      ordinaryCompetitorProfilePreserved: true,
      experimentalHeifProfileSeparate: true,
    },
    validation: {
      passed: validationPassed,
      successfulRows: results.filter(({ status }) => status === 'supported').length,
      failedRows: results.filter(({ status }) => !['supported', 'not-applicable'].includes(status))
        .length,
      statuses: [...new Set(results.map(({ status }) => status))],
    },
    eligibleForDocumentationHeadlines: headlineEligible,
    results,
  }
  const requestedOutput = argument('output')
  const stem = requestedOutput?.replace(/\.(?:json|md)$/u, '')
  const jsonPath =
    stem === undefined
      ? join(resultsDirectory, `stable-codecs-${timestamp()}.json`)
      : isAbsolute(stem)
        ? `${stem}.json`
        : join(repositoryDirectory, `${stem}.json`)
  const markdownPath = jsonPath.replace(/\.json$/u, '.md')
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`)
  await writeFile(markdownPath, renderMarkdown(report, results))
  console.log(`Wrote ${jsonPath}`)
  console.log(`Wrote ${markdownPath}`)
}

await main()
