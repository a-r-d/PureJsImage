import { expect, test } from '@playwright/test'

for (const fixture of [
  // Shared photo quantization has independently verified pixels at the original error bound.
  {
    width: 129,
    height: 65,
    budget: 16_777_216,
    progressive: false,
    bytes: 483,
    checksum: 812191697,
  },
  {
    width: 257,
    height: 129,
    budget: 16_777_216,
    progressive: false,
    // The same qualified quantization covers the partial group.
    bytes: 1082,
    checksum: 717277342,
  },
  {
    width: 2065,
    height: 17,
    budget: 16_777_216,
    progressive: false,
    // Geometry admission restores the qualified horizontal-strip precision.
    bytes: 2274,
    checksum: 826275486,
  },
  {
    width: 17,
    height: 2065,
    budget: 16_777_216,
    progressive: false,
    // The transposed strip uses the same independently verified geometry rule.
    bytes: 2525,
    checksum: 3492195716,
  },
  {
    width: 257,
    height: 129,
    budget: 16_777_216,
    progressive: true,
    bytes: 1939,
    checksum: 1254500280,
  },
  // Coarse recovery restores the original error bound at the unchanged working budget.
  { width: 129, height: 65, budget: 797_262, progressive: false, bytes: 690, checksum: 2602123369 },
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
