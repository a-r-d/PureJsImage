import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

const canvasSignature = async (page: Page): Promise<number> =>
  page.locator('#scientific-canvas').evaluate((element) => {
    if (!(element instanceof HTMLCanvasElement))
      throw new Error('Scientific output is not a canvas')
    const context = element.getContext('2d')
    if (!context) throw new Error('Scientific canvas context is unavailable')
    const pixels = context.getImageData(0, 0, element.width, element.height).data
    let signature = 0
    for (let index = 0; index < pixels.length; index += 97) {
      signature = (Math.imul(signature, 33) + (pixels[index] ?? 0)) >>> 0
    }
    return signature
  })

test('opens, maps, and locally reloads GSF, ENVI, and FITS scientific rasters', async ({
  page,
}) => {
  const externalRequests: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.protocol !== 'blob:' && url.hostname !== '127.0.0.1') {
      externalRequests.push(request.url())
    }
  })

  await page.goto('/scientific/')
  await expect(
    page.getByRole('heading', { name: 'Download compatible scientific raster files' }),
  ).toBeVisible()
  await expect(page.getByRole('link', { name: 'Browse RIT files ↗' })).toHaveAttribute(
    'href',
    'https://dirsapps.cis.rit.edu/share2012/SPECTIR_HSI/',
  )
  await expect(
    page.getByRole('heading', { name: 'Specific files ready to download' }),
  ).toBeVisible()
  const fileTypeBadges = page.locator('.scientific-direct-file-grid .scientific-file-type')
  await expect(fileTypeBadges).toHaveCount(8)
  await expect(fileTypeBadges).toHaveText([
    'ENVI',
    'ENVI',
    'ENVI CLASSIFICATION · ZIP',
    'FITS',
    'FITS',
    'FITS',
    'MRC',
    'CBF',
  ])
  const fitsDownloads = page.locator('.scientific-direct-actions a[download$=".fits"]')
  await expect(fitsDownloads).toHaveCount(3)
  await expect(fitsDownloads.first()).toHaveAttribute(
    'href',
    'https://fits.gsfc.nasa.gov/samples/WFPC2ASSNu5780205bx.fits',
  )
  await expect(page.getByRole('link', { name: '2. Binary · 24.7 MiB ↗' })).toHaveAttribute(
    'href',
    /M3G20081129T171431_V03_RDN\.IMG$/,
  )
  await expect(page.locator('#scientific-status')).toHaveText(
    'Rendered locally from native numeric samples.',
    { timeout: 15_000 },
  )
  await expect(page.locator('#scientific-metric-dimensions')).toHaveText('128 × 96')
  await expect(page.locator('#scientific-metric-physical')).toContainText('12.8 µm × 9.6 µm')
  await expect(page.locator('#scientific-metric-samples')).toContainText('float32 · m')
  await expect(page.locator('#scientific-metric-time')).toContainText('ms')
  const surfaceSignature = await canvasSignature(page)
  expect(surfaceSignature).not.toBe(0)
  await page.locator('#scientific-relief').uncheck()
  await expect(async () => expect(await canvasSignature(page)).not.toBe(surfaceSignature)).toPass()

  const localGsf = await readFile('docs-astro/public/demo-data/scientific/synthetic-afm.gsf')
  await page.locator('#scientific-gsf-file').setInputFiles({
    name: 'local-surface.gsf',
    mimeType: 'application/octet-stream',
    buffer: localGsf,
  })
  await expect(page.locator('#scientific-metric-name')).toContainText('local-surface.gsf')
  await expect(page.locator('#scientific-metric-bytes-label')).toHaveText('Input size')

  await page.getByRole('tab', { name: 'ENVI raster' }).click()
  await page.getByRole('button', { name: 'Load synthetic ENVI cube' }).click()
  await expect(page.locator('#scientific-metric-dimensions')).toHaveText('96 × 64 × 16')
  await expect(page.locator('#scientific-metric-detail')).toHaveText('16 spectral bands')
  await expect(page.locator('#scientific-metric-bytes-label')).toHaveText('Binary bytes read')
  await expect(page.locator('#scientific-selection')).toHaveText('Band 9 of 16, 722 Nanometers')
  await page.locator('#scientific-wavelength').fill('10')
  await expect(page.locator('#scientific-selection')).toHaveText('Band 11 of 16, 809 Nanometers')
  await page.locator('#scientific-display-mode').selectOption('composite')
  await expect(page.locator('#scientific-selection')).toHaveText(
    'R band 11 (809 Nanometers); G band 7 (641 Nanometers); B band 3 (501 Nanometers)',
  )
  await expect(page.locator('#scientific-relief-controls')).toBeHidden()

  await page.getByRole('button', { name: 'Load synthetic classification map' }).click()
  await expect(page.locator('#scientific-metric-dimensions')).toHaveText('160 × 120')
  await expect(page.locator('#scientific-metric-detail')).toHaveText('4 declared classes')
  await expect(page.locator('#scientific-selection')).toHaveText('ENVI Classification · 4 classes')
  await expect(page.locator('#scientific-display-mode-field')).toBeHidden()

  const [header, data] = await Promise.all([
    readFile('docs-astro/public/demo-data/scientific/synthetic-hyperspectral.hdr'),
    readFile('docs-astro/public/demo-data/scientific/synthetic-hyperspectral.bin'),
  ])
  const institutionalHeader = Buffer.from(
    header.toString('utf8').replace('header offset = 0\n', ''),
    'utf8',
  )
  await page.locator('#scientific-envi-header').setInputFiles({
    name: 'M3G20081129T171431_V03_RDN.HDR.txt',
    mimeType: 'text/plain',
    buffer: institutionalHeader,
  })
  await page.locator('#scientific-envi-data').setInputFiles({
    name: 'local-cube.bin',
    mimeType: 'application/octet-stream',
    buffer: data,
  })
  await expect(page.locator('#scientific-open-envi')).toBeEnabled()
  await page.locator('#scientific-open-envi').click()
  await expect(page.locator('#scientific-metric-name')).toHaveText(
    'M3G20081129T171431_V03_RDN.HDR.txt + local-cube.bin',
  )
  await expect(page.locator('#scientific-metric-dimensions')).toHaveText('96 × 64 × 16')

  await page.getByRole('tab', { name: 'FITS image arrays' }).click()
  await page.getByRole('button', { name: 'Load synthetic FITS cube' }).click()
  await expect(page.locator('#scientific-metric-name')).toHaveText('synthetic-cube.fits')
  await expect(page.locator('#scientific-metric-dimensions')).toHaveText('128 × 96 × 3')
  await expect(page.locator('#scientific-metric-bytes-label')).toHaveText('FITS bytes read')
  await expect(page.locator('#scientific-selection')).toHaveText('HDU 0, XY slice 1')
  await page.locator('#scientific-slice-index').fill('2')
  await expect(page.locator('#scientific-selection')).toHaveText('HDU 0, XY slice 3')
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download PNG' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('purejsimage-scientific-display.png')
  expect(externalRequests).toEqual([])
})
