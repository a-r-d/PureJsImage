import { beforeAll, describe, expect, it } from 'vitest'

import { defaultImageLimits, ImageError, type ImageSource } from '../src/index.ts'
import { createImageSource, SourceReader } from '../src/source.ts'
import { createCodecFixtures, type CodecFixture } from './codec-fixtures.ts'
import { HostileSource } from './hostile-source.ts'
import { Image } from './image-library.ts'

describe('ImageSource buffer lifetime contract', () => {
  let fixtures: readonly CodecFixture[] = []

  beforeAll(async () => {
    fixtures = await createCodecFixtures()
  })

  it('invalidates a previous read as soon as the next source read starts', async () => {
    const reader = new SourceReader(new HostileSource(Uint8Array.of(1, 2, 3, 4)), 0, 2)
    const retained = await reader.read(2)

    expect([...retained]).toEqual([1, 2])
    expect([...(await reader.read(2))]).toEqual([3, 4])
    expect([...retained]).toEqual([0, 0])
  })

  it('keeps every registered codec correct when source buffers expire between reads', async () => {
    expect(fixtures.map((fixture) => fixture.format)).toEqual(Image.formats())

    for (const fixture of fixtures) {
      const reference = await Image.open(fixture.input)
      const expectedMetadata = await reference.metadata()
      const expected = await reference
        .crop({ x: 0, y: 0, width: Math.min(4, expectedMetadata.width), height: 3 })
        .png()
        .toBuffer()

      const hostile = await Image.open(new HostileSource(fixture.input))
      expect(await hostile.metadata(), fixture.format).toEqual(expectedMetadata)
      const actual = await hostile
        .crop({ x: 0, y: 0, width: Math.min(4, expectedMetadata.width), height: 3 })
        .png()
        .toBuffer()

      expect(actual, fixture.format).toEqual(expected)
    }
  }, 20_000)
})

describe('ImageSource return-value contract', () => {
  const sourceSize = 524_288

  const wrappedSource = async (
    read: ImageSource['read'],
  ): Promise<Awaited<ReturnType<typeof createImageSource>>> =>
    createImageSource({ read, size: sourceSize }, defaultImageLimits)

  it('normalizes short and detached reads as truncated ImageErrors', async () => {
    const short = await wrappedSource(async (_offset, length) => new Uint8Array(length - 1))
    await expect(short.read(0, 8)).rejects.toMatchObject({
      code: 'TRUNCATED_INPUT',
      name: 'ImageError',
    })

    const detached = new Uint8Array(262_144)
    structuredClone(detached.buffer, { transfer: [detached.buffer] })
    const detachedSource = await wrappedSource(async () => detached)
    await expect(detachedSource.read(0, 8)).rejects.toMatchObject({
      code: 'TRUNCATED_INPUT',
      name: 'ImageError',
    })
  })

  it('rejects reads that return more data than requested', async () => {
    const source = await wrappedSource(async (_offset, length) => new Uint8Array(length + 1))

    await expect(source.read(0, 8)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      name: 'ImageError',
    })
  })

  it('normalizes a raw reader failure after a successful source read', async () => {
    const rawFailure = new Error('remote range request failed')
    let reads = 0
    const source = await wrappedSource(async (_offset, length) => {
      reads += 1
      if (reads === 2) throw rawFailure
      return new Uint8Array(length)
    })

    await expect(source.read(0, 8)).resolves.toHaveLength(8)

    let failure: unknown
    try {
      await source.read(262_144, 8)
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(ImageError)
    expect(failure).toMatchObject({ code: 'INVALID_INPUT', name: 'ImageError' })
    if (!(failure instanceof ImageError)) throw new Error('Expected an ImageError')
    expect(failure.cause).toBe(rawFailure)
  })
})
