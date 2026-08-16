import { defineConfig, devices } from '@playwright/test'

const port = Number(process.env.PUREJSIMAGE_VIEWER_PORT ?? '4174')

export default defineConfig({
  testDir: './browser-tests',
  testMatch: '**/viewer-benchmarks.pw.ts',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: 'line',
  timeout: 300_000,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    headless: true,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: 'node benchmark/viewers/http-server.ts',
    url: `http://127.0.0.1:${port}/__viewer/health`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
