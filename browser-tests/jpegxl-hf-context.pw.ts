import { expect, test } from '@playwright/test'

test('workbench decodes a real 12 MP effort-1 stream with a large HF context map', async ({
  page,
}) => {
  await page.goto('/jpeg-xl/')
  await expect(page.locator('#jxl-status')).toContainText('inspected and decoded locally')
  await page
    .locator('#jxl-file')
    .setInputFiles('tests/fixtures/jpegxl/m7-effort1-context-map/image.jxl')
  await expect(page.locator('#jxl-status')).toContainText(
    'image.jxl inspected and decoded locally',
    { timeout: 30_000 },
  )
  await expect(page.locator('#jxl-summary')).toContainText('4000 × 3000')
  const dimensions = await page.locator('#jxl-preview').evaluate((element) => {
    if (!(element instanceof HTMLCanvasElement)) throw new Error('Expected preview canvas')
    return [element.width, element.height]
  })
  expect(dimensions[0]).toBeGreaterThan(0)
  expect(dimensions[1]).toBeGreaterThan(0)
})
