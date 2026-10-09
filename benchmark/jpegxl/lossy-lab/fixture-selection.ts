import { object, string } from '../comparison/model.ts'
import { selectDevelopmentCorpus } from './corpus.ts'

export type LabMode = 'screen' | 'lab' | 'speed' | 'holdout' | 'watch'
export interface PreparedFixture {
  readonly id: string
  readonly png: string
  readonly split: 'development' | 'holdout' | 'watch-reference'
  readonly kind: 'lab' | 'watch'
  readonly fixtureSha256: string
  readonly largeGateRepresentative: boolean
}
export interface PreparationFailure {
  readonly id: string
  readonly error: string
}
export interface PreparedManifest {
  readonly fixtures: readonly PreparedFixture[]
  readonly screenIds: readonly string[]
  readonly requestedIds: readonly string[] | null
  readonly failures: readonly PreparationFailure[]
}
export interface FixtureSelectionOptions {
  readonly mode: LabMode
  readonly promotion?: boolean
  readonly only?: string
  readonly skipLarge?: boolean
  readonly additionalWatch?: PreparedManifest
  readonly watchCount?: number
}
export interface FixtureSelection {
  readonly fixtures: readonly PreparedFixture[]
  readonly drops: readonly { id: string; reason: string }[]
  readonly preparationFailures: readonly PreparationFailure[]
  readonly missingRequestedIds: readonly string[]
  readonly complete: boolean
}

function ids(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error('Expected fixture IDs')
  const result = value.map(string)
  if (new Set(result).size !== result.length) throw new Error('Duplicate fixture IDs')
  return result
}

export function parseLabMode(value: string): LabMode {
  if (
    value === 'screen' ||
    value === 'lab' ||
    value === 'speed' ||
    value === 'holdout' ||
    value === 'watch'
  )
    return value
  throw new Error('Invalid lab mode')
}

export function parsePreparedManifest(value: unknown): PreparedManifest {
  const row = object(value)
  if (!Array.isArray(row.fixtures)) throw new Error('Prepared fixture manifest missing')
  const fixtures = row.fixtures.map((value): PreparedFixture => {
    const fixture = object(value)
    const split = string(fixture.split)
    const kind = string(fixture.kind)
    if (split !== 'development' && split !== 'holdout' && split !== 'watch-reference')
      throw new Error('Invalid fixture split')
    if (kind !== 'lab' && kind !== 'watch') throw new Error('Invalid fixture kind')
    if (split === 'watch-reference' && kind !== 'watch')
      throw new Error('Watch reference must be a watch fixture')
    if (typeof fixture.largeGateRepresentative !== 'boolean')
      throw new Error('Missing large fixture flag')
    return {
      id: string(fixture.id),
      png: string(fixture.png),
      split,
      kind,
      fixtureSha256: string(fixture.fixtureSha256),
      largeGateRepresentative: fixture.largeGateRepresentative,
    }
  })
  if (new Set(fixtures.map((fixture) => fixture.id)).size !== fixtures.length)
    throw new Error('Duplicate prepared fixture IDs')
  const failures: PreparationFailure[] = []
  if (row.failures !== undefined) {
    if (!Array.isArray(row.failures)) throw new Error('Invalid preparation failures')
    for (const value of row.failures) {
      const failure = object(value)
      failures.push({ id: string(failure.id), error: string(failure.error) })
    }
  }
  return {
    fixtures,
    screenIds: ids(row.screenIds),
    requestedIds: row.requestedIds === undefined ? null : ids(row.requestedIds),
    failures,
  }
}

/** Selection never hides preparation failures from a completed run. */
export function selectPreparedFixtures(
  manifest: PreparedManifest,
  options: FixtureSelectionOptions,
): FixtureSelection {
  const { mode } = options
  if ((mode === 'holdout' || mode === 'watch') && options.promotion !== true)
    throw new Error(`${mode} runs require promotion`)
  if (options.skipLarge && mode !== 'screen')
    throw new Error('Large fixture reduction is screen-only')
  if (options.additionalWatch && mode !== 'speed')
    throw new Error('Additional watch fixtures are for speed measurements')
  const loaded = [...manifest.fixtures, ...(options.additionalWatch?.fixtures ?? [])]
  if (mode !== 'holdout' && loaded.some((fixture) => fixture.split === 'holdout'))
    throw new Error('Holdout fixtures are forbidden in development and speed runs')
  const eligible = manifest.fixtures.filter((fixture) => {
    if (mode === 'holdout') return fixture.split === 'holdout' && fixture.kind === 'lab'
    if (mode === 'watch') return fixture.kind === 'watch'
    if (mode === 'speed') return fixture.kind === 'lab' || fixture.kind === 'watch'
    return (
      fixture.split === 'development' &&
      fixture.kind === 'lab' &&
      (mode === 'lab' || manifest.screenIds.includes(fixture.id))
    )
  })
  let expected =
    mode === 'screen'
      ? [...manifest.screenIds]
      : [
          ...(manifest.requestedIds ?? [
            ...eligible.map((fixture) => fixture.id),
            ...manifest.failures.map((failure) => failure.id),
          ]),
        ]
  const failures = [...manifest.failures]
  const additionalMissing: string[] = []
  if (mode === 'watch') {
    expected = selectDevelopmentCorpus().watch.map((fixture) => fixture.id)
    if (
      manifest.requestedIds === null ||
      expected.some((id) => !manifest.requestedIds?.includes(id))
    )
      throw new Error('Full watch preparation must declare all ten requested IDs')
  }
  if (options.additionalWatch) {
    const watch = options.additionalWatch
    const count = options.watchCount ?? 2
    const requested = watch.requestedIds ?? watch.fixtures.map((fixture) => fixture.id)
    if (!Number.isSafeInteger(count) || count < 1 || count > requested.length)
      throw new Error('Invalid original watch count')
    const extraIds = requested.slice(0, count)
    for (const id of extraIds)
      if (
        !watch.fixtures.some((fixture) => fixture.id === id && fixture.kind === 'watch') &&
        (!options.only || options.only === id)
      )
        additionalMissing.push(id)
    for (const fixture of watch.fixtures)
      if (extraIds.includes(fixture.id)) {
        if (fixture.kind !== 'watch')
          throw new Error('Additional fixture must be an original watch fixture')
        eligible.push(fixture)
      }
    expected.push(...extraIds)
    failures.push(...watch.failures.filter((failure) => extraIds.includes(failure.id)))
  }
  const drops: { id: string; reason: string }[] = []
  const fixtures = eligible.filter((fixture) => {
    if (options.skipLarge && fixture.largeGateRepresentative) {
      drops.push({
        id: fixture.id,
        reason: 'Large screen fixture omitted to meet the ten-minute quick-screen budget',
      })
      return false
    }
    return !options.only || fixture.id === options.only
  })
  if (mode !== 'watch' && options.only) expected = expected.filter((id) => id === options.only)
  const droppedIds = new Set(drops.map((drop) => drop.id))
  expected = expected.filter((id) => !droppedIds.has(id))
  const present = new Set(fixtures.map((fixture) => fixture.id))
  const missingRequestedIds = [
    ...new Set([...expected.filter((id) => !present.has(id)), ...additionalMissing]),
  ]
  const preparationFailures =
    mode === 'watch' ? failures : failures.filter((failure) => expected.includes(failure.id))
  if (fixtures.length === 0) throw new Error('No fixtures selected')
  if (mode === 'watch' && (missingRequestedIds.length > 0 || preparationFailures.length > 0))
    throw new Error(
      `Full watch preparation incomplete: ${[...new Set([...missingRequestedIds, ...preparationFailures.map((failure) => failure.id)])].join(', ')}`,
    )
  return {
    fixtures,
    drops,
    preparationFailures,
    missingRequestedIds,
    complete: missingRequestedIds.length === 0 && preparationFailures.length === 0,
  }
}
