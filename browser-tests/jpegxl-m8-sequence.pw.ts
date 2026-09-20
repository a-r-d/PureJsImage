import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { verifyJpegXlM8Native, verifyJpegXlM8Sequence } from './jpegxl-pipeline-harness.ts'

test('M8 frame replay, cancellation and streamed rational-timing encoding match Node', async ({
  page,
}) => {
  const bytes = new Uint8Array(
    await readFile('tests/fixtures/jpegxl/m8-sequence/newtons-cradle.jxl'),
  )
  const expected = await verifyJpegXlM8Sequence(bytes)
  expect(expected.cancelled).toBe(true)
  expect(expected.startTicks).toBe('5')
  expect(expected.encodedStartTicks).toBe('3')
  expect(expected.encodedDurationTicks).toBe(5)
  expect(expected.alpha).toBe(0)
  await page.goto('/compatibility.html')
  const actual = await page.evaluate(async (data) => {
    const path = '/jpegxl-pipeline.js'
    return (await import(path)).verifyJpegXlM8Sequence(new Uint8Array(data))
  }, Array.from(bytes))
  expect(actual).toEqual(expected)
})

test('M8 native VarDCT extras and gray ICC writing match Node', async ({ page }) => {
  const bytes = new Uint8Array(
    await readFile('tests/fixtures/jpegxl/m8-native/grouped-alpha-depth.jxl'),
  )
  const profile = new Uint8Array(await readFile('tests/fixtures/jpegxl/m8-native/gray.icc'))
  const expected = await verifyJpegXlM8Native(bytes, profile)
  expect(expected.result?.profileMatches).toBe(true)
  expect(expected.result?.samples).toEqual([
    [0, 100, 32768, 65535],
    [0, 100, 32768, 65535],
  ])
  expect(expected.result?.name).toBe('coverage')
  await page.goto('/compatibility.html')
  const actual = await page.evaluate(
    async ({ bytes, profile }) => {
      const path = '/jpegxl-pipeline.js'
      return (await import(path)).verifyJpegXlM8Native(
        new Uint8Array(bytes),
        new Uint8Array(profile),
      )
    },
    { bytes: Array.from(bytes), profile: Array.from(profile) },
  )
  expect(actual).toEqual(expected)
})

test('M8 wide-gamut sequence pixels carry emitted sRGB semantics', async ({ page }) => {
  const { verifyJpegXlM8WideGamut } = await import('./jpegxl-pipeline-harness.ts')
  const bytes = new Uint8Array(await readFile('tests/fixtures/jpegxl/m8-static/wide-gamut.jxl'))
  const expected = await verifyJpegXlM8WideGamut(bytes)
  expect(expected.sourcePrimaries).toBe('display-p3')
  expect(expected.semantics.transfer).toEqual({ kind: 'srgb' })
  await page.goto('/compatibility.html')
  const actual = await page.evaluate(async (data) => {
    const path = '/jpegxl-pipeline.js'
    return (await import(path)).verifyJpegXlM8WideGamut(new Uint8Array(data))
  }, Array.from(bytes))
  expect(actual).toEqual(expected)
})
