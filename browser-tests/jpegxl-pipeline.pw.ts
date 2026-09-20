import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import {
  runJpegXlPipelines,
  verifyFloatJpegXl,
  verifyLazyJpegXl,
  verifyLevelTenJpegXl,
  verifyM7EffortOneGroups,
  verifyM7ForwardJpegXl,
} from './jpegxl-pipeline-harness.ts'

test('Level 10 binary32 native decode and writer signaling agree with Node', async ({ page }) => {
  const input = new Uint8Array(await readFile('tests/fixtures/jpegxl/m10-level10/lossless-pfm.jxl'))
  const expected = await verifyLevelTenJpegXl(input)
  expect(expected).toMatchObject({
    samples: 750_000,
    writerKind: 'container',
    writerLevel: 10,
    groupedSamples: 1_025,
    vardctKind: 'container',
    vardctLevel: 10,
    animationKind: 'container',
    animationLevel: 10,
    animationAlpha: [0, 1],
  })
  await page.goto('/compatibility.html')
  const actual = await page.evaluate(async () => {
    const path = '/jpegxl-pipeline.js'
    const module = await import(path)
    const response = await fetch('/fixtures/jpegxl-m10-lossless-pfm.jxl')
    return module.verifyLevelTenJpegXl(new Uint8Array(await response.arrayBuffer()))
  })
  expect(actual).toEqual(expected)
})

test('VarDCT header indexing and opening defer pixels in Node and browser', async ({ page }) => {
  const input = new Uint8Array(
    await readFile(
      'benchmark/fixtures/jpegxl/generated-vardct-v0.12.0/rgb8-distance1-multi-group-progressive.jxl',
    ),
  )
  const expected = await verifyLazyJpegXl(input)
  expect(expected.headerRequestedBytes).toBe(141)
  expect(expected.frameEnds).toEqual([10_829, 148_917])
  expect(expected.openPeakBytes).toBe(0)
  expect(expected.openRequestedBytes).toBeLessThan(input.length / 4)
  expect(expected.decodeDuringOpen).toBe(false)
  expect(expected.planPixelDecode).toBe(false)
  expect(expected.managedMemory.currentLiveBytes).toBe(0)
  expect(expected.managedMemory.peakLiveBytes).toBeGreaterThan(0)
  await page.goto('/compatibility.html')
  const actual = await page.evaluate(async () => {
    const path = '/jpegxl-pipeline.js'
    const module = await import(path)
    const response = await fetch('/fixtures/jpegxl-multi-group-progressive.jxl')
    return module.verifyLazyJpegXl(new Uint8Array(await response.arrayBuffer()))
  })
  expect(actual).toEqual(expected)
})

test('native float linear-light resize and explicit output conversion agree with Node', async ({
  page,
}) => {
  const input = new Uint8Array(
    await readFile('tests/fixtures/jpegxl/m4-color/vardct-linear-12.jxl'),
  )
  const expected = await verifyFloatJpegXl(input)
  expect(expected.width).toBe(4)
  expect(expected.height).toBe(3)
  expect(expected.colorSemantics?.transfer.kind).toBe('linear')
  await page.goto('/compatibility.html')
  const actual = await page.evaluate(async () => {
    const path = '/jpegxl-pipeline.js'
    const module = await import(path)
    const response = await fetch('/fixtures/jpegxl-m4-vardct-linear-12.jxl')
    return module.verifyFloatJpegXl(new Uint8Array(await response.arrayBuffer()))
  })
  expect(actual).toEqual(expected)
})

test('JPEG XL M5 output workflows agree with Node for all fits, color, depth and alpha', async ({
  page,
}) => {
  const expected = await runJpegXlPipelines(
    async (name) => new Uint8Array(await readFile(`tests/fixtures/jpegxl/m4-color/${name}`)),
  )
  expect(expected).toHaveLength(105)
  await page.goto('/compatibility.html')
  const actual = await page.evaluate(async () => {
    const path = '/jpegxl-pipeline.js'
    const module = await import(path)
    return module.runJpegXlPipelines()
  })
  expect(actual).toEqual(expected)
})

for (const id of ['srgb-12', 'p3-8', 'pq-10', 'vardct-linear-12']) {
  test(`workbench opens, inspects, resizes and exports ${id}`, async ({ page }) => {
    await page.goto('/jpeg-xl/')
    await expect(page.locator('#jxl-status')).toContainText('inspected and decoded locally')
    await page.locator('#jxl-file').setInputFiles(`tests/fixtures/jpegxl/m4-color/${id}.jxl`)
    await expect(page.locator('#jxl-status')).toContainText(
      `${id}.jxl inspected and decoded locally`,
    )
    await page.locator('#jxl-width').fill('4')
    await page.locator('#jxl-height').fill('3')
    await page.locator('#jxl-transform').click()
    await expect(page.locator('#jxl-status')).toContainText('Image resized and exported locally')
    await expect(page.locator('#jxl-preview')).toHaveAttribute('width', '4')
    await expect(page.locator('#jxl-preview')).toHaveAttribute('height', '3')
    const download = page.waitForEvent('download')
    await page.locator('#jxl-download').click()
    expect((await download).suggestedFilename()).toBe(`${id}-resized.png`)
  })
}

test('segmented jxlp complete workflow agrees over real HTTP Range in Node and browser', async ({
  page,
  baseURL,
}) => {
  const { verifyRemoteJpegXl } = await import('./jpegxl-pipeline-harness.ts')
  const url = new URL('/fixtures/jpegxl-m5-segmented.jxl', baseURL).href
  const expected = await verifyRemoteJpegXl(url)
  await page.goto('/compatibility.html')
  const actual = await page.evaluate(async (url) => {
    const path = '/jpegxl-pipeline.js'
    const module = await import(path)
    return module.verifyRemoteJpegXl(url)
  }, url)
  expect(actual.values).toEqual(expected.values)
  const source = await readFile('tests/fixtures/jpegxl/m4-color/srgb-12.bin')
  const pixel = [0, 1, 2].map((c) =>
    Math.round((source.readUInt16BE(((7 + 2) * 3 + c) * 2) * 255) / 4095),
  )
  expect(actual.values).toEqual(Array.from({ length: 4 }, () => pixel).flat())
})

test('HDR storage metadata and gray-alpha regression workflows agree with Node', async ({
  page,
}) => {
  const { verifyJpegXlRemediation } = await import('./jpegxl-pipeline-harness.ts')
  const expected = await verifyJpegXlRemediation(
    async (id) => new Uint8Array(await readFile(`tests/fixtures/jpegxl/remediation/${id}.jxl`)),
  )
  expect(expected).toHaveLength(8)
  expect(expected[0]?.toneMapping).toEqual({
    intensityTarget: 2000,
    minNits: 0.125,
    relativeToMaxDisplay: true,
    linearBelow: 0.25,
  })
  await page.goto('/compatibility.html')
  const actual = await page.evaluate(async () => {
    const path = '/jpegxl-pipeline.js'
    const module = await import(path)
    return module.verifyJpegXlRemediation()
  })
  expect(actual).toEqual(expected)
})

test('encoder budget admission and cleanup match Node in a real browser', async ({ page }) => {
  const { verifyJpegXlEncoderBudgets } = await import('./jpegxl-pipeline-harness.ts')
  const expected = await verifyJpegXlEncoderBudgets()
  expect(expected).toHaveLength(12)
  for (let index = 2; index < 12; index += 3)
    expect(expected[index]).toMatchObject({
      bytes: 0,
      live: 0,
      allocations: 0,
      errorCode: 'LIMIT_EXCEEDED',
    })
  await page.goto('/compatibility.html')
  const actual = await page.evaluate(async () => {
    const path = '/jpegxl-pipeline.js'
    return (await import(path)).verifyJpegXlEncoderBudgets()
  })
  expect(actual).toEqual(expected)
})

test('copied JPEG XL display recipes preserve pixels, alpha and orientation in the browser', async ({
  page,
}) => {
  const { verifyJpegXlDisplayRecipes } = await import('./jpegxl-pipeline-harness.ts')
  const expected = await verifyJpegXlDisplayRecipes(
    async (group, id) =>
      new Uint8Array(
        await readFile(`tests/fixtures/jpegxl/${group === 'm4' ? 'm4-color' : group}/${id}.jxl`),
      ),
  )
  expect(expected).toHaveLength(10)
  for (const result of expected) expect(result.bitDepth).toBe(8)
  await page.goto('/compatibility.html')
  const actual = await page.evaluate(async () => {
    const path = '/jpegxl-pipeline.js'
    return (await import(path)).verifyJpegXlDisplayRecipes()
  })
  expect(actual).toEqual(expected)
})

test('progressive stages, viewport selection, cache reuse and timer cancellation match Node', async ({
  page,
}) => {
  const { verifyProgressiveJpegXl } = await import('./jpegxl-pipeline-harness.ts')
  const expected = await verifyProgressiveJpegXl(
    new Uint8Array(
      await readFile(
        'benchmark/fixtures/jpegxl/generated-vardct-v0.12.0/rgb8-distance1-multi-group-progressive.jxl',
      ),
    ),
  )
  expect(expected.reused).toBe(true)
  expect(expected.cancelled).toBe(true)
  expect(expected.liveBytes).toBe(0)
  expect(expected.stages.map((stage) => stage.kind)).toEqual(['dc', 'pass', 'pass', 'final'])
  await page.goto('/compatibility.html')
  const actual = await page.evaluate(async () => {
    const modulePath = '/jpegxl-pipeline.js'
    const module = await import(modulePath)
    const response = await fetch('/fixtures/jpegxl-multi-group-progressive.jxl')
    return module.verifyProgressiveJpegXl(new Uint8Array(await response.arrayBuffer()))
  })
  expect(actual).toEqual(expected)
})

test('Range explorer shows stages, byte counters and cached viewport reuse', async ({ page }) => {
  await page.goto('/jpeg-xl/')
  await page.locator('#jxl-progressive-url').fill('/fixtures/jpegxl-multi-group-progressive.jxl')
  await page.locator('#jxl-run-native').click()
  await expect(page.locator('#jxl-progressive-status')).toContainText('dc complete')
  const first = await page.locator('#jxl-progressive-metrics').textContent()
  expect(first).toContain('physicalReadBytes')
  const firstMetrics: unknown = JSON.parse(first ?? '{}')
  if (
    typeof firstMetrics !== 'object' ||
    firstMetrics === null ||
    !('physicalReadBytes' in firstMetrics) ||
    typeof firstMetrics.physicalReadBytes !== 'number'
  )
    throw new Error('Missing physical read measurement')
  expect(firstMetrics.physicalReadBytes).toBeLessThan(148_917 / 4)
  await page.locator('#jxl-run-native').click()
  await expect(page.locator('#jxl-progressive-status')).toContainText('dc complete')
  const repeated: unknown = JSON.parse(
    (await page.locator('#jxl-progressive-metrics').textContent()) ?? '{}',
  )
  if (typeof repeated !== 'object' || repeated === null || !('physicalReadBytes' in repeated))
    throw new Error('Missing repeated measurement')
  expect(repeated.physicalReadBytes).toBe(firstMetrics.physicalReadBytes)
  await page.locator('#jxl-run-viewport').click()
  // This action reconstructs all four stages; shared CI runners can exceed the
  // default five-second assertion budget while still making valid progress.
  await expect(page.locator('#jxl-progressive-status')).toContainText('final complete', {
    timeout: 30_000,
  })
  await expect(page.locator('#jxl-progressive-canvas')).toHaveAttribute('width', '16')
})

test('an independent embedded preview remains visible when a requested native stage is unavailable', async ({
  page,
}) => {
  await page.goto('/jpeg-xl/')
  await page
    .locator('#jxl-progressive-file')
    .setInputFiles('tests/fixtures/jpegxl/m6-preview-modular/embedded-preview.jxl')
  await page.locator('#jxl-run-native').click()
  await expect(page.locator('#jxl-progressive-status')).toContainText(
    'cannot substitute final output',
  )
  await expect(page.locator('#jxl-progressive-canvas')).toHaveAttribute('width', '333')
  await expect(page.locator('#jxl-progressive-canvas')).toHaveAttribute('height', '77')
  await expect(page.locator('#jxl-progressive-metrics')).toContainText('embedded-preview')
  await page.locator('#jxl-run-progressive').click()
  await expect(page.locator('#jxl-progressive-status')).toContainText('final complete')
  await expect(page.locator('#jxl-progressive-canvas')).toHaveAttribute('width', '1')
})

test('M7 lossy and progressive re-encode preserve Node/browser color and precision behavior', async ({
  page,
}) => {
  const expected = await verifyM7ForwardJpegXl(
    async (name) => new Uint8Array(await readFile(`tests/fixtures/jpegxl/m4-color/${name}`)),
  )
  await page.goto('/compatibility.html')
  const actual: typeof expected = await page.evaluate(async () => {
    const path = '/jpegxl-pipeline.js'
    const module = await import(path)
    return module.verifyM7ForwardJpegXl()
  })
  expect(actual).toHaveLength(expected.length)
  for (let index = 0; index < expected.length; index++) {
    const reference = expected[index],
      result = actual[index]
    if (!reference || !result) throw new Error('Missing forward browser result')
    expect({ id: result.id, progressive: result.progressive, format: result.format }).toEqual({
      id: reference.id,
      progressive: reference.progressive,
      format: reference.format,
    })
    expect(result.samples).toHaveLength(reference.samples.length)
    for (let sample = 0; sample < reference.samples.length; sample++)
      expect(
        Math.abs((result.samples[sample] ?? 0) - (reference.samples[sample] ?? 0)),
      ).toBeLessThanOrEqual(reference.format.endsWith('f32') ? 1e-5 : 1)
  }
})

test('M7 effort-1 group entropy preserves portable pixels and size bounds', async ({ page }) => {
  const expected = await verifyM7EffortOneGroups()
  await page.goto('/compatibility.html')
  const actual: typeof expected = await page.evaluate(async () => {
    const path = '/jpegxl-pipeline.js'
    const module = await import(path)
    return module.verifyM7EffortOneGroups()
  })
  expect(actual).toHaveLength(3)
  for (let index = 0; index < expected.length; index++) {
    const reference = expected[index],
      result = actual[index]
    if (!reference || !result) throw new Error('Missing grouped output')
    expect(result.kind).toBe(reference.kind)
    expect(result.bytes).toBeLessThanOrEqual(
      result.kind === 'flat' ? 1736 : result.kind === 'dc-only' ? 8793 : 189405,
    )
    expect(result.samples).toHaveLength(reference.samples.length)
    let maximum = 0
    for (let sample = 0; sample < reference.samples.length; sample++)
      maximum = Math.max(
        maximum,
        Math.abs((result.samples[sample] ?? 0) - (reference.samples[sample] ?? 0)),
      )
    expect(maximum).toBeLessThanOrEqual(1)
  }
})

for (const [width, height] of [
  [1025, 17],
  [1, 1031],
] as const) {
  test(`M7 scalar palettes preserve independently verified RGB16 ${width}x${height}`, async ({
    page,
  }) => {
    const expected = await readFile(
      `tests/fixtures/jpegxl/m7-scalar-palettes/${width}x${height}.jxl`,
    )
    await page.goto('/compatibility.html')
    const actual = await page.evaluate(
      async ({ width, height }) => {
        const path = '/jpegxl-pipeline.js'
        const module = await import(path)
        return module.verifyM7ScalarPalettes(width, height)
      },
      { width, height },
    )
    expect(actual).toEqual(Array.from(expected))
  })
}
