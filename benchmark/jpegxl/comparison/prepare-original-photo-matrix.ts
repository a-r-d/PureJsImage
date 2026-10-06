import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import sharp from 'sharp'
import { hash, implementationIdentity } from './io.ts'
import { number, object, string } from './model.ts'

const plan = object(
  JSON.parse(await readFile('benchmark/jpegxl/comparison/original-photo-matrix-plan.json', 'utf8')),
)
if (!Array.isArray(plan.fixtures)) throw new Error('Predeclared original fixtures missing')
const manifestPath = 'benchmark/corpus/manifest.json',
  manifestBytes = await readFile(manifestPath)
const manifest = object(JSON.parse(manifestBytes.toString('utf8')))
if (!Array.isArray(manifest.sources)) throw new Error('Pinned original corpus missing')
const fixturePath = string(plan.fixtureManifest),
  directory = dirname(fixturePath)
let existing: Record<string, unknown> | undefined
try {
  existing = object(JSON.parse(await readFile(fixturePath, 'utf8')))
} catch (error) {
  if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
}
if (existing && (existing.completed !== true || !Array.isArray(existing.fixtures)))
  throw new Error('Existing preparation is incomplete; preserve its files')
await mkdir(directory, { recursive: true })
sharp.concurrency(1)
const createOrVerify = async (path: string, data: Uint8Array) => {
  try {
    await writeFile(path, data, { flag: 'wx' })
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
    if (hash(await readFile(path)) !== hash(data))
      throw new Error('Existing input differs; preserve it')
  }
}
const prepared: {
  id: string
  category: 'photo'
  scope: 'original'
  width: number
  height: number
  channels: 4
  sampleType: 'uint8'
  source: string
  sourceSha256: string
  raw: string
  rawSha256: string
  png: string
  pngSha256: string
  provenance: { sourcePage: string; author: string; license: string }
  preparation: string
}[] = []
for (const value of plan.fixtures) {
  const planned = object(value),
    id = string(planned.id)
  const source = manifest.sources.map(object).find((row) => row.id === id)
  if (!source) throw new Error('Predeclared original corpus input missing')
  const expected = object(source.expected),
    sourcePath = `benchmark/corpus/files/${string(source.file)}`
  const bytes = await readFile(sourcePath)
  if (hash(bytes) !== expected.sha256) throw new Error('Pinned original JPEG differs')
  const decoded = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const width = number(planned.width),
    height = number(planned.height)
  if (
    width !== expected.width ||
    height !== expected.height ||
    decoded.info.width !== width ||
    decoded.info.height !== height ||
    decoded.info.channels !== 4 ||
    decoded.data.length !== width * height * 4 ||
    hash(decoded.data) !== planned.rawSha256
  )
    throw new Error('Exact original geometry or RGBA samples differ')
  for (let at = 3; at < decoded.data.length; at += 4)
    if (decoded.data[at] !== 255) throw new Error('Opaque original alpha differs')
  const rawPath = `${directory}/${id}.raw`,
    pngPath = `${directory}/${id}.png`
  if (existing) {
    if (!Array.isArray(existing.fixtures)) throw new Error('Prepared fixtures missing')
    const row = existing.fixtures.map(object).find((row) => row.id === id)
    if (
      !row ||
      row.width !== width ||
      row.height !== height ||
      row.raw !== rawPath ||
      row.png !== pngPath ||
      row.source !== sourcePath ||
      row.sourceSha256 !== expected.sha256 ||
      row.rawSha256 !== planned.rawSha256 ||
      hash(await readFile(rawPath)) !== planned.rawSha256 ||
      hash(await readFile(pngPath)) !== row.pngSha256
    )
      throw new Error('Existing preparation pin differs; preserve its files')
  } else {
    await createOrVerify(rawPath, decoded.data)
    const png = await sharp(decoded.data, { raw: { width, height, channels: 4 } })
      .png()
      .toBuffer()
    await createOrVerify(pngPath, png)
  }
  if (hash(await sharp(pngPath).ensureAlpha().raw().toBuffer()) !== planned.rawSha256)
    throw new Error('Complete scoring PNG changed source samples')
  prepared.push({
    id,
    category: 'photo',
    scope: 'original',
    width,
    height,
    channels: 4,
    sampleType: 'uint8',
    source: sourcePath,
    sourceSha256: hash(bytes),
    raw: rawPath,
    rawSha256: hash(decoded.data),
    png: pngPath,
    pngSha256: hash(await readFile(pngPath)),
    provenance: {
      sourcePage: string(source.sourcePage),
      author: string(source.author),
      license: string(source.license),
    },
    preparation:
      'Decode the SHA-pinned original JPEG through the development input preparer without resize, crop or orientation changes. Preserve exact opaque RGBA8 samples and a lossless scoring PNG.',
  })
}
if (!existing)
  await writeFile(
    fixturePath,
    `${JSON.stringify(
      {
        ...(await implementationIdentity()),
        completed: true,
        fixtures: prepared,
        inputPreparer: sharp.versions,
        sourceManifest: { path: manifestPath, sha256: hash(manifestBytes) },
        policy:
          'Predeclared unresized original inputs only. Preparation makes no compression or parity claim.',
      },
      null,
      2,
    )}\n`,
    { flag: 'wx' },
  )
console.log(
  JSON.stringify({
    completed: true,
    reusedExistingPreparation: existing !== undefined,
    fixtures: prepared.map(({ id, width, height, rawSha256 }) => ({
      id,
      width,
      height,
      rawSha256,
    })),
  }),
)
