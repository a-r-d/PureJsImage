import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { openTiffDocument } from '../src/codecs/tiff.ts'
import type { RasterBlock } from '../src/raster.ts'
import { ScientificReaderRegistry } from '../src/scientific/reader.ts'
import { tiffReader } from '../src/scientific/readers/tiff.ts'
import type { ImageSource, ImageSourceReadOptions } from '../src/source.ts'
import { MemorySource } from '../src/source.ts'
import type { TiffDirectory } from '../src/tiff/types.ts'
const execFileAsync = promisify(execFile)
const jpegTolerance = 12
const gdalOracle = process.env.PUREJSIMAGE_GDAL_ORACLE === '1'

const fixture = async (filename: string): Promise<Uint8Array> =>
  Uint8Array.from(await readFile(new URL(`./fixtures/cog/${filename}`, import.meta.url)))

const collectRaster = async (
  blocks: AsyncIterable<RasterBlock>,
): Promise<readonly RasterBlock[]> => {
  const result: RasterBlock[] = []
  for await (const block of blocks) result.push(block)
  return result
}

const openScientific = async (source: ImageSource | Uint8Array) =>
  new ScientificReaderRegistry([tiffReader]).open({
    primary: {
      id: 'jpeg-cog',
      name: 'fixture.tif',
      source: source instanceof Uint8Array ? new MemorySource(source) : source,
    },
  })

class RangeTrackingSource implements ImageSource {
  readonly size: number
  reads = 0
  bytesRead = 0
  readonly ranges: { readonly offset: number; readonly length: number }[] = []
  readonly #source: MemorySource

  constructor(bytes: Uint8Array) {
    this.#source = new MemorySource(bytes)
    this.size = bytes.byteLength
  }

  read(
    offset: number,
    length: number,
    options?: Readonly<ImageSourceReadOptions>,
  ): Promise<Uint8Array> {
    this.reads += 1
    this.bytesRead += length
    this.ranges.push(Object.freeze({ offset, length }))
    return this.#source.read(offset, length, options)
  }
}

const jpegTileSample = (sample: number, tileX: number, tileY: number): number => {
  if (sample === 0) return tileX % 2 === 0 ? 230 : 20
  if (sample === 1) return tileY % 2 === 0 ? 35 : 220
  if (sample === 2) return tileX % 2 === 0 ? 45 : 210
  return 70 + ((tileX * 40 + tileY * 55) % 140)
}

const maxAbsError = (actual: readonly number[], expected: readonly number[]): number => {
  let maximum = 0
  const length = Math.min(actual.length, expected.length)
  for (let index = 0; index < length; index += 1) {
    maximum = Math.max(maximum, Math.abs((actual[index] ?? 0) - (expected[index] ?? 0)))
  }
  return maximum
}

const firstDirectory = async (bytes: Uint8Array): Promise<TiffDirectory> => {
  const document = await openTiffDocument(new MemorySource(bytes))
  const directory = document.topLevelDirectories[0]
  if (directory === undefined) throw new Error('TIFF directory is missing')
  return directory
}

const setClassicPhotometric = (bytes: Uint8Array, photometric: number): Uint8Array => {
  const output = Uint8Array.from(bytes)
  const view = new DataView(output.buffer)
  const littleEndian = output[0] === 0x49
  const ifdOffset = view.getUint32(4, littleEndian)
  const entries = view.getUint16(ifdOffset, littleEndian)
  for (let index = 0; index < entries; index += 1) {
    const offset = ifdOffset + 2 + index * 12
    if (view.getUint16(offset, littleEndian) !== 262) continue
    view.setUint16(offset + 8, photometric, littleEndian)
    return output
  }
  throw new Error('Photometric tag is missing')
}

const corruptJpegTables = (bytes: Uint8Array): Uint8Array => {
  const output = Uint8Array.from(bytes)
  const view = new DataView(output.buffer)
  const littleEndian = output[0] === 0x49
  const ifdOffset = view.getUint32(4, littleEndian)
  const entries = view.getUint16(ifdOffset, littleEndian)
  for (let index = 0; index < entries; index += 1) {
    const offset = ifdOffset + 2 + index * 12
    if (view.getUint16(offset, littleEndian) !== 347) continue
    const tablesOffset = view.getUint32(offset + 8, littleEndian)
    output[tablesOffset] = 0
    output[tablesOffset + 1] = 0
    return output
  }
  throw new Error('JPEGTables tag is missing')
}

describe('scientific JPEG-in-TIFF native raster', () => {
  it('opens three-band YCbCr JPEG tiles as converted RGB without a display fallback', async () => {
    const bytes = await fixture('classic-jpeg-rgb.tif')
    const document = await openScientific(bytes)
    const dataset = await document.openDataset('series-0')
    expect(dataset.descriptor.sampleType).toBe('uint8')
    expect(dataset.descriptor.components.map(({ id, kind }) => [id, kind])).toEqual([
      ['red', 'red'],
      ['green', 'green'],
      ['blue', 'blue'],
    ])
    expect(dataset.descriptor.metadata?.['purejsimage:tiff']).toMatchObject({
      pages: [{ sampleInterpretation: 'ycbcr-converted-rgb' }],
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
    expect(blocks[0]?.format).toEqual({ sampleType: 'uint8', channels: 3, planar: false })
    expect(maxAbsError(Array.from(blocks[0]?.data ?? []), [230, 35, 45])).toBeLessThanOrEqual(
      jpegTolerance,
    )
  })

  it('preserves four photometric-RGB JPEG components and ExtraSamples=0 as a scalar band', async () => {
    const bytes = await fixture('classic-jpeg-rgb-nir.tif')
    const directory = await firstDirectory(bytes)
    expect(directory.photometric).toBe(2)
    expect(directory.samplesPerPixel).toBe(4)
    expect(await directory.getTag(338)).toEqual({ kind: 'numbers', values: [0] })
    await expect(directory.createImageDecoder()).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
      message: 'TIFF JPEG decoding requires chunky 8-bit grayscale, RGB, YCbCr, or CMYK samples',
    })

    const dataset = await (await openScientific(bytes)).openDataset('series-0')
    expect(dataset.descriptor.components.map(({ id, kind }) => [id, kind])).toEqual([
      ['red', 'red'],
      ['green', 'green'],
      ['blue', 'blue'],
      ['component-4', 'scalar'],
    ])
    expect(dataset.descriptor.metadata?.['purejsimage:tiff']).toMatchObject({
      pages: [{ sampleInterpretation: 'preserved-components' }],
    })
    expect(dataset.descriptor.capabilities.resolutionLevels).toBe(true)
    expect(dataset.descriptor.levels).toHaveLength(2)
    expect(dataset.descriptor.levels[1]?.axisLengths).toEqual([
      { axisId: 'x', length: 10 },
      { axisId: 'y', length: 6 },
    ])

    const interior = await collectRaster(
      dataset.readPlane({
        displayAxes: ['x', 'y'],
        fixedIndices: [],
        x: 0,
        y: 0,
        width: 1,
        height: 1,
      }),
    )
    expect(interior[0]?.format.channels).toBe(4)
    expect(
      maxAbsError(Array.from(interior[0]?.data ?? []), [
        jpegTileSample(0, 0, 0),
        jpegTileSample(1, 0, 0),
        jpegTileSample(2, 0, 0),
        jpegTileSample(3, 0, 0),
      ]),
    ).toBeLessThanOrEqual(jpegTolerance)

    const edge = await collectRaster(
      dataset.readPlane({
        displayAxes: ['x', 'y'],
        fixedIndices: [],
        x: 19,
        y: 11,
        width: 1,
        height: 1,
      }),
    )
    expect(
      maxAbsError(Array.from(edge[0]?.data ?? []), [
        jpegTileSample(0, 2, 1),
        jpegTileSample(1, 2, 1),
        jpegTileSample(2, 2, 1),
        jpegTileSample(3, 2, 1),
      ]),
    ).toBeLessThanOrEqual(jpegTolerance)

    const overview = await collectRaster(
      dataset.readPlane({
        displayAxes: ['x', 'y'],
        fixedIndices: [],
        resolutionLevel: 1,
        x: 0,
        y: 0,
        width: 1,
        height: 1,
      }),
    )
    expect(overview[0]?.format.channels).toBe(4)
    expect(overview[0]?.data.byteLength).toBe(4)
  })

  it('reads only the requested JPEG tiles from a range-backed source', async () => {
    const bytes = await fixture('classic-jpeg-rgb-nir.tif')
    const source = new RangeTrackingSource(bytes)
    const dataset = await (await openScientific(source)).openDataset('series-0')
    source.reads = 0
    source.bytesRead = 0
    source.ranges.splice(0)
    const blocks = await collectRaster(
      dataset.readPlane({
        displayAxes: ['x', 'y'],
        fixedIndices: [],
        x: 18,
        y: 10,
        width: 2,
        height: 2,
      }),
    )
    expect(blocks[0]?.width).toBe(2)
    expect(blocks[0]?.height).toBe(2)
    expect(source.bytesRead).toBeLessThan(bytes.byteLength)
    expect(source.bytesRead).toBeLessThan(2048)
  })

  it('propagates cancellation during a JPEG raster region read', async () => {
    const bytes = await fixture('classic-jpeg-rgb-nir.tif')
    const dataset = await (await openScientific(bytes)).openDataset('series-0')
    const abort = new AbortController()
    abort.abort(new DOMException('cancel JPEG raster', 'AbortError'))
    await expect(
      collectRaster(
        dataset.readPlane({
          displayAxes: ['x', 'y'],
          fixedIndices: [],
          x: 0,
          y: 0,
          width: 8,
          height: 8,
          signal: abort.signal,
        }),
      ),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('rejects malformed JPEGTables and unsupported JPEG photometric layouts', async () => {
    const bytes = await fixture('classic-jpeg-rgb-nir.tif')
    await expect(
      collectRaster(
        (await (await firstDirectory(corruptJpegTables(bytes))).createRasterDecoder()).decode({
          x: 0,
          y: 0,
          width: 1,
          height: 1,
        }),
      ),
    ).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: 'TIFF JPEGTables must be bounded by SOI and EOI markers',
    })

    await expect(
      (await firstDirectory(setClassicPhotometric(bytes, 5))).createRasterDecoder(),
    ).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
      message:
        'TIFF JPEG native raster decoding does not support photometric 5 with 4 sample(s) and planar configuration 1',
    })

    const oldStyle = Uint8Array.from(await fixture('classic-packbits-gray.tif'))
    const view = new DataView(oldStyle.buffer)
    const littleEndian = oldStyle[0] === 0x49
    const ifdOffset = view.getUint32(4, littleEndian)
    const entries = view.getUint16(ifdOffset, littleEndian)
    for (let index = 0; index < entries; index += 1) {
      const offset = ifdOffset + 2 + index * 12
      if (view.getUint16(offset, littleEndian) !== 259) continue
      view.setUint16(offset + 8, 6, littleEndian)
    }
    await expect(
      (
        await openTiffDocument(new MemorySource(oldStyle))
      ).topLevelDirectories[0]?.createRasterDecoder(),
    ).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
      message: 'TIFF compression 6 (Old-style JPEG) is unsupported for native raster decoding',
    })
  })

  it.runIf(gdalOracle)(
    'stays within the documented GDAL JPEG tolerance on the four-band fixture',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'pji-jpeg-oracle-'))
      try {
        const input = join(directory, 'classic-jpeg-rgb-nir.tif')
        const output = join(directory, 'oracle.raw')
        await writeFile(input, await fixture('classic-jpeg-rgb-nir.tif'))
        await execFileAsync('gdal_translate', [
          '-of',
          'ENVI',
          '-srcwin',
          '0',
          '0',
          '1',
          '1',
          input,
          output,
        ])
        const oracle = Uint8Array.from(await readFile(output))
        const dataset = await (
          await openScientific(await fixture('classic-jpeg-rgb-nir.tif'))
        ).openDataset('series-0')
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
        expect(
          maxAbsError(Array.from(blocks[0]?.data ?? []), Array.from(oracle.subarray(0, 4))),
        ).toBeLessThanOrEqual(jpegTolerance)
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    },
  )
})
