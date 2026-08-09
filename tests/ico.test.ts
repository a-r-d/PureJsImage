import { readFile } from 'node:fs/promises'
import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'

import { icoCodec } from '../src/codecs/ico.ts'
import { pngCodec } from '../src/codecs/png.ts'
import { createNodeImageLibrary } from '../src/node-image.ts'

type Rgba = readonly [red: number, green: number, blue: number, alpha: number]

interface IconEntryFixture {
  readonly width: number
  readonly height: number
  readonly bitDepth: number
  readonly data: Uint8Array
  readonly colorCount?: number
}

interface DibFixtureOptions {
  readonly width: number
  readonly height: number
  readonly bitDepth: 1 | 4 | 8 | 16 | 24 | 32
  readonly xor: Uint8Array
  readonly and: Uint8Array
  readonly palette?: readonly Rgba[]
}

const images = createNodeImageLibrary([icoCodec, pngCodec])

const iconFixture = (entries: readonly IconEntryFixture[]): Uint8Array => {
  const directoryBytes = 6 + entries.length * 16
  const payloadBytes = entries.reduce((total, entry) => total + entry.data.byteLength, 0)
  const output = new Uint8Array(directoryBytes + payloadBytes)
  const view = new DataView(output.buffer)
  view.setUint16(2, 1, true)
  view.setUint16(4, entries.length, true)
  let payloadOffset = directoryBytes
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    if (!entry) continue
    const offset = 6 + index * 16
    output[offset] = entry.width === 256 ? 0 : entry.width
    output[offset + 1] = entry.height === 256 ? 0 : entry.height
    output[offset + 2] = entry.colorCount ?? 0
    view.setUint16(offset + 4, 1, true)
    view.setUint16(offset + 6, entry.bitDepth, true)
    view.setUint32(offset + 8, entry.data.byteLength, true)
    view.setUint32(offset + 12, payloadOffset, true)
    output.set(entry.data, payloadOffset)
    payloadOffset += entry.data.byteLength
  }
  return output
}

const pngFixture = (width: number, height: number, color: Rgba): Uint8Array => {
  const image = new PNG({ width, height })
  for (let offset = 0; offset < image.data.byteLength; offset += 4) {
    image.data.set(color, offset)
  }
  return PNG.sync.write(image)
}

const dibFixture = (options: DibFixtureOptions): Uint8Array => {
  const paletteBytes = (options.palette?.length ?? 0) * 4
  const output = new Uint8Array(40 + paletteBytes + options.xor.byteLength + options.and.byteLength)
  const view = new DataView(output.buffer)
  view.setUint32(0, 40, true)
  view.setInt32(4, options.width, true)
  view.setInt32(8, options.height * 2, true)
  view.setUint16(12, 1, true)
  view.setUint16(14, options.bitDepth, true)
  view.setUint32(20, options.xor.byteLength, true)
  view.setUint32(32, options.palette?.length ?? 0, true)
  for (let index = 0; index < (options.palette?.length ?? 0); index += 1) {
    const color = options.palette?.[index]
    if (!color) continue
    output.set([color[2], color[1], color[0], 0], 40 + index * 4)
  }
  output.set(options.xor, 40 + paletteBytes)
  output.set(options.and, 40 + paletteBytes + options.xor.byteLength)
  return output
}

const coreDibFixture = (
  width: number,
  height: number,
  palette: readonly Rgba[],
  xor: Uint8Array,
  and: Uint8Array,
): Uint8Array => {
  const output = new Uint8Array(12 + palette.length * 3 + xor.byteLength + and.byteLength)
  const view = new DataView(output.buffer)
  view.setUint32(0, 12, true)
  view.setUint16(4, width, true)
  view.setUint16(6, height * 2, true)
  view.setUint16(8, 1, true)
  view.setUint16(10, 1, true)
  for (let index = 0; index < palette.length; index += 1) {
    const color = palette[index]
    if (!color) continue
    output.set([color[2], color[1], color[0]], 12 + index * 3)
  }
  output.set(xor, 12 + palette.length * 3)
  output.set(and, 12 + palette.length * 3 + xor.byteLength)
  return output
}

const decodedPng = async (input: Uint8Array): Promise<PNG> =>
  PNG.sync.read(await (await images.open(input)).png().toBuffer())

const pixel = (image: PNG, x: number, y: number): Rgba => {
  const offset = (y * image.width + x) * 4
  return [
    image.data[offset] ?? -1,
    image.data[offset + 1] ?? -1,
    image.data[offset + 2] ?? -1,
    image.data[offset + 3] ?? -1,
  ]
}

describe('ICO codec', () => {
  it('decodes the pinned mixed and DIB benchmark fixtures', async () => {
    const mixed = await readFile('benchmark/corpus/files/ico-mixed-16-32-256.ico')
    const dib32 = await readFile('benchmark/corpus/files/ico-dib32-alpha-128.ico')
    const dib24 = await readFile('benchmark/corpus/files/ico-dib24-mask-96.ico')

    await expect((await images.open(mixed)).metadata()).resolves.toMatchObject({
      format: 'ico',
      width: 256,
      height: 256,
      frames: 3,
    })
    expect(pixel(await decodedPng(mixed), 128, 128)).toEqual([128, 128, 0, 128])
    expect(pixel(await decodedPng(dib32), 64, 64)).toEqual([192, 64, 128, 192])
    expect(pixel(await decodedPng(dib24), 48, 48)).toEqual([129, 129, 192, 255])
  })

  it('selects the largest PNG entry and preserves embedded alpha', async () => {
    const input = iconFixture([
      { width: 16, height: 16, bitDepth: 32, data: pngFixture(16, 16, [240, 20, 10, 255]) },
      { width: 32, height: 32, bitDepth: 32, data: pngFixture(32, 32, [10, 30, 220, 73]) },
    ])
    const image = await images.open(input)

    await expect(image.metadata()).resolves.toMatchObject({
      format: 'ico',
      mimeType: 'image/x-icon',
      width: 32,
      height: 32,
      bitDepth: 8,
      hasAlpha: true,
      frames: 2,
    })
    const decoded = await decodedPng(input)
    expect(pixel(decoded, 4, 7)).toEqual([10, 30, 220, 73])
  })

  it('decodes bottom-up 24-bit DIB pixels and the independent AND mask', async () => {
    const dib = dibFixture({
      width: 3,
      height: 2,
      bitDepth: 24,
      xor: Uint8Array.from([
        255, 255, 255, 0, 0, 0, 0, 255, 255, 0, 0, 0, 0, 0, 255, 0, 255, 0, 255, 0, 0, 0, 0, 0,
      ]),
      and: Uint8Array.from([0, 0, 0, 0, 0x40, 0, 0, 0]),
    })
    const input = iconFixture([{ width: 3, height: 2, bitDepth: 24, data: dib }])
    const decoded = await decodedPng(input)

    expect(pixel(decoded, 0, 0)).toEqual([255, 0, 0, 255])
    expect(pixel(decoded, 1, 0)).toEqual([0, 255, 0, 0])
    expect(pixel(decoded, 2, 0)).toEqual([0, 0, 255, 255])
    expect(pixel(decoded, 0, 1)).toEqual([255, 255, 255, 255])
  })

  it('decodes packed palettes with mask transparency', async () => {
    const dib = dibFixture({
      width: 3,
      height: 1,
      bitDepth: 4,
      palette: [
        [255, 0, 0, 255],
        [0, 255, 0, 255],
        [0, 0, 255, 255],
      ],
      xor: Uint8Array.from([0x01, 0x20, 0, 0]),
      and: Uint8Array.from([0x20, 0, 0, 0]),
    })
    const input = iconFixture([{ width: 3, height: 1, bitDepth: 4, colorCount: 3, data: dib }])
    const decoded = await decodedPng(input)

    expect(pixel(decoded, 0, 0)).toEqual([255, 0, 0, 255])
    expect(pixel(decoded, 1, 0)).toEqual([0, 255, 0, 255])
    expect(pixel(decoded, 2, 0)).toEqual([0, 0, 255, 0])
  })

  it('decodes OS/2 core headers and 16-bit RGB555 pixels', async () => {
    const core = iconFixture([
      {
        width: 2,
        height: 1,
        bitDepth: 1,
        colorCount: 2,
        data: coreDibFixture(
          2,
          1,
          [
            [0, 0, 0, 255],
            [255, 255, 255, 255],
          ],
          Uint8Array.from([0x40, 0, 0, 0]),
          Uint8Array.from([0, 0, 0, 0]),
        ),
      },
    ])
    const rgb555 = iconFixture([
      {
        width: 2,
        height: 1,
        bitDepth: 16,
        data: dibFixture({
          width: 2,
          height: 1,
          bitDepth: 16,
          xor: Uint8Array.from([0x00, 0x7c, 0xe0, 0x03]),
          and: Uint8Array.from([0x40, 0, 0, 0]),
        }),
      },
    ])

    const coreDecoded = await decodedPng(core)
    expect(pixel(coreDecoded, 0, 0)).toEqual([0, 0, 0, 255])
    expect(pixel(coreDecoded, 1, 0)).toEqual([255, 255, 255, 255])
    const rgb555Decoded = await decodedPng(rgb555)
    expect(pixel(rgb555Decoded, 0, 0)).toEqual([255, 0, 0, 255])
    expect(pixel(rgb555Decoded, 1, 0)).toEqual([0, 255, 0, 0])
  })

  it('preserves 32-bit partial alpha and falls back for all-zero legacy alpha', async () => {
    const partial = iconFixture([
      {
        width: 2,
        height: 1,
        bitDepth: 32,
        data: dibFixture({
          width: 2,
          height: 1,
          bitDepth: 32,
          xor: Uint8Array.from([30, 20, 10, 40, 90, 80, 70, 200]),
          and: Uint8Array.from([0, 0, 0, 0]),
        }),
      },
    ])
    const legacy = iconFixture([
      {
        width: 2,
        height: 1,
        bitDepth: 32,
        data: dibFixture({
          width: 2,
          height: 1,
          bitDepth: 32,
          xor: Uint8Array.from([30, 20, 10, 0, 90, 80, 70, 0]),
          and: Uint8Array.from([0x40, 0, 0, 0]),
        }),
      },
    ])

    const partialDecoded = await decodedPng(partial)
    expect(pixel(partialDecoded, 0, 0)).toEqual([10, 20, 30, 40])
    expect(pixel(partialDecoded, 1, 0)).toEqual([70, 80, 90, 200])
    const legacyDecoded = await decodedPng(legacy)
    expect(pixel(legacyDecoded, 0, 0)).toEqual([10, 20, 30, 255])
    expect(pixel(legacyDecoded, 1, 0)).toEqual([70, 80, 90, 0])
  })

  it('rejects malformed directories, payload extents, and DIB heights explicitly', async () => {
    const empty = Uint8Array.of(0, 0, 1, 0, 0, 0)
    await expect((await images.open(empty)).metadata()).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })

    const outOfBounds = iconFixture([
      { width: 1, height: 1, bitDepth: 32, data: pngFixture(1, 1, [0, 0, 0, 0]) },
    ])
    new DataView(outOfBounds.buffer).setUint32(18, outOfBounds.byteLength, true)
    await expect((await images.open(outOfBounds)).metadata()).rejects.toMatchObject({
      code: 'TRUNCATED_INPUT',
    })

    const dib = dibFixture({
      width: 1,
      height: 1,
      bitDepth: 24,
      xor: Uint8Array.from([0, 0, 0, 0]),
      and: Uint8Array.from([0, 0, 0, 0]),
    })
    new DataView(dib.buffer).setInt32(8, 3, true)
    const oddHeight = iconFixture([{ width: 1, height: 1, bitDepth: 24, data: dib }])
    await expect((await images.open(oddHeight)).metadata()).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
  })
})
