import { expect, test } from '@playwright/test'
import { build } from 'esbuild'
import { verifyEffort9Browser } from '../tests/helpers/jpegxl-effort9.ts'

test('effort 9 preserves grayscale, alpha, progressive and thin output in Chromium', async ({
  page,
}) => {
  const expected = await verifyEffort9Browser()
  const bundle = await build({
    entryPoints: ['tests/helpers/jpegxl-effort9.ts'],
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    globalName: 'jpegxlEffortFixture',
    target: 'es2022',
  })
  const script = bundle.outputFiles[0]?.text
  if (!script) throw new Error('Effort fixture bundle missing')
  await page.goto('about:blank')
  await page.addScriptTag({ content: script })
  const actual = await page.evaluate(async () => {
    const namespace: unknown = Reflect.get(globalThis, 'jpegxlEffortFixture')
    if (
      namespace === null ||
      typeof namespace !== 'object' ||
      !('verifyEffort9Browser' in namespace) ||
      typeof namespace.verifyEffort9Browser !== 'function'
    )
      throw new Error('Browser effort fixture unavailable')
    return JSON.stringify(await namespace.verifyEffort9Browser())
  })
  expect(actual).toBe(JSON.stringify(expected))
})
