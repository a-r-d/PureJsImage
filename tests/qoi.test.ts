import { describe, expect, it } from 'vitest'

import { qoiCodec } from '../src/codecs/qoi.ts'
import { Image } from './image-library.ts'
import { decodeFixture } from './small-codec-helpers.ts'

const endMarker = [0, 0, 0, 0, 0, 0, 0, 1]

const qoiFixture = (
  width: number,
  height: number,
  channels: 3 | 4,
  chunks: readonly number[],
  colorspace: 0 | 1 = 0,
): Uint8Array => {
  const output = new Uint8Array(14 + chunks.length + endMarker.length)
  output.set([0x71, 0x6f, 0x69, 0x66])
  const view = new DataView(output.buffer)
  view.setUint32(4, width, false)
  view.setUint32(8, height, false)
  output[12] = channels
  output[13] = colorspace
  output.set(chunks, 14)
  output.set(endMarker, 14 + chunks.length)
  return output
}

describe('QOI', () => {
  it('decodes every chunk operation and transitions between them', async () => {
    const input = qoiFixture(
      8,
      1,
      4,
      [0xfe, 10, 20, 30, 0x76, 0xa2, 0x79, 0xc1, 0xff, 1, 2, 3, 4, 0x09, 0xfe, 250, 251, 252],
    )
    const decoded = await decodeFixture(qoiCodec, input)

    expect(decoded.decoder).toMatchObject({ width: 8, height: 1, pixelFormat: 'rgba8' })
    expect([...decoded.pixels]).toEqual([
      10, 20, 30, 255, 11, 19, 30, 255, 12, 21, 33, 255, 12, 21, 33, 255, 12, 21, 33, 255, 1, 2, 3,
      4, 10, 20, 30, 255, 250, 251, 252, 255,
    ])
  })

  it('accepts the maximum legal run and both channel headers', async () => {
    const rgba = await decodeFixture(qoiCodec, qoiFixture(63, 1, 4, [0xff, 4, 3, 2, 1, 0xfd]))
    expect(rgba.pixels).toHaveLength(63 * 4)
    expect([...rgba.pixels.subarray(rgba.pixels.length - 4)]).toEqual([4, 3, 2, 1])

    const rgb = await decodeFixture(qoiCodec, qoiFixture(1, 1, 3, [0xfe, 8, 9, 10], 1))
    expect(rgb.decoder.pixelFormat).toBe('rgb8')
    expect([...rgb.pixels]).toEqual([8, 9, 10])
  })

  it('encodes RGB and RGBA deterministically with a strict end marker', async () => {
    const rgbaInput = qoiFixture(2, 1, 4, [0xff, 1, 2, 3, 4, 0xff, 5, 6, 7, 8])
    const first = await (await Image.open(rgbaInput))
      .qoi({ channels: 4, colorspace: 'linear' })
      .toBuffer()
    const second = await (await Image.open(rgbaInput))
      .qoi({ channels: 4, colorspace: 'linear' })
      .toBuffer()

    expect(first).toEqual(second)
    expect(first[12]).toBe(4)
    expect(first[13]).toBe(1)
    expect([...first.subarray(first.byteLength - 8)]).toEqual(endMarker)
    expect([...(await decodeFixture(qoiCodec, first)).pixels]).toEqual([1, 2, 3, 4, 5, 6, 7, 8])

    const rgb = await (await Image.open(rgbaInput)).qoi({ channels: 3 }).toBuffer()
    expect(rgb[12]).toBe(3)
    expect([...(await decodeFixture(qoiCodec, rgb)).pixels]).toEqual([1, 2, 3, 5, 6, 7])
  })

  it('rejects invalid headers, runs beyond the pixel count, bad markers, and truncation', async () => {
    const invalid = qoiFixture(1, 1, 4, [0xfe, 1, 2, 3])
    invalid[12] = 2
    const longRun = qoiFixture(1, 1, 4, [0xfd])
    const badMarker = qoiFixture(1, 1, 4, [0xfe, 1, 2, 3])
    badMarker[badMarker.length - 1] = 2
    const truncated = qoiFixture(1, 1, 4, [0xff, 1, 2, 3, 4]).subarray(0, 16)

    for (const input of [invalid, longRun, badMarker, truncated]) {
      await expect(async () => {
        const image = await Image.open(input)
        await image.png().toBuffer()
      }).rejects.toMatchObject({ code: expect.stringMatching(/INVALID_INPUT|TRUNCATED_INPUT/) })
    }

    const rgba = qoiFixture(2, 1, 4, [0xff, 1, 2, 3, 4, 0xc0])
    await expect(
      (await Image.open(rgba, { limits: { maxDecodedBytes: 7 } })).metadata(),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
  })
})
