import { expect, test } from '@playwright/test'

test('JPEG XL M4 color samples and all orientations agree in the browser', async ({ page }) => {
  await page.goto('/compatibility.html')
  const result = await page.evaluate(async () => {
    const path = '/jpegxl-color.js'
    const module = await import(path)
    return { colors: await module.verifyColors(), orientations: await module.verifyOrientations() }
  })
  expect(result).toEqual({ colors: 124, orientations: 8 })
})

test('JPEG XL explicit float display conversion works in Chromium', async ({ page }) => {
  await page.goto('/compatibility.html')
  const result = await page.evaluate(async () => {
    const path = '/jpegxl-color.js'
    const module = await import(path)
    return module.verifyFloatDisplay()
  })
  expect(result).toBe(true)
})

test('JPEG XL high-depth ICC display conversion works in Chromium', async ({ page }) => {
  await page.goto('/compatibility.html')
  const result = await page.evaluate(async () => {
    const path = '/jpegxl-color.js'
    return (await import(path)).verifyIcc16Display()
  })
  expect(result).toBe(true)
})
