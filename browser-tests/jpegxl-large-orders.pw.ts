import { expect, test } from '@playwright/test'
import { verifyLargeCoefficientOrders } from '../tests/helpers/jpegxl-large-orders.ts'
import { verifyLargeSourceSelection } from '../tests/helpers/jpegxl-large-source.ts'

test('JPEG XL LF-only square and rectangle transforms preserve their footprints', async ({
  page,
}) => {
  await page.goto('/compatibility.html')
  const payload = await page.evaluate(async () => {
    const path = '/jpegxl-pipeline.js'
    const namespace: unknown = await import(path)
    if (
      namespace === null ||
      typeof namespace !== 'object' ||
      !('verifyLargeLfTransforms' in namespace) ||
      typeof namespace.verifyLargeLfTransforms !== 'function'
    )
      throw new Error('Missing LF transform fixture')
    const result: unknown = await namespace.verifyLargeLfTransforms()
    const serialized = JSON.stringify(result)
    if (typeof serialized !== 'string') throw new Error('Missing LF transform result')
    return serialized
  })
  const actual: unknown = JSON.parse(payload)
  expect(actual).toEqual({ shapes: 3, maximumLfError: 0, changedMargins: 0, changedInput: 0 })
})

test('JPEG XL mixed large orders preserve every pixel across runtimes', async ({ page }) => {
  const expected = await verifyLargeCoefficientOrders()
  await page.goto('/compatibility.html')
  const payload = await page.evaluate(async () => {
    const path = '/jpegxl-pipeline.js'
    const namespace: unknown = await import(path)
    if (
      namespace === null ||
      typeof namespace !== 'object' ||
      !('verifyLargeCoefficientOrders' in namespace) ||
      typeof namespace.verifyLargeCoefficientOrders !== 'function'
    )
      throw new Error('Missing large order fixture')
    const result: unknown = await namespace.verifyLargeCoefficientOrders()
    const serialized = JSON.stringify(result)
    if (typeof serialized !== 'string') throw new Error('Missing large fixture result')
    return serialized
  })
  const actual: unknown = JSON.parse(payload)
  expect(actual).toEqual(expected)
})

test('JPEG XL source weighting and large transform selection agree across runtimes', async ({
  page,
}) => {
  const expected = verifyLargeSourceSelection()
  await page.goto('/compatibility.html')
  const payload = await page.evaluate(async () => {
    const path = '/jpegxl-pipeline.js'
    const namespace: unknown = await import(path)
    if (
      namespace === null ||
      typeof namespace !== 'object' ||
      !('verifyLargeSourceSelection' in namespace) ||
      typeof namespace.verifyLargeSourceSelection !== 'function'
    )
      throw new Error('Missing large source fixture')
    const result: unknown = await namespace.verifyLargeSourceSelection()
    const serialized = JSON.stringify(result)
    if (typeof serialized !== 'string') throw new Error('Missing large source result')
    return serialized
  })
  const actual: unknown = JSON.parse(payload)
  if (
    actual === null ||
    typeof actual !== 'object' ||
    !('stats' in actual) ||
    actual.stats === null ||
    typeof actual.stats !== 'object' ||
    !('selectedError' in actual.stats) ||
    typeof actual.stats.selectedError !== 'number'
  )
    throw new Error('Missing source selection error')
  // Float64 error sums can differ in their last bits between V8 versions.
  // Every selected integer, map, count and other summary still agrees exactly.
  expect(actual.stats.selectedError).toBeCloseTo(expected.stats.selectedError, 15)
  expect({
    ...actual,
    stats: { ...actual.stats, selectedError: expected.stats.selectedError },
  }).toEqual(expected)
})
