import { expect, test } from '@playwright/test'
import { build } from 'esbuild'
import { verifyJpegXlInputColor } from '../tests/helpers/jpegxl-untagged-input.ts'

test('untagged, ICC-tagged, oriented and float input encode to the same JPEG XL bytes in Node and the browser', async ({
  page,
}) => {
  const expected = await verifyJpegXlInputColor()
  const bundle = await build({
    entryPoints: ['tests/helpers/jpegxl-untagged-input.ts'],
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    globalName: 'jpegxlUntaggedFixture',
    target: 'es2022',
  })
  const script = bundle.outputFiles[0]?.text
  if (!script) throw new Error('JPEG XL untagged-input fixture bundle missing')
  await page.goto('about:blank')
  await page.addScriptTag({ content: script })
  const actual = await page.evaluate(async () => {
    const namespace: unknown = Reflect.get(globalThis, 'jpegxlUntaggedFixture')
    if (
      namespace === null ||
      typeof namespace !== 'object' ||
      !('verifyJpegXlInputColor' in namespace) ||
      typeof namespace.verifyJpegXlInputColor !== 'function'
    )
      throw new Error('Browser JPEG XL untagged-input fixture unavailable')
    return JSON.stringify(await namespace.verifyJpegXlInputColor())
  })
  expect(actual).toBe(JSON.stringify(expected))
  expect(expected).toHaveLength(15)
})
