import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

for (const depth of [8, 16] as const) {
  test(`grouped RGB${depth} palettes and color transforms decode exact samples and crops`, async ({
    page,
  }) => {
    const bytes = await readFile(`tests/fixtures/jpegxl/grouped-transforms/rgb${depth}.jxl`)
    await page.goto('/compatibility.html')
    const valid = await page.evaluate(
      async ({ input, depth }) => {
        const path = '/jpegxl-pipeline.js'
        return (await import(path)).verifyJpegXlGroupedTransforms(new Uint8Array(input), depth)
      },
      { input: Array.from(bytes), depth },
    )
    expect(valid).toBe(true)
  })
}
