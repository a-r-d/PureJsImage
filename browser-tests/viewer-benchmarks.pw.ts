import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { type Browser, expect, test } from '@playwright/test'

import type {
  ViewerBenchmarkProfile,
  ViewerBenchmarkReport,
  ViewerBenchmarkRunOptions,
  ViewerBrowser,
  ViewerCacheMode,
  ViewerFamily,
  ViewerLatencyProfile,
} from '../benchmark/viewers/types.ts'

const profileFromEnvironment = (): ViewerBenchmarkProfile => {
  const value = process.env.PUREJSIMAGE_VIEWER_PROFILE
  if (value === 'ome-tiff' || value === 'volumes' || value === 'cog') return value
  return 'smoke'
}

const latencyProfileFromEnvironment = (): ViewerLatencyProfile => {
  const value = Number(process.env.PUREJSIMAGE_VIEWER_LATENCY_MS ?? '0')
  if (value === 0 || value === 5 || value === 25 || value === 100) return value
  throw new Error(
    `PUREJSIMAGE_VIEWER_LATENCY_MS must be one of 0, 5, 25, or 100; received ${value}`,
  )
}

const cacheModeFromEnvironment = (): ViewerCacheMode => {
  const value = process.env.PUREJSIMAGE_VIEWER_CACHE_MODE ?? 'immutable'
  if (value === 'no-store' || value === 'revalidate' || value === 'immutable') return value
  throw new Error(
    `PUREJSIMAGE_VIEWER_CACHE_MODE must be no-store, revalidate, or immutable; received ${value}`,
  )
}

const throughputFromEnvironment = (): number | null => {
  const raw = process.env.PUREJSIMAGE_VIEWER_THROUGHPUT_BPS
  if (raw === undefined || raw.length === 0) return null
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`PUREJSIMAGE_VIEWER_THROUGHPUT_BPS must be positive; received ${raw}`)
  }
  return value
}

const browserFromProject = (name: string): ViewerBrowser => {
  if (name === 'firefox') return 'firefox'
  if (name === 'webkit') return 'webkit'
  return 'chromium'
}

const markdown = (report: ViewerBenchmarkReport): string => {
  const lines = [
    `# Scientific viewer benchmark (${report.scope}, ${report.browser}, ${report.phase})`,
    '',
    `Generated: ${report.generatedAt}`,
    '',
    `Latency profile: ${report.latencyProfileMilliseconds} ms`,
    `Cache profile: ${report.cacheMode}`,
    `Throughput profile: ${report.throughputBytesPerSecond === null ? 'unlimited' : `${report.throughputBytesPerSecond} bytes/s`}`,
    '',
    report.notes.map((note) => `- ${note}`).join('\n'),
    '',
    '| Engine | Workload | Status | Requests | Returned bytes | First visible (ms) | Stable viewport (ms) |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: |',
  ]
  for (const sample of report.samples) {
    lines.push(
      `| ${sample.engine.id} | ${sample.workload.id} | ${sample.status}${sample.statusReason === null ? '' : ` (${sample.statusReason})`} | ${sample.data.requests} | ${sample.data.returnedBytes} | ${sample.latency.firstVisiblePixelsMilliseconds ?? '-'} | ${sample.latency.stableCompletedViewportMilliseconds ?? '-'} |`,
    )
  }
  return `${lines.join('\n')}\n`
}

const writeReport = async (
  report: ViewerBenchmarkReport,
  profile: ViewerBenchmarkProfile,
  browser: ViewerBrowser,
): Promise<void> => {
  const directory = resolve(process.env.PUREJSIMAGE_VIEWER_RESULTS ?? 'benchmark/viewers/results')
  await mkdir(directory, { recursive: true })
  const profileSuffix =
    report.cacheMode === 'immutable' && report.throughputBytesPerSecond === null
      ? ''
      : `-${report.cacheMode}-${report.throughputBytesPerSecond === null ? 'unlimited' : `${report.throughputBytesPerSecond}bps`}`
  const prefix = `viewer-${profile}-${report.scope}-${browser}-${report.phase}-${report.latencyProfileMilliseconds}ms${profileSuffix}`
  await writeFile(resolve(directory, `${prefix}.json`), `${JSON.stringify(report, null, 2)}\n`)
  await writeFile(resolve(directory, `${prefix}.md`), markdown(report))
}

const familyReport = (report: ViewerBenchmarkReport, scope: ViewerFamily): ViewerBenchmarkReport =>
  Object.freeze({
    ...report,
    scope,
    engines: Object.freeze(report.engines.filter((engine) => engine.family === scope)),
    workloads: Object.freeze(report.workloads.filter((workload) => workload.family === scope)),
    samples: Object.freeze(report.samples.filter((sample) => sample.engine.family === scope)),
  })

const runInContext = async (
  browser: Browser,
  baseURL: string,
  options: ViewerBenchmarkRunOptions,
): Promise<ViewerBenchmarkReport> => {
  const context = await browser.newContext({ baseURL })
  try {
    const page = await context.newPage()
    page.on('console', (message) => console.log(`[viewer:${message.type()}] ${message.text()}`))
    page.on('pageerror', (error) => console.log(`[viewer:pageerror] ${error.message}`))
    page.on('crash', () => console.log('[viewer:crash] page crashed'))
    await page.goto('/')
    await page.waitForFunction(() => typeof window.pureJsImageViewerBenchmark?.run === 'function')
    const report = await page.evaluate(
      async (runOptions) => window.pureJsImageViewerBenchmark.run(runOptions),
      options,
    )
    return report
  } finally {
    await context.close()
  }
}

test('scientific viewer benchmark lane records cold and warm reports', async ({
  browser,
}, testInfo) => {
  const profile = profileFromEnvironment()
  const browserName = browserFromProject(testInfo.project.name)
  const latencyProfileMilliseconds = latencyProfileFromEnvironment()
  const cacheMode = cacheModeFromEnvironment()
  const throughputBytesPerSecond = throughputFromEnvironment()
  const baseURL = `http://127.0.0.1:${Number(process.env.PUREJSIMAGE_VIEWER_PORT ?? '4174')}`
  const cold = await runInContext(browser, baseURL, {
    profile,
    phase: 'cold',
    latencyProfileMilliseconds,
    cacheMode,
    throughputBytesPerSecond,
    browser: browserName,
  })
  const warm = await runInContext(browser, baseURL, {
    profile,
    phase: 'warm',
    latencyProfileMilliseconds,
    cacheMode,
    throughputBytesPerSecond,
    browser: browserName,
  })
  const scopes = new Set<ViewerFamily>()
  for (const sample of cold.samples) scopes.add(sample.engine.family)
  for (const scope of scopes) {
    await writeReport(familyReport(cold, scope), profile, browserName)
    await writeReport(familyReport(warm, scope), profile, browserName)
  }
  for (const report of [cold, warm]) {
    expect(report.schemaVersion).toBe(1)
    expect(report.samples.length).toBeGreaterThan(0)
    for (const sample of report.samples) {
      if (sample.status === 'supported' && sample.workload.layer !== 'loader-only') {
        expect(
          sample.correctness?.passed,
          `${sample.engine.id}/${sample.workload.id} failed correctness`,
        ).toBe(true)
      }
      expect(sample.status).not.toBe('invalid-output')
    }
  }
})
