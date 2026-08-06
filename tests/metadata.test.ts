import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { CodecRegistry, Image, type ImageCodec } from '../src/index.ts'
import { gifFixture, jpegFixture, pngFixture } from './fixtures.ts'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })))
})

describe('image metadata', () => {
  it('detects PNG metadata from a Uint8Array', async () => {
    const metadata = await (await Image.open(pngFixture(320, 200))).metadata()

    expect(metadata).toMatchObject({
      width: 320,
      height: 200,
      format: 'png',
      mimeType: 'image/png',
      hasAlpha: true,
      colorSpace: 'srgb',
      bitDepth: 8,
      frames: 1,
    })
  })

  it('detects JPEG EXIF orientation from an ArrayBuffer', async () => {
    const fixture = jpegFixture(120, 80, 6)
    const input = fixture.buffer.slice(fixture.byteOffset, fixture.byteOffset + fixture.byteLength)
    const metadata = await (await Image.open(input)).metadata()

    expect(metadata).toMatchObject({
      width: 120,
      height: 80,
      format: 'jpeg',
      hasAlpha: false,
      orientation: 6,
    })
  })

  it('counts GIF frames and transparency from a Blob', async () => {
    const metadata = await (await Image.open(new Blob([gifFixture(64, 48, 2)]))).metadata()

    expect(metadata).toMatchObject({
      width: 64,
      height: 48,
      format: 'gif',
      hasAlpha: true,
      frames: 2,
    })
  })

  it('reads metadata from a file without loading through the public API', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'purejsimage-metadata-'))
    temporaryDirectories.push(directory)
    const path = join(directory, 'fixture.png')
    await writeFile(path, pngFixture(40, 30))

    await expect((await Image.open(path)).metadata()).resolves.toMatchObject({
      width: 40,
      height: 30,
    })
  })

  it('rejects unknown, truncated, and over-limit inputs cleanly', async () => {
    await expect(Image.open(Uint8Array.from([1, 2, 3]))).rejects.toMatchObject({
      code: 'UNSUPPORTED_FORMAT',
    })
    await expect(
      (await Image.open(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]))).metadata(),
    ).rejects.toMatchObject({
      code: 'TRUNCATED_INPUT',
    })
    await expect(
      (await Image.open(pngFixture(101, 10), { limits: { maxWidth: 100 } })).metadata(),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
  })

  it('shares one metadata read across immutable pipeline branches', async () => {
    let reads = 0
    const codec: ImageCodec = {
      format: 'test',
      mimeTypes: ['image/test'],
      minimumBytes: 1,
      detect: (header) => header[0] === 42,
      metadata: async () => {
        reads += 1
        return {
          width: 20,
          height: 10,
          format: 'test',
          mimeType: 'image/test',
          hasAlpha: false,
        }
      },
    }
    const image = await Image.open(Uint8Array.of(42), { registry: new CodecRegistry([codec]) })

    await Promise.all([image.metadata(), image.resize({ width: 10 }).metadata()])
    expect(reads).toBe(1)
  })
})
