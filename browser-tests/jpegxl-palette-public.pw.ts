import { expect, test } from '@playwright/test'
import { build } from 'esbuild'
import { verifyJpegXlPalettePublic } from '../tests/helpers/jpegxl-palette-public.ts'
test('small exact palette and probe cleanup agree in Chromium and Node', async ({ page }) => {
  const expected = await verifyJpegXlPalettePublic()
  const bundle = await build({
    entryPoints: ['tests/helpers/jpegxl-palette-public.ts'],
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    globalName: 'jpegxlPaletteFixture',
    target: 'es2022',
  })
  const script = bundle.outputFiles[0]?.text
  if (!script) throw new Error('Palette browser helper bundle missing')
  await page.goto('about:blank')
  await page.addScriptTag({ content: script })
  const actual = await page.evaluate(async () => {
    const namespace: unknown = Reflect.get(globalThis, 'jpegxlPaletteFixture')
    if (
      namespace === null ||
      typeof namespace !== 'object' ||
      !('verifyJpegXlPalettePublic' in namespace) ||
      typeof namespace.verifyJpegXlPalettePublic !== 'function'
    )
      throw new Error('Browser palette helper unavailable')
    return JSON.stringify(await namespace.verifyJpegXlPalettePublic())
  })
  expect(actual).toBe(JSON.stringify(expected))
})
