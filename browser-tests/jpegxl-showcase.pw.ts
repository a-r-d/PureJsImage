import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

test('converter and exact grayscale JPEG round trip stay local', async ({ page }) => {
  const requests: string[] = []
  page.on('request', (r) => {
    if (r.method() !== 'GET') requests.push(r.url())
  })
  await page.goto('/jpeg-xl/convert/')
  await expect(page.locator('#jxl-status')).toContainText('inspected and decoded locally')
  await page.locator('#jxl-encode').click()
  await expect(page.locator('#jxl-status')).toContainText('byte-exact local round trip verified')
  await page.locator('#jxl-reopen').click()
  await expect(page.locator('#jxl-status')).toContainText('.jxl inspected')
  await page.goto('/jpeg-xl/jpeg-recompression/')
  await expect(page.locator('#jxl-status')).toContainText('inspected and decoded locally')
  await page.locator('#jxl-open-gray').click()
  await expect(page.locator('#jxl-status')).toContainText('jpegxl-gray.jpg inspected')
  await page.locator('#jxl-transcode').click()
  await expect(page.locator('#jxl-status')).toContainText('verified locally')
  await page.locator('#jxl-reconstruct').click()
  await expect(page.locator('#jxl-status')).toContainText('Original JPEG bytes')
  const wait = page.waitForEvent('download')
  await page.locator('#jxl-download').click()
  const download = await wait,
    path = await download.path()
  if (!path) throw new Error('Missing download')
  expect(await readFile(path)).toEqual(
    await readFile('tests/fixtures/jpegxl/gray-exact/gray-baseline.jpg'),
  )
  expect(requests).toEqual([])
})

test('native float bits and alpha survive re-encoding', async ({ page }) => {
  await page.goto('/jpeg-xl/native/')
  await page.getByRole('button', { name: 'Float and alpha', exact: true }).click()
  await expect(page.locator('#tool-status')).toContainText('Native samples inspected')
  await expect(page.locator('#tool-details')).toContainText('floating-point')
  await page.locator('#tool-encode').click()
  await expect(page.locator('#tool-status')).toContainText('every stored sample bit matches')
  await page.locator('#tool-reopen').click()
  await expect(page.locator('#tool-status')).toContainText('Native samples inspected')
})

test('animation playback timing and selected-frame export', async ({ page }) => {
  await page.goto('/jpeg-xl/animation/')
  await page.getByRole('button', { name: 'Try the animation', exact: true }).click()
  await expect(page.locator('#tool-status')).toContainText('Frame 1 of 3')
  await expect(page.locator('#tool-summary')).toContainText('2 ticks at 10/1')
  await page.locator('#tool-next').click()
  await expect(page.locator('#tool-status')).toContainText('Frame 2 of 3')
  await page.locator('#tool-export').click()
  await expect(page.locator('#tool-status')).toContainText('exported as sRGB8 PNG')
})

test('progressive sample produces real stages and can cancel after opening', async ({ page }) => {
  await page.goto('/jpeg-xl/progressive/')
  await page.getByRole('button', { name: 'Try progressive stages', exact: true }).click()
  await expect(page.locator('#tool-stages li').first()).toContainText('complete')
  await page.locator('#tool-cancel').click()
  await expect(page.locator('#tool-status')).toContainText('Cancelled')
  await page.locator('#tool-run').click()
  await expect(page.locator('#tool-status')).toContainText('operation complete')
  expect(await page.locator('#tool-stages li').count()).toBeGreaterThan(1)
})

test('animation creation reorders local frames and reopens exact timing', async ({ page }) => {
  await page.goto('/jpeg-xl/animation/')
  await page.getByText('Create an animation', { exact: true }).click()
  await page
    .locator('#tool-frames')
    .setInputFiles([
      'tests/fixtures/jpegxl/gray-exact/gray-baseline.jpg',
      'tests/fixtures/jpegxl/gray-exact/gray-baseline.jpg',
    ])
  await page.locator('#tool-frame-list button').nth(1).click()
  await page.locator('#tool-duration').fill('37')
  await page.locator('#tool-loops').fill('2')
  await page.locator('#tool-encode').click()
  await expect(page.locator('#tool-status')).toContainText('Animation encoded')
  await page.locator('#tool-reopen').click()
  await expect(page.locator('#tool-status')).toContainText('Frame 1 of 2')
  await expect(page.locator('#tool-summary')).toContainText('37 ticks at 1000/1')
})

test('local names, metadata and bytes do not leave the browser; keyboard and narrow layouts work', async ({
  page,
}) => {
  const network: string[] = []
  page.on('request', (request) =>
    network.push(`${request.method()} ${request.url()} ${request.postData() ?? ''}`),
  )
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/jpeg-xl/native/')
  const file = await readFile(
    'benchmark/fixtures/jpegxl/generated-lossless-v0.12.0/gray8-linear.jxl',
  )
  await page
    .locator('#tool-file')
    .setInputFiles({ name: 'private-name-UNIQUE-734.jxl', mimeType: 'image/jxl', buffer: file })
  await expect(page.locator('#tool-status')).toContainText('Native samples inspected')
  await page.locator('#tool-run').focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('#tool-status')).toContainText('Native samples inspected')
  expect(network.every((r) => r.startsWith('GET ') && r.includes('127.0.0.1'))).toBe(true)
  expect(network.join('\n')).not.toContain('private-name-UNIQUE-734')
  expect(network.join('\n')).not.toMatch(
    /google-analytics|googletagmanager|sentry|wasm-vips|jsquash/,
  )
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true)
  await page
    .locator('#tool-file')
    .setInputFiles({ name: 'invalid.jxl', mimeType: 'image/jxl', buffer: Buffer.from('invalid') })
  await expect(page.locator('#tool-status')).not.toContainText('Working locally')
  await page.getByRole('button', { name: '16-bit samples', exact: true }).click()
  await expect(page.locator('#tool-status')).toContainText('Native samples inspected')
})

test('converter cancellation retries source and downloads remain usable', async ({ page }) => {
  await page.goto('/jpeg-xl/convert/')
  await expect(page.locator('#jxl-status')).toContainText('inspected', { timeout: 30_000 })
  await page.locator('#jxl-encode').click()
  await page.locator('#jxl-cancel').click()
  await expect(page.locator('#jxl-status')).toContainText('Cancelled')
  await page.locator('#jxl-encode').click()
  await expect(page.locator('#jxl-status')).toContainText('byte-exact local round trip verified')
  for (let i = 0; i < 2; i++) {
    const next = page.waitForEvent('download')
    await page.locator('#jxl-download').click()
    expect((await next).suggestedFilename()).toMatch(/\.jxl$/)
  }
})

test('replaced inputs ignore stale worker messages and recover from worker failure', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const Original = Worker,
      workers: Worker[] = []
    Object.defineProperty(window, 'jxlTestWorkers', { value: workers })
    Object.defineProperty(window, 'jxlTestLast', { value: undefined, writable: true })
    window.Worker = class extends Original {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options)
        workers.push(this)
        this.addEventListener('message', (e) =>
          Object.defineProperty(window, 'jxlTestLast', { value: e.data, writable: true }),
        )
      }
    }
  })
  await page.goto('/jpeg-xl/native/')
  await page.getByRole('button', { name: '16-bit samples', exact: true }).click()
  await expect(page.locator('#tool-status')).toContainText('Native samples inspected')
  await page.evaluate(() => {
    if ('jxlTestLast' in window)
      Object.defineProperty(window, 'jxlStale', { value: window.jxlTestLast })
  })
  await page.getByRole('button', { name: 'Float and alpha', exact: true }).click()
  await expect(page.locator('#tool-details')).toContainText('floating-point')
  await page.evaluate(() => {
    if (
      'jxlTestWorkers' in window &&
      Array.isArray(window.jxlTestWorkers) &&
      'jxlStale' in window
    ) {
      const old = window.jxlTestWorkers[0]
      if (old instanceof Worker)
        old.dispatchEvent(new MessageEvent('message', { data: window.jxlStale }))
    }
  })
  await expect(page.locator('#tool-details')).toContainText('floating-point')
  await page.evaluate(() => {
    if ('jxlTestWorkers' in window && Array.isArray(window.jxlTestWorkers)) {
      const current = window.jxlTestWorkers.at(-1)
      if (current instanceof Worker)
        current.dispatchEvent(new ErrorEvent('error', { message: 'Simulated worker failure' }))
    }
  })
  await expect(page.locator('#tool-status')).toContainText('Simulated worker failure')
  await page.locator('#tool-run').click()
  await expect(page.locator('#tool-status')).toContainText('Native samples inspected')
})

test('comparison and seven routes have distinct canonicals and usable evidence downloads', async ({
  page,
}) => {
  for (const path of [
    '',
    'convert/',
    'jpeg-recompression/',
    'animation/',
    'progressive/',
    'native/',
    'comparison/',
  ]) {
    await page.goto(`/jpeg-xl/${path}`)
    await expect(page.locator('h1')).toBeVisible()
    await expect(page.locator('link[rel=canonical]')).toHaveAttribute(
      'href',
      `https://purejsimage.com/jpeg-xl/${path}`,
    )
  }
  await expect(page.locator('main')).toContainText('1 of 24')
  await expect(page.locator('main')).toContainText('1.212')
  const response = await page.request.get('/jpeg-xl/evidence/website-data.json')
  expect(response.ok()).toBe(true)
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  )
  await page.goto('/jpeg-xl/#jxl-progressive-title')
  await expect(page).toHaveURL(/\/jpeg-xl\/progressive\//)
  await page.goto('/jpeg-xl/#jxl-transcode')
  await expect(page).toHaveURL(/\/jpeg-xl\/jpeg-recompression\//)
  await expect(page.locator('#jxl-transcode')).toBeVisible()
})

test('explicit URL input refuses unbounded full responses and can retry locally', async ({
  page,
  context,
}) => {
  await context.route('**/no-range-test.jxl', (route) =>
    route.fulfill({ status: 200, contentType: 'image/jxl', body: Buffer.alloc(4096) }),
  )
  await page.goto('/jpeg-xl/progressive/')
  await page.locator('#tool-url').fill(`${new URL(page.url()).origin}/no-range-test.jxl`)
  await page.locator('#tool-run').click()
  await expect(page.locator('#tool-status')).toContainText('full file instead of a byte range')
  await page.getByRole('button', { name: 'Try progressive stages', exact: true }).click()
  await expect(page.locator('#tool-status')).toContainText('operation complete')
})

test('capture actual tool outputs for showcase cards', async ({ page, browserName }) => {
  test.skip(
    process.env.PUREJSIMAGE_CAPTURE_JXL !== '1' || browserName !== 'chromium',
    'Manual asset capture only',
  )
  await page.setViewportSize({ width: 1280, height: 900 })
  for (const [tool, sample, ready] of [
    ['native', 'Float and alpha', 'Native samples inspected'],
    ['animation', 'Try the animation', 'Frame 1 of 3'],
    ['progressive', 'Try progressive stages', 'operation complete'],
  ] as const) {
    await page.goto(`/jpeg-xl/${tool}/`)
    await page.getByRole('button', { name: sample, exact: true }).click()
    await expect(page.locator('#tool-status')).toContainText(ready)
    await page.locator('#tool-canvas').screenshot({ path: `.tmp/jpegxl-showcase-${tool}.png` })
    await page.evaluate(() => scrollTo(0, 0))
    await page.screenshot({ path: `.tmp/jpegxl-showcase-${tool}-page.png`, fullPage: true })
  }
  for (const tool of ['convert', 'jpeg-recompression']) {
    await page.goto(`/jpeg-xl/${tool}/`)
    await expect(page.locator('#jxl-status')).toContainText('inspected', { timeout: 30_000 })
    await page.locator('#jxl-preview').screenshot({ path: `.tmp/jpegxl-showcase-${tool}.png` })
  }
  await page.goto('/jpeg-xl/comparison/')
  await page.locator('.jxl-tool-cards').screenshot({ path: '.tmp/jpegxl-showcase-comparison.png' })
  await page.evaluate(() => scrollTo(0, 0))
  await page.screenshot({ path: '.tmp/jpegxl-showcase-comparison-page.png', fullPage: true })
  await page.goto('/jpeg-xl/')
  await page.screenshot({ path: '.tmp/jpegxl-showcase-hub-page.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: '.tmp/jpegxl-showcase-hub-narrow.png', fullPage: true })
})

test('converter preserves lower-depth native JXL precision during lossless re-encode', async ({
  page,
}) => {
  await page.goto('/jpeg-xl/convert/')
  await expect(page.locator('#jxl-status')).toContainText('inspected', { timeout: 30_000 })
  await page
    .locator('#jxl-file')
    .setInputFiles('benchmark/fixtures/jpegxl/generated-lossless-v0.12.0/rgb10-linear.jxl')
  await expect(page.locator('#jxl-status')).toContainText('rgb10-linear.jxl inspected')
  await page.locator('#jxl-encode').click()
  await expect(page.locator('#jxl-status')).toContainText('byte-exact local round trip verified')
  await expect(page.locator('#jxl-details')).toContainText('"bitDepth": 10')
})
