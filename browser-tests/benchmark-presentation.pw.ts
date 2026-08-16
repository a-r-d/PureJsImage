import { expect, type Page, test } from '@playwright/test'

const overflowViewports = [390, 768, 1024, 1280, 1440] as const

const noHorizontalOverflow = async (page: Page) => {
  const { clientWidth, scrollWidth } = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1)
}

const boxInside = async (inner: string, outer: string, page: Page) => {
  const boxes = await page.evaluate(
    ({ innerSelector, outerSelector }) => {
      const card = document.querySelector(innerSelector)
      const container = document.querySelector(outerSelector)
      if (!(card instanceof HTMLElement) || !(container instanceof HTMLElement)) {
        throw new Error(`Missing ${innerSelector} or ${outerSelector}`)
      }
      return {
        card: card.getBoundingClientRect().toJSON(),
        container: container.getBoundingClientRect().toJSON(),
        viewport: window.innerWidth,
      }
    },
    { innerSelector: inner, outerSelector: outer },
  )
  expect(boxes.card.x).toBeGreaterThanOrEqual(-1)
  expect(boxes.card.x + boxes.card.width).toBeLessThanOrEqual(boxes.viewport + 1)
  expect(boxes.card.x).toBeGreaterThanOrEqual(boxes.container.x - 1)
  expect(boxes.card.x + boxes.card.width).toBeLessThanOrEqual(
    boxes.container.x + boxes.container.width + 1,
  )
}

const assertGalleryReadable = async (page: Page, gallery: string) => {
  const card = page.locator(gallery)
  await expect(card).toBeVisible()
  const title = card.locator('.benchmark-chart-panel:visible h3')
  await expect(title).toBeVisible()
  await expect(title).not.toHaveCSS('overflow', 'hidden')
  await expect(
    card
      .locator('.benchmark-chart-panel:visible')
      .getByRole('link', { name: 'Open full-size chart' }),
  ).toBeVisible()
  const cardWiderThanPage = await card.evaluate(
    (node) => node.getBoundingClientRect().width > document.documentElement.clientWidth + 1,
  )
  expect(cardWiderThanPage).toBe(false)
}

test('presents full-width web codec and scientific galleries without page overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1100 })
  await page.goto('/performance/')

  await expect(page.locator('#common-web-codecs')).toBeVisible()
  await expect(page.locator('#web-codec-benchmarks')).toBeVisible()
  await expect(page.locator('#common-web-codecs .section-label')).toHaveText('Web codec benchmarks')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Web codec and scientific reader benchmarks.',
  )
  await expect(page.locator('#common-web-codecs .benchmark-scope')).toContainText('AVIF')
  await expect(page.locator('#common-web-codecs')).toContainText(
    'does not represent every stable PureJsImage codec',
  )
  await expect(page.getByRole('link', { name: 'Current web codec benchmark report' })).toBeVisible()

  await expect(page.locator('#common-web-codecs .codec-grid')).toHaveCount(0)
  await expect(page.locator('#scientific-readers .codec-grid')).toHaveCount(0)
  await expect(page.locator('[data-benchmark-gallery="web-codec"]')).toBeVisible()
  await expect(page.locator('[data-benchmark-gallery="scientific-reader"]')).toBeVisible()

  await expect(
    page.locator('[data-benchmark-gallery="web-codec"] [data-chart="speed"]'),
  ).toBeVisible()
  await page
    .locator('[data-benchmark-gallery="web-codec"] label', { hasText: 'Peak memory' })
    .click()
  await expect(
    page.locator('[data-benchmark-gallery="web-codec"] [data-chart="memory"]'),
  ).toBeVisible()
  await expect(
    page.locator('[data-benchmark-gallery="web-codec"] [data-chart="speed"]'),
  ).toBeHidden()

  await expect(
    page.locator('[data-benchmark-gallery="scientific-reader"] [data-chart="first-block"]'),
  ).toBeVisible()
  await page
    .locator('[data-benchmark-gallery="scientific-reader"] label', { hasText: 'Source I/O' })
    .click()
  await expect(
    page.locator('[data-benchmark-gallery="scientific-reader"] [data-chart="source-io"]'),
  ).toBeVisible()

  const webBackground = await page
    .locator('#common-web-codecs')
    .evaluate((node) => getComputedStyle(node).backgroundColor)
  const scientificBackground = await page
    .locator('#scientific-readers')
    .evaluate((node) => getComputedStyle(node).backgroundColor)
  expect(webBackground).not.toBe(scientificBackground)

  const factColumns = await page
    .locator('#common-web-codecs .benchmark-facts')
    .evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(' ').length)
  expect(factColumns).toBe(4)

  await assertGalleryReadable(page, '[data-benchmark-gallery="web-codec"]')
  await assertGalleryReadable(page, '[data-benchmark-gallery="scientific-reader"]')
  await boxInside('[data-benchmark-gallery="web-codec"]', '#common-web-codecs .container', page)
  await boxInside(
    '[data-benchmark-gallery="scientific-reader"]',
    '#scientific-readers .container',
    page,
  )
  await noHorizontalOverflow(page)
})

test('uses the shared gallery contract on the homepage', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/homepage.html')

  await expect(page.locator('#benchmark .section-label')).toHaveText('Web codec benchmarks')
  await expect(page.locator('[data-benchmark-gallery="home-web-codec"]')).toBeVisible()
  await expect(page.locator('#benchmark .benchmark-scope')).toContainText('JPEG')
  await expect(page.locator('#benchmark .benchmark-scope')).toContainText('AVIF')
  await expect(
    page.locator('[data-benchmark-gallery="home-web-codec"] h3', { hasText: 'Web codec speed' }),
  ).toBeVisible()
  await page
    .locator('[data-benchmark-gallery="home-web-codec"] label', { hasText: 'Quality' })
    .click()
  await expect(
    page.locator('[data-benchmark-gallery="home-web-codec"] [data-chart="quality"]'),
  ).toBeVisible()
  await expect(page.getByRole('link', { name: 'Open full-size chart' }).first()).toBeVisible()
})

test('shows a chart scroll cue only when the viewport overflows', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/performance/')
  const image = page.locator(
    '[data-benchmark-gallery="web-codec"] [data-chart="speed"] [data-chart-viewport] img',
  )
  await expect(image).toBeVisible()
  await image.evaluate((node) => {
    if (!(node instanceof HTMLImageElement)) throw new Error('Chart image is missing')
    if (node.complete) return
    return new Promise<void>((resolve, reject) => {
      node.addEventListener('load', () => resolve(), { once: true })
      node.addEventListener('error', () => reject(new Error('Chart image failed')), { once: true })
    })
  })

  const cue = page.locator(
    '[data-benchmark-gallery="web-codec"] [data-chart="speed"] [data-chart-scroll-cue]',
  )
  await expect(cue).toBeVisible()
  await expect(cue).toHaveText('Scroll chart horizontally')

  await page.setViewportSize({ width: 1440, height: 900 })
  await expect(cue).toBeHidden()
})

for (const width of overflowViewports) {
  test(`keeps the performance page inside ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1100 })
    await page.goto('/performance/')
    await noHorizontalOverflow(page)
    await boxInside('[data-benchmark-gallery="web-codec"]', '#common-web-codecs .container', page)
    await boxInside(
      '[data-benchmark-gallery="scientific-reader"]',
      '#scientific-readers .container',
      page,
    )
    await assertGalleryReadable(page, '[data-benchmark-gallery="web-codec"]')
    await assertGalleryReadable(page, '[data-benchmark-gallery="scientific-reader"]')
  })
}
