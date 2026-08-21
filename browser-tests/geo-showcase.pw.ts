import { expect, test } from '@playwright/test'

const cogUrl =
  'https://kyfromabove.s3.us-west-2.amazonaws.com/imagery/orthos/Phase2/KY_KYAPED_2019_6IN/N082E280_2019_6IN_cog.tif'

const openBundled = async (
  page: import('@playwright/test').Page,
  kind: 'cog' | 'geozarr',
): Promise<void> => {
  await page.locator(`#${kind}-lab [data-geo-preset-kind="bundled"]`).click()
  await expect(page.locator(`#${kind}-status`)).toHaveAttribute('data-state', 'ready', {
    timeout: 30_000,
  })
}

const digest = async (page: import('@playwright/test').Page, id: string): Promise<number> =>
  page.locator(id).evaluate((element) => {
    if (!(element instanceof HTMLCanvasElement)) throw new Error('Geo canvas is missing')
    const context = element.getContext('2d')
    if (context === null) throw new Error('Geo canvas context is missing')
    const values = context.getImageData(0, 0, element.width, element.height).data
    let result = 0
    const pixelCount = element.width * element.height
    const step = Math.max(1, pixelCount >> 9)
    for (let pixel = 0; pixel < pixelCount; pixel += step) {
      const index = pixel * 4
      result =
        (Math.imul(result, 33) +
          (values[index] ?? 0) +
          (values[index + 1] ?? 0) +
          (values[index + 2] ?? 0)) >>>
        0
    }
    return result
  })

test.beforeEach(async ({ page }) => {
  await page.route(cogUrl, (route) => route.abort('blockedbyclient'))
  await page.goto('/geo/')
  await page.waitForFunction(() => window.pureJsImageGeoReady === true)
})

test('autoloads the sourced government COG without contacting it during deterministic CI', async ({
  page,
}) => {
  const source = page.locator('[data-geo-preset-id="kentucky-ortho"]')
  await expect(source).toContainText('Kentucky From Above')
  await expect(source).toContainText('10,000 × 10,000')
  await expect(source).toHaveAttribute('data-geo-preset', cogUrl)
  await expect(source).toHaveAttribute('data-geo-initial-level', '3')
  await expect(source).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('[data-geo-preset-id="usgs-grand-canyon-dem"]')).toContainText(
    'USGS Grand Canyon terrain',
  )
  await expect(page.locator('#cog-status')).not.toHaveText(
    'Choose the Kentucky survey or bundled fixture to begin.',
  )
  const heroBox = await page.locator('.geo-hero').boundingBox()
  const canvasBox = await page.locator('#cog-canvas').boundingBox()
  expect(heroBox?.height ?? Number.POSITIVE_INFINITY).toBeLessThan(260)
  expect(canvasBox?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(720)
})

test('opens, navigates, samples, and measures the deterministic COG', async ({ page }) => {
  await openBundled(page, 'cog')
  await expect(page.locator('#cog-lab [data-geo-fact="container"]')).toHaveText('TIFF')
  await expect(page.locator('#cog-lab [data-geo-fact="levels"]')).toHaveText('3')
  await expect(page.locator('#cog-lab [data-geo-fact="activeLevel"]')).toContainText(
    '2,048 × 1,024',
  )
  await expect(page.locator('#cog-lab [data-geo-telemetry="metadataRequests"]')).toHaveText('2')
  await expect(page.locator('#cog-lab [data-geo-telemetry="dataRequests"]')).toHaveText('4')
  await expect(page.locator('#cog-lab [data-geo-telemetry="percentage"]')).toHaveText('34.33%')
  await expect(page.locator('#cog-lab [data-geo-telemetry="uniqueBytes"]')).not.toHaveText('0 B')
  await expect(page.locator('#cog-lab [data-geo-fact="display"]')).toContainText('Auto contrast')
  await expect(page.locator('#cog-lab [data-geo-fact="display"]')).not.toContainText('pending')
  expect(await digest(page, '#cog-canvas')).not.toBe(0)
  await page.locator('#cog-mode').selectOption('rgb')
  await expect(page.locator('#cog-status')).toHaveAttribute('data-state', 'ready')
  await expect(page.locator('#cog-mode option[value="cir"]')).toHaveAttribute('disabled', '')

  await page.locator('#cog-level').selectOption({ index: 1 })
  await expect(page.locator('#cog-lab [data-geo-fact="activeLevel"]')).toContainText('1,024 × 512')
  await expect(page.locator('#cog-status')).toHaveAttribute('data-state', 'ready')
  await page.locator('#cog-canvas').focus()
  await page.keyboard.press('+')
  await expect(page.locator('#cog-status')).toHaveAttribute('data-state', 'ready')
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('#cog-status')).toHaveAttribute('data-state', 'ready')

  const canvas = page.locator('#cog-canvas')
  await canvas.evaluate((element) => {
    const rectangle = element.getBoundingClientRect()
    element.dispatchEvent(
      new PointerEvent('pointermove', {
        bubbles: true,
        clientX: rectangle.left + rectangle.width / 2,
        clientY: rectangle.top + rectangle.height / 2,
        pointerType: 'mouse',
      }),
    )
  })
  await expect(page.locator('#cog-sample')).toContainText('world')
  await expect(page.locator('#cog-sample')).toContainText('sample')

  await page.locator('#cog-level').selectOption({ index: 2 })
  await expect(page.locator('#cog-status')).toHaveAttribute('data-state', 'ready')
  await expect(page.locator('#cog-lab [data-geo-fact="viewport"]')).toContainText('512 × 256')
  const requestsAtFullOverview = await page
    .locator('#cog-lab [data-geo-telemetry="dataRequests"]')
    .textContent()
  const fullOverviewDigest = await digest(page, '#cog-canvas')
  await page.locator('#cog-canvas').focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('#cog-status')).toContainText('right edge reached')
  await expect(page.locator('#cog-loading')).toBeHidden()
  await expect(page.locator('#cog-lab [data-geo-telemetry="dataRequests"]')).toHaveText(
    requestsAtFullOverview ?? '',
  )
  expect(await digest(page, '#cog-canvas')).toBe(fullOverviewDigest)
})

test('keeps repeated zoom, pan, and analysis actions inside the viewport contract', async ({
  page,
}) => {
  await openBundled(page, 'cog')
  const status = page.locator('#cog-status')
  const level = page.locator('#cog-level')
  const viewport = page.locator('#cog-lab [data-geo-fact="viewport"]')
  const zoomIn = page.locator('#cog-lab [data-zoom="in"]')
  const zoomOut = page.locator('#cog-lab [data-zoom="out"]')

  for (const expectedLevel of ['1', '2']) {
    await zoomOut.click()
    await expect(status).toHaveAttribute('data-state', 'ready')
    await expect(level).toHaveValue(expectedLevel)
    await expect(status).not.toContainText('Viewport must contain')
  }
  await expect(zoomOut).toBeDisabled()

  for (const expectedLevel of ['1', '0']) {
    await zoomIn.click()
    await expect(status).toHaveAttribute('data-state', 'ready')
    await expect(level).toHaveValue(expectedLevel)
  }
  for (let index = 0; index < 7; index += 1) {
    await zoomIn.click()
    await expect(status).toHaveAttribute('data-state', 'ready')
    const dimensions = (await viewport.innerText()).match(/([\d,]+) × ([\d,]+)$/)
    expect(dimensions).not.toBeNull()
    const width = Number((dimensions?.[1] ?? '').replaceAll(',', ''))
    const height = Number((dimensions?.[2] ?? '').replaceAll(',', ''))
    expect(width * height).toBeLessThanOrEqual(512 * 384)
  }
  await expect(zoomIn).toBeDisabled()

  for (const direction of ['up', 'left', 'right', 'down']) {
    const button = page.locator(`#cog-lab [data-pan="${direction}"]`)
    if (await button.isEnabled()) {
      await button.click()
      await expect(status).toHaveAttribute('data-state', 'ready')
    }
  }

  const analyses: readonly [string, RegExp][] = [
    ['normalized-difference', /Normalized difference/i],
    ['hillshade', /Hillshade/i],
    ['statistics', /Count/i],
    ['line-profile', /Diagonal profile/i],
  ]
  for (const [analysis, result] of analyses) {
    await page.locator(`[data-geo-analysis="${analysis}"]`).click()
    await expect(page.locator('#geo-analysis-output')).toContainText(result)
    await expect(status).toHaveAttribute('data-state', 'ready')
  }
  await expect(status).not.toContainText('Viewport must contain')
})

test('opens the GeoZarr cube and selects level, time, and band dimensions', async ({ page }) => {
  await openBundled(page, 'geozarr')
  await expect(page.locator('#geozarr-lab [data-geo-fact="zarrVersion"]')).toHaveText('3')
  await expect(page.locator('#geozarr-lab [data-geo-fact="conventions"]')).toContainText(
    '689b58e2-cf7b-45e0-9fff-9cfc0883d6b4',
  )
  await expect(page.locator('#geozarr-time option')).toHaveCount(2)
  await expect(page.locator('#geozarr-band option')).toHaveCount(3)
  await expect(page.locator('#geozarr-level option')).toHaveCount(2)
  expect(await digest(page, '#geozarr-canvas')).not.toBe(0)
  await page.getByRole('button', { name: 'Regional statistics' }).click()
  await expect(page.locator('#geo-analysis-output')).toContainText('min 25')

  await page.locator('#geozarr-time').selectOption('1')
  await expect(page.locator('#geozarr-status')).toHaveAttribute('data-state', 'ready')
  await page.locator('#geozarr-band').selectOption('2')
  await expect(page.locator('#geozarr-status')).toHaveAttribute('data-state', 'ready')
  await page.locator('#geozarr-level').selectOption({ index: 1 })
  await expect(page.locator('#geozarr-status')).toHaveAttribute('data-state', 'ready')
  await expect(page.locator('#geozarr-lab [data-geo-telemetry="dataRequests"]')).not.toHaveText('0')
  await page.getByRole('button', { name: 'Regional statistics' }).click()
  await expect(page.locator('#geo-analysis-output')).not.toContainText('min 0, max 0')
})

test('reports URL and cancellation states without a proxy fallback', async ({ page }) => {
  await openBundled(page, 'cog')
  await page.locator('#cog-lab .geo-custom-source summary').click()
  await page.locator('#cog-url').fill('file:///tmp/not-allowed.tif')
  await page.locator('#cog-open').click()
  await expect(page.locator('#cog-status')).toHaveAttribute('data-state', 'error')
  await expect(page.locator('#cog-status')).toContainText('valid HTTP or HTTPS')

  await page.locator('#cog-url').fill('/fixtures/geo/overview-cog.tif?rangeDelay=400')
  await page.locator('#cog-open').click()
  await expect(page.locator('#cog-status')).toHaveAttribute('data-state', 'loading')
  await expect(page.locator('#cog-loading')).toBeVisible()
  await expect(page.locator('#cog-loading-title')).toContainText('Opening')
  await expect(page.locator('#cog-loading-progress')).toHaveAttribute('data-indeterminate', 'true')
  await expect(page.locator('#cog-canvas-wrap')).toHaveAttribute('aria-busy', 'true')
  await page.locator('#cog-loading-cancel').click()
  await expect(page.locator('#cog-status')).toHaveAttribute('data-state', 'idle')
  await expect(page.locator('#cog-loading')).toBeHidden()
  await expect(page.locator('#cog-canvas-wrap')).toHaveAttribute('aria-busy', 'false')
})

test('reports a worker startup failure instead of loading forever', async ({ page }) => {
  await page.route('**/assets/geo-showcase-worker.js', (route) => route.abort('failed'))
  await page.reload()
  await expect(page.locator('#cog-status')).toHaveAttribute('data-state', 'error')
  await expect(page.locator('#cog-status')).toContainText('Demo worker could not start')
  await expect(page.locator('#cog-loading')).toBeHidden()
  await expect(page.locator('#geozarr-status')).toHaveAttribute('data-state', 'error')
})

test('runs bounded analysis and generates public package code', async ({ page }) => {
  await openBundled(page, 'cog')
  await page.locator('[data-geo-analysis="hillshade"]').click()
  await expect(page.locator('#geo-analysis-output')).toContainText('Hillshade from band 1')
  await expect(page.locator('#cog-status')).toHaveAttribute('data-state', 'ready')
  await expect(page.locator('#cog-lab [data-geo-fact="display"]')).toHaveText('Hillshade result')

  await openBundled(page, 'geozarr')
  await page.getByRole('button', { name: 'Regional statistics' }).click()
  await expect(page.locator('#geo-analysis-output')).toContainText('Count')
  await page.getByRole('button', { name: 'Normalized difference' }).click()
  await expect(page.locator('#geo-analysis-output')).toContainText('Normalized difference')
  await page.locator('[data-geo-analysis="hillshade"]').click()
  await expect(page.locator('#geo-analysis-output')).toContainText('Hillshade')
  await page.getByRole('button', { name: 'Line profile' }).click()
  await expect(page.locator('#geo-analysis-output')).toContainText('Diagonal profile')

  const code = page.locator('#geo-code')
  await expect(page.locator('.geo-content > section').last()).toHaveAttribute('id', 'api-and-code')
  await expect(
    page.getByRole('heading', { name: 'Read the active viewport with public APIs.' }),
  ).toBeVisible()
  const copyButton = page.getByRole('button', { name: 'Copy TypeScript example' })
  await expect(copyButton).toBeVisible()
  await copyButton.click()
  await expect(copyButton).toHaveText('Copied')
  await expect(code).toContainText("from 'purejsimage/geo'")
  await expect(code).toContainText("from 'purejsimage/geo/readers/geozarr'")
  await expect(code).toContainText('document.close')
  await expect(code).not.toContainText('src/geo')
})

test('filters the generated capability matrix and terminates workers', async ({ page }) => {
  await expect(page.locator('[data-geo-format-row]:visible')).toHaveCount(8)
  await page.locator('[data-geo-matrix-filter="shape"]').selectOption('multiscale')
  await expect(page.locator('[data-geo-format-row]:visible')).toHaveCount(3)
  await page.locator('[data-geo-matrix-filter="mode"]').selectOption('write')
  await expect(page.locator('[data-geo-format-row]:visible')).toHaveCount(0)
  await expect(page.locator('#geo-matrix-count')).toHaveText('0 formats shown')

  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')))
  await expect(page.locator('html')).toHaveAttribute('data-geo-workers', 'terminated')
  await expect(page.locator('#cog-lab')).toHaveAttribute('data-worker', 'terminated')
  await expect(page.locator('#geozarr-lab')).toHaveAttribute('data-worker', 'terminated')
})

test('keeps controls and diagnostics contained on a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload()
  await page.waitForFunction(() => window.pureJsImageGeoReady === true)
  await openBundled(page, 'geozarr')
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }))
  expect(widths.scroll).toBeLessThanOrEqual(widths.client + 1)
  await expect(page.locator('#geozarr-canvas')).toBeVisible()
  await expect(page.locator('#geozarr-status')).toHaveAttribute('data-state', 'ready')
})
