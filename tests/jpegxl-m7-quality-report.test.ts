import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import selection from '../benchmark/jpegxl/production-program/m7-corpus-selection.json' with {
  type: 'json',
}

it('keeps missing and failed quality curves visible in photo and document strata', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jpegxl-m7-quality-report-'))
  try {
    await writeFile(
      join(directory, 'protocol.json'),
      JSON.stringify({ split: 'development', sourceFingerprint: 'fixture' }),
    )
    for (const [id, ratio, failed] of [
      ['im26-1030', 1.2, false],
      ['im26-5032', 2.4, false],
      ['im26-1214', 1, true],
    ] as const) {
      const entry = selection.cases.find((entry) => entry.id === id)
      if (!entry) throw new Error('Missing fixture identity')
      const points: object[] = []
      for (const engine of ['purejsimage', 'libjxl', 'mozjpeg', 'webp', 'avif']) {
        const settings =
          engine === 'purejsimage' || engine === 'libjxl'
            ? [0.25, 0.5, 1, 2, 3, 5]
            : [40, 55, 70, 80, 90, 97]
        for (const [index, setting] of settings.entries())
          points.push(
            failed && engine === 'purejsimage' && index === 0
              ? { engine, setting, status: 'failed', error: 'oracle failure' }
              : {
                  engine,
                  setting,
                  status: 'measured',
                  bytes: 100 * (index + 1) * (engine === 'purejsimage' ? ratio : 1),
                  ssimulacra2: 60 + index * 7,
                  butteraugli: 3 - index * 0.5,
                },
          )
      }
      await mkdir(join(directory, id))
      await writeFile(
        join(directory, id, 'report.json'),
        JSON.stringify({
          id,
          sourceSha256: entry.sourceSha256,
          sourceFingerprint: 'fixture',
          points,
        }),
      )
    }
    execFileSync(process.execPath, ['benchmark/jpegxl/report-m7-lossy-development.ts', directory], {
      timeout: 10_000,
      stdio: 'pipe',
    })
    const report: unknown = JSON.parse(await readFile(join(directory, 'summary.json'), 'utf8'))
    const matched = (ratio: number, missing: number) =>
      expect.objectContaining({
        metric: 'ssimulacra2',
        score: 80,
        engine: 'libjxl',
        matched: 1,
        missingOrUnbracketed: missing,
        medianRatio: expect.closeTo(ratio, 10),
      })
    expect(report).toMatchObject({
      complete: 2,
      missing: 117,
      failed: 1,
      stablePromotionGatePassed: false,
      stratifiedSummaries: expect.arrayContaining([
        expect.objectContaining({
          name: 'photos',
          expected: 64,
          summaries: expect.arrayContaining([matched(1.2, 63)]),
        }),
        expect.objectContaining({
          name: '5000-national-park-service-brochures',
          expected: 8,
          summaries: expect.arrayContaining([matched(2.4, 7)]),
        }),
      ]),
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
