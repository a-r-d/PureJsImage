import { expect, test } from '@playwright/test'
import { build } from 'esbuild'
import { acAssignmentSymbolCounts } from '../tests/helpers/jpegxl-ac-histogram-assignment.ts'

test('AC assignment preserves exact ties, large counts and empty clusters', async ({ page }) => {
  const bundle = await build({
    entryPoints: ['tests/helpers/jpegxl-ac-histogram-assignment.ts'],
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    globalName: 'jpegxlAssignmentFixture',
    target: 'es2022',
  })
  const script = bundle.outputFiles[0]?.text
  if (!script) throw new Error('AC assignment fixture bundle missing')
  await page.goto('about:blank')
  await page.addScriptTag({ content: script })
  const actual = await page.evaluate(() => {
    const namespace: unknown = Reflect.get(globalThis, 'jpegxlAssignmentFixture')
    if (
      namespace === null ||
      typeof namespace !== 'object' ||
      !('verifyAcAssignmentBrowser' in namespace) ||
      typeof namespace.verifyAcAssignmentBrowser !== 'function'
    )
      throw new Error('Browser AC assignment fixture unavailable')
    const result: unknown = namespace.verifyAcAssignmentBrowser()
    return JSON.stringify(result)
  })
  expect(actual).toBe(
    JSON.stringify(
      [10, 0xffffffff].flatMap((count) =>
        acAssignmentSymbolCounts.flatMap((symbolCount) =>
          [0, 1].map(() => ({
            count,
            symbolCount,
            assignments: [0, 1, 3, 0],
            zeroCost: 0,
            finitePositiveCosts: true,
          })),
        ),
      ),
    ),
  )
})
