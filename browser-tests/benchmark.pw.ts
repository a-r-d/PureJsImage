import { mkdir, writeFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { BrowserBenchmarkReport } from './types.ts'

const jsonPath = 'benchmark/results/browser-chromium-2026-08-08.json'
const markdownPath = 'benchmark/results/browser-chromium-2026-08-08.md'

const fixed = (value: number): string => value.toFixed(2)

const markdownReport = (report: BrowserBenchmarkReport): string => {
  const rows = report.measurements.map(
    (measurement) =>
      `| ${measurement.label} | ${measurement.scope} | ${fixed(measurement.moduleInitializationMilliseconds)} ms | ${fixed(measurement.firstOperationMilliseconds)} ms | ${fixed(measurement.warmMedianMilliseconds)} ms | ${measurement.outputBytes} | ${measurement.javascriptBytesLoaded} | ${measurement.wasmBytesLoaded} | ${measurement.correctness} |`,
  )
  return (
    `# Chromium browser performance baseline\n\n` +
    `Browser: \`${report.browser}\`\n\n` +
    `Each warm value is the median of ${report.warmRuns} runs. ${report.note}\n\n` +
    `| Workflow | Scope | Module init | First operation | Warm median | Output bytes | JS bytes loaded | WASM bytes loaded | Correctness |\n` +
    `| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |\n` +
    `${rows.join('\n')}\n`
  )
}

test('records scoped Chromium browser baselines', async ({ browserName, page }) => {
  expect(browserName).toBe('chromium')
  test.setTimeout(180_000)
  await page.goto('/')
  await page.waitForFunction(() => typeof window.pureJsImageBrowserBenchmark === 'object')
  const report = await page.evaluate(() => window.pureJsImageBrowserBenchmark.run())

  expect(report.measurements).toHaveLength(10)
  expect(report.measurements.every(({ correctness }) => correctness.length > 0)).toBe(true)
  expect(report.measurements.every(({ outputBytes }) => outputBytes > 0)).toBe(true)
  expect(
    report.measurements
      .filter(({ label }) => label.startsWith('jSquash'))
      .every(({ scope }) => scope === 'codec-only'),
  ).toBe(true)
  expect(report.note).toContain('not complete pipeline comparisons')

  if (process.env.PUREJSIMAGE_WRITE_BROWSER_BENCHMARK === '1') {
    await mkdir('benchmark/results', { recursive: true })
    await writeFile(jsonPath, `${JSON.stringify(report, undefined, 2)}\n`)
    await writeFile(markdownPath, markdownReport(report))
  }
})
