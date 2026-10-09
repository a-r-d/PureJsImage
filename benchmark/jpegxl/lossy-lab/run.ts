import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { object } from '../comparison/model.ts'
import {
  type PreparedFixture,
  parseLabMode,
  parsePreparedManifest,
  selectPreparedFixtures,
} from './fixture-selection.ts'
import { bdRate, type QualityMetric, summarizeBdRates } from './metrics.ts'
import { type CurvePoint, type Engine, missingSettings, parsePoint } from './model.ts'

const args = process.argv.slice(2)
const argument = (name: string, fallback: string): string => {
  const at = args.indexOf(name)
  return at === -1 ? fallback : (args[at + 1] ?? fallback)
}
const manifestPath = argument('--manifest', '.tmp/jpegxl-lossy-lab/corpus/manifest.json')
const directory = argument('--out', '.tmp/jpegxl-lossy-lab/baseline')
const mode = parseLabMode(argument('--mode', 'screen'))
const variant = argument('--variant', 'baseline')
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
const distances =
  mode === 'screen' ? [0.25, 1.5, 6, 25] : [0.25, 0.35, 0.5, 0.75, 1, 1.5, 2, 3, 4.5, 6, 9, 16, 25]
const peerSettings = {
  jsquash: [1, 10, 20, 40, 60, 75, 85, 92, 97, 99, 100],
  vips: [0.1, 0.25, 0.35, 0.5, 0.75, 1, 1.5, 2, 3, 4.5, 6, 9, 16, 25],
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
let pendingLedger = Promise.resolve()
const ledger = async (): Promise<void> => {
  const text = `${JSON.stringify({ startedAt: new Date(started).toISOString(), mode, variant, budgetSeconds, workers, selected: selected.length, totalJobs: jobs.length, completedJobs: [...results.values()].reduce((sum, row) => sum + row.size, 0), failures, omissions }, null, 2)}\n`
  pendingLedger = pendingLedger.then(() => writeFile(join(directory, 'progress.json'), text))
  await pendingLedger
}
await ledger()
async function runJob(fixture: Fixture, engine: Engine): Promise<void> {
  const settings =
    mode === 'speed'
      ? [engine === 'jsquash' ? 80 : 2]
      : engine === 'purejsimage'
        ? distances
        : peerSettings[engine]
  const resultDirectory =
    engine === 'purejsimage' || mode === 'speed'
      ? join(directory, `${variant}-${engine}`, `${fixture.id}-${fixture.kind}`)
      : join(
          '.tmp/jpegxl-lossy-lab/peer-cache',
          `${engine === 'jsquash' ? 'jsquash-1.3.0' : 'vips-0.0.19'}-curve`,
          fixture.fixtureSha256,
        )
  const resultPath = join(resultDirectory, 'result.json')
  let cached: unknown = null
  if (mode !== 'speed' && (engine !== 'purejsimage' || args.includes('--resume-own'))) {
    try {
      cached = JSON.parse(await readFile(resultPath, 'utf8'))
    } catch {
      /* Cache miss. */
    }
  }
  const cachedRow = cached === null ? null : object(cached)
  const sameFixture =
    cachedRow?.fixtureSha256 === fixture.fixtureSha256 &&
    cachedRow.engine === engine &&
    Array.isArray(cachedRow.points)
  const cachedPoints =
    sameFixture && Array.isArray(cachedRow?.points) ? cachedRow.points.map(parsePoint) : []
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
          ...(sameFixture ? ['--append'] : []),
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
  if (row.fixtureSha256 !== fixture.fixtureSha256 || !Array.isArray(row.points))
    throw new Error('Worker fixture/result mismatch')
  const points = row.points.map(parsePoint).filter((point) => settings.includes(point.setting))
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
if (mode !== 'speed')
  for (const [id, curves] of results) {
    const own = curves.get('purejsimage')
    if (!own) continue
    for (const peer of ['jsquash', 'vips'] as const) {
      const reference = curves.get(peer)
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
const table = ['jsquash', 'vips'].flatMap((peer) =>
  metrics.map((metric) => ({
    peer,
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
  `${JSON.stringify({ mode, variant, workers, manifestPath, intervalPolicy: 'required-ranges', selectedImages: selected.length + selection.missingRequestedIds.length, elapsedSeconds: (Date.now() - started) / 1000, table, speed, managedPeakBytes, processPeakRssBytes, comparisons, failures, omissions, drops: [...(Array.isArray(rawManifest.drops) ? rawManifest.drops : []), ...selection.drops], complete: selection.complete && failures.length === 0 && omissions.length === 0 && (mode === 'speed' || comparisons.length === selected.length * 6) }, null, 2)}\n`,
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
