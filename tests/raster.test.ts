import { describe, expect, it } from 'vitest'
import { rasterToPixels, type RasterBlock } from '../src/raster.ts'

const blocks = async function* (block: RasterBlock): AsyncGenerator<RasterBlock> {
  yield block
}

const collect = async (
  block: RasterBlock,
  channels: readonly [number] | readonly [number, number, number],
  ranges: readonly { black: number; white: number }[],
) => {
  const output = []
  for await (const pixelBlock of rasterToPixels(blocks(block), { channels, ranges })) {
    output.push(pixelBlock)
  }
  return output
}

describe('scientific raster blocks', () => {
  it('selects display channels from a chunky five-channel uint16 raster', async () => {
    const data = new Uint8Array(2 * 5 * 2)
    const view = new DataView(data.buffer)
    const samples = [0, 100, 200, 300, 400, 500, 600, 700, 800, 1000]
    for (let index = 0; index < samples.length; index += 1) {
      view.setUint16(index * 2, samples[index] ?? 0, false)
    }
    let released = false
    const [output] = await collect(
      {
        x: 4,
        y: 7,
        width: 2,
        height: 1,
        stride: 20,
        format: { sampleType: 'uint16', channels: 5, planar: false },
        data,
        release: () => {
          released = true
        },
      },
      [4, 2, 0],
      [
        { black: 0, white: 1000 },
        { black: 0, white: 1000 },
        { black: 0, white: 1000 },
      ],
    )
    expect(output).toMatchObject({ x: 4, y: 7, width: 2, height: 1, format: 'rgb8' })
    expect(Array.from(output?.data ?? [])).toEqual([102, 51, 0, 255, 179, 128])
    expect(released).toBe(true)
  })

  it('selects one channel from padded planar float32 data', async () => {
    const data = new Uint8Array(32)
    const view = new DataView(data.buffer)
    view.setFloat32(0, 0.25, false)
    view.setFloat32(4, 0.5, false)
    view.setFloat32(16, 0.75, false)
    view.setFloat32(20, 1, false)
    const [output] = await collect(
      {
        x: 0,
        y: 0,
        width: 2,
        height: 1,
        stride: 12,
        planeStride: 16,
        format: { sampleType: 'float32', channels: 2, planar: true },
        data,
      },
      [1],
      [{ black: 0, white: 1 }],
    )
    expect(output?.format).toBe('gray8')
    expect(Array.from(output?.data ?? [])).toEqual([191, 255])
  })

  it('preserves signed interpretation during explicit display conversion', async () => {
    const [output] = await collect(
      {
        x: 0,
        y: 0,
        width: 3,
        height: 1,
        stride: 3,
        format: { sampleType: 'int8', channels: 1, planar: false },
        data: Uint8Array.of(0x80, 0, 0x7f),
      },
      [0],
      [{ black: -128, white: 127 }],
    )
    expect(Array.from(output?.data ?? [])).toEqual([0, 128, 255])
  })

  it('rejects truncated planar blocks and releases their storage', async () => {
    let released = false
    const conversion = collect(
      {
        x: 0,
        y: 0,
        width: 2,
        height: 2,
        stride: 2,
        planeStride: 4,
        format: { sampleType: 'uint8', channels: 3, planar: true },
        data: new Uint8Array(11),
        release: () => {
          released = true
        },
      },
      [0, 1, 2],
      [
        { black: 0, white: 255 },
        { black: 0, white: 255 },
        { black: 0, white: 255 },
      ],
    )
    await expect(conversion).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    expect(released).toBe(true)
  })
})
