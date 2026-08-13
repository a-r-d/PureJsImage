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
test('keeps optional TIFF workflows and HTTP sources behind explicit browser entries', async ({
  page,
}) => {
  await harness(page)
  const result = await page.evaluate(() => window.pureJsImageBrowserTests.optionalApiEntries())
  expect(result.detail).toContain('entries are explicit')
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
test('decodes lossless JPEG XL local-tree ANS pixels in a real browser', async ({ page }) => {
  await harness(page)
  const result = await page.evaluate(() => window.pureJsImageBrowserTests.jpegXlLossless())
  expect(result.outputBytes).toBeGreaterThan(50)
  expect(result.detail).toContain('matched djxl RGB pixels')
})
test('preserves native high-bit JPEG XL samples in a real browser', async ({ page }) => {
  await harness(page)
  const result = await page.evaluate(() => window.pureJsImageBrowserTests.jpegXlHighBit())
  expect(result.outputBytes).toBeGreaterThan(50)
  expect(result.detail).toContain('native 12-bit RGBA samples')
})
test('decodes multi-group JPEG XL crops in a real browser', async ({ page }) => {
  await harness(page)
  const result = await page.evaluate(() => window.pureJsImageBrowserTests.jpegXlMultiGroup())
  expect(result.outputBytes).toBe(4_096)
  expect(result.detail).toContain('four permuted Modular group boundaries')
})
test('decodes lossless JPEG 2000 pixels in a real browser', async ({ page }) => {
  await harness(page)
  const result = await page.evaluate(() => window.pureJsImageBrowserTests.jpeg2000Decode())
  expect(result.outputBytes).toBeGreaterThan(50)
  expect(result.detail).toContain('matched the pinned portable RGBA output')
})
test('handles supported and unsupported JPEG coding boundaries', async ({ page }) => {
  await harness(page)
  const result = await page.evaluate(() =>
    window.pureJsImageBrowserTests.unsupportedJpegBoundaries(),
  )
  expect(result.outputBytes).toBeGreaterThan(100)
  expect(result.detail).toContain('UNSUPPORTED_OPERATION')
  expect(result.detail).toContain('AVI1/MJPEG')
})

test('recovers malformed JPEG restarts through Rust/WASM by default with strict opt-out', async ({
  page,
}) => {
  await harness(page)
  const result = await page.evaluate(() =>
    window.pureJsImageBrowserTests.tolerantJpegRestartRecovery(),
  )
  expect(result.outputBytes).toBeGreaterThan(100)
  expect(result.detail).toContain('tolerant Rust/WASM JPEG restart recovery matched TypeScript')
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

test('decodes legacy TIFF and odd-width BMP compatibility cases', async ({ page }) => {
  await harness(page)
  const result = await page.evaluate(() => window.pureJsImageBrowserTests.legacyTiffAndBmp())
  expect(result.outputBytes).toBeGreaterThan(100)
  expect(result.detail).toContain('legacy TIFF LZW')
  expect(result.detail).toContain('first-party Zstandard')
  expect(result.detail).toContain('first-party Zstandard and LERC')
  expect(result.detail).toContain('odd-width BMP RLE4')
  expect(result.detail).toContain('wide unsigned, and SGILog TIFF')
  expect(result.detail).toContain('numeric and ICC-managed CMYK')
  expect(result.detail).toContain('CIELab')
  expect(result.detail).toContain('FillOrder 2')
  expect(result.detail).toContain('TIFF SubIFD pyramids')
})

test('uses public scientific TIFF APIs in a real browser', async ({ page }) => {
  await harness(page)
  const result = await page.evaluate(() => window.pureJsImageBrowserTests.scientificTiffDocument())
  expect(result.outputBytes).toBeGreaterThan(100)
  expect(result.detail).toContain('bounded TIFF extension APIs')
  expect(result.detail).toContain('labeled OME-TIFF document opening')
  expect(result.detail).toContain('explicit display conversion')
  expect(result.detail).toContain('native-tile Aperio stripe streaming')
})

test('decodes and encodes PNG while preserving alpha', async ({ page }) => {
  await harness(page)
  const result = await page.evaluate(() => window.pureJsImageBrowserTests.pngAlphaPipeline())
  expect(result.outputBytes).toBeGreaterThan(50)
  expect(result.detail).toContain('preserved alpha')
})

test('encodes tiled BigTIFF and a structured TIFF document in a real browser', async ({ page }) => {
  await harness(page)
  const result = await page.evaluate(() => window.pureJsImageBrowserTests.tiffEncodePipeline())
  expect(result.outputBytes).toBeGreaterThan(100)
  expect(result.detail).toContain('tiled BigTIFF')
  expect(result.detail).toContain('multi-page and SubIFD-pyramid')
  expect(result.detail).toContain('exact browser pixels')
})

test('losslessly encodes WebP with exact browser pixels', async ({ page }) => {
  await harness(page)
  const result = await page.evaluate(() => window.pureJsImageBrowserTests.webpLossless())
  expect(result.outputBytes).toBeGreaterThan(20)
  expect(result.detail).toContain('effort and near-lossless controls passed')
})

test('decodes lossy WebP macroblock rows in a real browser', async ({ page }) => {
  await harness(page)
  const result = await page.evaluate(() => window.pureJsImageBrowserTests.webpLossyDecode())
  expect(result.outputBytes).toBeGreaterThan(100)
  expect(result.detail).toContain('macroblock rows decoded')
})

test('encodes constrained AVIF output in a real browser', async ({ page }) => {
  await harness(page)
  const result = await page.evaluate(() => window.pureJsImageBrowserTests.avifEncode())
  expect(result.outputBytes).toBeGreaterThan(300)
  expect(result.detail).toContain('portable and browser-native decoders')
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

test('decodes rav1e spatial-segmentation AVIF', async ({ page }) => {
  await harness(page)
  const result = await page.evaluate(() => window.pureJsImageBrowserTests.avifSegmentation())
  expect(result.outputBytes).toBeGreaterThan(1_000)
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

test('decodes expanded high-bit AVIF subsets', async ({ browserName, page }) => {
  await harness(page)
  const result = await page.evaluate(() => window.pureJsImageBrowserTests.avifExpandedHighBit())
  expect(result.outputBytes).toBeGreaterThan(300)
  expect(result.detail).toContain('pinned portable RGBA output')
  expect(result.detail).toContain('Wiener restoration')
  if (browserName === 'chromium') expect(result.detail).toContain('pinned Chromium RGBA output')
  expect(result.detail).toContain('self-guided restoration')
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

test('tone-maps HDR AVIF NCLX pixels to SDR', async ({ page }) => {
  test.setTimeout(60_000)
  await harness(page)
  const result = await page.evaluate(() => window.pureJsImageBrowserTests.avifHdrToneMap())
  expect(result.outputBytes).toBeGreaterThan(1_000)
  expect(result.detail).toContain('Display-P3 PQ')
  expect(result.detail).toContain('Rec.2020 HLG')
  expect(result.detail).toContain('Rec.2020 identity PQ')
  expect(result.detail).toContain('Chroma-derived Display-P3 PQ')
  expect(result.detail).toContain('constant-luminance matrix 10')
})

test('selects independently decodable animated AVIF key samples', async ({ page }) => {
  await harness(page)
  const result = await page.evaluate(() => window.pureJsImageBrowserTests.avifAnimationKeySamples())
  expect(result.outputBytes).toBeGreaterThan(500)
  expect(result.detail).toContain('color/alpha key samples')
  expect(result.detail).toContain('dependent frame remained unsupported')
})
test('converts linear BT.2020 AVIF pixels to sRGB', async ({ page }) => {
  await harness(page)
  const result = await page.evaluate(() => window.pureJsImageBrowserTests.avifRec2020())
  expect(result.outputBytes).toBeGreaterThan(100)
  expect(result.detail).toContain('pinned portable RGBA output')
})

test('applies an AVIF HDR gain map for SDR output', async ({ page }) => {
  await harness(page)
  const result = await page.evaluate(() => window.pureJsImageBrowserTests.avifHdrGainMap())
  expect(result.outputBytes).toBeGreaterThan(100)
  expect(result.detail).toContain('pinned portable RGBA output')
})

test('applies an AVIF RGB ICC profile', async ({ page }) => {
  await harness(page)
  const result = await page.evaluate(() => window.pureJsImageBrowserTests.avifIcc())
  expect(result.outputBytes).toBeGreaterThan(100)
  expect(result.detail).toContain('pinned portable RGBA output')
  expect(result.detail).toContain('EXIF and ICC preserved through browser re-encode')
})

test('decodes coded-lossless 10-bit AVIF tiles', async ({ page }) => {
  await harness(page)
  const result = await page.evaluate(() => window.pureJsImageBrowserTests.avifHighBitTiles())
  expect(result.outputBytes).toBeGreaterThan(100)
  expect(result.detail).toContain('pinned portable RGBA output')
})

test('decodes lossy AVIF tile and tile-group layouts', async ({ page }) => {
  test.setTimeout(60_000)
  await harness(page)
  const result = await page.evaluate(() => window.pureJsImageBrowserTests.avifLossyMultitile())
  expect(result.outputBytes).toBeGreaterThan(100)
  expect(result.detail).toContain('pinned portable RGBA output')
  expect(result.detail).toContain('four tile-group OBUs')
  expect(result.detail).toContain('8x2-tile 4K AVIF')
})
test('applies resampled single and grid AVIF gain maps', async ({ page }) => {
  test.setTimeout(60_000)
  await harness(page)
  const result = await page.evaluate(() => window.pureJsImageBrowserTests.avifGainMapGrid())
  expect(result.outputBytes).toBeGreaterThan(1_000)
  expect(result.detail).toContain('Independently tiled and resampled AVIF gain-map grid')
  expect(result.detail).toContain('pinned portable RGBA output')
})
test('composes AVIF imir transforms with crop, rotation, grids, and alpha', async ({
  browserName,
  page,
}) => {
  await harness(page)
  const result = await page.evaluate(() => window.pureJsImageBrowserTests.avifImir())
  expect(result.outputBytes).toBeGreaterThan(1_000)
  expect(result.detail).toContain('clap+irot grid alpha composition')
  if (browserName === 'chromium') expect(result.detail).toContain('Chromium native outputs')
})
test('synthesizes AV1 film grain', async ({ page }) => {
  await harness(page)
  const result = await page.evaluate(() => window.pureJsImageBrowserTests.avifFilmGrain())
  expect(result.outputBytes).toBeGreaterThan(100)
  expect(result.detail).toContain('Normative AV1 film-grain synthesis')
  expect(result.detail).toContain('pinned portable RGBA output')
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
test('decodes a selected AVIF base layer below the sequence maximum dimensions', async ({
  page,
}) => {
  await harness(page)
  const result = await page.evaluate(() => window.pureJsImageBrowserTests.avifSelectedBaseLayer())
  expect(result.outputBytes).toBeGreaterThan(100)
  expect(result.detail).toContain('304x208 AVIF base layer')
  expect(result.detail).toContain('pinned portable RGBA output')
})

test('decodes common-photo AV1 coefficient and palette contexts', async ({ page }) => {
  await harness(page)
  const result = await page.evaluate(() => window.pureJsImageBrowserTests.avifCommonPhotoSyntax())
  expect(result.outputBytes).toBeGreaterThan(300)
  expect(result.detail).toContain('pinned portable RGBA output')
})
test('decodes still-picture intra-block-copy AVIF state', async ({ page }) => {
  await harness(page)
  const result = await page.evaluate(() => window.pureJsImageBrowserTests.avifStillPictureEntropy())
  expect(result.outputBytes).toBeGreaterThan(100)
  expect(result.detail).toContain('pinned portable RGBA output')
})

test('decodes skipped intra transform selection from SVT-AV1', async ({ page }) => {
  await harness(page)
  const result = await page.evaluate(() => window.pureJsImageBrowserTests.avifSvtSkippedTransform())
  expect(result.outputBytes).toBeGreaterThan(1_000)
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

test('applies integer and half-integer-origin AVIF clean apertures', async ({ page }) => {
  await harness(page)
  const result = await page.evaluate(() => window.pureJsImageBrowserTests.avifCleanAperture())
  expect(result.outputBytes).toBeGreaterThan(50)
  expect(result.detail).toContain('Integer-origin clean-aperture')
  expect(result.detail).toContain('Half-integer-origin clean-aperture')
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

test('cancels an in-flight HTTP range read', async ({ page }) => {
  await harness(page)
  const result = await page.evaluate(() => window.pureJsImageBrowserTests.httpRangeCancellation())
  expect(result.detail).toContain('cancelled an in-flight browser HTTP range read')
})

test('aborts failed output and permits a clean subsequent operation', async ({ page }) => {
  await harness(page)
  const result = await page.evaluate(() => window.pureJsImageBrowserTests.failureCleanup())
  expect(result.detail).toContain('aborted their sinks')
})
