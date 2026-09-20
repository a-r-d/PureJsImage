import { expect, it } from 'vitest'
import { m7ExpansionCases, m7ExpansionSplit } from '../benchmark/jpegxl/m7-expansion-selection.ts'

it('preserves development as the default and rejects ambiguous expansion splits', () => {
  expect(m7ExpansionSplit(undefined)).toBe('development')
  expect(m7ExpansionSplit('development')).toBe('development')
  expect(m7ExpansionSplit('holdout')).toBe('holdout')
  for (const value of ['', 'all', 'test', null, 1])
    expect(() => m7ExpansionSplit(value)).toThrow('Invalid M7 expansion split')
})

it('retains every frozen expansion family in exactly one native-domain split', () => {
  const ids = new Set<string>()
  for (const split of ['development', 'holdout'] as const)
    for (const format of ['hdr', 'png'] as const) {
      const cases = m7ExpansionCases(split, format)
      expect(cases).toHaveLength(6)
      for (const entry of cases) {
        expect(entry.split).toBe(split)
        expect(entry.format).toBe(format)
        expect(entry.status).toBe('verified')
        expect(ids.has(entry.id)).toBe(false)
        ids.add(entry.id)
      }
    }
  expect(ids.size).toBe(24)
})

it('reports held-out alpha curves without borrowing development families', async () => {
  const { execFileSync } = await import('node:child_process')
  const { mkdir, mkdtemp, readFile, rm, writeFile } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join, resolve } = await import('node:path')
  const directory = await mkdtemp(join(tmpdir(), 'jpegxl-m7-expansion-'))
  const script = resolve('benchmark/jpegxl/report-m7-expansion-quality.ts')
  const entry = m7ExpansionCases('holdout', 'png')[0]
  if (!entry) throw new Error('Missing frozen held-out alpha fixture')
  try {
    const root = join(directory, '.tmp/jpegxl-m7/alpha-holdout-fixture')
    await mkdir(join(root, entry.id), { recursive: true })
    const protocol = {
      split: 'holdout',
      sourceFiles: [],
      oracleFiles: [],
      mappingProtocolSha256: 'fixture',
    }
    await writeFile(join(root, 'protocol.json'), JSON.stringify(protocol))
    const points: object[] = []
    for (const engine of ['purejsimage', 'libjxl', 'webp', 'avif']) {
      const settings =
        engine === 'purejsimage' || engine === 'libjxl'
          ? [0.25, 0.5, 1, 2, 3, 5]
          : [40, 55, 70, 80, 90, 97]
      for (const [index, setting] of settings.entries())
        points.push({
          engine,
          setting,
          status: 'measured',
          bytes: 100 * (index + 1),
          composites: ['black', 'white'].map((background) => ({
            background,
            ssimulacra2: 60 + index * 7,
            butteraugli: 3 - index * 0.5,
          })),
        })
    }
    await writeFile(
      join(root, entry.id, 'report.json'),
      JSON.stringify({
        id: entry.id,
        sourceSha256: entry.sourceSha256,
        points,
      }),
    )
    const run = () =>
      execFileSync(process.execPath, [script, 'fixture', 'alpha'], {
        cwd: directory,
        env: { ...process.env, PUREJSIMAGE_M7_EXPANSION_SPLIT: 'holdout' },
        stdio: 'pipe',
        timeout: 10_000,
      })
    run()
    const report: unknown = JSON.parse(
      await readFile(
        join(directory, '.tmp/jpegxl-m7/expansion-quality-holdout-fixture-summary.json'),
        'utf8',
      ),
    )
    expect(report).toMatchObject({
      split: 'holdout',
      stablePromotionGatePassed: false,
      errors: expect.any(Array),
      summaries: expect.arrayContaining([
        expect.objectContaining({
          domain: 'background-black',
          metric: 'ssimulacra2',
          score: 80,
          engine: 'libjxl',
          matched: 1,
          missingOrUnbracketed: 5,
          medianRatio: 1,
        }),
      ]),
      matches: expect.arrayContaining([expect.objectContaining({ id: entry.id })]),
    })
    await writeFile(
      join(root, 'protocol.json'),
      JSON.stringify({ ...protocol, split: 'development' }),
    )
    expect(run).toThrow()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
