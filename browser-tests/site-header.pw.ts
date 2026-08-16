import { expect, type Page, test } from '@playwright/test'

const overflowViewports = [390, 768, 1024, 1280, 1440] as const
const desktopPrimaryLabels = ['Demos', 'Formats', 'Guides', 'API', 'Codecs', 'Benchmarks'] as const

const noHorizontalOverflow = async (page: Page) => {
  const { clientWidth, scrollWidth } = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1)
}

const boxInsideViewport = async (page: Page, selector: string, width: number) => {
  const box = await page.locator(selector).boundingBox()
  expect(box, selector).not.toBeNull()
  if (!box) return
  expect(box.x, selector).toBeGreaterThanOrEqual(-1)
  expect(box.x + box.width, selector).toBeLessThanOrEqual(width + 1)
}

test('keeps a one-line desktop header with the grouped navigation', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/guides/')

  await expect(page.locator('[data-menu-toggle]')).toBeHidden()
  await expect(page.locator('.header-actions .app-header')).toBeVisible()
  await expect(page.locator('.header-actions .app-header')).toHaveAttribute(
    'href',
    'https://lab.purejsimage.com/',
  )
  await expect(page.locator('.header-actions a', { hasText: 'GitHub' })).toHaveCount(0)
  await expect(page.locator('.nav-panel-extras')).toBeHidden()

  const nav = page.locator('[data-nav]')
  await expect(nav.getByRole('link', { name: 'Formats' })).toBeVisible()
  await expect(nav.getByRole('link', { name: 'Guides' })).toBeVisible()
  await expect(nav.getByRole('link', { name: 'API' })).toBeVisible()
  await expect(nav.getByRole('link', { name: 'Codecs' })).toBeVisible()
  await expect(nav.getByRole('link', { name: 'Benchmarks' })).toHaveAttribute(
    'href',
    /\/performance\/$/u,
  )
  await expect(nav.getByRole('link', { name: 'Contribute' })).toHaveCount(0)

  const labels = page.locator('.nav-summary, [data-nav] > a:not(.button)')
  await expect(labels).toHaveText([...desktopPrimaryLabels])
  const metrics = await labels.evaluateAll((nodes) =>
    nodes.map((node) => {
      const styles = getComputedStyle(node)
      return {
        height: node.getBoundingClientRect().height,
        whiteSpace: styles.whiteSpace,
      }
    }),
  )
  expect(metrics).toHaveLength(desktopPrimaryLabels.length)
  for (const metric of metrics) {
    expect(metric.whiteSpace).toBe('nowrap')
    expect(metric.height).toBeLessThan(40)
  }

  await expect(page.locator('.nav-submenu')).toBeHidden()
  await page.locator('.nav-summary').click()
  await expect(page.locator('.nav-disclosure')).toHaveAttribute('open', '')
  await expect(nav.getByRole('link', { name: 'Image converter' })).toBeVisible()
  await expect(nav.getByRole('link', { name: 'Whole-slide viewer' })).toBeVisible()
  await expect(nav.getByRole('link', { name: 'Scientific explorer' })).toBeVisible()

  await noHorizontalOverflow(page)
})

test('switches to compact navigation before the desktop row would be crushed', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 800 })
  await page.goto('/homepage.html')

  await expect(page.locator('[data-menu-toggle]')).toBeVisible()
  await expect(page.locator('.header-actions .app-header')).toBeHidden()
  await expect(page.locator('[data-nav]')).toBeHidden()
  await expect(page.locator('[data-nav] > a:not(.button)')).toHaveCount(5)

  await noHorizontalOverflow(page)
})

test('opens and closes the compact menu as a bounded panel', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/homepage.html')

  const toggle = page.locator('[data-menu-toggle]')
  const navigation = page.locator('[data-nav]')
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(page.locator('.header-actions .app-header')).toBeHidden()
  await expect(navigation).toBeHidden()

  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(toggle).toHaveAttribute('aria-label', 'Close navigation')
  await expect(navigation).toBeVisible()
  await expect(navigation.locator('.app-header-menu')).toBeVisible()
  await expect(navigation.getByRole('link', { name: 'GitHub' })).toBeVisible()
  await expect(navigation.getByRole('link', { name: 'Contribute' })).toBeVisible()

  const panel = await navigation.boundingBox()
  expect(panel).not.toBeNull()
  if (panel) {
    expect(panel.x).toBeGreaterThanOrEqual(0)
    expect(panel.x + panel.width).toBeLessThanOrEqual(391)
    expect(panel.y + panel.height).toBeLessThanOrEqual(845)
  }

  await navigation.locator('.nav-summary').focus()
  await page.keyboard.press('Tab')
  const outline = await page.evaluate(() => {
    const focused = document.activeElement
    if (!(focused instanceof HTMLElement)) return 'none'
    return getComputedStyle(focused).outlineStyle
  })
  expect(outline).not.toBe('none')

  await page.keyboard.press('Escape')
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(toggle).toBeFocused()
  await expect(navigation).toBeHidden()

  await toggle.click()
  const popupPromise = page.waitForEvent('popup')
  await navigation.locator('.app-header-menu').click()
  const popup = await popupPromise
  await popup.close()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(navigation).toBeHidden()
})

test('opens the Demos submenu with the keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/guides/')

  await page.locator('.nav-summary').focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('.nav-disclosure')).toHaveAttribute('open', '')
  await expect(page.getByRole('link', { name: 'Image converter' })).toBeVisible()

  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Image converter' })).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(page.locator('.nav-disclosure')).not.toHaveAttribute('open')
  await expect(page.locator('.nav-summary')).toBeFocused()
})

test('marks the current page and its containing group', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/guides/')
  const guides = page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', {
    name: 'Guides',
  })
  await expect(guides).toHaveAttribute('aria-current', 'page')
  const formats = page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', {
    name: 'Formats',
  })
  const inactiveColor = await formats.evaluate((node) => getComputedStyle(node).color)
  await expect(guides).not.toHaveCSS('color', inactiveColor)
  await expect(page.locator('.nav-summary')).not.toHaveAttribute('aria-current')

  await page.goto('/demo/')
  await expect(page.locator('.nav-summary')).toHaveAttribute('aria-current', 'true')
  await page.locator('.nav-summary').click()
  const converter = page.getByRole('link', { name: 'Image converter' })
  const explorer = page.getByRole('link', { name: 'Scientific explorer' })
  await expect(converter).toHaveAttribute('aria-current', 'page')
  await expect(converter).not.toHaveCSS(
    'color',
    await explorer.evaluate((node) => getComputedStyle(node).color),
  )

  await page.goto('/scientific-formats/')
  await expect(
    page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', {
      name: 'Formats',
    }),
  ).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('.nav-summary')).not.toHaveAttribute('aria-current')
})

test('keeps the 390px header inside the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/homepage.html')

  const brand = page.locator('.site-header .brand')
  await expect(brand).toBeVisible()
  await expect(brand).toContainText('PureJsImage')
  await expect(page.locator('.header-actions .app-header')).toBeHidden()
  await boxInsideViewport(page, '.site-header .brand', 390)
  await boxInsideViewport(page, '[data-theme-toggle]', 390)
  await boxInsideViewport(page, '[data-menu-toggle]', 390)
  await noHorizontalOverflow(page)
})

for (const width of overflowViewports) {
  test(`does not overflow horizontally at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/guides/')
    await noHorizontalOverflow(page)
  })
}
