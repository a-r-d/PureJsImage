import { readFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { expect, test } from '@playwright/test'
import manifest from '../tests/fixtures/jpegxl/modular-dc-alpha/manifest.json' with { type: 'json' }

const root = new URL('../tests/fixtures/jpegxl/modular-dc-alpha/', import.meta.url)
for (const fixture of manifest.fixtures)
  test(`JPEG XL ${fixture.id} Modular DC alpha matches independent pixels`, async ({ page }) => {
    const input = await readFile(new URL(fixture.file, root))
    const reference = gunzipSync(await readFile(new URL(`${fixture.id}.rgba.gz`, root)))
    await page.route('**/dc-alpha-input', (route) => route.fulfill({ body: input }))
    await page.route('**/dc-alpha-reference', (route) => route.fulfill({ body: reference }))
    await page.goto('/compatibility.html')
    const result = await page.evaluate(async (fixture) => {
      const path = '/jpegxl-pipeline.js'
      const { verifyJpegXlModularDcAlpha } = await import(path)
      return verifyJpegXlModularDcAlpha(
        new Uint8Array(await (await fetch('/dc-alpha-input')).arrayBuffer()),
        new Uint8Array(await (await fetch('/dc-alpha-reference')).arrayBuffer()),
        fixture.width,
        fixture.height,
      )
    }, fixture)
    expect(result.maximumColor).toBeLessThanOrEqual(manifest.tolerance.color)
    expect(result.maximumAlpha).toBe(manifest.tolerance.alpha)
    expect(result.rows).toBe(fixture.height)
  })
