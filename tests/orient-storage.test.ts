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

describe('tiled EXIF orientation', () => {
  it.each(['rgb8', 'rgb16'] as const)(
    'preserves %s partial tiles, padded strides and outstanding blocks',
    async (format) => {
      const width = 97
      const height = 71
      const bytesPerPixel = format === 'rgb8' ? 3 : 6
      const stride = width * bytesPerPixel + 4
      const source = Uint8Array.from(
        { length: stride * height },
        (_, i) => (i * 13 + (i >>> 8)) % 251,
      )
      const blocks = async function* (): AsyncGenerator<PixelBlock> {
        yield { x: 0, y: 0, width, height, stride, format, data: source }
      }

      for (const orientation of [3, 4, 5, 6, 7, 8] as const) {
        const transform = createOrientationTransform(
          width,
          height,
          format,
          orientation,
          createNodeRuntime(),
        )
        const output = new Uint8Array(width * height * bytesPerPixel)
        const held: PixelBlock[] = []
        let previousRelease: (() => void) | undefined
        let received = 0
        for await (const block of transform.apply(blocks())) {
          expect(block.y).toBe(received)
          received += block.height
          if (previousRelease) {
            previousRelease()
            previousRelease = undefined
            held.push(block)
          } else {
            output.set(block.data, block.y * block.stride)
            block.release?.()
            previousRelease = block.release
          }
        }
        expect(received).toBe(transform.height)
        for (const block of held) {
          output.set(block.data, block.y * block.stride)
          block.release?.()
        }

        const expected = new Uint8Array(width * height * bytesPerPixel)
        for (let y = 0; y < height; y += 1) {
          for (let x = 0; x < width; x += 1) {
            const targetX =
              orientation === 3
                ? width - 1 - x
                : orientation === 4
                  ? x
                  : orientation === 6 || orientation === 7
                    ? height - 1 - y
                    : y
            const targetY =
              orientation <= 4
                ? height - 1 - y
                : orientation === 7 || orientation === 8
                  ? width - 1 - x
                  : x
            const offset = y * stride + x * bytesPerPixel
            expected.set(
              source.subarray(offset, offset + bytesPerPixel),
              (targetY * transform.width + targetX) * bytesPerPixel,
            )
          }
        }
        expect(output).toEqual(expected)
      }
    },
  )
})
