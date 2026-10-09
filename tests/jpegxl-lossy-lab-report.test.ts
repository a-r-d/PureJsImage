import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { QualityMetric } from '../benchmark/jpegxl/lossy-lab/metrics.ts'
import { renderBaselineReport } from '../benchmark/jpegxl/lossy-lab/report.ts'

function summary() {
  const metrics: QualityMetric[] = ['ssimulacra2', 'butteraugliMax', 'butteraugliNorm3']
  return {
    mode: 'screen',
    variant: 'baseline',
    selectedImages: 2,
    elapsedSeconds: 123.456,
    managedPeakBytes: 16_777_216,
    processPeakRssBytes: 67_108_864,
    comparisons: ['jsquash', 'vips'].flatMap((peer) =>
      metrics.flatMap((metric) => [
        { id: 'image-a:lab', peer, metric, percent: 10, coversRequiredRange: true },
        { id: 'image-b:lab', peer, metric, percent: 30, coversRequiredRange: true },
      ]),
    ),
    table: [],
    failures: [],
    omissions: [],
    drops: [],
    complete: true,
  }
}

function timing(count: number, median: number) {
  return { count, median, mean: median, p90: median, worst: median }
}

function speed() {
  return {
    mode: 'speed',
    variant: 'baseline',
    workers: 1,
    complete: true,
    managedPeakBytes: 33_554_432,
    processPeakRssBytes: 134_217_728,
    speed: [
      { engine: 'purejsimage', lab: timing(16, 400), watch: timing(2, 640_000) },
      { engine: 'jsquash', lab: timing(16, 100), watch: timing(2, 64_000) },
      { engine: 'vips', lab: timing(16, 200), watch: timing(2, 128_000) },
    ],
    failures: [],
    omissions: [],
  }
}

describe('lossy lab baseline report', () => {
  it('renders six rows from per-image comparisons and reports complete counts', () => {
    const value = summary()
    const before = structuredClone(value)
    const report = renderBaselineReport(value)
    expect(report).toContain('Status: **complete for selected images**')
    expect(report).toContain('Computed comparisons: 12/12; required-range coverage: 12/12')
    for (const metric of ['SSIMULACRA2', 'Butteraugli max', 'Butteraugli 3-norm']) {
      for (const peer of ['jSquash', 'wasm-vips']) {
        expect(report).toContain(
          `| ${metric} | ${peer} | +20.00% | +20.00% | +28.00% | +30.00% | 2/2 | 2/2 |`,
        )
      }
    }
    expect(report).toContain('16.00 MiB; process peak RSS: 64.00 MiB')
    expect(report).toContain('Isolated speed summary not supplied')
    expect(value).toEqual(before)
  })

  it('keeps partial-interval values in aggregates while marking the baseline incomplete', () => {
    const value = summary()
    const row = value.comparisons.find(
      (row) => row.id === 'image-b:lab' && row.peer === 'jsquash' && row.metric === 'ssimulacra2',
    )
    if (!row) throw new Error('Missing test comparison')
    row.percent = 200
    row.coversRequiredRange = false
    const report = renderBaselineReport(value)
    expect(report).toContain('Status: **incomplete**')
    expect(report).toContain('required-range coverage: 11/12')
    expect(report).toContain(
      '| SSIMULACRA2 | jSquash | +105.00% | +105.00% | +181.00% | +200.00% | 2/2 | 1/2 |',
    )
    expect(report).toContain('Partial overlap: image-b:lab / jSquash / SSIMULACRA2')
  })

  it('shows missing comparisons even when the runner did not add an omission', () => {
    const value = summary()
    value.comparisons = value.comparisons.slice(1)
    const report = renderBaselineReport(value)
    expect(report).toContain('Status: **incomplete**')
    expect(report).toContain('Computed comparisons: 11/12')
    expect(report).toContain('jSquash / SSIMULACRA2: 1 missing image comparisons')
  })

  it('shows empty rows as unavailable and retains diagnostic text safely', () => {
    const report = renderBaselineReport({
      ...summary(),
      comparisons: [],
      failures: [{ id: 'image-a', engine: 'purejsimage', detail: 'bad | output\n# injected' }],
      omissions: [{ id: 'image-b', engine: 'vips', reason: 'No overlap' }],
      drops: [{ id: 'smaller', kind: 'crop-size', reason: 'Budget reduction' }],
    })
    expect(report).toContain('| Butteraugli max | wasm-vips | N/A | N/A | N/A | N/A | 0/2 | 0/2 |')
    expect(report).toContain('Failure: image-a / PureJsImage: bad \\| output \\# injected')
    expect(report).toContain('Omission: image-b / wasm-vips: No overlap')
    expect(report).toContain('smaller / crop-size: Budget reduction')
    expect(report).not.toContain('\n# injected')
  })

  it('honors a pending runner result and missing memory measurements', () => {
    const report = renderBaselineReport({
      ...summary(),
      complete: false,
      managedPeakBytes: null,
      processPeakRssBytes: undefined,
    })
    expect(report).toContain('Status: **incomplete**')
    expect(report).toContain('managed peak: Not reported; process peak RSS: Not reported')
  })

  it('renders isolated lab and two-original median ratios separately', () => {
    const report = renderBaselineReport(summary(), speed())
    expect(report).toContain('| Lab | jSquash | 400.00 ms | 100.00 ms | 4.00x | 16 / 16 |')
    expect(report).toContain('| Lab | wasm-vips | 400.00 ms | 200.00 ms | 2.00x | 16 / 16 |')
    expect(report).toContain(
      '| Full-resolution originals | jSquash | 640000.00 ms | 64000.00 ms | 10.00x | 2 / 2 |',
    )
    expect(report).toContain(
      '| Full-resolution originals | wasm-vips | 640000.00 ms | 128000.00 ms | 5.00x | 2 / 2 |',
    )
    expect(report).toContain('Speed managed peak: 32.00 MiB; process peak RSS: 128.00 MiB')
    expect(report).not.toContain('Two-original speed coverage is incomplete')
  })

  it('does not calculate ratios from unmatched or missing speed samples', () => {
    const value = speed()
    const own = value.speed.find((row) => row.engine === 'purejsimage')
    if (!own) throw new Error('Missing test timing')
    own.watch.count = 1
    value.speed = value.speed.filter((row) => row.engine !== 'vips')
    const report = renderBaselineReport(summary(), value)
    expect(report).toContain(
      '| Full-resolution originals | jSquash | 640000.00 ms | 64000.00 ms | N/A | 1 / 2 |',
    )
    expect(report).toContain('Two-original speed coverage is incomplete: 1/2 own samples')
    expect(report).toContain('Missing speed engine: wasm-vips')
  })

  it('rejects nonisolated or different-variant speed summaries', () => {
    expect(() => renderBaselineReport(summary(), { ...speed(), mode: 'lab' })).toThrow(/isolated/)
    expect(() => renderBaselineReport(summary(), { ...speed(), workers: 2 })).toThrow(/isolated/)
    expect(() => renderBaselineReport(summary(), { ...speed(), workers: undefined })).toThrow(
      /isolated/,
    )
    expect(() => renderBaselineReport(summary(), { ...speed(), variant: 'candidate' })).toThrow(
      /variants/,
    )
  })

  it('rejects malformed external input and duplicate comparisons', () => {
    expect(() => renderBaselineReport(null)).toThrow()
    expect(() => renderBaselineReport({ ...summary(), selectedImages: 1.5 })).toThrow()
    expect(() => renderBaselineReport({ ...summary(), selectedImages: 0 })).toThrow()
    expect(() => renderBaselineReport({ ...summary(), complete: 'true' })).toThrow()
    expect(() => renderBaselineReport({ ...summary(), comparisons: {} })).toThrow()
    expect(() => renderBaselineReport({ ...summary(), managedPeakBytes: -1 })).toThrow()
    const value = summary()
    const row = value.comparisons[0]
    if (!row) throw new Error('Missing test comparison')
    expect(() =>
      renderBaselineReport({ ...value, comparisons: [...value.comparisons, row] }),
    ).toThrow(/Duplicate/)
    expect(() =>
      renderBaselineReport({ ...value, comparisons: [{ ...row, percent: Number.NaN }] }),
    ).toThrow(/finite/)
    expect(() =>
      renderBaselineReport({ ...value, comparisons: [{ ...row, metric: 'invalid' }] }),
    ).toThrow(/metric/)
  })

  it('distinguishes fixed quality bands from historical common-interval reports', () => {
    const report = renderBaselineReport({ ...summary(), intervalPolicy: 'required-ranges' })
    expect(report).toContain('SSIMULACRA2 integrates over 60–90')
    expect(report).toContain('Butteraugli max over 0.5–3')
    expect(report).toContain('Butteraugli 3-norm uses the common measured interval')
    expect(renderBaselineReport(summary())).toContain('Every computable common interval')
    expect(() => renderBaselineReport({ ...summary(), intervalPolicy: 'unknown' })).toThrow(
      'Unknown quality interval policy',
    )
  })

  it('provides a CLI that writes only the requested Markdown file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'jpegxl-lossy-report-'))
    try {
      const source = join(directory, 'summary.json')
      const speedPath = join(directory, 'speed.json')
      const output = join(directory, 'reports', 'baseline.md')
      await writeFile(source, JSON.stringify(summary()))
      await writeFile(speedPath, JSON.stringify(speed()))
      const result = spawnSync(
        process.execPath,
        [
          '--experimental-strip-types',
          resolve('benchmark/jpegxl/lossy-lab/report.ts'),
          '--summary',
          source,
          '--speed',
          speedPath,
          '--out',
          output,
        ],
        { encoding: 'utf8' },
      )
      expect(result.status, result.stderr).toBe(0)
      expect(await readFile(output, 'utf8')).toBe(renderBaselineReport(summary(), speed()))
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
