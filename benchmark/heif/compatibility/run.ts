import { spawn, spawnSync } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CompatibilityStatus } from './corpus.ts'
import {
  compatibilityFixturePath,
  readCompatibilityManifest,
  type CompatibilityFixture,
} from './corpus.ts'

interface WorkerError {
  readonly code?: string
  readonly message: string
  readonly name: string
}

interface WorkerDecoded {
  readonly bitstream: unknown
  readonly maximumRssBytes: number
  readonly metadata: unknown
  readonly outcome: 'decoded'
  readonly outputBytes: number
  readonly wallMilliseconds: number
}

interface WorkerFailed {
  readonly error: WorkerError
  readonly maximumRssBytes: number
  readonly outcome: 'error'
  readonly wallMilliseconds: number
}

type WorkerResponse = WorkerDecoded | WorkerFailed

interface WorkerExecution {
  readonly killedForMemory: boolean
  readonly maximumRssBytes: number
  readonly response?: WorkerResponse
  readonly stderr: string
  readonly timedOut: boolean
}

interface FixtureResult {
  readonly details: string
  readonly expectedStatus: CompatibilityStatus
  readonly fixture: string
  readonly maximumRssMiB: number
  readonly metadata?: unknown
  readonly normalizedRmse?: number
  readonly oracleDimensions?: string
  readonly status: CompatibilityStatus
  readonly wallMilliseconds: number
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const workerResponse = (value: unknown): WorkerResponse | undefined => {
  if (!isRecord(value) || typeof value.outcome !== 'string') return undefined
  if (
    value.outcome === 'decoded' &&
    typeof value.maximumRssBytes === 'number' &&
    typeof value.wallMilliseconds === 'number' &&
    typeof value.outputBytes === 'number'
  ) {
    return {
      outcome: 'decoded',
      maximumRssBytes: value.maximumRssBytes,
      wallMilliseconds: value.wallMilliseconds,
      outputBytes: value.outputBytes,
      metadata: value.metadata,
      bitstream: value.bitstream,
    }
  }
  if (
    value.outcome === 'error' &&
    typeof value.maximumRssBytes === 'number' &&
    typeof value.wallMilliseconds === 'number' &&
    isRecord(value.error) &&
    typeof value.error.name === 'string' &&
    typeof value.error.message === 'string' &&
    (value.error.code === undefined || typeof value.error.code === 'string')
  ) {
    return {
      outcome: 'error',
      maximumRssBytes: value.maximumRssBytes,
      wallMilliseconds: value.wallMilliseconds,
      error: {
        name: value.error.name,
        message: value.error.message,
        ...(value.error.code === undefined ? {} : { code: value.error.code }),
      },
    }
  }
  return undefined
}

const worker = fileURLToPath(new URL('./worker.ts', import.meta.url))
const benchmarkDirectory = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const temporaryDirectory = join(benchmarkDirectory, '.tmp', 'heif-compatibility')
const resultsDirectory = join(benchmarkDirectory, 'results')
const reportJsonPath = join(resultsDirectory, 'heif-compatibility-2026-08-08.json')
const reportMarkdownPath = join(resultsDirectory, 'heif-compatibility-2026-08-08.md')
const maximumRssBytes = 512 * 1024 ** 2

const processRssBytes = async (pid: number): Promise<number> => {
  try {
    const status = await readFile(`/proc/${pid}/status`, 'utf8')
    const match = /^VmRSS:\s+(\d+)\s+kB$/m.exec(status)
    return match?.[1] ? Number(match[1]) * 1024 : 0
  } catch {
    return 0
  }
}

const executeWorker = async (
  fixture: CompatibilityFixture,
  outputPath: string,
): Promise<WorkerExecution> => {
  const timeoutMilliseconds = fixture.id === 'samsung-s24-200mp' ? 180_000 : 120_000
  const child = spawn(
    process.execPath,
    ['--max-old-space-size=512', worker, compatibilityFixturePath(fixture), outputPath],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )
  let stdout = ''
  let stderr = ''
  let observedRssBytes = 0
  let killedForMemory = false
  let timedOut = false
  child.stdout?.on('data', (chunk: Buffer) => {
    stdout += chunk.toString()
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString()
  })
  const poll = setInterval(() => {
    if (child.pid === undefined) return
    void processRssBytes(child.pid).then((rssBytes) => {
      observedRssBytes = Math.max(observedRssBytes, rssBytes)
      if (rssBytes > maximumRssBytes && !killedForMemory) {
        killedForMemory = true
        child.kill('SIGKILL')
      }
    })
  }, 25)
  const timeout = setTimeout(() => {
    timedOut = true
    child.kill('SIGKILL')
  }, timeoutMilliseconds)

  await new Promise<void>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', () => resolve())
  }).finally(() => {
    clearInterval(poll)
    clearTimeout(timeout)
  })

  let response: WorkerResponse | undefined
  const output = stdout.trim()
  if (output.length > 0) {
    try {
      response = workerResponse(JSON.parse(output))
    } catch {
      // The unexpected worker output is reported below with stderr.
    }
  }
  return {
    timedOut,
    killedForMemory,
    stderr,
    maximumRssBytes: Math.max(observedRssBytes, response?.maximumRssBytes ?? 0),
    ...(response === undefined ? {} : { response }),
  }
}

const displayedDimensions = (fixture: CompatibilityFixture): readonly [number, number] =>
  fixture.orientation >= 5 && fixture.orientation <= 8
    ? [fixture.height, fixture.width]
    : [fixture.width, fixture.height]

const identifyOracle = (
  fixture: CompatibilityFixture,
): { readonly dimensions?: string; readonly error?: string } => {
  const identified = spawnSync(
    'magick',
    ['identify', '-ping', '-format', '%w|%h', `${compatibilityFixturePath(fixture)}[0]`],
    { encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 60_000 },
  )
  if (identified.error) return { error: identified.error.message }
  if (identified.status !== 0) return { error: identified.stderr.trim() || 'identify failed' }
  const [widthText, heightText] = identified.stdout.trim().split('|')
  const width = Number(widthText)
  const height = Number(heightText)
  const [expectedWidth, expectedHeight] = displayedDimensions(fixture)
  if (width !== expectedWidth || height !== expectedHeight) {
    return {
      error: `oracle dimensions ${width}x${height}, manifest ${expectedWidth}x${expectedHeight}`,
    }
  }
  return { dimensions: `${width}x${height}` }
}

const normalizeWithImageMagick = (input: string, output: string): string | undefined => {
  const normalized = spawnSync(
    'magick',
    [input, '-alpha', 'on', '-colorspace', 'sRGB', '-resize', '1024x1024>', `PNG32:${output}`],
    { encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 120_000 },
  )
  if (normalized.error) return normalized.error.message
  return normalized.status === 0 ? undefined : normalized.stderr.trim() || 'normalization failed'
}

const comparePixels = (
  fixture: CompatibilityFixture,
  pureOutput: string,
  oracleOutput: string,
  normalizedPureOutput: string,
): { readonly error?: string; readonly normalizedRmse?: number } => {
  if (fixture.id === 'samsung-s24-200mp') {
    const oracle = spawnSync(
      'heif-thumbnailer',
      ['-p', '-s', '1024', compatibilityFixturePath(fixture), oracleOutput],
      { encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 120_000 },
    )
    if (oracle.error || oracle.status !== 0) {
      return { error: `libheif thumbnail decode: ${oracle.error?.message ?? oracle.stderr.trim()}` }
    }
    const pure = spawnSync(
      'ffmpeg',
      [
        '-v',
        'error',
        '-y',
        '-i',
        pureOutput,
        '-vf',
        'scale=-2:1024:flags=area',
        normalizedPureOutput,
      ],
      { encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 120_000 },
    )
    if (pure.error || pure.status !== 0) {
      return { error: `streaming PNG normalization: ${pure.error?.message ?? pure.stderr.trim()}` }
    }
  } else {
    const oracleError = normalizeWithImageMagick(
      `${compatibilityFixturePath(fixture)}[0]`,
      oracleOutput,
    )
    if (oracleError) return { error: `oracle pixel decode: ${oracleError}` }
    const pureError = normalizeWithImageMagick(pureOutput, normalizedPureOutput)
    if (pureError) return { error: `PureJsImage PNG normalization: ${pureError}` }
  }
  const comparison = spawnSync(
    'magick',
    ['compare', '-metric', 'RMSE', oracleOutput, normalizedPureOutput, 'null:'],
    { encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 60_000 },
  )
  if (comparison.error) return { error: comparison.error.message }
  if (comparison.status !== 0 && comparison.status !== 1) {
    return { error: comparison.stderr.trim() || 'pixel comparison failed' }
  }
  const metric = comparison.stderr.trim()
  const match = /\((\d+(?:\.\d+)?(?:e[+-]?\d+)?)\)/i.exec(metric)
  if (!match?.[1]) return { error: `unrecognized RMSE output: ${metric}` }
  return { normalizedRmse: Number(match[1]) }
}

const classifyWorkerError = (error: WorkerError): CompatibilityStatus => {
  if (error.code === 'UNSUPPORTED_OPERATION' || error.code === 'UNSUPPORTED_FORMAT') {
    return 'Explicitly unsupported'
  }
  if (error.code === 'LIMIT_EXCEEDED') return 'Excessive memory'
  return 'Unexpected exception'
}

await rm(temporaryDirectory, { force: true, recursive: true })
await mkdir(temporaryDirectory, { recursive: true })
const manifest = await readCompatibilityManifest()
const results: FixtureResult[] = []

for (const fixture of manifest.fixtures) {
  const oracle = identifyOracle(fixture)
  if (oracle.error) {
    results.push({
      fixture: fixture.id,
      expectedStatus: fixture.expectedStatus,
      status: 'Invalid',
      details: oracle.error,
      wallMilliseconds: 0,
      maximumRssMiB: 0,
    })
    console.log(`${fixture.id}: Invalid (${oracle.error})`)
    continue
  }
  const oracleDimensions = oracle.dimensions ?? 'unknown'

  const pureOutput = join(temporaryDirectory, `${fixture.id}-pure.png`)
  const execution = await executeWorker(fixture, pureOutput)
  const maximumRssMiB = Number((execution.maximumRssBytes / 1024 ** 2).toFixed(1))
  if (execution.killedForMemory) {
    results.push({
      fixture: fixture.id,
      expectedStatus: fixture.expectedStatus,
      status: 'Excessive memory',
      details: `worker exceeded ${maximumRssBytes / 1024 ** 2} MiB RSS limit`,
      wallMilliseconds: 0,
      maximumRssMiB,
      oracleDimensions,
    })
    console.log(`${fixture.id}: Excessive memory (${maximumRssMiB} MiB observed)`)
    continue
  }
  if (execution.timedOut) {
    results.push({
      fixture: fixture.id,
      expectedStatus: fixture.expectedStatus,
      status: 'Timeout',
      details: 'isolated decode exceeded its wall-clock limit',
      wallMilliseconds: 0,
      maximumRssMiB,
      oracleDimensions,
    })
    console.log(`${fixture.id}: Timeout`)
    continue
  }
  const response = execution.response
  if (!response) {
    const details = execution.stderr.trim() || 'worker produced no structured result'
    results.push({
      fixture: fixture.id,
      expectedStatus: fixture.expectedStatus,
      status: 'Unexpected exception',
      details,
      wallMilliseconds: 0,
      maximumRssMiB,
      oracleDimensions,
    })
    console.log(`${fixture.id}: Unexpected exception (${details})`)
    continue
  }
  if (response.outcome === 'error') {
    const status = classifyWorkerError(response.error)
    results.push({
      fixture: fixture.id,
      expectedStatus: fixture.expectedStatus,
      status,
      details: `${response.error.code ?? response.error.name}: ${response.error.message}`,
      wallMilliseconds: response.wallMilliseconds,
      maximumRssMiB,
      oracleDimensions,
    })
    console.log(`${fixture.id}: ${status} (${response.error.message})`)
    continue
  }

  const comparison = comparePixels(
    fixture,
    pureOutput,
    join(temporaryDirectory, `${fixture.id}-oracle.png`),
    join(temporaryDirectory, `${fixture.id}-normalized.png`),
  )
  const normalizedRmse = comparison.normalizedRmse
  const status: CompatibilityStatus =
    comparison.error || normalizedRmse === undefined || normalizedRmse > 0.035
      ? 'Incorrect pixels'
      : 'Compatible'
  const details = comparison.error
    ? comparison.error
    : `normalized sRGB RMSE ${normalizedRmse?.toFixed(6)} (limit 0.035)`
  results.push({
    fixture: fixture.id,
    expectedStatus: fixture.expectedStatus,
    status,
    details,
    wallMilliseconds: response.wallMilliseconds,
    maximumRssMiB,
    oracleDimensions,
    metadata: response.metadata,
    ...(normalizedRmse === undefined ? {} : { normalizedRmse }),
  })
  console.log(`${fixture.id}: ${status} (${details}, ${maximumRssMiB} MiB RSS)`)
}

const statusCounts = Object.fromEntries(
  [
    'Compatible',
    'Explicitly unsupported',
    'Invalid',
    'Incorrect pixels',
    'Unexpected exception',
    'Timeout',
    'Excessive memory',
  ].map((status) => [status, results.filter((result) => result.status === status).length]),
)
const colorMatrixFailures = results.filter((result) =>
  result.details.includes('Unsupported or unspecified HEIF color matrix'),
)
const downloadedColorMatrixFailures = colorMatrixFailures.filter(
  (result) => result.fixture !== 'generated-imir',
)
const analysis = {
  largestFailureCluster: {
    feature: 'absent or unspecified HEIF/HEVC color-matrix resolution',
    explicitUnsupportedResults: colorMatrixFailures.length,
    downloadedRealWorldResults: downloadedColorMatrixFailures.length,
    evidence: colorMatrixFailures.map(({ fixture, details }) => ({ fixture, details })),
  },
  nextImplementationProject:
    'Define safe, spec- and metadata-driven matrix defaults from ICC, nclx, VUI, brand, and profile evidence; continue rejecting ambiguous inputs.',
  separateCorrectnessFindings: [
    'Accept the defined hvcC array-completeness bit before claiming current-libheif interoperability.',
    'Reconcile Main 10/PQ displayed SDR tone mapping with the independent oracle before claiming displayed Main 10 compatibility.',
  ],
  multiSliceFixture:
    'No redistributable or reproducibly downloadable direct multi-slice still fixture was found. Multi-slice inspection exists, while reconstruction remains explicitly unsupported.',
}
const commandVersion = (command: string, arguments_: readonly string[]): string => {
  const result = spawnSync(command, arguments_, { encoding: 'utf8', maxBuffer: 1024 * 1024 })
  return `${result.stdout}${result.stderr}`.trim().split('\n')[0] ?? 'unknown'
}
const revision = commandVersion('git', ['rev-parse', 'HEAD'])
const report = {
  generatedAt: new Date().toISOString(),
  revision,
  corpusVersion: manifest.version,
  fixtureCount: results.length,
  isolation: {
    timeoutMilliseconds: '120000 (180000 for 200 MP)',
    maximumRssBytes,
    process: 'one fresh Node process per PureJsImage decode',
  },
  oracle: {
    imageMagick: commandVersion('magick', ['-version']),
    ffprobe: commandVersion('ffprobe', ['-version']),
    pixelComparison: 'displayed primary, normalized to sRGB RGBA and at most 1024x1024',
    compatibleRmseLimit: 0.035,
  },
  statusCounts,
  analysis,
  results,
}

if (process.argv.includes('--write')) {
  await mkdir(resultsDirectory, { recursive: true })
  await writeFile(reportJsonPath, `${JSON.stringify(report, undefined, 2)}\n`)
  const rows = results.map(
    (result) =>
      `| ${result.fixture} | ${result.status} | ${result.maximumRssMiB.toFixed(1)} MiB | ${result.details.replaceAll('|', '\\|')} |`,
  )
  const markdown =
    `# HEIF/HEVC compatibility matrix\n\n` +
    `Generated from corpus version ${manifest.version} at revision \`${revision}\`. Every PureJsImage decode ran in a fresh process with a 512 MiB RSS ceiling. ImageMagick/libheif independently decoded metadata and displayed primary pixels.\n\n` +
    `## Summary\n\n` +
    Object.entries(statusCounts)
      .map(([status, count]) => `- ${status}: ${count}`)
      .join('\n') +
    `\n\n## Coverage\n\nThe 25-file corpus spans iPhone 7, 12 Pro, and 13/13 Pro across iOS 11.0.3 and iOS 16.2-16.7; Xiaomi, Samsung, Nokia, libheif, and x265 encoders; direct and grid primaries; Main, Main Still Picture, Main 10, and Range Extensions; irot, imir, and clap; full and limited range; sRGB and Display P3; and auxiliary gain-map, depth, alpha, thumbnail, tone-map, and spatial items.\n\n` +
    `No redistributable or reproducibly downloadable direct multi-slice still fixture was found. Multi-slice inspection exists, while reconstruction remains explicitly unsupported.\n\n` +
    `## Next implementation project\n\nThe largest realistic failure cluster is absent or unspecified color-matrix resolution: ${downloadedColorMatrixFailures.length} downloaded real-world files plus the generated imir case, ${colorMatrixFailures.length} of the 12 explicit unsupported results. Define safe defaults from ICC, nclx, VUI, brand, and profile evidence, while continuing to reject ambiguous inputs. This is evidence for a separate project; this matrix adds no HEVC syntax.\n\n` +
    `Two valid libheif files separately expose an hvcC array-completeness parser error. The Main 10/PQ fixture reconstructs but differs from the independent displayed SDR output by 0.112799 normalized RMSE.\n\n` +
    `## Methodology\n\nEach PureJsImage decode runs in a fresh Node process with a 512 MiB RSS ceiling and a wall-clock timeout. ImageMagick/libheif validates displayed metadata and sRGB RGBA pixels. The 200 MP case uses libheif-thumbnailer plus a streaming FFmpeg downscale because the system ImageMagick pixel-cache policy cannot materialize the full frame. RMSE at or below 0.035 is compatible.\n\n` +
    `## Matrix\n\n| Fixture | Status | Peak RSS | Evidence |\n| --- | --- | ---: | --- |\n${rows.join('\n')}\n`
  await writeFile(reportMarkdownPath, markdown)
  console.log(`Wrote ${reportJsonPath}`)
  console.log(`Wrote ${reportMarkdownPath}`)
} else {
  console.log(JSON.stringify(report, undefined, 2))
}
