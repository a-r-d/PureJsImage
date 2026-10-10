import { expect, test } from '@playwright/test'
import { build } from 'esbuild'
import { verifyJpegXlLargeBlocks } from '../tests/helpers/jpegxl-large-blocks.ts'

for (const [width, height] of [
  [2065, 17],
  [17, 2065],
] as const)
  test(`thin ${width}x${height} keeps color and alpha bounds in Chromium and Node`, async ({
    page,
  }) => {
    const expected = await verifyJpegXlLargeBlocks(width, height)
    expect(expected.meanColorError).toBeLessThan(1.5)
    expect(expected.alphaError).toBe(0)
    expect(expected.samples).toBe(width * height * 3)
    const bundle = await build({
      entryPoints: ['tests/helpers/jpegxl-large-blocks.ts'],
      bundle: true,
      write: false,
      platform: 'browser',
      format: 'iife',
      globalName: 'jpegxlThinFixture',
      target: 'es2022',
    })
    const script = bundle.outputFiles[0]?.text
    if (!script) throw new Error('Browser thin fixture missing')
    await page.goto('about:blank')
    await page.addScriptTag({ content: script })
    const actual = await page.evaluate(
      async ({ width, height }) => {
        const namespace: unknown = Reflect.get(globalThis, 'jpegxlThinFixture')
        if (
          namespace === null ||
          typeof namespace !== 'object' ||
          !('verifyJpegXlLargeBlocks' in namespace) ||
          typeof namespace.verifyJpegXlLargeBlocks !== 'function'
        )
          throw new Error('Browser thin fixture unavailable')
        return JSON.stringify(await namespace.verifyJpegXlLargeBlocks(width, height))
      },
      { width, height },
    )
    expect(JSON.parse(actual)).toEqual(expected)
  })
