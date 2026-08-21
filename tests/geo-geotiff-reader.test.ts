import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { encodeTiffDocument } from '../src/codecs/tiff.ts'
import {
  createGeoTiffReader,
  type GeoTiffDocument,
  geoTiffReader,
} from '../src/geo/readers/geotiff.ts'
import { nodeRuntime } from '../src/node-runtime.ts'
import type { PixelBlock } from '../src/pixel.ts'
import { Uint8ArraySink } from '../src/sink.ts'
import { type ImageSource, MemorySource } from '../src/source.ts'
import { HttpRangeSource } from '../src/sources/http-range.ts'
import fixtureManifest from './fixtures/cog/manifest.json' with { type: 'json' }

const fixture = async (filename: string): Promise<Uint8Array> =>
  Uint8Array.from(await readFile(new URL(`./fixtures/cog/${filename}`, import.meta.url)))

const openGeo = async (bytes: Uint8Array): Promise<GeoTiffDocument> =>
  geoTiffReader.open({
    primary: { id: 'geotiff-fixture', name: 'fixture.tif', source: new MemorySource(bytes) },
  })

const execFileAsync = promisify(execFile)
const gdalOracle = process.env.PUREJSIMAGE_GDAL_ORACLE === '1'

type UnknownRecord = { readonly [key: string]: unknown }

const record = (value: unknown, label: string): UnknownRecord => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} is not an object`)
  }
  const output: { [key: string]: unknown } = {}
  for (const [key, entry] of Object.entries(value)) output[key] = entry
  return output
}

const numericArray = (value: unknown, label: string): readonly number[] => {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'number')) {
    throw new Error(`${label} is not a numeric array`)
  }
  return value
}

const viewFor = async (document: GeoTiffDocument, levelId = '0') => {
  const dataset = await document.openDataset('series-0')
  return dataset.createView({
    spatialDimensions: [
      dataset.descriptor.spatialDimensions.x.id,
      dataset.descriptor.spatialDimensions.y.id,
    ],
    nonSpatial: dataset.descriptor.axes.map((axis) => ({
      kind: 'index' as const,
      axisId: axis.id,
      index: 0,
    })),
    sourceBands: dataset.descriptor.bands.map(({ sourceComponentIndex }) => sourceComponentIndex),
    levelId,
  })
}

const firstTile = async (document: GeoTiffDocument, levelId = '0') => {
  const view = await viewFor(document, levelId)
  for await (const tile of view.readPixelRegion({
    region: { x: 0, y: 0, width: 1, height: 1 },
  })) {
    return tile
  }
  throw new Error('GeoTIFF view returned no tile')
}

const range = (init: RequestInit | undefined): readonly [number, number] | undefined => {
  const match = new Headers(init?.headers).get('range')?.match(/^bytes=(\d+)-(\d+)$/)
  return match === undefined || match === null ? undefined : [Number(match[1]), Number(match[2])]
}

const setGeoKeyVersion = (bytes: Uint8Array, version: number): Uint8Array => {
  const output = Uint8Array.from(bytes)
  const view = new DataView(output.buffer)
  const littleEndian = output[0] === 0x49
  const ifdOffset = view.getUint32(4, littleEndian)
  const entryCount = view.getUint16(ifdOffset, littleEndian)
  for (let index = 0; index < entryCount; index += 1) {
    const entryOffset = ifdOffset + 2 + index * 12
    if (view.getUint16(entryOffset, littleEndian) !== 34_735) continue
    const valueOffset = view.getUint32(entryOffset + 8, littleEndian)
    view.setUint16(valueOffset, version, littleEndian)
    return output
  }
  throw new Error('GeoKeyDirectoryTag is missing')
}

const setInlineGeoKeyValue = (bytes: Uint8Array, keyId: number, value: number): Uint8Array => {
  const output = Uint8Array.from(bytes)
  const view = new DataView(output.buffer)
  const littleEndian = output[0] === 0x49
  const ifdOffset = view.getUint32(4, littleEndian)
  const entryCount = view.getUint16(ifdOffset, littleEndian)
  for (let index = 0; index < entryCount; index += 1) {
    const entryOffset = ifdOffset + 2 + index * 12
    if (view.getUint16(entryOffset, littleEndian) !== 34_735) continue
    const valueOffset = view.getUint32(entryOffset + 8, littleEndian)
    const keyCount = view.getUint16(valueOffset + 6, littleEndian)
    for (let keyIndex = 0; keyIndex < keyCount; keyIndex += 1) {
      const keyOffset = valueOffset + 8 + keyIndex * 8
      if (
        view.getUint16(keyOffset, littleEndian) === keyId &&
        view.getUint16(keyOffset + 2, littleEndian) === 0
      ) {
        view.setUint16(keyOffset + 6, value, littleEndian)
        return output
      }
    }
    throw new Error(`Inline GeoKey ${keyId} is missing`)
  }
  throw new Error('GeoKeyDirectoryTag is missing')
}

const replaceGeoKeyWithInlineValue = (
  bytes: Uint8Array,
  keyId: number,
  replacementKeyId: number,
  value: number,
): Uint8Array => {
  const output = Uint8Array.from(bytes)
  const view = new DataView(output.buffer)
  const littleEndian = output[0] === 0x49
  const ifdOffset = view.getUint32(4, littleEndian)
  const entryCount = view.getUint16(ifdOffset, littleEndian)
  for (let index = 0; index < entryCount; index += 1) {
    const entryOffset = ifdOffset + 2 + index * 12
    if (view.getUint16(entryOffset, littleEndian) !== 34_735) continue
    const valueOffset = view.getUint32(entryOffset + 8, littleEndian)
    const keyCount = view.getUint16(valueOffset + 6, littleEndian)
    for (let keyIndex = 0; keyIndex < keyCount; keyIndex += 1) {
      const keyOffset = valueOffset + 8 + keyIndex * 8
      if (view.getUint16(keyOffset, littleEndian) !== keyId) continue
      view.setUint16(keyOffset, replacementKeyId, littleEndian)
      view.setUint16(keyOffset + 2, 0, littleEndian)
      view.setUint16(keyOffset + 4, 1, littleEndian)
      view.setUint16(keyOffset + 6, value, littleEndian)
      return output
    }
    throw new Error(`GeoKey ${keyId} is missing`)
  }
  throw new Error('GeoKeyDirectoryTag is missing')
}

describe('GeoTIFF geo reader', () => {
  it('normalizes CRS, grid, bands, storage, nodata, and structural diagnostics', async () => {
    const bytes = await fixture('classic-deflate-rgb-nodata.tif')
    const document = await openGeo(bytes)
    const dataset = await document.openDataset('series-0')

    expect(dataset.descriptor).toMatchObject({
      sourceFormat: { id: 'geotiff', name: 'GeoTIFF' },
      spatialReference: {
        coordinateSystemType: 'projected',
        authority: 'EPSG',
        code: 32618,
        state: 'complete',
      },
      grid: {
        width: 16,
        height: 16,
        pixelToWorld: [2, 0, 500_000, 0, -2, 4_500_000],
        pixelRegistration: 'pixel-is-area',
        noData: { kind: 'scalar', value: 0 },
      },
      bands: [
        { sourceComponentIndex: 0, colorInterpretation: 'red' },
        { sourceComponentIndex: 1, colorInterpretation: 'green' },
        { sourceComponentIndex: 2, colorInterpretation: 'blue' },
      ],
      levels: [
        {
          sourcePath: 'page[0]/level[0]/ifd[0]',
          storage: {
            organization: 'tiled',
            compression: 'Deflate',
            byteOrder: 'little-endian',
          },
        },
      ],
    })
    expect(dataset.scientificDataset.descriptor.spatialReference?.crs.code).toBe(32618)
    const tileData = (await firstTile(document)).data
    const values =
      tileData instanceof BigInt64Array || tileData instanceof BigUint64Array
        ? Array.from(tileData, Number)
        : Array.from(tileData)
    expect(values).toEqual([3, 64, 125])

    const report = await document.inspectStructure()
    expect(report).toMatchObject({
      reportKind: 'structural-diagnostic',
      formalCogCertification: false,
      container: 'TIFF',
      byteOrder: 'little-endian',
      objectSize: bytes.byteLength,
      rangeReadSuitability: 'not-applicable',
      geospatialMetadata: [{ rasterType: 'pixel-is-area', projectedCrs: 32618, keyCount: 4 }],
    })
    expect(() => JSON.stringify(report)).not.toThrow()
  })

  it('reports user-defined projected CRS evidence as incomplete instead of unknown', async () => {
    const bytes = setInlineGeoKeyValue(
      await fixture('classic-deflate-rgb-nodata.tif'),
      3_072,
      32_767,
    )
    const document = await openGeo(bytes)
    const reference = (await document.openDataset('series-0')).descriptor.spatialReference
    expect(reference).toMatchObject({
      coordinateSystemType: 'projected',
      state: 'incomplete',
      name: expect.any(String),
    })
    expect(reference.authority).toBeUndefined()
    expect(reference.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'unknown-crs', severity: 'warning' }),
    )
  })

  it('preserves user-defined projected unit evidence without inventing an EPSG CRS', async () => {
    const userDefined = setInlineGeoKeyValue(
      await fixture('classic-deflate-rgb-nodata.tif'),
      3_072,
      32_767,
    )
    const bytes = replaceGeoKeyWithInlineValue(userDefined, 3_073, 3_076, 9_001)
    const reference = (await (await openGeo(bytes)).openDataset('series-0')).descriptor
      .spatialReference
    expect(reference).toMatchObject({
      coordinateSystemType: 'projected',
      state: 'incomplete',
      horizontalUnit: { name: 'metre', symbol: 'm', conversionToSI: 1 },
    })
    expect(reference.authority).toBeUndefined()
  })

  it('opens every deterministic compression/container fixture through the native geo path', async () => {
    for (const entry of fixtureManifest.fixtures) {
      const document = await openGeo(await fixture(entry.filename))
      const dataset = await document.openDataset('series-0')
      const tile = await firstTile(document)
      expect(tile.componentCount, entry.filename).toBe(dataset.descriptor.bands.length)
      expect(tile.sampleType, entry.filename).toBe(dataset.descriptor.sampleType)
      expect((await document.inspectStructure()).container, entry.filename).toBe(entry.container)
    }
  })

  it('uses derived overview geometry while keeping the same lazy scientific dataset', async () => {
    const document = await openGeo(await fixture('subifd-deflate-rotated.tif'))
    const dataset = await document.openDataset('series-0')
    expect(dataset.descriptor.levels).toMatchObject([
      { width: 32, height: 32, geometry: { pixelToWorld: [2, 0.5, 100, -0.25, -2, 200] } },
      { width: 16, height: 16, geometry: { pixelToWorld: [4, 1, 100, -0.5, -4, 200] } },
    ])
    expect((await firstTile(document, '1')).levelId).toBe('1')
  })

  it('keeps remote range reads bounded and reports transfer and cache activity', async () => {
    const bytes = await fixture('subifd-deflate-rotated.tif')
    const ranges: Array<readonly [number, number]> = []
    const fetchRange: typeof fetch = async (_input, init) => {
      const selected = range(init)
      if (selected === undefined) return new Response(null, { status: 416 })
      const start = selected[0]
      const end = Math.min(selected[1], bytes.byteLength - 1)
      ranges.push([start, end])
      return new Response(bytes.slice(start, end + 1), {
        status: 206,
        headers: { 'content-range': `bytes ${start}-${end}/${bytes.byteLength}` },
      })
    }
    const source = await HttpRangeSource.open('https://example.test/remote-cog.tif', {
      blockBytes: 128,
      maxCacheBytes: 1_024,
      fetch: fetchRange,
    })
    const document = await geoTiffReader.open({
      primary: { id: 'remote-cog', name: 'remote-cog.tif', source },
    })
    await firstTile(document, '1')
    const report = await document.inspectStructure()

    expect(report.rangeReadSuitability).toBe('suitable')
    expect(report.io.requests).toBe(ranges.length)
    expect(report.io.transferredBytes).toBeLessThan(bytes.byteLength)
    expect(report.io.uniqueBytes).toBeLessThan(bytes.byteLength)
    expect(report.io.encodedCache.hits).toBeGreaterThan(0)
    expect(ranges.every(([start, end]) => end - start + 1 < bytes.byteLength)).toBe(true)
  })

  it('accepts an explicit range-backed object-size limit for large COGs', async () => {
    const bytes = await fixture('classic-deflate-rgb-nodata.tif')
    const advertisedSize = 128 * 1_024 * 1_024 + 1
    const source: ImageSource = {
      size: advertisedSize,
      async read(offset, length) {
        return bytes.slice(offset, Math.min(bytes.byteLength, offset + length))
      },
    }
    const context = {
      primary: { id: 'large-cog', name: 'large-cog.tif', source },
    } as const

    await expect(geoTiffReader.open(context)).rejects.toThrow('maxInputBytes')
    const reader = createGeoTiffReader({ limits: { maxInputBytes: advertisedSize } })
    const document = await reader.open(context)
    expect((await document.openDataset('series-0')).descriptor.grid).toMatchObject({
      width: 16,
      height: 16,
    })
  })

  it('preserves cancellation through geo views', async () => {
    const document = await openGeo(await fixture('classic-packbits-gray.tif'))
    const view = await viewFor(document)
    const controller = new AbortController()
    controller.abort(new Error('cancel geo read'))
    const read = async (): Promise<void> => {
      for await (const tile of view.readPixelRegion({
        region: { x: 0, y: 0, width: 1, height: 1 },
        signal: controller.signal,
      })) {
        tile.release()
      }
    }
    await expect(read()).rejects.toThrow('cancel geo read')
  })

  it('rejects non-geospatial TIFF and leaves it to the scientific TIFF reader', async () => {
    const pixels: AsyncIterable<PixelBlock> = {
      async *[Symbol.asyncIterator]() {
        yield {
          x: 0,
          y: 0,
          width: 2,
          height: 1,
          stride: 6,
          format: 'rgb8',
          data: Uint8Array.of(1, 2, 3, 4, 5, 6),
        }
      },
    }
    const sink = new Uint8ArraySink()
    await encodeTiffDocument(sink, {
      runtime: nodeRuntime,
      pages: [{ width: 2, height: 1, pixelFormat: 'rgb8', blocks: pixels }],
    })
    await expect(openGeo(sink.toUint8Array())).rejects.toThrow(
      'use the scientific TIFF reader for non-geospatial TIFF',
    )
  })

  it('rejects malformed GeoKeys as GeoTIFF metadata instead of treating them as ordinary TIFF', async () => {
    const malformed = setGeoKeyVersion(await fixture('classic-deflate-rgb-nodata.tif'), 2)
    await expect(openGeo(malformed)).rejects.toThrow(
      'GeoTIFF metadata could not be normalized: GeoTIFF key directory version 2.1.0 is unsupported',
    )
  })

  it.runIf(gdalOracle)('matches GDAL geotransform and raster metadata', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pji-geotiff-oracle-'))
    try {
      const input = join(directory, 'fixture.tif')
      await writeFile(input, await fixture('classic-deflate-rgb-nodata.tif'))
      const { stdout } = await execFileAsync('gdalinfo', ['-json', input])
      const rawOracle: unknown = JSON.parse(stdout)
      const oracle = record(rawOracle, 'GDAL report')
      const size = numericArray(oracle.size, 'GDAL size')
      const transform = numericArray(oracle.geoTransform, 'GDAL geotransform')
      const document = await openGeo(await fixture('classic-deflate-rgb-nodata.tif'))
      const descriptor = (await document.openDataset('series-0')).descriptor

      expect([descriptor.grid.width, descriptor.grid.height]).toEqual(size)
      expect(descriptor.grid.pixelToWorld).toEqual([
        transform[1],
        transform[2],
        transform[0],
        transform[4],
        transform[5],
        transform[3],
      ])
      expect(Array.isArray(oracle.bands) ? oracle.bands.length : 0).toBe(descriptor.bands.length)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
