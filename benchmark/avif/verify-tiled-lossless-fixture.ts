import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { av1ObuType } from '../../src/codecs/av1.ts'
import { parseAv1Frame } from '../../src/codecs/av1-frame.ts'
import { decodeRestrictedAv1Intra } from '../../src/codecs/av1-intra.ts'
import { inspectAvifBitstreams } from '../../src/codecs/avif.ts'
import { MemorySource } from '../../src/source.ts'
import { avifTiledLosslessFixture, avifTiledLosslessFixturePath } from './tiled-lossless-fixture.ts'

const fixture = avifTiledLosslessFixture
const input = new Uint8Array(await readFile(avifTiledLosslessFixturePath))
const fileSha256 = createHash('sha256').update(input).digest('hex')
if (fileSha256 !== fixture.fileSha256) {
  throw new Error(`Tiled AVIF fixture checksum changed: ${fileSha256}`)
}
const inspection = await inspectAvifBitstreams(new MemorySource(input))
const coded = inspection.codedImages.find((image) => image.role === 'color')
const frameObu = coded?.obus.find((obu) => obu.type === av1ObuType.frame)
if (!coded || !frameObu) throw new Error('Tiled AVIF fixture has no color frame OBU')
const frame = parseAv1Frame(coded.sequence, frameObu.payload)
if (
  frame.header.tileColumns !== fixture.columns ||
  frame.header.tileRows !== fixture.rows ||
  frame.tiles.length !== fixture.columns * fixture.rows
) {
  throw new Error(
    `Tiled AVIF layout was ${frame.header.tileColumns}x${frame.header.tileRows} with ${frame.tiles.length} payloads`,
  )
}
const decoded = decodeRestrictedAv1Intra(coded.sequence, frame)
const nativeYuv = Buffer.alloc(fixture.width * fixture.height * 3 * 2)
for (const [plane, samples] of [decoded.y, decoded.u, decoded.v].entries()) {
  const stride = plane === 0 ? decoded.yStride : decoded.chromaStride
  for (let y = 0; y < fixture.height; y += 1) {
    for (let x = 0; x < fixture.width; x += 1) {
      const target = (plane * fixture.width * fixture.height + y * fixture.width + x) * 2
      nativeYuv.writeUInt16LE(samples[y * stride + x] ?? 0, target)
    }
  }
}
const nativeYuvSha256 = createHash('sha256').update(nativeYuv).digest('hex')
if (nativeYuvSha256 !== fixture.nativeYuvSha256) {
  throw new Error(`PureJsImage tiled AVIF native YUV checksum changed: ${nativeYuvSha256}`)
}

const oracleHashes: Record<string, string> = {}
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'purejsimage-avif-tile-oracles-'))
try {
  for (const decoder of ['dav1d', 'aom'] as const) {
    const outputPath = join(temporaryDirectory, `${decoder}.y4m`)
    const result = spawnSync(
      'avifdec',
      ['-j', '1', '--codec', decoder, avifTiledLosslessFixturePath, outputPath],
      { encoding: 'utf8' },
    )
    if (result.error) throw result.error
    if (result.status !== 0) {
      throw new Error(
        `avifdec ${decoder} exited with status ${result.status ?? 'unknown'}: ${result.stderr}`,
      )
    }
    const output = await readFile(outputPath)
    const payloadStart = output.indexOf(Buffer.from('\nFRAME\n'))
    if (payloadStart < 0) throw new Error(`avifdec ${decoder} output has no Y4M frame header`)
    const payload = output.subarray(payloadStart + 7)
    const hash = createHash('sha256').update(payload).digest('hex')
    if (hash !== fixture.nativeYuvSha256) {
      throw new Error(`avifdec ${decoder} native YUV checksum was ${hash}`)
    }
    oracleHashes[decoder] = hash
  }
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true })
}

console.log(
  JSON.stringify(
    {
      file: fixture.file,
      bitDepth: fixture.bitDepth,
      tiles: `${fixture.columns}x${fixture.rows}`,
      nativeYuvSha256,
      oracleHashes,
    },
    null,
    2,
  ),
)
