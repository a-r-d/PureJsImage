import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'
import type { GeoRasterDataset, GeoRasterViewSelection } from '../src/geo/contracts.ts'
import { geoEnviReader } from '../src/geo/readers/envi.ts'
import {
  createEsriAsciiGridReader,
  esriAsciiGridReader,
} from '../src/geo/readers/esri-ascii-grid.ts'
import { createSrtmHgtReader, srtmHgtReader } from '../src/geo/readers/srtm-hgt.ts'
import { createWorldFileReader, worldFileReader } from '../src/geo/readers/world-file.ts'
import type {
  ScientificCompanionRequest,
  ScientificOpenContext,
  ScientificResource,
} from '../src/scientific/reader.ts'
import { MemorySource } from '../src/source.ts'

const encoder = new TextEncoder()
const pngImage = new PNG({ width: 1, height: 1 })
pngImage.data.set([20, 40, 60, 255])
const png = Uint8Array.from(PNG.sync.write(pngImage))

const resource = (id: string, name: string, bytes: Uint8Array): ScientificResource =>
  Object.freeze({ id, name, source: new MemorySource(bytes) })

const context = (
  primary: ScientificResource,
  companions: readonly ScientificResource[] = [],
): ScientificOpenContext => {
  const byName = new Map(companions.map((entry) => [entry.name, entry]))
  return Object.freeze({
    primary,
    companions: Object.freeze({
      async resolve(request: Readonly<ScientificCompanionRequest>) {
        const name = request.kind === 'relative-name' ? request.name : request.relativeName
        return name === undefined ? undefined : byName.get(name)
      },
    }),
  })
}

const selection = (
  dataset: GeoRasterDataset,
  nonSpatial: GeoRasterViewSelection['nonSpatial'] = [],
): GeoRasterViewSelection =>
  Object.freeze({
    spatialDimensions: Object.freeze([
      dataset.descriptor.spatialDimensions.x.id,
      dataset.descriptor.spatialDimensions.y.id,
    ] as const),
    nonSpatial,
    sourceBands: Object.freeze([0]),
    levelId: dataset.descriptor.primaryLevelId,
  })

const values = async (
  dataset: GeoRasterDataset,
  region: {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
  },
  nonSpatial: GeoRasterViewSelection['nonSpatial'] = [],
): Promise<readonly number[]> => {
  const output: number[] = []
  for await (const tile of dataset
    .createView(selection(dataset, nonSpatial))
    .readPixelRegion({ region })) {
    output.push(...Array.from(tile.data, Number))
    tile.release()
  }
  return Object.freeze(output)
}

describe('world-file geo reader', () => {
  it.each([
    {
      name: 'rotated.png',
      worldName: 'rotated.pgw',
      lines: '2\n-0.25\n0.5\n-3\n100\n200',
      expected: [2, 0.5, 98.75, -0.25, -3, 201.625],
    },
    {
      name: 'signed.png',
      worldName: 'signed.pngw',
      lines: '-2\n0.25\n-0.5\n3\n-100\n-200',
      expected: [-2, -0.5, -98.75, 0.25, 3, -201.625],
    },
  ])(
    'converts rotations, signs, and pixel-center semantics for $worldName',
    async ({ name, worldName, lines, expected }) => {
      const document = await worldFileReader.open(
        context(resource('image', name, png), [
          resource('world', worldName, encoder.encode(lines)),
        ]),
      )
      const dataset = await document.openDataset('image')
      expect(dataset.descriptor.grid.pixelToWorld).toEqual(expected)
      expect(dataset.descriptor.grid.pixelRegistration).toBe('pixel-is-area')
      expect(dataset.descriptor.formatEvidence?.worldFile).toMatchObject({
        centerToCornerApplied: true,
      })
      await expect(values(dataset, { x: 0, y: 0, width: 1, height: 1 })).resolves.toHaveLength(1)
    },
  )

  it('opens TIFF with a TFW companion through the existing TIFF reader', async () => {
    const tiff = new Uint8Array(
      await readFile(resolve('tests/fixtures/cog/classic-packbits-gray.tif')),
    )
    const document = await worldFileReader.open(
      context(resource('image', 'terrain.tif', tiff), [
        resource('world', 'terrain.tfw', encoder.encode('30\n0\n0\n-30\n500015\n4099985')),
      ]),
    )
    const id = document.datasets[0]?.id
    if (id === undefined) throw new Error('Expected a TIFF dataset')
    const dataset = await document.openDataset(id)
    expect(dataset.descriptor.grid.pixelToWorld).toEqual([30, 0, 500000, 0, -30, 4100000])
  })

  it('preserves original PRJ WKT evidence and supports JPEG JGW siblings through the JPEG codec', async () => {
    const jpeg = new Uint8Array(
      await readFile(resolve('benchmark/corpus/files/jpeg-reference/generated-progressive.jpg')),
    )
    const wkt = 'GEOGCS["WGS 84",DATUM["WGS_1984"],AUTHORITY["EPSG","4326"]]'
    const document = await worldFileReader.open(
      context(resource('image', 'scene.jpg', jpeg), [
        resource('world', 'scene.jgw', encoder.encode('1\n0\n0\n-1\n10.5\n20.5')),
        resource('prj', 'scene.prj', encoder.encode(wkt)),
      ]),
    )
    const dataset = await document.openDataset('image')
    expect(dataset.descriptor.spatialReference).toMatchObject({
      authority: 'EPSG',
      code: '4326',
      coordinateSystemType: 'geographic',
    })
    expect(dataset.descriptor.spatialReference.evidence[1]?.metadata).toEqual({ originalWkt: wkt })
    expect(dataset.descriptor.formatEvidence?.prj).toEqual({ originalWkt: wkt })
  })

  it('rejects missing, ambiguous, malformed, and oversized sidecars', async () => {
    const primary = resource('image', 'scene.png', png)
    await expect(worldFileReader.open(context(primary))).rejects.toThrow('companion')
    await expect(
      worldFileReader.open(
        context(primary, [
          resource('pgw', 'scene.pgw', encoder.encode('1\n0\n0\n-1\n0\n0')),
          resource('wld', 'scene.wld', encoder.encode('1\n0\n0\n-1\n0\n0')),
        ]),
      ),
    ).rejects.toThrow('ambiguous')
    await expect(
      worldFileReader.open(
        context(primary, [resource('bad', 'scene.pgw', encoder.encode('1\n0\n0\n-1\n0'))]),
      ),
    ).rejects.toThrow('six lines')
    await expect(
      createWorldFileReader({ maxWorldFileBytes: 4 }).open(
        context(primary, [resource('large', 'scene.pgw', encoder.encode('1\n0\n0\n-1\n0\n0'))]),
      ),
    ).rejects.toThrow('exceeds')
  })
})

const enviContext = (header: string, data: Uint8Array): ScientificOpenContext =>
  context(resource('header', 'cube.hdr', encoder.encode(header)), [resource('data', 'cube', data)])

describe('ENVI geo normalization', () => {
  it.each([
    ['bsq', 'UTM', '1, 1, 500000, 4100000, 30, 30, 11, North, WGS-84, units=Meters'],
    ['bil', 'Geographic Lat/Lon', '1, 1, -120, 40, 0.01, 0.01, WGS-84, units=Degrees'],
    ['bip', 'UTM', '1, 1, 500000, 4100000, 30, 30, 11, South, WGS-84, units=Meters'],
  ])(
    'reuses the %s decoder and normalizes %s map info',
    async (interleave, projection, mapValues) => {
      const coordinateSystem =
        projection === 'UTM'
          ? mapValues.includes('South')
            ? 'PROJCS["WGS 84 / UTM zone 11S",AUTHORITY["EPSG","32711"]]'
            : 'PROJCS["WGS 84 / UTM zone 11N",AUTHORITY["EPSG","32611"]]'
          : 'GEOGCS["WGS 84",AUTHORITY["EPSG","4326"]]'
      const header = `ENVI
samples = 2
lines = 2
bands = 2
file type = ENVI Standard
data type = 1
interleave = ${interleave}
byte order = 0
map info = { ${projection}, ${mapValues} }
coordinate system string = { ${coordinateSystem} }
data ignore value = 255
band names = { Coastal, Quality }
wavelength = { 443, 865 }
wavelength units = Nanometers
reflectance scale factor = 10000
acquisition time = 2026-01-02T03:04:05Z
`
      const document = await geoEnviReader.open(
        enviContext(header, Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8)),
      )
      const dataset = await document.openDataset('raster')
      expect(dataset.descriptor.axes).toMatchObject([{ id: 'channel', kind: 'band', length: 2 }])
      expect(dataset.descriptor.axes[0]?.metadata).toMatchObject({
        entries: [
          { name: 'Coastal', wavelength: 443 },
          { name: 'Quality', wavelength: 865 },
        ],
      })
      expect(dataset.descriptor.bands[0]).toMatchObject({ scale: 0.0001, noData: 255 })
      expect(dataset.descriptor.spatialReference).toMatchObject({
        coordinateSystemType: projection === 'UTM' ? 'projected' : 'geographic',
        authority: 'EPSG',
        code: projection === 'UTM' ? (mapValues.includes('South') ? '32711' : '32611') : '4326',
      })
      expect(dataset.descriptor.grid.pixelToWorld).toEqual(
        projection === 'UTM'
          ? [30, 0, 499985, 0, -30, 4100015]
          : [0.01, 0, -120.005, 0, -0.01, 40.005],
      )
      expect(
        await values(dataset, { x: 0, y: 0, width: 2, height: 1 }, [
          { kind: 'index', axisId: 'channel', index: 1 },
        ]),
      ).toHaveLength(2)
    },
  )

  it('discovers geospatial metadata when the binary resource is primary', async () => {
    const header = `ENVI
samples = 1
lines = 1
bands = 1
file type = ENVI Standard
data type = 1
interleave = bsq
byte order = 0
map info = { Geographic Lat/Lon, 1, 1, -70, 45, 0.1, 0.1, WGS-84, units=Degrees }
`
    const data = resource('data', 'binary.img', Uint8Array.of(42))
    const headerResource = resource('header', 'binary.hdr', encoder.encode(header))
    const dataPrimary = context(data, [headerResource])
    await expect(geoEnviReader.probe(dataPrimary)).resolves.toMatchObject({ confidence: 1 })
    const document = await geoEnviReader.open(dataPrimary)
    const dataset = await document.openDataset('raster')
    await expect(values(dataset, { x: 0, y: 0, width: 1, height: 1 })).resolves.toEqual([42])
  })
})

describe('Esri ASCII Grid geo reader', () => {
  it.each([
    ['corner', 'xllcorner 10\nyllcorner 20', 'pixel-is-area', [2, 0, 10, 0, -2, 24]],
    ['center', 'xllcenter 11\nyllcenter 21', 'pixel-is-point', [2, 0, 11, 0, -2, 23]],
  ] as const)(
    'normalizes the %s origin and negative elevations',
    async (_name, origin, registration, affine) => {
      const text = `ncols 3
nrows 2
${origin}
cellsize 2
NODATA_value -9999
1 -2 3
4 5 -9999
`
      const document = await esriAsciiGridReader.open({
        primary: resource('grid', 'terrain.asc', encoder.encode(text)),
      })
      const dataset = await document.openDataset('grid')
      expect(dataset.descriptor.grid).toMatchObject({
        pixelRegistration: registration,
        pixelToWorld: affine,
      })
      expect(dataset.descriptor.diagnostics).toContainEqual(
        expect.objectContaining({ code: 'ascii-grid-sequential-read' }),
      )
      expect(await values(dataset, { x: 1, y: 0, width: 2, height: 2 })).toEqual([-2, 3, 5, -9999])
    },
  )

  it('rejects mixed origins, invalid rows, token limits, and file limits', async () => {
    const mixed = 'ncols 1\nnrows 1\nxllcorner 0\nyllcenter 0\ncellsize 1\n1\n'
    await expect(
      esriAsciiGridReader.open({ primary: resource('mixed', 'mixed.asc', encoder.encode(mixed)) }),
    ).rejects.toThrow('mix')
    const short = 'ncols 2\nnrows 1\nxllcorner 0\nyllcorner 0\ncellsize 1\n1\n'
    await expect(
      esriAsciiGridReader.open({ primary: resource('short', 'short.asc', encoder.encode(short)) }),
    ).rejects.toThrow('requires 2')
    const valid = 'ncols 2\nnrows 1\nxllcorner 0\nyllcorner 0\ncellsize 1\n1 2\n'
    await expect(
      createEsriAsciiGridReader({ maxTokens: 1 }).open({
        primary: resource('tokens', 'tokens.asc', encoder.encode(valid)),
      }),
    ).rejects.toThrow('maxTokens')
    await expect(
      createEsriAsciiGridReader({ maxFileBytes: 8 }).open({
        primary: resource('large', 'large.asc', encoder.encode(valid)),
      }),
    ).rejects.toThrow('maxFileBytes')
  })
})

describe('SRTM HGT geo reader', () => {
  const hgt = (): Uint8Array => {
    const bytes = new Uint8Array(1_201 * 1_201 * 2)
    const view = new DataView(bytes.buffer)
    view.setInt16(0, -123, false)
    view.setInt16(2, -32_768, false)
    return bytes
  }

  it.each([
    ['N37E122.hgt', 37, 122],
    ['N37W122.hgt', 37, -122],
    ['S37E122.hgt', -37, 122],
    ['S37W122.hgt', -37, -122],
  ])(
    'parses %s without inferring location from arbitrary strings',
    async (name, latitude, longitude) => {
      const document = await srtmHgtReader.open({ primary: resource('hgt', name, hgt()) })
      const dataset = await document.openDataset('elevation')
      expect(dataset.descriptor.grid.pixelToWorld).toEqual([
        1 / 1_200,
        0,
        longitude,
        0,
        -1 / 1_200,
        latitude + 1,
      ])
      expect(dataset.descriptor.grid.pixelRegistration).toBe('pixel-is-point')
      expect(dataset.descriptor.spatialReference).toMatchObject({ authority: 'EPSG', code: 4326 })
      expect(await values(dataset, { x: 0, y: 0, width: 2, height: 1 })).toEqual([-123, -32_768])
    },
  )

  it('supports explicit locations and rejects ambiguous names, dimensions, and read limits', async () => {
    const bytes = hgt()
    await expect(
      srtmHgtReader.open({ primary: resource('ambiguous', 'tile-37-122.hgt', bytes) }),
    ).rejects.toThrow('location')
    const document = await createSrtmHgtReader({ location: { latitude: 4, longitude: -5 } }).open({
      primary: resource('override', 'tile.bin', bytes),
    })
    expect((await document.openDataset('elevation')).descriptor.grid.pixelToWorld).toEqual([
      1 / 1_200,
      0,
      -5,
      0,
      -1 / 1_200,
      5,
    ])
    await expect(
      srtmHgtReader.open({ primary: resource('bad-size', 'N00E000.hgt', new Uint8Array(8)) }),
    ).rejects.toThrow('file size')
    const limited = await createSrtmHgtReader({ maxRegionBytes: 2 }).open({
      primary: resource('limited', 'N00E000.hgt', bytes),
    })
    const dataset = await limited.openDataset('elevation')
    await expect(async () => {
      for await (const _tile of dataset
        .createView(selection(dataset))
        .readPixelRegion({ region: { x: 0, y: 0, width: 2, height: 1 } })) {
        /* exhaust */
      }
    }).rejects.toThrow('maxRegionBytes')
  })
})
