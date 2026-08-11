import { expect, test } from '@playwright/test'

test('streams, draws, measures, caches, cancels, and resets native SVS tiles', async ({ page }) => {
  const externalRequests: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.hostname !== '127.0.0.1') externalRequests.push(request.url())
  })
  await page.goto('/wsi/?url=/fixtures/aperio-cmu-1-small-region.svs%3FrangeDelay%3D75')
  await page.waitForFunction(() => window.pureJsImageWsiReady === true)

  await expect(async () => {
    const status = await page.locator('#wsi-status').textContent()
    expect(await page.locator('#wsi-stat-slide').textContent(), status ?? undefined).toBe(
      'CMU-1.svs',
    )
  }).toPass({ timeout: 15_000 })
  await expect(page.locator('#wsi-stat-size')).toContainText('1.85 MiB')
  await expect(page.locator('#wsi-stat-dimensions')).toContainText('2,220 × 2,967')
  await expect(page.locator('#wsi-stat-levels')).toHaveText('1 (1×)')
  await expect(page.locator('#wsi-stat-tile-size')).toHaveText('240 × 240')
  await expect(page.locator('.wsi-request-state.pending').first()).toBeVisible({ timeout: 10_000 })
  await page.locator('#wsi-zoom-in').click()
  await expect(page.locator('.wsi-request-state.cancelled').first()).toBeVisible({
    timeout: 10_000,
  })
  await expect(page.locator('#wsi-stat-cancelled')).not.toHaveText('0')
  await expect(async () => {
    expect(Number(await page.locator('#wsi-stat-decoded').textContent())).toBeGreaterThanOrEqual(10)
  }).toPass({ timeout: 20_000 })
  await expect(page.locator('#wsi-stat-bytes')).not.toHaveText('0 B')

  const renderedColors = await page.locator('#wsi-canvas').evaluate((canvas) => {
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('WSI canvas is not a canvas')
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Missing WSI canvas context')
    const samples: Uint8ClampedArray[] = []
    for (let row = 2; row <= 8; row += 1) {
      for (let column = 2; column <= 8; column += 1) {
        samples.push(
          context.getImageData((canvas.width * column) / 10, (canvas.height * row) / 10, 1, 1).data,
        )
      }
    }
    return samples.map((sample) => Array.from(sample))
  })
  expect(new Set(renderedColors.map((sample) => sample.join(','))).size).toBeGreaterThan(2)

  await page.locator('#wsi-reset').click()
  await expect(page.locator('#wsi-stat-requests')).toHaveText('0')
  await expect(page.locator('#wsi-stat-bytes')).toHaveText('0 B')
  await expect(page.locator('#wsi-stat-fraction')).toHaveText('0.000%')
  await expect(page.locator('#wsi-stat-decoded')).toHaveText('0')
  await expect(page.locator('#wsi-stat-cancelled')).toHaveText('0')
  expect(externalRequests).toEqual([])
})

test('offers verified sample choices and opens one directly from the picker', async ({ page }) => {
  const externalRequests: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.hostname !== '127.0.0.1') externalRequests.push(request.url())
  })
  await page.goto('/wsi/?url=/fixtures/aperio-cmu-1-small-region.svs')
  await page.waitForFunction(() => window.pureJsImageWsiReady === true)

  const samples = page.locator('[data-wsi-sample-url]')
  await expect(samples).toHaveCount(4)
  await expect(samples.locator('strong')).toHaveText([
    'Quick preview',
    'Wide section',
    'Default section',
    'Very large section',
  ])

  const quickPreview = samples.first()
  const localSampleUrl = '/fixtures/aperio-cmu-1-small-region.svs?sample=picker'
  await quickPreview.evaluate((button, url) => {
    if (!(button instanceof HTMLButtonElement)) throw new Error('Sample is not a button')
    button.dataset.wsiSampleUrl = url
  }, localSampleUrl)
  await quickPreview.click()

  await expect(page.locator('#wsi-url')).toHaveValue(localSampleUrl)
  await expect(quickPreview).toHaveAttribute('aria-pressed', 'true')
  await expect(async () => {
    expect(await page.locator('#wsi-stat-slide').textContent()).toBe('CMU-1.svs')
  }).toPass({ timeout: 15_000 })
  expect(externalRequests).toEqual([])
})
