import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import sharp from 'sharp'
import { hash, json, oracle, pnm, root, run, work } from './io.ts'
import { type Fixture, type Pixels, rgba8 } from './model.ts'

await mkdir(`${work}/fixtures`, { recursive: true })
const entries: Fixture[] = []
async function add(
  id: string,
  category: string,
  scope: Fixture['scope'],
  source: string,
  provenance: string,
  preparation: string,
  pixels?: Pixels,
  encoded?: string,
) {
  const sourceBytes = await readFile(source),
    p = pixels ?? rgba8(pnm(sourceBytes)),
    prefix = `${work}/fixtures/${id}`
  await writeFile(
    `${prefix}.raw`,
    new Uint8Array(p.data.buffer, p.data.byteOffset, p.data.byteLength),
  )
  if (encoded) await copyFile(encoded, `${prefix}-lossless.jxl`)
  else {
    await sharp(p.data, { raw: { width: p.width, height: p.height, channels: 4 } })
      .png()
      .toFile(`${prefix}.png`)
    run(`${oracle}/cjxl`, [
      `${prefix}.png`,
      `${prefix}-lossless.jxl`,
      '-d',
      '0',
      '-e',
      '7',
      '--num_threads=1',
      '--keep_invisible=1',
    ])
    run(`${oracle}/cjxl`, [
      `${prefix}.png`,
      `${prefix}-lossy.jxl`,
      '-d',
      '1',
      '-e',
      '7',
      '--num_threads=1',
    ])
  }
  entries.push({
    id,
    category,
    scope,
    source,
    sourceSha256: hash(sourceBytes),
    provenance,
    preparation,
    width: p.width,
    height: p.height,
    channels: p.channels,
    sampleType:
      p.data instanceof Uint16Array
        ? 'uint16'
        : p.data instanceof Float32Array
          ? 'float32'
          : 'uint8',
    raw: `${prefix}.raw`,
    rawSha256: hash(new Uint8Array(p.data.buffer, p.data.byteOffset, p.data.byteLength)),
    lossless: `${prefix}-lossless.jxl`,
    losslessSha256: hash(await readFile(`${prefix}-lossless.jxl`)),
    lossy: encoded ? null : `${prefix}-lossy.jxl`,
    lossySha256: encoded ? null : hash(await readFile(`${prefix}-lossy.jxl`)),
  })
}
for (const [id, category] of [
  ['1030', 'photo'],
  ['1416', 'gradient-photo'],
  ['2018', 'monochrome-photo'],
  ['2400', 'texture'],
  ['5032', 'map'],
  ['5034', 'text'],
  ['5052', 'text'],
  ['5334', 'screenshot'],
]) {
  if (!id || !category) throw new Error('Invalid selection')
  await add(
    `im26-${id}-diagnostic`,
    category,
    'capped',
    `.tmp/jpegxl-m7/diagnostic-fixtures-v1/im26-${id}.ppm`,
    'm7-corpus-selection.json; imazen-26 187fbf338ce08e8e6654db7f04ddae58d5263da2; licenses retained per source',
    'Reuse frozen m7 diagnostic: photo max edge 1024 or native 1024 crop; see diagnostic manifest; expand opaque RGB to RGBA8 without changing samples',
  )
}
for (const [id, category] of [
  ['1416', 'gradient-photo'],
  ['8160', 'screenshot'],
]) {
  if (!id || !category) throw new Error('Invalid selection')
  await add(
    `im26-${id}-original`,
    category,
    'original',
    `.tmp/jpegxl-m7/visual-final-20260928-fixtures/im26-${id}.ppm`,
    'm7-corpus-selection.json; imazen-26 187fbf338ce08e8e6654db7f04ddae58d5263da2; licenses retained per source',
    'Frozen full-resolution normalized sRGB8; no resizing; opaque alpha added',
  )
}
for (const id of ['alpha_triangles', 'sunset_logo']) {
  const source = `.tmp/jpegxl-conformance/testcases/${id}/ref.png`,
    { data, info } = await sharp(source)
      .toColourspace('srgb')
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
  await add(
    id,
    'transparency',
    'original',
    source,
    'libjxl/conformance 4bf053529c7cefd2951be453475bb3dccc7e7be8; CC0 per testcases/README.md',
    'Pinned reference PNG rendered sRGB8 straight alpha by sharp; no resizing',
    {
      width: info.width,
      height: info.height,
      channels: 4,
      data: new Uint8Array(data),
      interpretation: 'srgb',
    },
  )
}
for (const [id, kind] of [
  ['gray16-default', 'gray16'],
  ['rgb16-default', 'rgb16'],
]) {
  if (!id || !kind) throw new Error('Invalid selection')
  const base = `benchmark/fixtures/jpegxl/generated-lossless-v0.12.0/${id}`
  await add(
    id,
    kind,
    'specialized',
    `${base}.oracle.pnm`,
    'Repository synthetic lossless fixture, MIT; pinned libjxl v0.12.0',
    'Unmodified native uint16 samples; host little-endian raw',
    pnm(await readFile(`${base}.oracle.pnm`)),
    `${base}.jxl`,
  )
}
// Existing oracle PAM includes hidden color under zero alpha. Read with the public Netpbm codec.
const { netpbmCodec } = await import('purejsimage/codecs/netpbm')
const { MemorySource, defaultImageLimits } = await import('purejsimage/browser')
const pam = 'benchmark/fixtures/jpegxl/generated-lossless-v0.12.0/rgba16-straight.oracle.pam'
const decoder = await netpbmCodec.createDecoder?.(
  new MemorySource(await readFile(pam)),
  defaultImageLimits,
)
if (!decoder) throw new Error('Missing Netpbm decoder')
const samples = new Uint16Array(decoder.width * decoder.height * 4)
for await (const block of decoder.decode()) {
  const view = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength)
  for (let y = 0; y < block.height; y++)
    for (let x = 0; x < block.width * 4; x++)
      samples[(block.y + y) * decoder.width * 4 + x] = view.getUint16(y * block.stride + x * 2)
  block.release?.()
}
await add(
  'rgba16-straight',
  'rgba16',
  'specialized',
  pam,
  'Repository synthetic fixture, MIT',
  'Unmodified native uint16 samples, hidden RGB retained',
  {
    width: decoder.width,
    height: decoder.height,
    channels: 4,
    data: samples,
    interpretation: 'srgb16',
  },
  pam.replace('.oracle.pam', '.jxl'),
)
const graySource = '.tmp/jpegxl-conformance/testcases/grayscale/ref.png',
  gray = await sharp(graySource).greyscale().raw().toBuffer({ resolveWithObject: true })
await add(
  'gray8',
  'gray8',
  'original',
  graySource,
  'libjxl/conformance 4bf053529c7cefd2951be453475bb3dccc7e7be8; CC0',
  'Reference gray expanded to opaque sRGB RGBA8',
  rgba8({
    width: gray.info.width,
    height: gray.info.height,
    channels: 1,
    data: new Uint8Array(gray.data),
    interpretation: 'srgb',
  }),
)
await json(`${root}/fixtures.json`, {
  schemaVersion: 1,
  sourceRevision: run('git', ['rev-parse', 'HEAD']).trim(),
  preparer: sharp.versions,
  oracleVersion: run(`${oracle}/cjxl`, ['--version']).trim(),
  oracleSha256: hash(await readFile(`${oracle}/cjxl`)),
  fixtures: entries,
})
console.log(`Prepared ${entries.length} fixtures`)
