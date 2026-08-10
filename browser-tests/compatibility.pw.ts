import { expect, type Page, test } from '@playwright/test'

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

test('decodes and composes straight-alpha AVIF items', async ({ page }) => {
  await harness(page)
  const result = await page.evaluate(() => window.pureJsImageBrowserTests.avifAlphaStraight())
  expect(result.outputBytes).toBeGreaterThan(100)
  expect(result.detail).toContain('pinned portable RGBA output')
})

test('decodes and unpremultiplies premultiplied-alpha AVIF items', async ({ page }) => {
  await harness(page)
  const result = await page.evaluate(() => window.pureJsImageBrowserTests.avifAlphaPremultiplied())
  expect(result.outputBytes).toBeGreaterThan(100)
  expect(result.detail).toContain('pinned portable RGBA output')
})
test('decodes lossless quantizer-context-0 identity-color AVIF', async ({ page }) => {
  await harness(page)
  const result = await page.evaluate(() => window.pureJsImageBrowserTests.avifQ0Lossless())
  expect(result.outputBytes).toBeGreaterThan(100)
  expect(result.detail).toContain('pinned portable RGBA output')
})

test('decodes palette-coded AVIF screen content', async ({ page }) => {
  await harness(page)
  const result = await page.evaluate(() => window.pureJsImageBrowserTests.avifPalette())
  expect(result.outputBytes).toBeGreaterThan(100)
  expect(result.detail).toContain('pinned portable RGBA output')
})

test('decodes coded-lossless 10-bit AVIF', async ({ page }) => {
  await harness(page)
  const result = await page.evaluate(() => window.pureJsImageBrowserTests.avifHighBit10())
  expect(result.outputBytes).toBeGreaterThan(100)
  expect(result.detail).toContain('pinned portable RGBA output')
})

test('decodes coded-lossless 12-bit AVIF', async ({ page }) => {
  await harness(page)
  const result = await page.evaluate(() => window.pureJsImageBrowserTests.avifHighBit12())
  expect(result.outputBytes).toBeGreaterThan(100)
  expect(result.detail).toContain('pinned portable RGBA output')
})

test('decodes expanded high-bit AVIF subsets', async ({ page }) => {
  await harness(page)
  const result = await page.evaluate(() => window.pureJsImageBrowserTests.avifExpandedHighBit())
  expect(result.outputBytes).toBeGreaterThan(300)
  expect(result.detail).toContain('pinned portable RGBA output')
  expect(result.detail).toContain('Wiener restoration')
  expect(result.detail).toContain('lossy 10-bit YUV 4:2:0')
  expect(result.detail).toContain('lossy 12-bit YUV 4:2:0')
  expect(result.detail).toContain('lossy 12-bit YUV 4:2:2')
  expect(result.detail).toContain('lossy 12-bit YUV 4:4:4')
})
test('decodes expanded AVIF alpha and grid subsets', async ({ page }) => {
  await harness(page)
  const result = await page.evaluate(() => window.pureJsImageBrowserTests.avifExpandedAlpha())
  expect(result.outputBytes).toBeGreaterThan(300)
  expect(result.detail).toContain('Limited-range 8-bit alpha')
  expect(result.detail).toContain('Full-range 10-bit alpha')
  expect(result.detail).toContain('Full-range 12-bit alpha')
  expect(result.detail).toContain('per-tile alpha auxiliaries')
  expect(result.detail).toContain('independently signaled alpha transform')
})

test('rejects HDR AVIF transfer signaling before SDR pixel conversion', async ({ page }) => {
  await harness(page)
  const result = await page.evaluate(() => window.pureJsImageBrowserTests.avifHdrRejected())
  expect(result.outputBytes).toBeGreaterThan(300)
  expect(result.detail).toContain('PQ and HLG')
  expect(result.detail).toContain('SDR pixel decode rejected both')
})

test('decodes coded-lossless 10-bit AVIF tiles', async ({ page }) => {
  await harness(page)
  const result = await page.evaluate(() => window.pureJsImageBrowserTests.avifHighBitTiles())
  expect(result.outputBytes).toBeGreaterThan(100)
  expect(result.detail).toContain('pinned portable RGBA output')
})

test('decodes lossy AVIF tile and tile-group layouts', async ({ page }) => {
  await harness(page)
  const result = await page.evaluate(() => window.pureJsImageBrowserTests.avifLossyMultitile())
  expect(result.outputBytes).toBeGreaterThan(100)
  expect(result.detail).toContain('pinned portable RGBA output')
  expect(result.detail).toContain('four tile-group OBUs')
})
test('decodes a static AVIF with a non-still AV1 sequence header', async ({ page }) => {
  await harness(page)
  const result = await page.evaluate(() => window.pureJsImageBrowserTests.avifNonstillSequence())
  expect(result.outputBytes).toBeGreaterThan(100)
  expect(result.detail).toContain('pinned portable RGBA output')
})
test('selects a complete layer from a multi-frame AVIF item', async ({ page }) => {
  await harness(page)
  const result = await page.evaluate(() => window.pureJsImageBrowserTests.avifLayeredSelection())
  expect(result.outputBytes).toBeGreaterThan(100)
  expect(result.detail).toContain('lsel spatial layer 0')
  expect(result.detail).toContain('pinned portable RGBA output')
})

test('decodes common-photo AV1 coefficient and palette contexts', async ({ page }) => {
  await harness(page)
  const result = await page.evaluate(() => window.pureJsImageBrowserTests.avifCommonPhotoSyntax())
  expect(result.outputBytes).toBeGreaterThan(300)
  expect(result.detail).toContain('pinned portable RGBA output')
})

test('decodes filter-free AV1 super-resolution', async ({ page }) => {
  await harness(page)
  const result = await page.evaluate(() => window.pureJsImageBrowserTests.avifSuperres())
  expect(result.outputBytes).toBeGreaterThan(100)
  expect(result.detail).toContain('pinned portable RGBA output')
})

test('decodes filtered AV1 super-resolution', async ({ page }) => {
  await harness(page)
  const result = await page.evaluate(() => window.pureJsImageBrowserTests.avifFilteredSuperres())
  expect(result.outputBytes).toBeGreaterThan(100)
  expect(result.detail).toContain('pinned portable RGBA output')
})

test('decodes AVIF through bounded reconstruction rings', async ({ page }) => {
  await harness(page)
  const result = await page.evaluate(() => window.pureJsImageBrowserTests.avifBoundedRows())
  expect(result.outputBytes).toBeGreaterThan(100)
  expect(result.detail).toContain('pinned portable RGBA output')
})

test('resizes AVIF directly from bounded YUV rows', async ({ page }) => {
  await harness(page)
  const result = await page.evaluate(() => window.pureJsImageBrowserTests.avifBoundedResize())
  expect(result.outputBytes).toBeGreaterThan(100)
  expect(result.detail).toContain('pinned portable RGBA output')
})

test('decodes AVIF alpha through synchronized bounded rings', async ({ page }) => {
  await harness(page)
  const result = await page.evaluate(() => window.pureJsImageBrowserTests.avifBoundedAlphaRows())
  expect(result.outputBytes).toBeGreaterThan(100)
  expect(result.detail).toContain('pinned portable RGBA output')
})

test('applies an AVIF clean aperture', async ({ page }) => {
  await harness(page)
  const result = await page.evaluate(() => window.pureJsImageBrowserTests.avifCleanAperture())
  expect(result.outputBytes).toBeGreaterThan(50)
  expect(result.detail).toContain('pinned portable RGBA output')
})

test('decodes and crops skipped intra-block-copy AVIF content', async ({ page }) => {
  await harness(page)
  const result = await page.evaluate(() => window.pureJsImageBrowserTests.avifIntrabc())
  expect(result.outputBytes).toBeGreaterThan(100)
  expect(result.detail).toContain('pinned portable RGBA output')
})

test('decodes residual intra-block-copy AVIF content', async ({ page }) => {
  await harness(page)
  const result = await page.evaluate(() => window.pureJsImageBrowserTests.avifResidualIntrabc())
  expect(result.outputBytes).toBeGreaterThan(100)
  expect(result.detail).toContain('pinned portable RGBA output')
})

test('decodes and composes a cropped-edge AVIF image grid', async ({ page }) => {
  await harness(page)
  const result = await page.evaluate(() => window.pureJsImageBrowserTests.avifGrid())
  expect(result.outputBytes).toBeGreaterThan(100)
  expect(result.detail).toContain('pinned portable RGBA output')
})

test('decodes a Sharp/libaom quantization-matrix AVIF', async ({ page }) => {
  await harness(page)
  const result = await page.evaluate(() => window.pureJsImageBrowserTests.avifQuantizationMatrix())
  expect(result.outputBytes).toBeGreaterThan(100)
  expect(result.detail).toContain('matched Chromium')
})

test('decodes an 8-bit monochrome AVIF', async ({ page }) => {
  await harness(page)
  const result = await page.evaluate(() => window.pureJsImageBrowserTests.avifMonochrome())
  expect(result.outputBytes).toBeGreaterThan(100)
  expect(result.detail).toContain('matched Chromium at')
})

test('decodes an 8-bit YUV 4:2:2 AVIF', async ({ page }) => {
  await harness(page)
  const result = await page.evaluate(() => window.pureJsImageBrowserTests.avifYuv422())
  expect(result.outputBytes).toBeGreaterThan(100)
  expect(result.detail).toContain('pinned browser RGBA output')
})

test('decodes an 8-bit YUV 4:4:4 AVIF', async ({ page }) => {
  await harness(page)
  const result = await page.evaluate(() => window.pureJsImageBrowserTests.avifYuv444())
  expect(result.outputBytes).toBeGreaterThan(100)
  expect(result.detail).toContain('matched Chromium at')
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
