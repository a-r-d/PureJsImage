import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { jpegxlCodec } from '../src/codecs/jpegxl.ts'
import {
  decodeJpegXlFrameSource,
  readJpegXlSourceFrameStructure,
} from '../src/codecs/jpegxl-decode.ts'
import { defaultImageLimits } from '../src/limits.ts'
import { MemorySource } from '../src/source.ts'

const fixture = new Uint8Array(
  await readFile(
    new URL('./fixtures/jpegxl/m8-implicit-palette/delta_palette.jxl', import.meta.url),
  ),
)
const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const open = async (bytes = fixture, maxDecodedBytes = defaultImageLimits.maxDecodedBytes) => {
  const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(bytes), {
    ...defaultImageLimits,
    maxDecodedBytes,
  })
  if (!decoder) throw new Error('JPEG XL decoder is unavailable')
  return decoder
}
const collect = async (
  request: Readonly<{
    x?: number
    y?: number
    width?: number
    height?: number
  }> = {},
) => {
  const decoder = await open()
  const width = request.width ?? decoder.width
  const height = request.height ?? decoder.height
  const result = new Uint8Array(width * height * 3)
  let rows = 0
  for await (const block of decoder.decode(request)) {
    expect(block.format).toBe('rgb8')
    expect(block.y).toBe(rows)
    expect(block.height).toBe(1)
    result.set(block.data, rows * width * 3)
    rows++
    block.release?.()
  }
  expect(rows).toBe(height)
  return result
}

describe('M8 global implicit delta palette', () => {
  it('matches every RGB8 sample from the official reference and pinned djxl', async () => {
    expect(digest(fixture)).toBe('00e24cc453cdf84897d62b0aafc7a9f7024205bbce1922e99d7ad0003759ae7c')
    expect(digest(await collect())).toBe(
      '684e1111d59451df0a887228bf710a58b5eea37ff9c4c35ad6ad447e6c696137',
    )
  })
  it.each([
    [250, 250, 20, 20],
    [510, 510, 45, 241],
    [554, 750, 1, 1],
  ])('replays cross-group prediction before cropping %j', async (x, y, width, height) => {
    const full = await collect()
    const cropped = await collect({ x, y, width, height })
    for (let row = 0; row < height; row++) {
      expect(cropped.subarray(row * width * 3, (row + 1) * width * 3)).toEqual(
        full.subarray(((y + row) * 555 + x) * 3, ((y + row) * 555 + x + width) * 3),
      )
    }
  })
  it('admits the conservative buffer bound and rejects one byte below', async () => {
    const header = await readJpegXlSourceFrameStructure(
      new MemorySource(fixture),
      defaultImageLimits,
    )
    const bound =
      header.width * (Math.min(header.height, header.groupDimension) * 8 + 192) +
      header.sections.reduce((sum, section) => sum + section.length, 0)
    const { decoder: admitted } = await decodeJpegXlFrameSource(new MemorySource(fixture), header, {
      ...defaultImageLimits,
      maxDecodedBytes: bound,
    })
    let rows = 0
    for await (const block of admitted.decode()) {
      rows += block.height
      block.release?.()
    }
    expect(rows).toBe(751)
    const { decoder: rejected } = await decodeJpegXlFrameSource(new MemorySource(fixture), header, {
      ...defaultImageLimits,
      maxDecodedBytes: bound - 1,
    })
    await expect(rejected.decode()[Symbol.asyncIterator]().next()).rejects.toMatchObject({
      code: 'LIMIT_EXCEEDED',
    })
  })
  it('cancels after partial output and supports a fresh decode after early return', async () => {
    const decoder = await open()
    const controller = new AbortController()
    const iterator = decoder.decode({ signal: controller.signal })[Symbol.asyncIterator]()
    const first = await iterator.next()
    expect(first.done).toBe(false)
    controller.abort()
    await expect(iterator.next()).rejects.toThrow()
    const second = decoder.decode()[Symbol.asyncIterator]()
    expect((await second.next()).done).toBe(false)
    await second.return?.()
    let rows = 0
    for await (const block of decoder.decode({
      x: 554,
      y: 750,
      width: 1,
      height: 1,
    })) {
      rows += block.height
      block.release?.()
    }
    expect(rows).toBe(1)
  })
  it('rejects corrupt global padding and truncated group data', async () => {
    const header = await readJpegXlSourceFrameStructure(
      new MemorySource(fixture),
      defaultImageLimits,
    )
    const section = header.sections[0]
    if (!section) throw new Error('Missing global section')
    const corrupt = fixture.slice()
    const offset = section.offset + section.length - 1
    corrupt[offset] = (corrupt[offset] ?? 0) ^ 0x80
    await expect(open(corrupt)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
    await expect(open(fixture.subarray(0, fixture.length - 1))).rejects.toThrow()
  })
  it('rejects a damaged empty ANS state instead of treating it as padding', async () => {
    const header = await readJpegXlSourceFrameStructure(
      new MemorySource(fixture),
      defaultImageLimits,
    )
    const section = header.sections[0]
    if (!section) throw new Error('Missing global section')
    const corrupt = fixture.slice()
    const offset = section.offset + section.length - 2
    corrupt[offset] = (corrupt[offset] ?? 0) ^ 1
    await expect(open(corrupt)).rejects.toThrow('empty Modular residual ANS state is invalid')
  })
  it('rejects a damaged later group after already producing valid rows', async () => {
    const corrupt = fixture.slice()
    corrupt[corrupt.length - 1] = (corrupt[corrupt.length - 1] ?? 0) ^ 0x80
    const decoder = await open(corrupt)
    let rows = 0
    const run = async () => {
      for await (const block of decoder.decode()) {
        rows += block.height
        block.release?.()
      }
    }
    await expect(run()).rejects.toThrow()
    expect(rows).toBeGreaterThan(0)
    expect(rows).toBeLessThan(751)
  })
})
