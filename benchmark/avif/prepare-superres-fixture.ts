import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { avifSuperresFixtureDirectory, avifSuperresFixtures } from './superres-fixture.ts'

const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')
const directory = await mkdtemp(join(tmpdir(), 'purejsimage-avif-superres-'))
try {
  for (const fixture of avifSuperresFixtures) {
    const stem = fixture.file.slice(0, -'.avif'.length)
    const sourcePath = join(directory, `${stem}.y4m`)
    const obuPath = join(directory, `${stem}.obu`)
    const chromaWidth = fixture.chromaSubsampling === '444' ? fixture.width : fixture.width >> 1
    const chromaHeight = fixture.chromaSubsampling === '444' ? fixture.height : fixture.height >> 1
    const chromaHeader =
      fixture.chromaSubsampling === '444' ? 'C444 XYSCSS=444' : 'C420jpeg XYSCSS=420JPEG'
    const header = Buffer.from(
      `YUV4MPEG2 W${fixture.width} H${fixture.height} F1:1 Ip A1:1 ${chromaHeader} XCOLORRANGE=FULL\nFRAME\n`,
    )
    const luma = Buffer.alloc(fixture.width * fixture.height)
    const u = Buffer.alloc(chromaWidth * chromaHeight)
    const v = Buffer.alloc(chromaWidth * chromaHeight)
    for (let y = 0; y < fixture.height; y += 1) {
      for (let x = 0; x < fixture.width; x += 1) {
        const detail =
          fixture.sourcePattern === 'detail' ? (((x >> 3) ^ (y >> 3)) & 1) * 71 + ((x * y) >> 4) : 0
        luma[y * fixture.width + x] = (x * 5 + y * 3 + detail) & 0xff
      }
    }
    for (let y = 0; y < chromaHeight; y += 1) {
      for (let x = 0; x < chromaWidth; x += 1) {
        if (fixture.sourcePattern === 'detail') {
          u[y * chromaWidth + x] = (x * 11 + y * 7 + (((x >> 2) ^ (y >> 2)) & 1) * 53) & 0xff
          v[y * chromaWidth + x] = (x * 3 + y * 13 + ((x * y) >> 3)) & 0xff
        } else {
          u[y * chromaWidth + x] = (x * 7 + y) & 0xff
          v[y * chromaWidth + x] = (x + y * 11) & 0xff
        }
      }
    }
    const source = Buffer.concat([header, luma, u, v])
    if (sha256(source) !== fixture.sourceY4mSha256) {
      throw new Error(`${fixture.file} source checksum changed`)
    }
    await writeFile(sourcePath, source)

    const encoded = spawnSync(
      'aomenc',
      [
        '--debug',
        '--obu',
        '--allintra',
        '--passes=1',
        `--cpu-used=${fixture.cpuUsed}`,
        '--end-usage=q',
        `--cq-level=${fixture.cqLevel}`,
        '--superres-mode=1',
        `--superres-denominator=${fixture.superresDenominator}`,
        `--superres-kf-denominator=${fixture.superresDenominator}`,
        '--loopfilter-control=0',
        `--enable-cdef=${Number(fixture.filters.includes('cdef'))}`,
        `--enable-restoration=${Number(fixture.filters.includes('restoration'))}`,
        '--limit=1',
        `--i${fixture.chromaSubsampling}`,
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
    const fixturePath = join(avifSuperresFixtureDirectory, fixture.file)
    const muxed = spawnSync(
      'ffmpeg',
      ['-hide_banner', '-loglevel', 'error', '-y', '-i', obuPath, '-c', 'copy', fixturePath],
      { encoding: 'utf8' },
    )
    if (muxed.error) throw muxed.error
    if (muxed.status !== 0) throw new Error(`ffmpeg failed: ${muxed.stderr.trim()}`)
    const encodedFixture = await readFile(fixturePath)
    const checksum = sha256(encodedFixture)
    if (checksum !== fixture.fileSha256) {
      throw new Error(`${fixture.file} checksum changed: ${checksum}`)
    }
    console.log(`generated ${fixture.file}`)
  }
} finally {
  await rm(directory, { recursive: true, force: true })
}
