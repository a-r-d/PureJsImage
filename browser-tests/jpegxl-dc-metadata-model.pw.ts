import { expect, test } from '@playwright/test'
import { build } from 'esbuild'
import { verifyJpegXlDcMetadataModel } from '../tests/helpers/jpegxl-dc-metadata-model.ts'

test('learned DC metadata selection and its bit floor agree in Node and Chromium', async ({
  page,
}) => {
  const expected = verifyJpegXlDcMetadataModel()
  const bundle = await build({
    entryPoints: ['tests/helpers/jpegxl-dc-metadata-model.ts'],
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    globalName: 'jpegxlDcMetadataFixture',
    target: 'es2022',
  })
  const script = bundle.outputFiles[0]?.text
  if (!script) throw new Error('DC metadata fixture bundle missing')
  await page.goto('about:blank')
  await page.addScriptTag({ content: script })
  const actual = await page.evaluate(() => {
    const namespace: unknown = Reflect.get(globalThis, 'jpegxlDcMetadataFixture')
    if (
      namespace === null ||
      typeof namespace !== 'object' ||
      !('verifyJpegXlDcMetadataModel' in namespace) ||
      typeof namespace.verifyJpegXlDcMetadataModel !== 'function'
    )
      throw new Error('Browser DC metadata fixture unavailable')
    return JSON.stringify(namespace.verifyJpegXlDcMetadataModel())
  })
  expect(actual).toBe(JSON.stringify(expected))
})
