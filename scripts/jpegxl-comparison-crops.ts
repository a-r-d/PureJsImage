import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import sharp from 'sharp'
import { number, object, string } from '../benchmark/jpegxl/comparison/model.ts'

const root = 'benchmark/jpegxl/comparison',
  out = 'docs-astro/public/assets/jpegxl-comparison'
await mkdir(out, { recursive: true })
const q = object(JSON.parse(await readFile(`${root}/results/quality.json`, 'utf8')))
if (!Array.isArray(q.results)) throw new Error('Missing curves')
const crop = { left: 400, top: 200, width: 256, height: 192 },
  entries = []
const raw = await readFile('.tmp/jpegxl-comparison-v1/fixtures/im26-1030-diagnostic.raw')
const source = await sharp(raw, { raw: { width: 1024, height: 768, channels: 4 } })
  .extract(crop)
  .webp({ lossless: true })
  .toBuffer()
await writeFile(`${out}/source.webp`, source)
entries.push({
  subject: 'source',
  path: '/assets/jpegxl-comparison/source.webp',
  sourceSha256: createHash('sha256').update(raw).digest('hex'),
  sha256: createHash('sha256').update(source).digest('hex'),
})
for (const subject of ['purejsimage', 'vips']) {
  const curve = q.results
    .map(object)
    .find((r) => r.fixture === 'im26-1030-diagnostic' && r.subject === subject)
  if (!curve || !Array.isArray(curve.points)) throw new Error('Missing photo curve')
  const point = curve.points
    .map(object)
    .sort((a, b) => Math.abs(number(a.score) - 80) - Math.abs(number(b.score) - 80))[0]
  if (!point) throw new Error('Missing point')
  const input = await readFile(string(point.artifact).replace(/\.jxl$/, '.png'))
  if (createHash('sha256').update(input).digest('hex') !== point.decodedSha256)
    throw new Error('Changed decoded artifact')
  const bytes = await sharp(input).extract(crop).webp({ lossless: true }).toBuffer()
  await writeFile(`${out}/${subject}.webp`, bytes)
  entries.push({
    subject,
    path: `/assets/jpegxl-comparison/${subject}.webp`,
    sourceSha256: string(point.decodedSha256),
    sha256: createHash('sha256').update(bytes).digest('hex'),
    score: number(point.score),
    setting: number(point.setting),
  })
}
await writeFile(
  'docs-astro/src/data/jpegxl-comparison-crops.json',
  `${JSON.stringify(
    {
      fixture: 'im26-1030-diagnostic',
      crop,
      author: 'lilith',
      license: 'PD-own, public domain dedication in imazen-26',
      source: 'https://github.com/imazen/codec-corpus',
      entries,
    },
    null,
    2,
  )}\n`,
)
