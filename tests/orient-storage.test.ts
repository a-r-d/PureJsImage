import type { PathLike } from 'node:fs'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createOrientationTransform } from '../src/orient.ts'
import { nodeRuntime } from '../src/node-runtime.ts'
import type { PixelBlock } from '../src/pixel.ts'

interface StorageFailure {
  code?: string
}

const storageFailure = vi.hoisted<StorageFailure>(() => ({}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    open: async (path: PathLike, flags: string) => {
      const file = await actual.open(path, flags)
      const code = storageFailure.code
      if (code) {
        Object.defineProperty(file, 'write', {
          value: async (): Promise<never> => {
            throw Object.assign(new Error('simulated temporary storage failure'), { code })
          },
        })
      }
      return file
    },
  }
})

const temporaryRoots: string[] = []

afterEach(async () => {
  delete storageFailure.code
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true })))
})

const block = (y: number, height: number): PixelBlock => ({
  x: 0,
  y,
  width: 2,
  height,
  stride: 8,
  format: 'rgba8',
  data: new Uint8Array(8 * height).fill(127),
})

const drain = async (blocks: AsyncIterable<PixelBlock>): Promise<void> => {
  for await (const _block of blocks) {
    // Consume every block so orientation completes or reports its failure.
  }
}

const withIsolatedTmp = async (run: (path: string) => Promise<void>): Promise<void> => {
  const root = await mkdtemp(join(tmpdir(), 'purejsimage-orient-test-'))
  temporaryRoots.push(root)
  const previous = process.env.TMPDIR
  process.env.TMPDIR = root
  try {
    await run(root)
  } finally {
    if (previous === undefined) delete process.env.TMPDIR
    else process.env.TMPDIR = previous
  }
}

describe('auto-orient temporary storage', () => {
  it('removes its temporary directory when the decoder fails mid-stream', async () => {
    await withIsolatedTmp(async (root) => {
      const decoderFailure = new Error('decoder failed mid-stream')
      const blocks = async function* (): AsyncGenerator<PixelBlock> {
        yield block(0, 1)
        throw decoderFailure
      }
      const orientation = createOrientationTransform(2, 2, 'rgba8', 6, nodeRuntime)

      await expect(drain(orientation.apply(blocks()))).rejects.toBe(decoderFailure)
      expect(await readdir(root)).toEqual([])
    })
  })

  it('reports exhausted temporary storage as a limit error and cleans up', async () => {
    await withIsolatedTmp(async (root) => {
      storageFailure.code = 'ENOSPC'
      const blocks = async function* (): AsyncGenerator<PixelBlock> {
        yield block(0, 2)
      }
      const orientation = createOrientationTransform(2, 2, 'rgba8', 8, nodeRuntime)

      await expect(drain(orientation.apply(blocks()))).rejects.toMatchObject({
        name: 'ImageError',
        code: 'LIMIT_EXCEEDED',
        message: 'Auto-orient temporary storage write failed (ENOSPC)',
      })
      expect(await readdir(root)).toEqual([])
    })
  })
})
