import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { openTiffDocument } from '../src/codecs/tiff.ts'
import type { PixelBlock } from '../src/pixel.ts'
import type { RasterBlock } from '../src/raster.ts'
import { ScientificReaderRegistry } from '../src/scientific/reader.ts'
import { tiffReader } from '../src/scientific/readers/tiff.ts'
import { MemorySource } from '../src/source.ts'
import {
  inspectCog,
  tiffCompressionCapabilities,
  tiffCompressionCapability,
} from '../src/tiff/index.ts'
import type { TiffDirectory, TiffDocument } from '../src/tiff/types.ts'
import fixtureManifest from './fixtures/cog/manifest.json' with { type: 'json' }

const fixture = async (filename: string): Promise<Uint8Array> =>
  Uint8Array.from(await readFile(new URL(`./fixtures/cog/${filename}`, import.meta.url)))

const collectRaster = async (
  blocks: AsyncIterable<RasterBlock>,
): Promise<readonly RasterBlock[]> => {
  const result: RasterBlock[] = []
  for await (const block of blocks) result.push(block)
  return result
}

const collectPixels = async (blocks: AsyncIterable<PixelBlock>): Promise<readonly PixelBlock[]> => {
  const result: PixelBlock[] = []
  for await (const block of blocks) result.push(block)
  return result
}

const openScientific = async (bytes: Uint8Array) =>
  new ScientificReaderRegistry([tiffReader]).open({
    primary: { id: 'cog', name: 'fixture.tif', source: new MemorySource(bytes) },
  })

const setClassicCompression = (bytes: Uint8Array, compression: number): Uint8Array => {
  const output = Uint8Array.from(bytes)
  const view = new DataView(output.buffer)
  const littleEndian = output[0] === 0x49
  const ifdOffset = view.getUint32(4, littleEndian)
  const entries = view.getUint16(ifdOffset, littleEndian)
  for (let index = 0; index < entries; index += 1) {
    const offset = ifdOffset + 2 + index * 12
    if (view.getUint16(offset, littleEndian) === 259) {
      view.setUint16(offset + 8, compression, littleEndian)
      return output
    }
  }
  throw new Error('Fixture compression tag is missing')
}

describe('Cloud Optimized GeoTIFF compatibility corpus', () => {
  it('is deterministic and covers every required COG fixture dimension', async () => {
    expect(fixtureManifest.generator).toBe('node scripts/generate-cog-fixtures.ts')
    const compressionIds = new Set<number>()
    for (const entry of fixtureManifest.fixtures) {
      const bytes = await fixture(entry.filename)
      expect(createHash('sha256').update(bytes).digest('hex'), entry.filename).toBe(entry.sha256)
      expect(bytes.byteLength, entry.filename).toBe(entry.bytes)
      for (const compression of entry.compressionIds) compressionIds.add(compression)
    }
    expect(compressionIds).toEqual(new Set([5, 7, 8, 32773]))
    expect(fixtureManifest.fixtures.some(({ container }) => container === 'BigTIFF')).toBe(true)
    expect(fixtureManifest.fixtures.some(({ levels }) => levels.length > 1)).toBe(true)
  })

  it('inspects tiled Classic TIFF, Deflate RGB, scalar nodata, and north-up geometry', async () => {
    const bytes = await fixture('classic-deflate-rgb-nodata.tif')
    const document = await openTiffDocument(new MemorySource(bytes))
    const inspection = await inspectCog(document)
    expect(inspection).toMatchObject({
      container: 'TIFF',
      byteOrder: 'little-endian',
      topLevelDirectoryCount: 1,
      likelyCog: true,
      directories: [
        {
          path: 'ifd[0]',
          role: 'image',
          width: 16,
          height: 16,
          tiled: true,
          tileWidth: 8,
          tileHeight: 8,
          tileCount: 4,
          compression: { id: 8, name: 'Deflate', status: 'fully-tested' },
          samplesPerPixel: 3,
        },
      ],
    })
    expect(inspection.issues.map(({ code }) => code)).toEqual(['MISSING_INTERNAL_OVERVIEWS'])

    const dataset = await (await openScientific(bytes)).openDataset('series-0')
    expect(dataset.descriptor.spatialReference).toMatchObject({
      crs: { kind: 'projected', authority: 'EPSG', code: 32618 },
      pixelInterpretation: 'pixel-is-area',
      pixelToModel: [2, 0, 500_000, 0, -2, 4_500_000],
      noData: { kind: 'scalar', value: 0 },
    })
    const blocks = await collectRaster(
      dataset.readPlane({
        displayAxes: ['x', 'y'],
        fixedIndices: [],
        x: 0,
        y: 0,
        width: 1,
        height: 1,
      }),
    )
    expect(Array.from(blocks[0]?.data ?? [])).toEqual([3, 64, 125])
  })

  it('decodes tiled BigTIFF LZW RGBA and component nodata', async () => {
    const bytes = await fixture('bigtiff-lzw-rgba.tif')
    const document = await openTiffDocument(new MemorySource(bytes))
    const inspection = await inspectCog(document)
    expect(inspection).toMatchObject({
      container: 'BigTIFF',
      likelyCog: true,
      directories: [
        {
          tiled: true,
          tileWidth: 4,
          tileHeight: 4,
          tileCount: 4,
          compression: { id: 5, name: 'LZW', status: 'fully-tested' },
          samplesPerPixel: 4,
        },
      ],
    })
    const directory = document.topLevelDirectories[0]
    if (directory === undefined) throw new Error('BigTIFF fixture directory is missing')
    const decoder = await directory.createRasterDecoder()
    const blocks = await collectRaster(decoder.decode({ x: 2, y: 3, width: 1, height: 1 }))
    expect(Array.from(blocks[0]?.data ?? [])).toEqual([124, 185, 246, 127])

    const dataset = await (await openScientific(bytes)).openDataset('series-0')
    expect(dataset.descriptor.spatialReference).toMatchObject({
      pixelInterpretation: 'pixel-is-point',
      noData: { kind: 'components', values: [0, 0, 0, 255] },
    })
  })

  it('asserts internal SubIFD overview layout and rotated affine propagation', async () => {
    const bytes = await fixture('subifd-deflate-rotated.tif')
    const document = await openTiffDocument(new MemorySource(bytes))
    const inspection = await inspectCog(document)
    expect(inspection.likelyCog).toBe(true)
    expect(inspection.issues).toEqual([])
    expect(inspection.directories).toMatchObject([
      {
        path: 'ifd[0]',
        role: 'image',
        width: 32,
        height: 32,
        subIfdOffsets: [expect.any(Number)],
        compression: { id: 8, name: 'Deflate' },
      },
      {
        path: 'ifd[0]/subifd[0]',
        role: 'overview',
        width: 16,
        height: 16,
        compression: { id: 8, name: 'Deflate' },
      },
    ])
    expect(
      (inspection.directories[0]?.offset ?? 0) < (inspection.directories[0]?.firstTileOffset ?? 0),
    ).toBe(true)
    expect(
      (inspection.directories[1]?.offset ?? 0) < (inspection.directories[0]?.firstTileOffset ?? 0),
    ).toBe(true)

    const dataset = await (await openScientific(bytes)).openDataset('series-0')
    expect(dataset.descriptor.spatialReference?.pixelToModel).toEqual([2, 0.5, 100, -0.25, -2, 200])
    expect(dataset.descriptor.levels?.[1]).toMatchObject({
      axisLengths: [
        { axisId: 'x', length: 16 },
        { axisId: 'y', length: 16 },
      ],
      spatialReference: {
        pixelToModel: [4, 1, 100, -0.5, -4, 200],
      },
    })
    const blocks = await collectRaster(
      dataset.readPlane({
        displayAxes: ['x', 'y'],
        fixedIndices: [],
        resolutionLevel: 1,
        x: 4,
        y: 4,
        width: 2,
        height: 2,
      }),
    )
    expect(blocks).toMatchObject([{ width: 2, height: 2 }])
  })

  it('decodes PackBits tiles through native raster output', async () => {
    const bytes = await fixture('classic-packbits-gray.tif')
    const document = await openTiffDocument(new MemorySource(bytes))
    const directory = document.topLevelDirectories[0]
    if (directory === undefined) throw new Error('PackBits fixture directory is missing')
    expect((await inspectCog(document)).directories[0]?.compression).toEqual({
      id: 32773,
      name: 'PackBits',
      status: 'fully-tested',
    })
    const blocks = await collectRaster(
      (await directory.createRasterDecoder()).decode({ x: 9, y: 3, width: 1, height: 1 }),
    )
    expect(Array.from(blocks[0]?.data ?? [])).toEqual([(9 * 17 + 3 * 29 + 3) & 0xff])
  })

  it('decodes JPEG-in-TIFF tiles on the supported display path', async () => {
    const bytes = await fixture('classic-jpeg-rgb.tif')
    const document = await openTiffDocument(new MemorySource(bytes))
    const directory = document.topLevelDirectories[0]
    if (directory === undefined) throw new Error('JPEG fixture directory is missing')
    expect((await inspectCog(document)).directories[0]?.compression).toEqual({
      id: 7,
      name: 'JPEG',
      status: 'fully-tested',
    })
    const blocks = await collectPixels(
      (await directory.createImageDecoder()).decode({ x: 0, y: 0, width: 9, height: 1 }),
    )
    const data = blocks[0]?.data ?? new Uint8Array()
    expect(Array.from(data.subarray(0, 3))).toEqual([
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
    ])
    expect(data[0]).toBeGreaterThan(210)
    expect(data[1]).toBeLessThan(60)
    expect(data[8 * 3]).toBeLessThan(50)
    expect(data[8 * 3 + 2]).toBeGreaterThan(180)
    await expect(directory.createRasterDecoder()).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
      message: 'TIFF compression 7 (JPEG) is unsupported for native raster decoding',
    })
  })

  it('keeps the compression audit synchronized and names unsupported IDs explicitly', async () => {
    const implementedIds = [
      1, 2, 3, 4, 5, 6, 7, 8, 32773, 32946, 33003, 33005, 34676, 34677, 34887, 50000, 50001,
    ]
    expect(
      tiffCompressionCapabilities
        .filter(({ decodeSupport }) => decodeSupport !== 'unsupported')
        .map(({ id }) => id),
    ).toEqual(implementedIds)
    expect(tiffCompressionCapability(32809)).toMatchObject({
      name: 'ThunderScan',
      status: 'recognized-but-unsupported',
    })
    expect(tiffCompressionCapability(34712)).toMatchObject({
      name: 'JPEG 2000',
      status: 'not-implemented',
    })
    expect(tiffCompressionCapability(50002)).toMatchObject({
      name: 'JPEG XL',
      status: 'not-implemented',
    })

    const base = await fixture('classic-packbits-gray.tif')
    for (const [id, name] of [
      [32809, 'ThunderScan'],
      [34712, 'JPEG 2000'],
      [50002, 'JPEG XL'],
      [65000, 'Unknown TIFF compression'],
    ] as const) {
      const document = await openTiffDocument(new MemorySource(setClassicCompression(base, id)))
      const directory = document.topLevelDirectories[0]
      if (directory === undefined) throw new Error('Unsupported fixture directory is missing')
      await expect(directory.createImageDecoder()).rejects.toMatchObject({
        code: 'UNSUPPORTED_OPERATION',
        message: `TIFF compression ${id} (${name}) is unsupported`,
      })
    }
  })

  it('inspects large bounded tile tables without spreading offsets onto the call stack', async () => {
    const tileCount = 150_000
    const offsets = Object.freeze(
      Array.from({ length: tileCount }, (_value, index) => 2_000_000 + index * 2),
    )
    const byteCounts = Object.freeze(Array.from({ length: tileCount }, () => 1))
    const directory: TiffDirectory = {
      index: 0,
      offset: 8,
      width: 1,
      height: tileCount,
      compression: 1,
      photometric: 1,
      samplesPerPixel: 1,
      bitsPerSample: Object.freeze([8]),
      sampleFormats: Object.freeze([1]),
      planar: false,
      tiled: true,
      tileWidth: 1,
      tileHeight: 1,
      subIfds: Object.freeze([]),
      getTagInfo: (tag) =>
        tag === 324 || tag === 325
          ? { tag, fieldType: 4, count: tileCount, byteLength: tileCount * 4 }
          : undefined,
      getTag: async (tag) =>
        tag === 324
          ? { kind: 'numbers', values: offsets }
          : tag === 325
            ? { kind: 'numbers', values: byteCounts }
            : undefined,
      createImageDecoder: async () => {
        throw new Error('Large-table inspection must not create an image decoder')
      },
      createRasterDecoder: async () => {
        throw new Error('Large-table inspection must not create a raster decoder')
      },
    }
    const document: TiffDocument = {
      littleEndian: true,
      bigTiff: false,
      directories: Object.freeze([directory]),
      topLevelDirectories: Object.freeze([directory]),
      getDirectory: (index) => (index === 0 ? directory : undefined),
      getDirectoryByOffset: (offset) => (offset === directory.offset ? directory : undefined),
      readBytes: async () => {
        throw new Error('Large-table inspection must not read source bytes')
      },
    }

    const inspection = await inspectCog(document, { maxTagBytes: tileCount * 8 })
    expect(inspection.directories[0]).toMatchObject({
      tileCount,
      firstTileOffset: 2_000_000,
      lastTileOffset: 2_000_000 + (tileCount - 1) * 2,
    })
  })
})
