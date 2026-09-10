import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'

const directory = process.argv[2] ?? '.tmp/jpegxl-m7'
const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')
const inputs: Record<string, string> = {}
async function readTsv(name: string): Promise<Record<string, string>[]> {
  const text = await readFile(`${directory}/${name}`, 'utf8')
  inputs[name] = sha256(text)
  const lines = text.replace(/\r?\n$/u, '').split(/\r?\n/u)
  const header = lines.shift()?.split('\t')
  if (!header) throw new Error('Missing TSV header')
  return lines.map((line) => {
    const values = line.split('\t')
    if (values.length !== header.length) throw new Error(`Malformed ${name}`)
    return Object.fromEntries(header.map((name, index) => [name, values[index] ?? '']))
  })
}
const catalog = new Map((await readTsv('canonical-catalog.tsv')).map((row) => [row.path, row]))
const families = new Map((await readTsv('families.tsv')).map((row) => [row.id, row]))
const rows = [
  ...(await readTsv('train.tsv')),
  ...(await readTsv('validate.tsv')),
  ...(await readTsv('test.tsv')),
]
const licenses = new Set([
  'PD',
  'PD-own',
  'PD-USGov',
  'CC0',
  'Unsplash-License',
  'PD-tool',
  'Mailing-list-PD',
])
const seen = new Set<string>()
const eligible = rows.filter((row) => {
  const source = catalog.get(row.path),
    family = families.get(row.id)
  if (!source || !family || !row.id || !row.sha256 || !row.content_class)
    throw new Error('Incomplete provenance')
  const identity = family.family || row.id
  const pixels = Number(row.width) * Number(row.height)
  if (
    Number(row.id) >= 9000 ||
    /^(7000|8000|2200)/u.test(row.content_class) ||
    !licenses.has(source.license ?? '') ||
    !['png', 'jpg', 'jpeg'].includes(row.format ?? '') ||
    pixels < 65_536 ||
    pixels > 30_000_000 ||
    Number(row.bytes_actual) > 40_000_000 ||
    !/^[0-9a-f]{64}$/u.test(row.sha256) ||
    seen.has(identity)
  )
    return false
  seen.add(identity)
  return true
})
const cases: object[] = []
for (const split of ['development', 'holdout']) {
  const selected = eligible.filter(
    (row) => (families.get(row.id)?.split === 'train' ? 'development' : 'holdout') === split,
  )
  const classes = [...new Set(selected.map((row) => row.content_class))].sort()
  const buckets = classes.map((category) =>
    selected
      .filter((row) => row.content_class === category)
      .sort((a, b) => sha256(`M7:${a.id}`).localeCompare(sha256(`M7:${b.id}`))),
  )
  let count = 0
  for (let index = 0; count < 120; index++) {
    let available = false
    for (const bucket of buckets) {
      const row = bucket[index]
      if (!row || count === 120) continue
      available = true
      const source = catalog.get(row.path),
        family = families.get(row.id)
      if (!source || !family) throw new Error('Missing source')
      cases.push({
        id: `im26-${row.id}`,
        split,
        sourceFamily: family.family || row.id,
        category: row.content_class,
        description: source.descriptor,
        license: source.license,
        author: source.source,
        originalFilename: source.original_filename,
        sourcePath: row.path,
        sourceUrl: row.raw_url,
        sourceSha256: row.sha256,
        width: Number(row.width),
        height: Number(row.height),
        bytes: Number(row.bytes_actual),
        format: row.format,
        nativeDimensions: true,
        hdrCompanionUrl: row.png_v3_hdr_url || null,
      })
      count++
    }
    if (!available) throw new Error(`Insufficient ${split} source families`)
  }
}
await writeFile(
  'benchmark/jpegxl/production-program/m7-corpus-selection.json',
  JSON.stringify(
    {
      schemaVersion: 1,
      frozenAt: new Date().toISOString(),
      repository: 'https://github.com/imazen/imazen-26',
      revision: '187fbf338ce08e8e6654db7f04ddae58d5263da2',
      metadataSha256: inputs,
      policy:
        '240 distinct source families, 120 development and 120 holdout, balanced round-robin across eligible content classes before codec tuning. Family-aware upstream train split is development; validate/test are holdout. One representative per source family. Raw original dimensions, no resize. Publicly identified licenses only; mobile screenshots with unverified licenses, AI-generated images, procedural plots and renders excluded. Hash-sort selection independent of codec results. Every failure and any later expansion must remain visible.',
      cases,
    },
    null,
    2,
  ) + '\n',
)
