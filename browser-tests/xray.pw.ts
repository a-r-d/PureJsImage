import { expect, test } from '@playwright/test'

test('Raster X-Ray transfers a local file through its worker and renders bounded evidence', async ({
  page,
}) => {
  await page.goto('/xray/')
  await expect(page.getByRole('heading', { name: 'Raster X-Ray' })).toBeVisible()
  await page.locator('#xray-file').setInputFiles({
    name: 'fixture.pgm',
    mimeType: 'image/x-portable-graymap',
    buffer: Buffer.concat([
      Buffer.from('P5\n4 2\n255\n', 'ascii'),
      Buffer.from([0, 32, 64, 96, 128, 160, 192, 255]),
    ]),
  })
  await expect(page.locator('#xray-status')).toContainText('NETPBM 4 × 2')
  await expect(page.locator('#xray-summary')).toContainText('logical reads')
  await expect(page.locator('#xray-plan')).toContainText('requestedOperations')
  await expect(page.locator('#xray-events')).toContainText('logical-read')
  await expect(page.locator('#xray-memory')).toContainText('PureJsImage-managed bytes')
  await expect(page.locator('#xray-dependency-select')).toBeEnabled()
  await expect(page.locator('#xray-dependency')).toContainText('logicalReads')
})

for (const fixture of [
  {
    label: 'JPEG',
    path: 'benchmark/corpus/files/wpt-webcodecs-mozjpeg-rgb.jpg',
    format: 'JPEG',
  },
  {
    label: 'TIFF or COG',
    path: 'tests/fixtures/cog/classic-deflate-rgb-nodata.tif',
    format: 'TIFF',
  },
  {
    label: 'AVIF box format',
    path: 'benchmark/corpus/files/avif/filter-free-lossy-10bpc-yuv444-32x24.avif',
    format: 'AVIF',
  },
  {
    label: 'JP2 box format',
    path: 'benchmark/corpus/files/jp2/openjpeg-lossless-gray16.jp2',
    format: 'JP2',
  },
] as const) {
  test(`Raster X-Ray inspects a local ${fixture.label} without decoding pixels`, async ({
    page,
  }) => {
    await page.goto('/xray/')
    await page.locator('#xray-file').setInputFiles(fixture.path)
    await expect(page.locator('#xray-status')).toContainText(fixture.format)
    await expect(page.locator('#xray-status')).toContainText(
      'Structural inspection completed without decoding pixels.',
    )
    await expect(page.locator('#xray-plan')).toContainText('requestedOperations')
    await expect(page.locator('#xray-plan')).toContainText('memoryClass')
  })
}

test('Raster X-Ray safe sample uses an ordinary PNG', async ({ page }) => {
  await page.goto('/xray/')
  await page.locator('#xray-sample').click()
  await expect(page.locator('#xray-status')).toContainText('PNG')
  await expect(page.locator('#xray-status')).toContainText(
    'Structural inspection completed without decoding pixels.',
  )
})

test('Raster X-Ray inspects a CORS range URL and reports physical transfers', async ({ page }) => {
  const fixture = Buffer.concat([
    Buffer.from('P5\n4 2\n255\n', 'ascii'),
    Buffer.from([0, 32, 64, 96, 128, 160, 192, 255]),
  ])
  await page.route('https://xray.test/fixture.pgm', async (route) => {
    const rawRange = route.request().headers().range ?? ''
    const match = /^bytes=(\d+)-(\d+)$/u.exec(rawRange)
    if (match === null) throw new Error(`Missing range header: ${rawRange}`)
    const start = Number(match[1])
    const end = Math.min(Number(match[2]), fixture.length - 1)
    await route.fulfill({
      status: 206,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-expose-headers': 'content-range, content-length, etag',
        'content-range': `bytes ${start}-${end}/${fixture.length}`,
        etag: '"xray-fixture"',
      },
      body: fixture.subarray(start, end + 1),
    })
  })
  await page.goto('/xray/')
  await page.locator('#xray-url').fill('https://xray.test/fixture.pgm')
  await page.locator('#xray-open-url').click()
  await expect(page.locator('#xray-status')).toContainText('NETPBM 4 × 2')
  await expect(page.locator('#xray-summary')).toContainText('remote source')
  await expect(page.locator('#xray-events')).toContainText('physical-transfer')
  await expect(page.locator('#xray-dependency-select')).toBeEnabled()
  await expect(page.locator('#xray-dependency')).toContainText('physicalTransfers')
})

const jsonFixture = (value: unknown): Buffer => Buffer.from(JSON.stringify(value))
const omeZarrFiles: Readonly<Record<string, Buffer>> = {
  'zarr.json': jsonFixture({
    zarr_format: 3,
    node_type: 'group',
    attributes: {
      ome: {
        version: '0.5',
        multiscales: [
          {
            name: 'xray-fixture',
            axes: [
              { name: 'y', type: 'space' },
              { name: 'x', type: 'space' },
            ],
            datasets: [
              { path: '0', coordinateTransformations: [{ type: 'scale', scale: [1, 1] }] },
            ],
          },
        ],
      },
    },
  }),
  '0/zarr.json': jsonFixture({
    zarr_format: 3,
    node_type: 'array',
    shape: [4, 4],
    data_type: 'uint8',
    chunk_grid: { name: 'regular', configuration: { chunk_shape: [4, 4] } },
    chunk_key_encoding: { name: 'default', configuration: { separator: '/' } },
    fill_value: 0,
    codecs: [{ name: 'bytes', configuration: { endian: 'little' } }],
    dimension_names: ['y', 'x'],
    attributes: {},
  }),
  '0/c/0/0': Buffer.from(Array.from({ length: 16 }, (_, index) => index)),
}

test('Raster X-Ray decodes one bounded OME-Zarr preview tile with correlated ranges', async ({
  page,
}) => {
  await page.route('https://xray.test/sample.zarr/**', async (route) => {
    const url = new URL(route.request().url())
    const name = decodeURIComponent(url.pathname.slice('/sample.zarr/'.length))
    const fixture = omeZarrFiles[name]
    if (fixture === undefined) {
      await route.fulfill({ status: 404 })
      return
    }
    if (route.request().method() === 'HEAD') {
      await route.fulfill({
        status: 200,
        headers: { 'content-length': String(fixture.length) },
      })
      return
    }
    const rawRange = route.request().headers().range ?? ''
    const match = /^bytes=(\d+)-(\d+)$/u.exec(rawRange)
    if (match === null) throw new Error(`Missing range header: ${rawRange}`)
    const start = Number(match[1])
    const end = Math.min(Number(match[2]), fixture.length - 1)
    await route.fulfill({
      status: 206,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-expose-headers': 'content-range, content-length, etag',
        'content-range': `bytes ${start}-${end}/${fixture.length}`,
        etag: `"xray-${name}"`,
      },
      body: fixture.subarray(start, end + 1),
    })
  })
  await page.goto('/xray/')
  await page.locator('#xray-url').fill('https://xray.test/sample.zarr/')
  await page.locator('#xray-open-url').click()
  await expect(page.locator('#xray-status')).toContainText('OME-ZARR 4 × 4')
  await expect(page.locator('#xray-status')).toContainText('One bounded preview tile was decoded.')
  await expect(page.locator('#xray-plan')).toContainText('scientific-tile')
  await expect(page.locator('#xray-dependency-select')).toBeEnabled()
  await expect(page.locator('#xray-dependency')).toContainText('physical-transfer')
})
