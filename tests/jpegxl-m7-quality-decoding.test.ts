import { readFile } from 'node:fs/promises'
import { expect, test } from 'vitest'
import { verifyM7QualityPixels } from '../benchmark/jpegxl/m7-quality-decoding.ts'

const fixture = 'tests/fixtures/jpegxl/m6-preview'

test('verifies complete repository RGB rows against the pinned independent final raster', async () => {
  const encoded = await readFile(`${fixture}/embedded-preview.jxl`)
  const expected = await readFile(`${fixture}/oracle/stage-3.bin`)
  const result = await verifyM7QualityPixels(encoded, expected, 43, 35)
  expect(result.samples).toBe(43 * 35 * 3)
  expect(result.rows).toBe(35)
  expect(result.maximum).toBeLessThanOrEqual(2)
})

test('rejects a changed independent pixel', async () => {
  const encoded = await readFile(`${fixture}/embedded-preview.jxl`)
  const expected = await readFile(`${fixture}/oracle/stage-3.bin`)
  expected[0] = (expected[0] ?? 0) > 127 ? 0 : 255
  await expect(verifyM7QualityPixels(encoded, expected, 43, 35)).rejects.toThrow('decoder mismatch')
})

test('rejects wrong row geometry even when the sample count is unchanged', async () => {
  const encoded = await readFile(`${fixture}/embedded-preview.jxl`)
  const expected = await readFile(`${fixture}/oracle/stage-3.bin`)
  await expect(verifyM7QualityPixels(encoded, expected, 35, 43)).rejects.toThrow('row coverage')
})

test('rejects incomplete independent sample storage', async () => {
  await expect(verifyM7QualityPixels(new Uint8Array(), new Uint8Array(2), 1, 1)).rejects.toThrow(
    'raster extent',
  )
})
