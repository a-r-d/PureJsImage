import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'

import { createImageLibrary } from '../src/browser.ts'
import { jpegCodec } from '../src/codec-entries/jpeg.ts'
import { pngCodec } from '../src/codec-entries/png.ts'
import { browserRuntime } from '../src/browser-runtime.ts'

const inputPng = (): Uint8Array => {
  const image = new PNG({ width: 3, height: 2 })
  image.data.set([
    255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255, 255, 0, 255, 255, 0, 255, 255,
    255,
  ])
  return PNG.sync.write(image)
}

describe('browser image library', () => {
  const images = createImageLibrary([pngCodec, jpegCodec])

  it('accepts Blob input and returns Uint8Array and Blob output', async () => {
    const image = await images.open(new Blob([Uint8Array.from(inputPng())]))
    await expect(image.metadata()).resolves.toMatchObject({ width: 3, height: 2, format: 'png' })

    const jpeg = await image.jpeg({ quality: 80 }).toUint8Array()
    expect(jpeg).toBeInstanceOf(Uint8Array)
    expect([...jpeg.subarray(0, 2)]).toEqual([0xff, 0xd8])

    const blob = await image.jpeg({ quality: 80 }).toBlob()
    expect(blob.type).toBe('image/jpeg')
    expect(blob.size).toBeGreaterThan(100)
  })

  it('encodes PNG with CompressionStream and keeps output decodable', async () => {
    const output = await (await images.open(inputPng())).png().toUint8Array()
    const decoded = PNG.sync.read(Buffer.from(output))

    expect(decoded.width).toBe(3)
    expect(decoded.height).toBe(2)
    expect([...decoded.data.subarray(0, 4)]).toEqual([255, 0, 0, 255])
  })

  it('uses bounded browser temporary storage for rotation', async () => {
    const output = await (await images.open(inputPng())).rotate(90).png().toUint8Array()
    const decoded = PNG.sync.read(Buffer.from(output))

    expect(decoded.width).toBe(2)
    expect(decoded.height).toBe(3)
  })

  it('keeps a normal 12-megapixel photo within the memory fallback', async () => {
    const expectedBytes = Math.ceil(4032 / 32) * Math.ceil(3024 / 32) * 32 * 32 * 4
    expect(expectedBytes).toBe(49_029_120)
    const store = await browserRuntime.createTemporaryStore({
      expectedBytes,
      prefix: 'purejsimage-browser-test-',
    })
    await store.write(expectedBytes - 4, Uint8Array.of(1, 2, 3, 4))
    const output = new Uint8Array(4)
    await store.read(expectedBytes - 4, output)
    expect(output).toEqual(Uint8Array.of(1, 2, 3, 4))
    await store.close()
  })

  it('still refuses oversized heap storage when persistent browser storage is unavailable', async () => {
    await expect(
      browserRuntime.createTemporaryStore({
        expectedBytes: 65 * 1024 * 1024,
        prefix: 'purejsimage-browser-test-',
      }),
    ).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
      message: expect.stringContaining('exceeds the 64 MiB memory fallback'),
    })
  })

  it('rejects levels that browser CompressionStream cannot honor', async () => {
    await expect(
      (await images.open(inputPng())).png({ compressionLevel: 9 }).toUint8Array(),
    ).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
      message: 'Browser Deflate compression supports the default compressionLevel (6) only',
    })
  })
})
