import { mkdir, writeFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { ScientificCompetitorBrowserReport } from './types.ts'

const outputDirectory = 'benchmark/scientific-readers/results/artifacts/scientific-competitors'

const markdown = (report: ScientificCompetitorBrowserReport): string => {
  const rows = report.rows.map(
    (row) =>
      `| ${row.engine} | ${row.workload} | ${row.status} | ${row.totalWallMilliseconds.toFixed(2)} ms | ${row.firstUsableDataMilliseconds?.toFixed(2) ?? '—'} ms | ${row.sourceBytes} | ${row.requiredInputCopyBytes} | ${row.outputBytes} | ${row.sampleSha256 ?? '—'} |`,
  )
  return [
    '# Scientific competitor Chromium smoke',
    '',
    `Browser: ${report.browser}`,
    '',
    report.note,
    '',
    '| Engine | Workload | Status | Wall | First data | Source bytes | Input copy | Output | Sample SHA-256 |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |',
    ...rows,
    '',
  ].join('\n')
}

test('runs the separate Chromium scientific competitor smoke', async ({ browserName, page }) => {
  test.setTimeout(180_000)
  expect(browserName).toBe('chromium')
  await page.goto('/')
  await page.waitForFunction(() => typeof window.pureJsImageScientificCompetitors === 'object')
  const report = await page.evaluate(() => window.pureJsImageScientificCompetitors.run())
  const requiredEngines = [
    'geotiff',
    'tiff',
    'utif2',
    'image-js',
    'nifti-reader-js',
    'npyjs',
    'jsfive',
    'h5wasm',
    'itk-wasm-image-io',
  ]
  for (const engine of requiredEngines) {
    expect(report.rows.some(({ engine: rowEngine }) => rowEngine === engine)).toBe(true)
  }
  expect(report.rows.some(({ status }) => status === 'unsupported')).toBe(true)
  for (const engine of [
    'geotiff',
    'tiff',
    'utif2',
    'image-js',
    'nifti-reader-js',
    'npyjs',
    'jsfive',
  ]) {
    const supported = report.rows.filter(
      ({ engine: rowEngine, status }) => rowEngine === engine && status === 'supported',
    )
    expect(supported.length).toBeGreaterThan(0)
    expect(
      supported.every(
        ({ outputBytes, workload }) =>
          outputBytes > 0 ||
          engine === 'geotiff' ||
          (engine === 'jsfive' && workload === 'hdf5-hierarchy'),
      ),
    ).toBe(true)
  }
  await mkdir(outputDirectory, { recursive: true })
  await writeFile(
    `${outputDirectory}/competitors-browser.json`,
    `${JSON.stringify(report, null, 2)}\n`,
  )
  await writeFile(`${outputDirectory}/competitors-browser.md`, markdown(report))
})
