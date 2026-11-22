import { expect, test } from '@playwright/test'
import { build } from 'esbuild'
import { verifyPolicyPhoto } from '../tests/helpers/jpegxl-libjxl-policy.ts'

test('the libjxl-derived effort-7 photo stream agrees in Node and the browser', async ({
  page,
}) => {
  // Distance 1 keeps Gaborish off; distance 2 signals custom half-strength Gaborish weights.
  const expected = [await verifyPolicyPhoto(1), await verifyPolicyPhoto(2)]
  const bundle = await build({
    entryPoints: ['tests/helpers/jpegxl-libjxl-policy.ts'],
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    globalName: 'jpegxlPolicyFixture',
    target: 'es2022',
  })
  const script = bundle.outputFiles[0]?.text
  if (!script) throw new Error('JPEG XL policy fixture bundle missing')
  await page.goto('about:blank')
  await page.addScriptTag({ content: script })
  const actual = await page.evaluate(async () => {
    const namespace: unknown = Reflect.get(globalThis, 'jpegxlPolicyFixture')
    if (
      namespace === null ||
      typeof namespace !== 'object' ||
      !('verifyPolicyPhoto' in namespace) ||
      typeof namespace.verifyPolicyPhoto !== 'function'
    )
      throw new Error('Browser JPEG XL policy fixture unavailable')
    return JSON.stringify([
      await namespace.verifyPolicyPhoto(1),
      await namespace.verifyPolicyPhoto(2),
    ])
  })
  expect(actual).toBe(JSON.stringify(expected))
  expect(expected.map((result) => result.bytes)).toEqual([6873, 3606])
})
