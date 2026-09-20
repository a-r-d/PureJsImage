import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const catalogBytes = await readFile('.tmp/jpegxl-m7/polyhaven-hdris.json', 'utf8')
const catalog: unknown = JSON.parse(catalogBytes)
if (!object(catalog)) throw new Error('Invalid HDR source catalog')
const entries = Object.entries(catalog)
  .flatMap(([id, entry]) => {
    if (
      !object(entry) ||
      !Array.isArray(entry.categories) ||
      !entry.categories.every((category) => typeof category === 'string') ||
      typeof entry.evs_cap !== 'number' ||
      !object(entry.authors) ||
      !Array.isArray(entry.max_resolution) ||
      !entry.max_resolution.every((value) => typeof value === 'number')
    )
      return []
    if (entry.categories.includes('studio') || entry.evs_cap < 8) return []
    const category = entry.categories.includes('night')
      ? 'night'
      : entry.categories.includes('indoor')
        ? 'indoor'
        : entry.categories.includes('outdoor')
          ? 'outdoor'
          : undefined
    if (!category) return []
    const family = id.split('_')[0]
    if (!family) throw new Error('Missing HDR source family')
    return [
      {
        id,
        family,
        category,
        authors: Object.keys(entry.authors),
        maximumResolution: entry.max_resolution,
        capturedStops: entry.evs_cap,
      },
    ]
  })
  .sort((a, b) => hash(a.id).localeCompare(hash(b.id)))
const families = new Set<string>()
const hdr: object[] = []
for (const split of ['development', 'holdout']) {
  for (const category of ['night', 'indoor', 'outdoor']) {
    const available = entries.filter(
      (entry) =>
        entry.category === category &&
        (Number.parseInt(hash(entry.family).slice(0, 2), 16) % 2 === 0
          ? 'development'
          : 'holdout') === split,
    )
    let count = 0
    for (const entry of available) {
      if (families.has(entry.family)) continue
      families.add(entry.family)
      hdr.push({
        id: `polyhaven-${entry.id}`,
        asset: entry.id,
        sourceFamily: `polyhaven-${entry.family}`,
        split,
        category: `hdr-${category}`,
        authors: entry.authors,
        sourcePage: `https://polyhaven.com/a/${entry.id}`,
        metadataUrl: `https://api.polyhaven.com/files/${entry.id}`,
        license: 'CC0-1.0',
        licenseUrl: 'https://polyhaven.com/license',
        providerMaximumResolution: entry.maximumResolution,
        capturedStops: entry.capturedStops,
        selectedResolution: '2k',
        selectedFormat: 'hdr',
        preprocessing:
          'Provider 2k HDR panorama, without upscaling. Preserve the downloaded relative linear radiance as a reference. Create separately labeled 16-bit PQ and display-mapped variants with explicit scaling and clipping; all variants remain in this source family and split.',
      })
      if (++count === 2) break
    }
    if (count !== 2) throw new Error(`Missing ${split}/${category} HDR sources`)
  }
}
const notoRevision = '8998f5dd683424a73e2314a8c1f1e359c19e8742'
const artwork = [
  ['1f600', 'smiling face'],
  ['1f98a', 'fox'],
  ['1f338', 'cherry blossom'],
  ['1f680', 'rocket'],
  ['1f355', 'pizza'],
  ['1f3a8', 'artist palette'],
  ['1f3b8', 'guitar'],
  ['1f984', 'unicorn'],
  ['1f332', 'evergreen'],
  ['1f4f7', 'camera'],
  ['1f916', 'robot'],
  ['1f308', 'rainbow'],
].map(([codepoint, name], index) => {
  if (!codepoint || !name) throw new Error('Incomplete artwork selection')
  return {
    id: `noto-${codepoint}`,
    sourceFamily: `noto-${codepoint}`,
    split: index % 2 === 0 ? 'development' : 'holdout',
    category: 'transparent-artwork',
    name,
    sourceUrl: `https://raw.githubusercontent.com/googlefonts/noto-emoji/${notoRevision}/png/512/emoji_u${codepoint}.png`,
    revision: notoRevision,
    author: 'Google Noto Emoji contributors',
    license: 'Apache-2.0',
    licenseUrl: `https://github.com/googlefonts/noto-emoji/blob/${notoRevision}/LICENSE`,
    licenseMapping: `https://github.com/googlefonts/noto-emoji/blob/${notoRevision}/README.md#license`,
    width: 512,
    height: 512,
    preprocessing:
      'Original published 512-pixel PNG. No resize, alpha compositing or invisible-RGB canonicalization.',
  }
})
await writeFile(
  'benchmark/jpegxl/production-program/m7-corpus-expansion.json',
  JSON.stringify(
    {
      schemaVersion: 1,
      frozenAt: new Date().toISOString(),
      reason:
        'The original 240-source audit found only 8-bit SDR and fully opaque alpha. Add 12 captured HDR sources and 12 transparent artworks before forward lossy tuning. Preserve all original sources and outcomes.',
      selection:
        'HDR sources are hash-sorted, balanced over night/indoor/outdoor, and split by a conservative first-word source family. Two sources per class and split. Artwork identities are listed explicitly with alternating source-level splits. No codec outcome influenced this expansion. Download failures remain failures, never replacements.',
      hdrCatalogSha256: hash(catalogBytes),
      hdr,
      artwork,
    },
    null,
    2,
  ) + '\n',
)
