import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import alphaFixtures from '../tests/fixtures/jpegxl/gap-alpha/manifest.json' with { type: 'json' }

for (const fixture of alphaFixtures.fixtures)
  test(`JPEG XL mixed VarDCT ${fixture.id}`, async ({ page }) => {
    await page.route('**/gap-alpha.jxl', async (route) =>
      route.fulfill({
        contentType: 'image/jxl',
        body: await readFile(`tests/fixtures/jpegxl/gap-alpha/${fixture.file}`),
      }),
    )
    await page.route('**/gap-alpha.bin', async (route) =>
      route.fulfill({
        contentType: 'application/octet-stream',
        body: gunzipSync(await readFile(`tests/fixtures/jpegxl/gap-alpha/${fixture.id}.bin.gz`)),
      }),
    )
    await page.goto('/compatibility.html')
    const result = await page.evaluate(async () => {
      const path = '/jpegxl-color.js'
      const module: {
        verifyJpegXlVarDctFloatAlpha: (
          input: Uint8Array,
          reference: Uint8Array,
        ) => Promise<{ maximumColor: number; maximumAlpha: number }>
      } = await import(path)
      const input = new Uint8Array(await (await fetch('/gap-alpha.jxl')).arrayBuffer())
      const reference = new Uint8Array(await (await fetch('/gap-alpha.bin')).arrayBuffer())
      return module.verifyJpegXlVarDctFloatAlpha(input, reference)
    })
    expect(result.maximumColor).toBeLessThanOrEqual(1 / 255)
    expect(result.maximumAlpha).toBeLessThanOrEqual(fixture.blend ? 1.2e-7 : 0)
  })

test('JPEG XL mixed floating alpha and wider native integers', async ({ page }) => {
  await page.goto('/compatibility.html')
  const count = await page.evaluate(async () => {
    const path = '/jpegxl-color.js'
    const module: { verifyJpegXlSampleGaps: () => Promise<number> } = await import(path)
    return module.verifyJpegXlSampleGaps()
  })
  expect(count).toBe(24)
})
test('JPEG XL custom floats and legacy LUT ICC conversion', async ({ page }) => {
  await page.goto('/compatibility.html')
  const count = await page.evaluate(async () => {
    const path = '/jpegxl-color.js'
    const module: { verifyJpegXlExtendedColorGaps: () => Promise<number> } = await import(path)
    return module.verifyJpegXlExtendedColorGaps()
  })
  expect(count).toBe(4)
})
test('JPEG XL float animation writing and HDR animation rendering', async ({ page }) => {
  await page.goto('/compatibility.html')
  const count = await page.evaluate(async () => {
    const path = '/jpegxl-color.js'
    const module: { verifyJpegXlAnimationGaps: () => Promise<number> } = await import(path)
    return module.verifyJpegXlAnimationGaps()
  })
  expect(count).toBe(6)
})
