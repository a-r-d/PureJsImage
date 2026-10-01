import { readFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { expect, test } from '@playwright/test'
import composed from '../tests/fixtures/jpegxl/composed-native/manifest.json' with { type: 'json' }
import manifest from '../tests/fixtures/jpegxl/float-completion/manifest.json' with { type: 'json' }

for (const [directory, fixtures] of [
  ['float-completion', manifest.fixtures],
  ['composed-native', composed.fixtures],
] as const)
  for (const fixture of fixtures)
    test(`JPEG XL float completion ${fixture.id}`, async ({ page }) => {
      const root = new URL(`../tests/fixtures/jpegxl/${directory}/`, import.meta.url)
      await page.route('**/completion-input.jxl', async (route) =>
        route.fulfill({
          contentType: 'image/jxl',
          body: await readFile(new URL(fixture.file, root)),
        }),
      )
      await page.route('**/completion-reference.bin', async (route) =>
        route.fulfill({
          contentType: 'application/octet-stream',
          body: gunzipSync(await readFile(new URL(`${fixture.id}.bin.gz`, root))),
        }),
      )
      if (fixture.category === 'hdr')
        await page.route('**/completion-linear.bin', async (route) =>
          route.fulfill({
            contentType: 'application/octet-stream',
            body: gunzipSync(await readFile(new URL(`${fixture.id}.linear.bin.gz`, root))),
          }),
        )
      await page.goto('/compatibility.html')
      const result = await page.evaluate(async (definition) => {
        const path = '/jpegxl-color.js',
          module = await import(path)
        const input = new Uint8Array(await (await fetch('/completion-input.jxl')).arrayBuffer())
        const reference = new Uint8Array(
          await (await fetch('/completion-reference.bin')).arrayBuffer(),
        )
        const linear =
          definition.category === 'hdr'
            ? new Uint8Array(await (await fetch('/completion-linear.bin')).arrayBuffer())
            : undefined
        return module.verifyJpegXlFloatCompletion(input, reference, definition, linear)
      }, fixture)
      expect(result.maximumColor).toBeLessThanOrEqual(fixture.colorTolerance)
      expect(result.maximumAlpha).toBeLessThanOrEqual(
        fixture.format.endsWith('f32') ? 0.000002 : fixture.category === 'cmyk' ? 1 : 0,
      )
    })
