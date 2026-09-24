import { expect, test } from '@playwright/test'
import { verifyJpegXlDocumentPatch } from './jpegxl-pipeline-harness.ts'

test('JPEG XL document patch encoding and decoding agree in a real browser', async ({ page }) => {
  const expected = await verifyJpegXlDocumentPatch()
  expect(expected.frames).toEqual([
    ['reference', 'modular', 0],
    ['regular', 'modular', 2],
  ])
  expect(expected.samples).toBe(256 * 256 * 3)
  expect(expected.maximum).toBe(0)
  await page.goto('/compatibility.html')
  const actual = await page.evaluate(async () => {
    const path = '/jpegxl-pipeline.js'
    return (await import(path)).verifyJpegXlDocumentPatch()
  })
  expect(actual).toEqual(expected)
})
