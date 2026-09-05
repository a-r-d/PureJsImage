import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { runJpegXlPipelines, verifyFloatJpegXl } from './jpegxl-pipeline-harness.ts'

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
