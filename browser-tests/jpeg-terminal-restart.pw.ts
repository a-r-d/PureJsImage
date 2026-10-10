import { expect, test } from '@playwright/test'
import { build } from 'esbuild'
import { verifyJpegTerminalRestart } from '../tests/helpers/jpeg-terminal-restart.ts'

test('JPEG terminal restart validation agrees in Chromium and Node', async ({ page }) => {
  const expected = await verifyJpegTerminalRestart()
  const bundle = await build({
    entryPoints: ['tests/helpers/jpeg-terminal-restart.ts'],
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    globalName: 'terminalJpegFixture',
    target: 'es2022',
  })
  const script = bundle.outputFiles[0]?.text
  if (!script) throw new Error('Browser fixture missing')
  await page.goto('about:blank')
  await page.addScriptTag({ content: script })
  const actual = await page.evaluate(async () => {
    const namespace: unknown = Reflect.get(globalThis, 'terminalJpegFixture')
    if (
      namespace === null ||
      typeof namespace !== 'object' ||
      !('verifyJpegTerminalRestart' in namespace) ||
      typeof namespace.verifyJpegTerminalRestart !== 'function'
    )
      throw new Error('Browser fixture unavailable')
    return JSON.stringify(await namespace.verifyJpegTerminalRestart())
  })
  expect(JSON.parse(actual)).toEqual(expected)
})
