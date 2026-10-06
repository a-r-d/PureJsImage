import { expect, test } from '@playwright/test'

for (const fixture of [
  {
    width: 129,
    height: 65,
    budget: 16_777_216,
    progressive: false,
    bytes: 549,
    checksum: 3367695530,
  },
  {
    width: 257,
    height: 129,
    budget: 16_777_216,
    progressive: false,
    bytes: 1402,
    checksum: 4248577614,
  },
  {
    width: 2065,
    height: 17,
    budget: 16_777_216,
    progressive: false,
    bytes: 2222,
    checksum: 1145807969,
  },
  {
    width: 17,
    height: 2065,
    budget: 16_777_216,
    progressive: false,
    bytes: 2483,
    checksum: 723715316,
  },
  {
    width: 257,
    height: 129,
    budget: 16_777_216,
    progressive: true,
    bytes: 1939,
    checksum: 1254500280,
  },
  { width: 129, height: 65, budget: 797_262, progressive: false, bytes: 681, checksum: 775643947 },
])
  test(`JPEG XL photo transforms preserve independent pixels at ${fixture.width}x${fixture.height}, progressive=${fixture.progressive}, budget=${fixture.budget}`, async ({
    page,
  }) => {
    await page.goto('/compatibility.html')
    const result = await page.evaluate(async (fixture) => {
      const path = '/jpegxl-pipeline.js'
      const { verifyJpegXlLargeBlocks } = await import(path)
      return verifyJpegXlLargeBlocks(
        fixture.width,
        fixture.height,
        fixture.budget,
        fixture.progressive,
      )
    }, fixture)
    expect(result.bytes).toBe(fixture.bytes)
    expect(result.decodedChecksum).toBe(fixture.checksum)
    expect(result.samples).toBe(fixture.width * fixture.height * 3)
    expect(result.alphaError).toBe(0)
    expect(result.meanColorError).toBeLessThan(2.5)
    expect(result.ownedPeak).toBeLessThanOrEqual(fixture.budget)
  })
