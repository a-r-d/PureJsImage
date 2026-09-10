import { expect, test } from 'vitest'
import {
  m7QualityBatchSize,
  m7QualityDimensions,
  runM7CappedQualityPool,
  validateM7CappedMemoryLimits,
  validateM7ParallelMemoryLimits,
} from '../benchmark/jpegxl/m7-quality-scheduling.ts'

const small = { width: 4000, height: 3000 }
test('keeps capped workers bounded and processes every source exactly once', async () => {
  let active = 0,
    peak = 0
  const completed: number[] = []
  await runM7CappedQualityPool([1, 2, 3, 4, 5], 2, async (item) => {
    active++
    peak = Math.max(peak, active)
    await Promise.resolve()
    completed.push(item)
    active--
  })
  expect(peak).toBe(2)
  expect(completed.sort()).toEqual([1, 2, 3, 4, 5])
})

test('stops admitting new sources after a failed capped worker', async () => {
  const started: number[] = []
  await expect(
    runM7CappedQualityPool([1, 2, 3], 1, async (item) => {
      started.push(item)
      throw new Error('oracle failed')
    }),
  ).rejects.toThrow('oracle failed')
  expect(started).toEqual([1])
  await expect(runM7CappedQualityPool([1], 9, async () => {})).rejects.toThrow('worker')
})
test('caps qualification rasters without enlargement or exceeding two megapixels', () => {
  expect(m7QualityDimensions(4000, 3000, false)).toEqual(small)
  expect(m7QualityDimensions(1024, 768, true)).toEqual({ width: 1024, height: 768 })
  const resized = m7QualityDimensions(4000, 3000, true)
  expect(resized.width * resized.height).toBeLessThanOrEqual(2_000_000)
  expect(resized.width / resized.height).toBeCloseTo(4 / 3, 2)
  for (const [width, height] of [
    [1, 1000000000],
    [1000000000, 1],
  ]) {
    if (!width || !height) throw new Error('Missing dimension')
    const size = m7QualityDimensions(width, height, true)
    expect(size.width * size.height).toBeLessThanOrEqual(2_000_000)
    expect(Math.min(size.width, size.height)).toBe(1)
  }
  expect(() => m7QualityDimensions(-1, 20, true)).toThrow('dimensions')
})

test('requires an eight GiB zero-swap guard for capped parallel qualification', () => {
  expect(() => validateM7CappedMemoryLimits(8 * 1024 ** 3, 0)).not.toThrow()
  expect(() => validateM7CappedMemoryLimits(3 * 1024 ** 3, 0)).toThrow('guard')
  expect(() => validateM7CappedMemoryLimits(8 * 1024 ** 3, 1)).toThrow('guard')
})
test('pairs only two sources of at most twelve megapixels', () => {
  expect(m7QualityBatchSize(small, small, 2)).toBe(2)
  expect(m7QualityBatchSize(small, { width: 4001, height: 3000 }, 2)).toBe(1)
  expect(m7QualityBatchSize({ width: 6030, height: 4806 }, small, 2)).toBe(1)
  expect(m7QualityBatchSize(small, undefined, 2)).toBe(1)
  expect(m7QualityBatchSize(small, small, 1)).toBe(1)
})

test('rejects invalid dimensions before scheduling', () => {
  expect(() => m7QualityBatchSize({ width: -1, height: 1 }, small, 2)).toThrow('dimensions')
  expect(() => m7QualityBatchSize(small, { width: Number.NaN, height: 1 }, 2)).toThrow('dimensions')
})

test('requires the full memory cap and disabled swap for paired mode', () => {
  expect(() => validateM7ParallelMemoryLimits(10 * 1024 ** 3, 0)).not.toThrow()
  for (const limit of [Number.NaN, 0, 3 * 1024 ** 3, 8 * 1024 ** 3, 16 * 1024 ** 3])
    expect(() => validateM7ParallelMemoryLimits(limit, 0)).toThrow('guard')
  expect(() => validateM7ParallelMemoryLimits(10 * 1024 ** 3, 1)).toThrow('guard')
})
