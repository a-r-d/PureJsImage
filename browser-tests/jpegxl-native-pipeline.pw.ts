import { readFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { expect, test } from '@playwright/test'
import cmyk from '../tests/fixtures/jpegxl/cmyk-pipeline/manifest.json' with { type: 'json' }
import floats from '../tests/fixtures/jpegxl/practical-float/manifest.json' with { type: 'json' }

const root = new URL('../tests/fixtures/jpegxl/', import.meta.url)
for (const fixture of floats.manifest)
  test(`JPEG XL ordinary float ${fixture.name}`, async ({ page }) => {
    await page.route('**/native-input.jxl', async (route) =>
      route.fulfill({
        contentType: 'image/jxl',
        body: await readFile(new URL(`practical-float/${fixture.name}.jxl`, root)),
      }),
    )
    await page.goto('/compatibility.html')
    expect(
      await page.evaluate(async (definition) => {
        const path = '/jpegxl-color.js',
          module = await import(path)
        const bytes = new Uint8Array(await (await fetch('/native-input.jxl')).arrayBuffer())
        return module.verifyJpegXlFloatPipeline(bytes, definition)
      }, fixture),
    ).toBeLessThanOrEqual(1)
  })
for (const fixture of cmyk.fixtures)
  test(`JPEG XL ordinary CMYK ${fixture.id}`, async ({ page }) => {
    await page.route('**/native-input.jxl', async (route) =>
      route.fulfill({
        contentType: 'image/jxl',
        body: await readFile(new URL(`cmyk-pipeline/${fixture.id}.jxl`, root)),
      }),
    )
    await page.route('**/native-reference.bin', async (route) =>
      route.fulfill({
        contentType: 'application/octet-stream',
        body: gunzipSync(await readFile(new URL(`cmyk-pipeline/${fixture.id}.bin.gz`, root))),
      }),
    )
    await page.goto('/compatibility.html')
    const result = await page.evaluate(async (definition) => {
      const path = '/jpegxl-color.js',
        module = await import(path)
      const bytes = new Uint8Array(await (await fetch('/native-input.jxl')).arrayBuffer())
      const reference = new Uint8Array(await (await fetch('/native-reference.bin')).arrayBuffer())
      return module.verifyJpegXlProfilePipeline(bytes, reference, definition)
    }, fixture)
    expect(result.maximumColor).toBeLessThanOrEqual(fixture.colorTolerance)
    expect(result.maximumAlpha).toBe(0)
  })
