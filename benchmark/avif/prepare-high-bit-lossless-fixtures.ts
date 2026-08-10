import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  avifHighBitLosslessFixtureDirectory,
  avifHighBitLosslessFixtures,
} from './high-bit-lossless-fixtures.ts'

const createY4m = (bitDepth: 10 | 12, width: number, height: number): Uint8Array => {
  const header = Buffer.from(
    `YUV4MPEG2 W${width} H${height} F1:1 Ip A1:1 C444p${bitDepth} XYSCSS=444P${bitDepth} XCOLORRANGE=FULL\nFRAME\n`,
  )
  const pixels = Buffer.alloc(width * height * 3 * 2)
  const maximum = 2 ** bitDepth - 1
  for (let plane = 0; plane < 3; plane += 1) {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const value =
          plane === 0
            ? Math.round((x * maximum) / (width - 1))
            : plane === 1
              ? Math.round((y * maximum) / (height - 1))
              : Math.round((((x ^ y) & 15) * maximum) / 15)
        pixels.writeUInt16LE(value, (plane * width * height + y * width + x) * 2)
      }
    }
  }
  return Buffer.concat([header, pixels])
}

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'purejsimage-avif-high-bit-'))
try {
  for (const fixture of avifHighBitLosslessFixtures) {
    const source = createY4m(fixture.bitDepth, fixture.width, fixture.height)
    const sourceSha256 = createHash('sha256').update(source).digest('hex')
    if (sourceSha256 !== fixture.sourceY4mSha256) {
      throw new Error(`${fixture.file} source checksum changed: ${sourceSha256}`)
    }
    const sourcePath = join(temporaryDirectory, `source-${fixture.bitDepth}.y4m`)
    const outputPath = join(avifHighBitLosslessFixtureDirectory, fixture.file)
    await writeFile(sourcePath, source)
    const result = spawnSync(
      'avifenc',
      ['-j', '1', '--lossless', '--cicp', '1/13/0', '-s', '6', sourcePath, outputPath],
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
