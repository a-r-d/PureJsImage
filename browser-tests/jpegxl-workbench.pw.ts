import { expect, test } from '@playwright/test'

test('JPEG XL workbench transcodes and reconstructs the pinned JPEG locally', async ({ page }) => {
  await page.goto('/jpeg-xl/')

  await expect(
    page.getByRole('heading', {
      name: 'Decode JPEG XL and verify exact JPEG transcoding in JavaScript',
    }),
  ).toBeVisible()
  await expect(page.locator('#jxl-status')).toContainText('inspected and decoded locally')
  await expect(page.locator('#jxl-summary')).toContainText('Eligible')
  await expect(page.locator('#jxl-preview')).toHaveAttribute('width', '320')
  await expect(page.locator('#jxl-preview')).toHaveAttribute('height', '240')

  await page.locator('#jxl-transcode').click()
  await expect(page.locator('#jxl-status')).toContainText(
    'Exact JPEG coefficient transcode verified locally',
  )
  await expect(page.locator('#jxl-summary')).toContainText('exact-jpeg')
  await expect(page.locator('#jxl-summary')).toContainText('Verified')
  await expect(page.locator('#jxl-details')).toContainText('jpegxl-jpeg-transcode')
  const jxlDownload = page.waitForEvent('download')
  await page.locator('#jxl-download').click()
  expect((await jxlDownload).suggestedFilename()).toBe('jpegxl-progressive-yuv420.jxl')

  await page.locator('#jxl-reconstruct').click()
  await expect(page.locator('#jxl-status')).toContainText(
    'Original JPEG bytes reconstructed locally',
  )
  const jpegDownload = page.waitForEvent('download')
  await page.locator('#jxl-download').click()
  expect((await jpegDownload).suggestedFilename()).toBe(
    'jpegxl-progressive-yuv420-reconstructed.jpg',
  )
})

test('JPEG XL workbench opens a reconstruction file and enables exact output', async ({ page }) => {
  await page.goto('/jpeg-xl/')
  await expect(page.locator('#jxl-status')).toContainText('inspected and decoded locally')

  await page.locator('#jxl-open-jxl').click()
  await expect(page.locator('#jxl-status')).toContainText(
    'jpegxl-progressive-yuv420.jxl inspected and decoded locally',
  )
  await expect(page.locator('#jxl-summary')).toContainText('Metadata present')
  await expect(page.locator('#jxl-reconstruct')).toBeEnabled()
})
