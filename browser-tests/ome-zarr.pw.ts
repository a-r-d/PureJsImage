import { expect, test } from '@playwright/test'
import compatibilityReport from '../benchmark/generated/ome-zarr-compatibility.json' with {
  type: 'json',
}
import conformanceReport from '../benchmark/generated/ome-zarr-conformance.json' with {
  type: 'json',
}

const canvasDigest = async (page: import('@playwright/test').Page): Promise<number> =>
  page.locator('#ome-zarr-canvas').evaluate((element) => {
    if (!(element instanceof HTMLCanvasElement)) throw new Error('OME-Zarr canvas is missing')
    const context = element.getContext('2d')
    if (context === null) throw new Error('OME-Zarr canvas has no 2D context')
    const data = context.getImageData(0, 0, element.width, element.height).data
    const step = Math.max(4, Math.floor(data.length / 4_096 / 4) * 4)
    let digest = 2_166_136_261
    for (let offset = 0; offset < data.length; offset += step) {
      digest = Math.imul(digest ^ (data[offset] ?? 0), 16_777_619) >>> 0
      digest = Math.imul(digest ^ (data[offset + 1] ?? 0), 16_777_619) >>> 0
      digest = Math.imul(digest ^ (data[offset + 2] ?? 0), 16_777_619) >>> 0
    }
    return digest
  })

test('defaults to Quick WSI and keeps the viewer prominent at desktop and phone widths', async ({
  page,
}) => {
  await page.route('https://storage.googleapis.com/**', async (route) =>
    route.fulfill({ status: 503, contentType: 'text/plain', body: 'offline test' }),
  )
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/ome-zarr/')
  await page.waitForFunction(() => window.pureJsImageOmeZarrReady === true)

  const publicGroup = page.locator('[data-sample-group="large-public-wsi"]')
  const quickButton = publicGroup.getByRole('button', { name: /Quick WSI/ })
  const featureButton = page.locator('[data-sample-group="feature-tour"]').getByRole('button')
  await expect(page.getByLabel('OME-Zarr store URL')).toHaveValue(
    'https://storage.googleapis.com/jax-public-ngff/public/41028.zarr',
  )
  await expect(quickButton).toHaveAttribute('aria-pressed', 'true')
  await expect(featureButton).toHaveAttribute('aria-pressed', 'false')

  const desktop = await page.locator('.ome-zarr-demo-layout').evaluate((layout) => {
    const launch = layout.querySelector('.ome-zarr-launch-panel')
    const workspace = layout.querySelector('.wsi-workspace')
    if (!(launch instanceof HTMLElement) || !(workspace instanceof HTMLElement)) return undefined
    const launchBox = launch.getBoundingClientRect()
    const workspaceBox = workspace.getBoundingClientRect()
    return {
      launchWidth: launchBox.width,
      launchTop: launchBox.top,
      launchRight: launchBox.right,
      workspaceTop: workspaceBox.top,
      workspaceLeft: workspaceBox.left,
    }
  })
  expect(desktop).toBeDefined()
  expect(desktop?.launchWidth).toBeLessThan(300)
  expect(Math.abs((desktop?.launchTop ?? 0) - (desktop?.workspaceTop ?? 0))).toBeLessThan(2)
  expect(desktop?.workspaceLeft).toBeGreaterThan(desktop?.launchRight ?? 0)
  expect(desktop?.workspaceTop).toBeLessThan(430)

  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(
    async () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  )
  const mobile = await page.locator('.ome-zarr-demo-layout').evaluate((layout) => {
    const launch = layout.querySelector('.ome-zarr-launch-panel')
    const workspace = layout.querySelector('.wsi-workspace')
    const canvas = layout.querySelector('.wsi-canvas-wrap')
    const controls = layout.querySelector('.ome-zarr-controls')
    const buttons = [...layout.querySelectorAll<HTMLButtonElement>('[data-ome-zarr-sample-url]')]
    if (
      !(launch instanceof HTMLElement) ||
      !(workspace instanceof HTMLElement) ||
      !(canvas instanceof HTMLElement) ||
      !(controls instanceof HTMLElement)
    )
      return undefined
    return {
      launchBottom: launch.getBoundingClientRect().bottom,
      workspaceTop: workspace.getBoundingClientRect().top,
      canvasTop: canvas.getBoundingClientRect().top,
      controlsTop: controls.getBoundingClientRect().top,
      buttonHeights: buttons.map((button) => button.getBoundingClientRect().height),
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }
  })
  expect(mobile).toBeDefined()
  expect(mobile?.workspaceTop).toBeGreaterThan(mobile?.launchBottom ?? 0)
  expect(mobile?.canvasTop).toBeLessThan(mobile?.controlsTop ?? 0)
  expect(mobile?.buttonHeights).toHaveLength(4)
  expect(mobile?.buttonHeights.every((height) => height >= 48)).toBe(true)
  expect(mobile?.scrollWidth).toBeLessThanOrEqual(mobile?.clientWidth ?? 0)
  await expect(page.getByLabel('OME-Zarr store URL')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open store' })).toBeVisible()
})

test('opens the same-origin Feature Tour and exposes multidimensional authored metadata', async ({
  page,
  baseURL,
}) => {
  if (baseURL === undefined) throw new Error('Playwright baseURL is required')
  const expectedOrigin = new URL(baseURL).origin
  const externalRequests: string[] = []
  page.on('request', (request) => {
    const requested = new URL(request.url())
    if (requested.origin !== expectedOrigin) externalRequests.push(request.url())
  })

  const featureUrl = `${baseURL}/fixtures/ome-zarr-feature-tour`
  await page.goto(`/ome-zarr/?url=${encodeURIComponent(featureUrl)}`)
  await page.waitForFunction(() => window.pureJsImageOmeZarrReady === true)
  await expect(page.locator('#ome-zarr-stat-store')).toContainText('ome-zarr-feature-tour', {
    timeout: 20_000,
  })
  await expect(page.locator('.wsi-request-state.pending')).toHaveCount(0, { timeout: 30_000 })
  await expect(page.locator('#ome-zarr-loading')).toBeHidden({ timeout: 30_000 })
  expect(externalRequests).toEqual([])

  const featureGroup = page.locator('[data-sample-group="feature-tour"]')
  await expect(featureGroup).toContainText('Feature tour')
  await expect(featureGroup).toContainText('Synthetic')
  const featureButton = featureGroup.getByRole('button', {
    name: /Multidimensional \+ channels \+ labels \+ HCS/,
  })
  await expect(featureButton).toHaveAttribute('aria-pressed', 'true')
  const publicGroup = page.locator('[data-sample-group="large-public-wsi"]')
  await expect(publicGroup.getByRole('button')).toHaveCount(3)
  await expect(publicGroup).toContainText('Quick WSI')
  await expect(publicGroup).toContainText('Square WSI')
  await expect(publicGroup).toContainText('Large WSI')

  await expect(page.locator('#ome-zarr-stat-dimensions')).toHaveText('384 × 256')
  await expect(page.locator('#ome-zarr-stat-axes')).toHaveText('t[2], c[3], z[2], y[256], x[384]')
  await expect(page.locator('#ome-zarr-stat-levels')).toContainText('3 (1×, 2×, 4×)')
  await expect(page.locator('[data-axis-id="t"]')).toHaveAttribute('max', '1')
  await expect(page.locator('[data-axis-id="z"]')).toHaveAttribute('max', '1')
  await expect(page.locator('[data-axis-id="z"]')).toHaveValue('1')

  const channelControls = page.locator('.ome-zarr-channel-control')
  await expect(channelControls).toHaveCount(3)
  await expect(channelControls.nth(0)).toContainText('Red tissue')
  await expect(channelControls.nth(0).locator('input[type="checkbox"]')).toBeChecked()
  await expect(channelControls.nth(1).locator('input[type="checkbox"]')).not.toBeChecked()
  await expect(channelControls.nth(2).locator('input[type="checkbox"]')).toBeChecked()
  await expect(channelControls.nth(0).locator('input[type="color"]')).toHaveValue('#aa1100')
  await expect(channelControls.nth(0).locator('input[title="Display minimum"]')).toHaveValue('10')
  await expect(channelControls.nth(2).locator('input[title="Display maximum"]')).toHaveValue('220')

  const initialDigest = await canvasDigest(page)
  await page.locator('[data-axis-id="t"]').fill('1')
  await page.locator('[data-axis-id="t"]').dispatchEvent('change')
  await expect(page.locator('.wsi-request-state.pending')).toHaveCount(0, { timeout: 30_000 })
  await expect.poll(() => canvasDigest(page)).not.toBe(initialDigest)
  const timeDigest = await canvasDigest(page)
  await page.locator('[data-axis-id="z"]').fill('0')
  await page.locator('[data-axis-id="z"]').dispatchEvent('change')
  await expect(page.locator('.wsi-request-state.pending')).toHaveCount(0, { timeout: 30_000 })
  await expect.poll(() => canvasDigest(page)).not.toBe(timeDigest)
  await expect(page).toHaveURL(/axes=/)

  await expect(page.locator('#ome-zarr-label option')).toHaveCount(2)
  await page.getByLabel('Label overlay').selectOption('labels/segmentation')
  await expect(page.locator('#ome-zarr-label-opacity')).toBeEnabled()
  await expect(page.locator('#ome-zarr-loading')).toBeHidden({ timeout: 30_000 })

  const dataset = page.getByLabel('Image / plate field')
  await expect(dataset.locator('option')).toHaveCount(3)
  await dataset.selectOption('A/1/0')
  await expect(page.locator('#ome-zarr-stat-store')).toContainText('well-A1')
  await dataset.selectOption('A/2/0')
  await expect(page.locator('#ome-zarr-stat-store')).toContainText('well-A2')

  await expect(page.locator('#ome-zarr-evidence-version')).toHaveText(
    conformanceReport.omeZarrVersion,
  )
  await expect(page.locator('#ome-zarr-evidence-normative')).toHaveText(
    `${conformanceReport.normative.passed} / ${conformanceReport.normative.total}`,
  )
  await expect(page.locator('#ome-zarr-evidence-strict')).toHaveText(
    `${conformanceReport.strict.passed} / ${conformanceReport.strict.total}`,
  )
  await expect(page.locator('#ome-zarr-evidence-exclusions')).toHaveText(
    String(conformanceReport.excludedCases.length),
  )
  await expect(page.locator('#ome-zarr-evidence-public-roots')).toHaveText(
    String(compatibilityReport.results.length),
  )
  await expect(page.locator('#ome-zarr-support-title')).toBeVisible()
  await expect(page.locator('.ome-zarr-support-grid')).toContainText('OME-NGFF 0.4 and 0.5')
  await expect(page.locator('.ome-zarr-support-grid')).toContainText('OME-Zarr 0.6rc0')
  await expect(page.locator('.ome-zarr-trust-line')).toHaveText(
    'Read-only technical demonstration. Not validated for diagnostic use.',
  )

  await expect(page.getByLabel('OME-Zarr store URL')).toBeVisible()
  const quickButton = publicGroup.getByRole('button', { name: /Quick WSI/ })
  await quickButton.focus()
  await expect(quickButton).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(publicGroup.getByRole('button', { name: /Square WSI/ })).toBeFocused()
  await featureButton.focus()
  await expect(featureButton).toBeFocused()
  const omeZarrNavigationLink = page.locator('.nav-submenu a', {
    hasText: 'OME-Zarr viewer',
  })
  await expect(omeZarrNavigationLink).toHaveAttribute('href', '/ome-zarr/')
})

test('opens, measures, navigates, cancels, and resets a local sharded OME-Zarr WSI', async ({
  page,
  baseURL,
}) => {
  if (baseURL === undefined) throw new Error('Playwright baseURL is required')
  const externalRequests: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.hostname !== '127.0.0.1') externalRequests.push(request.url())
  })
  const fixtureUrl = `${baseURL}/fixtures/ome-zarr-wsi-compatible?rangeDelay=200`
  const malformedChannels = JSON.stringify([
    { index: 0, enabled: true, color: 0xff0000, minimum: 0, maximum: 255, gamma: 1 },
    { index: 0, enabled: true, color: 0x00ff00, minimum: 0, maximum: 255, gamma: 1 },
    { index: 2, enabled: true, color: 0x0000ff, minimum: 0, maximum: 255, gamma: 1 },
  ])
  await page.goto(
    `/ome-zarr/?url=${encodeURIComponent(fixtureUrl)}&channels=${encodeURIComponent(malformedChannels)}`,
  )
  await page.waitForFunction(() => window.pureJsImageOmeZarrReady === true)
  const loading = page.locator('#ome-zarr-loading')
  await expect(loading).toBeVisible()
  await expect(page.locator('#ome-zarr-loading-title')).toContainText(/Opening|Loading/)
  const implementationCode = page.locator('#ome-zarr-implementation-code')
  await expect(implementationCode).toContainText(
    "createOmeZarrReader } from 'purejsimage/scientific/readers/ome-zarr'",
  )
  await expect(implementationCode).toContainText('createOmeZarrHttpContext')
  await expect(implementationCode).toContainText("metadataValidation: 'compatible'")
  await expect(implementationCode).toContainText('dataset.readPlane')
  await expect(implementationCode.locator('.tok-key').first()).toBeVisible()
  await expect(page.locator('[data-copy="ome-zarr-implementation-code"]')).toHaveText('Copy')
  const codeTabs = page.locator('.wsi-code-window .code-tabs label')
  await expect(codeTabs).toHaveText(['ome-zarr-worker.ts', 'ome-zarr-http.ts'])
  await codeTabs.nth(1).click()
  const httpCode = page.locator('#ome-zarr-http-code')
  await expect(httpCode).toBeVisible()
  await expect(httpCode).toContainText('createOmeZarrHttpContext')
  await expect(httpCode.locator('.tok-string').first()).toBeVisible()
  await expect(page.locator('[data-copy="ome-zarr-http-code"]')).toHaveText('Copy')

  await expect(page.locator('#ome-zarr-stat-store')).toContainText('ome-zarr-wsi-compatible', {
    timeout: 20_000,
  })
  await expect(page.locator('#ome-zarr-stat-dimensions')).toHaveText('1,792 × 1,280')
  await expect(page.locator('#ome-zarr-stat-levels')).toContainText('3 (1×, 2×, 4×)')
  await expect(page.locator('#ome-zarr-stat-axes')).toHaveText('t[1], c[3], z[2], y[1280], x[1792]')
  await expect(page.locator('#ome-zarr-stat-logical-chunk')).toHaveText('1 × 3 × 1 × 128 × 128')
  await expect(page.locator('#ome-zarr-stat-shard')).toContainText('1 × 3 × 2 × 512 × 512')
  await expect(page.locator('#ome-zarr-metadata-summary')).toContainText('metadata')
  await expect(page.locator('#ome-zarr-metadata-summary')).not.toContainText('0 B')
  await expect(page.locator('#ome-zarr-open')).toBeEnabled()
  const heroLayout = await page.locator('.wsi-hero').evaluate((hero) => {
    const claim = hero.querySelector('.wsi-claim-card')
    const value = hero.querySelector('#ome-zarr-measured-bytes')
    if (!(claim instanceof HTMLElement) || !(value instanceof HTMLElement)) return undefined
    return {
      claimHeight: claim.getBoundingClientRect().height,
      heroHeight: hero.getBoundingClientRect().height,
      valueOverflow: getComputedStyle(value).overflow,
      valueWhiteSpace: getComputedStyle(value).whiteSpace,
    }
  })
  expect(heroLayout).toBeDefined()
  expect(heroLayout?.claimHeight).toBe(166)
  expect(heroLayout?.heroHeight).toBeLessThan(320)
  expect(heroLayout?.valueOverflow).toBe('hidden')
  expect(heroLayout?.valueWhiteSpace).toBe('nowrap')
  await expect(page.locator('#ome-zarr-dataset option')).toHaveCount(3)
  await expect(page.locator('#ome-zarr-plate-summary')).toContainText('2 wells')
  await expect(page.locator('[data-axis-id="z"]')).toHaveAttribute('max', '1')
  await expect(page.locator('[data-axis-id="z"]')).toHaveValue('1')
  const channelControls = page.locator('.ome-zarr-channel-control')
  await expect(channelControls).toHaveCount(3)
  await expect(channelControls.nth(0).locator('input[type="checkbox"]')).toBeChecked()
  await expect(channelControls.nth(1).locator('input[type="checkbox"]')).not.toBeChecked()
  await expect(channelControls.nth(2).locator('input[type="checkbox"]')).toBeChecked()
  await expect(channelControls.nth(0).locator('input[type="color"]')).toHaveValue('#aa1100')
  await expect(channelControls.nth(0).locator('input[title="Display minimum"]')).toHaveValue('10')
  await expect(channelControls.nth(0).locator('input[title="Display maximum"]')).toHaveValue('200')
  await expect(page.locator('#ome-zarr-label option')).toHaveCount(2)
  await expect(page.locator('#ome-zarr-label option').nth(1)).toContainText(
    'deterministic-segmentation',
  )
  await expect(page.locator('#ome-zarr-minimap')).toBeVisible()
  await expect(page.locator('#ome-zarr-fullscreen')).toBeEnabled()

  await page.locator('#ome-zarr-dataset').selectOption('A/2/0')
  await expect(page.locator('#ome-zarr-stat-dimensions')).toHaveText('256 × 256')
  await expect(page.locator('#ome-zarr-stat-store')).toContainText('well-A2')
  await page.locator('#ome-zarr-dataset').selectOption('image')
  await expect(page.locator('#ome-zarr-stat-dimensions')).toHaveText('1,792 × 1,280')
  await expect(page.locator('[data-axis-id="z"]')).toBeVisible()

  await page.locator('#ome-zarr-dataset').evaluate((element) => {
    if (!(element instanceof HTMLSelectElement)) throw new Error('Dataset control is not a select')
    element.value = 'A/2/0'
    element.dispatchEvent(new Event('change', { bubbles: true }))
    element.value = 'image'
    element.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await expect(page.locator('#ome-zarr-stat-dimensions')).toHaveText('1,792 × 1,280')
  await expect(page.locator('#ome-zarr-status')).not.toHaveAttribute('data-error', 'true')

  await expect(page.locator('.wsi-request-state.pending').first()).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('#ome-zarr-loading-title')).toContainText(/visible tiles|viewport/)
  await expect(page.locator('#ome-zarr-loading-progress')).toHaveAttribute('aria-valuenow', /\d+/)
  await expect(page.locator('#ome-zarr-level-live')).toContainText('Level 1')
  await page.locator('#ome-zarr-zoom-in').click()
  await expect(page.locator('#ome-zarr-level-live')).toContainText('Level 0')
  await expect(page.locator('.wsi-request-state.pending').first()).toBeVisible()
  await page.locator('#ome-zarr-fit').click()
  await expect(page.locator('#ome-zarr-level-live')).toContainText('Level 1')
  await expect(page.locator('.wsi-request-state.cancelled').first()).toBeVisible({
    timeout: 20_000,
  })
  await expect(page.locator('#ome-zarr-stat-cancelled')).not.toHaveText('0')
  await expect(page.locator('#ome-zarr-stat-decoded')).not.toHaveText('0', { timeout: 30_000 })
  await expect(page.locator('.wsi-request-state.pending')).toHaveCount(0, { timeout: 40_000 })
  await expect(loading).toBeHidden()
  await expect(page.locator('#ome-zarr-canvas-wrap')).toHaveAttribute('aria-busy', 'false')

  await expect(page.locator('#ome-zarr-stat-object-requests')).not.toHaveText('0')
  await expect(page.locator('#ome-zarr-stat-range-requests')).not.toHaveText('0')
  await expect(page.locator('#ome-zarr-stat-bytes')).not.toHaveText('0 B')
  await expect(page.locator('#ome-zarr-stat-metadata-bytes')).not.toHaveText('0 B')
  await expect(page.locator('#ome-zarr-stat-array-bytes')).not.toHaveText('0 B')
  await expect(page.locator('#ome-zarr-stat-decode-time')).not.toHaveText('0 / 0 ms')
  const colors = await page.locator('#ome-zarr-canvas').evaluate((element) => {
    if (!(element instanceof HTMLCanvasElement)) return 0
    const canvas = element
    const context = canvas.getContext('2d')
    if (context === null) return 0
    const image = context.getImageData(0, 0, canvas.width, canvas.height)
    const unique = new Set<string>()
    const step = Math.max(4, Math.floor(image.data.length / 20_000 / 4) * 4)
    for (let offset = 0; offset < image.data.length; offset += step) {
      unique.add(
        `${image.data[offset] ?? 0},${image.data[offset + 1] ?? 0},${image.data[offset + 2] ?? 0}`,
      )
      if (unique.size > 8) break
    }
    return unique.size
  })
  expect(colors).toBeGreaterThan(2)

  await page.locator('[data-axis-id="z"]').fill('0')
  await page.locator('[data-axis-id="z"]').dispatchEvent('change')
  await expect(page).toHaveURL(/axes=/)
  await expect(page.locator('#ome-zarr-stat-decoded')).not.toHaveText('0', { timeout: 30_000 })

  await page.locator('#ome-zarr-label').selectOption('labels/segmentation')
  await expect(page).toHaveURL(/label=labels%2Fsegmentation/)
  await expect(page.locator('#ome-zarr-label-opacity')).toBeEnabled()
  await expect(page.locator('#ome-zarr-loading-title')).toContainText(/visible tiles|viewport/)
  await expect(page.locator('#ome-zarr-loading')).toBeHidden({ timeout: 40_000 })
  await expect(page.locator('#ome-zarr-auto-contrast')).toBeEnabled()
  await expect(page.locator('#ome-zarr-stat-in-flight')).toHaveText('0', { timeout: 20_000 })

  await page.locator('#ome-zarr-label-opacity').fill('70')
  await page.locator('#ome-zarr-open').click()
  await expect(page.locator('#ome-zarr-stat-dimensions')).toHaveText('1,792 × 1,280', {
    timeout: 20_000,
  })
  await expect(page.locator('#ome-zarr-status')).not.toHaveAttribute('data-error', 'true')
  await expect(page.locator('#ome-zarr-stat-decoded')).not.toHaveText('0', { timeout: 30_000 })
  await expect(page.locator('.wsi-request-state.pending')).toHaveCount(0, { timeout: 40_000 })
  await expect(page.locator('#ome-zarr-stat-in-flight')).toHaveText('0', { timeout: 20_000 })

  await page.locator('#ome-zarr-zoom-in').click()
  await expect(page.locator('.wsi-request-state.pending').first()).toBeVisible({ timeout: 10_000 })
  const reset = page.locator('#ome-zarr-reset')
  const previousEpoch = Number(await reset.getAttribute('data-measurement-epoch'))
  expect(Number.isSafeInteger(previousEpoch)).toBe(true)
  await reset.click()
  await expect(reset).toHaveAttribute('data-measurement-epoch', String(previousEpoch + 1), {
    timeout: 40_000,
  })
  await expect(reset).toBeEnabled()
  await expect(page.locator('#ome-zarr-status')).toContainText('Measurement counters reset')
  await expect(page.locator('#ome-zarr-stat-object-requests')).toHaveText('0')
  await expect(page.locator('#ome-zarr-stat-range-requests')).toHaveText('0')
  await expect(page.locator('#ome-zarr-stat-bytes')).toHaveText('0 B')
  await expect(page.locator('#ome-zarr-measured-bytes')).toHaveText('0 B')
  await expect(page.locator('#ome-zarr-stat-decoded')).toHaveText('0')

  await page.locator('[data-axis-id="z"]').fill('0')
  await page.locator('[data-axis-id="z"]').dispatchEvent('change')
  await expect(page.locator('#ome-zarr-stat-bytes')).not.toHaveText('0 B', { timeout: 30_000 })
  await expect(page.locator('#ome-zarr-stat-decoded')).not.toHaveText('0', { timeout: 30_000 })
  expect(externalRequests).toEqual([])
})

declare global {
  interface Window {
    pureJsImageOmeZarrReady?: boolean
  }
}
