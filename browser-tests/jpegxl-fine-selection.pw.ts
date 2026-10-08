import { expect, test } from '@playwright/test'

test('JPEG XL fine-photo policy preserves complete browser rows and opaque alpha', async ({
  page,
}) => {
  test.setTimeout(600_000)
  await page.goto('/compatibility.html')
  const payload = await page.evaluate(async () => {
    const path = '/jpegxl-pipeline.js'
    const namespace: unknown = await import(path)
    if (
      namespace === null ||
      typeof namespace !== 'object' ||
      !('verifyFinePhoto' in namespace) ||
      typeof namespace.verifyFinePhoto !== 'function'
    )
      throw new Error('Missing JPEG XL fine-photo fixture')
    const result: unknown = await namespace.verifyFinePhoto()
    const serialized = JSON.stringify(result)
    if (typeof serialized !== 'string') throw new Error('Missing JPEG XL fine-photo result')
    return serialized
  })
  const result: unknown = JSON.parse(payload)
  expect(result).toMatchObject({
    bytes: 191161,
    encodedChecksum: 2834716027,
    decodedChecksum: 2715510112,
    callerChecksum: 2647578060,
    samples: 2049 * 2048 * 4,
    coveredRows: 2048,
    releasedBlocks: 2048,
    alphaError: 0,
    xScale: 0,
    bScale: 1,
    epfIterations: 0,
    lfOwnedLive: 0,
    ownedLive: 0,
    ownedAllocations: 0,
  })
  if (
    result === null ||
    typeof result !== 'object' ||
    !('quantizers' in result) ||
    !Array.isArray(result.quantizers) ||
    !('ownedPeak' in result)
  )
    throw new Error('JPEG XL fine-photo result is incomplete')
  expect(result.quantizers.length).toBeGreaterThan(1)
  expect(result.ownedPeak).toBeLessThanOrEqual(67_108_864)
})
