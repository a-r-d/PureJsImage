import { expect, test } from '@playwright/test'
import { build } from 'esbuild'
import { verifyAnsHeaderModels } from '../tests/helpers/jpegxl-ans-header.ts'

test('JPEG XL cost-only ANS headers preserve Node and browser results', async ({ page }) => {
  const expected = verifyAnsHeaderModels()
  const bundle = await build({
    entryPoints: ['tests/helpers/jpegxl-ans-header.ts'],
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    globalName: 'jpegxlAnsHeaderFixture',
    target: 'es2022',
  })
  const script = bundle.outputFiles[0]?.text
  if (!script) throw new Error('Missing ANS header fixture')
  await page.goto('about:blank')
  await page.addScriptTag({ content: script })
  const actual = await page.evaluate(() => {
    const namespace: unknown = Reflect.get(globalThis, 'jpegxlAnsHeaderFixture')
    if (
      namespace === null ||
      typeof namespace !== 'object' ||
      !('verifyAnsHeaderModels' in namespace) ||
      typeof namespace.verifyAnsHeaderModels !== 'function'
    )
      throw new Error('Missing ANS header fixture')
    return JSON.stringify(namespace.verifyAnsHeaderModels())
  })
  expect(actual).toBe(JSON.stringify(expected))
})
