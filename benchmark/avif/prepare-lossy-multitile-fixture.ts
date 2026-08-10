import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  type AvifLossyMultitileFixture,
  avifFullHeaderTileGroupsFixture,
  avifFullHeaderTileGroupsFixturePath,
  avifLossyMultitileFixture,
  avifLossyMultitileFixturePath,
  lossyMultitileSample,
} from './lossy-multitile-fixture.ts'

const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')
const fixture = avifLossyMultitileFixture
const chromaWidth = fixture.width >> 1
const chromaHeight = fixture.height >> 1
const header = Buffer.from(
  `YUV4MPEG2 W${fixture.width} H${fixture.height} F1:1 Ip A1:1 C420jpeg XYSCSS=420JPEG XCOLORRANGE=LIMITED\nFRAME\n`,
)
const luma = Buffer.alloc(fixture.width * fixture.height)
const u = Buffer.alloc(chromaWidth * chromaHeight)
const v = Buffer.alloc(chromaWidth * chromaHeight)
for (let y = 0; y < fixture.height; y += 1) {
  for (let x = 0; x < fixture.width; x += 1) {
    luma[y * fixture.width + x] = lossyMultitileSample(0, x, y)
  }
}
for (let y = 0; y < chromaHeight; y += 1) {
  for (let x = 0; x < chromaWidth; x += 1) {
    u[y * chromaWidth + x] = lossyMultitileSample(1, x, y)
    v[y * chromaWidth + x] = lossyMultitileSample(2, x, y)
  }
}
const source = Buffer.concat([header, luma, u, v])
if (sha256(source) !== fixture.sourceY4mSha256) {
  throw new Error(`Lossy multi-tile AVIF source checksum changed: ${sha256(source)}`)
}

const encodeFixture = (
  fixture: AvifLossyMultitileFixture,
  outputPath: string,
  sourcePath: string,
  obuPath: string,
): void => {
  const encoded = spawnSync(
    'aomenc',
    [
      '--debug',
      '--obu',
      '--allintra',
      '--passes=1',
      `--cpu-used=${fixture.reducedStillPictureHeader ? 4 : 6}`,
      '--end-usage=q',
      `--cq-level=${fixture.reducedStillPictureHeader ? 35 : 30}`,
      '--tile-columns=1',
      '--tile-rows=1',
      ...(fixture.tileGroups > 0
        ? [`--num-tile-groups=${fixture.tileGroups}`, '--full-still-picture-hdr']
        : []),
      `--enable-cdef=${fixture.fullPostFilters ? 1 : 0}`,
      `--enable-restoration=${fixture.fullPostFilters ? 1 : 0}`,
      '--limit=1',
      '--i420',
      '--color-primaries=bt709',
      '--transfer-characteristics=srgb',
      '--matrix-coefficients=bt709',
      '-o',
      obuPath,
      sourcePath,
    ],
    { encoding: 'utf8' },
  )
  if (encoded.error) throw encoded.error
  if (encoded.status !== 0) throw new Error(`aomenc failed: ${encoded.stderr.trim()}`)
  const muxed = spawnSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      obuPath,
      '-c',
      'copy',
      '-color_range',
      'tv',
      '-colorspace',
      'bt709',
      '-color_primaries',
      'bt709',
      '-color_trc',
      'iec61966-2-1',
      outputPath,
    ],
    { encoding: 'utf8' },
  )
  if (muxed.error) throw muxed.error
  if (muxed.status !== 0) throw new Error(`ffmpeg failed: ${muxed.stderr.trim()}`)
}

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'purejsimage-avif-lossy-tiles-'))
try {
  const sourcePath = join(temporaryDirectory, 'source.y4m')
  const obuPath = join(temporaryDirectory, 'output.obu')
  await writeFile(sourcePath, source)
  for (const [candidate, outputPath] of [
    [avifLossyMultitileFixture, avifLossyMultitileFixturePath],
    [avifFullHeaderTileGroupsFixture, avifFullHeaderTileGroupsFixturePath],
  ] as const) {
    encodeFixture(candidate, outputPath, sourcePath, obuPath)
    const checksum = sha256(await readFile(outputPath))
    if (checksum !== candidate.fileSha256) {
      throw new Error(`Lossy multi-tile AVIF fixture checksum changed: ${checksum}`)
    }
    console.log(`generated ${candidate.file}`)
  }
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true })
}
