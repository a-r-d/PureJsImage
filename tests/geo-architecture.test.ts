import { globSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { describe, expect, expectTypeOf, it } from 'vitest'
import * as geoZarrConventionApi from '../src/geo/conventions/geozarr/index.ts'
import type {
  GeoRasterDataset,
  GeoRasterDescriptor,
  GeoSpatialReference,
  GeoTargetGrid,
} from '../src/geo/index.ts'
import * as geoApi from '../src/geo/index.ts'
import * as allGeoReaders from '../src/geo/readers/all.ts'
import * as geoEnviReaderApi from '../src/geo/readers/envi.ts'
import * as asciiGridReaderApi from '../src/geo/readers/esri-ascii-grid.ts'
import * as geoTiffReaderApi from '../src/geo/readers/geotiff.ts'
import * as geoZarrReaderApi from '../src/geo/readers/geozarr/index.ts'
import * as geoReaderApi from '../src/geo/readers/index.ts'
import * as geoNetCdfReaderApi from '../src/geo/readers/netcdf.ts'
import * as hgtReaderApi from '../src/geo/readers/srtm-hgt.ts'
import * as worldFileReaderApi from '../src/geo/readers/world-file.ts'
import type { ScientificDataset } from '../src/scientific/dataset.ts'

const repositoryRoot = resolve(import.meta.dirname, '..')
const sourceRoot = resolve(repositoryRoot, 'src')

const importedSpecifiers = (path: string): readonly string[] => {
  const source = readFileSync(path, 'utf8')
  return [
    ...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g),
    ...source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]/g),
    ...source.matchAll(/(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g),
  ].flatMap((match) => (match[1] === undefined ? [] : [match[1]]))
}

const resolvedImport = (path: string, specifier: string): string | undefined =>
  specifier.startsWith('.') ? resolve(dirname(path), specifier) : undefined

describe('geo architecture boundaries', () => {
  it('reuses the scientific dataset and existing target-grid contracts', () => {
    expectTypeOf<GeoRasterDataset['scientificDataset']>().toEqualTypeOf<ScientificDataset>()
    expectTypeOf<GeoRasterDescriptor['shape']>().toEqualTypeOf<readonly number[]>()
    expectTypeOf<GeoSpatialReference['coordinateSystemType']>().toMatchTypeOf<string>()
    expectTypeOf<GeoTargetGrid['crs']>().toEqualTypeOf<GeoSpatialReference>()
  })

  it('keeps scientific independent from geo', () => {
    const reverseImports = globSync('src/scientific/**/*.ts', { cwd: repositoryRoot }).flatMap(
      (relativePath) => {
        const path = resolve(repositoryRoot, relativePath)
        return importedSpecifiers(path).flatMap((specifier) => {
          const imported = resolvedImport(path, specifier)
          return imported !== undefined && relative(sourceRoot, imported).startsWith('geo/')
            ? [`${relativePath}: ${specifier}`]
            : []
        })
      },
    )

    expect(reverseImports).toEqual([])
  })

  it('limits geo imports of scientific code to documented public primitives', () => {
    const allowed = new Set([
      'scientific/dataset.ts',
      'scientific/numeric-tile.ts',
      'scientific/reader.ts',
      'scientific/readers/tiff.ts',
      'scientific/readers/tiff-bridge.ts',
      'scientific/readers/envi.ts',
      'scientific/readers/jpeg.ts',
      'scientific/readers/png.ts',
      'scientific/node.ts',
    ])
    const scientificImports = globSync('src/geo/**/*.ts', { cwd: repositoryRoot }).flatMap(
      (relativePath) => {
        const path = resolve(repositoryRoot, relativePath)
        return importedSpecifiers(path).flatMap((specifier) => {
          const imported = resolvedImport(path, specifier)
          if (imported === undefined || !relative(sourceRoot, imported).startsWith('scientific/')) {
            return []
          }
          return [relative(sourceRoot, imported)]
        })
      },
    )

    expect(scientificImports.length).toBeGreaterThan(0)
    expect(scientificImports.filter((path) => !allowed.has(path))).toEqual([])
  })

  it('keeps format readers below docs-site and application code', () => {
    const disallowedRoots = [
      resolve(repositoryRoot, 'docs-astro'),
      resolve(repositoryRoot, 'examples'),
      resolve(sourceRoot, 'analysis'),
      resolve(sourceRoot, 'application'),
      resolve(sourceRoot, 'extensions'),
    ]
    const invalidImports = globSync(['src/scientific/readers/**/*.ts', 'src/geo/readers/**/*.ts'], {
      cwd: repositoryRoot,
    }).flatMap((relativePath) => {
      const path = resolve(repositoryRoot, relativePath)
      return importedSpecifiers(path).flatMap((specifier) => {
        const imported = resolvedImport(path, specifier)
        return imported !== undefined && disallowedRoots.some((root) => imported.startsWith(root))
          ? [`${relativePath}: ${specifier}`]
          : []
      })
    })

    expect(invalidImports).toEqual([])
  })

  it('keeps browser-only APIs out of environment-neutral geo entries', () => {
    const neutralEntries = globSync('src/geo/**/*.ts', { cwd: repositoryRoot }).filter(
      (path) =>
        !path.includes('/browser/') && !path.endsWith('/node.ts') && !path.endsWith('-node.ts'),
    )
    for (const relativePath of neutralEntries) {
      const source = readFileSync(resolve(repositoryRoot, relativePath), 'utf8')
      expect(source, relativePath).not.toMatch(/from\s+['"].*browser(?:\.ts)?['"]/u)
      expect(source, relativePath).not.toMatch(/\b(?:Document|File|FileList|HTMLElement|Window)\b/u)
    }
  })

  it('exports only the intended runtime reader registry and no parser internals', () => {
    expect(Object.keys(geoApi)).toEqual(
      expect.arrayContaining([
        'calculateGeoWorldBounds',
        'createGeoDiagnostic',
        'createGeoGridGeometry',
        'defaultGeoValidationLimits',
        'geoRasterSchemaVersion',
        'geoViewPlaneCount',
        'geoWorldBoundsToPixelRegion',
        'invertGeoAffine',
        'normalizeGeoGridGeometry',
        'normalizeGeoPixelRegion',
        'normalizeGeoRasterDescriptor',
        'normalizeGeoSpatialReference',
        'resolveGeoValidationLimits',
        'validateGeoRasterDescriptor',
        'adaptScientificDatasetToGeo',
        'adaptScientificDocumentDatasetToGeo',
        'geoSpatialReferenceToScientific',
        'normalizeGeoTargetGrid',
        'readReprojectedGeoRegion',
        'createRasterBandMathPlan',
      ]),
    )
    expect(Object.keys(geoApi).some((name) => /(?:parser|tiff|zarr|codec)/iu.test(name))).toBe(
      false,
    )
    expect(Object.keys(geoReaderApi)).toEqual([])
    expect(Object.keys(allGeoReaders)).toEqual(['geoReaders'])
    expect(allGeoReaders.geoReaders).toEqual([
      geoTiffReaderApi.geoTiffReader,
      geoZarrReaderApi.geoZarrReader,
      worldFileReaderApi.worldFileReader,
      geoEnviReaderApi.geoEnviReader,
      asciiGridReaderApi.esriAsciiGridReader,
      hgtReaderApi.srtmHgtReader,
      geoNetCdfReaderApi.geoNetCdfReader,
    ])
    expect(Object.keys(geoTiffReaderApi).sort()).toEqual([
      'createGeoTiffReader',
      'geoTiffReader',
      'geoTiffReaderDescriptor',
    ])
    expect(Object.keys(geoZarrReaderApi).sort()).toEqual([
      'createGeoZarrReader',
      'geoZarrReader',
      'geoZarrReaderDescriptor',
      'openGeoZarrHttp',
      'openGeoZarrObjectStore',
    ])
    expect(Object.keys(geoNetCdfReaderApi).sort()).toEqual([
      'cfGridMappings',
      'createGeoNetCdfReader',
      'geoNetCdfReader',
      'geoNetCdfReaderDescriptor',
    ])

    for (const relativePath of ['src/geo/index.ts', 'src/geo/readers/index.ts']) {
      const source = readFileSync(resolve(repositoryRoot, relativePath), 'utf8')
      expect(source, relativePath).not.toMatch(/(?:formats|geotiff|parser|codecs)\//u)
    }
  })

  it('keeps GeoZarr convention parsing on its explicit public subpath', () => {
    expect(Object.keys(geoZarrConventionApi).sort()).toEqual([
      'GeoZarrConventionError',
      'defaultGeoZarrConventionLimits',
      'extractGeoZarrConventionNode',
      'geoZarrConventionRegistry',
      'geoZarrMultiscalesConvention',
      'geoZarrProjConvention',
      'geoZarrSpatialConvention',
      'parseGeoZarrConventionMetadata',
      'resolveGeoZarrConventionLimits',
    ])
    expect(Object.keys(geoApi).some((name) => /zarr/iu.test(name))).toBe(false)
  })
})
