import { expect, test } from '@playwright/test'

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
    for (let index = 0; index < values.length; index += Math.max(4, values.length >> 9)) {
      result = (Math.imul(result, 33) + (values[index] ?? 0)) >>> 0
    }
    return result
  })

test.beforeEach(async ({ page }) => {
  await page.goto('/geo/')
  await page.waitForFunction(() => window.pureJsImageGeoReady === true)
})

test('features a sourced government COG without opening it during deterministic CI', async ({
  page,
}) => {
  const source = page.locator('[data-geo-preset-id="kentucky-ortho"]')
  await expect(source).toContainText('Kentucky From Above')
  await expect(source).toContainText('10,000 × 10,000')
  await expect(source).toHaveAttribute(
    'data-geo-preset',
    'https://kyfromabove.s3.us-west-2.amazonaws.com/imagery/orthos/Phase2/KY_KYAPED_2019_6IN/N082E280_2019_6IN_cog.tif',
  )
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

  await page.locator('#geozarr-time').selectOption('1')
  await expect(page.locator('#geozarr-status')).toHaveAttribute('data-state', 'ready')
  await page.locator('#geozarr-band').selectOption('2')
  await expect(page.locator('#geozarr-status')).toHaveAttribute('data-state', 'ready')
  await page.locator('#geozarr-level').selectOption({ index: 1 })
  await expect(page.locator('#geozarr-status')).toHaveAttribute('data-state', 'ready')
  await expect(page.locator('#geozarr-lab [data-geo-telemetry="dataRequests"]')).not.toHaveText('0')
})

test('reports URL and cancellation states without a proxy fallback', async ({ page }) => {
  await page.locator('#cog-lab .geo-custom-source summary').click()
  await page.locator('#cog-url').fill('file:///tmp/not-allowed.tif')
  await page.locator('#cog-open').click()
  await expect(page.locator('#cog-status')).toHaveAttribute('data-state', 'error')
  await expect(page.locator('#cog-status')).toContainText('valid HTTP or HTTPS')

  await page.locator('#cog-url').fill('/fixtures/geo/overview-cog.tif?rangeDelay=400')
  await page.locator('#cog-open').click()
  await expect(page.locator('#cog-status')).toHaveAttribute('data-state', 'loading')
  await page.locator('#cog-cancel').click()
  await expect(page.locator('#cog-status')).toContainText(/cancel/i)
})

test('runs bounded analysis and generates public package code', async ({ page }) => {
  await openBundled(page, 'geozarr')
  await page.getByRole('button', { name: 'Regional statistics' }).click()
  await expect(page.locator('#geo-analysis-output')).toContainText('Count')
  await page.getByRole('button', { name: 'Normalized difference' }).click()
  await expect(page.locator('#geo-analysis-output')).toContainText('Normalized difference')
  await page.getByRole('button', { name: 'Hillshade' }).click()
  await expect(page.locator('#geo-analysis-output')).toContainText('Hillshade')
  await page.getByRole('button', { name: 'Line profile' }).click()
  await expect(page.locator('#geo-analysis-output')).toContainText('Diagonal profile')

  const code = page.locator('#geo-code')
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
