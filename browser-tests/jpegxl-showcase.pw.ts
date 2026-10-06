import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import alphaCompression from '../benchmark/jpegxl/comparison/results/alpha-palette-production-controls.json' with {
  type: 'json',
}
import alphaDirect from '../benchmark/jpegxl/comparison/results/alpha-point-production-controls.json' with {
  type: 'json',
}
import denseLossless from '../benchmark/jpegxl/comparison/results/lossless-dense-training-production-controls.json' with {
  type: 'json',
}
import groupLossless from '../benchmark/jpegxl/comparison/results/lossless-group-search-production-controls.json' with {
  type: 'json',
}
import losslessSpatial from '../benchmark/jpegxl/comparison/results/lossless-rct-production-controls.json' with {
  type: 'json',
}
import photoCompression from '../benchmark/jpegxl/comparison/results/photo-parity-production-controls.json' with {
  type: 'json',
}
import originalPhoto from '../benchmark/jpegxl/comparison/results/original-photo-production-controls.json' with {
  type: 'json',
}
import comparison from '../benchmark/jpegxl/comparison/website-data.json' with { type: 'json' }

test('converter and exact grayscale JPEG round trip stay local', async ({ page }) => {
  const requests: string[] = []
  page.on('request', (r) => {
    if (r.method() !== 'GET') requests.push(r.url())
  })
  await page.goto('/jpeg-xl/convert/')
  await expect(page.locator('#jxl-status')).toContainText('inspected and decoded locally')
  await page.locator('#jxl-encode').click()
  await expect(page.locator('#jxl-status')).toContainText('byte-exact local round trip verified')
  await page.locator('#jxl-reopen').click()
  await expect(page.locator('#jxl-status')).toContainText('.jxl inspected')
  await page.goto('/jpeg-xl/jpeg-recompression/')
  await expect(page.locator('#jxl-status')).toContainText('inspected and decoded locally')
  await page.locator('#jxl-open-gray').click()
  await expect(page.locator('#jxl-status')).toContainText('jpegxl-gray.jpg inspected')
  await page.locator('#jxl-transcode').click()
  await expect(page.locator('#jxl-status')).toContainText('verified locally')
  await page.locator('#jxl-reconstruct').click()
  await expect(page.locator('#jxl-status')).toContainText('Original JPEG bytes')
  const wait = page.waitForEvent('download')
  await page.locator('#jxl-download').click()
  const download = await wait,
    path = await download.path()
  if (!path) throw new Error('Missing download')
  expect(await readFile(path)).toEqual(
    await readFile('tests/fixtures/jpegxl/gray-exact/gray-baseline.jpg'),
  )
  expect(requests).toEqual([])
})

test('native float bits and alpha survive re-encoding', async ({ page }) => {
  await page.goto('/jpeg-xl/native/')
  await page.getByRole('button', { name: 'Float and alpha', exact: true }).click()
  await expect(page.locator('#tool-status')).toContainText('Native samples inspected')
  await expect(page.locator('#tool-details')).toContainText('floating-point')
  await page.locator('#tool-encode').click()
  await expect(page.locator('#tool-status')).toContainText('every stored sample bit matches')
  await page.locator('#tool-reopen').click()
  await expect(page.locator('#tool-status')).toContainText('Native samples inspected')
})

test('native input replacement resets the selected plane and sample coordinates', async ({
  page,
}) => {
  await page.goto('/jpeg-xl/native/')
  await page.getByRole('button', { name: 'Float and alpha', exact: true }).click()
  await expect(page.locator('#tool-status')).toContainText('Native samples inspected')
  await page.locator('#tool-plane').selectOption('3')
  await page.locator('#tool-sample-x').fill('3')
  await page.locator('#tool-run').click()
  await expect(page.locator('#tool-details')).toContainText('"selectedPlane": 3')
  await page.locator('#tool-file').setInputFiles({
    name: 'gray.jxl',
    mimeType: 'image/jxl',
    buffer: await readFile('tests/fixtures/jpegxl/practical-float/gray32-alpha16-straight.jxl'),
  })
  await expect(page.locator('#tool-status')).toContainText('Native samples inspected')
  await expect(page.locator('#tool-plane')).toHaveValue('0')
  await expect(page.locator('#tool-sample-x')).toHaveValue('0')
  await expect(page.locator('#tool-details')).toContainText('"selectedPlane": 0')
})

test('animation playback timing and selected-frame export', async ({ page }) => {
  await page.goto('/jpeg-xl/animation/')
  await page.getByRole('button', { name: 'Try the animation', exact: true }).click()
  await expect(page.locator('#tool-status')).toContainText('Frame 1 of 3')
  await expect(page.locator('#tool-summary')).toContainText('2 ticks at 10/1')
  await page.locator('#tool-next').click()
  await expect(page.locator('#tool-status')).toContainText('Frame 2 of 3')
  await page.locator('#tool-export').click()
  await expect(page.locator('#tool-status')).toContainText('exported as sRGB8 PNG')
})

test('progressive sample produces real stages and can cancel after opening', async ({ page }) => {
  await page.goto('/jpeg-xl/progressive/')
  await page.getByRole('button', { name: 'Try progressive stages', exact: true }).click()
  await expect(page.locator('#tool-stages li').first()).toContainText('complete')
  await page.locator('#tool-cancel').click()
  await expect(page.locator('#tool-status')).toContainText('Cancelled')
  await page.locator('#tool-run').click()
  await expect(page.locator('#tool-status')).toContainText('operation complete', {
    timeout: 30_000,
  })
  expect(await page.locator('#tool-stages li').count()).toBeGreaterThan(1)
})

test('animation creation reorders local frames and reopens exact timing', async ({ page }) => {
  await page.goto('/jpeg-xl/animation/')
  await page.getByText('Create an animation', { exact: true }).click()
  await page
    .locator('#tool-frames')
    .setInputFiles([
      'tests/fixtures/jpegxl/gray-exact/gray-baseline.jpg',
      'tests/fixtures/jpegxl/gray-exact/gray-baseline.jpg',
    ])
  await page.locator('#tool-frame-list button').nth(1).click()
  await page.locator('#tool-duration').fill('37')
  await page.locator('#tool-loops').fill('2')
  await page.locator('#tool-encode').click()
  await expect(page.locator('#tool-status')).toContainText('Animation encoded')
  await page.locator('#tool-reopen').click()
  await expect(page.locator('#tool-status')).toContainText('Frame 1 of 2')
  await expect(page.locator('#tool-summary')).toContainText('37 ticks at 1000/1')
})

test('local names, metadata and bytes do not leave the browser; keyboard and narrow layouts work', async ({
  page,
}) => {
  const network: string[] = []
  page.on('request', (request) =>
    network.push(`${request.method()} ${request.url()} ${request.postData() ?? ''}`),
  )
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/jpeg-xl/native/')
  const file = await readFile(
    'benchmark/fixtures/jpegxl/generated-lossless-v0.12.0/gray8-linear.jxl',
  )
  await page
    .locator('#tool-file')
    .setInputFiles({ name: 'private-name-UNIQUE-734.jxl', mimeType: 'image/jxl', buffer: file })
  await expect(page.locator('#tool-status')).toContainText('Native samples inspected')
  await page.locator('#tool-run').focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('#tool-status')).toContainText('Native samples inspected')
  expect(network.every((r) => r.startsWith('GET ') && r.includes('127.0.0.1'))).toBe(true)
  expect(network.join('\n')).not.toContain('private-name-UNIQUE-734')
  expect(network.join('\n')).not.toMatch(
    /google-analytics|googletagmanager|sentry|wasm-vips|jsquash/,
  )
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true)
  await page
    .locator('#tool-file')
    .setInputFiles({ name: 'invalid.jxl', mimeType: 'image/jxl', buffer: Buffer.from('invalid') })
  await expect(page.locator('#tool-status')).not.toContainText('Working locally')
  await page.getByRole('button', { name: '16-bit samples', exact: true }).click()
  await expect(page.locator('#tool-status')).toContainText('Native samples inspected')
})

test('converter cancellation retries source and downloads remain usable', async ({ page }) => {
  await page.goto('/jpeg-xl/convert/')
  await expect(page.locator('#jxl-status')).toContainText('inspected', { timeout: 30_000 })
  await page.locator('#jxl-encode').click()
  await page.locator('#jxl-cancel').click()
  await expect(page.locator('#jxl-status')).toContainText('Cancelled')
  await page.locator('#jxl-encode').click()
  await expect(page.locator('#jxl-status')).toContainText('byte-exact local round trip verified', {
    timeout: 30_000,
  })
  for (let i = 0; i < 2; i++) {
    const next = page.waitForEvent('download')
    await page.locator('#jxl-download').click()
    expect((await next).suggestedFilename()).toMatch(/\.jxl$/)
  }
})

test('replaced inputs ignore stale worker messages and recover from worker failure', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const Original = Worker,
      workers: Worker[] = []
    Object.defineProperty(window, 'jxlTestWorkers', { value: workers })
    Object.defineProperty(window, 'jxlTestLast', { value: undefined, writable: true })
    window.Worker = class extends Original {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options)
        workers.push(this)
        this.addEventListener('message', (e) =>
          Object.defineProperty(window, 'jxlTestLast', { value: e.data, writable: true }),
        )
      }
    }
  })
  await page.goto('/jpeg-xl/native/')
  await page.getByRole('button', { name: '16-bit samples', exact: true }).click()
  await expect(page.locator('#tool-status')).toContainText('Native samples inspected')
  await page.evaluate(() => {
    if ('jxlTestLast' in window)
      Object.defineProperty(window, 'jxlStale', { value: window.jxlTestLast })
  })
  await page.getByRole('button', { name: 'Float and alpha', exact: true }).click()
  await expect(page.locator('#tool-details')).toContainText('floating-point')
  await page.evaluate(() => {
    if ('jxlTestWorkers' in window && Array.isArray(window.jxlTestWorkers)) {
      const old = window.jxlTestWorkers[0]
      if (old instanceof Worker) {
        old.dispatchEvent(new ErrorEvent('error', { message: 'Stale worker failure' }))
        old.dispatchEvent(new MessageEvent('messageerror'))
      }
    }
  })
  await expect(page.locator('#tool-status')).toContainText('Native samples inspected')
  await page.evaluate(() => {
    if (
      'jxlTestWorkers' in window &&
      Array.isArray(window.jxlTestWorkers) &&
      'jxlStale' in window
    ) {
      const old = window.jxlTestWorkers[0]
      if (old instanceof Worker)
        old.dispatchEvent(new MessageEvent('message', { data: window.jxlStale }))
    }
  })
  await expect(page.locator('#tool-details')).toContainText('floating-point')
  await page.evaluate(() => {
    if ('jxlTestWorkers' in window && Array.isArray(window.jxlTestWorkers)) {
      const current = window.jxlTestWorkers.at(-1)
      if (current instanceof Worker)
        current.dispatchEvent(new ErrorEvent('error', { message: 'Simulated worker failure' }))
    }
  })
  await expect(page.locator('#tool-status')).toContainText('Simulated worker failure')
  await page.locator('#tool-run').click()
  await expect(page.locator('#tool-status')).toContainText('Native samples inspected')
})

test('comparison and seven routes have distinct canonicals and usable evidence downloads', async ({
  page,
}) => {
  for (const path of [
    '',
    'convert/',
    'jpeg-recompression/',
    'animation/',
    'progressive/',
    'native/',
    'comparison/',
  ]) {
    await page.goto(`/jpeg-xl/${path}`)
    await expect(page.locator('h1')).toBeVisible()
    await expect(page.locator('link[rel=canonical]')).toHaveAttribute(
      'href',
      `https://purejsimage.com/jpeg-xl/${path}`,
    )
  }
  await expect(page.locator('main')).toContainText(
    '13 adequately matched pairs and 11 unresolved pairs',
  )
  for (const row of photoCompression.matchedFrozenPeerComparisons)
    await expect(page.locator('main')).toContainText(row.ratio.toFixed(3))
  await expect(page.locator('main')).toContainText('0.53% smaller')
  const photoResponse = await page.request.get(
    '/jpeg-xl/evidence/photo-parity-production-controls.json',
  )
  expect(photoResponse.ok()).toBe(true)
  const photoDownloaded: unknown = await photoResponse.json()
  expect(photoDownloaded).toMatchObject({
    implementationSourceSha256: photoCompression.implementationSourceSha256,
    sourceAdopted: true,
    completed: true,
    scoreTolerance: 0.25,
    extrapolation: false,
    publicComparisonCountsChanged: false,
    fullParity: false,
  })
  expect(photoCompression.matchedFrozenPeerComparisons).toHaveLength(12)
  for (const row of photoCompression.matchedFrozenPeerComparisons) expect(row.ratio).toBeLessThan(1)
  const photoDocument = await page.request.get('/jpeg-xl/evidence/PHOTO-PARITY.md')
  expect(photoDocument.ok()).toBe(true)
  expect(await photoDocument.text()).toContain('797,262')
  expect(
    (await page.request.get('/jpeg-xl/evidence/photo-transform-native-baseline.json')).ok(),
  ).toBe(true)
  const graphicResponse = await page.request.get(
    '/jpeg-xl/evidence/graphic-point-production-controls.json',
  )
  expect(graphicResponse.ok()).toBe(true)
  const graphicDownloaded: unknown = await graphicResponse.json()
  expect(graphicDownloaded).toMatchObject({
    completed: true,
    sourceAdopted: true,
    fullParity: false,
    publicComparisonCountsChanged: false,
    correctedParameterLabels: true,
    freshEncodedFiles: 3,
    frozenPeerFiles: 6,
    freshCompleteIndependentGrids: 18,
  })
  const graphicDocument = await page.request.get('/jpeg-xl/evidence/GRAPHIC-POINTS.md')
  expect(graphicDocument.ok()).toBe(true)
  expect(await graphicDocument.text()).toContain('14,055')
  await expect(page.locator('main')).toContainText('8,409 bytes against wasm-vips at 8,642')
  await expect(page.locator('main')).toContainText('all 24 original peer/target selections')
  const alphaDirectResponse = await page.request.get(
    '/jpeg-xl/evidence/alpha-point-production-controls.json',
  )
  expect(alphaDirectResponse.ok()).toBe(true)
  const alphaDirectDownloaded: unknown = await alphaDirectResponse.json()
  expect(alphaDirectDownloaded).toMatchObject({
    implementationSourceSha256: alphaDirect.implementationSourceSha256,
    completed: true,
    sourceAdopted: true,
    fullParity: false,
    publicComparisonCountsChanged: false,
    freshEncodedFiles: 5,
    frozenPeerFiles: 5,
    freshCompleteIndependentGrids: 20,
  })
  const alphaDirectDocument = await page.request.get('/jpeg-xl/evidence/ALPHA-POINTS.md')
  expect(alphaDirectDocument.ok()).toBe(true)
  expect(await alphaDirectDocument.text()).toContain('Other original-size photos')
  const originalResponse = await page.request.get(
    '/jpeg-xl/evidence/original-photo-production-controls.json',
  )
  expect(originalResponse.ok()).toBe(true)
  const originalDownloaded: unknown = await originalResponse.json()
  expect(originalDownloaded).toMatchObject({
    implementationSourceSha256: originalPhoto.implementationSourceSha256,
    sourceAdopted: true,
    completed: true,
    fullParity: false,
    secondaryMetricDominance: false,
    scope: 'original',
    inputGeometry: { width: 4000, height: 3000 },
    freshEncodedFiles: 14,
    freshCompleteIndependentGrids: 0,
    reusedQualifiedIndependentGrids: 74,
    reusedQualifiedPublicDecodedSamples: 672_000_000,
    scoreTolerance: 0.25,
    butteraugliTolerance: 0.25,
    extrapolation: false,
    publicComparisonCountsChanged: false,
  })
  expect(originalDownloaded).toEqual(originalPhoto)
  expect(originalPhoto.comparisons).toHaveLength(6)
  for (const row of originalPhoto.comparisons) expect(row.ratio).toBeLessThan(1)
  expect(originalPhoto.butteraugliComparisons).toHaveLength(8)
  for (const row of originalPhoto.butteraugliComparisons) {
    if (row.status === 'adequate bracket') expect(row.ratio).toBeLessThan(1)
    else {
      expect(row.comparator).toBe('vips')
      expect([2, 3]).toContain(row.target)
      expect(row.ratio).toBeNull()
      expect(row.peer.interpolatedBytes).toBeNull()
    }
  }
  await expect(page.locator('main')).toContainText(originalPhoto.implementationSourceSha256)
  await expect(page.locator('main')).toContainText(
    'two wasm-vips targets remain unresolved under the unchanged rules',
  )
  const originalTable = page.locator('table').filter({
    has: page.locator('caption', { hasText: 'Original 4000 × 3000 photo at matched SSIMULACRA2' }),
  })
  for (const bytes of ['271,113', '513,039', '1,424,884'])
    await expect(originalTable).toContainText(bytes)
  const butteraugliTable = page.locator('table').filter({
    has: page.locator('caption', {
      hasText: 'Same original photo at independently matched Butteraugli targets',
    }),
  })
  await expect(butteraugliTable.locator('tbody tr')).toHaveCount(4)
  await expect(butteraugliTable.locator('td', { hasText: /^Unresolved$/ })).toHaveCount(4)
  for (const bytes of ['2,482,443', '1,276,115', '489,411', '239,867'])
    await expect(butteraugliTable).toContainText(bytes)
  await expect(butteraugliTable).toContainText('0.10% smaller')
  for (const name of [
    'ORIGINAL-PHOTO.md',
    'original-photo-quality-study.json',
    'original-photo-endpoint-qualification.json',
    'original-photo-ssim-endpoint-qualification.json',
    'original-lossy-heldout-controls.json',
  ])
    expect((await page.request.get(`/jpeg-xl/evidence/${name}`)).ok()).toBe(true)
  await expect(page.locator('main')).toContainText(comparison.implementationSourceSha256)
  await expect(page.locator('main')).toContainText('all 16 pinned lossless inputs exactly')
  for (const bytes of ['48,819', '9,038', '9,155', '9,307'])
    await expect(page.locator('main')).toContainText(bytes)
  const alphaResponse = await page.request.get(
    '/jpeg-xl/evidence/alpha-palette-production-controls.json',
  )
  expect(alphaResponse.ok()).toBe(true)
  const alphaDownloaded: unknown = await alphaResponse.json()
  expect(alphaDownloaded).toMatchObject({
    implementationSourceSha256: alphaCompression.implementationSourceSha256,
    completed: true,
    sourceAdopted: true,
    fullParity: false,
    publicComparisonCountsChanged: false,
    pointDominance: { alphaExact: true, pureBytes: 9155, peerBytes: 9307 },
  })
  const alphaDocument = await page.request.get('/jpeg-xl/evidence/ALPHA-PALETTES.md')
  expect(alphaDocument.ok()).toBe(true)
  expect(await alphaDocument.text()).toContain('36.9 MB')
  for (const name of ['alpha-palette-native-baseline.json', 'alpha-peer-audit.json'])
    expect((await page.request.get(`/jpeg-xl/evidence/${name}`)).ok()).toBe(true)
  const response = await page.request.get('/jpeg-xl/evidence/website-data.json')
  expect(response.ok()).toBe(true)
  const downloaded: unknown = await response.json()
  expect(downloaded).toMatchObject({
    implementationRevision: comparison.implementationRevision,
    implementationSourceSha256: comparison.implementationSourceSha256,
    implementationDirty: comparison.implementationDirty,
  })
  await expect(page.locator('main')).toContainText(losslessSpatial.implementationSourceSha256)
  await expect(page.locator('main')).toContainText('268,214')
  await expect(page.locator('main')).toContainText('compression first')
  const spatialResponse = await page.request.get(
    '/jpeg-xl/evidence/lossless-rct-production-controls.json',
  )
  expect(spatialResponse.ok()).toBe(true)
  const spatialDownloaded: unknown = await spatialResponse.json()
  expect(spatialDownloaded).toMatchObject({
    implementationSourceSha256: losslessSpatial.implementationSourceSha256,
    completed: true,
    fullParity: false,
    originalFixtures: 16,
    smallerLosslessFiles: 4,
    unchangedLosslessFiles: 12,
    realBrowserCases: 18,
    compressionFirstAuthorized: true,
    unchangedEffort7Files: 16,
    unchangedOriginalColorHashes: 56,
  })
  await expect(page.locator('main')).toContainText(denseLossless.implementationSourceSha256)
  await expect(page.locator('main')).toContainText('125,561')
  await expect(page.locator('main')).toContainText('6,183,475')
  await expect(page.locator('main')).toContainText('400,951')
  const denseResponse = await page.request.get(
    '/jpeg-xl/evidence/lossless-dense-training-production-controls.json',
  )
  expect(denseResponse.ok()).toBe(true)
  const denseDownloaded: unknown = await denseResponse.json()
  expect(denseDownloaded).toMatchObject({
    implementationSourceSha256: denseLossless.implementationSourceSha256,
    completed: true,
    fullParity: false,
    verifiedComparableLosslessCells: 45,
    atOrBelowFrozenPeerLosslessCells: 43,
    smallerEffort7Files: 12,
    unchangedEffort7Files: 4,
    largerEffort7Files: 0,
    unchangedEffort1Files: 16,
    realBrowserCases: 18,
    compressionFirstAuthorized: true,
    unchangedOriginalColorHashes: 56,
  })
  await expect(page.locator('main')).toContainText(groupLossless.implementationSourceSha256)
  const currentLossless = page.locator('table').filter({
    has: page.locator('caption', { hasText: 'Current effort-7 lossless files' }),
  })
  await expect(
    currentLossless.locator('tr').filter({ hasText: '4000 × 3000 photo' }),
  ).toContainText('6,183,475')
  await expect(
    currentLossless.locator('tr').filter({ hasText: '1920 × 1080 screenshot' }),
  ).toContainText('386,813')
  for (const bytes of ['819,166', '641,956', '386,813'])
    await expect(page.locator('main')).toContainText(bytes)
  const groupResponse = await page.request.get(
    '/jpeg-xl/evidence/lossless-group-search-production-controls.json',
  )
  expect(groupResponse.ok()).toBe(true)
  const groupDownloaded: unknown = await groupResponse.json()
  expect(groupDownloaded).toMatchObject({
    implementationSourceSha256: groupLossless.implementationSourceSha256,
    completed: true,
    sourceAdopted: true,
    fullParity: false,
    integerLosslessCorpusParity: true,
    verifiedComparableLosslessCells: 45,
    atOrBelowFrozenPeerLosslessCells: 45,
    remainingMeasuredLosslessGaps: [],
    smallerEffort1Files: 6,
    unchangedEffort1Files: 10,
    largerEffort1Files: 0,
    smallerEffort7Files: 4,
    unchangedEffort7Files: 12,
    largerEffort7Files: 0,
    realBrowserCases: 30,
    compressionFirstAuthorized: true,
    unchangedOriginalColorHashes: 56,
    originalWorkingBudgetsRecovered: true,
    originalMinimumBoundariesPreserved: true,
  })
  const groupDocument = await page.request.get('/jpeg-xl/evidence/GROUP-SEARCH.md')
  expect(groupDocument.ok()).toBe(true)
  expect(await groupDocument.text()).toContain(groupLossless.implementationSourceSha256)
  const denseDocument = await page.request.get('/jpeg-xl/evidence/DENSE-TRAINING.md')
  expect(denseDocument.ok()).toBe(true)
  expect(await denseDocument.text()).toContain(denseLossless.implementationSourceSha256)
  const spatialDocument = await page.request.get('/jpeg-xl/evidence/LOSSLESS-RCT.md')
  expect(spatialDocument.ok()).toBe(true)
  expect(await spatialDocument.text()).toContain(losslessSpatial.implementationSourceSha256)
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  )
  await page.goto('/jpeg-xl/#jxl-progressive-title')
  await expect(page).toHaveURL(/\/jpeg-xl\/progressive\//)
  await page.goto('/jpeg-xl/#jxl-transcode')
  await expect(page).toHaveURL(/\/jpeg-xl\/jpeg-recompression\//)
  await expect(page.locator('#jxl-transcode')).toBeVisible()
})

test('explicit URL input refuses unbounded full responses and can retry locally', async ({
  page,
  context,
}) => {
  await context.route('**/no-range-test.jxl', (route) =>
    route.fulfill({ status: 200, contentType: 'image/jxl', body: Buffer.alloc(4096) }),
  )
  await page.goto('/jpeg-xl/progressive/')
  await page.locator('#tool-url').fill(`${new URL(page.url()).origin}/no-range-test.jxl`)
  await page.locator('#tool-run').click()
  await expect(page.locator('#tool-status')).toContainText('full file instead of a byte range')
  await page.getByRole('button', { name: 'Try progressive stages', exact: true }).click()
  await expect(page.locator('#tool-status')).toContainText('operation complete', {
    timeout: 30_000,
  })
})

test('capture actual tool outputs for showcase cards', async ({ page, browserName }) => {
  test.skip(
    process.env.PUREJSIMAGE_CAPTURE_JXL !== '1' || browserName !== 'chromium',
    'Manual asset capture only',
  )
  await page.setViewportSize({ width: 1280, height: 900 })
  for (const [tool, sample, ready] of [
    ['native', 'Float and alpha', 'Native samples inspected'],
    ['animation', 'Try the animation', 'Frame 1 of 3'],
    ['progressive', 'Try progressive stages', 'operation complete'],
  ] as const) {
    await page.goto(`/jpeg-xl/${tool}/`)
    await page.getByRole('button', { name: sample, exact: true }).click()
    await expect(page.locator('#tool-status')).toContainText(ready)
    await page.locator('#tool-canvas').screenshot({ path: `.tmp/jpegxl-showcase-${tool}.png` })
    await page.evaluate(() => scrollTo(0, 0))
    await page.screenshot({ path: `.tmp/jpegxl-showcase-${tool}-page.png`, fullPage: true })
  }
  for (const tool of ['convert', 'jpeg-recompression']) {
    await page.goto(`/jpeg-xl/${tool}/`)
    await expect(page.locator('#jxl-status')).toContainText('inspected', { timeout: 30_000 })
    await page.locator('#jxl-preview').screenshot({ path: `.tmp/jpegxl-showcase-${tool}.png` })
  }
  await page.goto('/jpeg-xl/comparison/')
  await page.locator('.jxl-tool-cards').screenshot({ path: '.tmp/jpegxl-showcase-comparison.png' })
  await page.evaluate(() => scrollTo(0, 0))
  await page.screenshot({ path: '.tmp/jpegxl-showcase-comparison-page.png', fullPage: true })
  await page.goto('/jpeg-xl/')
  await page.screenshot({ path: '.tmp/jpegxl-showcase-hub-page.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: '.tmp/jpegxl-showcase-hub-narrow.png', fullPage: true })
})

test('converter preserves lower-depth native JXL precision during lossless re-encode', async ({
  page,
}) => {
  await page.goto('/jpeg-xl/convert/')
  await expect(page.locator('#jxl-status')).toContainText('inspected', { timeout: 30_000 })
  await page
    .locator('#jxl-file')
    .setInputFiles('benchmark/fixtures/jpegxl/generated-lossless-v0.12.0/rgb10-linear.jxl')
  await expect(page.locator('#jxl-status')).toContainText('rgb10-linear.jxl inspected')
  await page.locator('#jxl-encode').click()
  await expect(page.locator('#jxl-status')).toContainText('byte-exact local round trip verified')
  await expect(page.locator('#jxl-details')).toContainText('"bitDepth": 10')
})
