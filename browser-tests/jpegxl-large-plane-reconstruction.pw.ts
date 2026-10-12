import { expect, test } from '@playwright/test'
import { build } from 'esbuild'
import { verifyJpegXlLargePlaneReconstruction } from '../tests/helpers/jpegxl-large-plane-reconstruction.ts'

test('JPEG XL complete large windows preserve bytes, pixels and scratch cleanup across runtimes', async ({
  page,
}) => {
  const expected = [
      await verifyJpegXlLargePlaneReconstruction(),
      await verifyJpegXlLargePlaneReconstruction([0.65, 2, 7], 9),
    ],
    bundle = await build({
      entryPoints: ['tests/helpers/jpegxl-large-plane-reconstruction.ts'],
      bundle: true,
      write: false,
      platform: 'browser',
      format: 'iife',
      globalName: 'jpegxlLargePlaneFixture',
      target: 'es2022',
    }),
    script = bundle.outputFiles[0]?.text
  if (!script) throw new Error('Large-plane browser fixture bundle missing')
  await page.goto('about:blank')
  await page.addScriptTag({ content: script })
  const actual = await page.evaluate(async () => {
    const namespace: unknown = Reflect.get(globalThis, 'jpegxlLargePlaneFixture')
    if (
      namespace === null ||
      typeof namespace !== 'object' ||
      !('verifyJpegXlLargePlaneReconstruction' in namespace) ||
      typeof namespace.verifyJpegXlLargePlaneReconstruction !== 'function'
    )
      throw new Error('Large-plane browser fixture unavailable')
    return JSON.stringify([
      await namespace.verifyJpegXlLargePlaneReconstruction(),
      await namespace.verifyJpegXlLargePlaneReconstruction([0.65, 2, 7], 9),
    ])
  })
  expect(actual).toBe(JSON.stringify(expected))
})
