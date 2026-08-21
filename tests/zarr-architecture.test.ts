import { globSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const repositoryRoot = resolve(import.meta.dirname, '..')
const sourceRoot = resolve(repositoryRoot, 'src')
const zarrRoot = resolve(sourceRoot, 'zarr')

const importedSpecifiers = (path: string): readonly string[] => {
  const source = readFileSync(path, 'utf8')
  return [
    ...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/gu),
    ...source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]/gu),
    ...source.matchAll(/(?:^|\n)\s*import\s+['"]([^'"]+)['"]/gu),
  ].flatMap((match) => (match[1] === undefined ? [] : [match[1]]))
}

describe('generic Zarr dependency boundary', () => {
  it('keeps the substrate below scientific, geo, and application semantics', () => {
    const disallowed = ['scientific/', 'geo/', 'analysis/', 'application/', 'extensions/']
    const invalidImports = globSync('src/zarr/**/*.ts', { cwd: repositoryRoot }).flatMap(
      (relativePath) => {
        const path = resolve(repositoryRoot, relativePath)
        return importedSpecifiers(path).flatMap((specifier) => {
          if (!specifier.startsWith('.')) return []
          const imported = relative(sourceRoot, resolve(dirname(path), specifier))
          return disallowed.some((prefix) => imported.startsWith(prefix))
            ? [`${relativePath}: ${specifier}`]
            : []
        })
      },
    )
    expect(invalidImports).toEqual([])
  })

  it('keeps OME-NGFF interpretation above the generic array engine', () => {
    const omeSource = readFileSync(resolve(sourceRoot, 'scientific/formats/ome-zarr.ts'), 'utf8')
    const genericSources = globSync('src/zarr/**/*.ts', { cwd: repositoryRoot }).map((path) =>
      readFileSync(resolve(repositoryRoot, path), 'utf8'),
    )
    expect(omeSource).toMatch(/from ['"]\.\/zarr\.ts['"]/u)
    for (const source of genericSources) {
      expect(source).not.toMatch(/\b(?:multiscales|omero|image-label|plates?|wells?)\b/iu)
      expect(source).not.toMatch(/GeoZarr (?:CRS|spatial transform)/u)
    }
  })

  it('has one chunk decoder and one HTTP object-store implementation', () => {
    const sourceFiles = globSync('src/**/*.ts', { cwd: repositoryRoot })
    const regularDecoders = sourceFiles.filter((path) =>
      readFileSync(resolve(repositoryRoot, path), 'utf8').includes('const decodeRegularChunk ='),
    )
    const httpStores = sourceFiles.filter((path) =>
      readFileSync(resolve(repositoryRoot, path), 'utf8').includes(
        'class ZarrHttpObjectStore implements ZarrObjectStore',
      ),
    )
    expect(regularDecoders).toEqual(['src/zarr/core.ts'])
    expect(httpStores).toEqual(['src/zarr/http-store.ts'])
  })

  it('keeps the portable substrate free of Node-only and browser-only adapters', () => {
    for (const relativePath of globSync('src/zarr/**/*.ts', { cwd: repositoryRoot }).filter(
      (path) => path !== 'src/zarr/node.ts',
    )) {
      const source = readFileSync(resolve(repositoryRoot, relativePath), 'utf8')
      expect(source, relativePath).not.toMatch(/from\s+['"]node:/u)
      expect(source, relativePath).not.toMatch(/\b(?:Buffer|File|FileList|HTMLElement|Window)\b/u)
    }
    expect(readFileSync(resolve(zarrRoot, 'index.ts'), 'utf8')).not.toContain("'./node.ts'")
  })

  it('keeps the substrate internal while preserving scientific compatibility wrappers', () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(repositoryRoot, 'package.json'), 'utf8'),
    ) as { readonly exports: Readonly<Record<string, unknown>> }
    expect(packageJson.exports).not.toHaveProperty('./zarr')
    expect(readFileSync(resolve(sourceRoot, 'scientific/formats/zarr.ts'), 'utf8')).toContain(
      "export * from '../../zarr/core.ts'",
    )
    expect(readFileSync(resolve(sourceRoot, 'scientific/ome-zarr-http.ts'), 'utf8')).toContain(
      "from '../zarr/http-store.ts'",
    )
    expect(resolve(zarrRoot, 'core.ts')).toBe(resolve(sourceRoot, 'zarr/core.ts'))
  })
})
