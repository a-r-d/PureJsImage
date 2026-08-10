import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  avifTiledLosslessFixture,
  avifTiledLosslessFixturePath,
  tiledLosslessSample,
} from './tiled-lossless-fixture.ts'

const fixture = avifTiledLosslessFixture
const header = Buffer.from(
  `YUV4MPEG2 W${fixture.width} H${fixture.height} F1:1 Ip A1:1 C444p${fixture.bitDepth} XYSCSS=444P${fixture.bitDepth} XCOLORRANGE=FULL\nFRAME\n`,
)
const pixels = Buffer.alloc(fixture.width * fixture.height * 3 * 2)
for (let plane = 0 as 0 | 1 | 2; plane < 3; plane += 1) {
  for (let y = 0; y < fixture.height; y += 1) {
    for (let x = 0; x < fixture.width; x += 1) {
      const index = plane * fixture.width * fixture.height + y * fixture.width + x
      pixels.writeUInt16LE(tiledLosslessSample(plane, x, y), index * 2)
    }
  }
}
const source = Buffer.concat([header, pixels])
const sourceSha256 = createHash('sha256').update(source).digest('hex')
if (sourceSha256 !== fixture.sourceY4mSha256) {
  throw new Error(`Tiled AVIF source checksum changed: ${sourceSha256}`)
}

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'purejsimage-avif-tiles-'))
try {
  const sourcePath = join(temporaryDirectory, 'source.y4m')
  await writeFile(sourcePath, source)
  const result = spawnSync(
    'avifenc',
    [
      '-j',
      '1',
      '--lossless',
      '--cicp',
      '1/13/0',
      '-s',
      '6',
      '--tilecolslog2',
      '1',
      '--tilerowslog2',
      '1',
      sourcePath,
      avifTiledLosslessFixturePath,
    ],
    { stdio: 'inherit' },
  )
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`avifenc exited with status ${result.status ?? 'unknown'}`)
  }
  const fileSha256 = createHash('sha256')
    .update(await readFile(avifTiledLosslessFixturePath))
    .digest('hex')
  if (fileSha256 !== fixture.fileSha256) {
    throw new Error(`Tiled AVIF fixture checksum changed: ${fileSha256}`)
  }
  console.log(`generated ${fixture.file}`)
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true })
}
