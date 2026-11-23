import { defineConfig, devices } from '@playwright/test'

const port = Number(process.env.PUREJSIMAGE_BROWSER_PORT ?? '4173')
// Heavy JPEG XL parity files repeat long encoder searches in every browser. Local runs keep them
// in Chromium; CI and `npm run browser:test:full` run them in Firefox and WebKit too.
const fullBrowserRun = Boolean(process.env.CI) || process.env.PUREJSIMAGE_BROWSER_FULL === '1'
const nonChromiumTestIgnore = [
  '**/benchmark.pw.ts',
  '**/scientific-competitors.pw.ts',
  '**/viewer-benchmarks.pw.ts',
  ...(fullBrowserRun
    ? []
    : [
        '**/jpegxl-pipeline.pw.ts',
        '**/jpegxl-luma-contexts.pw.ts',
        '**/jpegxl-cone-selection.pw.ts',
        '**/jpegxl-fine-selection.pw.ts',
      ]),
]

export default defineConfig({
  testDir: './browser-tests',
  testMatch: '**/*.pw.ts',
  testIgnore: '**/viewer-benchmarks.pw.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 4 : '50%',
  reporter: 'line',
  timeout: 120_000,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    headless: true,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
        launchOptions: { chromiumSandbox: true },
      },
    },
    {
      name: 'firefox',
      testIgnore: nonChromiumTestIgnore,
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      testIgnore: nonChromiumTestIgnore,
      use: { ...devices['Desktop Safari'] },
    },
  ],
  webServer: {
    command: 'node scripts/serve-browser-tests.ts',
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
