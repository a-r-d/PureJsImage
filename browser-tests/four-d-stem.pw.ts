import { expect, test } from '@playwright/test'

test('opens the deterministic MIB fixture and links scan and detector space', async ({ page }) => {
  await page.goto('/4d-stem/')
  await expect(page.locator('#stem-status')).toContainText('Ready')
  await expect(page.locator('#stem-source-summary')).toContainText(
    'purejsimage/mib@1.0.0 · uint16 · scan 7 × 5',
  )
  await expect(page.locator('#stem-source-summary')).toContainText('detector 17 × 15')
  await expect(page.locator('#stem-navigation')).toHaveJSProperty('width', 7)
  await expect(page.locator('#stem-navigation')).toHaveJSProperty('height', 5)
  await expect(page.locator('#stem-diffraction')).toHaveJSProperty('width', 17)
  await expect(page.locator('#stem-diffraction')).toHaveJSProperty('height', 15)
  await expect(page.locator('#stem-evidence-reads')).not.toHaveText('0 reads · 0 B')
  await expect(page.locator('#stem-evidence-transfers')).toHaveText(
    'Local source · no network transfer',
  )
  await expect(page.locator('#stem-evidence-cache')).toContainText('hits')
  await expect(page.locator('#stem-evidence-memory')).toContainText('peak')
  await expect(page.locator('#stem-evidence-coverage')).toContainText('unique')
  await expect(page.locator('#stem-evidence-provider')).toContainText(
    'purejsimage.analysis.four-d-stem.reference@1',
  )
})

test('moves the scan cursor with pointer and keyboard input', async ({ page }) => {
  await page.goto('/4d-stem/')
  await expect(page.locator('#stem-status')).toContainText('Ready')
  const canvas = page.locator('#stem-navigation')
  await canvas.click({ position: { x: 440, y: 120 } })
  await expect(page.locator('#stem-cursor-summary')).toContainText('Scan 6, 2')
  await canvas.press('ArrowRight')
  await expect(page.locator('#stem-cursor-summary')).toContainText('Scan 7, 2')
  await canvas.press('ArrowDown')
  await expect(page.locator('#stem-cursor-summary')).toContainText('Scan 7, 3')
})

test('draws detector and scan ROIs through bounded worker reductions', async ({ page }) => {
  await page.goto('/4d-stem/')
  await expect(page.locator('#stem-status')).toContainText('Ready')
  const originalNavigationRange = await page.locator('#stem-navigation-range').textContent()
  const diffraction = page.locator('#stem-diffraction')
  await diffraction.dragTo(diffraction, {
    sourcePosition: { x: 250, y: 180 },
    targetPosition: { x: 410, y: 310 },
  })
  await expect(page.locator('#stem-status')).toContainText('bounded worker reads and tiles')
  await expect(page.locator('#stem-navigation-range')).not.toHaveText(originalNavigationRange ?? '')
  const originalDiffractionRange = await page.locator('#stem-diffraction-range').textContent()
  const navigation = page.locator('#stem-navigation')
  await navigation.dragTo(navigation, {
    sourcePosition: { x: 100, y: 90 },
    targetPosition: { x: 420, y: 300 },
  })
  await expect(page.locator('#stem-status')).toContainText('bounded worker reads and tiles')
  await expect(page.locator('#stem-diffraction-range')).not.toHaveText(
    originalDiffractionRange ?? '',
  )
})

test('cancels stale interaction work and leaves the latest request visible', async ({ page }) => {
  await page.goto('/4d-stem/')
  await expect(page.locator('#stem-status')).toContainText('Ready')
  await page.locator('#stem-navigation').evaluate((canvas) => {
    for (let index = 0; index < 5; index += 1) {
      canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    }
    for (let index = 0; index < 5; index += 1) {
      canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    }
  })
  await expect(page.locator('#stem-status')).toContainText('Ready')
  await expect(page.locator('#stem-cursor-summary')).toContainText('Scan 7, 5')
  await expect(page.locator('#stem-evidence-cancellations')).not.toHaveText('0')
})

test('keeps the linked workspace inside a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/4d-stem/')
  await expect(page.locator('#stem-status')).toContainText('Ready')
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  )
  expect(overflow).toBeLessThanOrEqual(1)
  await expect(page.locator('#stem-navigation')).toBeVisible()
  await expect(page.locator('#stem-diffraction')).toBeVisible()
})

test('applies an explicit annulus, exports results, and releases worker state', async ({
  page,
}) => {
  const mutatingRequests: string[] = []
  page.on('request', (request) => {
    if (request.method() !== 'GET' && request.method() !== 'HEAD') {
      mutatingRequests.push(`${request.method()} ${request.url()}`)
    }
  })
  await page.goto('/4d-stem/')
  await expect(page.locator('#stem-status')).toContainText('Ready')
  await page.locator('#stem-detector-shape').selectOption('annulus')
  await page.locator('#stem-detector-x').fill('7.5')
  await page.locator('#stem-detector-y').fill('6.5')
  await page.locator('#stem-detector-inner').fill('2')
  await page.locator('#stem-detector-outer').fill('5')
  await page.locator('#stem-apply-detector-roi').click()
  await expect(page.locator('#stem-status')).toContainText('bounded worker reads and tiles')

  const png = page.waitForEvent('download')
  await page.locator('#stem-download-navigation').click()
  await expect((await png).suggestedFilename()).toBe('purejsimage-4d-stem-navigation.png')
  const json = page.waitForEvent('download')
  await page.locator('#stem-export-evidence').click()
  await expect((await json).suggestedFilename()).toBe('purejsimage-4d-stem-evidence.json')
  expect(mutatingRequests).toEqual([])

  await page.locator('#stem-close').click()
  await expect(page.locator('#stem-status')).toContainText('Closed')
  await expect(page.locator('#stem-source-summary')).toContainText('resources and retained tiles')
})
