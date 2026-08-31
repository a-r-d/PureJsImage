import { expect, test } from '@playwright/test'

test('HDR Surgery renders and reopens its deterministic sample locally', async ({ page }) => {
  await page.goto('/hdr-surgery/')

  await expect(
    page.getByRole('heading', {
      name: 'Ultra HDR JPEG editor and gain map inspector for JavaScript',
    }),
  ).toBeVisible()
  await expect(page.locator('#hdr-status')).toContainText('software preview rendered at 4.00×')
  await expect(page.locator('#hdr-adapted')).toHaveAttribute('width', '320')
  await expect(page.locator('#hdr-adapted')).toHaveAttribute('height', '180')
  await expect(page.locator('#hdr-false-color')).toHaveAttribute('width', '320')
  await expect(page.locator('#hdr-metadata')).toContainText('iso-21496-1')
  await expect(page.locator('#hdr-evidence')).toContainText('complete')
  await expect(page.locator('#hdr-ranges')).toContainText('SDR primary')
  await expect(page.locator('#hdr-ranges')).toContainText('gain map')

  await page.locator('#hdr-boost').fill('2')
  await expect(page.locator('#hdr-status')).toContainText('software preview rendered at 2.00×')

  await page.locator('#hdr-jpeg').click()
  await expect(page.locator('#hdr-status')).toContainText('dual JPEG generated locally')
  await expect(page.locator('#hdr-native')).toHaveAttribute('src', /^blob:/u)
  await expect(page.locator('#hdr-output-card')).toBeVisible()
  const jpegDownloadPromise = page.waitForEvent('download')
  await page.locator('#hdr-output-download').click()
  expect((await jpegDownloadPromise).suggestedFilename()).toBe('purejsimage-hdr-surgery.jpg')
  await page.locator('#hdr-output-reopen').click()
  await expect(page.locator('#hdr-status')).toContainText('software preview rendered')

  await page.locator('#hdr-reset').click()
  await expect(page.locator('#hdr-status')).toContainText('software preview rendered at 4.00×')
})

test('HDR Surgery rejects stale worker responses', async ({ page }) => {
  await page.goto('/hdr-surgery/')
  await expect(page.locator('#hdr-status')).toContainText('software preview rendered')

  await page.locator('#hdr-boost').fill('2')
  await page.locator('#hdr-boost').fill('8')
  await expect(page.locator('#hdr-status')).toContainText('software preview rendered at 8.00×')
  await expect(page.locator('#hdr-status')).not.toContainText('2.00×')
})

test('HDR Surgery transforms both renditions and generates JPEG and AVIF output', async ({
  page,
}) => {
  await page.goto('/hdr-surgery/')
  await expect(page.locator('#hdr-status')).toContainText('software preview rendered')

  await page.locator('#hdr-crop-width').fill('160')
  await page.locator('#hdr-crop-height').fill('90')
  await page.locator('#hdr-output-width').fill('160')
  await page.locator('#hdr-output-height').fill('90')
  await page.locator('#hdr-output-height').blur()
  await expect(page.locator('#hdr-status')).toContainText('software preview rendered')
  await expect(page.locator('#hdr-adapted')).toHaveAttribute('width', '160')
  await expect(page.locator('#hdr-adapted')).toHaveAttribute('height', '90')

  await page.locator('#hdr-flip-h').click()
  await expect(page.locator('#hdr-flip-h')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('#hdr-status')).toContainText('software preview rendered')
  await page.locator('#hdr-rotate').click()
  await expect(page.locator('#hdr-adapted')).toHaveAttribute('width', '90')
  await expect(page.locator('#hdr-adapted')).toHaveAttribute('height', '160')

  await page.locator('#hdr-jpeg').click()
  await expect(page.locator('#hdr-status')).toContainText('dual JPEG generated locally')
  await expect(page.locator('#hdr-native')).toHaveAttribute('src', /^blob:/u)

  await page.locator('#hdr-avif').click()
  await expect(page.locator('#hdr-status')).toContainText('ISO gain-map AVIF generated locally')
  await expect(page.locator('#hdr-output-name')).toHaveText('purejsimage-hdr-surgery.avif')
  const avifDownloadPromise = page.waitForEvent('download')
  await page.locator('#hdr-output-download').click()
  expect((await avifDownloadPromise).suggestedFilename()).toBe('purejsimage-hdr-surgery.avif')
})

test('HDR Surgery exposes and opens each representative sample class', async ({ page }) => {
  await page.goto('/hdr-surgery/')
  await expect(page.locator('#hdr-status')).toContainText('software preview rendered')
  await page.locator('#hdr-sample').selectOption('hdr-surgery-synthetic-odd-scale.jpg')
  await page.locator('#hdr-open-sample').click()
  await expect(page.locator('#hdr-status')).toContainText('hdr-surgery-synthetic-odd-scale.jpg')
  await expect(page.locator('#hdr-status')).toContainText('software preview rendered')
})
