import { readFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { expect, test } from '@playwright/test'
import manifest from '../tests/fixtures/jpegxl/structured-pipeline/manifest.json' with {
  type: 'json',
}

const root = new URL('../tests/fixtures/jpegxl/structured-pipeline/', import.meta.url)
for (const fixture of manifest.fixtures)
  test(`JPEG XL ordinary ${fixture.id} structured conversion`, async ({ page }) => {
    await page.route('**/structured-input.jxl', async (route) =>
      route.fulfill({
        contentType: 'image/jxl',
        body: await readFile(new URL(fixture.file, root)),
      }),
    )
    await page.route('**/structured-reference.bin', async (route) =>
      route.fulfill({
        contentType: 'application/octet-stream',
        body: gunzipSync(await readFile(new URL(`${fixture.id}.bin.gz`, root))),
      }),
    )
    await page.goto('/compatibility.html')
    const result = await page.evaluate(async (definition) => {
      const path = '/jpegxl-color.js'
      const module = await import(path)
      const input = new Uint8Array(await (await fetch('/structured-input.jxl')).arrayBuffer())
      const reference = new Uint8Array(
        await (await fetch('/structured-reference.bin')).arrayBuffer(),
      )
      return module.verifyJpegXlProfilePipeline(input, reference, definition, false)
    }, fixture)
    expect(result.maximumColor).toBeLessThanOrEqual(fixture.colorTolerance)
    expect(result.maximumAlpha).toBe(0)
  })
