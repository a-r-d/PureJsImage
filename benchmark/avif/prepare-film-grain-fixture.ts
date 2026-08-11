import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import sharp from 'sharp'

import { avifFilmGrainFixture, avifFilmGrainFixturePath } from './film-grain-fixture.ts'

const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')
const width = avifFilmGrainFixture.width
const height = avifFilmGrainFixture.height
const rgb = new Uint8Array(width * height * 3)
for (let y = 0; y < height; y += 1) {
  for (let x = 0; x < width; x += 1) {
    const offset = (y * width + x) * 3
    rgb[offset] = (x * 4) & 0xff
    rgb[offset + 1] = (y * 5) & 0xff
    rgb[offset + 2] = ((x + y) * 3) & 0xff
  }
}

const directory = await mkdtemp(join(tmpdir(), 'purejsimage-avif-film-grain-'))
try {
  const sourcePath = join(directory, 'source.png')
  const source = await sharp(rgb, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer()
  if (sha256(source) !== avifFilmGrainFixture.sourcePngSha256) {
    throw new Error('AVIF film-grain source PNG checksum changed')
  }
  await writeFile(sourcePath, source)
  const encoded = spawnSync(
    'avifenc',
    [
      '-j',
      '1',
      '-q',
      '60',
      '-s',
      '6',
      '--yuv',
      '420',
      '--cicp',
      '1/13/6',
      '-a',
      'film-grain-test=1',
      sourcePath,
      avifFilmGrainFixturePath,
    ],
    { encoding: 'utf8' },
  )
  if (encoded.error) throw encoded.error
  if (encoded.status !== 0) throw new Error(`avifenc film grain failed: ${encoded.stderr}`)
  const fixture = await readFile(avifFilmGrainFixturePath)
  if (sha256(fixture) !== avifFilmGrainFixture.fileSha256) {
    throw new Error('AVIF film-grain encoded checksum changed')
  }
  console.log(
    JSON.stringify({ file: avifFilmGrainFixture.file, bytes: fixture.byteLength }, null, 2),
  )
} finally {
  await rm(directory, { recursive: true, force: true })
}
