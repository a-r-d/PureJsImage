import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'

import { crc32 } from '../src/codecs/crc32.ts'
import { pngCodec } from '../src/codecs/png.ts'
import { nodeRuntime } from '../src/node-runtime.ts'
import { Uint8ArraySink } from '../src/sink.ts'
import { Image } from './image-library.ts'

type Color = readonly [number, number, number, number]

const rgbaInput = (
  width: number,
  height: number,
  color: (x: number, y: number) => Color,
): Buffer => {
  const image = new PNG({ width, height })
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4
      const [red, green, blue, alpha] = color(x, y)
      image.data[offset] = red
      image.data[offset + 1] = green
      image.data[offset + 2] = blue
      image.data[offset + 3] = alpha
    }
  }
  return PNG.sync.write(image, {
    colorType: 6,
    inputColorType: 6,
    bitDepth: 8,
  })
}

const rgbInput = (
  width: number,
  height: number,
  color: (x: number, y: number) => Color,
): Buffer => {
  const rgba = PNG.sync.read(rgbaInput(width, height, color))
  return PNG.sync.write(rgba, { colorType: 2, inputColorType: 6, bitDepth: 8 })
}

interface ChunkSummary {
  readonly type: string
  readonly data: Uint8Array
}

const chunks = (png: Uint8Array): ChunkSummary[] => {
  const output: ChunkSummary[] = []
  let offset = 8
  while (offset < png.byteLength) {
    const length = new DataView(png.buffer, png.byteOffset + offset, 4).getUint32(0)
    const type = String.fromCharCode(...png.subarray(offset + 4, offset + 8))
    output.push({ type, data: png.subarray(offset + 8, offset + 8 + length) })
    offset += length + 12
  }
  return output
}

const header = (png: Uint8Array): { bitDepth: number; colorType: number } => {
  const data = chunks(png)[0]?.data ?? new Uint8Array(13)
  return { bitDepth: data[8] ?? 0, colorType: data[9] ?? 0 }
}

const chunkTypes = (png: Uint8Array): string[] => [
  ...new Set(chunks(png).map((chunk) => chunk.type)),
]

const pngChunk = (type: string, data: Uint8Array): Buffer => {
  const encodedType = Buffer.from(type, 'ascii')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.byteLength)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(encodedType, data))
  return Buffer.concat([length, encodedType, data, checksum])
}

const logoColors: readonly Color[] = [
  [255, 255, 255, 0],
  [12, 80, 160, 255],
  [240, 180, 20, 255],
  [12, 80, 160, 128],
  [30, 30, 30, 255],
]

const logo = (x: number, y: number): Color =>
  logoColors[((x >> 3) + (y >> 2)) % logoColors.length] ?? [0, 0, 0, 0]

describe('PNG palette output', () => {
  it('writes an indexed PNG with tRNS when RGBA output has 256 or fewer colors', async () => {
    const input = rgbaInput(64, 48, logo)
    const image = await Image.open(input)
    const indexed = await image.png().toBuffer()
    const truecolor = await image.png({ palette: false }).toBuffer()

    expect(header(indexed)).toEqual({ bitDepth: 8, colorType: 3 })
    expect(chunkTypes(indexed)).toEqual(['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND'])
    const plte = chunks(indexed).find((chunk) => chunk.type === 'PLTE')
    expect(plte?.data.byteLength).toBe(logoColors.length * 3)
    expect(indexed.byteLength).toBeLessThan(truecolor.byteLength)
    expect(PNG.sync.read(indexed).data).toEqual(PNG.sync.read(input).data)
    expect(header(truecolor)).toEqual({ bitDepth: 8, colorType: 6 })
  })

  it('omits tRNS for opaque colors and decodes to the same pixels', async () => {
    const opaque = (x: number, y: number): Color => {
      const [red, green, blue] = logo(x, y)
      return [red, green, blue, 255]
    }
    const input = rgbInput(80, 40, opaque)
    const output = await (await Image.open(input)).png().toBuffer()

    expect(header(output)).toEqual({ bitDepth: 8, colorType: 3 })
    expect(chunkTypes(output)).toEqual(['IHDR', 'PLTE', 'IDAT', 'IEND'])
    expect(PNG.sync.read(output).data).toEqual(PNG.sync.read(input).data)
    // PureJsImage reads its own indexed output back to the same pixels.
    const reencoded = await (await Image.open(output)).png({ palette: false }).toBuffer()
    expect(header(reencoded)).toEqual({ bitDepth: 8, colorType: 2 })
    expect(PNG.sync.read(reencoded).data).toEqual(PNG.sync.read(input).data)
  })

  it('keeps RGBA output byte-identical when a 257th color appears after earlier blocks', async () => {
    const input = rgbaInput(40, 96, (x, y) =>
      y < 70 ? logo(x, y) : [(x * 7 + y) & 0xff, (y * 3) & 0xff, (x * 13) & 0xff, 255],
    )
    const image = await Image.open(input)
    const output = await image.png().toBuffer()

    expect(header(output)).toEqual({ bitDepth: 8, colorType: 6 })
    expect(output).toEqual(await image.png({ palette: false }).toBuffer())
    expect(PNG.sync.read(output).data).toEqual(PNG.sync.read(input).data)
  })

  it('keeps RGB output when the indexed file would be larger', async () => {
    const input = rgbInput(16, 16, (x, y) => [x * 16, y * 16, 0, 255])
    const image = await Image.open(input)
    const output = await image.png().toBuffer()

    expect(header(output)).toEqual({ bitDepth: 8, colorType: 2 })
    expect(output).toEqual(await image.png({ palette: false }).toBuffer())
  })

  it('writes preserved EXIF before the palette', async () => {
    const exif = Uint8Array.of(0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 0, 0, 0, 0, 0)
    const plain = rgbaInput(64, 48, logo)
    const input = Buffer.concat([plain.subarray(0, 33), pngChunk('eXIf', exif), plain.subarray(33)])
    const output = await (await Image.open(input)).keepExif().png().toBuffer()

    expect(chunkTypes(output)).toEqual(['IHDR', 'eXIf', 'PLTE', 'tRNS', 'IDAT', 'IEND'])
    const written = chunks(output).find((chunk) => chunk.type === 'eXIf')?.data
    expect(Uint8Array.from(written ?? [])).toEqual(exif)
    expect(PNG.sync.read(output).data).toEqual(PNG.sync.read(plain).data)
  })

  it('writes the same bytes from one-row blocks as from a single block', async () => {
    const width = 48
    const height = 70
    const pixels = new Uint8Array(width * height * 4)
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) pixels.set(logo(x, y), (y * width + x) * 4)
    }
    const encode = async (rowsPerBlock: number): Promise<Uint8Array> => {
      const sink = new Uint8ArraySink()
      const encoder = await pngCodec.createEncoder?.(sink, {
        width,
        height,
        pixelFormat: 'rgba8',
        options: {},
        runtime: nodeRuntime,
      })
      if (!encoder) throw new Error('PNG encoder is unavailable')
      for (let y = 0; y < height; y += rowsPerBlock) {
        const rows = Math.min(rowsPerBlock, height - y)
        const data = pixels.subarray(y * width * 4, (y + rows) * width * 4)
        await encoder.write({
          data,
          format: 'rgba8',
          height: rows,
          stride: width * 4,
          width,
          x: 0,
          y,
        })
      }
      await encoder.finish()
      return sink.toUint8Array()
    }
    const single = await encode(height)

    expect(header(single)).toEqual({ bitDepth: 8, colorType: 3 })
    expect(await encode(1)).toEqual(single)
    expect(await encode(7)).toEqual(single)
  })

  it('rejects a palette option that is not a boolean', async () => {
    await expect(
      pngCodec.createEncoder?.(new Uint8ArraySink(), {
        width: 1,
        height: 1,
        pixelFormat: 'rgba8',
        options: { palette: 'yes' },
        runtime: nodeRuntime,
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: 'PNG palette must be a boolean',
    })
  })
})
