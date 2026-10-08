import { expect, test } from '@playwright/test'

test('JPEG XL original-photo selection preserves independently verified samples', async ({
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
      !('verifyConePhoto' in namespace) ||
      typeof namespace.verifyConePhoto !== 'function'
    )
      throw new Error('Missing JPEG XL public photo fixture')
    const result: unknown = await namespace.verifyConePhoto()
    const serialized = JSON.stringify(result)
    if (typeof serialized !== 'string') throw new Error('Missing JPEG XL photo result')
    return serialized
  })
  const result: unknown = JSON.parse(payload)
  expect(result).toMatchObject({
    bytes: 155537,
    encodedChecksum: 912860250,
    decodedChecksum: 1125665758,
    callerChecksum: 3043653419,
    selectedDct16Blocks: 65532,
    samples: 2057 * 2040 * 4,
    alphaError: 0,
    ownedPeak: 56135076,
    ownedLive: 0,
    ownedAllocations: 0,
  })
})
