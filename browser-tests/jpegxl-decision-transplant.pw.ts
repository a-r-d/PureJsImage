import { expect, test } from '@playwright/test'
import { build } from 'esbuild'
import { verifyDecisionTransplantBrowser } from '../tests/helpers/jpegxl-decision-transplant.ts'

test('development decision forcing preserves Node/browser decoded rows', async ({ page }) => {
  const expected = await verifyDecisionTransplantBrowser()
  const bundle = await build({
    entryPoints: ['tests/helpers/jpegxl-decision-transplant.ts'],
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    globalName: 'jpegxlTransplantFixture',
    target: 'es2022',
  })
  const script = bundle.outputFiles[0]?.text
  if (!script) throw new Error('Missing transplant fixture')
  await page.goto('about:blank')
  await page.addScriptTag({ content: script })
  const actual = await page.evaluate(async () => {
    const namespace: unknown = Reflect.get(globalThis, 'jpegxlTransplantFixture')
    if (
      namespace === null ||
      typeof namespace !== 'object' ||
      !('verifyDecisionTransplantBrowser' in namespace) ||
      typeof namespace.verifyDecisionTransplantBrowser !== 'function'
    )
      throw new Error('Missing browser transplant fixture')
    return JSON.stringify(await namespace.verifyDecisionTransplantBrowser())
  })
  expect(actual).toBe(JSON.stringify(expected))
})
