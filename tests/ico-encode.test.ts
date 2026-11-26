import { decode as decodeBmp } from 'bmp-ts'
import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'

import { syntheticLogoPng } from './helpers/animated-fixtures.ts'
import { Image } from './image-library.ts'

interface IconEntry {
  readonly size: number
  readonly kind: 'bmp' | 'png'
  readonly rgba: Uint8Array
}

/** Reads every ICO entry with independent PNG and BMP decoders. */
const readIcon = (bytes: Uint8Array): IconEntry[] => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  expect(view.getUint16(0, true)).toBe(0)
  expect(view.getUint16(2, true)).toBe(1)
  const entries: IconEntry[] = []
  for (let index = 0; index < view.getUint16(4, true); index += 1) {
    const entry = 6 + index * 16
    const size = bytes[entry] || 256
    const length = view.getUint32(entry + 8, true)
    const offset = view.getUint32(entry + 12, true)
    const data = Buffer.from(bytes.subarray(offset, offset + length))
    if (data[0] === 0x89) {
      const png = PNG.sync.read(data)
      expect({ width: png.width, height: png.height }).toEqual({ width: size, height: size })
      entries.push({ size, kind: 'png', rgba: Uint8Array.from(png.data) })
      continue
    }
    // The DIB stores twice its height for the AND mask; give bmp-ts a plain BMP file.
    expect(data.readInt32LE(8)).toBe(size * 2)
    const dib = Buffer.from(data.subarray(0, 40 + size * size * 4))
    dib.writeInt32LE(size, 8)
    const header = Buffer.alloc(14)
    header.write('BM', 0)
    header.writeUInt32LE(14 + dib.byteLength, 2)
    header.writeUInt32LE(54, 10)
    const bmp = decodeBmp(Buffer.concat([header, dib]), { toRGBA: true })
    expect({ width: bmp.width, height: bmp.height }).toEqual({ width: size, height: size })
    // Every fully transparent pixel is also set in the AND mask.
    const maskRow = Math.ceil(size / 32) * 4
    const mask = 40 + size * size * 4
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const stored = 40 + ((size - 1 - y) * size + x) * 4
        const masked =
          ((data[mask + (size - 1 - y) * maskRow + (x >>> 3)] ?? 0) >> (7 - (x & 7))) & 1
        expect(masked).toBe((data[stored + 3] ?? 0) === 0 ? 1 : 0)
      }
    }
    // bmp-ts ignores 32-bit BI_RGB alpha, so alpha comes from the stored bottom-up rows.
    const rgba = Uint8Array.from(bmp.data)
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        rgba[(y * size + x) * 4 + 3] = data[40 + ((size - 1 - y) * size + x) * 4 + 3] ?? 0
      }
    }
    entries.push({ size, kind: 'bmp', rgba })
  }
  return entries
}

describe('ICO encoding', () => {
  it('writes the default favicon sizes as BMP entries', async () => {
    const logo = syntheticLogoPng(300, 120)
    const icon = await (await Image.open(logo)).ico().toBuffer()
    const entries = readIcon(icon)
    expect(entries.map((entry) => [entry.size, entry.kind])).toEqual([
      [16, 'bmp'],
      [32, 'bmp'],
      [48, 'bmp'],
    ])
    // A wide logo is centered with transparent rows above and below.
    const largest = entries[2]?.rgba ?? new Uint8Array()
    expect(largest[3]).toBe(0)
    expect(largest[(24 * 48 + 24) * 4 + 3]).toBeGreaterThan(0)
  })

  it('writes 256 px as PNG and keeps exact pixels at the source size', async () => {
    const image = new PNG({ width: 32, height: 32 })
    for (let index = 0; index < 32 * 32; index += 1) {
      image.data.set([index & 0xff, (index >> 2) & 0xff, 200, index % 3 === 0 ? 0 : 255], index * 4)
    }
    const input = PNG.sync.write(image, { colorType: 6, inputColorType: 6, bitDepth: 8 })
    const icon = await (await Image.open(input)).ico({ sizes: [256, 32, 32] }).toBuffer()
    const entries = readIcon(icon)
    expect(entries.map((entry) => [entry.size, entry.kind])).toEqual([
      [32, 'bmp'],
      [256, 'png'],
    ])
    const exact = entries[0]?.rgba ?? new Uint8Array()
    for (let index = 0; index < 32 * 32; index += 1) {
      if ((image.data[index * 4 + 3] ?? 0) === 0) {
        expect(exact[index * 4 + 3]).toBe(0)
      } else {
        expect(Array.from(exact.subarray(index * 4, index * 4 + 4))).toEqual(
          Array.from(image.data.subarray(index * 4, index * 4 + 4)),
        )
      }
    }
    const metadata = await (await Image.open(icon)).metadata()
    expect({ format: metadata.format, width: metadata.width }).toEqual({
      format: 'ico',
      width: 256,
    })
  })

  it('rejects invalid icon sizes', async () => {
    const image = await Image.open(PNG.sync.write(new PNG({ width: 2, height: 2 })))
    expect(() => image.ico({ sizes: [] })).toThrow(/ICO sizes/)
    expect(() => image.ico({ sizes: [257] })).toThrow(/ICO sizes/)
    expect(() => image.ico({ sizes: [1.5] })).toThrow(/ICO sizes/)
  })
})
