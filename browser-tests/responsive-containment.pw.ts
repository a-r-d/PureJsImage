import { expect, type Page, test } from '@playwright/test'

const overflowViewports = [390, 768, 1024, 1280, 1440] as const
const permittedScrollRegions = ['chart', 'table', 'code', 'tabs', 'chips'] as const

const documentationRoutes = [
  '/homepage.html',
  '/demo/',
  '/wsi/',
  '/scientific/',
  '/scientific-formats/',
  '/guides/',
  '/api/',
  '/codecs/',
  '/tiff/',
  '/tiff-comparison/',
  '/performance/',
  '/contributing/',
] as const

const noHorizontalOverflow = async (page: Page) => {
  const { clientWidth, scrollWidth } = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1)
}

const waitForContainment = async (page: Page) => {
  await page.waitForFunction(() => document.readyState === 'complete')
  await page.evaluate(
    async () =>
      new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => resolve())
        })
      }),
  )
}

const assertPermittedInnerScrollOnly = async (page: Page) => {
  const result = await page.evaluate(
    (allowed) => {
      const clientWidth = document.documentElement.clientWidth
      const htmlOverflow = getComputedStyle(document.documentElement).overflowX
      const bodyOverflow = getComputedStyle(document.body).overflowX
      const regions = [...document.querySelectorAll<HTMLElement>('[data-scroll-region]')]
      const permittedKinds = new Set<string>(allowed)
      const unknownRegions = regions
        .map((region) => region.dataset.scrollRegion ?? '')
        .filter((kind) => !permittedKinds.has(kind))
      const escapedRegions = regions.flatMap((region) => {
        const box = region.getBoundingClientRect()
        if (box.width <= 0) return []
        if (box.left >= -1 && box.right <= clientWidth + 1) return []
        return [
          {
            kind: region.dataset.scrollRegion ?? '',
            className: region.className.toString().slice(0, 80),
            left: Math.round(box.left),
            right: Math.round(box.right),
          },
        ]
      })
      const offenders: {
        readonly tag: string
        readonly className: string
        readonly kind: string
        readonly overflowX: string
      }[] = []
      const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT)
      let node: Node | null = walk.currentNode
      while (node !== null) {
        if (node instanceof HTMLElement) {
          const box = node.getBoundingClientRect()
          if (box.width > 1 && box.right > clientWidth + 1) {
            const region = node.closest<HTMLElement>('[data-scroll-region]')
            const kind = region?.dataset.scrollRegion ?? ''
            const overflowX = region === null ? '' : getComputedStyle(region).overflowX
            const regionIsSelf = region === node
            const permitted =
              !regionIsSelf &&
              permittedKinds.has(kind) &&
              (overflowX === 'auto' || overflowX === 'scroll')
            if (!permitted) {
              offenders.push({
                tag: node.tagName.toLowerCase(),
                className: node.className.toString().slice(0, 80),
                kind,
                overflowX,
              })
            }
          }
        }
        node = walk.nextNode()
      }
      return { htmlOverflow, bodyOverflow, unknownRegions, escapedRegions, offenders }
    },
    [...permittedScrollRegions],
  )

  expect(result.htmlOverflow, 'html must not conceal overflow').not.toBe('hidden')
  expect(result.bodyOverflow, 'body must not conceal overflow').not.toBe('hidden')
  expect(result.unknownRegions, 'only enumerated scroll regions may exist').toEqual([])
  expect(result.escapedRegions, 'named scroll regions must stay inside the viewport').toEqual([])
  expect(result.offenders, 'unpermitted overflow').toEqual([])
}

for (const width of overflowViewports) {
  for (const route of documentationRoutes) {
    test(`contains ${route} at ${width}px with only named inner scrollers`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1100 })
      await page.goto(route)
      await waitForContainment(page)
      await noHorizontalOverflow(page)
      await assertPermittedInnerScrollOnly(page)
    })
  }
}

test('presents a compact homepage comparison summary and keeps the full matrix in HTML', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/homepage.html')
  await waitForContainment(page)

  const summary = page.locator('.comparison-mobile-summary')
  await expect(summary).toBeVisible()
  await expect(summary).toContainText('Pure TypeScript')
  await expect(summary).toContainText('Runtime dependencies')
  await expect(summary).toContainText('Browser support')
  await expect(summary).toContainText('Native addon')
  await expect(summary).toContainText('Scientific readers')
  await expect(summary).toContainText('Bounded memory model')
  await expect(summary.getByRole('heading', { name: 'PureJsImage' })).toBeVisible()

  const disclosure = page.locator('.comparison-matrix-disclosure')
  await expect(disclosure.getByText('Full comparison matrix')).toBeVisible()
  await expect(disclosure.locator('table.comparison-table')).toHaveCount(1)
  await expect(disclosure.locator('table')).toContainText('104/106 decoded')
  await expect(disclosure.locator('table')).toContainText('BigTIFF')
  await expect(disclosure).not.toHaveAttribute('open', '')

  await disclosure.locator('summary').click()
  await expect(disclosure).toHaveAttribute('open', '')
  await expect(page.getByRole('columnheader', { name: 'Decode coverage' })).toBeVisible()
  await noHorizontalOverflow(page)
  await assertPermittedInnerScrollOnly(page)

  await page.setViewportSize({ width: 1280, height: 900 })
  await waitForContainment(page)
  await expect(disclosure).toHaveAttribute('open', '', { timeout: 5_000 })
  await expect(summary).toBeHidden()
  await expect(page.getByRole('columnheader', { name: 'Decode coverage' })).toBeVisible()
  await noHorizontalOverflow(page)
})

test('wraps demo viewer actions instead of overflowing the phone toolbar', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/demo/')
  await waitForContainment(page)

  const actions = page.locator('.demo-viewer-actions')
  await expect(actions).toBeVisible()
  const metrics = await actions.evaluate((node) => {
    const styles = getComputedStyle(node)
    const box = node.getBoundingClientRect()
    const save = node.querySelector('.demo-save-clip')
    return {
      overflowX: styles.overflowX,
      flexWrap: styles.flexWrap,
      width: box.width,
      right: box.right,
      saveWidth: save?.getBoundingClientRect().width ?? 0,
      saveTop: save?.getBoundingClientRect().top ?? 0,
      zoomBottom: node.querySelector('.demo-viewer-zoom')?.getBoundingClientRect().bottom ?? 0,
    }
  })
  expect(metrics.overflowX === 'visible' || metrics.overflowX === 'clip').toBe(true)
  expect(metrics.flexWrap).toBe('wrap')
  expect(metrics.right).toBeLessThanOrEqual(391)
  expect(metrics.saveWidth).toBeGreaterThan(300)
  expect(metrics.saveTop).toBeGreaterThan(metrics.zoomBottom - 1)
  await noHorizontalOverflow(page)
})

test('gives documentation chip navigation a current state and contained snap scrolling', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/guides/')
  await waitForContainment(page)

  const nav = page.getByRole('navigation', { name: 'Documentation pages' })
  await expect(nav).toBeVisible()
  const current = nav.getByRole('link', { name: 'Getting started' })
  await expect(current).toHaveAttribute('aria-current', 'page')
  const styles = await nav.evaluate((node) => {
    const computed = getComputedStyle(node)
    return {
      overflowX: computed.overflowX,
      scrollSnapType: computed.scrollSnapType,
      right: node.getBoundingClientRect().right,
      currentWeight: getComputedStyle(node.querySelector('[aria-current="page"]') ?? node)
        .fontWeight,
    }
  })
  expect(styles.overflowX === 'auto' || styles.overflowX === 'scroll').toBe(true)
  expect(styles.scrollSnapType).toContain('x')
  expect(styles.right).toBeLessThanOrEqual(391)
  expect(Number.parseInt(styles.currentWeight, 10)).toBeGreaterThanOrEqual(700)
  await noHorizontalOverflow(page)
})

test('shows a table scroll cue only when a table is actually wider than its wrapper', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/tiff-comparison/')
  await waitForContainment(page)

  const wrap = page.locator('.comparison-group .comparison-table-wrap').first()
  await expect(wrap.locator('[data-scroll-cue]')).toBeVisible()
  await expect(wrap.locator('[data-scroll-cue]')).toHaveText('Scroll table horizontally')
  const scroller = wrap.locator('[data-scroll-region="table"]')
  await expect(scroller).toHaveClass(/is-scrollable/)
  const box = await wrap.boundingBox()
  expect(box).not.toBeNull()
  if (box) {
    expect(box.x).toBeGreaterThanOrEqual(-1)
    expect(box.x + box.width).toBeLessThanOrEqual(391)
  }
  await noHorizontalOverflow(page)
})
