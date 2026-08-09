import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

test('detects, transforms, converts, measures, and downloads from the docs demo', async ({
  page,
}) => {
  const requestedUrls: string[] = []
  page.on('request', (request) => requestedUrls.push(request.url()))
  await page.goto('/demo.html')
  await page.waitForFunction(() => window.pureJsImageDemoReady === true)

  const input = await readFile('benchmark/.tmp/browser-tests/fixtures/benchmark-input.png')
  await page.locator('#demo-file').setInputFiles({
    buffer: input,
    mimeType: 'image/jpeg',
    name: 'misleading-extension.jpg',
  })

  await expect(page.locator('#demo-source-details')).toContainText('640 × 480')
  await expect(page.locator('#demo-source-badges')).toContainText('PNG')
  await expect(page.locator('#demo-controls')).toBeEnabled()

  await page.locator('#demo-output-format').selectOption('jpeg')
  await page.locator('#demo-resize-enabled').check()
  await page.locator('#demo-resize-width').fill('120')
  await page.locator('#demo-rotation').selectOption('90')
  await page.locator('#demo-convert').click()

  await expect(page.locator('#demo-result')).toBeVisible()
  await expect(page.locator('#demo-result-summary')).toContainText('JPEG · 90 × 120')
  await expect(page.locator('#demo-download')).toHaveAttribute(
    'download',
    'misleading-extension-converted.jpg',
  )
  await expect(page.locator('#demo-metric-elapsed')).not.toHaveText('—')
  await expect(page.locator('#demo-metric-output')).not.toHaveText('—')
  await expect(page.locator('#demo-log-list')).toContainText('PNG detected from content')
  await expect(page.locator('#demo-log-list')).toContainText('Conversion time:')
  await expect(page.locator('#demo-log-list')).toContainText('Maximum observed JS heap:')
  await expect(page.locator('#demo-log-list')).toContainText('Known input + output file bytes:')

  const networkRequests = requestedUrls.filter((url) => /^https?:/.test(url))
  expect(networkRequests.length).toBeGreaterThan(0)
  expect(
    networkRequests.every((url) => url.startsWith('http://127.0.0.1:')),
    `Unexpected external request: ${networkRequests.find((url) => !url.startsWith('http://127.0.0.1:')) ?? 'unknown'}`,
  ).toBe(true)
})

test('toggles JPEG WASM acceleration and compares the same complete pipeline', async ({ page }) => {
  const requestedUrls: string[] = []
  page.on('request', (request) => requestedUrls.push(request.url()))
  await page.goto('/demo.html')
  await page.waitForFunction(() => window.pureJsImageDemoReady === true)

  const input = await readFile('benchmark/.tmp/browser-tests/fixtures/wasm-input.jpg')
  await page.locator('#demo-file').setInputFiles({
    buffer: input,
    mimeType: 'image/jpeg',
    name: 'wasm-input.jpg',
  })

  await expect(page.locator('#demo-source-badges')).toContainText('JPEG')
  await expect(page.locator('#demo-controls')).toBeEnabled()
  await page.locator('#demo-output-format').selectOption('bmp')
  await expect(page.locator('#demo-convert-label')).toHaveText('Convert with TypeScript')
  await page.locator('#demo-convert').click()

  await expect(page.locator('#demo-result')).toBeVisible()
  await expect(page.locator('#demo-metric-provider')).toHaveText('TypeScript')
  await expect(page.locator('#demo-metric-comparison')).toHaveText('Run WASM to compare')

  await page.locator('#demo-wasm-enabled').check()
  await expect(page.locator('#demo-accelerator-status')).toContainText(
    'Eligible full-image baseline YCbCr JPEGs use it',
  )
  await expect(page.locator('#demo-convert-label')).toHaveText('Convert with WASM enabled')
  await page.locator('#demo-convert').click()

  await expect(page.locator('#demo-result')).toBeVisible()
  await expect(page.locator('#demo-metric-provider')).toHaveText('WASM enabled')
  await expect(page.locator('#demo-metric-comparison')).toHaveText(/% (?:faster|slower)/)
  await expect(page.locator('#demo-log-list')).toContainText(
    'Rust/WASM JPEG acceleration enabled for this run',
  )
  expect(requestedUrls.some((url) => url.endsWith('/assets/jpeg-decoder.wasm'))).toBe(true)
})

test('refuses to silently flatten an animated input to its first frame', async ({ page }) => {
  await page.goto('/demo.html')
  await page.waitForFunction(() => window.pureJsImageDemoReady === true)
  const input = await readFile('benchmark/.tmp/browser-tests/fixtures/animated.gif')
  await page.locator('#demo-file').setInputFiles({
    buffer: input,
    mimeType: 'image/gif',
    name: 'animated.gif',
  })

  await expect(page.locator('#demo-source-badges')).toContainText('2 frames')
  await expect(page.locator('#demo-controls')).toHaveAttribute('disabled', '')
  await expect(page.locator('#demo-convert')).toBeDisabled()
  await expect(page.locator('#demo-operation-status')).toContainText('refuses to silently convert')
  await expect(page.locator('#demo-result')).toBeHidden()
  await expect(page.locator('#demo-log-list')).toContainText(
    'no static first-frame output will be emitted',
  )
})

test('converts the supported primary image from an MPF JPEG', async ({ page }) => {
  await page.goto('/demo.html')
  await page.waitForFunction(() => window.pureJsImageDemoReady === true)
  const input = await readFile('benchmark/.tmp/browser-tests/fixtures/mpf-primary.jpg')
  await page.locator('#demo-file').setInputFiles({
    buffer: input,
    mimeType: 'image/jpeg',
    name: 'iphone-mpf.jpg',
  })

  await expect(page.locator('#demo-source-badges')).toContainText('2 images')
  await expect(page.locator('#demo-controls')).toBeEnabled()
  await expect(page.locator('#demo-operation-status')).toContainText(
    'conversion uses its supported primary image',
  )
  await expect(page.locator('#demo-log-list')).toContainText(
    'auxiliary images and gain maps are not preserved',
  )

  await page.locator('#demo-output-format').selectOption('bmp')
  await page.locator('#demo-resize-enabled').check()
  await page.locator('#demo-resize-width').fill('200')
  await page.locator('#demo-convert').click()

  await expect(page.locator('#demo-result')).toBeVisible()
  await expect(page.locator('#demo-result-summary')).toContainText('BMP · 200 × 150')
  await expect(page.locator('#demo-log-list')).toContainText('BMP output validated as 200×150')
})

test('converts a progressive JPEG with AC-refinement ZRLs to WebP', async ({ page }) => {
  await page.goto('/demo.html')
  await page.waitForFunction(() => window.pureJsImageDemoReady === true)
  const input = await readFile(
    'benchmark/corpus/files/jpeg-reference/generated-progressive-zrl.jpg',
  )
  await page.locator('#demo-file').setInputFiles({
    buffer: input,
    mimeType: 'image/jpeg',
    name: 'progressive-zrl.jpg',
  })

  await expect(page.locator('#demo-source-badges')).toContainText('JPEG')
  await page.locator('#demo-output-format').selectOption('webp')
  await page.locator('#demo-webp-lossless').check()
  await page.locator('#demo-resize-enabled').check()
  await page.locator('#demo-resize-width').fill('200')
  await page.locator('#demo-convert').click()

  await expect(page.locator('#demo-result')).toBeVisible()
  await expect(page.locator('#demo-result-summary')).toContainText('WebP · 200 × 133')
  await expect(page.locator('#demo-log-list')).toContainText('lossless WebP')
  await expect(page.locator('#demo-log-list')).toContainText('WebP output validated as 200×133')
  await expect(page.locator('#demo-log-list')).not.toContainText('ERROR')
})
