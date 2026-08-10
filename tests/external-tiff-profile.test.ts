import { describe, expect, it } from 'vitest'
import { isLeicaScn, leicaScnProfile, openLeicaScn } from '../examples/tiff-profile-leica/index.ts'
import { openTiffDocument } from '../src/codecs/tiff.ts'
import type { PixelBlock } from '../src/pixel.ts'
import { MemorySource } from '../src/source.ts'
import { createTiffProfileRegistry } from '../src/tiff/profiles.ts'

interface FixtureDirectory {
  readonly width: number
  readonly height: number
  readonly pixels: Uint8Array
  readonly description?: string
}

const leicaFixture = (directories: readonly FixtureDirectory[]): Uint8Array => {
  const ifdOffsets: number[] = []
  let cursor = 8
  for (const directory of directories) {
    ifdOffsets.push(cursor)
    const entries = directory.description === undefined ? 11 : 12
    cursor += 2 + entries * 12 + 4
  }
  const descriptionOffsets = new Map<number, number>()
  const descriptionBytes = new Map<number, Uint8Array>()
  for (let index = 0; index < directories.length; index += 1) {
    const description = directories[index]?.description
    if (description === undefined) continue
    const encoded = Uint8Array.from([...new TextEncoder().encode(description), 0])
    descriptionOffsets.set(index, cursor)
    descriptionBytes.set(index, encoded)
    cursor += encoded.byteLength
  }
  const pixelOffsets: number[] = []
  for (const directory of directories) {
    pixelOffsets.push(cursor)
    cursor += directory.pixels.byteLength
  }

  const output = new Uint8Array(cursor)
  const view = new DataView(output.buffer)
  output.set([0x49, 0x49, 0x2a, 0])
  view.setUint32(4, 8, true)
  for (let directoryIndex = 0; directoryIndex < directories.length; directoryIndex += 1) {
    const directory = directories[directoryIndex]
    if (!directory) continue
    const entries: {
      readonly tag: number
      readonly type: 2 | 3 | 4
      readonly count: number
      readonly value: number
    }[] = [
      { tag: 256, type: 4, count: 1, value: directory.width },
      { tag: 257, type: 4, count: 1, value: directory.height },
      { tag: 258, type: 3, count: 1, value: 8 },
      { tag: 259, type: 3, count: 1, value: 1 },
      { tag: 262, type: 3, count: 1, value: 1 },
      ...(directory.description === undefined
        ? []
        : [
            {
              tag: 270,
              type: 2 as const,
              count: descriptionBytes.get(directoryIndex)?.byteLength ?? 0,
              value: descriptionOffsets.get(directoryIndex) ?? 0,
            },
          ]),
      { tag: 277, type: 3, count: 1, value: 1 },
      { tag: 284, type: 3, count: 1, value: 1 },
      { tag: 322, type: 4, count: 1, value: directory.width },
      { tag: 323, type: 4, count: 1, value: directory.height },
      { tag: 324, type: 4, count: 1, value: pixelOffsets[directoryIndex] ?? 0 },
      { tag: 325, type: 4, count: 1, value: directory.pixels.byteLength },
    ]
    entries.sort((left, right) => left.tag - right.tag)
    const ifdOffset = ifdOffsets[directoryIndex] ?? 0
    view.setUint16(ifdOffset, entries.length, true)
    for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
      const entry = entries[entryIndex]
      if (!entry) continue
      const offset = ifdOffset + 2 + entryIndex * 12
      view.setUint16(offset, entry.tag, true)
      view.setUint16(offset + 2, entry.type, true)
      view.setUint32(offset + 4, entry.count, true)
      if (entry.type === 3) view.setUint16(offset + 8, entry.value, true)
      else view.setUint32(offset + 8, entry.value, true)
    }
    view.setUint32(ifdOffset + 2 + entries.length * 12, ifdOffsets[directoryIndex + 1] ?? 0, true)
    const encodedDescription = descriptionBytes.get(directoryIndex)
    const descriptionOffset = descriptionOffsets.get(directoryIndex)
    if (encodedDescription && descriptionOffset !== undefined) {
      output.set(encodedDescription, descriptionOffset)
    }
    output.set(directory.pixels, pixelOffsets[directoryIndex] ?? 0)
  }
  return output
}

const leicaXml = `<scn xmlns="http://www.leica-microsystems.com/scn/2010/10/01">
  <collection sizeX="4000" sizeY="4000">
    <image>
      <view sizeX="2000" sizeY="2000" offsetX="1000" offsetY="1000"/>
      <pixels>
        <dimension ifd="0" sizeX="4" sizeY="4" z="0"/>
        <dimension ifd="1" sizeX="2" sizeY="2" z="0"/>
      </pixels>
    </image>
    <image>
      <view sizeX="4000" sizeY="4000" offsetX="0" offsetY="0"/>
      <pixels><dimension ifd="2" sizeX="2" sizeY="1" z="0"/></pixels>
    </image>
  </collection>
</scn>`

describe('external Leica TIFF profile', () => {
  it('uses only the public TIFF/profile APIs to expose a whole-slide pyramid', async () => {
    const main = new Uint8Array(16)
    main.fill(11)
    const reduced = new Uint8Array(4)
    reduced.fill(22)
    const fixture = leicaFixture([
      { width: 4, height: 4, pixels: main, description: leicaXml },
      { width: 2, height: 2, pixels: reduced },
      { width: 2, height: 1, pixels: Uint8Array.of(7, 8) },
    ])
    const document = await openTiffDocument(new MemorySource(fixture))
    expect(await isLeicaScn(document)).toBe(true)
    const registry = createTiffProfileRegistry([leicaScnProfile])
    await expect(registry.open(document)).resolves.toMatchObject({
      profileId: 'leica-scn-single-area',
    })
    const slide = await openLeicaScn(document)
    expect({
      size: [slide.width, slide.height],
      levels: slide.levels,
      associated: slide.associatedImages.map((image) => image.id),
      micronsPerPixel: slide.micronsPerPixel,
    }).toEqual({
      size: [4, 4],
      levels: [
        { index: 0, width: 4, height: 4, downsample: 1, tileWidth: 4, tileHeight: 4 },
        { index: 1, width: 2, height: 2, downsample: 2, tileWidth: 2, tileHeight: 2 },
      ],
      associated: ['macro'],
      micronsPerPixel: 0.5,
    })
    const blocks: PixelBlock[] = []
    for await (const block of slide.readRegion({ level: 1, x: 0, y: 0, width: 2, height: 2 })) {
      blocks.push(block)
    }
    expect(Array.from(blocks[0]?.data ?? [])).toEqual([22, 22, 22, 22])
    const macro: PixelBlock[] = []
    for await (const block of slide.associatedImages[0]?.read() ?? []) macro.push(block)
    expect(Array.from(macro[0]?.data ?? [])).toEqual([7, 8])
  })

  it('rejects unsafe Leica XML during profile detection without affecting the registry', async () => {
    const unsafeXml = leicaXml.replace(
      '<scn ',
      '<!DOCTYPE scn [<!ENTITY x SYSTEM "file:///etc/passwd">]><scn ',
    )
    const fixture = leicaFixture([
      { width: 1, height: 1, pixels: Uint8Array.of(0), description: unsafeXml },
    ])
    const document = await openTiffDocument(new MemorySource(fixture))
    const report = await createTiffProfileRegistry([leicaScnProfile]).detect(document)
    expect(report.matches).toEqual([])
    expect(report.failures.map((failure) => failure.id)).toEqual(['leica-scn-single-area'])
  })
})
