import { readFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { expect, test } from '@playwright/test'
import manifest from '../tests/fixtures/jpegxl/grouped-alpha/manifest.json' with { type: 'json' }

const root = new URL('../tests/fixtures/jpegxl/grouped-alpha/', import.meta.url)
for (const fixture of manifest.fixtures)
  test(`JPEG XL grouped ${fixture.id} alpha matches its independent reference at every stage`, async ({
    page,
  }) => {
    const input = await readFile(new URL(fixture.file, root))
    const reference = gunzipSync(await readFile(new URL(`${fixture.id}.rgba.gz`, root)))
    await page.route('**/grouped-alpha-input', (route) => route.fulfill({ body: input }))
    await page.route('**/grouped-alpha-reference', (route) => route.fulfill({ body: reference }))
    await page.goto('/compatibility.html')
    const result = await page.evaluate(async (fixture) => {
      const path = '/jpegxl-pipeline.js'
      const { verifyJpegXlGroupedAlpha } = await import(path)
      const input = new Uint8Array(await (await fetch('/grouped-alpha-input')).arrayBuffer())
      const reference = new Uint8Array(
        await (await fetch('/grouped-alpha-reference')).arrayBuffer(),
      )
      return verifyJpegXlGroupedAlpha(
        input,
        reference,
        fixture.width,
        fixture.height,
        fixture.format,
        fixture.referenceColorScale,
      )
    }, fixture)
    expect(result.maximumColor).toBeLessThanOrEqual(
      fixture.format === 'rgba8'
        ? 1 / 255 + 1e-12
        : fixture.format === 'rgba16'
          ? 4 / 65_535
          : 0.00012,
    )
    expect(result.maximumAlpha).toBeLessThanOrEqual(fixture.format === 'rgbaf32' ? 0.000001 : 0)
    expect(result.maximumViewport).toBeLessThanOrEqual(
      fixture.format === 'rgba8'
        ? 1 / 255 + 1e-12
        : fixture.format === 'rgba16'
          ? 1 / 65_535 + 1e-12
          : 0.000001,
    )
  })
