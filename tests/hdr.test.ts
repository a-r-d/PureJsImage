import { describe, expect, it } from 'vitest'

import { defaultImageLimits } from '../src/index.ts'
import { hdrCodec } from '../src/codecs/hdr.ts'
import { MemorySource } from '../src/source.ts'
import { Image } from './image-library.ts'
import { decodeFixture } from './small-codec-helpers.ts'

const textEncoder = new TextEncoder()

const hdrFixture = (
  resolution: string,
  raster: readonly number[],
  fields: readonly string[] = [],
): Uint8Array => {
  const header = textEncoder.encode(
    `#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n${fields.join('\n')}${fields.length === 0 ? '' : '\n'}\n${resolution}\n`,
  )
  const output = new Uint8Array(header.byteLength + raster.length)
  output.set(header)
  output.set(raster, header.byteLength)
  return output
}

const floatValues = (data: Uint8Array): number[] => {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const values: number[] = []
  for (let offset = 0; offset < data.byteLength; offset += 4) {
    values.push(view.getFloat32(offset, false))
  }
  return values
}

const red = [128, 0, 0, 129]
const green = [0, 128, 0, 129]
const blue = [0, 0, 128, 129]
const white = [128, 128, 128, 129]

const expectedOrientation = [
  1.00390625, 0.00390625, 0.00390625, 0.00390625, 1.00390625, 0.00390625, 0.00390625, 0.00390625,
  1.00390625, 1.00390625, 1.00390625, 1.00390625,
]

describe('Radiance HDR', () => {
  it.each([
    ['-Y 2 +X 2', [...red, ...green, ...blue, ...white]],
    ['+Y 2 +X 2', [...blue, ...white, ...red, ...green]],
    ['-Y 2 -X 2', [...green, ...red, ...white, ...blue]],
    ['+X 2 -Y 2', [...red, ...blue, ...green, ...white]],
  ])('decodes %s orientation into top-left row order', async (resolution, raster) => {
    const decoded = await decodeFixture(hdrCodec, hdrFixture(resolution, raster))

    expect(decoded.decoder).toMatchObject({ width: 2, height: 2, pixelFormat: 'rgbf32' })
    expect(floatValues(decoded.pixels)).toEqual(expectedOrientation)
    expect(decoded.blocks.every((block) => block.height === 1)).toBe(true)
  })

  it('decodes standard channel RLE and legacy scanlines', async () => {
    const standardRaster = [2, 2, 0, 8, 136, 128, 136, 64, 136, 32, 136, 129]
    const standard = await decodeFixture(hdrCodec, hdrFixture('-Y 1 +X 8', standardRaster))
    expect(floatValues(standard.pixels)).toEqual(
      Array.from({ length: 8 }, () => [1.00390625, 0.50390625, 0.25390625]).flat(),
    )

    const literal128Raster = [
      2,
      2,
      0,
      128,
      128,
      ...Array.from({ length: 128 }, () => 128),
      128,
      ...Array.from({ length: 128 }, () => 64),
      128,
      ...Array.from({ length: 128 }, () => 32),
      128,
      ...Array.from({ length: 128 }, () => 129),
    ]
    const literal128 = await decodeFixture(hdrCodec, hdrFixture('-Y 1 +X 128', literal128Raster))
    expect(floatValues(literal128.pixels).slice(0, 3)).toEqual([1.00390625, 0.50390625, 0.25390625])
    expect(floatValues(literal128.pixels).slice(-3)).toEqual([1.00390625, 0.50390625, 0.25390625])

    const legacy = await decodeFixture(hdrCodec, hdrFixture('-Y 1 +X 4', [...red, 1, 1, 1, 3]))
    expect(floatValues(legacy.pixels)).toEqual(
      Array.from({ length: 4 }, () => [1.00390625, 0.00390625, 0.00390625]).flat(),
    )
  })

  it('preserves exponent extremes and reports exposure and gamma', async () => {
    const input = hdrFixture(
      '-Y 1 +X 2',
      [255, 128, 1, 255, 128, 64, 32, 1],
      ['EXPOSURE=2', 'EXPOSURE=0.5', 'GAMMA=2.2'],
    )
    const metadata = await hdrCodec.metadata(new MemorySource(input), defaultImageLimits)
    const values = floatValues((await decodeFixture(hdrCodec, input)).pixels)

    expect(metadata).toMatchObject({
      format: 'hdr',
      mimeType: 'image/vnd.radiance',
      exposure: 1,
      gamma: 2.2,
      sampleFormat: 'floating-point',
      bitDepth: 32,
    })
    expect(values[0]).toBeGreaterThan(1e38)
    expect(values[3]).toBeGreaterThan(0)
    expect(values[3]).toBeLessThan(1e-37)
  })

  it('encodes deterministically and keeps native float samples on HDR-to-HDR output', async () => {
    const input = hdrFixture('-Y 1 +X 2', [...red, ...blue])
    const first = await (await Image.open(input)).hdr({ exposure: 1.25, gamma: 2.2 }).toBuffer()
    const second = await (await Image.open(input)).hdr({ exposure: 1.25, gamma: 2.2 }).toBuffer()

    expect(first).toEqual(second)
    expect(new TextDecoder().decode(first.subarray(0, 96))).toContain('EXPOSURE=1.25\nGAMMA=2.2')
    expect(floatValues((await decodeFixture(hdrCodec, first)).pixels)).toEqual([
      1.00390625, 0.00390625, 0.00390625, 0.00390625, 0.00390625, 1.00390625,
    ])
  })

  it('rejects malformed headers, RLE overflow, and truncated scanlines', async () => {
    const invalidInputs = [
      textEncoder.encode('#?RADIANCE\n\n-Y 1 +X 1\n'),
      hdrFixture('-Y 1 +X 8', [2, 2, 0, 8, 137, 1]),
      hdrFixture('-Y 1 +X 2', [...red]),
    ]
    for (const input of invalidInputs) {
      await expect(async () => {
        const image = await Image.open(input)
        await image.png().toBuffer()
      }).rejects.toMatchObject({
        code: expect.stringMatching(/INVALID_INPUT|TRUNCATED_INPUT|UNSUPPORTED_OPERATION/),
      })
    }
  })
})
