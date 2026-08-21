import { describe, expect, it } from 'vitest'
import type { GeoRasterDataset, GeoRasterViewSelection } from '../src/geo/contracts.ts'
import { createGeoNetCdfReader, geoNetCdfReader } from '../src/geo/readers/netcdf.ts'
import { openNetCdfClassic, readNetCdfVariableValues } from '../src/netcdf/classic.ts'
import type { ImageSource, ImageSourceReadOptions } from '../src/source.ts'
import { MemorySource } from '../src/source.ts'
import { HttpRangeSource } from '../src/sources/http-range.ts'
import {
  createNetCdfClassicFixture,
  type FixtureNetCdfAttribute,
  type FixtureNetCdfOptions,
} from './helpers/netcdf-classic-fixture.ts'

const text = (name: string, value: string): FixtureNetCdfAttribute => ({
  name,
  type: 'char',
  values: value,
})

const numeric = (
  name: string,
  type: FixtureNetCdfAttribute['type'],
  values: readonly number[],
): FixtureNetCdfAttribute => ({ name, type, values })

const latLonOptions = (version: 1 | 2 = 1): FixtureNetCdfOptions => ({
  version,
  dimensions: [
    { name: 'lat', length: 2 },
    { name: 'lon', length: 3 },
  ],
  globalAttributes: [text('title', 'Rectilinear fixture')],
  variables: [
    {
      name: 'lat',
      dimensions: ['lat'],
      type: 'float',
      attributes: [
        text('standard_name', 'latitude'),
        text('units', 'degrees_north'),
        text('axis', 'Y'),
      ],
      values: [50, 49],
    },
    {
      name: 'lon',
      dimensions: ['lon'],
      type: 'float',
      attributes: [
        text('standard_name', 'longitude'),
        text('units', 'degrees_east'),
        text('axis', 'X'),
      ],
      values: [-123, -122, -121],
    },
    {
      name: 'temperature',
      dimensions: ['lat', 'lon'],
      type: 'short',
      attributes: [
        text('long_name', 'Surface temperature'),
        text('units', 'K'),
        numeric('scale_factor', 'float', [0.1]),
        numeric('add_offset', 'float', [250]),
        numeric('_FillValue', 'short', [-9999]),
        numeric('missing_value', 'short', [-8888]),
        numeric('valid_range', 'short', [-500, 1000]),
      ],
      values: [1, 2, 3, 4, -9999, 6],
    },
  ],
})

const openFixture = async (options: FixtureNetCdfOptions) => {
  const fixture = createNetCdfClassicFixture(options)
  if (fixture.bytes === undefined) throw new Error('Expected a materialized fixture')
  return geoNetCdfReader.open({
    primary: {
      id: 'fixture',
      name: `fixture-v${options.version}.nc`,
      source: new MemorySource(fixture.bytes),
    },
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

const rangeFetch =
  (bytes: Uint8Array, requests: { readonly start: number; readonly end: number }[]): typeof fetch =>
  async (_input, init) => {
    const range = new Headers(init?.headers).get('range')
    const match = range?.match(/^bytes=(\d+)-(\d+)$/u)
    if (match === undefined || match === null) return new Response(null, { status: 400 })
    const start = Number(match[1])
    const end = Math.min(Number(match[2]), bytes.byteLength - 1)
    requests.push({ start, end })
    const body = Uint8Array.from(bytes.subarray(start, end + 1))
    return new Response(body, {
      status: 206,
      headers: {
        'accept-ranges': 'bytes',
        'content-length': String(body.byteLength),
        'content-range': `bytes ${start}-${end}/${bytes.byteLength}`,
        etag: '"netcdf-fixture"',
      },
    })
  }

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

describe('classic NetCDF CF geo reader', () => {
  it.each([1, 2] as const)('opens CDF-%s lat/lon metadata and native samples', async (version) => {
    const document = await openFixture(latLonOptions(version))
    expect(document.metadata).toMatchObject({
      container: `CDF-${version}`,
      numRecords: 0,
      globalAttributes: { title: 'Rectilinear fixture' },
    })
    const dataset = await document.openDataset('temperature')
    expect(dataset.descriptor.grid).toMatchObject({
      pixelRegistration: 'pixel-is-point',
      pixelToWorld: [1, 0, -123, 0, -1, 50],
      worldBounds: { minX: -123, minY: 49, maxX: -121, maxY: 50 },
    })
    expect(dataset.descriptor.spatialReference.coordinateSystemType).toBe('geographic')
    expect(dataset.descriptor.bands[0]).toMatchObject({
      name: 'Surface temperature',
      unit: 'K',
      scale: expect.closeTo(0.1),
      offset: 250,
      noData: -9999,
      validRange: [-500, 1000],
      dataType: 'int16',
    })
    expect(await values(dataset, { x: 1, y: 0, width: 2, height: 2 })).toEqual([2, 3, -9999, 6])
  })

  it('normalizes projected X/Y coordinates and preserves mapping attributes without transforming', async () => {
    const document = await openFixture({
      version: 2,
      dimensions: [
        { name: 'y', length: 2 },
        { name: 'x', length: 3 },
      ],
      variables: [
        {
          name: 'y',
          dimensions: ['y'],
          type: 'double',
          attributes: [text('standard_name', 'projection_y_coordinate'), text('units', 'm')],
          values: [4_100_000, 4_099_000],
        },
        {
          name: 'x',
          dimensions: ['x'],
          type: 'double',
          attributes: [text('standard_name', 'projection_x_coordinate'), text('units', 'm')],
          values: [500_000, 501_000, 502_000],
        },
        {
          name: 'crs',
          dimensions: [],
          type: 'int',
          attributes: [
            text('grid_mapping_name', 'transverse_mercator'),
            numeric('longitude_of_central_meridian', 'double', [-117]),
            text('crs_wkt', 'PROJCS["WGS 84 / UTM zone 11N",AUTHORITY["EPSG","32611"]]'),
          ],
          values: [0],
        },
        {
          name: 'elevation',
          dimensions: ['y', 'x'],
          type: 'float',
          attributes: [text('grid_mapping', 'crs'), text('units', 'm')],
          values: [10, 11, 12, 13, 14, 15],
        },
      ],
    })
    const dataset = await document.openDataset('elevation')
    expect(dataset.descriptor.grid.pixelToWorld).toEqual([1000, 0, 500000, 0, -1000, 4100000])
    expect(dataset.descriptor.spatialReference).toMatchObject({
      coordinateSystemType: 'projected',
      authority: 'EPSG',
      code: '32611',
      name: 'transverse_mercator',
    })
    expect(dataset.descriptor.formatEvidence?.gridMapping).toMatchObject({
      attributes: { longitude_of_central_meridian: [-117] },
    })
  })

  it('preserves a NaN fill value without putting non-JSON numbers in evidence', async () => {
    const options = latLonOptions()
    const source = options.variables[2]
    if (source === undefined) throw new Error('Temperature fixture variable is missing')
    const document = await openFixture({
      ...options,
      variables: [
        ...options.variables.slice(0, 2),
        {
          ...source,
          type: 'float',
          attributes: [numeric('_FillValue', 'float', [Number.NaN])],
          values: [1, 2, 3, 4, Number.NaN, 6],
        },
      ],
    })
    const dataset = await document.openDataset('temperature')
    expect(dataset.descriptor.grid.noData).toEqual({ kind: 'scalar', value: 'NaN' })
    expect(dataset.descriptor.formatEvidence).toMatchObject({
      variable: { attributes: { _FillValue: ['NaN'] } },
    })
    expect(await values(dataset, { x: 1, y: 1, width: 1, height: 1 })).toEqual([Number.NaN])
  })

  it('keeps record time, vertical, and ensemble-like dimensions selectable', async () => {
    const document = await openFixture({
      version: 1,
      numRecords: 2,
      dimensions: [
        { name: 'time', length: 0, unlimited: true },
        { name: 'level', length: 2 },
        { name: 'lat', length: 2 },
        { name: 'lon', length: 2 },
      ],
      variables: [
        {
          name: 'level',
          dimensions: ['level'],
          type: 'float',
          attributes: [text('axis', 'Z'), text('positive', 'down'), text('units', 'hPa')],
          values: [1000, 850],
        },
        {
          name: 'lat',
          dimensions: ['lat'],
          type: 'float',
          attributes: [text('standard_name', 'latitude'), text('units', 'degrees_north')],
          values: [1, 0],
        },
        {
          name: 'lon',
          dimensions: ['lon'],
          type: 'float',
          attributes: [text('standard_name', 'longitude'), text('units', 'degrees_east')],
          values: [10, 11],
        },
        {
          name: 'time',
          dimensions: ['time'],
          type: 'double',
          attributes: [
            text('standard_name', 'time'),
            text('units', 'hours since 2000-01-01 00:00:00'),
            text('calendar', '360_day'),
          ],
          values: [0, 6],
        },
        {
          name: 'air',
          dimensions: ['time', 'level', 'lat', 'lon'],
          type: 'short',
          attributes: [text('coordinates', 'time level lat lon')],
          values: Array.from({ length: 16 }, (_, index) => index),
        },
      ],
    })
    const dataset = await document.openDataset('air')
    expect(dataset.descriptor.axes).toMatchObject([
      { id: 'time', kind: 'time', length: 2, coordinates: { kind: 'values', values: [0, 6] } },
      { id: 'level', kind: 'vertical', length: 2, unit: 'hPa' },
    ])
    expect(
      await values(dataset, { x: 0, y: 0, width: 2, height: 2 }, [
        { kind: 'index', axisId: 'time', index: 1 },
        { kind: 'index', axisId: 'level', index: 0 },
      ]),
    ).toEqual([8, 9, 10, 11])
  })

  it('reports irregular rectilinear coordinates without fitting an affine', async () => {
    const options = latLonOptions()
    const variables = options.variables.map((variable) =>
      variable.name === 'lon' ? { ...variable, values: [-123, -122, -120] } : variable,
    )
    const document = await openFixture({ ...options, variables })
    expect(document.datasets).toHaveLength(0)
    expect(document.metadata.candidates).toContainEqual(
      expect.objectContaining({
        variable: 'temperature',
        status: 'unsupported-grid',
        diagnostics: [expect.objectContaining({ code: 'netcdf-irregular-rectilinear-grid' })],
      }),
    )
  })

  it('detects curvilinear latitude and longitude coordinates without exposing an affine dataset', async () => {
    const document = await openFixture({
      version: 1,
      dimensions: [
        { name: 'y', length: 2 },
        { name: 'x', length: 2 },
      ],
      variables: [
        {
          name: 'lat2d',
          dimensions: ['y', 'x'],
          type: 'float',
          attributes: [text('standard_name', 'latitude'), text('units', 'degrees_north')],
          values: [40, 40.1, 39, 39.1],
        },
        {
          name: 'lon2d',
          dimensions: ['y', 'x'],
          type: 'float',
          attributes: [text('standard_name', 'longitude'), text('units', 'degrees_east')],
          values: [-120, -119, -120.2, -119.2],
        },
        {
          name: 'precipitation',
          dimensions: ['y', 'x'],
          type: 'float',
          attributes: [text('coordinates', 'lat2d lon2d')],
          values: [1, 2, 3, 4],
        },
      ],
    })
    expect(document.datasets).toHaveLength(0)
    expect(document.metadata.candidates).toContainEqual(
      expect.objectContaining({
        variable: 'precipitation',
        diagnostics: [expect.objectContaining({ code: 'netcdf-curvilinear-grid' })],
      }),
    )
  })

  it('preserves unknown mappings with typed warnings', async () => {
    const options = latLonOptions()
    const temperature = options.variables[2]
    if (temperature === undefined) throw new Error('Temperature fixture variable is missing')
    const variables = [
      ...options.variables.slice(0, 2),
      {
        name: 'crs',
        dimensions: [],
        type: 'int' as const,
        attributes: [text('grid_mapping_name', 'future_mapping')],
        values: [0],
      },
      {
        ...temperature,
        attributes: [...(temperature.attributes ?? []), text('grid_mapping', 'crs')],
      },
    ]
    const document = await openFixture({ ...options, variables })
    const dataset = await document.openDataset('temperature')
    expect(dataset.descriptor.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'netcdf-unsupported-grid-mapping' }),
    )
  })

  it('preserves unsupported calendars with a typed warning', async () => {
    const document = await openFixture({
      version: 1,
      dimensions: [
        { name: 'time', length: 2 },
        { name: 'y', length: 2 },
        { name: 'x', length: 2 },
      ],
      variables: [
        {
          name: 'time',
          dimensions: ['time'],
          type: 'double',
          attributes: [
            text('standard_name', 'time'),
            text('units', 'hours since 2000-01-01 00:00:00'),
            text('calendar', 'future_calendar'),
          ],
          values: [0, 6],
        },
        {
          name: 'y',
          dimensions: ['y'],
          type: 'float',
          attributes: [text('axis', 'Y')],
          values: [1, 0],
        },
        {
          name: 'x',
          dimensions: ['x'],
          type: 'float',
          attributes: [text('axis', 'X')],
          values: [0, 1],
        },
        {
          name: 'cube',
          dimensions: ['time', 'y', 'x'],
          type: 'short',
          values: [1, 2, 3, 4, 5, 6, 7, 8],
        },
      ],
    })
    const dataset = await document.openDataset('cube')
    expect(dataset.descriptor.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'netcdf-unsupported-calendar' }),
    )
  })
})

class SparseTrackingSource implements ImageSource {
  readonly size: number
  readonly reads: { readonly offset: number; readonly length: number }[] = []
  readonly #segments: readonly { readonly offset: number; readonly bytes: Uint8Array }[]

  constructor(
    size: number,
    segments: readonly { readonly offset: number; readonly bytes: Uint8Array }[],
  ) {
    this.size = size
    this.#segments = segments
  }

  async read(
    offset: number,
    length: number,
    options: Readonly<ImageSourceReadOptions> = {},
  ): Promise<Uint8Array> {
    if (options.signal?.aborted === true) throw options.signal.reason
    if (offset < 0 || length < 0 || offset + length > this.size)
      throw new Error('Sparse read outside source')
    this.reads.push({ offset, length })
    const output = new Uint8Array(length)
    for (const segment of this.#segments) {
      const start = Math.max(offset, segment.offset)
      const end = Math.min(offset + length, segment.offset + segment.bytes.byteLength)
      if (end > start) {
        output.set(
          segment.bytes.subarray(start - segment.offset, end - segment.offset),
          start - offset,
        )
      }
    }
    return output
  }
}

describe('classic NetCDF bounded container access', () => {
  it('uses the unpadded stride for a single record variable', async () => {
    const fixture = createNetCdfClassicFixture({
      version: 1,
      numRecords: 3,
      dimensions: [{ name: 'time', length: 0, unlimited: true }],
      variables: [{ name: 'sample', dimensions: ['time'], type: 'short', values: [7, 8, 9] }],
    })
    if (fixture.bytes === undefined) throw new Error('Expected materialized record fixture')
    const file = await openNetCdfClassic(new MemorySource(fixture.bytes))
    const variable = file.variables[0]
    if (variable === undefined) throw new Error('Record variable is missing')
    expect(file.recordStride).toBe(2)
    expect(
      Array.from(
        await readNetCdfVariableValues(file, variable, {
          maxBytes: 32,
          maxValues: 16,
          maxReadOperations: 16,
        }),
        Number,
      ),
    ).toEqual([7, 8, 9])
  })

  it('uses CDF-2 64-bit offsets above four GiB', async () => {
    const fixture = createNetCdfClassicFixture({
      ...latLonOptions(2),
      dataStart: 2 ** 32 + 256,
    })
    const source = new SparseTrackingSource(fixture.size, [
      { offset: 0, bytes: fixture.header },
      ...fixture.segments,
    ])
    const file = await openNetCdfClassic(source, { headerReadChunkBytes: 64 })
    expect(file.variables[0]?.dataOffset).toBeGreaterThan(2 ** 32)
    const document = await createGeoNetCdfReader({ headerReadChunkBytes: 64 }).open({
      primary: { id: 'large', name: 'large-offset.nc', source },
    })
    const dataset = await document.openDataset('temperature')
    expect(await values(dataset, { x: 2, y: 1, width: 1, height: 1 })).toEqual([6])
    expect(source.reads.some(({ offset }) => offset > 2 ** 32)).toBe(true)
  })

  it('does not read a complete large data variable during metadata discovery and bounds viewport reads', async () => {
    const width = 128
    const height = 128
    const fixture = createNetCdfClassicFixture({
      version: 1,
      dimensions: [
        { name: 'y', length: height },
        { name: 'x', length: width },
      ],
      variables: [
        {
          name: 'y',
          dimensions: ['y'],
          type: 'float',
          attributes: [text('standard_name', 'latitude'), text('units', 'degrees_north')],
          values: Array.from({ length: height }, (_, index) => height - index),
        },
        {
          name: 'x',
          dimensions: ['x'],
          type: 'float',
          attributes: [text('standard_name', 'longitude'), text('units', 'degrees_east')],
          values: Array.from({ length: width }, (_, index) => index),
        },
        {
          name: 'large',
          dimensions: ['y', 'x'],
          type: 'short',
          values: Array.from({ length: width * height }, (_, index) => index),
        },
      ],
    })
    if (fixture.bytes === undefined) throw new Error('Expected materialized range fixture')
    const fixtureBytes = fixture.bytes
    const source = new SparseTrackingSource(fixture.size, [{ offset: 0, bytes: fixtureBytes }])
    const document = await geoNetCdfReader.open({
      primary: { id: 'remote', name: 'remote.nc', source },
    })
    const dataOffset = fixture.variableOffsets.large
    expect(dataOffset).toBeDefined()
    expect(source.reads.every(({ offset }) => offset < (dataOffset ?? 0))).toBe(true)
    const dataset = await document.openDataset('large')
    expect(await values(dataset, { x: 7, y: 8, width: 2, height: 2 })).toEqual([
      8 * width + 7,
      8 * width + 8,
      9 * width + 7,
      9 * width + 8,
    ])
    const dataReads = source.reads.filter(({ offset }) => offset >= (dataOffset ?? 0))
    expect(dataReads).toHaveLength(2)
    expect(dataReads.every(({ length }) => length === 4)).toBe(true)

    const requests: { readonly start: number; readonly end: number }[] = []
    const remote = await HttpRangeSource.open('https://example.test/remote.nc', {
      blockBytes: 128,
      maxCacheBytes: 1_024,
      fetch: rangeFetch(fixtureBytes, requests),
    })
    const remoteDocument = await createGeoNetCdfReader({ headerReadChunkBytes: 128 }).open({
      primary: { id: 'http-remote', name: 'remote.nc', source: remote },
    })
    const remoteDataset = await remoteDocument.openDataset('large')
    expect(await values(remoteDataset, { x: 7, y: 8, width: 2, height: 2 })).toEqual([
      8 * width + 7,
      8 * width + 8,
      9 * width + 7,
      9 * width + 8,
    ])
    expect(remote.stats.uniqueBytes).toBeLessThan(fixtureBytes.byteLength)
    expect(requests.every(({ end }) => end < fixtureBytes.byteLength)).toBe(true)
  })

  it('rejects CDF-5, malformed lengths, unsafe offsets, and cancellation', async () => {
    await expect(
      openNetCdfClassic(new MemorySource(Uint8Array.of(0x43, 0x44, 0x46, 5))),
    ).rejects.toThrow('CDF-5')
    const malformed = new Uint8Array(16)
    malformed.set([0x43, 0x44, 0x46, 1])
    new DataView(malformed.buffer).setUint32(8, 10, false)
    new DataView(malformed.buffer).setUint32(12, 0xffff_ffff, false)
    await expect(
      openNetCdfClassic(new MemorySource(malformed), { maxDimensions: 8 }),
    ).rejects.toThrow()

    const fixture = createNetCdfClassicFixture(latLonOptions(2))
    const unsafe = Uint8Array.from(fixture.header)
    unsafe.set(Uint8Array.of(0x20, 0, 0, 0, 0, 0, 0, 0), unsafe.byteLength - 8)
    const unsafeSource = new SparseTrackingSource(Number.MAX_SAFE_INTEGER, [
      { offset: 0, bytes: unsafe },
    ])
    await expect(openNetCdfClassic(unsafeSource, { headerReadChunkBytes: 32 })).rejects.toThrow(
      'safe offsets',
    )

    const controller = new AbortController()
    controller.abort(new DOMException('cancel NetCDF', 'AbortError'))
    await expect(
      geoNetCdfReader.open({
        primary: { id: 'cancel', source: new MemorySource(fixture.bytes ?? fixture.header) },
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})
