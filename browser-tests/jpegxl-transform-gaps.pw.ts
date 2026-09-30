import { readFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { expect, test } from '@playwright/test'
import modular from '../tests/fixtures/jpegxl/global-modular/manifest.json' with { type: 'json' }
import vardct from '../tests/fixtures/jpegxl/transform-gaps/manifest.json' with { type: 'json' }

const cases = [
  ...vardct.fixtures.map((fixture) => ({
    id: `strategy-${fixture.strategy}`,
    directory: 'transform-gaps',
    bytesPerPixel: 3,
    maximum: 1,
  })),
  ...modular.fixtures.map((fixture) => ({
    id: fixture.id,
    directory: 'global-modular',
    bytesPerPixel: (3 * fixture.bitDepth) / 8,
    maximum: 0,
  })),
]
for (const fixture of cases) {
  test(`JPEG XL ${fixture.id} matches independent pixels and cross-group crops`, async ({
    page,
  }) => {
    const base = `tests/fixtures/jpegxl/${fixture.directory}/${fixture.id}`
    const input = await readFile(`${base}.jxl`)
    const reference = gunzipSync(await readFile(`${base}.rgb.gz`))
    await page.goto('/compatibility.html')
    const result = await page.evaluate(
      async ({ input, reference, bytesPerPixel }) => {
        const path = '/jpegxl-pipeline.js'
        return (await import(path)).verifyJpegXlTransformFixture(
          new Uint8Array(input),
          new Uint8Array(reference),
          513,
          259,
          bytesPerPixel,
        )
      },
      {
        input: Array.from(input),
        reference: Array.from(reference),
        bytesPerPixel: fixture.bytesPerPixel,
      },
    )
    expect(result.maximum).toBeLessThanOrEqual(fixture.maximum)
    expect(result.rmse).toBeLessThanOrEqual(fixture.maximum === 0 ? 0 : 0.55)
    expect(result.imageKind).toBe('static')
    expect(result.unsupportedFeatures).not.toContain('Level 10 pixel decode')
    if (fixture.directory === 'global-modular')
      expect(result.fallback).toBe(fixture.id.startsWith('squeeze'))
  })
}
