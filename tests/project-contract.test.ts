import { globSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { avifCorpusRevision, avifFixtures } from '../benchmark/avif/corpus.ts'
import corpusManifest from '../benchmark/corpus/manifest.json' with { type: 'json' }
import { readCompatibilityManifest } from '../benchmark/heif/compatibility/corpus.ts'
import { heifBenchmarkFixtures } from '../benchmark/heif/corpus.ts'
import { jpegCompatibilityFixtureIds } from '../benchmark/jpeg/corpus.ts'
import { workflows, workflowsForProfile } from '../benchmark/workflows.ts'
import packageJson from '../package.json' with { type: 'json' }
import { commonCompetitorCodecs, competitorBundleTargets } from '../scripts/bundle-size-config.ts'
import { allCodecs } from '../src/codec-entries/all.ts'
import {
  experimentalHeicCodec,
  experimentalHeifCodec,
} from '../src/codec-entries/experimental/heic.ts'
import * as publicApi from '../src/index.ts'
import buildTsconfig from '../tsconfig.build.json' with { type: 'json' }

describe('package contract', () => {
  it('does not publish unusable source maps without source files', () => {
    expect(buildTsconfig.compilerOptions.sourceMap).toBe(false)
    expect(buildTsconfig.compilerOptions.declarationMap).toBe(false)
    expect(packageJson.files).not.toContain('src')
  })

  it('has no production dependencies', () => {
    expect('dependencies' in packageJson).toBe(false)
    expect('optionalDependencies' in packageJson).toBe(false)
  })

  it('keeps bundle and deployment size reporting in the full check gate', () => {
    expect(packageJson.scripts.check).toContain('npm run size')
    expect(packageJson.scripts.size).toContain('npm run build')
  })

  it('checks packed declarations without Node ambient types', () => {
    expect(packageJson.scripts.check).toContain('npm run package:types')
    expect(packageJson.scripts['package:types']).toBe('node scripts/check-package-types.ts')
  })

  it('pins benchmark competitors without adding a Canvas library', () => {
    expect(packageJson.devDependencies.sharp).toBe('0.35.3')
    expect(packageJson.devDependencies['image-js']).toBe('1.7.0')
    expect(packageJson.devDependencies['@jsquash/resize']).toBe('2.1.1')
    expect('skia-canvas' in packageJson.devDependencies).toBe(false)
  })

  it('keeps bundle comparisons codec-scoped and identifies native payloads', () => {
    expect(commonCompetitorCodecs).toEqual(['JPEG', 'PNG'])
    expect(competitorBundleTargets.map((target) => target.id)).toEqual([
      'purejsimage-matched',
      'purejsimage-all',
      'jimp',
      'image-js',
      'jsquash',
      'sharp',
    ])
    for (const target of competitorBundleTargets) {
      for (const codec of commonCompetitorCodecs) expect(target.codecs).toContain(codec)
    }
    expect(competitorBundleTargets.find((target) => target.id === 'sharp')?.implementation).toBe(
      'native-wrapper',
    )
    expect(competitorBundleTargets.find((target) => target.id === 'jsquash')?.implementation).toBe(
      'webassembly',
    )

    const readme = readFileSync('README.md', 'utf8')
    const performancePage = readFileSync('docs/performance.html', 'utf8')
    for (const label of [
      'PureJsImage matched',
      'Jimp',
      'image-js',
      'jSquash',
      'Sharp JS wrapper',
    ]) {
      expect(readme).toContain(label)
      expect(performancePage).toContain(label)
    }
    expect(readme).toContain(packageJson.version)
    expect(performancePage).toContain('0.7.0')
    for (const version of ['1.6.0', '1.7.0', '0.35.3']) {
      expect(readme).toContain(version)
      expect(performancePage).toContain(version)
    }
    expect(readme).toContain('Sharp, including native libvips')
    expect(performancePage).toContain('Native payload.')
  })

  it('keeps real-browser validation tools development-only and version-pinned', () => {
    expect(packageJson.devDependencies['@playwright/test']).toBe('1.62.1')
    expect(packageJson.devDependencies['@jsquash/jpeg']).toBe('1.6.0')
    expect(packageJson.devDependencies['@jsquash/png']).toBe('3.1.1')
    expect(packageJson.devDependencies['@jsquash/resize']).toBe('2.1.1')
    expect(packageJson.devDependencies['@jsquash/webp']).toBe('1.5.0')
    expect(packageJson.scripts['bench:competitors']).toContain('image-js,jsquash')
    expect(packageJson.scripts['browser:test']).toBe('playwright test')
    expect(packageJson.scripts['browser:bench']).toContain('--project=chromium')
  })

  it('embeds the checked-in competitor charts in the README and docs homepage', () => {
    const readme = readFileSync('README.md', 'utf8')
    const docsHome = readFileSync('docs/index.html', 'utf8')
    const docsPerformance = readFileSync('docs/performance.html', 'utf8')
    for (const chart of [
      'benchmark/results/competitors-speed-2026-08-09.png',
      'benchmark/results/competitors-quality-2026-08-09.png',
      'benchmark/results/competitors-memory-2026-08-09.png',
    ]) {
      expect(readme).toContain(`](${chart})`)
      expect(readFileSync(chart).byteLength).toBeGreaterThan(0)
    }
    for (const chart of [
      'assets/competitors-speed-2026-08-09.png',
      'assets/competitors-quality-2026-08-09.png',
      'assets/competitors-memory-2026-08-09.png',
    ]) {
      expect(docsHome).toContain(`src="${chart}"`)
      expect(docsPerformance).toContain(`src="${chart}"`)
      expect(readFileSync(`docs/${chart}`).byteLength).toBeGreaterThan(0)
    }
  })

  it('publishes one generated TIFF library comparison across documentation surfaces', () => {
    const readme = readFileSync('README.md', 'utf8')
    const docsHome = readFileSync('docs/index.html', 'utf8')
    const tiffGuide = readFileSync('docs/tiff.html', 'utf8')
    const comparison = readFileSync('docs/tiff-comparison.html', 'utf8')
    const sitemap = readFileSync('docs/sitemap.xml', 'utf8')

    expect(packageJson.scripts['comparison:generate']).toBe(
      'node scripts/render-library-comparison.ts',
    )
    expect(packageJson.scripts['comparison:check']).toBe(
      'node scripts/render-library-comparison.ts --check',
    )
    expect(packageJson.scripts.check).toContain('npm run comparison:check')
    expect(readme).toContain('https://a-r-d.github.io/PureJsImage/tiff-comparison.html')
    expect(docsHome).toContain('href="tiff-comparison.html"')
    expect(tiffGuide).toContain('href="tiff-comparison.html"')
    expect(comparison).toContain('Grouped by TIFF workflow')
    expect(comparison).toContain('Not verified')
    expect(comparison).toContain('Versioned evidence')
    expect(sitemap).toContain('https://a-r-d.github.io/PureJsImage/tiff-comparison.html')
  })

  it('publishes a capability-backed LLM guide and footer discovery links', () => {
    const llms = readFileSync('docs/llms.txt', 'utf8')
    const sitemap = readFileSync('docs/sitemap.xml', 'utf8')
    for (const section of [
      '## Image transform quick API',
      '## Encoder quick API',
      '## Codec capability map',
      '## Replace Jimp',
      '## Replace Sharp',
      '## Replace image-js',
      '## Replace @jsquash packages',
      '## Replace GeoTIFF.js or UTIF.js/utif2',
    ]) {
      expect(llms).toContain(section)
    }
    for (const codec of [
      '### JPEG',
      '### PNG',
      '### WebP',
      '### BMP',
      '### TIFF',
      '### GIF',
      '### ICO',
      '### JPEG 2000 / JP2',
      '### AVIF',
      '### HEIF / HEIC (experimental)',
    ]) {
      expect(llms).toContain(codec)
    }
    expect(llms).toContain('<!-- capabilities:llms:start -->')
    expect(llms).toContain('<!-- capabilities:llms:end -->')
    expect(sitemap).toContain('https://a-r-d.github.io/PureJsImage/llms.txt')

    const websitePages = globSync('docs/*.html')
      .map((path) => ({ path, html: readFileSync(path, 'utf8') }))
      .filter(({ html }) => html.includes('class="site-footer"'))
    expect(websitePages.length).toBeGreaterThan(0)
    for (const { path, html } of websitePages) {
      expect(html, path).toContain('href="llms.txt">LLM guide</a>')
      expect(html, path).toContain('href="sitemap.xml">Sitemap</a>')
    }
  })

  it('publishes a self-contained browser conversion demo with a separate README link', () => {
    const readme = readFileSync('README.md', 'utf8')
    const demo = readFileSync('docs/demo.html', 'utf8')
    const docsBuild = readFileSync('scripts/build-docs-site.ts', 'utf8')
    const gitignore = readFileSync('.gitignore', 'utf8')
    const pagesWorkflow = readFileSync('.github/workflows/pages.yml', 'utf8')
    const sitemap = readFileSync('docs/sitemap.xml', 'utf8')
    expect(readme).toContain('https://a-r-d.github.io/PureJsImage/demo.html')
    expect(demo).toContain('assets/demo-app.js')
    expect(demo).toContain('No server upload')
    expect(demo).toContain('Rust/WASM JPEG decoder')
    expect(demo).toContain('demo-metric-comparison')
    expect(demo).toContain('Max observed JS heap')
    expect(demo).toContain(`purejsimage@${packageJson.version}/dist/browser.js`)
    expect(demo).toContain(`purejsimage@${packageJson.version}/dist/codec-entries/all.js`)
    expect(demo).not.toMatch(/<script[^>]+src=["']https?:/)
    expect(packageJson.scripts['docs:build']).toBe('node scripts/build-docs-site.ts')
    expect(packageJson.scripts.check).toContain('npm run docs:build')
    expect(docsBuild).toContain("entryPoints: ['docs/demo.ts']")
    expect(docsBuild).toContain("resolve('src/accelerator-entries/jpeg-decoder.wasm')")
    expect(docsBuild).toContain("join(outputDirectory, 'assets/jpeg-decoder.wasm')")
    expect(docsBuild).toContain("resolve('benchmark/.tmp/docs-site')")
    expect(gitignore).toContain('/docs/assets/demo-app.js')
    expect(pagesWorkflow).toContain('actions/upload-pages-artifact@v5')
    expect(pagesWorkflow).toContain('actions/deploy-pages@v5')
    expect(pagesWorkflow).toContain('path: benchmark/.tmp/docs-site')
    expect(sitemap).toContain('https://a-r-d.github.io/PureJsImage/demo.html')
  })

  it('keeps source, benchmark, scripts, and test code in TypeScript', () => {
    const javascriptSources = globSync([
      'benchmark/**/*.{cjs,js,jsx,mjs}',
      'browser-tests/**/*.{cjs,js,jsx,mjs}',
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
    expect(runtimeModules.some((path) => path.startsWith(`accelerators/`))).toBe(false)
    expect(runtimeModules.some((path) => path.startsWith(`accelerator-entries/`))).toBe(false)
  })

  it('publishes browser and codec capabilities through explicit package subpaths', () => {
    expect(Object.keys(packageJson.exports)).toEqual([
      '.',
      './browser',
      './tiff',
      './scientific',
      './pathology',
      './compression/zstd',
      './accelerators/wasm/jpeg',
      './accelerators/wasm/png',
      './codecs/all',
      './codecs/avif',
      './codecs/bmp',
      './codecs/gif',
      './codecs/experimental/heic',
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
      'experimentalHeicCodec',
      'experimentalHeifCodec',
      'heicCodec',
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

  it('keeps experimental HEIC out of the default codec set', () => {
    expect(allCodecs.map(({ format }) => format)).not.toContain('heif')
    expect(experimentalHeicCodec).toBe(experimentalHeifCodec)
    expect(experimentalHeicCodec.format).toBe('heif')
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

  it('pins a provenance-rich HEIF compatibility corpus before expanding syntax', async () => {
    const manifest = await readCompatibilityManifest()

    expect(manifest.fixtures).toHaveLength(25)
    expect(new Set(manifest.fixtures.map(({ id }) => id)).size).toBe(25)
    expect(manifest.fixtures.every(({ sha256 }) => /^[a-f0-9]{64}$/.test(sha256))).toBe(true)
    expect(manifest.fixtures.every(({ license, provenance }) => license && provenance)).toBe(true)
    const primaryTypes = new Set(manifest.fixtures.map(({ primaryItemType }) => primaryItemType))
    expect(primaryTypes.has('grid')).toBe(true)
    expect(primaryTypes.has('hvc1')).toBe(true)
    expect(new Set(manifest.fixtures.map(({ hevc }) => hevc.bitDepth)).has(10)).toBe(true)
    const transforms = new Set(manifest.fixtures.flatMap(({ transforms }) => transforms))
    expect(transforms.has('irot')).toBe(true)
    expect(transforms.has('imir')).toBe(true)
    expect(transforms.has('clap')).toBe(true)
    expect(new Set(manifest.fixtures.map(({ color }) => color.range))).toEqual(
      new Set(['full', 'limited']),
    )
    expect(manifest.fixtures.some(({ auxiliaryItems }) => auxiliaryItems.length > 0)).toBe(true)
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
    const competitors = workflowsForProfile('competitors')

    expect(smoke.length).toBeGreaterThan(0)
    expect(phase4.length).toBe(12)
    expect(phase5.length).toBe(5)
    expect(bmp.length).toBe(16)
    expect(heif.length).toBe(4)
    expect(ico.length).toBe(6)
    expect(tiff.length).toBe(18)
    expect(webp.length).toBe(11)
    expect(competitors).toHaveLength(14)
    expect(
      competitors
        .filter(
          (workflow) => !workflow.operations?.some((operation) => operation.type === 'metadata'),
        )
        .every((workflow) => (workflow.expected.pixelSamples?.length ?? 0) >= 3),
    ).toBe(true)
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
