import { expect, test } from '@playwright/test'

test('opens, measures, navigates, cancels, and resets a local sharded OME-Zarr WSI', async ({
  page,
  baseURL,
}) => {
  if (baseURL === undefined) throw new Error('Playwright baseURL is required')
  const externalRequests: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.hostname !== '127.0.0.1') externalRequests.push(request.url())
  })
  const fixtureUrl = `${baseURL}/fixtures/ome-zarr-wsi?rangeDelay=200`
  const malformedChannels = JSON.stringify([
    { index: 0, enabled: true, color: 0xff0000, minimum: 0, maximum: 255, gamma: 1 },
    { index: 0, enabled: true, color: 0x00ff00, minimum: 0, maximum: 255, gamma: 1 },
    { index: 2, enabled: true, color: 0x0000ff, minimum: 0, maximum: 255, gamma: 1 },
  ])
  await page.goto(
    `/ome-zarr/?url=${encodeURIComponent(fixtureUrl)}&channels=${encodeURIComponent(malformedChannels)}`,
  )
  await page.waitForFunction(() => window.pureJsImageOmeZarrReady === true)
  const loading = page.locator('#ome-zarr-loading')
  await expect(loading).toBeVisible()
  await expect(page.locator('#ome-zarr-loading-title')).toContainText(/Opening|Loading/)
  const implementationCode = page.locator('#ome-zarr-implementation-code')
  await expect(implementationCode).toContainText(
    "createOmeZarrReader } from 'purejsimage/scientific/readers/ome-zarr'",
  )
  await expect(implementationCode).toContainText('dataset.readPlane')
  await expect(implementationCode.locator('.tok-key').first()).toBeVisible()
  await expect(page.locator('[data-copy="ome-zarr-implementation-code"]')).toHaveText('Copy')
  const codeTabs = page.locator('.wsi-code-window .code-tabs label')
  await expect(codeTabs).toHaveText(['ome-zarr-worker.ts', 'ome-zarr-http.ts'])
  await codeTabs.nth(1).click()
  const httpCode = page.locator('#ome-zarr-http-code')
  await expect(httpCode).toBeVisible()
  await expect(httpCode).toContainText('HttpRangeSource.open')
  await expect(httpCode.locator('.tok-string').first()).toBeVisible()
  await expect(page.locator('[data-copy="ome-zarr-http-code"]')).toHaveText('Copy')

  await expect(page.locator('#ome-zarr-stat-store')).toContainText('ome-zarr-wsi', {
    timeout: 20_000,
  })
  await expect(page.locator('#ome-zarr-stat-dimensions')).toHaveText('1,792 × 1,280')
  await expect(page.locator('#ome-zarr-stat-levels')).toContainText('3 (1×, 2×, 4×)')
  await expect(page.locator('#ome-zarr-stat-axes')).toHaveText('t[1], c[3], z[2], y[1280], x[1792]')
  await expect(page.locator('#ome-zarr-stat-logical-chunk')).toHaveText('1 × 3 × 1 × 128 × 128')
  await expect(page.locator('#ome-zarr-stat-shard')).toContainText('1 × 3 × 2 × 512 × 512')
  await expect(page.locator('#ome-zarr-metadata-summary')).toContainText('metadata')
  await expect(page.locator('#ome-zarr-metadata-summary')).not.toContainText('0 B')
  await expect(page.locator('#ome-zarr-open')).toBeEnabled()
  const heroLayout = await page.locator('.wsi-hero').evaluate((hero) => {
    const claim = hero.querySelector('.wsi-claim-card')
    const value = hero.querySelector('#ome-zarr-measured-bytes')
    if (!(claim instanceof HTMLElement) || !(value instanceof HTMLElement)) return undefined
    return {
      claimHeight: claim.getBoundingClientRect().height,
      heroHeight: hero.getBoundingClientRect().height,
      valueOverflow: getComputedStyle(value).overflow,
      valueWhiteSpace: getComputedStyle(value).whiteSpace,
    }
  })
  expect(heroLayout).toBeDefined()
  expect(heroLayout?.claimHeight).toBe(166)
  expect(heroLayout?.heroHeight).toBeLessThan(320)
  expect(heroLayout?.valueOverflow).toBe('hidden')
  expect(heroLayout?.valueWhiteSpace).toBe('nowrap')
  await expect(page.locator('#ome-zarr-dataset option')).toHaveCount(3)
  await expect(page.locator('#ome-zarr-plate-summary')).toContainText('2 wells')
  await expect(page.locator('[data-axis-id="z"]')).toHaveAttribute('max', '1')
  await expect(page.locator('.ome-zarr-channel-control')).toHaveCount(3)
  await expect(page.locator('#ome-zarr-label option')).toHaveCount(2)
  await expect(page.locator('#ome-zarr-label option').nth(1)).toContainText(
    'deterministic-segmentation',
  )
  await expect(page.locator('#ome-zarr-minimap')).toBeVisible()
  await expect(page.locator('#ome-zarr-fullscreen')).toBeEnabled()

  await page.locator('#ome-zarr-dataset').selectOption('A/2/0')
  await expect(page.locator('#ome-zarr-stat-dimensions')).toHaveText('256 × 256')
  await expect(page.locator('#ome-zarr-stat-store')).toContainText('well-A2')
  await page.locator('#ome-zarr-dataset').selectOption('image')
  await expect(page.locator('#ome-zarr-stat-dimensions')).toHaveText('1,792 × 1,280')
  await expect(page.locator('[data-axis-id="z"]')).toBeVisible()

  await page.locator('#ome-zarr-dataset').evaluate((element) => {
    if (!(element instanceof HTMLSelectElement)) throw new Error('Dataset control is not a select')
    element.value = 'A/2/0'
    element.dispatchEvent(new Event('change', { bubbles: true }))
    element.value = 'image'
    element.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await expect(page.locator('#ome-zarr-stat-dimensions')).toHaveText('1,792 × 1,280')
  await expect(page.locator('#ome-zarr-status')).not.toHaveAttribute('data-error', 'true')

  await expect(page.locator('.wsi-request-state.pending').first()).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('#ome-zarr-loading-title')).toContainText(/visible tiles|viewport/)
  await expect(page.locator('#ome-zarr-loading-progress')).toHaveAttribute('aria-valuenow', /\d+/)
  await expect(page.locator('#ome-zarr-level-live')).toContainText('Level 1')
  await page.locator('#ome-zarr-zoom-in').click()
  await expect(page.locator('#ome-zarr-level-live')).toContainText('Level 0')
  await expect(page.locator('.wsi-request-state.pending').first()).toBeVisible()
  await page.locator('#ome-zarr-fit').click()
  await expect(page.locator('#ome-zarr-level-live')).toContainText('Level 1')
  await expect(page.locator('.wsi-request-state.cancelled').first()).toBeVisible({
    timeout: 20_000,
  })
  await expect(page.locator('#ome-zarr-stat-cancelled')).not.toHaveText('0')
  await expect(page.locator('#ome-zarr-stat-decoded')).not.toHaveText('0', { timeout: 30_000 })
  await expect(page.locator('.wsi-request-state.pending')).toHaveCount(0, { timeout: 40_000 })
  await expect(loading).toBeHidden()
  await expect(page.locator('#ome-zarr-canvas-wrap')).toHaveAttribute('aria-busy', 'false')

  await expect(page.locator('#ome-zarr-stat-object-requests')).not.toHaveText('0')
  await expect(page.locator('#ome-zarr-stat-range-requests')).not.toHaveText('0')
  await expect(page.locator('#ome-zarr-stat-bytes')).not.toHaveText('0 B')
  await expect(page.locator('#ome-zarr-stat-metadata-bytes')).not.toHaveText('0 B')
  await expect(page.locator('#ome-zarr-stat-array-bytes')).not.toHaveText('0 B')
  await expect(page.locator('#ome-zarr-stat-decode-time')).not.toHaveText('0 / 0 ms')
  const colors = await page.locator('#ome-zarr-canvas').evaluate((element) => {
    if (!(element instanceof HTMLCanvasElement)) return 0
    const canvas = element
    const context = canvas.getContext('2d')
    if (context === null) return 0
    const image = context.getImageData(0, 0, canvas.width, canvas.height)
    const unique = new Set<string>()
    const step = Math.max(4, Math.floor(image.data.length / 20_000 / 4) * 4)
    for (let offset = 0; offset < image.data.length; offset += step) {
      unique.add(
        `${image.data[offset] ?? 0},${image.data[offset + 1] ?? 0},${image.data[offset + 2] ?? 0}`,
      )
      if (unique.size > 8) break
    }
    return unique.size
  })
  expect(colors).toBeGreaterThan(2)

  await page.locator('[data-axis-id="z"]').fill('1')
  await page.locator('[data-axis-id="z"]').dispatchEvent('change')
  await expect(page).toHaveURL(/axes=/)
  await expect(page.locator('#ome-zarr-stat-decoded')).not.toHaveText('0', { timeout: 30_000 })

  await page.locator('#ome-zarr-label').selectOption('labels/segmentation')
  await expect(page).toHaveURL(/label=labels%2Fsegmentation/)
  await expect(page.locator('#ome-zarr-label-opacity')).toBeEnabled()
  await expect(page.locator('#ome-zarr-loading-title')).toContainText(/visible tiles|viewport/)
  await expect(page.locator('#ome-zarr-loading')).toBeHidden({ timeout: 40_000 })
  await expect(page.locator('#ome-zarr-auto-contrast')).toBeEnabled()
  await expect(page.locator('#ome-zarr-stat-in-flight')).toHaveText('0', { timeout: 20_000 })

  await page.locator('#ome-zarr-label-opacity').fill('70')
  await page.locator('#ome-zarr-open').click()
  await expect(page.locator('#ome-zarr-stat-dimensions')).toHaveText('1,792 × 1,280', {
    timeout: 20_000,
  })
  await expect(page.locator('#ome-zarr-status')).not.toHaveAttribute('data-error', 'true')
  await expect(page.locator('#ome-zarr-stat-decoded')).not.toHaveText('0', { timeout: 30_000 })
  await expect(page.locator('.wsi-request-state.pending')).toHaveCount(0, { timeout: 40_000 })
  await expect(page.locator('#ome-zarr-stat-in-flight')).toHaveText('0', { timeout: 20_000 })

  await page.locator('#ome-zarr-reset').click()
  await expect(page.locator('#ome-zarr-stat-object-requests')).toHaveText('0')
  await expect(page.locator('#ome-zarr-stat-range-requests')).toHaveText('0')
  await expect(page.locator('#ome-zarr-stat-bytes')).toHaveText('0 B')
  await expect(page.locator('#ome-zarr-measured-bytes')).toHaveText('0 B')
  await expect(page.locator('#ome-zarr-stat-decoded')).toHaveText('0')
  expect(externalRequests).toEqual([])
})

declare global {
  interface Window {
    pureJsImageOmeZarrReady?: boolean
  }
}
