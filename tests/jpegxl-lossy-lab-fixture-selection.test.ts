import { describe, expect, it } from 'vitest'
import { selectDevelopmentCorpus } from '../benchmark/jpegxl/lossy-lab/corpus.ts'
import {
  baselineSpeedPoints,
  type PreparedFixture,
  parseLabMode,
  parsePreparedManifest,
  selectPreparedFixtures,
  validateBaselineSpeedResume,
} from '../benchmark/jpegxl/lossy-lab/fixture-selection.ts'

const corpus = selectDevelopmentCorpus()
const prepared = (
  id: string,
  split: PreparedFixture['split'] = 'development',
  kind: PreparedFixture['kind'] = 'lab',
  largeGateRepresentative = false,
): PreparedFixture => ({
  id,
  split,
  kind,
  largeGateRepresentative,
  png: `${id}.png`,
  fixtureSha256: 'a'.repeat(64),
})
const labFixtures = corpus.normal.map((fixture) =>
  prepared(fixture.id, 'development', 'lab', fixture.largeGateRepresentative),
)
const watchFixtures = corpus.watch.map((fixture) =>
  prepared(fixture.id, fixture.split, 'watch', fixture.largeGateRepresentative),
)
const manifest = (fixtures: readonly PreparedFixture[]) => ({
  fixtures,
  screenIds: corpus.screen.map((fixture) => fixture.id),
  requestedIds: fixtures.map((fixture) => fixture.id),
  failures: [],
})

describe('lossy lab prepared fixture selection', () => {
  it('retains all six development and four prior references for promoted watch', () => {
    const result = selectPreparedFixtures(parsePreparedManifest(manifest(watchFixtures)), {
      mode: 'watch',
      promotion: true,
    })
    expect(result.fixtures).toEqual(watchFixtures)
    expect(result.fixtures.filter((fixture) => fixture.split === 'watch-reference')).toHaveLength(4)
    expect(result.complete).toBe(true)
    expect(result.missingRequestedIds).toEqual([])
  })

  it('requires promotion and rejects incomplete watch preparation', () => {
    const complete = parsePreparedManifest(manifest(watchFixtures))
    expect(() => selectPreparedFixtures(complete, { mode: 'watch' })).toThrow('promotion')
    expect(() =>
      selectPreparedFixtures(complete, {
        mode: 'watch',
        promotion: true,
        only: 'portrait-2400x3000',
      }),
    ).toThrow('incomplete')
    const missing = parsePreparedManifest({
      ...manifest(watchFixtures),
      fixtures: watchFixtures.filter((fixture) => fixture.id !== 'prior-12mp-im26-1416'),
      failures: [{ id: 'prior-12mp-im26-1416', error: 'JPEG preparation failed' }],
    })
    expect(() => selectPreparedFixtures(missing, { mode: 'watch', promotion: true })).toThrow(
      'prior-12mp-im26-1416',
    )
    expect(() =>
      selectPreparedFixtures({ ...missing, failures: [] }, { mode: 'watch', promotion: true }),
    ).toThrow('incomplete')
    expect(() =>
      selectPreparedFixtures(
        { ...complete, requestedIds: null },
        { mode: 'watch', promotion: true },
      ),
    ).toThrow('requested IDs')
  })

  it('forbids holdout in every development mode, including speed watch additions', () => {
    const holdout = parsePreparedManifest(manifest([prepared('holdout', 'holdout')]))
    for (const mode of ['screen', 'lab', 'speed', 'watch'] as const)
      expect(() => selectPreparedFixtures(holdout, { mode, promotion: true })).toThrow('Holdout')
    expect(() => selectPreparedFixtures(holdout, { mode: 'holdout' })).toThrow('promotion')
    expect(
      selectPreparedFixtures(holdout, { mode: 'holdout', promotion: true }).fixtures,
    ).toHaveLength(1)
    expect(() =>
      selectPreparedFixtures(parsePreparedManifest(manifest(labFixtures)), {
        mode: 'speed',
        additionalWatch: holdout,
        watchCount: 1,
      }),
    ).toThrow('Holdout')
  })

  it('includes prior references in speed runs and checks missing additions independently', () => {
    const lab = parsePreparedManifest(manifest([prepared('portrait-2400x3000')]))
    const watch = parsePreparedManifest(
      manifest([prepared('portrait-2400x3000', 'watch-reference', 'watch')]),
    )
    const result = selectPreparedFixtures(lab, {
      mode: 'speed',
      additionalWatch: watch,
      watchCount: 1,
    })
    expect(result.fixtures.map((fixture) => fixture.kind)).toEqual(['lab', 'watch'])
    expect(result.complete).toBe(true)
    const failed = {
      ...watch,
      fixtures: [],
      failures: [{ id: 'portrait-2400x3000', error: 'failed' }],
    }
    const incomplete = selectPreparedFixtures(lab, {
      mode: 'speed',
      additionalWatch: failed,
      watchCount: 1,
    })
    expect(incomplete.complete).toBe(false)
    expect(incomplete.missingRequestedIds).toEqual(['portrait-2400x3000'])
  })

  it('keeps all 16 small screen crops and prepares large scale crops separately', () => {
    const input = parsePreparedManifest(manifest(labFixtures))
    const screen = selectPreparedFixtures(input, { mode: 'screen', skipLarge: true })
    expect(screen.fixtures).toHaveLength(16)
    expect(screen.complete).toBe(true)
    expect(screen.drops).toEqual([])
    expect(selectPreparedFixtures(input, { mode: 'screen' }).fixtures).toHaveLength(16)
    expect(selectPreparedFixtures(input, { mode: 'lab' }).fixtures).toHaveLength(64)
    expect(() => selectPreparedFixtures(input, { mode: 'lab', skipLarge: true })).toThrow(
      'screen-only',
    )
  })

  it('selects only scale crops with optional separately hashed originals', () => {
    const scale = corpus.scale.map((entry) => prepared(entry.id, 'development', 'scale', true))
    const input = parsePreparedManifest(
      manifest([...labFixtures, ...scale.map((entry) => ({ ...entry, id: `${entry.id}-scale` }))]),
    )
    expect(selectPreparedFixtures(input, { mode: 'scale' }).fixtures).toHaveLength(2)
    const standalone = parsePreparedManifest(manifest(scale))
    const selected = selectPreparedFixtures(standalone, {
      mode: 'scale',
      additionalWatch: parsePreparedManifest(manifest(watchFixtures)),
      watchCount: 2,
    })
    expect(selected.fixtures.map((entry) => entry.kind)).toEqual([
      'scale',
      'scale',
      'watch',
      'watch',
    ])
    expect(selected.complete).toBe(true)
    expect(parseLabMode('scale')).toBe('scale')
  })

  it('resumes only complete matching isolated baseline speed measurements', () => {
    validateBaselineSpeedResume({ mode: 'speed', variant: 'baseline', workers: 1 })
    for (const ledger of [
      { mode: 'lab', variant: 'baseline', workers: 1 },
      { mode: 'speed', variant: 'candidate', workers: 1 },
      { mode: 'speed', variant: 'baseline', workers: 2 },
    ])
      expect(() => validateBaselineSpeedResume(ledger)).toThrow('isolated baseline')
    const point = {
      setting: 2,
      bytes: 123,
      encodeMs: 5,
      managedPeakBytes: 100,
      processPeakRssBytes: 200,
      ssimulacra2: 80,
      butteraugliMax: 1,
      butteraugliNorm3: 0.5,
    }
    const row = {
      engine: 'purejsimage',
      effort: 7,
      fixtureSha256: 'old',
      points: [point],
      failures: [],
    }
    expect(baselineSpeedPoints(row, 'old', 'purejsimage')).toEqual([point])
    // Two formerly large crops now have different PNG hashes and must be timed again.
    expect(baselineSpeedPoints(row, 'new-512-crop', 'purejsimage')).toEqual([])
    expect(baselineSpeedPoints(row, 'old', 'jsquash')).toEqual([])
    expect(baselineSpeedPoints({ ...row, effort: 6 }, 'old', 'purejsimage')).toEqual([])
    expect(
      baselineSpeedPoints({ ...row, points: [{ ...point, setting: 3 }] }, 'old', 'purejsimage'),
    ).toEqual([])
    expect(
      baselineSpeedPoints(
        { ...row, points: [point, { ...point, setting: 3 }] },
        'old',
        'purejsimage',
      ),
    ).toEqual([])
    expect(
      baselineSpeedPoints(
        { ...row, failures: [{ setting: 2, error: 'failed' }] },
        'old',
        'purejsimage',
      ),
    ).toEqual([])
    expect(baselineSpeedPoints({ ...row, points: [{ setting: 2 }] }, 'old', 'purejsimage')).toEqual(
      [],
    )
    expect(baselineSpeedPoints(null, 'old', 'purejsimage')).toEqual([])
    const peer = { ...row, engine: 'jsquash', points: [{ ...point, setting: 80 }] }
    expect(baselineSpeedPoints(peer, 'old', 'jsquash')).toEqual(peer.points)
  })

  it('reports preparation failures and missing requested fixtures for development', () => {
    const input = parsePreparedManifest({
      ...manifest([prepared('good')]),
      requestedIds: ['good', 'failed'],
      failures: [{ id: 'failed', error: 'preparation failed' }],
    })
    const selection = selectPreparedFixtures(input, { mode: 'lab' })
    expect(selection.complete).toBe(false)
    expect(selection.preparationFailures).toEqual(input.failures)
    expect(selection.missingRequestedIds).toEqual(['failed'])
    expect(selectPreparedFixtures(input, { mode: 'lab', only: 'good' }).complete).toBe(true)
  })

  it('rejects invalid manifest fields and modes', () => {
    expect(() =>
      parsePreparedManifest({
        ...manifest(labFixtures),
        fixtures: [prepared('same'), prepared('same')],
      }),
    ).toThrow('Duplicate')
    expect(() =>
      parsePreparedManifest({ ...manifest(labFixtures), requestedIds: ['same', 'same'] }),
    ).toThrow('Duplicate')
    expect(() =>
      parsePreparedManifest({
        ...manifest(labFixtures),
        fixtures: [{ ...prepared('test'), largeGateRepresentative: 'false' }],
      }),
    ).toThrow('large fixture flag')
    expect(() => parseLabMode('invalid')).toThrow('Invalid lab mode')
    expect(parseLabMode('watch')).toBe('watch')
  })
})
