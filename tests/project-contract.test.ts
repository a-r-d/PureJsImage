import { globSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { avifCorpusRevision, avifFixtures } from '../benchmark/avif/corpus.ts'
import corpusManifest from '../benchmark/corpus/manifest.json' with { type: 'json' }
import { heifBenchmarkFixtures } from '../benchmark/heif/corpus.ts'
import { jpegCompatibilityFixtureIds } from '../benchmark/jpeg/corpus.ts'
import { workflows, workflowsForProfile } from '../benchmark/workflows.ts'
import packageJson from '../package.json' with { type: 'json' }
import * as publicApi from '../src/index.ts'

describe('package contract', () => {
  it('has no production dependencies', () => {
    expect('dependencies' in packageJson).toBe(false)
    expect('optionalDependencies' in packageJson).toBe(false)
  })

  it('keeps source, benchmark, scripts, and test code in TypeScript', () => {
    const javascriptSources = globSync([
      'benchmark/**/*.{cjs,js,jsx,mjs}',
      'scripts/**/*.{cjs,js,jsx,mjs}',
      'src/**/*.{cjs,js,jsx,mjs}',
      'tests/**/*.{cjs,js,jsx,mjs}',
    ])

    expect(javascriptSources).toEqual([])
  })

  it('does not import third-party packages from production source', () => {
    const imports = globSync('src/**/*.ts')
      .flatMap((path) => [
        ...readFileSync(path, 'utf8').matchAll(/(?:from\s+|import\()\s*['"]([^'"]+)['"]/g),
      ])
      .map((match) => match[1])
      .filter((specifier): specifier is string => specifier !== undefined)
      .filter((specifier) => !specifier.startsWith('.') && !specifier.startsWith('node:'))

    expect(imports).toEqual([])
  })

  it('keeps codec implementations outside the root runtime module graph', () => {
    const root = resolve('src/index.ts')
    const pending = [root]
    const visited = new Set<string>()
    while (pending.length > 0) {
      const path = pending.pop()
      if (!path || visited.has(path)) continue
      visited.add(path)
      const source = readFileSync(path, 'utf8')
      const declarations = source.matchAll(
        /(?:^|\n)\s*(?:import|export)\s+([\s\S]*?)\s+from\s+['"](\.[^'"]+)['"]/g,
      )
      for (const declaration of declarations) {
        const clause = declaration[1]
        const specifier = declaration[2]
        if (!clause || !specifier || clause.trimStart().startsWith('type ')) continue
        pending.push(resolve(dirname(path), specifier))
      }
      for (const sideEffectImport of source.matchAll(/(?:^|\n)\s*import\s+['"](\.[^'"]+)['"]/g)) {
        const specifier = sideEffectImport[1]
        if (specifier) pending.push(resolve(dirname(path), specifier))
      }
    }

    const sourceRoot = resolve('src')
    const runtimeModules = [...visited].map((path) => relative(sourceRoot, path))
    expect(runtimeModules.some((path) => path.startsWith(`codecs/`))).toBe(false)
    expect(runtimeModules.some((path) => path.startsWith(`codec-entries/`))).toBe(false)
  })

  it('publishes browser and codec capabilities through explicit package subpaths', () => {
    expect(Object.keys(packageJson.exports)).toEqual([
      '.',
      './browser',
      './codecs/all',
      './codecs/avif',
      './codecs/bmp',
      './codecs/gif',
      './codecs/heif',
      './codecs/ico',
      './codecs/jpeg',
      './codecs/jpeg2000',
      './codecs/png',
      './codecs/tiff',
      './codecs/webp',
    ])
    for (const name of [
      'allCodecs',
      'avifCodec',
      'bmpCodec',
      'gifCodec',
      'heifCodec',
      'icoCodec',
      'jpegCodec',
      'jpeg2000Codec',
      'pngCodec',
      'tiffCodec',
      'webpCodec',
    ]) {
      expect(name in publicApi).toBe(false)
    }
  })
})

describe('benchmark contract', () => {
  it('pins a diverse AVIF starter corpus to one upstream revision', () => {
    expect(avifCorpusRevision).toMatch(/^[a-f0-9]{40}$/)
    expect(avifFixtures).toHaveLength(25)
    expect(new Set(avifFixtures.map(({ id }) => id)).size).toBe(avifFixtures.length)
    expect(new Set(avifFixtures.map(({ expected }) => expected.bitDepth))).toEqual(
      new Set([8, 10, 12]),
    )
    expect(new Set(avifFixtures.map(({ expected }) => expected.chromaSubsampling))).toEqual(
      new Set(['400', '420', '422', '444']),
    )
    expect(avifFixtures.some(({ expected }) => expected.hasAlpha)).toBe(true)
  })

  it('keeps workflow identifiers unique', () => {
    const ids = workflows.map(({ id }) => id)

    expect(new Set(ids).size).toBe(ids.length)
  })

  it('pins real iPhone HEIC grid fixtures and validates benchmark pixels', () => {
    const sourceIds = new Set(corpusManifest.sources.map(({ id }) => id))
    expect(heifBenchmarkFixtures).toHaveLength(3)
    expect(new Set(heifBenchmarkFixtures.map(({ id }) => id)).size).toBe(3)
    expect(heifBenchmarkFixtures.every(({ id }) => sourceIds.has(id))).toBe(true)
    expect(new Set(heifBenchmarkFixtures.map(({ expected }) => expected.orientation))).toEqual(
      new Set([6, 8]),
    )
    expect(
      heifBenchmarkFixtures.every(
        ({ expected }) =>
          expected.primaryItemType === 'grid' &&
          expected.codedImages === 48 &&
          expected.codecProfile === 3,
      ),
    ).toBe(true)

    const pixelWorkflows = workflowsForProfile('heif').filter(
      (workflow) => !workflow.operations?.some((operation) => operation.type === 'metadata'),
    )
    expect(pixelWorkflows).toHaveLength(3)
    expect(pixelWorkflows.every(({ expected }) => (expected.pixelSamples?.length ?? 0) >= 4)).toBe(
      true,
    )
  })

  it('pins ICC and Apple gain-map JPEG compatibility fixtures', () => {
    const sourceIds = new Set(corpusManifest.sources.map(({ id }) => id))
    expect(jpegCompatibilityFixtureIds).toHaveLength(5)
    expect(jpegCompatibilityFixtureIds.every((id) => sourceIds.has(id))).toBe(true)
  })

  it('keeps every profile populated and ordered by scope', () => {
    const smoke = workflowsForProfile('smoke')
    const standard = workflowsForProfile('standard')
    const full = workflowsForProfile('full')
    const phase4 = workflowsForProfile('phase4')
    const phase5 = workflowsForProfile('phase5')
    const bmp = workflowsForProfile('bmp')
    const heif = workflowsForProfile('heif')
    const ico = workflowsForProfile('ico')
    const tiff = workflowsForProfile('tiff')
    const webp = workflowsForProfile('webp')

    expect(smoke.length).toBeGreaterThan(0)
    expect(phase4.length).toBe(12)
    expect(phase5.length).toBe(5)
    expect(bmp.length).toBe(16)
    expect(heif.length).toBe(4)
    expect(ico.length).toBe(6)
    expect(tiff.length).toBe(10)
    expect(webp.length).toBe(9)
    expect(standard.length).toBeGreaterThan(smoke.length)
    expect(full.length).toBeGreaterThan(standard.length)
    expect(full).toEqual(
      workflows.filter(
        (workflow) =>
          workflow.tier !== 'bmp' &&
          workflow.tier !== 'heif' &&
          workflow.tier !== 'ico' &&
          workflow.tier !== 'tiff' &&
          workflow.tier !== 'webp',
      ),
    )
    expect(bmp).toEqual(workflows.filter((workflow) => workflow.tier === 'bmp'))
    expect(heif).toEqual(workflows.filter((workflow) => workflow.tier === 'heif'))
    expect(ico).toEqual(workflows.filter((workflow) => workflow.tier === 'ico'))
    expect(tiff).toEqual(workflows.filter((workflow) => workflow.tier === 'tiff'))
    expect(webp).toEqual(workflows.filter((workflow) => workflow.tier === 'webp'))
  })

  it('rejects unknown profiles', () => {
    expect(() => workflowsForProfile('quick-ish')).toThrow('Unknown profile: quick-ish')
  })
})
