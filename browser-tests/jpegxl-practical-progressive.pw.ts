import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

test('JPEG XL selective PQ16 DC preview runs in Chromium before final sections', async ({
  page,
}) => {
  const bytes = await readFile('tests/fixtures/jpegxl/practical-progressive/pq-rgb16.jxl')
  await page.goto('/compatibility.html')
  const result = await page.evaluate(async (input) => {
    const path = '/jpegxl-pipeline.js'
    return (await import(path)).verifyJpegXlSelectiveHdr(new Uint8Array(input))
  }, Array.from(bytes))
  expect(result).toBe(true)
})

test('JPEG XL selective PQ16 alpha DC preview runs in Chromium', async ({ page }) => {
  const bytes = await readFile('tests/fixtures/jpegxl/practical-progressive/pq-rgba16-small.jxl')
  await page.goto('/compatibility.html')
  const result = await page.evaluate(async (input) => {
    const path = '/jpegxl-pipeline.js'
    return (await import(path)).verifyJpegXlSelectiveHdrAlpha(new Uint8Array(input))
  }, Array.from(bytes))
  expect(result).toBe(true)
})

test('JPEG XL selective linear16 alpha DC preview runs in Chromium', async ({ page }) => {
  const bytes = await readFile(
    'tests/fixtures/jpegxl/practical-progressive/linear-rgba16-small.jxl',
  )
  await page.goto('/compatibility.html')
  const result = await page.evaluate(async (input) => {
    const path = '/jpegxl-pipeline.js'
    return (await import(path)).verifyJpegXlSelectiveHdrAlpha(new Uint8Array(input))
  }, Array.from(bytes))
  expect(result).toBe(true)
})

test('JPEG XL exact grayscale JPEG reconstruction runs in Chromium', async ({ page }) => {
  const bytes = await readFile('tests/fixtures/jpegxl/gray-exact/gray-progressive.jpg')
  await page.goto('/compatibility.html')
  const result = await page.evaluate(async (input) => {
    const path = '/jpegxl-pipeline.js'
    return (await import(path)).verifyJpegXlGrayscaleExact(new Uint8Array(input))
  }, Array.from(bytes))
  expect(result).toBe(true)
})
