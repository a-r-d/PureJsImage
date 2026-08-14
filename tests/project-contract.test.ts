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
import {
  commonCompetitorCodecs,
  competitorBundleTargets,
  pureJsImageEntryTargets,
} from '../scripts/bundle-size-config.ts'
import { allCodecs } from '../src/codec-entries/all.ts'
import * as analysisApi from '../src/analysis/index.ts'
import * as analysisProjectApi from '../src/analysis/project-entry.ts'
import * as analysisResultsApi from '../src/analysis/results.ts'
import * as analysisRoiApi from '../src/analysis/roi-entry.ts'
import * as analysisRuntimeApi from '../src/analysis/runtime.ts'
import {
  experimentalHeicCodec,
  experimentalHeifCodec,
} from '../src/codec-entries/experimental/heic.ts'
import * as browserPublicApi from '../src/browser.ts'
import * as pathologyApi from '../src/pathology/index.ts'
import * as scientificApi from '../src/scientific/index.ts'
import * as allScientificReaders from '../src/scientific/readers/all.ts'
import * as enviReaderApi from '../src/scientific/readers/envi.ts'
import * as gsfReaderApi from '../src/scientific/readers/gsf.ts'
import * as omeTiffReaderApi from '../src/scientific/readers/ome-tiff.ts'
import * as httpRangeApi from '../src/sources/http-range.ts'
import * as tiffApi from '../src/tiff/index.ts'
import * as publicApi from '../src/index.ts'
import buildTsconfig from '../tsconfig.build.json' with { type: 'json' }
import rootTsconfig from '../tsconfig.json' with { type: 'json' }

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

  it('runs the strict source-lifetime suite in one full test pass', () => {
    expect(packageJson.scripts.check.match(/npm test/g)).toHaveLength(1)
    expect(packageJson.scripts.check).not.toContain('test:hostile-source')
    expect(packageJson.scripts).not.toHaveProperty('test:hostile-source')
  })

  it('centers public positioning on the first-party codec suite', () => {
    const readme = readFileSync('README.md', 'utf8')
    const docsHome = readFileSync('docs-astro/src/pages/index.astro', 'utf8')
    const scientificPlatform = readFileSync(
      'docs-astro/src/pages/scientific/platform.astro',
      'utf8',
    )
    const specification = readFileSync('project-spec.md', 'utf8')
    const roadmap = readFileSync('ROADMAP.md', 'utf8')

    expect(packageJson.description).toBe(
      'First-party image codecs and low-memory raster processing in strict TypeScript',
    )
    expect(readme).toContain(
      'PureJsImage is building a broad suite of first-party image codecs in strict',
    )
    expect(readme).toContain(
      'The strict TypeScript reference engine is the permanent portable path',
    )
    expect(docsHome).toContain('Free and open source · zero runtime dependencies')
    expect(docsHome).toContain('Image codecs and low-memory raster processing in')
    expect(docsHome).toContain('building a broad suite of first-party codecs')
    expect(docsHome).toContain('86.7%')
    expect(docsHome).toContain('157.8 vs 1,188.3 MiB')
    expect(docsHome).toContain('87.6%')
    expect(docsHome).toContain('157.8 vs 1,276.5 MiB')
    expect(docsHome).toContain("The 106 display-image cases come from Imazen's TIFF corpus")
    expect(docsHome).toContain('6000 × 4000 JPEG workflow')
    expect(docsHome).toContain('2,122,449,395-byte Aperio SVS pathology slide')
    expect(docsHome).toContain('Low-memory JPEG demo')
    expect(docsHome.toLowerCase()).not.toContain('evidence')
    expect(readme).toContain('## Special thanks')
    expect(readme).toContain('[Imazen](https://github.com/imazen)')
    expect(readme).toContain('A native whole-slide browser demo')
    expect(specification).toContain('The top-level engineering constraints are:')
    expect(specification).toContain(
      'PureJsImage is a first-party image codec suite and low-memory raster engine',
    )
    expect(roadmap).toContain('Every codec follows the same durable lifecycle')
    expect(roadmap).toContain('The explicitly imported JPEG and PNG accelerators')
    for (const document of [readme, docsHome, scientificPlatform]) {
      expect(document).toContain('https://lab.purejsimage.com/')
      expect(document).toContain('electron microscopy')
    }
    for (const document of [readme, docsHome, specification, roadmap]) {
      expect(document).not.toContain('modern alternative to Jimp')
      expect(document).not.toContain('Jimp alternative')
      expect(document).not.toContain('pure JavaScript image processing library')
    }
  })

  it('keeps bundle and deployment size reporting in the full check gate', () => {
    expect(packageJson.scripts.check).toContain('npm run size')
    expect(packageJson.scripts.size).toContain('npm run build')
    expect(pureJsImageEntryTargets.find(({ id }) => id === 'core')?.maxMinifiedBytes).toBe(
      60 * 1024,
    )
    expect(pureJsImageEntryTargets.find(({ id }) => id === 'scientific')).toMatchObject({
      name: 'Core + scientific platform',
      contents: expect.stringContaining('./src/scientific/index.ts'),
      baselineMinifiedBytes: 143_546,
      maxMinifiedBytes: 187_000,
    })
    expect(
      pureJsImageEntryTargets
        .filter(({ id }) => id.startsWith('scientific-reader'))
        .map(({ id, maxMinifiedBytes }) => [id, maxMinifiedBytes]),
    ).toEqual([
      ['scientific-reader-gsf', 50_000],
      ['scientific-reader-envi', 75_000],
      ['scientific-reader-fits', 60_000],
      ['scientific-reader-mrc', 51_000],
      ['scientific-reader-cbf', 55_000],
      ['scientific-reader-ome-tiff', 350_000],
      ['scientific-reader-aperio-svs', 338_000],
      ['scientific-reader-png', 87_601],
      ['scientific-reader-jpeg', 136_260],
      ['scientific-readers-all', 509_161],
    ])
    expect(pureJsImageEntryTargets.find(({ id }) => id === 'operations')).toMatchObject({
      baselineMinifiedBytes: 44_252,
      maxMinifiedBytes: 58_000,
    })
    expect(pureJsImageEntryTargets.find(({ id }) => id === 'analysis')).toMatchObject({
      baselineMinifiedBytes: 270_789,
      maxMinifiedBytes: 353_000,
    })
    expect(
      pureJsImageEntryTargets
        .filter(({ id }) => id.startsWith('analysis-'))
        .map(({ id, baselineMinifiedBytes, maxMinifiedBytes }) => [
          id,
          baselineMinifiedBytes,
          maxMinifiedBytes,
        ]),
    ).toEqual([
      ['analysis-results', 55_713, 72_427],
      ['analysis-roi', 32_622, 42_409],
      ['analysis-runtime', 57_784, 75_120],
      ['analysis-project', 51_214, 66_578],
    ])
    expect(pureJsImageEntryTargets.find(({ id }) => id === 'extensions')).toMatchObject({
      baselineMinifiedBytes: 46_564,
      maxMinifiedBytes: 61_000,
    })
  })

  it('checks packed declarations without Node ambient types', () => {
    expect(packageJson.scripts.check).toContain('npm run package:types')
    expect(packageJson.scripts['package:types']).toBe('node scripts/check-package-types.ts')
  })

  it('publishes one version-one scientific dataset vocabulary', () => {
    const scientificIndex = readFileSync('src/scientific/index.ts', 'utf8')
    const scientificPublic = readFileSync('src/scientific/public.ts', 'utf8')
    const scientificDataset = readFileSync('src/scientific/dataset.ts', 'utf8')

    for (const publicSource of [scientificIndex, scientificPublic]) {
      expect(publicSource).not.toMatch(/Labeled[A-Z]|\bV2\b|dataset-v2|public-v2/u)
    }
    expect(scientificDataset).toContain('readonly schemaVersion: 1')
    expect(scientificDataset).not.toContain('readonly schemaVersion: 2')
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
    const performancePage = readFileSync('docs-astro/src/pages/performance.astro', 'utf8')
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
    expect(performancePage).toContain(packageJson.version)
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
    const docsHome = readFileSync('docs-astro/src/pages/index.astro', 'utf8')
    const docsPerformance = readFileSync('docs-astro/src/pages/performance.astro', 'utf8')
    for (const chart of [
      'benchmark/results/competitors-speed-2026-08-10.png',
      'benchmark/results/competitors-quality-2026-08-10.png',
      'benchmark/results/competitors-memory-2026-08-10.png',
    ]) {
      expect(readme).toContain(`](${chart})`)
      expect(readFileSync(chart).byteLength).toBeGreaterThan(0)
    }
    for (const chart of [
      'assets/competitors-speed-2026-08-10.png',
      'assets/competitors-quality-2026-08-10.png',
      'assets/competitors-memory-2026-08-10.png',
    ]) {
      expect(docsHome).toContain(`src="${chart}"`)
      expect(docsPerformance).toContain(`src="../${chart}"`)
      expect(readFileSync(`docs-astro/public/${chart}`).byteLength).toBeGreaterThan(0)
    }
  })

  it('publishes one generated TIFF library comparison across documentation surfaces', () => {
    const readme = readFileSync('README.md', 'utf8')
    const docsHome = readFileSync('docs-astro/src/pages/index.astro', 'utf8')
    const tiffGuide = readFileSync('docs-astro/src/pages/tiff.astro', 'utf8')
    const comparison = readFileSync('docs-astro/src/pages/tiff-comparison.astro', 'utf8')
    const sitemap = readFileSync('docs-astro/public/sitemap.xml', 'utf8')

    expect(packageJson.scripts['comparison:generate']).toBe(
      'node scripts/render-library-comparison.ts',
    )
    expect(packageJson.scripts['comparison:check']).toBe(
      'node scripts/render-library-comparison.ts --check',
    )
    expect(packageJson.scripts.check).toContain('npm run comparison:check')
    expect(readme).toContain('https://purejsimage.com/tiff-comparison/')
    expect(docsHome).toContain('href="tiff-comparison/"')
    expect(tiffGuide).toContain('href="../tiff-comparison/"')
    expect(comparison).toContain('Grouped by TIFF workflow')
    expect(comparison).toContain('Not verified')
    expect(comparison).toContain('Versioned evidence')
    expect(readme).toContain('PureJsImage benchmark snapshot · 3be4530')
    expect(readme).toContain(
      '104/106 decoded<br>57 exact<br>47 pixel mismatches<br>2 oracle-unavailable cases',
    )
    expect(readme).not.toContain('0.8.0 workspace')
    expect(docsHome).toContain(
      '<strong>104/106 decoded</strong><small>57 exact · 47 pixel mismatches</small>',
    )
    expect(docsHome).toContain('Scientific and instrument imagery')
    expect(docsHome).toContain('designed to grow across scientific instruments')
    expect(docsHome).toContain('One scientific application')
    expect(docsHome).toContain('assets/whole-slide-viewer-showcase.jpg')
    const benchmarkPosition = docsHome.indexOf('id="benchmark"')
    const wholeSlidePosition = docsHome.indexOf('class="section home-wsi-showcase"')
    const memoryModelPosition = docsHome.indexOf('id="memory-model"')
    const tiffComparisonPosition = docsHome.indexOf('id="tiff-library-comparison"')
    expect(benchmarkPosition).toBeLessThan(wholeSlidePosition)
    expect(wholeSlidePosition).toBeLessThan(memoryModelPosition)
    expect(memoryModelPosition).toBeLessThan(tiffComparisonPosition)
    expect(docsHome).toContain('38 at or above 40 dB PSNR')
    expect(docsHome).toContain('Jimp uses utif2 for TIFF internally')
    expect(tiffGuide).toContain('Decoded / comparable')
    expect(comparison).toContain(
      'benchmark snapshot at commit 3be45301e877c8811c42102f1403bf211d8253cf',
    )
    expect(comparison).toContain('Decode coverage, exact pixels, and reported outcomes')
    expect(comparison).toContain('Oracle unavailable')
    expect(sitemap).toContain('https://purejsimage.com/tiff-comparison/')
  })

  it('publishes a capability-backed LLM guide and footer discovery links', () => {
    const llms = readFileSync('docs-astro/public/llms.txt', 'utf8')
    const sitemap = readFileSync('docs-astro/public/sitemap.xml', 'utf8')
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
    expect(sitemap).toContain('https://purejsimage.com/llms.txt')
    for (const api of [
      'window({ center, width })',
      'lut({ table, format })',
      'options?: { signal?: AbortSignal }',
      'tile(column, row, { signal })',
    ]) {
      expect(llms).toContain(api)
    }

    const websitePages = globSync('docs-astro/src/pages/*.astro')
      .map((path) => ({ path, html: readFileSync(path, 'utf8') }))
      .filter(({ html }) => html.includes('class="site-footer"'))
    expect(websitePages.length).toBeGreaterThan(0)
    for (const { path, html } of websitePages) {
      expect(html, path).toMatch(/href="(?:\.\.\/)?llms\.txt">LLM guide<\/a>/)
      expect(html, path).toMatch(/href="(?:\.\.\/)?sitemap\.xml">Sitemap<\/a>/)
    }
  })

  it('publishes a self-contained browser conversion demo with a separate README link', () => {
    const readme = readFileSync('README.md', 'utf8')
    const demo = readFileSync('docs-astro/src/pages/demo.astro', 'utf8')
    const docsBuild = readFileSync('scripts/build-docs-site.ts', 'utf8')
    const pagesWorkflow = readFileSync('.github/workflows/pages.yml', 'utf8')
    const sitemap = readFileSync('docs-astro/public/sitemap.xml', 'utf8')
    expect(readme).toContain('https://purejsimage.com/demo/')
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
    expect(packageJson.devDependencies.astro).toBeDefined()
    expect(packageJson.devDependencies['@astrojs/react']).toBeDefined()
    expect(packageJson.devDependencies.react).toBeDefined()
    expect(packageJson.devDependencies['react-dom']).toBeDefined()
    expect(docsBuild).toContain("entryPoints: ['docs-astro/src/scripts/demo.ts']")
    expect(docsBuild).toContain("resolve('src/accelerator-entries/jpeg-decoder.wasm')")
    expect(docsBuild).toContain("join(outputDirectory, 'assets/jpeg-decoder.wasm')")
    expect(docsBuild).toContain("resolve('benchmark/.tmp/docs-site')")
    expect(globSync('docs-astro/public/assets/demo-app.js')).toEqual([])
    expect(pagesWorkflow).toContain('actions/upload-pages-artifact@v5')
    expect(pagesWorkflow).toContain('actions/deploy-pages@v5')
    expect(pagesWorkflow).toContain('path: benchmark/.tmp/docs-site')
    expect(sitemap).toContain('https://purejsimage.com/demo/')
  })

  it('publishes a local-only scientific raster explorer and public dataset APIs', () => {
    const readme = readFileSync('README.md', 'utf8')
    const page = readFileSync('docs-astro/src/pages/scientific.astro', 'utf8')
    const platformPage = readFileSync('docs-astro/src/pages/scientific/platform.astro', 'utf8')
    const platformExample = readFileSync(
      'examples/scientific-application-platform/index.ts',
      'utf8',
    )
    const apiPage = readFileSync('docs-astro/src/pages/api.astro', 'utf8')
    const llms = readFileSync('docs-astro/public/llms.txt', 'utf8')
    const worker = readFileSync('docs-astro/src/scripts/scientific-worker.ts', 'utf8')
    const sources = readFileSync('docs-astro/public/demo-data/scientific/SOURCES.md', 'utf8')
    const sitemap = readFileSync('docs-astro/public/sitemap.xml', 'utf8')

    expect(readme).toContain('https://purejsimage.com/api/#scientific')
    expect(readme).toContain('https://purejsimage.com/scientific/')
    expect(page).toContain('GSF, ENVI, FITS, MRC, and CBF files stay in this browser tab')
    expect(page).toContain(
      "import { startScientificExplorer } from '../scripts/scientific-explorer.ts'",
    )
    expect(page).not.toMatch(/<script[^>]+src=["']https?:/)
    expect(page).toContain('https://dirsapps.cis.rit.edu/share2012/SPECTIR_HSI/')
    expect(page).toContain('https://aviris.jpl.nasa.gov/data/free_data.html')
    expect(page).toContain('https://daac.ornl.gov/AVIRIS/')
    expect(page).toContain('https://daac.ornl.gov/HYTES/')
    expect(page).toContain('M3G20081129T171431_V03_RDN.HDR')
    expect(page).toContain('M3G20081129T171431_V03_RDN.IMG')
    expect(page).toContain('0920-1701_pol_ref_geo.hdr')
    expect(page).toContain('0920-1701_pol_ref_geo.img')
    expect(page).toContain('afghan_thematicmap_1micron.zip')
    expect(page).toContain('WFPC2ASSNu5780205bx.fits')
    expect(page).toContain('UITfuv2582gc.fits')
    expect(page).toContain('swp05569slg.fits')
    expect(page.match(/class="scientific-file-type"/g)).toHaveLength(8)
    expect(worker).toContain('rangeCache')
    expect(worker).toContain('settings.channel')
    expect(worker).toContain("openedDocument.reader.id === 'purejsimage/fits'")
    expect(worker).toContain('displayAxes')
    expect(sources.replaceAll(/\s+/g, ' ')).toContain(
      'do not contain or derive from third-party measurements',
    )
    expect(sources).toContain('npm run demo:scientific:generate')
    expect(sitemap).toContain('https://purejsimage.com/scientific/')
    expect(sitemap).toContain('https://purejsimage.com/scientific/platform/')
    expect(platformPage).toContain(
      "import applicationExample from '../../../../examples/scientific-application-platform/index.ts?raw'",
    )
    expect(platformPage).toContain(
      "import ApplicationPlatformDiagram from '../../components/ApplicationPlatformDiagram.astro'",
    )
    expect(platformPage).toContain('Application APIs: alpha')
    expect(platformPage).toContain('Introduced in 0.10.0')
    expect(platformPage).toContain('Provider and extension APIs: experimental')
    expect(platformPage).toContain('materials microscopy and instrument imagery')
    expect(platformExample).toContain("from 'purejsimage/analysis'")
    expect(platformExample).toContain('computeAnalysisProjectHashes')
    for (const entry of [
      'purejsimage/scientific',
      'purejsimage/scientific/browser',
      'purejsimage/scientific/node',
      'purejsimage/scientific/readers/all',
      'purejsimage/scientific/readers/aperio-svs',
      'purejsimage/scientific/readers/cbf',
      'purejsimage/scientific/readers/envi',
      'purejsimage/scientific/readers/fits',
      'purejsimage/scientific/readers/gsf',
      'purejsimage/scientific/readers/mrc',
      'purejsimage/scientific/readers/ome-tiff',
      'purejsimage/scientific/readers/png',
      'purejsimage/scientific/readers/jpeg',
      'purejsimage/operations',
      'purejsimage/analysis',
      'purejsimage/extensions',
    ]) {
      expect(apiPage).toContain(`<code>${entry}</code>`)
      expect(llms).toContain(`\`${entry}\``)
      expect(rootTsconfig.compilerOptions.paths).toHaveProperty(entry)
    }
    expect(llms).toContain('## Scientific application platform (alpha in 0.10.0)')
    expect(llms).toContain('PureJsImage 0.10.0 introduces these alpha application entrypoints')
    expect(llms).toContain('initial bounded ROI masks, statistics, histograms, line profiles')
    expect(packageJson.exports).toHaveProperty('./scientific/node')
    expect(scientificApi).not.toHaveProperty('openGsf')
    expect(scientificApi).not.toHaveProperty('encodeGsf')
    expect(scientificApi).not.toHaveProperty('openEnvi')
    expect(scientificApi).not.toHaveProperty('openFits')
    expect(scientificApi).not.toHaveProperty('toScientificDataset')
    expect(scientificApi).not.toHaveProperty('toMultidimensionalRasterDataset')
    expect(scientificApi).toHaveProperty('createScientificLibrary')
    expect(scientificApi).not.toHaveProperty('fitsReader')
    expect(scientificApi).not.toHaveProperty('enviReader')
    expect(gsfReaderApi).toHaveProperty('encodeGsf')
    expect(enviReaderApi).toHaveProperty('renderEnviClassification')
    expect(allScientificReaders).toHaveProperty('fitsReader')
    expect(allScientificReaders).toHaveProperty('enviReader')
    expect(scientificApi).toHaveProperty('measureScientificPlane')
    expect(scientificApi).toHaveProperty('renderScientificPlane')
    expect(scientificApi).toHaveProperty('renderSpectralComposite')
  })

  it('publishes clean docs routes at the canonical custom domain', () => {
    const header = readFileSync('docs-astro/src/components/SiteHeader.astro', 'utf8')
    const layout = readFileSync('docs-astro/src/layouts/SiteLayout.astro', 'utf8')
    const notFound = readFileSync('docs-astro/src/pages/404.astro', 'utf8')
    const astroConfig = readFileSync('docs-astro/astro.config.ts', 'utf8')
    const cname = readFileSync('docs-astro/public/CNAME', 'utf8')

    expect(header).toContain('const configuredBase = import.meta.env.BASE_URL')
    expect(header).toMatch(/href=\{`\$\{siteBase\}\$\{href\}`\}/)
    expect(header).toContain('href={siteBase}')
    expect(header).toContain('href="https://lab.purejsimage.com/"')
    expect(header).toContain('Open App')
    expect(header).not.toContain('.html')
    expect(layout).not.toContain('<base ')
    expect(notFound).not.toContain('/PureJsImage')
    expect(astroConfig).toContain("site: 'https://purejsimage.com'")
    expect(astroConfig).not.toContain('base:')
    expect(astroConfig).toContain("trailingSlash: 'always'")
    expect(astroConfig).toContain("format: 'directory'")
    expect(cname).toBe('purejsimage.com\n')
    expect(packageJson.homepage).toBe('https://purejsimage.com/')
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
    expect(runtimeModules.some((path) => path.startsWith(`scientific/`))).toBe(false)
    expect(runtimeModules.some((path) => path.startsWith(`operations/`))).toBe(false)
    expect(runtimeModules.some((path) => path.startsWith(`analysis/`))).toBe(false)
    expect(runtimeModules.some((path) => path.startsWith(`extensions/`))).toBe(false)
    expect(readFileSync(resolve('src/executor.ts'), 'utf8')).not.toMatch(/from ['"].*operations\//)
  })

  it('publishes browser and codec capabilities through explicit package subpaths', () => {
    expect(Object.keys(packageJson.exports)).toEqual([
      '.',
      './browser',
      './tiff',
      './scientific',
      './scientific/node',
      './scientific/browser',
      './scientific/readers/gsf',
      './scientific/readers/envi',
      './scientific/readers/fits',
      './scientific/readers/mrc',
      './scientific/readers/cbf',
      './scientific/readers/ome-tiff',
      './scientific/readers/aperio-svs',
      './scientific/readers/png',
      './scientific/readers/jpeg',
      './scientific/readers/all',
      './operations',
      './analysis',
      './analysis/results',
      './analysis/roi',
      './analysis/runtime',
      './analysis/project',
      './extensions',
      './pathology',
      './sources/http-range',
      './compression/zstd',
      './accelerators/wasm/jpeg',
      './accelerators/wasm/png',
      './codecs/all',
      './codecs/avif',
      './codecs/bmp',
      './codecs/hdr',
      './codecs/gif',
      './codecs/experimental/heic',
      './codecs/ico',
      './codecs/jpeg',
      './codecs/jpeg2000',
      './codecs/jpegxl',
      './codecs/netpbm',
      './codecs/png',
      './codecs/qoi',
      './codecs/tiff',
      './codecs/tga',
      './codecs/webp',
    ])
    expect(analysisApi).not.toHaveProperty('validateScalarResult')
    expect(analysisApi).not.toHaveProperty('measureScientificPlaneWithResults')
    expect(analysisApi).toHaveProperty('createAnalysisController')
    expect(analysisApi).toHaveProperty('validateGraph')
    expect(analysisApi).toHaveProperty('hashAnalysisGraph')
    expect(analysisApi).not.toHaveProperty('createImageLibrary')
    expect(analysisResultsApi).toHaveProperty('validateScalarResult')
    expect(analysisRoiApi).toHaveProperty('createRoiMask')
    expect(analysisRuntimeApi).toHaveProperty('createTileRuntime')
    expect(analysisProjectApi).toHaveProperty('inspectMigrationPlan')
    for (const name of [
      'allCodecs',
      'avifCodec',
      'bmpCodec',
      'hdrCodec',
      'gifCodec',
      'experimentalHeicCodec',
      'experimentalHeifCodec',
      'heicCodec',
      'heifCodec',
      'icoCodec',
      'jpegCodec',
      'jpeg2000Codec',
      'jpegxlCodec',
      'netpbmCodec',
      'pngCodec',
      'qoiCodec',
      'tiffCodec',
      'tgaCodec',
      'webpCodec',
    ]) {
      expect(name in publicApi).toBe(false)
    }
    for (const name of [
      'aperioSvsProfile',
      'geoTiffProfile',
      'HttpRangeSource',
      'isAperioSvs',
      'isOmeTiff',
      'omeTiffProfile',
      'openAperioSvs',
      'openOmeTiff',
      'rasterSampleBytes',
      'rasterToPixels',
    ]) {
      expect(name in publicApi).toBe(false)
      expect(name in browserPublicApi).toBe(false)
    }
    expect(typeof pathologyApi.openAperioSvs).toBe('function')
    expect('openOmeTiff' in scientificApi).toBe(false)
    expect('omeTiffReader' in scientificApi).toBe(false)
    expect(typeof omeTiffReaderApi.omeTiffReader.open).toBe('function')
    expect(typeof scientificApi.rasterToPixels).toBe('function')
    expect(typeof httpRangeApi.HttpRangeSource.open).toBe('function')
    expect(tiffApi.geoTiffProfile.id).toBe('geotiff')
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
    const smallCodecs = workflowsForProfile('small-codecs')
    const competitors = workflowsForProfile('competitors')

    expect(smoke.length).toBeGreaterThan(0)
    expect(phase4.length).toBe(12)
    expect(phase5.length).toBe(5)
    expect(bmp.length).toBe(16)
    expect(heif.length).toBe(4)
    expect(ico.length).toBe(6)
    expect(tiff.length).toBe(18)
    expect(webp.length).toBe(11)
    expect(smallCodecs.length).toBe(18)
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
          workflow.tier !== 'small-codecs' &&
          workflow.tier !== 'webp',
      ),
    )
    expect(bmp).toEqual(workflows.filter((workflow) => workflow.tier === 'bmp'))
    expect(heif).toEqual(workflows.filter((workflow) => workflow.tier === 'heif'))
    expect(ico).toEqual(workflows.filter((workflow) => workflow.tier === 'ico'))
    expect(tiff).toEqual(workflows.filter((workflow) => workflow.tier === 'tiff'))
    expect(smallCodecs).toEqual(workflows.filter((workflow) => workflow.tier === 'small-codecs'))
    expect(webp).toEqual(workflows.filter((workflow) => workflow.tier === 'webp'))
  })

  it('rejects unknown profiles', () => {
    expect(() => workflowsForProfile('quick-ish')).toThrow('Unknown profile: quick-ish')
  })
})
