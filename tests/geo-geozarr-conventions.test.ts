import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  GeoZarrConventionError,
  geoZarrConventionRegistry,
  geoZarrMultiscalesConvention,
  geoZarrProjConvention,
  geoZarrSpatialConvention,
  parseGeoZarrConventionMetadata,
} from '../src/geo/conventions/geozarr/index.ts'
import type {
  GeoZarrConventionDefinition,
  GeoZarrConventionNodeSource,
} from '../src/geo/conventions/geozarr/index.ts'

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(resolve(import.meta.dirname, 'fixtures/geozarr-conventions', name), 'utf8'),
  )

const registration = (
  definition: GeoZarrConventionDefinition,
  tag: string = definition.tag,
): Readonly<Record<string, unknown>> => ({
  schema_url: definition.schemaUrl.replace(`/tags/${definition.tag}/`, `/tags/${tag}/`),
  spec_url: definition.specUrl.replace(`/blob/${definition.tag}/`, `/blob/${tag}/`),
  uuid: definition.uuid,
  name: definition.name,
  description: definition.description,
})

const group = (
  attributes: Readonly<Record<string, unknown>>,
  zarrFormat: 2 | 3 = 3,
): GeoZarrConventionNodeSource => ({
  zarrFormat,
  nodeType: 'group',
  path: '',
  metadata: zarrFormat === 3 ? { zarr_format: 3, node_type: 'group', attributes } : attributes,
})

const array = (
  path: string,
  attributes: Readonly<Record<string, unknown>>,
  shape: readonly number[],
  dimensionNames: readonly string[],
  zarrFormat: 2 | 3 = 3,
): GeoZarrConventionNodeSource => ({
  zarrFormat,
  nodeType: 'array',
  path,
  metadata:
    zarrFormat === 3
      ? {
          zarr_format: 3,
          node_type: 'array',
          shape,
          dimension_names: dimensionNames,
          attributes,
        }
      : { ...attributes, _ARRAY_DIMENSIONS: dimensionNames },
  shape,
})

const allRegistrations = () => geoZarrConventionRegistry.map((entry) => registration(entry))

describe('GeoZarr convention metadata', () => {
  it('pins the official Pilot v0.1 convention evidence and accepts an official composed fixture', () => {
    expect(geoZarrConventionRegistry).toEqual([
      expect.objectContaining({
        name: 'proj',
        uuid: 'f17cb550-5864-4468-aeb7-f3180cfb622f',
        tag: 'v0.1',
        maturity: 'Pilot',
        tagCommit: '5ca5b2f92e5c7245f957d9128b289ee535f0720d',
      }),
      expect.objectContaining({
        name: 'spatial',
        uuid: '689b58e2-cf7b-45e0-9fff-9cfc0883d6b4',
        tagCommit: '54d81b7ced0376e63ee10f34db31db7d08dcc28d',
      }),
      expect.objectContaining({
        name: 'multiscales',
        uuid: 'd35379db-88df-4056-af3a-620245f8e347',
        tagCommit: '9b78efa75fef0fed302d9cf880037c569354d860',
      }),
    ])

    const result = parseGeoZarrConventionMetadata({
      group: {
        zarrFormat: 3,
        nodeType: 'group',
        path: '',
        metadata: fixture('geospatial-pyramid-v0.1.json'),
      },
    })
    expect(result.group.proj?.authorityCode).toBe('EPSG:32632')
    expect(result.multiscales?.layout.map((entry) => entry.asset)).toEqual(['0', '1', '2'])
    expect(result.diagnostics).toEqual([])
  })

  it('composes proj, spatial, and arbitrary multiscale levels into per-level grids', () => {
    const metadata = fixture('geospatial-pyramid-v0.1.json')
    const result = parseGeoZarrConventionMetadata({
      group: { zarrFormat: 3, nodeType: 'group', path: '', metadata },
      children: [
        array('0', {}, [10_000, 10_000], ['Y', 'X']),
        array('1', {}, [5_000, 5_000], ['Y', 'X']),
        array('2', {}, [2_500, 2_500], ['Y', 'X']),
      ],
    })
    expect(result.levels.map((entry) => entry.spatial?.geometry?.width)).toEqual([
      10_000, 5_000, 2_500,
    ])
    expect(result.levels[1]?.relativeScale).toEqual([2, 2])
    expect(result.levels[1]?.spatial?.affine).toEqual([20, 0, 500_000, 0, -20, 5_000_000])
    expect(result.levels[2]?.resamplingMethod).toBe('average')
  })

  it('normalizes the pinned spatial/proj array example and registration mapping', () => {
    const source = fixture('spatial-proj-v0.1.json')
    const result = parseGeoZarrConventionMetadata({
      group: group({ zarr_conventions: [] }),
      children: [
        {
          zarrFormat: 3,
          nodeType: 'array',
          path: 'data',
          metadata: source,
          shape: [256, 256],
        },
      ],
    })
    expect(result.children[0]?.spatial?.sourceDimensionIndices).toEqual([0, 1])
    expect(result.children[0]?.spatial?.pixelRegistration).toBe('pixel-is-area')
    expect(result.children[0]?.spatial?.geometry?.worldBounds).toEqual({
      minX: -20037508.342789244,
      minY: -20037508.342789244,
      maxX: 20037508.342789244,
      maxY: 20037508.342789244,
    })

    const node = parseGeoZarrConventionMetadata({
      group: group({ zarr_conventions: [registration(geoZarrSpatialConvention)] }),
      children: [
        array(
          'nodes',
          {
            'spatial:dimensions': ['Y', 'X'],
            'spatial:shape': [2, 3],
            'spatial:transform': [1, 0, 0, 0, -1, 1],
            'spatial:registration': 'node',
          },
          [2, 3],
          ['Y', 'X'],
        ),
      ],
    })
    expect(node.children[0]?.spatial?.pixelRegistration).toBe('pixel-is-point')
    expect(node.children[0]?.spatial?.geometry?.worldBounds).toEqual({
      minX: 0,
      minY: 0,
      maxX: 2,
      maxY: 1,
    })
  })

  it('normalizes equivalent v2 .zattrs and v3 attributes identically', () => {
    const attributes = {
      zarr_conventions: [
        registration(geoZarrProjConvention),
        registration(geoZarrSpatialConvention),
      ],
      'proj:code': 'EPSG:4326',
      'spatial:dimensions': ['lat', 'lon'],
      'spatial:shape': [180, 360],
      'spatial:transform': [1, 0, -180, 0, -1, 90],
      'spatial:registration': 'pixel',
    }
    const v3 = parseGeoZarrConventionMetadata(
      {
        group: group({ zarr_conventions: [] }),
        children: [array('data', attributes, [2, 180, 360], ['time', 'lat', 'lon'])],
      },
      { mode: 'compatibility' },
    )
    const v2 = parseGeoZarrConventionMetadata(
      {
        group: group({ zarr_conventions: [] }, 2),
        children: [array('data', attributes, [2, 180, 360], ['time', 'lat', 'lon'], 2)],
      },
      { mode: 'compatibility' },
    )
    expect(v2.children[0]?.proj).toEqual(v3.children[0]?.proj)
    expect(v2.children[0]?.spatial).toEqual(v3.children[0]?.spatial)
    expect(v2.children[0]?.node.attributes).toEqual(v3.children[0]?.node.attributes)
  })

  it('parses each convention independently', () => {
    const proj = parseGeoZarrConventionMetadata({
      group: group({
        zarr_conventions: [registration(geoZarrProjConvention)],
        'proj:wkt2': 'GEOGCRS["Example",ID["EPSG",4326]]',
      }),
    })
    expect(proj.group.proj?.wkt2).toContain('GEOGCRS')

    const spatial = parseGeoZarrConventionMetadata({
      group: group({ zarr_conventions: [registration(geoZarrSpatialConvention)] }),
      children: [
        array(
          'data',
          {
            'spatial:dimensions': ['Y', 'X'],
            'spatial:transform': [2, 0, 10, 0, -2, 20],
          },
          [5, 10],
          ['Y', 'X'],
        ),
      ],
    })
    expect(spatial.children[0]?.spatial?.geometry?.worldBounds).toEqual({
      minX: 10,
      minY: 10,
      maxX: 30,
      maxY: 20,
    })

    const multiscales = parseGeoZarrConventionMetadata({
      group: group({
        zarr_conventions: [registration(geoZarrMultiscalesConvention)],
        multiscales: {
          layout: [
            { asset: 'full' },
            { asset: 'third', derived_from: 'full', transform: { scale: [3, 3] } },
          ],
        },
      }),
      availablePaths: ['full', 'third'],
    })
    expect(multiscales.levels[1]?.relativeScale).toEqual([3, 3])
  })

  it('applies direct-child inheritance, child overrides, and per-level cropped transforms', () => {
    const result = parseGeoZarrConventionMetadata({
      group: group({
        zarr_conventions: allRegistrations(),
        'proj:code': 'EPSG:32632',
        'spatial:dimensions': ['Y', 'X'],
        'spatial:registration': 'pixel',
        multiscales: {
          layout: [
            {
              asset: 'base',
              'spatial:shape': [100, 100],
              'spatial:transform': [10, 0, 0, 0, -10, 1_000],
            },
            {
              asset: 'crop',
              derived_from: 'base',
              transform: { scale: [2, 2], translation: [10, 20] },
              'spatial:shape': [20, 30],
              'spatial:transform': [20, 0, 200, 0, -20, 800],
            },
          ],
        },
      }),
      children: [
        array('base', {}, [100, 100], ['Y', 'X']),
        array('crop', { 'proj:code': 'EPSG:3857' }, [20, 30], ['Y', 'X']),
      ],
    })
    expect(result.levels[1]?.proj?.authorityCode).toBe('EPSG:3857')
    expect(result.levels[1]?.relativeTranslation).toEqual([10, 20])
    expect(result.levels[1]?.spatial?.geometry?.worldBounds).toEqual({
      minX: 200,
      minY: 400,
      maxX: 800,
      maxY: 800,
    })
  })

  it('preserves unknown UUIDs and additive fields without matching by name', () => {
    const result = parseGeoZarrConventionMetadata(
      {
        group: group({
          zarr_conventions: [
            {
              uuid: '11111111-1111-4111-8111-111111111111',
              name: 'proj',
              schema_url: 'https://example.test/proj/v9/schema.json',
              future: { retained: true },
            },
          ],
        }),
      },
      { mode: 'compatibility' },
    )
    expect(result.registrations[0]?.known).toBeUndefined()
    expect(result.registrations[0]?.additional).toEqual({ future: { retained: true } })
    expect(result.diagnostics.map((entry) => entry.code)).toContain('known-name-unknown-uuid')
  })

  it('classifies older and newer tags of a known permanent UUID', () => {
    const older = parseGeoZarrConventionMetadata({
      group: group({
        zarr_conventions: [registration(geoZarrProjConvention, 'v0.0')],
        'proj:code': 'EPSG:4326',
      }),
    })
    expect(older.registrations[0]?.version.status).toBe('older')
    expect(older.group.proj?.authorityCode).toBe('EPSG:4326')

    const newerInput = {
      group: group({
        zarr_conventions: [registration(geoZarrProjConvention, 'v2')],
        'proj:code': 'EPSG:4326',
        'proj:future': { retained: true },
      }),
    }
    const newer = parseGeoZarrConventionMetadata(newerInput, { mode: 'compatibility' })
    expect(newer.registrations[0]?.version.status).toBe('newer')
    expect(newer.group.proj?.additional).toEqual({ 'proj:future': { retained: true } })
    expect(() => parseGeoZarrConventionMetadata(newerInput)).toThrow(GeoZarrConventionError)
  })

  it('reports malformed, duplicate, and conflicting registrations deterministically', () => {
    const malformed = parseGeoZarrConventionMetadata(
      {
        group: group({ zarr_conventions: [{ uuid: 'not-a-uuid' }] }),
      },
      { mode: 'compatibility' },
    )
    expect(malformed.diagnostics.map((entry) => entry.code)).toContain('malformed-uuid')

    const duplicate = parseGeoZarrConventionMetadata({
      group: group({
        zarr_conventions: [
          registration(geoZarrProjConvention),
          registration(geoZarrProjConvention),
        ],
      }),
    })
    expect(duplicate.diagnostics.map((entry) => entry.code)).toContain('duplicate-registration')

    expect(() =>
      parseGeoZarrConventionMetadata({
        group: group({
          zarr_conventions: [
            registration(geoZarrProjConvention),
            {
              ...registration(geoZarrProjConvention),
              spec_url: 'https://example.test/conflict/v0.1/spec',
            },
          ],
        }),
      }),
    ).toThrow(GeoZarrConventionError)
  })

  it('reports duplicate and missing multiscale paths', () => {
    const input = {
      group: group({
        zarr_conventions: [registration(geoZarrMultiscalesConvention)],
        multiscales: {
          layout: [
            { asset: 'present' },
            { asset: 'present' },
            { asset: 'missing', derived_from: 'absent', transform: { scale: [1.5, 3] } },
          ],
        },
      }),
      availablePaths: ['present'],
    }
    const compatible = parseGeoZarrConventionMetadata(input, { mode: 'compatibility' })
    expect(compatible.diagnostics.map((entry) => entry.code)).toEqual(
      expect.arrayContaining([
        'duplicate-multiscale-path',
        'missing-multiscale-path',
        'missing-derived-level',
      ]),
    )
    expect(() => parseGeoZarrConventionMetadata(input)).toThrow(GeoZarrConventionError)
  })

  it('detects conflicting CRS representations without resolving or transforming them', () => {
    const input = {
      group: group({
        zarr_conventions: [registration(geoZarrProjConvention)],
        'proj:code': 'EPSG:4326',
        'proj:projjson': {
          type: 'ProjectedCRS',
          name: 'Different CRS',
          id: { authority: 'EPSG', code: 3857 },
          coordinate_system: {
            axis: [
              { name: 'Easting', abbreviation: 'E', direction: 'east', unit: 'metre' },
              { name: 'Northing', abbreviation: 'N', direction: 'north', unit: 'metre' },
            ],
          },
        },
      }),
    }
    const compatible = parseGeoZarrConventionMetadata(input, { mode: 'compatibility' })
    expect(compatible.group.proj?.axes).toHaveLength(2)
    expect(compatible.unresolvedConflicts.map((entry) => entry.code)).toContain(
      'conflicting-crs-representations',
    )
    expect(() => parseGeoZarrConventionMetadata(input)).toThrow(GeoZarrConventionError)
  })

  it('never reinterprets unknown spatial transforms as affine', () => {
    const input = {
      group: group({ zarr_conventions: [registration(geoZarrSpatialConvention)] }),
      children: [
        array(
          'data',
          {
            'spatial:dimensions': ['Y', 'X'],
            'spatial:transform_type': 'rpc',
            'spatial:transform': [1, 0, 0, 0, -1, 10],
          },
          [10, 10],
          ['Y', 'X'],
        ),
      ],
    }
    const compatible = parseGeoZarrConventionMetadata(input, { mode: 'compatibility' })
    expect(compatible.children[0]?.spatial?.transformType).toBe('rpc')
    expect(compatible.children[0]?.spatial?.affine).toBeUndefined()
    expect(() => parseGeoZarrConventionMetadata(input)).toThrow(GeoZarrConventionError)
  })

  it('rejects invalid dimensions, singular affines, and shape disagreements in strict mode', () => {
    const invalid = {
      group: group({ zarr_conventions: [registration(geoZarrSpatialConvention)] }),
      children: [
        array(
          'data',
          {
            'spatial:dimensions': ['Y', 'missing'],
            'spatial:shape': [3, 4],
            'spatial:transform': [1, 2, 0, 2, 4, 0],
          },
          [2, 4],
          ['Y', 'X'],
        ),
      ],
    }
    const compatible = parseGeoZarrConventionMetadata(invalid, { mode: 'compatibility' })
    expect(compatible.diagnostics.map((entry) => entry.code)).toEqual(
      expect.arrayContaining(['spatial-dimension-missing', 'non-invertible-spatial-transform']),
    )
    expect(() => parseGeoZarrConventionMetadata(invalid)).toThrow(GeoZarrConventionError)
  })

  it('reports ambiguous child and per-level spatial overrides', () => {
    const input = {
      group: group({
        zarr_conventions: [
          registration(geoZarrSpatialConvention),
          registration(geoZarrMultiscalesConvention),
        ],
        'spatial:dimensions': ['Y', 'X'],
        multiscales: {
          layout: [
            { asset: 'data', 'spatial:shape': [10, 10], 'spatial:transform': [1, 0, 0, 0, -1, 10] },
          ],
        },
      }),
      children: [
        array('data', { 'spatial:transform': [2, 0, 0, 0, -2, 20] }, [10, 10], ['Y', 'X']),
      ],
    }
    const compatible = parseGeoZarrConventionMetadata(input, { mode: 'compatibility' })
    expect(compatible.unresolvedConflicts.map((entry) => entry.code)).toContain(
      'ambiguous-inheritance',
    )
    expect(() => parseGeoZarrConventionMetadata(input)).toThrow(GeoZarrConventionError)
  })

  it('enforces bounded additive metadata', () => {
    expect(() =>
      parseGeoZarrConventionMetadata(
        {
          group: group({
            zarr_conventions: [registration(geoZarrProjConvention)],
            'proj:code': 'EPSG:4326',
            'proj:future': { text: 'x'.repeat(100) },
          }),
        },
        { mode: 'compatibility', limits: { maxStringLength: 64 } },
      ),
    ).toThrow('is too long')
  })
})
