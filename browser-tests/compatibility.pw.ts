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
test('uses Lanczos3 as the default resize kernel in a real browser', async ({ page }) => {
  await harness(page)
  const result = await page.evaluate(() => window.pureJsImageBrowserTests.resizeDefaultKernel())
  expect(result.outputBytes).toBeGreaterThan(50)
  expect(result.detail).toContain('matched explicit Lanczos3')
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
test('selects SIMD and preserves scalar JPEG encoding fallback in a real browser', async ({
  page,
}) => {
  await harness(page)
  const result = await page.evaluate(() => window.pureJsImageBrowserTests.wasmJpegEncode())
  expect(result.outputBytes).toBeGreaterThan(100)
  expect(result.detail).toContain('SIMD selection and scalar JPEG encoder fallback passed')
})
test('selects SIMD and preserves scalar PNG decode and encode fallback in a real browser', async ({
  page,
}) => {
  await harness(page)
  const result = await page.evaluate(() => window.pureJsImageBrowserTests.wasmPng())
  expect(result.outputBytes).toBeGreaterThan(100)
  expect(result.detail).toContain('matched exact public output')
})

test('encodes and decodes a refinement-based progressive JPEG', async ({ page }) => {
  await harness(page)
  const result = await page.evaluate(() => window.pureJsImageBrowserTests.progressiveJpeg())
  expect(result.outputBytes).toBeGreaterThan(100)
  expect(result.detail).toContain('matched baseline pixels')
})

test('requires explicit first-frame selection for animated GIF decode', async ({ page }) => {
  await harness(page)
  const result = await page.evaluate(() =>
    window.pureJsImageBrowserTests.animatedGifFrameSelection(),
  )
  expect(result.outputBytes).toBeGreaterThan(50)
  expect(result.detail).toContain('required explicit frame 0 selection')
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

test('decodes lossy WebP macroblock rows in a real browser', async ({ page }) => {
  await harness(page)
  const result = await page.evaluate(() => window.pureJsImageBrowserTests.webpLossyDecode())
  expect(result.outputBytes).toBeGreaterThan(100)
  expect(result.detail).toContain('macroblock rows decoded')
})

test('decodes a Sharp/libaom quantization-matrix AVIF', async ({ page }) => {
  await harness(page)
  const result = await page.evaluate(() => window.pureJsImageBrowserTests.avifQuantizationMatrix())
  expect(result.outputBytes).toBeGreaterThan(100)
  expect(result.detail).toContain('matched Chromium')
})

test('decodes Main 10/PQ HEIF through explicit experimental registration', async ({ page }) => {
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
