import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'

import { avifQ0FixtureDirectory, avifQ0LosslessFixture, avifQ0LossyFixture } from './q0-fixtures.ts'

const { width, height } = avifQ0LosslessFixture
const source = new Uint8Array(width * height * 3)
for (let y = 0; y < height; y += 1) {
  for (let x = 0; x < width; x += 1) {
    const offset = (y * width + x) * 3
    source[offset] = (x * 17 + y * 7) & 0xff
    source[offset + 1] = (x * 9 + y * 5 + 37) & 0xff
    source[offset + 2] = (x * 3 + y * 11 + 91) & 0xff
  }
}

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'purejsimage-avif-q0-'))
try {
  const sourcePath = join(temporaryDirectory, 'source.png')
  await sharp(source, { raw: { width, height, channels: 3 } })
    .png()
    .toFile(sourcePath)
  const sourceSha256 = createHash('sha256')
    .update(await readFile(sourcePath))
    .digest('hex')
  if (sourceSha256 !== '9ef654bd58869e117e14127c69ad4a676d3fc3ed3d1e93ec7d1988d6839b2f35') {
    throw new Error(`Quantizer-context-0 fixture source checksum changed: ${sourceSha256}`)
  }

  for (const { fixture, qualityArguments } of [
    { fixture: avifQ0LossyFixture, qualityArguments: ['-q', '95'] },
    { fixture: avifQ0LosslessFixture, qualityArguments: ['-l'] },
  ] as const) {
    const outputPath = join(avifQ0FixtureDirectory, fixture.file)
    const result = spawnSync(
      'avifenc',
      ['-j', '1', ...qualityArguments, '-y', '444', sourcePath, outputPath],
      { stdio: 'inherit' },
    )
    if (result.error) throw result.error
    if (result.status !== 0) {
      throw new Error(`avifenc exited with status ${result.status ?? 'unknown'}`)
    }

    const encodedSha256 = createHash('sha256')
      .update(await readFile(outputPath))
      .digest('hex')
    if (encodedSha256 !== fixture.fileSha256) {
      throw new Error(`${fixture.file} checksum changed: ${encodedSha256}`)
    }
    console.log(`generated ${fixture.file}`)
  }
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true })
}
