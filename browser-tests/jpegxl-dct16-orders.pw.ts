import { expect, test } from '@playwright/test'
import { verifyDct16Orders } from '../tests/helpers/jpegxl-dct16-orders.ts'

test('JPEG XL learned DCT16 orders preserve every pixel across runtimes', async ({ page }) => {
  const expected = await verifyDct16Orders()
  await page.goto('/compatibility.html')
  const payload = await page.evaluate(async () => {
    const path = '/jpegxl-pipeline.js'
    const namespace: unknown = await import(path)
    if (
      namespace === null ||
      typeof namespace !== 'object' ||
      !('verifyDct16Orders' in namespace) ||
      typeof namespace.verifyDct16Orders !== 'function'
    )
      throw new Error('Missing DCT16 order fixture')
    const result: unknown = await namespace.verifyDct16Orders()
    const serialized = JSON.stringify(result)
    if (typeof serialized !== 'string') throw new Error('Missing DCT16 fixture result')
    return serialized
  })
  const actual: unknown = JSON.parse(payload)
  expect(actual).toEqual(expected)
})
