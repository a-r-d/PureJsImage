import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'

import { avifBoundedRowFixture, avifBoundedRowFixturePath } from './row-fixture.ts'

const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')
const { width, height } = avifBoundedRowFixture
const source = new Uint8Array(width * height * 3)
for (let y = 0; y < height; y += 1) {
  for (let x = 0; x < width; x += 1) {
    const offset = (y * width + x) * 3
    source[offset] = (x * 17 + y * 7) & 0xff
    source[offset + 1] = (x * 9 + y * 5 + 37) & 0xff
    source[offset + 2] = (x * 3 + y * 11 + 91) & 0xff
  }
}

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'purejsimage-avif-rows-'))
try {
  const sourcePath = join(temporaryDirectory, 'source.png')
  await sharp(source, { raw: { width, height, channels: 3 } })
    .png()
    .toFile(sourcePath)
  const sourceSha256 = sha256(await readFile(sourcePath))
  if (sourceSha256 !== avifBoundedRowFixture.sourcePngSha256) {
    throw new Error(`Bounded-row fixture source checksum changed: ${sourceSha256}`)
  }

  const result = spawnSync(
    'avifenc',
    ['-j', '1', '--lossless', '-y', '444', sourcePath, avifBoundedRowFixturePath],
    { stdio: 'inherit' },
  )
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`avifenc exited with status ${result.status ?? 'unknown'}`)
  }

  const encodedSha256 = sha256(await readFile(avifBoundedRowFixturePath))
  if (encodedSha256 !== avifBoundedRowFixture.fileSha256) {
    throw new Error(`${avifBoundedRowFixture.file} checksum changed: ${encodedSha256}`)
  }
  console.log(`generated ${avifBoundedRowFixture.file}`)
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true })
}
