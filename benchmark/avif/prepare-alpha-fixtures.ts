import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'

import { avifAlphaFixtureDirectory, avifAlphaFixtures } from './alpha-fixtures.ts'

const width = 64
const height = 48
const source = new Uint8Array(width * height * 4)
for (let y = 0; y < height; y += 1) {
  for (let x = 0; x < width; x += 1) {
    const offset = (y * width + x) * 4
    const alpha = x < 8 && y < 8 ? 0 : 64 + ((x * 7 + y * 11) % 192)
    source[offset] = alpha === 0 ? 0 : (31 + x * 3 + y * 2) & 0xff
    source[offset + 1] = alpha === 0 ? 0 : (197 + x + y * 4) & 0xff
    source[offset + 2] = alpha === 0 ? 0 : (83 + x * 5 + y) & 0xff
    source[offset + 3] = alpha
  }
}

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'purejsimage-avif-alpha-'))
try {
  const sourcePath = join(temporaryDirectory, 'source.png')
  await sharp(source, { raw: { width, height, channels: 4 } })
    .png()
    .toFile(sourcePath)
  const sourceSha256 = createHash('sha256')
    .update(await readFile(sourcePath))
    .digest('hex')
  if (sourceSha256 !== '34ac93498cce3badcf7649944a112952a7633adc043b8df331d78774b9b6f40e') {
    throw new Error(`Alpha fixture source checksum changed: ${sourceSha256}`)
  }

  for (const fixture of avifAlphaFixtures) {
    const outputPath = join(avifAlphaFixtureDirectory, fixture.file)
    const result = spawnSync(
      'avifenc',
      [
        '-j',
        '1',
        '-q',
        '70',
        '--qalpha',
        '90',
        '-y',
        '444',
        ...(fixture.premultiplied ? ['--premultiply'] : []),
        sourcePath,
        outputPath,
      ],
      { stdio: 'inherit' },
    )
    if (result.error) throw result.error
    if (result.status !== 0)
      throw new Error(`avifenc exited with status ${result.status ?? 'unknown'}`)

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
