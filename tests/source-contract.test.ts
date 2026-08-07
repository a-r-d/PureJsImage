import { beforeAll, describe, expect, it } from 'vitest'

import { SourceReader } from '../src/source.ts'
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
