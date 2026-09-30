import { readFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { expect, test } from '@playwright/test'
import manifest from '../tests/fixtures/jpegxl/profile-pipeline/manifest.json' with { type: 'json' }

const root = new URL('../tests/fixtures/jpegxl/profile-pipeline/', import.meta.url)
for (const fixture of manifest.fixtures)
  test(`JPEG XL ordinary ${fixture.id} profile conversion`, async ({ page }) => {
    await page.route('**/profile-input.jxl', async (route) =>
      route.fulfill({
        contentType: 'image/jxl',
        body: await readFile(new URL(`${fixture.id}.jxl`, root)),
      }),
    )
    await page.route('**/profile-reference.bin', async (route) =>
      route.fulfill({
        contentType: 'application/octet-stream',
        body: gunzipSync(await readFile(new URL(`${fixture.id}.bin.gz`, root))),
      }),
    )
    await page.goto('/compatibility.html')
    const result = await page.evaluate(async (definition) => {
      const path = '/jpegxl-color.js'
      const module = await import(path)
      const input = new Uint8Array(await (await fetch('/profile-input.jxl')).arrayBuffer())
      const reference = new Uint8Array(await (await fetch('/profile-reference.bin')).arrayBuffer())
      return module.verifyJpegXlProfilePipeline(input, reference, definition)
    }, fixture)
    expect(result.maximumColor).toBeLessThanOrEqual(fixture.colorTolerance)
    expect(result.maximumAlpha).toBe(0)
  })
for (const id of ['gray16-adjacent', 'rgb16'])
  test(`JPEG XL preserves ${id} ICC and samples into PNG`, async ({ page }) => {
    await page.route('**/profile-input.jxl', async (route) =>
      route.fulfill({ contentType: 'image/jxl', body: await readFile(new URL(`${id}.jxl`, root)) }),
    )
    await page.goto('/compatibility.html')
    expect(
      await page.evaluate(async () => {
        const path = '/jpegxl-color.js'
        const input = new Uint8Array(await (await fetch('/profile-input.jxl')).arrayBuffer())
        return (await import(path)).verifyJpegXlProfilePreservation(input)
      }),
    ).toBe(true)
  })
