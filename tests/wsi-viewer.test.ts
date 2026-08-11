import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { openAperioSvs } from '../src/pathology/aperio-svs.ts'
import { MemorySource } from '../src/source.ts'
import { openTiffDocument } from '../src/tiff/index.ts'

const fixturePath = 'tests/fixtures/aperio-cmu-1-small-region.svs'

describe('whole-slide viewer fixture', () => {
  it('opens real Aperio data and produces stable native tile pixels', async () => {
    const input = await readFile(fixturePath)
    expect(createHash('sha256').update(input).digest('hex')).toBe(
      'ed92d5a9f2e86df67640d6f92ce3e231419ce127131697fbbce42ad5e002c8a7',
    )
    const slide = await openAperioSvs(await openTiffDocument(new MemorySource(input)))
    expect({
      width: slide.width,
      height: slide.height,
      levels: slide.levels,
      micronsPerPixel: slide.micronsPerPixel,
      objectivePower: slide.objectivePower,
    }).toEqual({
      width: 2_220,
      height: 2_967,
      levels: [
        {
          index: 0,
          width: 2_220,
          height: 2_967,
          downsample: 1,
          tileWidth: 240,
          tileHeight: 240,
        },
      ],
      micronsPerPixel: 0.499,
      objectivePower: 20,
    })

    const level = slide.levels[0]
    if (!level) throw new Error('Expected the Aperio fixture pyramid level')
    const hash = createHash('sha256')
    const requestedTiles = [
      [0, 0],
      [1, 0],
      [0, 1],
    ] as const
    let nearWhitePixels = 0
    let magentaWhitePixels = 0
    for (const [column, row] of requestedTiles) {
      let blocks = 0
      for await (const block of level.tile(column, row)) {
        try {
          hash.update(
            `${block.x},${block.y},${block.width},${block.height},${block.stride},${block.format};`,
          )
          hash.update(block.data)
          for (let offset = 0; offset < block.data.byteLength; offset += 3) {
            const red = block.data[offset] ?? 0
            const green = block.data[offset + 1] ?? 0
            const blue = block.data[offset + 2] ?? 0
            if (red >= 245 && green >= 245 && blue >= 245) nearWhitePixels += 1
            if (red >= 245 && green < 180 && blue >= 245) magentaWhitePixels += 1
          }
          blocks += 1
        } finally {
          block.release?.()
        }
      }
      expect(blocks).toBe(8)
    }
    expect(hash.digest('hex')).toBe(
      'bf89e71c20e24594c30327979e22e01a9531356ccc1712dfb2ad1b2caf74110d',
    )
    expect(nearWhitePixels).toBeGreaterThan(100)
    expect(magentaWhitePixels).toBe(0)
  })

  it('rejects an aborted native tile request', async () => {
    const input = await readFile(fixturePath)
    const slide = await openAperioSvs(await openTiffDocument(new MemorySource(input)))
    const level = slide.levels[0]
    if (!level) throw new Error('Expected the Aperio fixture pyramid level')
    const controller = new AbortController()
    controller.abort()
    const collect = async (): Promise<void> => {
      for await (const block of level.tile(0, 0, { signal: controller.signal })) {
        block.release?.()
      }
    }
    await expect(collect()).rejects.toMatchObject({ name: 'AbortError' })
  })
})
