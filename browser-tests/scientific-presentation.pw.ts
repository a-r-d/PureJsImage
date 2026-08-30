import { expect, type Page, test } from '@playwright/test'

const overflowViewports = [390, 768, 1024, 1280, 1440] as const

const noHorizontalOverflow = async (page: Page) => {
  const { clientWidth, scrollWidth } = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1)
}

const boxInsideViewport = async (page: Page, selector: string, width: number) => {
  const box = await page.locator(selector).first().boundingBox()
  expect(box, selector).not.toBeNull()
  if (!box) return
  expect(box.x, selector).toBeGreaterThanOrEqual(-1)
  expect(box.x + box.width, selector).toBeLessThanOrEqual(width + 1)
}

test('keeps the scientific explorer screenshot and mode tabs inside the page', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 })
  await page.goto('/scientific/')

  const figure = page.locator('.scientific-explain-figure')
  await expect(figure.getByRole('img')).toBeVisible()
  await expect(figure.locator('figcaption')).toContainText('uint16')
  await boxInsideViewport(page, '.scientific-explain-figure', 1440)
  await boxInsideViewport(page, '.scientific-explain-figure img', 1440)

  const imageWidth = await figure
    .locator('img')
    .evaluate((node) => node.getBoundingClientRect().width)
  const figureWidth = await figure.evaluate((node) => node.getBoundingClientRect().width)
  expect(imageWidth).toBeLessThanOrEqual(figureWidth + 1)
  expect(imageWidth).toBeGreaterThan(figureWidth * 0.8)

  const tabs = page.getByRole('tablist', { name: 'Scientific raster mode' })
  await expect(tabs.getByRole('tab')).toHaveText([
    'All package readers',
    'AFM / surface',
    'ENVI raster',
    'FITS image arrays',
    'MRC volumes',
    'CBF detector',
  ])
  await boxInsideViewport(page, '.scientific-mode-tabs', 1440)

  await tabs.getByRole('tab', { name: 'ENVI raster' }).press('Enter')
  await expect(tabs.getByRole('tab', { name: 'ENVI raster' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(page.locator('#scientific-envi-source')).toBeVisible()

  await noHorizontalOverflow(page)
})

test('replaces the scientific format tables with indexable cards', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1100 })
  await page.goto('/scientific-formats/')

  await expect(page.locator('table')).toHaveCount(0)
  const readerCount = Number(
    await page.locator('main').getAttribute('data-scientific-reader-count'),
  )
  expect(Number.isInteger(readerCount) && readerCount > 0).toBe(true)
  await expect(page.getByRole('article')).toHaveCount(readerCount)

  const familyNav = page.getByRole('navigation', { name: 'Format index' })
  const families = [
    ['Common raster and whole-slide', 'common-raster-whole-slide'],
    ['Electron microscopy', 'electron-microscopy'],
    ['AFM, SPM, and surface metrology', 'afm-spm-surface-metrology'],
    ['Medical and volume interchange', 'medical-volume-interchange'],
    ['Spectroscopy and detector interchange', 'spectroscopy-detector-interchange'],
    ['Raw numeric interchange', 'raw-numeric-interchange'],
  ] as const
  for (const [label, id] of families) {
    await expect(familyNav.getByRole('link', { name: label })).toHaveAttribute('href', `#${id}`)
    await expect(page.locator(`#${id}`)).toBeVisible()
  }

  await expect(familyNav.getByRole('link', { name: 'Gwyddion Simple Field' })).toHaveAttribute(
    'href',
    '#purejsimage-gsf',
  )
  const card = page.getByRole('article').filter({ hasText: 'Gwyddion Simple Field' })
  await expect(card.locator('h3')).toHaveText('Gwyddion Simple Field')
  await expect(card.locator('code').first()).toHaveText('purejsimage/gsf')
  await expect(card).toContainText('purejsimage/scientific/readers/gsf')
  await expect(card).toContainText('One scalar 2D field')
  await expect(card).toContainText('Native numeric samples')
  await expect(card.getByText('Range reads: Yes')).toBeVisible()
  await expect(card.locator('details')).toContainText('One scalar 2D field')
  await expect(card.locator('details summary')).toBeVisible()
  await card.locator('details summary').click()
  await expect(card.locator('details')).toHaveAttribute('open', '')
  await expect(card).toContainText('finite float64 values')

  const columns = await page
    .locator('.scientific-format-grid')
    .first()
    .evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(' ').length)
  expect(columns).toBe(2)
  await noHorizontalOverflow(page)
})

test('keeps format cards readable at phone width without a ten-column table', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/scientific-formats/')

  await expect(page.locator('table')).toHaveCount(0)
  const columns = await page
    .locator('.scientific-format-grid')
    .first()
    .evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(' ').length)
  expect(columns).toBe(1)

  const card = page.getByRole('article').first()
  await expect(card).toBeVisible()
  await boxInsideViewport(page, '.scientific-format-card', 390)
  const importCode = card.locator('dd code')
  await expect(importCode).toBeVisible()
  const wraps = await importCode.evaluate((node) => {
    const styles = getComputedStyle(node)
    return {
      overflowWrap: styles.overflowWrap,
      width: node.getBoundingClientRect().width,
    }
  })
  expect(wraps.overflowWrap === 'anywhere' || wraps.overflowWrap === 'break-word').toBe(true)
  expect(wraps.width).toBeLessThan(360)
  await noHorizontalOverflow(page)
})

for (const width of overflowViewports) {
  test(`keeps /scientific/ inside ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1100 })
    await page.goto('/scientific/')
    await boxInsideViewport(page, '.scientific-mode-tabs', width)
    await boxInsideViewport(page, '.scientific-explain-figure img', width)
    await noHorizontalOverflow(page)
  })

  test(`keeps /scientific-formats/ inside ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1100 })
    await page.goto('/scientific-formats/')
    await expect(page.locator('table')).toHaveCount(0)
    await boxInsideViewport(page, '.scientific-format-card', width)
    await noHorizontalOverflow(page)
  })
}
