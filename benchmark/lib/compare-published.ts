import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { BenchmarkResult } from '../types.ts'

export const PUBLISHED_SPEED_REGRESSION_PERCENT = 10
export const PUBLISHED_SPEED_REGRESSION_MINIMUM_BASELINE_MS = 50
export const PUBLISHED_SPEED_CHECK_PROFILES = new Set(['competitors', 'web-codecs'])

export interface PublishedTiming {
  readonly engine: string
  readonly workflow: string
  readonly status: string
  readonly wallMilliseconds: number | null
}

export interface PublishedSpeedRegression {
  readonly engine: string
  readonly workflow: string
  readonly baselineMilliseconds: number
  readonly currentMilliseconds: number
  readonly deltaPercent: number
}

export interface PublishedSpeedComparison {
  readonly compared: number
  readonly skipped: number
  readonly regressions: readonly PublishedSpeedRegression[]
}

export interface PublishedSpeedCheck extends PublishedSpeedComparison {
  readonly profile: string
  readonly snapshotPath: string | null
  readonly skippedReason: string | null
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const timingKey = (timing: PublishedTiming): string => `${timing.engine}\0${timing.workflow}`

const deltaPercent = (baseline: number, current: number): number =>
  ((current - baseline) / baseline) * 100

export const publishedTimingsFromResults = (
  results: readonly BenchmarkResult[],
): PublishedTiming[] =>
  results.map((result) => ({
    engine: result.engine,
    workflow: result.workflow,
    status: result.summary.status,
    wallMilliseconds: result.summary.wallMilliseconds?.median ?? null,
  }))

export const comparePublishedSpeed = (
  current: readonly PublishedTiming[],
  baseline: readonly PublishedTiming[],
  options: {
    readonly thresholdPercent?: number
    readonly minimumBaselineMilliseconds?: number
  } = {},
): PublishedSpeedComparison => {
  const threshold = options.thresholdPercent ?? PUBLISHED_SPEED_REGRESSION_PERCENT
  const floor =
    options.minimumBaselineMilliseconds ?? PUBLISHED_SPEED_REGRESSION_MINIMUM_BASELINE_MS
  const publishedByKey = new Map(baseline.map((timing) => [timingKey(timing), timing]))
  const regressions: PublishedSpeedRegression[] = []
  let compared = 0
  let skipped = 0

  for (const row of current) {
    const published = publishedByKey.get(timingKey(row))
    if (published === undefined) {
      skipped += 1
      continue
    }
    if (
      row.status !== 'pass' ||
      published.status !== 'pass' ||
      row.wallMilliseconds === null ||
      published.wallMilliseconds === null ||
      !Number.isFinite(row.wallMilliseconds) ||
      !Number.isFinite(published.wallMilliseconds) ||
      published.wallMilliseconds < floor
    ) {
      skipped += 1
      continue
    }
    compared += 1
    const change = deltaPercent(published.wallMilliseconds, row.wallMilliseconds)
    if (change > threshold) {
      regressions.push({
        engine: row.engine,
        workflow: row.workflow,
        baselineMilliseconds: published.wallMilliseconds,
        currentMilliseconds: row.wallMilliseconds,
        deltaPercent: change,
      })
    }
  }

  return { compared, skipped, regressions }
}

export const formatPublishedSpeedBanner = (check: PublishedSpeedCheck): string => {
  const lines = [
    '',
    '!'.repeat(72),
    'MAJOR SPEED REGRESSION vs published snapshot',
    `  profile:   ${check.profile}`,
    `  snapshot:  ${check.snapshotPath ?? '(none)'}`,
    `  threshold: +${PUBLISHED_SPEED_REGRESSION_PERCENT}% wall (baseline ≥ ${PUBLISHED_SPEED_REGRESSION_MINIMUM_BASELINE_MS} ms)`,
    '',
  ]
  for (const row of check.regressions) {
    lines.push(
      `  ${row.engine} / ${row.workflow}`,
      `    published  ${row.baselineMilliseconds.toFixed(1)} ms`,
      `    this run   ${row.currentMilliseconds.toFixed(1)} ms`,
      `    change     +${row.deltaPercent.toFixed(1)}%`,
      '',
    )
  }
  lines.push(
    'This result is slower than the checked-in public snapshot by more than 10%.',
    'Rerun on a quiet machine, or pass --allow-speed-regression if the change is expected.',
    '!'.repeat(72),
    '',
  )
  return lines.join('\n')
}

export const loadPublishedHeadlineTimings = async (
  repositoryDirectory: string,
  profile: string,
): Promise<{ path: string; timings: PublishedTiming[] } | null> => {
  const indexPath = join(repositoryDirectory, 'benchmark/results/public/index.json')
  let raw: unknown
  try {
    raw = JSON.parse(await readFile(indexPath, 'utf8')) as unknown
  } catch {
    return null
  }
  if (!isRecord(raw) || !Array.isArray(raw.results)) return null
  const entry = raw.results.find((item): item is Record<string, unknown> => {
    return (
      isRecord(item) &&
      item.profile === profile &&
      item.eligibleForDocumentationHeadlines === true &&
      item.publicationValidationStatus === 'passed'
    )
  })
  if (entry === undefined || !Array.isArray(entry.resultPaths)) return null
  const jsonPath = entry.resultPaths.find(
    (path): path is string => typeof path === 'string' && path.endsWith('.json'),
  )
  if (jsonPath === undefined) return null
  const snapshotRaw: unknown = JSON.parse(
    await readFile(join(repositoryDirectory, jsonPath), 'utf8'),
  )
  if (
    !isRecord(snapshotRaw) ||
    !isRecord(snapshotRaw.data) ||
    !Array.isArray(snapshotRaw.data.results)
  ) {
    throw new Error(`${jsonPath} is not a public ordinary-benchmark snapshot`)
  }
  const timings: PublishedTiming[] = []
  for (const [index, item] of snapshotRaw.data.results.entries()) {
    if (!isRecord(item)) throw new Error(`${jsonPath} data.results[${index}] must be an object`)
    if (
      typeof item.engine !== 'string' ||
      typeof item.workflow !== 'string' ||
      typeof item.status !== 'string'
    ) {
      throw new Error(`${jsonPath} data.results[${index}] is missing engine, workflow, or status`)
    }
    const wall = item.wallMilliseconds
    if (
      wall !== null &&
      wall !== undefined &&
      (typeof wall !== 'number' || !Number.isFinite(wall))
    ) {
      throw new Error(`${jsonPath} data.results[${index}].wallMilliseconds is invalid`)
    }
    timings.push({
      engine: item.engine,
      workflow: item.workflow,
      status: item.status,
      wallMilliseconds: typeof wall === 'number' ? wall : null,
    })
  }
  return { path: jsonPath, timings }
}

export const checkPublishedSpeed = async (input: {
  readonly repositoryDirectory: string
  readonly profile: string
  readonly results: readonly BenchmarkResult[]
}): Promise<PublishedSpeedCheck> => {
  if (!PUBLISHED_SPEED_CHECK_PROFILES.has(input.profile)) {
    return {
      profile: input.profile,
      snapshotPath: null,
      skippedReason: `profile ${input.profile} has no published headline snapshot`,
      compared: 0,
      skipped: 0,
      regressions: [],
    }
  }
  const snapshot = await loadPublishedHeadlineTimings(input.repositoryDirectory, input.profile)
  if (snapshot === null) {
    return {
      profile: input.profile,
      snapshotPath: null,
      skippedReason: `no headline public snapshot for profile ${input.profile}`,
      compared: 0,
      skipped: 0,
      regressions: [],
    }
  }
  return {
    profile: input.profile,
    snapshotPath: snapshot.path,
    skippedReason: null,
    ...comparePublishedSpeed(publishedTimingsFromResults(input.results), snapshot.timings),
  }
}
