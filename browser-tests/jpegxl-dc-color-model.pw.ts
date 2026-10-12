import { expect, test } from '@playwright/test'
import { build } from 'esbuild'
import { verifyJpegXlDcColorModel } from '../tests/helpers/jpegxl-dc-color-model.ts'

test('expanded color DC selection and its bit floor agree in Node and Chromium', async ({
  page,
}) => {
  const expected = verifyJpegXlDcColorModel()
  const bundle = await build({
    entryPoints: ['tests/helpers/jpegxl-dc-color-model.ts'],
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    globalName: 'jpegxlDcColorFixture',
    target: 'es2022',
  })
  const script = bundle.outputFiles[0]?.text
  if (!script) throw new Error('DC metadata fixture bundle missing')
  await page.goto('about:blank')
  await page.addScriptTag({ content: script })
  const actual = await page.evaluate(() => {
    const namespace: unknown = Reflect.get(globalThis, 'jpegxlDcColorFixture')
    if (
      namespace === null ||
      typeof namespace !== 'object' ||
      !('verifyJpegXlDcColorModel' in namespace) ||
      typeof namespace.verifyJpegXlDcColorModel !== 'function'
    )
      throw new Error('Browser DC metadata fixture unavailable')
    return JSON.stringify(namespace.verifyJpegXlDcColorModel())
  })
  expect(actual).toBe(JSON.stringify(expected))
})
