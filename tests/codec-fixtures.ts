import { readFile } from 'node:fs/promises'
import { GifWriter } from 'omggif'
import { PNG } from 'pngjs'

import type { BuiltInFormat } from '../src/index.ts'
import { Image } from './image-library.ts'

export interface CodecFixture {
  readonly format: BuiltInFormat
  readonly input: Uint8Array
}

const noisyPng = (): Buffer => {
  const image = new PNG({ width: 32, height: 32 })
  let state = 0x91e1_0da5
  for (let offset = 0; offset < image.data.byteLength; offset += 4) {
    state = (Math.imul(state ^ (state >>> 15), 2_246_822_519) + 3_266_489_917) >>> 0
    image.data[offset] = state & 0xff
    image.data[offset + 1] = (state >>> 8) & 0xff
    image.data[offset + 2] = (state >>> 16) & 0xff
    image.data[offset + 3] = 64 + (state >>> 26)
  }
  return PNG.sync.write(image)
}

const gifFixture = (): Uint8Array => {
  const output = new Uint8Array(16_384)
  const writer = new GifWriter(output, 32, 32)
  const palette = [0x000000, 0x2244aa, 0x44aa22, 0xaa4422, 0xeeeeee, 0xcc22aa, 0x22cccc, 0xffcc22]
  writer.addFrame(
    0,
    0,
    32,
    32,
    Array.from({ length: 1_024 }, (_, index) => (index * 13 + Math.floor(index / 32) * 3) & 7),
    { palette },
  )
  return output.slice(0, writer.end())
}

const icoFixture = (png: Uint8Array, width: number, height: number): Uint8Array => {
  const output = new Uint8Array(22 + png.byteLength)
  const view = new DataView(output.buffer)
  view.setUint16(2, 1, true)
  view.setUint16(4, 1, true)
  output[6] = width === 256 ? 0 : width
  output[7] = height === 256 ? 0 : height
  view.setUint16(10, 1, true)
  view.setUint16(12, 32, true)
  view.setUint32(14, png.byteLength, true)
  view.setUint32(18, 22, true)
  output.set(png, 22)
  return output
}

export const createCodecFixtures = async (): Promise<readonly CodecFixture[]> => {
  const png = noisyPng()
  return [
    { format: 'jpeg', input: await (await Image.open(png)).jpeg({ quality: 90 }).toBuffer() },
    {
      format: 'jp2',
      input: await readFile('benchmark/corpus/files/jp2/openjpeg-lossless-rgb16.jp2'),
    },
    { format: 'png', input: png },
    { format: 'gif', input: gifFixture() },
    { format: 'webp', input: await (await Image.open(png)).webp({ lossless: true }).toBuffer() },
    {
      format: 'avif',
      input: await readFile('benchmark/corpus/files/avif/fox.profile0.8bpc.yuv420.avif'),
    },
    { format: 'bmp', input: await (await Image.open(png)).bmp().toBuffer() },
    { format: 'ico', input: icoFixture(png, 32, 32) },
    { format: 'tiff', input: await (await Image.open(png)).tiff().toBuffer() },
  ]
}
