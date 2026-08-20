import { expect, test } from '@playwright/test'

const liveEnabled = process.env.PUREJSIMAGE_OME_ZARR_LIVE === '1'
const liveUrl =
  process.env.PUREJSIMAGE_OME_ZARR_LIVE_URL ??
  'https://storage.googleapis.com/jax-public-ngff/public/41028.zarr'
const publicFacts: Readonly<
  Record<string, { readonly dimensions: string; readonly levels: number }>
> = {
  'https://storage.googleapis.com/jax-public-ngff/public/41028.zarr': {
    dimensions: '53,760 × 32,256',
    levels: 6,
  },
  'https://storage.googleapis.com/jax-public-ngff/public/46125.zarr': {
    dimensions: '38,400 × 38,656',
    levels: 6,
  },
  'https://storage.googleapis.com/jax-public-ngff/public/42815.zarr': {
    dimensions: '96,000 × 55,296',
    levels: 7,
  },
}

test('optionally opens and renders a live Jackson OME-Zarr WSI', async ({ page }) => {
  test.skip(!liveEnabled, 'Set PUREJSIMAGE_OME_ZARR_LIVE=1 to exercise the public Jackson store')
  const browserFailures: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') browserFailures.push(message.text())
  })
  page.on('requestfailed', (request) => {
    browserFailures.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText}`)
  })
  const started = performance.now()
  await page.goto(`/ome-zarr/?url=${encodeURIComponent(liveUrl)}`)
  await page.waitForFunction(() => window.pureJsImageOmeZarrReady === true)
  await page.waitForFunction(
    () => {
      const dimensions = document.getElementById('ome-zarr-stat-dimensions')
      const status = document.getElementById('ome-zarr-status')
      return dimensions?.textContent !== 'Not available' || status?.dataset.error === 'true'
    },
    { timeout: 60_000 },
  )
  const liveStatus = page.locator('#ome-zarr-status')
  const liveError =
    (await liveStatus.getAttribute('data-error')) === 'true' ? await liveStatus.textContent() : null
  expect(liveError, browserFailures.join('\n')).toBeNull()
  const metadataMilliseconds = Math.round(performance.now() - started)
  const metadataOnly =
    (await page.locator('#ome-zarr-metadata-summary').textContent())
      ?.replace(/\s+/gu, ' ')
      .trim() ?? ''
  const facts = publicFacts[liveUrl]
  if (facts !== undefined) {
    await expect(page.locator('#ome-zarr-stat-dimensions')).toHaveText(facts.dimensions)
    await expect(page.locator('#ome-zarr-stat-levels')).toContainText(`${facts.levels} (`)
  } else {
    await expect(page.locator('#ome-zarr-stat-levels')).not.toHaveText('Not available')
  }
  await page.waitForFunction(
    () => {
      const decoded = document.getElementById('ome-zarr-stat-decoded')
      const status = document.getElementById('ome-zarr-status')
      return decoded?.textContent !== '0' || status?.dataset.error === 'true'
    },
    { timeout: 120_000 },
  )
  const tileError =
    (await liveStatus.getAttribute('data-error')) === 'true' ? await liveStatus.textContent() : null
  expect(tileError, browserFailures.join('\n')).toBeNull()
  const firstTileMilliseconds = Math.round(performance.now() - started)
  await expect(page.locator('#ome-zarr-stat-range-requests')).not.toHaveText('0')
  await expect(page.locator('#ome-zarr-stat-bytes')).not.toHaveText('0 B')
  await expect(page.locator('.wsi-request-state.pending')).toHaveCount(0, { timeout: 120_000 })
  const fitMeasurement = await readMeasurement(page)
  await page.locator('#ome-zarr-zoom-in').click()
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      }),
  )
  const zoomError =
    (await liveStatus.getAttribute('data-error')) === 'true' ? await liveStatus.textContent() : null
  expect(zoomError, browserFailures.join('\n')).toBeNull()
  await expect(page.locator('.wsi-request-state.pending')).toHaveCount(0, { timeout: 120_000 })
  const zoomMeasurement = await readMeasurement(page)
  const nonBlank = await page.locator('#ome-zarr-canvas').evaluate((element) => {
    if (!(element instanceof HTMLCanvasElement)) return false
    const context = element.getContext('2d')
    if (context === null) return false
    const data = context.getImageData(0, 0, element.width, element.height).data
    for (let offset = 0; offset < data.length; offset += 400) {
      const red = data[offset] ?? 0
      const green = data[offset + 1] ?? 0
      const blue = data[offset + 2] ?? 0
      if (red !== 11 || green !== 16 || blue !== 13) return true
    }
    return false
  })
  expect(nonBlank).toBe(true)
  console.log(
    JSON.stringify({
      liveUrl,
      metadataMilliseconds,
      metadataOnly,
      firstTileMilliseconds,
      fitMeasurement,
      zoomMeasurement,
    }),
  )
})

const readMeasurement = async (
  page: import('@playwright/test').Page,
): Promise<Readonly<Record<string, string>>> =>
  page.locator('.wsi-instrument').evaluate((element) => {
    const values: Record<string, string> = {}
    for (const row of element.querySelectorAll('dl > div')) {
      const key = row.querySelector('dt')?.textContent?.trim()
      const value = row.querySelector('dd')?.textContent?.trim()
      if (key !== undefined && value !== undefined) values[key] = value
    }
    values.level = document.getElementById('ome-zarr-level-live')?.textContent?.trim() ?? ''
    values.decoded = document.getElementById('ome-zarr-stat-decoded')?.textContent?.trim() ?? '0'
    return values
  })

declare global {
  interface Window {
    pureJsImageOmeZarrReady?: boolean
  }
}
