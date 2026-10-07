import { expect, test } from '@playwright/test'
import { verifyJpegXlLumaContexts } from '../tests/helpers/jpegxl-luma-contexts.ts'

test('original-size luma context selection and LIMIT recovery match Node', async ({ page }) => {
  test.setTimeout(600_000)
  const expected = []
  for (const failure of ['limit', 'none'] as const)
    expected.push(await verifyJpegXlLumaContexts(true, failure))
  expect(expected[0]?.decodedChecksum).toBe(expected[1]?.decodedChecksum)
  await page.goto('/compatibility.html')
  const actual = await page.evaluate(async () => {
    const path = '/jpegxl-pipeline.js'
    const module = await import(path)
    const results = []
    for (const failure of ['limit', 'none'])
      results.push(await module.verifyJpegXlLumaContexts(true, failure))
    return results
  })
  expect(actual).toEqual(expected)
})
