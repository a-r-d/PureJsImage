import { deflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'

import { crc32 } from '../src/codecs/crc32.ts'
import type { ImageSource } from '../src/index.ts'
import { Image } from './image-library.ts'

const pngSignature = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10)

const pngChunk = (type: string, payload: Uint8Array): Buffer => {
  const encodedType = Buffer.from(type, 'ascii')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(payload.byteLength)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(encodedType, payload))
  return Buffer.concat([length, encodedType, payload, checksum])
}

const pngHeader = (width: number, height: number): Buffer => {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 6, 0, 0, 0], 8)
  return Buffer.concat([pngSignature, pngChunk('IHDR', header)])
}

class SparsePngSource implements ImageSource {
  readonly size: number
  readonly #prefix: Uint8Array
  reads = 0

  constructor(idatBytes: number) {
    const idatHeader = Buffer.alloc(8)
    idatHeader.writeUInt32BE(idatBytes)
    idatHeader.write('IDAT', 4, 'ascii')
    this.#prefix = Buffer.concat([pngHeader(1, 1), idatHeader])
    this.size = this.#prefix.byteLength + idatBytes + 4 + 12
  }

  async read(offset: number, length: number): Promise<Uint8Array> {
    this.reads += 1
    const available = offset >= this.size ? 0 : Math.min(length, this.size - offset)
    const output = new Uint8Array(available)
    if (offset < this.#prefix.byteLength) {
      output.set(
        this.#prefix.subarray(offset, Math.min(this.#prefix.byteLength, offset + available)),
      )
    }
    return output
  }
}

const streamingPngBomb = (): Buffer => {
  const inflated = new Uint8Array(4 * 1_024 * 1_024)
  return Buffer.concat([
    pngHeader(1, 1),
    pngChunk('IDAT', deflateSync(inflated)),
    pngChunk('IEND', new Uint8Array()),
  ])
}

const expandingGif = (): Uint8Array =>
  Uint8Array.of(
    0x47,
    0x49,
    0x46,
    0x38,
    0x39,
    0x61,
    1,
    0,
    1,
    0,
    0x80,
    0,
    0,
    0,
    0,
    0,
    0xff,
    0xff,
    0xff,
    0x2c,
    0,
    0,
    0,
    0,
    1,
    0,
    1,
    0,
    0,
    2,
    2,
    0x04,
    0x0a,
    0,
    0x3b,
  )

describe('decompression bomb limits', () => {
  it('rejects a virtual 1x1 PNG with a 500 MiB IDAT before reading it', async () => {
    const source = new SparsePngSource(500 * 1_024 * 1_024)

    await expect(Image.open(source)).rejects.toMatchObject({
      code: 'LIMIT_EXCEEDED',
      message: expect.stringContaining('maxInputBytes'),
    })
    expect(source.reads).toBe(0)
  })

  it('enforces maxDecodedBytes against streamed PNG expansion', async () => {
    const image = await Image.open(streamingPngBomb(), { limits: { maxDecodedBytes: 1_024 } })

    await expect(image.png().toBuffer()).rejects.toMatchObject({
      code: 'LIMIT_EXCEEDED',
      message: expect.stringContaining('maxDecodedBytes'),
    })
  })

  it('stops GIF LZW expansion at the declared pixel count', async () => {
    await expect((await Image.open(expandingGif())).png().toBuffer()).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: expect.stringContaining('too many pixels'),
    })
  })
})
