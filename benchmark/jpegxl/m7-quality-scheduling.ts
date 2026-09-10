import { readFile } from 'node:fs/promises'

/** Capped rasters share one fixed working-set class; replenish slots without waiting for a wave. */
export async function runM7CappedQualityPool<T>(
  items: readonly T[],
  workers: number,
  run: (item: T) => Promise<void>,
): Promise<void> {
  if (!Number.isInteger(workers) || workers < 1 || workers > 8)
    throw new Error('Invalid capped worker count')
  let cursor = 0,
    failed = false
  const results = await Promise.allSettled(
    Array.from({ length: Math.min(workers, items.length) }, async () => {
      while (!failed && cursor < items.length) {
        const item = items[cursor++]
        if (item === undefined) throw new Error('Missing capped quality item')
        try {
          await run(item)
        } catch (error) {
          failed = true
          throw error
        }
      }
    }),
  )
  for (const result of results) if (result.status === 'rejected') throw result.reason
}

export function m7QualityDimensions(
  width: number,
  height: number,
  capped: boolean,
): { width: number; height: number } {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    !Number.isSafeInteger(width * height)
  )
    throw new Error('Invalid quality source dimensions')
  if (!capped || width * height <= 2_000_000) return { width, height }
  const scale = Math.sqrt(2_000_000 / (width * height))
  const targetWidth = Math.min(2_000_000, Math.max(1, Math.floor(width * scale)))
  return {
    width: targetWidth,
    height: Math.min(Math.floor(2_000_000 / targetWidth), Math.max(1, Math.floor(height * scale))),
  }
}

export function validateM7CappedMemoryLimits(memoryMax: number, swapMax: number): void {
  if (memoryMax !== 8 * 1024 ** 3 || swapMax !== 0)
    throw new Error('Capped quality mode requires the 8 GiB zero-swap guard')
}

export function m7QualityBatchSize(
  current: { width: number; height: number },
  next: { width: number; height: number } | undefined,
  workers: 1 | 2,
): 1 | 2 {
  const area = (image: { width: number; height: number }): number => {
    const pixels = image.width * image.height
    if (
      !Number.isSafeInteger(image.width) ||
      !Number.isSafeInteger(image.height) ||
      image.width < 1 ||
      image.height < 1 ||
      !Number.isSafeInteger(pixels)
    )
      throw new Error('Invalid quality scheduling dimensions')
    return pixels
  }
  const currentArea = area(current)
  const nextArea = next ? area(next) : undefined
  // Larger sources, including all 29-30 MP cases, always have the entire group to themselves.
  return workers === 2 &&
    currentArea <= 12_000_000 &&
    nextArea !== undefined &&
    nextArea <= 12_000_000
    ? 2
    : 1
}

export function validateM7ParallelMemoryLimits(memoryMax: number, swapMax: number): void {
  if (memoryMax !== 10 * 1024 ** 3 || swapMax !== 0)
    throw new Error('Two-image quality mode requires the 10 GiB zero-swap guard')
}

export async function assertM7ParallelMemoryGuard(capped = false): Promise<void> {
  const path = (await readFile('/proc/self/cgroup', 'utf8'))
    .split('\n')
    .find((line) => line.startsWith('0::'))
    ?.slice(3)
  if (!path?.endsWith('/purejsimage-m7-bounded.service'))
    throw new Error('Two-image quality mode requires run-m7-bounded.ts')
  const root = `/sys/fs/cgroup${path}`
  const validate = capped ? validateM7CappedMemoryLimits : validateM7ParallelMemoryLimits
  validate(
    Number((await readFile(`${root}/memory.max`, 'utf8')).trim()),
    Number((await readFile(`${root}/memory.swap.max`, 'utf8')).trim()),
  )
}
