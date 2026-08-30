import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { createGeneratedFourDStemFixture } from '../benchmark/four-d-stem/generated-fixture.ts'

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

const mrcVolumeFixture = (): Buffer => {
  const output = Buffer.alloc(1_024 + 2 * 2 * 3 * 2)
  const integer = (offset: number, value: number): void => {
    output.writeInt32LE(value, offset)
  }
  const real = (offset: number, value: number): void => {
    output.writeFloatLE(value, offset)
  }
  integer(0, 2)
  integer(4, 2)
  integer(8, 3)
  integer(12, 1)
  integer(28, 2)
  integer(32, 2)
  integer(36, 3)
  real(40, 2)
  real(44, 2)
  real(48, 3)
  real(52, 90)
  real(56, 90)
  real(60, 90)
  integer(64, 1)
  integer(68, 2)
  integer(72, 3)
  output.write('MAP ', 208, 'ascii')
  output.set([0x44, 0x44, 0, 0], 212)
  for (let index = 0; index < 12; index += 1) output.writeInt16LE(index, 1_024 + index * 2)
  return output
}

test('opens, maps, and locally reloads GSF, ENVI, FITS, and MRC rasters', async ({ page }) => {
  const externalRequests: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.protocol !== 'blob:' && url.hostname !== '127.0.0.1') {
      externalRequests.push(request.url())
    }
  })

  await page.goto('/scientific/')
  await expect(page.getByRole('heading', { name: 'Open a scientific raster' })).toBeVisible()
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
  await expect(page.locator('#scientific-metric-bytes-label')).toHaveText('Source size')

  await page.getByRole('tab', { name: 'ENVI raster' }).click()
  await page.getByRole('button', { name: 'Load synthetic ENVI cube' }).click()
  await expect(page.locator('#scientific-metric-dimensions')).toHaveText('96 × 64 × 16')
  await expect(page.locator('#scientific-metric-detail')).toHaveText('16 spectral bands')
  await expect(page.locator('#scientific-metric-bytes-label')).toHaveText('Source size')
  await expect(page.locator('#scientific-selection')).toHaveText('Band 9 of 16, 722 Nanometers')
  await page.locator('#scientific-wavelength').fill('10')
  await expect(page.locator('#scientific-selection')).toHaveText('Band 11 of 16, 809 Nanometers')
  await page.locator('#scientific-display-mode').selectOption('composite')
  await expect(page.locator('#scientific-selection')).toHaveText(
    'R band 11 (809 Nanometers); G band 7 (641 Nanometers); B band 3 (501 Nanometers)',
  )
  await expect(page.locator('#scientific-relief-controls')).toHaveAttribute('hidden', '')

  await page.getByRole('button', { name: 'Load synthetic classification map' }).click()
  await expect(page.locator('#scientific-metric-dimensions')).toHaveText('160 × 120')
  await expect(page.locator('#scientific-metric-detail')).toHaveText('4 declared classes')
  await expect(page.locator('#scientific-selection')).toHaveText('ENVI Classification · 4 classes')
  await expect(page.locator('#scientific-display-mode-field')).toHaveAttribute('hidden', '')

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
  await expect(page.locator('#scientific-metric-bytes-label')).toHaveText('Source size')
  await expect(page.locator('#scientific-selection')).toHaveText('HDU 0, XY slice 1')
  await expect(page.locator('#scientific-slice-axis option[value="xz"]')).toHaveAttribute(
    'disabled',
    '',
  )
  await expect(page.locator('#scientific-slice-axis option[value="yz"]')).toHaveAttribute(
    'disabled',
    '',
  )
  await page.locator('#scientific-slice-index').fill('2')
  await expect(page.locator('#scientific-selection')).toHaveText('HDU 0, XY slice 3')

  await page.getByRole('tab', { name: 'MRC volumes' }).click()
  await page.locator('#scientific-mrc-file').setInputFiles({
    name: 'local-volume.mrc',
    mimeType: 'application/octet-stream',
    buffer: mrcVolumeFixture(),
  })
  await expect(page.locator('#scientific-metric-dimensions')).toHaveText('2 × 2 × 3')
  await expect(page.locator('#scientific-slice-axis option[value="xz"]')).not.toHaveAttribute(
    'disabled',
    '',
  )
  await expect(page.locator('#scientific-slice-axis option[value="yz"]')).not.toHaveAttribute(
    'disabled',
    '',
  )
  await page.locator('#scientific-slice-axis').selectOption('xz')
  await expect(page.locator('#scientific-selection')).toHaveText('XZ slice 1')
  await page.locator('#scientific-slice-axis').selectOption('yz')
  await expect(page.locator('#scientific-selection')).toHaveText('YZ slice 1')
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download PNG' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('purejsimage-scientific-display.png')
  expect(externalRequests).toEqual([])
})

test('opens a local file through the generated generic reader catalog', async ({ page }) => {
  const mutatingRequests: string[] = []
  page.on('request', (request) => {
    if (request.method() !== 'GET' && request.method() !== 'HEAD') {
      mutatingRequests.push(`${request.method()} ${request.url()}`)
    }
  })
  const localGsf = await readFile('docs-astro/public/demo-data/scientific/synthetic-afm.gsf')
  await page.goto('/scientific/')
  await page.getByRole('tab', { name: 'All package readers' }).click()
  await page.locator('#scientific-generic-files').setInputFiles({
    name: 'catalog-surface.gsf',
    mimeType: 'application/octet-stream',
    buffer: localGsf,
  })
  await expect(page.locator('#scientific-generic-primary')).toBeEnabled()
  await page.locator('#scientific-open-generic').click()
  await expect(page.locator('#scientific-metric-name')).toContainText('catalog-surface.gsf')
  await expect(page.locator('#scientific-status')).toHaveText(
    'Rendered locally from native numeric samples.',
  )
  await expect(page.locator('#scientific-metric-physical')).toContainText(
    'Gwyddion Simple Field · purejsimage/gsf',
  )
  await expect(page.locator('#scientific-generic-axis-controls')).toBeVisible()

  const fixture = createGeneratedFourDStemFixture()
  await page.locator('#scientific-generic-files').setInputFiles([
    {
      name: 'fixture.mib',
      mimeType: 'application/x-merlin-mib',
      buffer: Buffer.from(fixture.mib),
    },
    { name: 'fixture.hdr', mimeType: 'text/plain', buffer: Buffer.from(fixture.hdr) },
  ])
  await page.locator('#scientific-open-generic').click()
  await expect(page.locator('#scientific-metric-physical')).toContainText(
    'Quantum Detectors Merlin MIB · purejsimage/mib',
  )
  await expect(page.locator('#scientific-generic-axis-x')).toHaveValue('kx')
  await expect(page.locator('#scientific-generic-axis-y')).toHaveValue('ky')
  await expect(page.locator('#scientific-generic-fixed-axes')).toContainText('Scan X index')
  await expect(page.locator('#scientific-generic-fixed-axes')).toContainText('Scan Y index')
  expect(mutatingRequests).toEqual([])
})
