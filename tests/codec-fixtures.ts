import { readFile } from 'node:fs/promises'
import { GifWriter } from 'omggif'
import { PNG } from 'pngjs'

import type { BuiltInFormat } from '../src/index.ts'
import { Image } from './image-library.ts'

export interface CodecFixture {
  readonly format: BuiltInFormat
  readonly input: Uint8Array
}

const compactHeifFixture = Buffer.from(
  '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',
  'base64',
)

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
    { format: 'heif', input: compactHeifFixture },
    { format: 'bmp', input: await (await Image.open(png)).bmp().toBuffer() },
    { format: 'ico', input: icoFixture(png, 32, 32) },
    { format: 'tiff', input: await (await Image.open(png)).tiff().toBuffer() },
  ]
}
