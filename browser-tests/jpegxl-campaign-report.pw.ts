import { expect, test } from '@playwright/test'
import { number, object, string } from '../benchmark/jpegxl/comparison/model.ts'

test('final JPEG XL campaign exposes separate current reports and their measured coverage', async ({
  page,
}, testInfo) => {
  await page.goto('/jpeg-xl/comparison/')
  const response = await page.request.get('/jpeg-xl/evidence/FINAL-CAMPAIGN.json')
  expect(response.ok()).toBe(true)
  const raw: unknown = await response.json()
  const campaign = object(raw),
    photos = object(campaign.finalPhotos),
    secondary = object(campaign.finalSecondary)
  expect(photos.selectedImages).toBe(64)
  expect(secondary.selectedImages).toBe(56)
  expect(photos.distances).toEqual([0.45, 0.65, 0.9, 1.3, 1.85, 3, 3.8, 5.35, 7.5, 10, 14])
  expect(secondary.distances).toEqual(photos.distances)
  const source = object(campaign.source),
    provenance = object(campaign.provenance)
  const card = page.locator('#jxl-final-campaign')
  await expect(card).toContainText(string(source.implementationSourceSha256))
  await expect(card).toContainText('Overall compression parity remains open')
  await expect(card).toContainText('its full-band flag requires 0.5–3')
  expect(source.implementationDirty).toBe(false)
  expect(provenance.priorProducerSource).not.toBe(source.implementationSourceSha256)
  expect(object(provenance.continuity).points).toBe(1253)
  if (!Array.isArray(photos.table) || !Array.isArray(photos.comparisons))
    throw new Error('Missing photographic comparisons')
  const table = photos.table.map(object),
    comparisons = photos.comparisons.map(object)
  const rendered = card.locator('#jxl-final-development tbody tr')
  await expect(rendered).toHaveCount(table.length)
  for (let index = 0; index < table.length; index++) {
    const row = table[index]
    if (!row) throw new Error('Missing photo table row')
    const mean = number(row.mean),
      expected = `${mean > 0 ? '+' : ''}${mean.toFixed(2)}%`
    const cells = rendered.nth(index).locator('td')
    await expect(cells.nth(0)).toHaveText(string(row.peer))
    await expect(cells.nth(2)).toHaveText(expected)
    await expect(cells.nth(3)).toHaveText(String(number(row.count)))
    const fullBand = comparisons.filter(
      (pair) =>
        pair.peer === row.peer && pair.metric === row.metric && pair.coversRequiredRange === true,
    ).length
    await expect(cells.nth(4)).toHaveText(String(fullBand))
  }
  for (const name of [
    'FINAL-SUMMARY.md',
    'FINAL-REPORT.md',
    'FINAL-PHOTOS.md',
    'FINAL-SECONDARY.md',
    'EFFORT9.md',
  ]) {
    const path = `/jpeg-xl/evidence/${name}`
    await expect(card.locator(`a[href="${path}"]`)).toHaveCount(1)
    const download = await page.request.get(path)
    expect(download.ok()).toBe(true)
    expect((await download.text()).startsWith('# ')).toBe(true)
  }
  await card.locator('h2').scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('final-comparison-answer.png') })
  await card.locator('#jxl-final-development').scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('final-comparison-table.png') })
})
