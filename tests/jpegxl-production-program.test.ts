import { createHash } from 'node:crypto'
import { access, readFile } from 'node:fs/promises'
import { describe, expect, test } from 'vitest'

const root = 'benchmark/jpegxl/production-program'

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

const json = async (path: string): Promise<Readonly<Record<string, unknown>>> =>
  record(JSON.parse(await readFile(path, 'utf8')), path)

const digest = async (path: string): Promise<string> =>
  createHash('sha256')
    .update(await readFile(path))
    .digest('hex')

describe('JPEG XL production program baseline', () => {
  test('tracks every milestone deterministically with the approved M1 and M2 promotions', async () => {
    const status = await json(`${root}/status.json`)
    const milestones = array(status.milestones, 'status.milestones').map((value) =>
      record(value, 'milestone'),
    )
    expect(milestones.map(({ id }) => id)).toEqual([
      'M0',
      'M1',
      'M2',
      'M3',
      'M4',
      'M5',
      'M6',
      'M7',
      'M8',
      'M9',
      'M10',
    ])
    expect(['in progress', 'PR open']).toContain(milestones[0]?.status)
    expect(milestones.map(({ stablePromotionGatePassed }) => stablePromotionGatePassed)).toEqual([
      false,
      true,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ])

    const capabilities = await json('capabilities/manifest.json')
    const jpegXl = array(capabilities.codecs, 'capabilities.codecs')
      .map((value) => record(value, 'codec'))
      .find(({ id }) => id === 'jpegxl')
    expect(jpegXl).toBeDefined()
    expect(record(jpegXl?.read, 'jpegxl.read')).toEqual({ status: 'limited', label: 'Limited' })
    expect(record(jpegXl?.write, 'jpegxl.write')).toEqual({
      status: 'limited',
      label: 'Stable lossless and exact transcode',
    })
  })

  test('pins four licensed corpus manifests and their component manifests', async () => {
    const conformance = await json(`${root}/corpora/conformance.json`)
    const generated = await json(`${root}/corpora/generated-features.json`)
    const realImages = await json(`${root}/corpora/real-images.json`)
    const jpegArchive = await json(`${root}/corpora/jpeg-archive.json`)
    const realJpegArchive = await json(`${root}/corpora/jpeg-archive-coco-val2017.json`)

    expect(array(conformance.cases, 'conformance.cases')).toHaveLength(39)
    expect(array(realImages.images, 'realImages.images')).toHaveLength(10)
    expect(array(jpegArchive.cases, 'jpegArchive.cases')).toHaveLength(10)
    expect(array(realJpegArchive.cases, 'realJpegArchive.cases')).toHaveLength(250)
    expect(jpegArchive.currentRealJpegCount).toBe(250)

    for (const value of array(conformance.cases, 'conformance.cases')) {
      const fixture = record(value, 'conformance fixture')
      expect(fixture.license).toEqual(expect.any(String))
      expect(fixture.sha256).toMatch(/^[0-9a-f]{64}$/u)
    }
    for (const value of array(realImages.images, 'realImages.images')) {
      const image = record(value, 'real image')
      expect(image.license).toEqual(expect.any(String))
      expect(image.sha256).toMatch(/^[0-9a-f]{64}$/u)
    }
    for (const value of array(jpegArchive.cases, 'jpegArchive.cases')) {
      const image = record(value, 'JPEG archive entry')
      expect(image.license).toEqual(expect.any(String))
      expect(image.sha256).toMatch(/^[0-9a-f]{64}$/u)
    }
    for (const value of array(realJpegArchive.cases, 'realJpegArchive.cases')) {
      const image = record(value, 'real JPEG archive entry')
      const license = record(image.license, 'real JPEG archive license')
      expect(license.name).toEqual(expect.any(String))
      expect(license.url).toEqual(expect.any(String))
      expect(image.sha256).toMatch(/^[0-9a-f]{64}$/u)
    }
    for (const value of array(generated.fixtureManifests, 'generated.fixtureManifests')) {
      const manifest = record(value, 'component manifest')
      const path = String(manifest.path)
      expect(await digest(path)).toBe(manifest.sha256)
      expect(manifest.license).toEqual(expect.any(String))
      expect(manifest.revision).toMatch(/^[0-9a-f]{40}$/u)
    }
  })

  test('records passing Milestone 1 compression and performance gates', async () => {
    const compressionReport = await json('benchmark/results/jpegxl-m1-real-corpus-2026-09-03.json')
    const compression = record(
      compressionReport.milestone1CompressionGate,
      'milestone1CompressionGate',
    )
    expect(compression).toMatchObject({
      passed: true,
      exactCases: 250,
      totalCases: 250,
      unexplainedOutliers: [],
    })
    expect(compression.smallerRate).toBeGreaterThanOrEqual(0.9)
    expect(compression.medianSavingsPercentage).toBeGreaterThanOrEqual(12)
    expect(compression.p10SavingsPercentage).toBeGreaterThanOrEqual(0)
    expect(compression.medianRatioToLibjxl).toBeLessThanOrEqual(1.1)
    expect(compression.p90RatioToLibjxl).toBeLessThanOrEqual(1.2)
    expect(compression.worstRatioToLibjxl).toBeLessThanOrEqual(1.35)

    const performanceReport = await json('benchmark/results/jpegxl-m1-performance-2026-09-03.json')
    const performance = record(
      performanceReport.milestone1PerformanceGate,
      'milestone1PerformanceGate',
    )
    expect(performance).toMatchObject({ passed: true, exactCases: 2, totalCases: 2 })
    expect(performance.slowestLargePhotoMedianMilliseconds).toBeLessThanOrEqual(15_000)
    expect(performance.speedupFromM0FastestLargePhoto).toBeGreaterThanOrEqual(5)
    expect(performance.medianRatioToLibjxlExactWorkflow).toBeLessThanOrEqual(8)
  })

  test('classifies every official conformance case without incorrect output', async () => {
    const conformance = await json(`${root}/corpora/conformance.json`)
    const cases = array(conformance.cases, 'conformance.cases').map((value) =>
      record(value, 'conformance case'),
    )
    const count = (classification: string): number =>
      cases.filter(({ baselineClassification }) => baselineClassification === classification).length
    expect({
      pass: count('pass'),
      unsupported: count('expected-unsupported'),
      malformed: count('malformed-safely-rejected'),
      incorrect: count('incorrect-output'),
      unexpected: count('unexpected-failure'),
    }).toEqual({ pass: 2, unsupported: 36, malformed: 0, incorrect: 0, unexpected: 1 })
    expect(cases.find(({ id }) => id === 'delta_palette')).toMatchObject({
      baselineClassification: 'unexpected-failure',
      expectedErrorCode: 'INVALID_INPUT',
    })
    for (const fixture of cases.filter(
      ({ baselineClassification }) => baselineClassification !== 'pass',
    )) {
      expect(fixture.boundary).toEqual(expect.any(String))
    }
  })

  test('extracts every required feature field from the PR corpus', async () => {
    const generated = await json(`${root}/corpora/generated-features.json`)
    const inventory = await json(`${root}/feature-inventory.json`)
    const required = array(generated.requiredPerFixtureFields, 'required fields').map(String)
    const fixtures = array(inventory.fixtures, 'feature inventory fixtures').map((value) =>
      record(value, 'feature fixture'),
    )
    expect(fixtures).toHaveLength(19)
    for (const fixture of fixtures) {
      for (const field of required) expect(fixture).toHaveProperty(field)
    }
    expect(fixtures.find(({ id }) => id === 'rgb8-distance2-progressive')).toMatchObject({
      strategyIds: [0, 2, 12, 13, 14, 15, 16, 17],
    })
    expect(
      fixtures.find(({ id }) => id === 'rgb8-distance1-multi-group-progressive'),
    ).toMatchObject({
      groupCount: 6,
      lfGroupCount: 1,
      passes: 3,
      chromaShifts: [0, 0, 0],
      patchCount: 0,
      splineCount: 0,
      strategyIds: [0, 1, 2, 7, 12, 13, 14, 15, 16, 17],
    })
  })

  test('keeps claim evidence and the generated baseline present', async () => {
    const source = await json(`${root}/baseline-source.json`)
    const baseline = await json(`${root}/baseline.json`)
    expect(baseline.baselineMainRevision).toBe('1cd965dfeba27865c920c4e27bd44dbb4ea0404b')
    expect(record(baseline.capabilityPromotion, 'capabilityPromotion')).toEqual({
      performed: false,
      stableGatePassed: false,
    })
    for (const value of array(source.claimCoverage, 'claimCoverage')) {
      for (const path of array(record(value, 'claim').evidence, 'claim.evidence')) {
        await expect(access(String(path))).resolves.toBeUndefined()
      }
    }
    await expect(access('docs/architecture/jpegxl-production-program.md')).resolves.toBeUndefined()
    await expect(access(`${root}/baseline.md`)).resolves.toBeUndefined()
    await expect(access(`${root}/oracle-tools.json`)).resolves.toBeUndefined()
  })

  test('pins the resolved Imazen oracle dependency graph', async () => {
    const manifest = await json(`${root}/oracle-tools.json`)
    const imazen = array(manifest.tools, 'oracleTools.tools')
      .map((value) => record(value, 'oracle tool'))
      .find(({ id }) => id === 'imazen-jxl-encoder')
    expect(imazen).toBeDefined()
    const lockfile = String(imazen?.resolvedCargoLock)
    await expect(digest(lockfile)).resolves.toBe(imazen?.resolvedCargoLockSha256)
  })
})
