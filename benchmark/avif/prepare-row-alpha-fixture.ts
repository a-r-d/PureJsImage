import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'

import { avifBoundedAlphaRowFixture, avifBoundedAlphaRowFixturePath } from './row-alpha-fixture.ts'

const { width, height } = avifBoundedAlphaRowFixture
const rgba = new Uint8Array(width * height * 4)
for (let y = 0; y < height; y += 1) {
  for (let x = 0; x < width; x += 1) {
    const offset = (y * width + x) * 4
    rgba[offset] = (x * 13 + y * 3) & 0xff
    rgba[offset + 1] = (x * 5 + y * 11) & 0xff
    rgba[offset + 2] = (x * 7 + y * 19) & 0xff
    rgba[offset + 3] = x < 4 && y < 4 ? 0 : 32 + ((x * 9 + y * 7) % 224)
  }
}

const sha256 = (value: Uint8Array): string => createHash('sha256').update(value).digest('hex')
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'purejsimage-avif-row-alpha-'))
try {
  const sourcePath = join(temporaryDirectory, 'source.png')
  await sharp(rgba, { raw: { width, height, channels: 4 } })
    .png()
    .toFile(sourcePath)
  const sourceSha256 = sha256(await readFile(sourcePath))
  if (sourceSha256 !== avifBoundedAlphaRowFixture.sourcePngSha256) {
    throw new Error(`Bounded alpha source checksum changed: ${sourceSha256}`)
  }
  const encoded = spawnSync(
    'avifenc',
    [
      '-j',
      '1',
      '--tilecolslog2',
      '0',
      '--tilerowslog2',
      '0',
      '--lossless',
      '--yuv',
      '444',
      '--cicp',
      '1/13/0',
      '-s',
      '6',
      '-a',
      'enable-cdef=0',
      '-a',
      'enable-restoration=0',
      sourcePath,
      avifBoundedAlphaRowFixturePath,
    ],
    { encoding: 'utf8', maxBuffer: 4 * 1_024 * 1_024 },
  )
  if (encoded.error) throw encoded.error
  if (encoded.status !== 0) throw new Error(`avifenc failed: ${encoded.stderr.trim()}`)
  const encodedSha256 = sha256(await readFile(avifBoundedAlphaRowFixturePath))
  if (encodedSha256 !== avifBoundedAlphaRowFixture.fileSha256) {
    throw new Error(`Bounded alpha AVIF checksum changed: ${encodedSha256}`)
  }
  const { data, info } = await sharp(avifBoundedAlphaRowFixturePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const decodedSha256 = sha256(data)
  if (
    info.width !== width ||
    info.height !== height ||
    info.channels !== 4 ||
    decodedSha256 !== avifBoundedAlphaRowFixture.decodedRgbaSha256
  ) {
    throw new Error(`Bounded alpha Sharp oracle changed: ${decodedSha256}`)
  }
  console.log(`generated ${avifBoundedAlphaRowFixture.file}`)
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true })
}
