import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  avifHighBitExpandedFixturePath,
  avifHighBitExpandedFixtures,
  highBitExpandedSample,
} from './high-bit-expanded-fixtures.ts'

const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'purejsimage-avif-expanded-high-bit-'))
try {
  for (const fixture of avifHighBitExpandedFixtures) {
    const chromaWidth = fixture.chromaSubsampling === '444' ? fixture.width : fixture.width >> 1
    const chromaHeight = fixture.chromaSubsampling === '444' ? fixture.height : fixture.height >> 1
    const header = Buffer.from(
      `YUV4MPEG2 W${fixture.width} H${fixture.height} F1:1 Ip A1:1 C${fixture.chromaSubsampling}p${fixture.bitDepth} XYSCSS=${fixture.chromaSubsampling}P${fixture.bitDepth} XCOLORRANGE=FULL\nFRAME\n`,
    )
    const pixels = Buffer.alloc(
      (fixture.width * fixture.height + 2 * chromaWidth * chromaHeight) * 2,
    )
    let offset = 0
    for (const plane of [0, 1, 2] as const) {
      const planeWidth = plane === 0 ? fixture.width : chromaWidth
      const planeHeight = plane === 0 ? fixture.height : chromaHeight
      for (let y = 0; y < planeHeight; y += 1) {
        for (let x = 0; x < planeWidth; x += 1) {
          pixels.writeUInt16LE(highBitExpandedSample(fixture, plane, x, y), offset)
          offset += 2
        }
      }
    }
    const source = Buffer.concat([header, pixels])
    const sourceChecksum = sha256(source)
    if (sourceChecksum !== fixture.sourceY4mSha256) {
      throw new Error(`${fixture.file} source checksum changed: ${sourceChecksum}`)
    }
    const sourcePath = join(temporaryDirectory, `${fixture.file}.y4m`)
    const obuPath = join(temporaryDirectory, `${fixture.file}.obu`)
    await writeFile(sourcePath, source)
    const encoded = spawnSync(
      'aomenc',
      [
        '--debug',
        '--obu',
        '--allintra',
        '--passes=1',
        '--cpu-used=6',
        ...(fixture.codedLossless
          ? ['--lossless=1']
          : [
              '--end-usage=q',
              `--cq-level=${fixture.quantizer}`,
              '--loopfilter-control=0',
              '--enable-cdef=0',
              '--enable-restoration=0',
            ]),
        '--limit=1',
        `--i${fixture.chromaSubsampling}`,
        `--input-bit-depth=${fixture.bitDepth}`,
        `--bit-depth=${fixture.bitDepth}`,
        '--color-primaries=bt709',
        '--transfer-characteristics=srgb',
        `--matrix-coefficients=${fixture.chromaSubsampling === '444' ? 'identity' : 'bt709'}`,
        '-o',
        obuPath,
        sourcePath,
      ],
      { encoding: 'utf8' },
    )
    if (encoded.error) throw encoded.error
    if (encoded.status !== 0) throw new Error(`aomenc failed: ${encoded.stderr.trim()}`)
    const fixturePath = avifHighBitExpandedFixturePath(fixture)
    const muxed = spawnSync(
      'ffmpeg',
      ['-hide_banner', '-loglevel', 'error', '-y', '-i', obuPath, '-c', 'copy', fixturePath],
      { encoding: 'utf8' },
    )
    if (muxed.error) throw muxed.error
    if (muxed.status !== 0) throw new Error(`ffmpeg failed: ${muxed.stderr.trim()}`)
    const checksum = sha256(await readFile(fixturePath))
    if (checksum !== fixture.fileSha256) {
      throw new Error(`${fixture.file} checksum changed: ${checksum}`)
    }
    console.log(`generated ${fixture.file}`)
  }
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true })
}
