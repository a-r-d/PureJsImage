import { defineConfig, devices } from '@playwright/test'

const port = Number(process.env.PUREJSIMAGE_BROWSER_PORT ?? '4173')
const nonChromiumTestIgnore = [
  '**/benchmark.pw.ts',
  '**/scientific-competitors.pw.ts',
  '**/viewer-benchmarks.pw.ts',
]

export default defineConfig({
  testDir: './browser-tests',
  testMatch: '**/*.pw.ts',
  testIgnore: '**/viewer-benchmarks.pw.ts',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: 'line',
  timeout: 120_000,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    headless: true,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
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
