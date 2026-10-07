import { expect, test } from '@playwright/test'
import { verifyJpegXlGroupContexts } from '../tests/helpers/jpegxl-group-contexts.ts'

test('spatial histogram selectors preserve complete coefficients in browsers', async ({ page }) => {
  const expected = await verifyJpegXlGroupContexts(true)
  await page.goto('/compatibility.html')
  const actual = await page.evaluate(async () => {
    const path = '/jpegxl-pipeline.js'
    const module = await import(path)
    return module.verifyJpegXlGroupContexts(true)
  })
  expect(actual).toEqual(expected)
})
