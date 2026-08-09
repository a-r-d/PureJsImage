import { expect, test, type Page } from '@playwright/test'

const harness = async (page: Page): Promise<void> => {
  await page.goto('/')
  await page.waitForFunction(() => typeof window.pureJsImageBrowserTests === 'object')
}

test('uses File, Blob, ArrayBuffer, Uint8Array, toBlob, and toUint8Array', async ({ page }) => {
  await harness(page)
  const results = await page.evaluate(() => window.pureJsImageBrowserTests.inputTypes())
  expect(results).toHaveLength(5)
  expect(results.every(({ outputBytes }) => outputBytes > 0)).toBe(true)
})

test('decodes JPEG metadata and runs crop, resize, rotation, and JPEG encoding', async ({
  page,
}) => {
  await harness(page)
  const result = await page.evaluate(() => window.pureJsImageBrowserTests.jpegPipeline())
  expect(result.outputBytes).toBeGreaterThan(100)
  expect(result.detail).toContain('100x120')
})

test('runs the opt-in Rust/WASM JPEG accelerator in a real browser', async ({ page }) => {
  await harness(page)
  const result = await page.evaluate(() => window.pureJsImageBrowserTests.wasmJpeg())
  expect(result.outputBytes).toBeGreaterThan(100)
  expect(result.detail).toContain('matched the TypeScript reference')
})

test('encodes and decodes a refinement-based progressive JPEG', async ({ page }) => {
  await harness(page)
  const result = await page.evaluate(() => window.pureJsImageBrowserTests.progressiveJpeg())
  expect(result.outputBytes).toBeGreaterThan(100)
  expect(result.detail).toContain('matched baseline pixels')
})

test('decodes and encodes PNG while preserving alpha', async ({ page }) => {
  await harness(page)
  const result = await page.evaluate(() => window.pureJsImageBrowserTests.pngAlphaPipeline())
  expect(result.outputBytes).toBeGreaterThan(50)
  expect(result.detail).toContain('preserved alpha')
})

test('losslessly encodes WebP with exact browser pixels', async ({ page }) => {
  await harness(page)
  const result = await page.evaluate(() => window.pureJsImageBrowserTests.webpLossless())
  expect(result.outputBytes).toBeGreaterThan(20)
  expect(result.detail).toContain('matched browser RGBA pixels')
})

test('decodes a Sharp/libaom quantization-matrix AVIF', async ({ page }) => {
  await harness(page)
  const result = await page.evaluate(() => window.pureJsImageBrowserTests.avifQuantizationMatrix())
  expect(result.outputBytes).toBeGreaterThan(100)
  expect(result.detail).toContain('matched Chromium')
})

test('decodes the independently validated Main 10/PQ HEIF display fixture', async ({ page }) => {
  await harness(page)
  const result = await page.evaluate(() => window.pureJsImageBrowserTests.heifPqDisplay())
  expect(result.outputBytes).toBeGreaterThan(100)
  expect(result.detail).toContain('32x32 PNG')
})

test('applies JPEG EXIF orientation in the browser', async ({ page }) => {
  await harness(page)
  const result = await page.evaluate(() => window.pureJsImageBrowserTests.orientation())
  expect(result.detail).toContain('orientation 6')
})

test('aborts failed output and permits a clean subsequent operation', async ({ page }) => {
  await harness(page)
  const result = await page.evaluate(() => window.pureJsImageBrowserTests.failureCleanup())
  expect(result.detail).toContain('aborted their sinks')
})
