import { describe, expect, it } from 'vitest'
import {
  checkPublishedSpeed,
  comparePublishedSpeed,
  formatPublishedSpeedBanner,
  loadPublishedHeadlineTimings,
  publishedTimingsFromResults,
  type PublishedSpeedCheck,
  type PublishedTiming,
} from '../benchmark/lib/compare-published.ts'
import type { BenchmarkResult } from '../benchmark/types.ts'

const timing = (
  engine: string,
  workflow: string,
  wallMilliseconds: number | null,
  status = 'pass',
): PublishedTiming => ({
  engine,
  workflow,
  status,
  wallMilliseconds,
})

const result = (
  engine: string,
  workflow: string,
  wallMilliseconds: number,
  status: BenchmarkResult['summary']['status'] = 'pass',
): BenchmarkResult => ({
  engine,
  workflow,
  title: workflow,
  runs: 3,
  warmups: 1,
  summary:
    status === 'pass'
      ? {
          status,
          errors: [],
          wallMilliseconds: {
            median: wallMilliseconds,
            p95: wallMilliseconds,
            minimum: wallMilliseconds,
            maximum: wallMilliseconds,
          },
        }
      : { status, errors: ['failed'] },
  samples: [],
})

describe('published snapshot speed regression check', () => {
  it('flags a pass/pass wall median more than 10% slower than the published baseline', () => {
    const comparison = comparePublishedSpeed(
      [timing('purejsimage', 'jpeg-resize-1200', 860)],
      [timing('purejsimage', 'jpeg-resize-1200', 777)],
    )
    expect(comparison.compared).toBe(1)
    expect(comparison.regressions).toEqual([
      expect.objectContaining({
        engine: 'purejsimage',
        workflow: 'jpeg-resize-1200',
        baselineMilliseconds: 777,
        currentMilliseconds: 860,
      }),
    ])
    expect(comparison.regressions[0]?.deltaPercent).toBeGreaterThan(10)
  })

  it('accepts a change at or under the 10% threshold', () => {
    const comparison = comparePublishedSpeed(
      [timing('purejsimage', 'jpeg-resize-1200', 850)],
      [timing('purejsimage', 'jpeg-resize-1200', 777)],
    )
    expect(comparison.compared).toBe(1)
    expect(comparison.regressions).toEqual([])
  })

  it('ignores sub-50ms baselines so metadata jitter cannot trip the gate', () => {
    const comparison = comparePublishedSpeed(
      [timing('purejsimage', 'metadata-jpeg-large', 40)],
      [timing('purejsimage', 'metadata-jpeg-large', 10)],
    )
    expect(comparison.compared).toBe(0)
    expect(comparison.skipped).toBe(1)
    expect(comparison.regressions).toEqual([])
  })

  it('skips pairs that are not pass/pass with a finite wall median', () => {
    const comparison = comparePublishedSpeed(
      [
        timing('purejsimage', 'jpeg-resize-1200', 900, 'error'),
        timing('jimp', 'jpeg-resize-1200', 900),
        timing('image-js', 'new-workflow', 900),
      ],
      [
        timing('purejsimage', 'jpeg-resize-1200', 777),
        timing('jimp', 'jpeg-resize-1200', null),
        timing('sharp', 'jpeg-resize-1200', 40),
      ],
    )
    expect(comparison.compared).toBe(0)
    expect(comparison.skipped).toBe(3)
    expect(comparison.regressions).toEqual([])
  })

  it('prints a loud banner naming the engine, workflow, and percent change', () => {
    const check: PublishedSpeedCheck = {
      profile: 'web-codecs',
      snapshotPath: 'benchmark/results/public/web-codecs-example.json',
      skippedReason: null,
      compared: 1,
      skipped: 0,
      regressions: [
        {
          engine: 'purejsimage',
          workflow: 'jpeg-resize-1200',
          baselineMilliseconds: 776.9,
          currentMilliseconds: 1680.9,
          deltaPercent: 116.4,
        },
      ],
    }
    const banner = formatPublishedSpeedBanner(check)
    expect(banner).toContain('MAJOR SPEED REGRESSION')
    expect(banner).toContain('!'.repeat(72))
    expect(banner).toContain('purejsimage / jpeg-resize-1200')
    expect(banner).toContain('776.9 ms')
    expect(banner).toContain('1680.9 ms')
    expect(banner).toContain('+116.4%')
    expect(banner).toContain('--allow-speed-regression')
  })

  it('loads the checked-in web-codecs headline snapshot and compares real timings', async () => {
    const snapshot = await loadPublishedHeadlineTimings(process.cwd(), 'web-codecs')
    expect(snapshot).not.toBeNull()
    if (snapshot === null) throw new Error('expected a web-codecs headline snapshot')
    const jpeg = snapshot.timings.find(
      (row) => row.engine === 'purejsimage' && row.workflow === 'jpeg-resize-1200',
    )
    expect(jpeg?.status).toBe('pass')
    expect(jpeg?.wallMilliseconds).toBeGreaterThan(50)

    const baseline = jpeg?.wallMilliseconds ?? 0
    const regressions = comparePublishedSpeed(
      [timing('purejsimage', 'jpeg-resize-1200', baseline * 1.2)],
      snapshot.timings,
    ).regressions
    expect(regressions).toHaveLength(1)
    expect(regressions[0]?.workflow).toBe('jpeg-resize-1200')
  })

  it('skips unofficial profiles and maps report results onto published timings', async () => {
    const check = await checkPublishedSpeed({
      repositoryDirectory: process.cwd(),
      profile: 'smoke',
      results: [result('jimp', 'smoke-resize', 100)],
    })
    expect(check.snapshotPath).toBeNull()
    expect(check.regressions).toEqual([])
    expect(publishedTimingsFromResults([result('purejsimage', 'jpeg-resize-1200', 800)])).toEqual([
      timing('purejsimage', 'jpeg-resize-1200', 800),
    ])
  })
})
