/** Freeze a small family-disjoint validation supplement after the encoder is frozen. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import original from './production-program/m7-corpus-selection.json' with { type: 'json' }

const hash = (value: string | Uint8Array): string =>
  createHash('sha256').update(value).digest('hex')
const readTsv = async (name: keyof typeof original.metadataSha256) => {
  const bytes = await readFile(`.tmp/jpegxl-m7/${name}`)
  if (hash(bytes) !== original.metadataSha256[name]) throw new Error(`Changed catalog: ${name}`)
  const lines = bytes
    .toString('utf8')
    .replace(/\r?\n$/u, '')
    .split(/\r?\n/u)
  const keys = lines.shift()?.split('\t')
  if (!keys) throw new Error('Missing TSV header')
  return lines.map((line) => {
    const values = line.split('\t')
    if (values.length !== keys.length) throw new Error('Malformed TSV')
    return Object.fromEntries(keys.map((key, index) => [key, values[index] ?? '']))
  })
}
const catalog = new Map((await readTsv('canonical-catalog.tsv')).map((row) => [row.path, row]))
const families = new Map((await readTsv('families.tsv')).map((row) => [row.id, row]))
const rows = [...(await readTsv('validate.tsv')), ...(await readTsv('test.tsv'))]
const excludedFamilies = new Set(original.cases.map((entry) => entry.sourceFamily))
const paths = execFileSync('rg', ['--files', '--hidden', '.tmp/jpegxl-m7'], {
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
})
const previouslyMaterialized = new Set([...paths.matchAll(/im26-(\d+)/gu)].map((match) => match[1]))
for (const id of previouslyMaterialized) {
  if (!id) continue
  const family = families.get(id)
  if (family) excludedFamilies.add(family.family || id)
}
const licenses = new Set([
  'PD',
  'PD-own',
  'PD-USGov',
  'CC0',
  'Unsplash-License',
  'PD-tool',
  'Mailing-list-PD',
])
const categories = [
  '1000-lilith-photos-general',
  '1200-lilith-interiors',
  '1400-lilith-nature',
  '2000-unsplash-people',
  '1600-lilith-food',
  '5000-national-park-service-brochures',
  '5300-noaa-hurricane-documents',
  '8100-lilith-web-screenshots',
]
const cases = categories.map((category) => {
  const eligible = rows
    .filter((row) => {
      const source = catalog.get(row.path),
        family = families.get(row.id)
      const pixels = Number(row.width) * Number(row.height)
      return (
        source &&
        family &&
        row.content_class === category &&
        !excludedFamilies.has(family.family || row.id || '') &&
        licenses.has(source.license ?? '') &&
        ['png', 'jpg', 'jpeg'].includes(row.format ?? '') &&
        pixels >= 65536 &&
        pixels <= 30000000 &&
        Number(row.bytes_actual) <= 40000000
      )
    })
    .sort((left, right) =>
      hash(`M7-visual-validation-v1:${left.id}`).localeCompare(
        hash(`M7-visual-validation-v1:${right.id}`),
      ),
    )
  const row = eligible[0]
  if (!row) throw new Error(`No unobserved eligible family in ${category}`)
  const source = catalog.get(row.path),
    family = families.get(row.id)
  if (!source || !family || !row.sha256 || !/^[0-9a-f]{64}$/u.test(row.sha256))
    throw new Error('Incomplete provenance')
  excludedFamilies.add(family.family || row.id || '')
  return {
    id: `im26-${row.id}`,
    sourceFamily: family.family || row.id,
    category,
    license: source.license,
    description: source.descriptor,
    sourceUrl: row.raw_url,
    sourceSha256: row.sha256,
    width: Number(row.width),
    height: Number(row.height),
    bytes: Number(row.bytes_actual),
    format: row.format,
  }
})
const codecPaths = ['src/codecs/jpegxl-vardct-encode.ts', 'src/codecs/jpegxl-modular-encode.ts']
await writeFile(
  'benchmark/jpegxl/production-program/m7-visual-validation-selection.json',
  `${JSON.stringify(
    {
      schemaVersion: 1,
      frozenAt: new Date().toISOString(),
      parentRevision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      codecSources: await Promise.all(
        codecPaths.map(async (path) => ({ path, sha256: hash(await readFile(path)) })),
      ),
      policy:
        'Eight new upstream validate/test families (all eligible texture families already have local artifacts, so no unseen texture-class claim), one per declared class, selected by fixed salted hash after implementation freeze. Exclude original 240 families and every im26 family named in existing local artifact paths. No source pixels or encoded results inspected before selection. Evaluate all selections without tuning or exclusions. This small SDR supplement supports only limited generalization; original HDR/alpha and fixed matrices remain separate.',
      catalogSha256: original.metadataSha256,
      cases,
    },
    null,
    2,
  )}\n`,
  { flag: 'wx' },
)
console.log(cases.map((entry) => `${entry.id} ${entry.category}`).join('\n'))
