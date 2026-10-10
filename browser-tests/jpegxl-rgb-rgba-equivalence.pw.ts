import { expect, test } from '@playwright/test'
import { build } from 'esbuild'
import { verifyJpegXlRgbRgbaEquivalence } from '../tests/helpers/jpegxl-rgb-rgba-equivalence.ts'

for (const progressive of [false, true])
  test(`JPEG XL RGB and opaque RGBA colors agree in Chromium and Node, progressive=${progressive}`, async ({
    page,
  }) => {
    const expected = await verifyJpegXlRgbRgbaEquivalence(progressive)
    const bundle = await build({
      entryPoints: ['tests/helpers/jpegxl-rgb-rgba-equivalence.ts'],
      bundle: true,
      write: false,
      platform: 'browser',
      format: 'iife',
      globalName: 'jpegxlChannelFixture',
      target: 'es2022',
    })
    const script = bundle.outputFiles[0]?.text
    if (!script) throw new Error('Browser fixture missing')
    await page.goto('about:blank')
    await page.addScriptTag({ content: script })
    const actual = await page.evaluate(async (progressive) => {
      const namespace: unknown = Reflect.get(globalThis, 'jpegxlChannelFixture')
      if (
        namespace === null ||
        typeof namespace !== 'object' ||
        !('verifyJpegXlRgbRgbaEquivalence' in namespace) ||
        typeof namespace.verifyJpegXlRgbRgbaEquivalence !== 'function'
      )
        throw new Error('Browser fixture unavailable')
      return JSON.stringify(await namespace.verifyJpegXlRgbRgbaEquivalence(progressive))
    }, progressive)
    expect(JSON.parse(actual)).toEqual(expected)
    expect(expected.rows.map((row) => [row.effort, row.distance])).toEqual([
      [7, 1.5],
      [7, 3],
      [7, 7],
      [1, 3],
      [3, 3],
      [5, 3],
    ])
  })
