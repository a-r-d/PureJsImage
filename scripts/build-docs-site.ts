import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { build as buildAstro } from 'astro'
import { build } from 'esbuild'
import { generatedScientificFixtures } from '../benchmark/scientific-readers/generated-fixtures.ts'
import { assertGeoShowcaseSourceInputs, geoShowcaseSourceAliases } from './geo-showcase-build.ts'
import { geoShowcaseZarrResources } from './geo-showcase-fixtures.ts'

const sourceDirectory = resolve('docs-astro')
const outputDirectory = resolve('benchmark/.tmp/docs-site')
const outputBundle = join(outputDirectory, 'assets/demo-app.js')
const outputWsiBundle = join(outputDirectory, 'assets/wsi-viewer.js')
const outputWsiWorker = join(outputDirectory, 'assets/wsi-worker.js')
const outputOmeZarrBundle = join(outputDirectory, 'assets/ome-zarr-viewer.js')
const outputOmeZarrWorker = join(outputDirectory, 'assets/ome-zarr-worker.js')
const outputGeoBundle = join(outputDirectory, 'assets/geo-showcase.js')
const outputGeoWorker = join(outputDirectory, 'assets/geo-showcase-worker.js')
const outputWasm = join(outputDirectory, 'assets/jpeg-decoder.wasm')
const outputSimdDecoderWasm = join(outputDirectory, 'assets/jpeg-decoder-simd.wasm')
const outputEncoderWasm = join(outputDirectory, 'assets/jpeg-encoder.wasm')
const outputSimdEncoderWasm = join(outputDirectory, 'assets/jpeg-encoder-simd.wasm')
const outputPngWasm = join(outputDirectory, 'assets/png-codec.wasm')
const outputSimdPngWasm = join(outputDirectory, 'assets/png-codec-simd.wasm')
const outputWebpWasm = join(outputDirectory, 'assets/webp-codec.wasm')
const outputSimdWebpWasm = join(outputDirectory, 'assets/webp-codec-simd.wasm')

await buildAstro({ root: sourceDirectory })

const hdrSampleNames = [
  'hdr-surgery-synthetic-dual.jpg',
  'hdr-surgery-synthetic-xmp.jpg',
  'hdr-surgery-synthetic-iso.jpg',
  'hdr-surgery-synthetic-rgb-progressive.jpg',
  'hdr-surgery-synthetic-odd-scale.jpg',
  'hdr-surgery-synthetic-12mp.jpg',
] as const
await mkdir(join(outputDirectory, 'demo-data'), { recursive: true })
for (const name of hdrSampleNames) {
  await copyFile(join('benchmark/corpus/files', name), join(outputDirectory, 'demo-data', name))
}

const geoFixtureDirectory = join(outputDirectory, 'fixtures/geo/geozarr-cube')
for (const resource of geoShowcaseZarrResources()) {
  const target = join(geoFixtureDirectory, resource.name)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, resource.bytes)
}
await mkdir(join(outputDirectory, 'fixtures/geo'), { recursive: true })
await copyFile(
  resolve('tests/fixtures/cog/showcase-subifd-deflate-rotated.tif'),
  join(outputDirectory, 'fixtures/geo/overview-cog.tif'),
)

const featureTourFactory = generatedScientificFixtures['ome-zarr-feature-tour-generated']
if (featureTourFactory === undefined) throw new Error('Missing generated OME-Zarr Feature Tour')
const featureTour = featureTourFactory()
const featureTourDirectory = join(outputDirectory, 'fixtures/ome-zarr-feature-tour')
let featureTourBytes = 0
for (const resource of featureTour.resources) {
  const target = join(featureTourDirectory, resource.name)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, resource.bytes)
  featureTourBytes += resource.bytes.byteLength
}
const maximumFeatureTourBytes = 4 * 1_024 * 1_024
if (featureTourBytes > maximumFeatureTourBytes) {
  throw new Error(
    `Generated OME-Zarr Feature Tour is ${featureTourBytes.toLocaleString()} bytes; expected at most ${maximumFeatureTourBytes.toLocaleString()}`,
  )
}

const builtIndexPages = async (directory: string): Promise<readonly string[]> => {
  const pages: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) pages.push(...(await builtIndexPages(path)))
    else if (entry.name === 'index.html') pages.push(path)
  }
  return pages
}

const sitemapIndex = await readFile(join(outputDirectory, 'sitemap-index.xml'), 'utf8')
if (!sitemapIndex.includes('https://purejsimage.com/sitemap-0.xml')) {
  throw new Error('Generated sitemap index does not reference sitemap-0.xml')
}
const sitemap = await readFile(join(outputDirectory, 'sitemap-0.xml'), 'utf8')
for (const page of await builtIndexPages(outputDirectory)) {
  const directory = dirname(relative(outputDirectory, page)).replaceAll('\\', '/')
  const route = directory === '.' ? '/' : `/${directory}/`
  if (!sitemap.includes(`<loc>https://purejsimage.com${route}</loc>`)) {
    throw new Error(`Generated sitemap omits canonical Astro route ${route}`)
  }
}
if (sitemap.includes('/llms.txt')) throw new Error('Generated sitemap includes non-HTML llms.txt')

const hdrPage = await readFile(join(outputDirectory, 'hdr-surgery', 'index.html'), 'utf8')
for (const required of [
  '<title>Ultra HDR JPEG Editor and Gain Map Inspector for JavaScript | PureJsImage</title>',
  'name="description" content="Inspect, render, crop, resize, and re-encode Ultra HDR (JPEG_R/JPEGR) and ISO 21496-1 gain-map images in JavaScript and TypeScript for browsers and Node.js."',
  'rel="canonical" href="https://purejsimage.com/hdr-surgery/"',
  'property="og:image:width" content="1200"',
  'property="og:image:height" content="630"',
  'name="twitter:title"',
  'Quick answer',
  'Interactive workbench',
  'How Ultra HDR JPEG gain maps work',
  'FAQ',
]) {
  if (!hdrPage.includes(required)) throw new Error(`Generated HDR Surgery page omits ${required}`)
}
if (!/<h1[^>]*>Ultra HDR JPEG editor and gain map inspector for JavaScript<\/h1>/u.test(hdrPage)) {
  throw new Error('Generated HDR Surgery page omits its required H1')
}
const hdrJsonLd = [
  ...hdrPage.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g),
]
  .map(
    (match) =>
      JSON.parse(match[1] ?? '{}') as {
        readonly '@graph'?: readonly { readonly '@type'?: string }[]
      },
  )
  .flatMap((value) => value['@graph'] ?? [])
for (const type of ['WebApplication', 'TechArticle', 'BreadcrumbList']) {
  if (!hdrJsonLd.some((value) => value['@type'] === type)) {
    throw new Error(`Generated HDR Surgery JSON-LD omits ${type}`)
  }
}
const llms = await readFile(join(outputDirectory, 'llms.txt'), 'utf8')
for (const required of [
  '/hdr-surgery/',
  'docs/hdr-surgery.md',
  'purejsimage/hdr',
  'openGainMapImage',
  'inspectGainMapImage',
]) {
  if (!llms.includes(required)) throw new Error(`Generated llms.txt omits ${required}`)
}

const homePage = await readFile(join(outputDirectory, 'index.html'), 'utf8')
const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const jsonLdScriptPattern = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g
const structuredData = [...homePage.matchAll(jsonLdScriptPattern)].map((match, index) => {
  const serialized = match[1]
  if (serialized === undefined) {
    throw new Error(`Generated home page JSON-LD block ${index + 1} has no content`)
  }
  let value: unknown
  try {
    value = JSON.parse(serialized)
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`Generated home page JSON-LD block ${index + 1} is invalid JSON: ${detail}`)
  }
  if (!isRecord(value)) {
    throw new Error(`Generated home page JSON-LD block ${index + 1} is not an object`)
  }
  if (value['@context'] !== 'https://schema.org') {
    throw new Error(`Generated home page JSON-LD block ${index + 1} has an invalid @context`)
  }
  return value
})
const structuredDataOfType = (type: string): Readonly<Record<string, unknown>> => {
  const matches = structuredData.filter((value) => value['@type'] === type)
  if (matches.length !== 1 || matches[0] === undefined) {
    throw new Error(`Generated home page must contain exactly one ${type} JSON-LD object`)
  }
  return matches[0]
}

structuredDataOfType('WebSite')
const softwareSourceCode = structuredDataOfType('SoftwareSourceCode')
if ('downloadUrl' in softwareSourceCode) {
  throw new Error(
    'Generated SoftwareSourceCode metadata must not use SoftwareApplication.downloadUrl',
  )
}
for (const [property, expected] of [
  ['codeRepository', 'https://github.com/a-r-d/PureJsImage'],
  ['citation', 'https://github.com/a-r-d/PureJsImage/blob/main/CITATION.cff'],
] as const) {
  if (softwareSourceCode[property] !== expected) {
    throw new Error(`Generated SoftwareSourceCode metadata has an invalid ${property}`)
  }
}

const faqPage = structuredDataOfType('FAQPage')
if (faqPage['@id'] !== 'https://purejsimage.com/#faq') {
  throw new Error('Generated FAQPage metadata has an invalid @id')
}
const questions = faqPage.mainEntity
if (!Array.isArray(questions) || questions.length === 0) {
  throw new Error('Generated FAQPage metadata must contain at least one mainEntity')
}
const visibleHomePage = homePage.replace(jsonLdScriptPattern, '')
const visibleFaqCount = visibleHomePage.match(/class="home-faq-item"/g)?.length ?? 0
if (visibleFaqCount !== questions.length) {
  throw new Error(
    `Generated FAQPage has ${questions.length} questions but the visible FAQ has ${visibleFaqCount}`,
  )
}
const questionNames = new Set<string>()
for (const [index, value] of questions.entries()) {
  if (!isRecord(value) || value['@type'] !== 'Question') {
    throw new Error(`Generated FAQPage mainEntity ${index + 1} is not a Question`)
  }
  const name = value.name
  const acceptedAnswer = value.acceptedAnswer
  if (typeof name !== 'string' || name.trim() === '') {
    throw new Error(`Generated FAQPage Question ${index + 1} has no name`)
  }
  if (questionNames.has(name)) {
    throw new Error(`Generated FAQPage contains the duplicate question: ${name}`)
  }
  questionNames.add(name)
  if (!isRecord(acceptedAnswer) || acceptedAnswer['@type'] !== 'Answer') {
    throw new Error(`Generated FAQPage Question ${index + 1} has no accepted Answer`)
  }
  const answer = acceptedAnswer.text
  if (typeof answer !== 'string' || answer.trim() === '' || /<[^>]+>/.test(answer)) {
    throw new Error(`Generated FAQPage Answer ${index + 1} must contain plain text`)
  }
  if (
    !visibleHomePage.includes(`<h3>${name}</h3>`) ||
    !visibleHomePage.includes(`<p>${answer}</p>`)
  ) {
    throw new Error(`Generated FAQPage Question ${index + 1} is not visibly rendered on the page`)
  }
}

await mkdir(dirname(outputBundle), { recursive: true })
const demoBuild = await build({
  absWorkingDir: process.cwd(),
  banner: {
    js: '/* Generated by npm run docs:build. Edit docs-astro/src/scripts/demo.ts, not this file. */',
  },
  bundle: true,
  charset: 'utf8',
  entryPoints: ['docs-astro/src/scripts/demo.ts'],
  format: 'esm',
  legalComments: 'none',
  logLevel: 'silent',
  metafile: true,
  minify: true,
  outfile: outputBundle,
  platform: 'browser',
  sourcemap: false,
  target: ['es2022'],
})
const viewerBuild = await build({
  absWorkingDir: process.cwd(),
  alias: geoShowcaseSourceAliases,
  banner: {
    js: '/* Generated by npm run docs:build. Edit docs-astro/src/scripts/wsi-*.ts, not this file. */',
  },
  bundle: true,
  charset: 'utf8',
  entryPoints: {
    'wsi-viewer': 'docs-astro/src/scripts/wsi-viewer.ts',
    'wsi-worker': 'docs-astro/src/scripts/wsi-worker.ts',
    'ome-zarr-viewer': 'docs-astro/src/scripts/ome-zarr-viewer.ts',
    'ome-zarr-worker': 'docs-astro/src/scripts/ome-zarr-worker.ts',
    'geo-showcase': 'docs-astro/src/scripts/geo-showcase.ts',
    'geo-showcase-worker': 'docs-astro/src/scripts/geo-showcase-worker.ts',
    xray: 'docs-astro/src/scripts/xray.ts',
    'xray-worker': 'docs-astro/src/scripts/xray-worker.ts',
    'hdr-surgery': 'docs-astro/src/scripts/hdr-surgery.ts',
    'hdr-surgery-worker': 'docs-astro/src/scripts/hdr-surgery-worker.ts',
  },
  entryNames: '[name]',
  format: 'esm',
  legalComments: 'none',
  logLevel: 'silent',
  metafile: true,
  minify: true,
  outdir: join(outputDirectory, 'assets'),
  platform: 'browser',
  sourcemap: false,
  target: ['es2022'],
})
assertGeoShowcaseSourceInputs(Object.keys(viewerBuild.metafile.inputs))
if (
  Object.keys(demoBuild.metafile.inputs).some(
    (input) =>
      input.endsWith('/codecs/heif.ts') || input.endsWith('/codec-entries/experimental/heic.ts'),
  )
) {
  throw new Error('Default docs demo bundle contains experimental HEIF/HEIC')
}
await copyFile(resolve('src/accelerator-entries/jpeg-decoder.wasm'), outputWasm)
await copyFile(resolve('src/accelerator-entries/jpeg-decoder-simd.wasm'), outputSimdDecoderWasm)
await copyFile(resolve('src/accelerator-entries/jpeg-encoder.wasm'), outputEncoderWasm)
await copyFile(resolve('src/accelerator-entries/jpeg-encoder-simd.wasm'), outputSimdEncoderWasm)
await copyFile(resolve('src/accelerator-entries/png-codec.wasm'), outputPngWasm)
await copyFile(resolve('src/accelerator-entries/png-codec-simd.wasm'), outputSimdPngWasm)
await copyFile(resolve('src/accelerator-entries/webp-codec.wasm'), outputWebpWasm)
await copyFile(resolve('src/accelerator-entries/webp-codec-simd.wasm'), outputSimdWebpWasm)

const demoHtml = await readFile(join(outputDirectory, 'demo/index.html'), 'utf8')
if (!demoHtml.includes('assets/demo-app.js')) {
  throw new Error('Generated docs demo does not reference assets/demo-app.js')
}
const bundle = await stat(outputBundle)
if (bundle.size === 0) throw new Error('Generated docs demo bundle is empty')
const wsiBundle = await stat(outputWsiBundle)
const wsiWorker = await stat(outputWsiWorker)
if (wsiBundle.size === 0 || wsiWorker.size === 0) {
  throw new Error('Generated whole-slide viewer bundle is empty')
}
const omeZarrBundle = await stat(outputOmeZarrBundle)
const omeZarrWorker = await stat(outputOmeZarrWorker)
if (omeZarrBundle.size === 0 || omeZarrWorker.size === 0) {
  throw new Error('Generated OME-Zarr viewer bundle is empty')
}
const geoBundle = await stat(outputGeoBundle)
const geoWorker = await stat(outputGeoWorker)
if (geoBundle.size === 0 || geoWorker.size === 0) {
  throw new Error('Generated geo showcase bundle is empty')
}
const wasm = await stat(outputWasm)
const simdDecoderWasm = await stat(outputSimdDecoderWasm)
const encoderWasm = await stat(outputEncoderWasm)
const simdEncoderWasm = await stat(outputSimdEncoderWasm)
const pngWasm = await stat(outputPngWasm)
const simdPngWasm = await stat(outputSimdPngWasm)
const webpWasm = await stat(outputWebpWasm)
const simdWebpWasm = await stat(outputSimdWebpWasm)
if (
  wasm.size === 0 ||
  simdDecoderWasm.size === 0 ||
  encoderWasm.size === 0 ||
  simdEncoderWasm.size === 0 ||
  pngWasm.size === 0 ||
  simdPngWasm.size === 0 ||
  webpWasm.size === 0 ||
  simdWebpWasm.size === 0
) {
  throw new Error('Generated docs WASM module is empty')
}

console.log(
  `Built GitHub Pages artifact at benchmark/.tmp/docs-site (${bundle.size.toLocaleString()} byte demo bundle, ${(wsiBundle.size + wsiWorker.size).toLocaleString()} byte WSI viewer, ${(omeZarrBundle.size + omeZarrWorker.size).toLocaleString()} byte OME-Zarr viewer, ${(geoBundle.size + geoWorker.size).toLocaleString()} byte geo showcase, ${featureTourBytes.toLocaleString()} byte synthetic OME-Zarr Feature Tour, ${(wasm.size + simdDecoderWasm.size + encoderWasm.size + simdEncoderWasm.size + pngWasm.size + simdPngWasm.size + webpWasm.size + simdWebpWasm.size).toLocaleString()} bytes of JPEG, PNG, and WebP WASM modules)`,
)
