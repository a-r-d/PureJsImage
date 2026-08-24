import type { PathLike } from 'node:fs'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createNodeRuntime } from '../src/node-runtime.ts'
import { createOrientationTransform } from '../src/orient.ts'
import type { PixelBlock } from '../src/pixel.ts'

interface StorageFailure {
  code?: string
  successfulWritesBeforeFailure?: number
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
        const originalWrite = file.write.bind(file)
        let writes = 0
        Object.defineProperty(file, 'write', {
          value: async (buffer: Uint8Array, offset: number, length: number, position: number) => {
            writes += 1
            if (writes > (storageFailure.successfulWritesBeforeFailure ?? 1)) {
              throw Object.assign(new Error('simulated temporary storage failure'), { code })
            }
            return originalWrite(buffer, offset, length, position)
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
  delete storageFailure.successfulWritesBeforeFailure
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
      const fileRuntime = createNodeRuntime({ temporaryFiles: true })
      const decoderFailure = new Error('decoder failed mid-stream')
      const blocks = async function* (): AsyncGenerator<PixelBlock> {
        yield block(0, 1)
        throw decoderFailure
      }
      const orientation = createOrientationTransform(2, 2, 'rgba8', 6, fileRuntime)

      await expect(drain(orientation.apply(blocks()))).rejects.toBe(decoderFailure)
      expect(await readdir(root)).toEqual([])
    })
  })

  it('falls back to memory when temporary storage is exhausted and cleans up', async () => {
    await withIsolatedTmp(async (root) => {
      const fileRuntime = createNodeRuntime({ temporaryFiles: true })
      storageFailure.code = 'ENOSPC'
      storageFailure.successfulWritesBeforeFailure = 2
      const blocks = async function* (): AsyncGenerator<PixelBlock> {
        yield block(0, 33)
      }
      const orientation = createOrientationTransform(2, 33, 'rgba8', 8, fileRuntime)

      await expect(drain(orientation.apply(blocks()))).resolves.toBeUndefined()
      expect(await readdir(root)).toEqual([])
    })
  })
})
