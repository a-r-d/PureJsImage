import { expect, test } from '@playwright/test'
import { build } from 'esbuild'
import { verifyJpegXlFineRateMap } from '../tests/helpers/jpegxl-fine-rate-map.ts'

test('fine-quality rate-map fallback agrees in Chromium and Node', async ({ page }) => {
  const expected = await verifyJpegXlFineRateMap()
  expect(expected.publicResult.refusals).toBe(1)
  expect(expected.publicResult.samples).toBe(129 * 65 * 4)
  expect(expected.publicResult.covered).toBe(129 * 65)
  const bundle = await build({
    entryPoints: ['tests/helpers/jpegxl-fine-rate-map.ts'],
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    globalName: 'jpegxlFineMapFixture',
    target: 'es2022',
  })
  const script = bundle.outputFiles[0]?.text
  if (!script) throw new Error('Browser fine-map fixture missing')
  await page.goto('about:blank')
  await page.addScriptTag({ content: script })
  const actual = await page.evaluate(async () => {
    const namespace: unknown = Reflect.get(globalThis, 'jpegxlFineMapFixture')
    if (
      namespace === null ||
      typeof namespace !== 'object' ||
      !('verifyJpegXlFineRateMap' in namespace) ||
      typeof namespace.verifyJpegXlFineRateMap !== 'function'
    )
      throw new Error('Browser fine-map fixture unavailable')
    return JSON.stringify(await namespace.verifyJpegXlFineRateMap())
  })
  expect(JSON.parse(actual)).toEqual(expected)
})
