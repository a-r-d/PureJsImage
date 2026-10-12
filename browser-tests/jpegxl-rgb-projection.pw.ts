import { expect, test } from '@playwright/test'
import { build } from 'esbuild'
import { verifyJpegXlRgbProjection } from '../tests/helpers/jpegxl-rgb-projection.ts'

test('bounded RGB projection agrees in the browser and Node', async ({ page }) => {
  const expected = await verifyJpegXlRgbProjection()
  const bundle = await build({
    entryPoints: ['tests/helpers/jpegxl-rgb-projection.ts'],
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    globalName: 'jpegxlProjectionFixture',
    target: 'es2022',
  })
  const script = bundle.outputFiles[0]?.text
  if (!script) throw new Error('Projection browser fixture missing')
  await page.goto('about:blank')
  await page.addScriptTag({ content: script })
  const actual = await page.evaluate(async () => {
    const namespace: unknown = Reflect.get(globalThis, 'jpegxlProjectionFixture')
    if (
      namespace === null ||
      typeof namespace !== 'object' ||
      !('verifyJpegXlRgbProjection' in namespace) ||
      typeof namespace.verifyJpegXlRgbProjection !== 'function'
    )
      throw new Error('Browser projection fixture unavailable')
    return JSON.stringify(await namespace.verifyJpegXlRgbProjection())
  })
  expect(actual).toBe(JSON.stringify(expected))
})
