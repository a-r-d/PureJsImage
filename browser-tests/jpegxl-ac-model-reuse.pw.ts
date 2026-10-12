import { expect, test } from '@playwright/test'
import { build } from 'esbuild'
import { verifyAcModelReuseBrowser } from '../tests/helpers/jpegxl-ac-model-reuse.ts'

test('AC model reuse preserves progressive and family-context samples in Chromium', async ({
  page,
}) => {
  const expected = await verifyAcModelReuseBrowser()
  const bundle = await build({
    entryPoints: ['tests/helpers/jpegxl-ac-model-reuse.ts'],
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    globalName: 'jpegxlAcModelFixture',
    target: 'es2022',
  })
  const script = bundle.outputFiles[0]?.text
  if (!script) throw new Error('AC model fixture bundle missing')
  await page.goto('about:blank')
  await page.addScriptTag({ content: script })
  const actual = await page.evaluate(async () => {
    const namespace: unknown = Reflect.get(globalThis, 'jpegxlAcModelFixture')
    if (
      namespace === null ||
      typeof namespace !== 'object' ||
      !('verifyAcModelReuseBrowser' in namespace) ||
      typeof namespace.verifyAcModelReuseBrowser !== 'function'
    )
      throw new Error('Browser AC model fixture unavailable')
    return JSON.stringify(await namespace.verifyAcModelReuseBrowser())
  })
  expect(actual).toBe(JSON.stringify(expected))
})
