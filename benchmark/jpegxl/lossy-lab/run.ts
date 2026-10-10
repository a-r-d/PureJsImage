import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { object } from '../comparison/model.ts'
import {
  baselineSpeedPoints,
  type PreparedFixture,
  parseLabMode,
  parsePreparedManifest,
  selectPreparedFixtures,
  validateBaselineSpeedResume,
} from './fixture-selection.ts'
import { bdRate, type QualityMetric, summarizeBdRates } from './metrics.ts'
import {
  type CurvePoint,
  type Engine,
  curveMatches,
  missingSettings,
  parseCampaignEffort,
  parsePoint,
} from './model.ts'

const args = process.argv.slice(2)
const argument = (name: string, fallback: string): string => {
  const at = args.indexOf(name)
  return at === -1 ? fallback : (args[at + 1] ?? fallback)
}
const manifestPath = argument('--manifest', '.tmp/jpegxl-lossy-lab/corpus/manifest.json')
const directory = argument('--out', '.tmp/jpegxl-lossy-lab/baseline')
const mode = parseLabMode(argument('--mode', 'screen'))
const variant = argument('--variant', 'baseline')
const effort = parseCampaignEffort(argument('--effort', '7'), mode, args.includes('--promotion'))
const effortSevenReference = argument('--effort7-reference', '')
if (effort === 9 && !effortSevenReference) throw new Error('Effort 9 requires --effort7-reference')
const rgb = args.includes('--rgb')
const workers = Number(argument('--workers', '2'))
const budgetSeconds = Number(argument('--budget-seconds', mode === 'screen' ? '600' : '3600'))
if (
  !/^[a-z0-9-]+$/u.test(variant) ||
  !Number.isInteger(workers) ||
  workers < 1 ||
  workers > 4 ||
  !Number.isFinite(budgetSeconds) ||
  budgetSeconds <= 0
)
  throw new Error('Invalid lab mode, variant, worker count or budget')
if (mode === 'speed' && workers !== 1)
  throw new Error('Speed measurements require one isolated worker')
if (effort === 9 && workers !== 1)
  throw new Error('Effort 9 promotion comparison requires one isolated worker')
const resumeSpeed = args.includes('--resume-speed')
if (resumeSpeed && (mode !== 'speed' || variant !== 'baseline' || rgb))
  throw new Error('--resume-speed is only for baseline speed continuation')
if (args.includes('--resume-own') && variant !== 'baseline')
  throw new Error('Candidate performance measurements cannot reuse own results')
if (resumeSpeed)
  validateBaselineSpeedResume(JSON.parse(await readFile(join(directory, 'progress.json'), 'utf8')))
if (mode === 'holdout' && !args.includes('--promotion'))
  throw new Error('Holdout runs require --promotion')
if (mode === 'watch' && !args.includes('--promotion'))
  throw new Error('Full watch curves require --promotion')
const rawManifest = object(JSON.parse(await readFile(manifestPath, 'utf8')))
const manifest = parsePreparedManifest(rawManifest)
const watchManifestPath = argument('--watch-manifest', '')
const selection = selectPreparedFixtures(manifest, {
  mode,
  promotion: args.includes('--promotion'),
  only: argument('--only', ''),
  skipLarge: args.includes('--screen-skip-large'),
  ...(watchManifestPath
    ? {
        additionalWatch: parsePreparedManifest(
          JSON.parse(await readFile(watchManifestPath, 'utf8')),
        ),
        watchCount: Number(argument('--watch-count', '2')),
      }
    : {}),
})
const metrics: QualityMetric[] = ['ssimulacra2', 'butteraugliMax', 'butteraugliNorm3']
const qualityIntervals = {
  ssimulacra2: { minimum: 60, maximum: 90 },
  butteraugliMax: { minimum: 0.5, maximum: 3 },
  butteraugliNorm3: undefined,
}
const engines: Engine[] = ['purejsimage', 'jsquash', 'vips']
const comparisonPeers: readonly Engine[] =
  effort === 9 ? ['jsquash', 'vips', 'purejsimage'] : ['jsquash', 'vips']
const distances =
  mode === 'screen' || mode === 'scale'
    ? [0.5, 1, 2, 4, 7]
    : [0.45, 0.65, 0.9, 1.3, 1.85, 3, 3.8, 5.35, 7.5]
const peerSettings = {
  jsquash: [1, 10, 20, 40, 50, 60, 65, 70, 75, 80, 85, 88, 92, 95, 97, 99, 100],
  vips: [0.45, 0.65, 0.9, 1.3, 1.85, 3, 3.8, 5.35, 7.5],
}
type Fixture = PreparedFixture
const selected = selection.fixtures
await mkdir(directory, { recursive: true })
const started = Date.now()
const results = new Map<string, Map<Engine, CurvePoint[]>>()
const fixtureKey = (fixture: Fixture): string => `${fixture.id}:${fixture.kind}`
const failures: { id: string; engine: Engine; detail: string }[] =
  selection.preparationFailures.flatMap((failure) =>
    engines.map((engine) => ({ id: failure.id, engine, detail: `Preparation: ${failure.error}` })),
  )
for (const id of selection.missingRequestedIds)
  if (!selection.preparationFailures.some((failure) => failure.id === id))
    for (const engine of engines)
      failures.push({ id, engine, detail: 'Requested fixture missing from prepared manifest' })
const omissions: { id: string; engine: Engine; reason: string }[] = []
const comparisons: {
  id: string
  peer: Engine
  metric: QualityMetric
  percent: number
  coversRequiredRange: boolean
}[] = []

const jobs = selected.flatMap((fixture) => engines.map((engine) => ({ fixture, engine })))
let next = 0
let reusedSpeedJobs = 0
let measuredSpeedJobs = 0
let pendingLedger = Promise.resolve()
const ledger = async (): Promise<void> => {
  const text = `${JSON.stringify({ startedAt: new Date(started).toISOString(), mode, variant, effort, budgetSeconds, workers, resumedSpeed: resumeSpeed, reusedSpeedJobs, measuredSpeedJobs, selected: selected.length, totalJobs: jobs.length, completedJobs: [...results.values()].reduce((sum, row) => sum + row.size, 0), failures, omissions }, null, 2)}\n`
  pendingLedger = pendingLedger.then(() => writeFile(join(directory, 'progress.json'), text))
  await pendingLedger
}
await ledger()
async function runJob(fixture: Fixture, engine: Engine): Promise<void> {
  const engineEffort = engine === 'vips' ? 7 : effort
  const freshEffortNinePeer = effort === 9 && engine === 'jsquash'
  const settings =
    mode === 'speed'
      ? [engine === 'jsquash' ? 80 : 2]
      : engine === 'purejsimage'
        ? distances
        : peerSettings[engine]
  const resultDirectory =
    engine === 'purejsimage' || mode === 'speed' || freshEffortNinePeer
      ? join(directory, `${variant}-${engine}`, `${fixture.id}-${fixture.kind}`)
      : join(
          '.tmp/jpegxl-lossy-lab/peer-cache',
          `${engine === 'jsquash' ? 'jsquash-1.3.0' : 'vips-0.0.19'}-curve${engineEffort === 9 ? '-effort9' : ''}`,
          fixture.fixtureSha256,
        )
  const resultPath = join(resultDirectory, 'result.json')
  let cached: unknown = null
  if (
    resumeSpeed ||
    (mode !== 'speed' &&
      !freshEffortNinePeer &&
      (engine !== 'purejsimage' || args.includes('--resume-own')))
  ) {
    try {
      cached = JSON.parse(await readFile(resultPath, 'utf8'))
    } catch {
      /* Cache miss. */
    }
  }
  const cachedRow = cached === null || resumeSpeed ? null : object(cached)
  const resumedPoints = resumeSpeed
    ? baselineSpeedPoints(cached, fixture.fixtureSha256, engine)
    : []
  const sameFixture = resumeSpeed
    ? resumedPoints.length === 1
    : cachedRow !== null &&
      curveMatches(
        cachedRow,
        fixture.fixtureSha256,
        engine,
        engine === 'purejsimage' && rgb ? 3 : 4,
        engineEffort,
      )
  const cachedPoints = resumeSpeed
    ? resumedPoints
    : sameFixture && Array.isArray(cachedRow?.points)
      ? cachedRow.points.map(parsePoint)
      : []
  const missing = missingSettings(settings, cachedPoints)
  const cacheValid = sameFixture && missing.length === 0
  if (!cacheValid) {
    await mkdir(resultDirectory, { recursive: true })
    const remaining = budgetSeconds * 1000 - (Date.now() - started)
    if (remaining <= 0) {
      omissions.push({ id: fixture.id, engine, reason: 'Wall budget exhausted before job' })
      return
    }
    const output = await new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          '--experimental-strip-types',
          'benchmark/jpegxl/lossy-lab/worker.ts',
          engine,
          fixture.png,
          resultDirectory,
          missing.join(','),
          '--effort',
          String(engineEffort),
          ...(sameFixture ? ['--append'] : []),
          ...(engine === 'purejsimage' && rgb ? ['--rgb'] : []),
        ],
        { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, OMP_NUM_THREADS: '1' } },
      )
      let stderr = ''
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (text: string) => {
        stderr = (stderr + text).slice(-4096)
      })
      const timer = setTimeout(() => {
        child.kill('SIGTERM')
        setTimeout(() => child.kill('SIGKILL'), 5000).unref()
      }, remaining)
      child.once('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
      child.once('close', (code) => {
        clearTimeout(timer)
        resolve({ code, stderr })
      })
    })
    if (output.code !== 0)
      throw new Error(output.stderr || `Worker exited ${output.code}; inspect ${resultPath}`)
  }
  const row = object(JSON.parse(await readFile(resultPath, 'utf8')))
  if (
    !curveMatches(
      row,
      fixture.fixtureSha256,
      engine,
      engine === 'purejsimage' && rgb ? 3 : 4,
      engineEffort,
    ) ||
    !Array.isArray(row.points)
  )
    throw new Error('Worker fixture/result mismatch')
  const points = row.points.map(parsePoint).filter((point) => settings.includes(point.setting))
  if (mode === 'speed') {
    if (missingSettings(settings, points).length !== 0) throw new Error('Speed measurement missing')
    if (cacheValid) reusedSpeedJobs++
    else measuredSpeedJobs++
  }
  const key = fixtureKey(fixture)
  let entry = results.get(key)
  if (!entry) {
    entry = new Map()
    results.set(key, entry)
  }
  entry.set(engine, points)
  console.log(
    `${fixture.id} ${engine}: ${points.length}/${settings.length} points${cacheValid ? ' cached' : ''}`,
  )
}
async function workLoop(): Promise<void> {
  for (;;) {
    const job = jobs[next++]
    if (!job) return
    try {
      await runJob(job.fixture, job.engine)
    } catch (error) {
      failures.push({
        id: job.fixture.id,
        engine: job.engine,
        detail: error instanceof Error ? error.message : String(error),
      })
    }
    await ledger()
  }
}
await Promise.all(Array.from({ length: workers }, () => workLoop()))
const effortSevenCurves = new Map<string, CurvePoint[]>()
if (effort === 9)
  for (const fixture of selected) {
    const row = object(
      JSON.parse(
        await readFile(
          join(effortSevenReference, `${fixture.id}-${fixture.kind}`, 'result.json'),
          'utf8',
        ),
      ),
    )
    if (
      !curveMatches(row, fixture.fixtureSha256, 'purejsimage', rgb ? 3 : 4, 7) ||
      !Array.isArray(row.points)
    )
      throw new Error('Effort 7 reference fixture or effort mismatch')
    const points = row.points.map(parsePoint).filter((point) => distances.includes(point.setting))
    if (points.length !== distances.length || missingSettings(distances, points).length)
      throw new Error('Effort 7 reference ladder incomplete')
    effortSevenCurves.set(fixtureKey(fixture), points)
  }
if (mode !== 'speed')
  for (const [id, curves] of results) {
    const own = curves.get('purejsimage')
    if (!own) continue
    for (const peer of comparisonPeers) {
      const reference = peer === 'purejsimage' ? effortSevenCurves.get(id) : curves.get(peer)
      if (!reference) continue
      for (const metric of metrics) {
        try {
          const result = bdRate(
            own.map((point) => ({ quality: point[metric], bytes: point.bytes })),
            reference.map((point) => ({ quality: point[metric], bytes: point.bytes })),
            metric,
            qualityIntervals[metric],
          )
          comparisons.push({
            id,
            peer,
            metric,
            percent: result.percent,
            coversRequiredRange: result.coversRequiredRange,
          })
          if (!result.coversRequiredRange)
            omissions.push({
              id,
              engine: peer,
              reason: `${metric}: incomplete required-range overlap`,
            })
        } catch (error) {
          omissions.push({
            id,
            engine: peer,
            reason: `${metric}: ${error instanceof Error ? error.message : String(error)}`,
          })
        }
      }
    }
  }
const table = comparisonPeers.flatMap((peer) =>
  metrics.map((metric) => ({
    peer,
    referenceEffort: peer === 'jsquash' ? effort : 7,
    metric,
    ...summarizeBdRates(
      comparisons
        .filter((row) => row.peer === peer && row.metric === metric)
        .map((row) => row.percent),
    ),
  })),
)
const speed = engines.map((engine) => ({
  engine,
  effort: engine === 'vips' ? 7 : effort,
  lab: summarizeBdRates(
    selected
      .filter((fixture) => fixture.kind === 'lab')
      .flatMap(
        (fixture) =>
          results
            .get(fixtureKey(fixture))
            ?.get(engine)
            ?.map((point) => point.encodeMs) ?? [],
      ),
  ),
  watch: summarizeBdRates(
    selected
      .filter((fixture) => fixture.kind === 'watch')
      .flatMap(
        (fixture) =>
          results
            .get(fixtureKey(fixture))
            ?.get(engine)
            ?.map((point) => point.encodeMs) ?? [],
      ),
  ),
}))
const effortSevenSpeed =
  effort === 9
    ? summarizeBdRates(
        [...effortSevenCurves.values()].flatMap((points) => points.map((point) => point.encodeMs)),
      )
    : null
const ownMedian = speed.find((row) => row.engine === 'purejsimage')?.lab?.median
const jsquashMedian = speed.find((row) => row.engine === 'jsquash')?.lab?.median
const effortNineSpeedRatios =
  effort === 9
    ? {
        versusOwnEffortSeven:
          ownMedian !== undefined && effortSevenSpeed ? ownMedian / effortSevenSpeed.median : null,
        versusJsquashEffortNine:
          ownMedian !== undefined && jsquashMedian !== undefined ? ownMedian / jsquashMedian : null,
      }
    : null
const managedPeakBytes = Math.max(
  0,
  ...[...results.values()].flatMap(
    (row) => row.get('purejsimage')?.map((point) => point.managedPeakBytes ?? 0) ?? [],
  ),
)
const processPeakRssBytes = Math.max(
  0,
  ...[...results.values()].flatMap(
    (row) => row.get('purejsimage')?.map((point) => point.processPeakRssBytes) ?? [],
  ),
)
await writeFile(
  join(directory, 'summary.json'),
  `${JSON.stringify({ mode, variant, effort, effortSevenReference, effortSevenSpeed, effortNineSpeedRatios, workers, manifestPath, measurementRun: resumeSpeed ? 'partial resumed baseline speed run' : 'fresh measurement run', resumedSpeed: resumeSpeed, reusedSpeedJobs, measuredSpeedJobs, intervalPolicy: 'required-ranges', selectedImages: selected.length + selection.missingRequestedIds.length, elapsedSeconds: (Date.now() - started) / 1000, table, speed, managedPeakBytes, processPeakRssBytes, comparisons, failures, omissions, drops: [...(Array.isArray(rawManifest.drops) ? rawManifest.drops : []), ...selection.drops], complete: selection.complete && failures.length === 0 && omissions.length === 0 && (mode === 'speed' || comparisons.length === selected.length * (effort === 9 ? 9 : 6)) }, null, 2)}\n`,
)
console.log(
  JSON.stringify({
    table,
    speed,
    managedPeakBytes,
    failures: failures.length,
    omissions: omissions.length,
  }),
)
if (failures.length) process.exitCode = 1
