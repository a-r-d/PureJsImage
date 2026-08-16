import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { nodeRuntime } from '../src/node-runtime.ts'
import type { PixelBlock } from '../src/pixel.ts'
import { Uint8ArraySink } from '../src/sink.ts'
import { encodeTiffDocument, type TiffPageEncodeRequest } from '../src/tiff/index.ts'

const playbackTiff = async (): Promise<Buffer> => {
  const blocks = (width: number, height: number, data: Uint8Array): AsyncIterable<PixelBlock> => ({
    async *[Symbol.asyncIterator]() {
      yield { x: 0, y: 0, width, height, stride: width * 3, format: 'rgb8', data }
    },
  })
  const width = 512
  const height = 512
  const pages: TiffPageEncodeRequest[] = Array.from({ length: 4 }, (_, frame) => {
    const pixels = new Uint8Array(width * height * 3)
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      const offset = pixel * 3
      pixels[offset] = frame * 70
      pixels[offset + 1] = (pixel + frame * 40) & 0xff
      pixels[offset + 2] = 255 - frame * 60
    }
    return { width, height, pixelFormat: 'rgb8', blocks: blocks(width, height, pixels) }
  })
  const sink = new Uint8ArraySink()
  await encodeTiffDocument(sink, {
    runtime: nodeRuntime,
    options: { format: 'classic', rowsPerStrip: height },
    pages,
  })
  return Buffer.from(sink.toUint8Array())
}

test('leads the homepage with portable codecs, memory comparison, and open-source status', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/homepage.html')

  await expect(page.locator('.home-hero .eyebrow')).toHaveText(
    'Free and open source · zero runtime dependencies',
  )
  await expect(page.locator('.home-hero h1')).toContainText(
    'Image codecs and low-memory raster processing in strict TypeScript.',
  )
  await expect(page.locator('.home-hero .hero-lede')).toContainText(
    'native scientific raster processing',
  )
  await expect(page.locator('.headline-metrics')).toContainText('84.2%')
  await expect(page.locator('.headline-metrics')).toContainText('187.8 MiB vs 1188.4 MiB')
  await expect(page.locator('.headline-metrics')).toContainText('43')
  await expect(page.locator('.headline-metrics')).toContainText('validated reader workflows')
  await expect(page.locator('.headline-metrics')).toContainText(
    'representative performance workloads',
  )
  await expect(page.locator('main')).not.toContainText(/evidence/iu)
  await expect(page.locator('.metric-info')).toHaveCount(4)
  await expect(page.locator('.metric-info').nth(2)).toHaveAccessibleName(
    'About the current Jimp memory comparison',
  )
  await page.locator('.metric-info').nth(2).focus()
  await expect(page.locator('#metric-jimp-tooltip')).toContainText(
    '24-megapixel northstar photo pipeline',
  )
  await expect(page.locator('#metric-jimp-tooltip')).toHaveCSS('opacity', '1')
  const infoButtonBoxes = await page.locator('.metric-info').evaluateAll((buttons) =>
    buttons.map((button) => {
      const bounds = button.getBoundingClientRect()
      return { width: bounds.width, height: bounds.height }
    }),
  )
  expect(infoButtonBoxes).toEqual([
    { width: 22, height: 22 },
    { width: 22, height: 22 },
    { width: 22, height: 22 },
    { width: 22, height: 22 },
  ])
  await expect(page.locator('.home-wsi-showcase')).toContainText('One scientific application')
  await expect(page.locator('.home-wsi-image img')).toHaveAttribute(
    'src',
    'assets/whole-slide-viewer-showcase.jpg',
  )

  await page.setViewportSize({ width: 390, height: 844 })
  const metricBoxes = await page.locator('.headline-metrics > div').evaluateAll((metrics) =>
    metrics.map((metric) => {
      const bounds = metric.getBoundingClientRect()
      return { top: bounds.top, bottom: bounds.bottom }
    }),
  )
  expect(metricBoxes).toHaveLength(4)
  for (let index = 1; index < metricBoxes.length; index += 1) {
    expect(metricBoxes[index]?.top ?? 0).toBeGreaterThanOrEqual(metricBoxes[index - 1]?.bottom ?? 0)
  }
})

test('aligns the performance section heading with its methodology copy', async ({ page }) => {
  await page.goto('/performance/')

  const alignment = await page
    .locator('.performance-showcase .proof-heading')
    .evaluate((heading) => {
      const title = heading.querySelector('h2')
      const copy = heading.querySelector(':scope > p')
      if (!(title instanceof HTMLElement) || !(copy instanceof HTMLElement)) {
        throw new Error('Performance proof heading is incomplete')
      }
      return Math.abs(title.getBoundingClientRect().top - copy.getBoundingClientRect().top)
    })

  expect(alignment).toBeLessThan(80)
})

test('detects, transforms, converts, measures, and downloads from the docs demo', async ({
  page,
}) => {
  const requestedUrls: string[] = []
  page.on('request', (request) => requestedUrls.push(request.url()))
  await page.goto('/demo/')
  await page.waitForFunction(() => window.pureJsImageDemoReady === true)
  await page.locator('#demo-mode-convert').click()
  await expect(page.locator('#demo-mode-convert')).toHaveAttribute('aria-selected', 'true')

  const input = await readFile('benchmark/.tmp/browser-tests/fixtures/benchmark-input.png')
  await page.locator('#demo-file').setInputFiles({
    buffer: input,
    mimeType: 'image/jpeg',
    name: 'misleading-extension.jpg',
  })

  await expect(page.locator('#demo-source-details')).toContainText('640 × 480')
  await expect(page.locator('#demo-source-badges')).toContainText('PNG')
  await expect(page.locator('#demo-controls')).toBeEnabled()
  await expect(page.locator('#demo-mode-convert')).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('#demo-view-panel')).toBeHidden()

  await page.locator('#demo-output-format').selectOption('jpeg')
  await page.locator('#demo-resize-enabled').check()
  await page.locator('#demo-resize-width').fill('120')
  await page.locator('#demo-rotation').selectOption('90')
  await page.locator('#demo-convert').click()

  await expect(page.locator('#demo-result')).toBeVisible()
  await expect(page.locator('#demo-result-summary')).toContainText('JPEG · 90 × 120')
  await expect(page.locator('#demo-download')).toHaveAttribute(
    'download',
    'misleading-extension-converted.jpg',
  )
  await expect(page.locator('#demo-metric-elapsed')).not.toHaveText('Not available')
  await expect(page.locator('#demo-metric-output')).not.toHaveText('Not available')
  await expect(page.locator('#demo-log-list')).toContainText('PNG detected from content')
  await expect(page.locator('#demo-log-list')).toContainText('Conversion time:')
  await expect(page.locator('#demo-log-list')).toContainText('Maximum observed JS heap:')
  await expect(page.locator('#demo-log-list')).toContainText('Known input + output file bytes:')

  const networkRequests = requestedUrls.filter((url) => /^https?:/.test(url))
  expect(networkRequests.length).toBeGreaterThan(0)
  expect(
    networkRequests.every((url) => url.startsWith('http://127.0.0.1:')),
    `Unexpected external request: ${networkRequests.find((url) => !url.startsWith('http://127.0.0.1:')) ?? 'unknown'}`,
  ).toBe(true)
})

test('views, pans, zooms, and clips a TIFF without leaving the browser', async ({ page }) => {
  const requestedUrls: string[] = []
  page.on('request', (request) => requestedUrls.push(request.url()))
  await page.goto('/demo/')
  await page.waitForFunction(() => window.pureJsImageDemoReady === true)
  await page.locator('#demo-mode-convert').click()

  const input = await readFile('benchmark/corpus/files/libtiff-rgb-3c-8b.tiff')
  await page.locator('#demo-file').setInputFiles({
    buffer: input,
    mimeType: 'image/tiff',
    name: 'bounded-view.tiff',
  })

  await expect(page.locator('#demo-mode-convert')).toHaveAttribute('aria-selected', 'true')
  await page.locator('#demo-mode-view').click()
  await expect(page.locator('#demo-mode-view')).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('#demo-viewer')).toBeVisible()
  await expect(page.locator('#demo-viewer-dimensions')).toHaveText('157 × 151')
  await expect(page.locator('#demo-viewer-directory')).toHaveValue('0')
  await expect(page.locator('#demo-viewer-canvas')).toHaveAttribute('data-rendered', 'true')
  await expect(page.locator('#demo-viewer-empty')).toBeHidden()
  await expect(page.locator('#demo-log-list')).toContainText(
    'TIFF document opened for bounded client-side viewport decoding',
  )

  const initialZoom = await page.locator('#demo-zoom-value').textContent()
  await page.locator('#demo-zoom-in').click()
  await expect(page.locator('#demo-zoom-value')).not.toHaveText(initialZoom ?? '')

  await expect(page.locator('#demo-viewer-region')).not.toHaveText('0, 0 · 157 × 151 px')
  await expect(page.locator('#demo-viewer-loading')).toBeHidden()
  const initialRegion = await page.locator('#demo-viewer-region').textContent()
  await page.locator('#demo-pan-down').click()
  await expect(page.locator('#demo-viewer-region')).not.toHaveText(initialRegion ?? '')

  const downloadPromise = page.waitForEvent('download')
  await page.locator('#demo-save-clip').click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/^bounded-view-\d+-\d+-\d+x\d+\.png$/)
  await expect(page.locator('#demo-viewer-status')).toContainText('Saved ')
  await expect(page.locator('#demo-log-list')).toContainText('PNG clip encoded and downloaded')

  await page.locator('#demo-mode-convert').click()
  await expect(page.locator('#demo-mode-convert')).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('#demo-convert-panel')).toBeVisible()
  await page.locator('#demo-output-format').selectOption('png')
  await page.locator('#demo-convert').click()
  await expect(page.locator('#demo-result-summary')).toContainText('PNG · 157 × 151')

  const networkRequests = requestedUrls.filter((url) => /^https?:/.test(url))
  expect(
    networkRequests.every((url) => url.startsWith('http://127.0.0.1:')),
    `Unexpected external request: ${networkRequests.find((url) => !url.startsWith('http://127.0.0.1:')) ?? 'unknown'}`,
  ).toBe(true)
})

test('plays and manually navigates a multi-image TIFF time series', async ({ page }) => {
  await page.goto('/demo/')
  await page.waitForFunction(() => window.pureJsImageDemoReady === true)
  const input = await playbackTiff()
  await page.locator('#demo-file').setInputFiles({
    buffer: input,
    mimeType: 'image/tiff',
    name: 'four-frame-time-series.tiff',
  })

  await expect(page.locator('#demo-source-details')).toContainText('4 viewable images')
  await expect(page.locator('#demo-viewer-directory')).toHaveValue('0')
  await expect(page.locator('#demo-viewer-previous')).toBeDisabled()
  await expect(page.locator('#demo-viewer-play')).toBeEnabled()
  await expect(page.locator('#demo-viewer-next')).toBeEnabled()

  const transition = await page.evaluate(async () => {
    const canvas = document.querySelector<HTMLCanvasElement>('#demo-viewer-canvas')
    const next = document.querySelector<HTMLButtonElement>('#demo-viewer-next')
    const directory = document.querySelector<HTMLSelectElement>('#demo-viewer-directory')
    const status = document.querySelector<HTMLElement>('#demo-viewer-status')
    const context = canvas?.getContext('2d')
    if (!canvas || !next || !directory || !status || !context) {
      throw new Error('Viewer controls are missing')
    }
    const pixel = (): readonly number[] =>
      Array.from(context.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data)
    const before = pixel()
    const samples: (readonly number[])[] = [before]
    let sampling = true
    const sampleFrame = (): void => {
      samples.push(pixel())
      if (sampling) requestAnimationFrame(sampleFrame)
    }
    requestAnimationFrame(sampleFrame)
    next.click()
    while (
      directory.value !== '1' ||
      JSON.stringify(pixel()) === JSON.stringify(before) ||
      !status.textContent?.includes('rendered in')
    ) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 5))
    }
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    sampling = false
    return { before, after: pixel(), samples }
  })
  expect(transition.after).not.toEqual(transition.before)
  expect(
    transition.samples.every(
      (sample) =>
        JSON.stringify(sample) === JSON.stringify(transition.before) ||
        JSON.stringify(sample) === JSON.stringify(transition.after),
    ),
    `Viewer exposed a partial or blank frame: ${JSON.stringify(transition.samples)}`,
  ).toBe(true)
  await expect(page.locator('#demo-viewer-directory')).toHaveValue('1')
  await expect(page.locator('#demo-viewer-status')).toContainText('rendered in')
  await page.locator('#demo-viewer-previous').click()
  await expect(page.locator('#demo-viewer-directory')).toHaveValue('0')

  await page.locator('#demo-viewer-play').click()
  await expect(page.locator('#demo-viewer-play')).toHaveText('Pause')
  await expect(page.locator('#demo-viewer-directory')).toHaveValue('1', { timeout: 3_000 })
  await page.locator('#demo-viewer-play').click()
  await expect(page.locator('#demo-viewer-play')).toHaveText('Play')
  const pausedImage = await page.locator('#demo-viewer-directory').inputValue()
  await page.waitForTimeout(1_000)
  await expect(page.locator('#demo-viewer-directory')).toHaveValue(pausedImage)

  await page.locator('#demo-viewer-directory').selectOption('2')
  await expect(page.locator('#demo-viewer-loading')).toBeHidden()
  await page.locator('#demo-viewer-play').click()
  await expect(page.locator('#demo-viewer-directory')).toHaveValue('3', { timeout: 3_000 })
  await expect(page.locator('#demo-viewer-play')).toHaveText('Play')
  await expect(page.locator('#demo-viewer-next')).toBeDisabled()
})

test('searches the expanded scientific sample library and keeps JPEG 2000 in the selected mode', async ({
  page,
}) => {
  await page.goto('/demo/')
  await page.waitForFunction(() => window.pureJsImageDemoReady === true)

  await expect(page.locator('[data-demo-sample-card]')).toHaveCount(26)
  await expect(page.locator('a[href*="bioformats-artificial"]')).toHaveCount(0)
  await page.locator('#demo-sample-search').fill('electron microscopy')
  await expect(page.locator('[data-demo-sample-card]:visible')).toHaveCount(6)
  await expect(
    page.locator('[data-demo-sample-card]:visible').filter({ hasText: 'Nickel dislocations' }),
  ).toContainText('Open here')

  await page.locator('#demo-sample-search').fill('C. elegans')
  const microscopy = page.locator('[data-demo-sample-card]:visible')
  await expect(microscopy).toHaveCount(2)
  await expect(microscopy.first()).toContainText('Actual biological sample')
  await expect(microscopy.first()).toContainText('20 timepoints')
  await expect(microscopy.first()).toContainText('multiphoton OME-TIFF')
  await expect(microscopy.first().locator('a').first()).toHaveAttribute(
    'href',
    'https://downloads.openmicroscopy.org/images/OME-TIFF/2016-06/tubhiswt-3D/tubhiswt_C0.ome.tif',
  )
  const input = await readFile('benchmark/corpus/files/jp2/loc-court-day-openjpeg-lossless.jp2')
  await page.locator('#demo-file').setInputFiles({
    buffer: input,
    mimeType: 'image/jp2',
    name: 'weird-lossless.jp2',
  })

  await expect(page.locator('#demo-mode-view')).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('#demo-convert-panel')).toBeHidden()
  await expect(page.locator('#demo-viewer-canvas')).toHaveAttribute('data-rendered', 'true')

  await page.locator('#demo-mode-convert').click()
  await expect(page.locator('#demo-mode-convert')).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('#demo-controls')).toBeEnabled()
  await page.locator('#demo-output-format').selectOption('png')
  await page.locator('#demo-resize-enabled').check()
  await page.locator('#demo-resize-width').fill('120')
  await page.locator('#demo-convert').click()
  await expect(page.locator('#demo-result-summary')).toContainText('PNG · 120 ×')
})

test('toggles JPEG WASM acceleration and compares the same complete pipeline', async ({ page }) => {
  const requestedUrls: string[] = []
  page.on('request', (request) => requestedUrls.push(request.url()))
  await page.goto('/demo/')
  await page.waitForFunction(() => window.pureJsImageDemoReady === true)
  await page.locator('#demo-mode-convert').click()

  const input = await readFile('benchmark/.tmp/browser-tests/fixtures/wasm-input.jpg')
  await page.locator('#demo-file').setInputFiles({
    buffer: input,
    mimeType: 'image/jpeg',
    name: 'wasm-input.jpg',
  })

  await expect(page.locator('#demo-source-badges')).toContainText('JPEG')
  await expect(page.locator('#demo-controls')).toBeEnabled()
  await page.locator('#demo-output-format').selectOption('bmp')
  await expect(page.locator('#demo-convert-label')).toHaveText('Convert with TypeScript')
  await page.locator('#demo-convert').click()

  await expect(page.locator('#demo-result')).toBeVisible()
  await expect(page.locator('#demo-metric-provider')).toHaveText('TypeScript')
  await expect(page.locator('#demo-metric-comparison')).toHaveText('Run WASM to compare')

  await page.locator('#demo-wasm-enabled').check()
  await expect(page.locator('#demo-accelerator-status')).toContainText(
    'Eligible full-image baseline YCbCr JPEGs use it',
  )
  await expect(page.locator('#demo-convert-label')).toHaveText('Convert with WASM enabled')
  await page.locator('#demo-convert').click()

  await expect(page.locator('#demo-result')).toBeVisible()
  await expect(page.locator('#demo-metric-provider')).toHaveText('WASM enabled')
  await expect(page.locator('#demo-metric-comparison')).toHaveText(/% (?:faster|slower)/)
  await expect(page.locator('#demo-log-list')).toContainText(
    'Rust/WASM JPEG acceleration enabled for this run',
  )
  expect(requestedUrls.some((url) => url.endsWith('/assets/jpeg-decoder-simd.wasm'))).toBe(true)
})

test('views an animated input and explicitly converts its first frame', async ({ page }) => {
  await page.goto('/demo/')
  await page.waitForFunction(() => window.pureJsImageDemoReady === true)
  await page.locator('#demo-mode-convert').click()
  const input = await readFile('benchmark/.tmp/browser-tests/fixtures/animated.gif')
  await page.locator('#demo-file').setInputFiles({
    buffer: input,
    mimeType: 'image/gif',
    name: 'animated.gif',
  })

  await expect(page.locator('#demo-source-badges')).toContainText('2 frames')
  await expect(page.locator('#demo-mode-convert')).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('#demo-controls')).toBeEnabled()
  await expect(page.locator('#demo-operation-status')).toContainText(
    'Conversion uses the first image or frame',
  )
  await page.locator('#demo-output-format').selectOption('png')
  await page.locator('#demo-convert').click()
  await expect(page.locator('#demo-result')).toBeVisible()
  await expect(page.locator('#demo-log-list')).toContainText(
    'Conversion uses the first image or frame',
  )
})

test('converts the supported primary image from an MPF JPEG', async ({ page }) => {
  await page.goto('/demo/')
  await page.waitForFunction(() => window.pureJsImageDemoReady === true)
  await page.locator('#demo-mode-convert').click()
  const input = await readFile('benchmark/.tmp/browser-tests/fixtures/mpf-primary.jpg')
  await page.locator('#demo-file').setInputFiles({
    buffer: input,
    mimeType: 'image/jpeg',
    name: 'iphone-mpf.jpg',
  })

  await expect(page.locator('#demo-source-badges')).toContainText('2 images')
  await expect(page.locator('#demo-controls')).toBeEnabled()
  await expect(page.locator('#demo-operation-status')).toContainText(
    'conversion uses its supported primary image',
  )
  await expect(page.locator('#demo-log-list')).toContainText(
    'auxiliary images and gain maps are not preserved',
  )

  await page.locator('#demo-output-format').selectOption('bmp')
  await page.locator('#demo-resize-enabled').check()
  await page.locator('#demo-resize-width').fill('200')
  await page.locator('#demo-convert').click()

  await expect(page.locator('#demo-result')).toBeVisible()
  await expect(page.locator('#demo-result-summary')).toContainText('BMP · 200 × 150')
  await expect(page.locator('#demo-log-list')).toContainText('BMP output validated as 200×150')
})

test('decodes QOI and converts it to TGA in the browser demo', async ({ page }) => {
  await page.goto('/demo/')
  await page.waitForFunction(() => window.pureJsImageDemoReady === true)
  await page.locator('#demo-mode-convert').click()
  const input = await readFile('tests/fixtures/small-codecs/city-16x16-reference.qoi')
  await page.locator('#demo-file').setInputFiles({
    buffer: input,
    mimeType: 'image/qoi',
    name: 'city.qoi',
  })

  await expect(page.locator('#demo-source-badges')).toContainText('QOI')
  await page.locator('#demo-output-format').selectOption('tga')
  await page.locator('#demo-convert').click()

  await expect(page.locator('#demo-result')).toBeVisible()
  await expect(page.locator('#demo-result-summary')).toContainText('TGA · 16 × 16')
  await expect(page.locator('#demo-log-list')).toContainText('TGA output validated as 16×16')
  await expect(page.locator('#demo-log-list')).not.toContainText('ERROR')
})

test('converts a progressive JPEG with AC-refinement ZRLs to WebP', async ({ page }) => {
  await page.goto('/demo/')
  await page.waitForFunction(() => window.pureJsImageDemoReady === true)
  await page.locator('#demo-mode-convert').click()
  const input = await readFile(
    'benchmark/corpus/files/jpeg-reference/generated-progressive-zrl.jpg',
  )
  await page.locator('#demo-file').setInputFiles({
    buffer: input,
    mimeType: 'image/jpeg',
    name: 'progressive-zrl.jpg',
  })

  await expect(page.locator('#demo-source-badges')).toContainText('JPEG')
  await page.locator('#demo-output-format').selectOption('webp')
  await page.locator('#demo-webp-lossless').check()
  await page.locator('#demo-resize-enabled').check()
  await page.locator('#demo-resize-width').fill('200')
  await page.locator('#demo-convert').click()

  await expect(page.locator('#demo-result')).toBeVisible()
  await expect(page.locator('#demo-result-summary')).toContainText('WebP · 200 × 133')
  await expect(page.locator('#demo-log-list')).toContainText('lossless WebP')
  await expect(page.locator('#demo-log-list')).toContainText('WebP output validated as 200×133')
  await expect(page.locator('#demo-log-list')).not.toContainText('ERROR')
})
