import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { jpegxlCodec } from '../src/codecs/jpegxl.ts'
import { defaultImageLimits } from '../src/limits.ts'
import { MemorySource } from '../src/source.ts'

const width = 513
const height = 259
const fixtures = [
  { depth: 8, sha256: '8d661f381626dc1ee5cac95d3f4961e59b530232f7f923a602cf49c6bd7b8bf2' },
  { depth: 16, sha256: 'b6f4a38a4d02d7637ef1a736549ed9077d8b3c81cd5e04d05b85b5b3d3935f40' },
] as const

// First-party P6 rasters, encoded and independently decoded with pinned libjxl
// 0.12.0 (8cb67e2): cjxl -d 0 -e 7 -X 0 -Y 100 --num_threads=1 --keep_invisible=1.
// Each RGB sample is generated below. Both streams failed with the old decoder.
const input = async (fixture: (typeof fixtures)[number]): Promise<Uint8Array> => {
  const bytes = await readFile(
    new URL(`./fixtures/jpegxl/grouped-transforms/rgb${fixture.depth}.jxl`, import.meta.url),
  )
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(fixture.sha256)
  return bytes
}

const expectedRow = (depth: 8 | 16, x: number, y: number, columns: number): Uint8Array => {
  const output = new Uint8Array(columns * 3 * (depth / 8))
  for (let column = 0; column < columns; column++) {
    for (let channel = 0; channel < 3; channel++) {
      const sample =
        channel === 0
          ? ((x + column) * 13 + y * 7) % 256
          : channel === 1
            ? ((x + column) % 17) * 11
            : (y % 7) * 31
      const offset = (column * 3 + channel) * (depth / 8)
      output[offset] = sample
      if (depth === 16) output[offset + 1] = (sample * 37) % 256
    }
  }
  return output
}

describe('JPEG XL grouped Modular transform chains', () => {
  for (const fixture of fixtures) {
    it.each([
      { x: 0, y: 0, width, height },
      { x: 250, y: 250, width: 20, height: 9 },
      { x: 500, y: 250, width: 13, height: 9 },
    ])(
      `decodes exact RGB${fixture.depth} samples at $x,$y with extent $width,$height`,
      async (region) => {
        const decoder = await jpegxlCodec.createDecoder?.(
          new MemorySource(await input(fixture)),
          defaultImageLimits,
        )
        if (!decoder) throw new Error('Missing decoder')
        expect([decoder.width, decoder.height, decoder.pixelFormat]).toEqual([
          width,
          height,
          `rgb${fixture.depth}`,
        ])
        // Replaying groups must not mutate retained transform or palette state.
        for (let run = 0; run < 2; run++) {
          let rows = 0
          for await (const block of decoder.decode(region)) {
            try {
              expect([block.x, block.y, block.width, block.height]).toEqual([
                0,
                rows,
                region.width,
                1,
              ])
              expect(block.data).toEqual(
                expectedRow(fixture.depth, region.x, region.y + rows, region.width),
              )
              rows++
            } finally {
              block.release?.()
            }
          }
          expect(rows).toBe(region.height)
        }
      },
      30_000,
    )

    it(`rejects RGB${fixture.depth} inverse allocations before emitting rows`, async () => {
      const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(await input(fixture)), {
        ...defaultImageLimits,
        maxDecodedBytes: 1_000_000,
      })
      if (!decoder) throw new Error('Missing decoder')
      await expect(
        decoder.decode({ x: 0, y: 0, width: 1, height: 1 })[Symbol.asyncIterator]().next(),
      ).rejects.toMatchObject({
        code: 'LIMIT_EXCEEDED',
        message: expect.stringContaining('intersecting Modular groups'),
      })
    })

    it(`honors cancellation before RGB${fixture.depth} output`, async () => {
      const decoder = await jpegxlCodec.createDecoder?.(
        new MemorySource(await input(fixture)),
        defaultImageLimits,
      )
      if (!decoder) throw new Error('Missing decoder')
      const controller = new AbortController()
      controller.abort()
      await expect(
        decoder.decode({ signal: controller.signal })[Symbol.asyncIterator]().next(),
      ).rejects.toMatchObject({ name: 'AbortError' })
    })
  }
})
