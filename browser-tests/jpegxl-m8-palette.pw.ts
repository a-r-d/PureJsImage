import { expect, test } from '@playwright/test'

test('workbench decodes the official global delta palette fixture', async ({ page }) => {
  await page.goto('/jpeg-xl/')
  await expect(page.locator('#jxl-status')).toContainText('inspected and decoded locally')
  await page
    .locator('#jxl-file')
    .setInputFiles('tests/fixtures/jpegxl/m8-implicit-palette/delta_palette.jxl')
  await expect(page.locator('#jxl-status')).toContainText(
    'delta_palette.jxl inspected and decoded locally',
  )
  await expect(page.locator('#jxl-summary')).toContainText('555 × 751')
  const dimensions = await page.locator('#jxl-preview').evaluate((element) => {
    if (!(element instanceof HTMLCanvasElement)) throw new Error('Expected preview canvas')
    return [element.width, element.height]
  })
  expect(dimensions).toEqual([555, 751])
  const hash = await page.locator('#jxl-preview').evaluate(async (element) => {
    if (!(element instanceof HTMLCanvasElement)) throw new Error('Expected preview canvas')
    const context = element.getContext('2d')
    if (!context) throw new Error('Missing canvas context')
    const rgba = context.getImageData(0, 0, element.width, element.height).data
    const rgb = new Uint8Array(element.width * element.height * 3)
    for (let i = 0; i < rgb.length / 3; i++) {
      rgb[i * 3] = rgba[i * 4] ?? 0
      rgb[i * 3 + 1] = rgba[i * 4 + 1] ?? 0
      rgb[i * 3 + 2] = rgba[i * 4 + 2] ?? 0
    }
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', rgb))
    return Array.from(digest, (value) => value.toString(16).padStart(2, '0')).join('')
  })
  expect(hash).toBe('684e1111d59451df0a887228bf710a58b5eea37ff9c4c35ad6ad447e6c696137')
})
