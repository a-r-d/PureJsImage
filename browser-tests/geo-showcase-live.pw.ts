import { expect, test } from '@playwright/test'

const enabled = process.env.PUREJSIMAGE_GEO_PUBLIC_SMOKE === '1'
const cogUrl =
  'https://kyfromabove.s3.us-west-2.amazonaws.com/imagery/orthos/Phase2/KY_KYAPED_2019_6IN/N082E280_2019_6IN_cog.tif'
const geoZarrUrl = 'https://data.source.coop/pangeo/geozarr-examples/TCI.zarr/'

const recordSource = async (
  testInfo: import('@playwright/test').TestInfo,
  response: import('@playwright/test').APIResponse,
  url: string,
): Promise<void> => {
  const headers = response.headers()
  const record = {
    sourceUrl: url,
    testDate: new Date().toISOString(),
    status: response.status(),
    transport: {
      acceptRanges: headers['accept-ranges'] ?? null,
      accessControlAllowOrigin: headers['access-control-allow-origin'] ?? null,
      contentLength: headers['content-length'] ?? null,
    },
    mutationEvidence: {
      etag: headers.etag ?? null,
      lastModified: headers['last-modified'] ?? null,
      versionId: headers['x-amz-version-id'] ?? null,
    },
  }
  await testInfo.attach('public-source-record.json', {
    body: Buffer.from(JSON.stringify(record, null, 2)),
    contentType: 'application/json',
  })
}

test.skip(!enabled, 'Set PUREJSIMAGE_GEO_PUBLIC_SMOKE=1 to exercise public sources')

test('opens the pinned public COG through direct browser range access', async ({
  page,
  request,
  browserName,
}, testInfo) => {
  test.skip(
    browserName !== 'chromium',
    'One browser records the opt-in public transport smoke test',
  )
  const head = await request.head(cogUrl)
  await recordSource(testInfo, head, cogUrl)
  await page.goto('/geo/')
  await page.waitForFunction(() => window.pureJsImageGeoReady === true)
  await expect(page.locator('[data-geo-preset-id="kentucky-ortho"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.locator('#cog-status')).toHaveAttribute('data-state', 'ready', {
    timeout: 60_000,
  })
  await expect(page.locator('#cog-lab [data-geo-telemetry="dataRequests"]')).not.toHaveText('0')
  await expect(page.locator('#cog-lab [data-geo-fact="dimensions"]')).toHaveText('10,000 × 10,000')
  await expect(page.locator('#cog-level')).toHaveValue('4')
  await expect(page.locator('#cog-mode')).toHaveValue('rgb')
  await page.locator('#cog-mode').selectOption('cir')
  await expect(page.locator('#cog-status')).toHaveAttribute('data-state', 'ready')
  await expect(page.locator('#geo-code')).toContainText('sourceBands: [3,0,1]')
})

test('reports the newer public GeoZarr convention as unsupported', async ({
  page,
  request,
  browserName,
}, testInfo) => {
  test.skip(
    browserName !== 'chromium',
    'One browser records the opt-in public transport smoke test',
  )
  const metadataUrl = new URL('zarr.json', geoZarrUrl).href
  const head = await request.head(metadataUrl)
  await recordSource(testInfo, head, metadataUrl)
  await page.goto('/geo/')
  await page.waitForFunction(() => window.pureJsImageGeoReady === true)
  await page.locator('#geozarr-lab .geo-custom-source summary').click()
  await page.locator('#geozarr-url').fill(geoZarrUrl)
  await page.locator('#geozarr-open').click()
  await expect(page.locator('#geozarr-status')).toHaveAttribute('data-state', 'error', {
    timeout: 60_000,
  })
  await expect(page.locator('#geozarr-status')).toContainText(/convention|affine|transform/i)
})
