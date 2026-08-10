import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { parseAv1Frame } from '../../src/codecs/av1-frame.ts'
import { decodeRestrictedAv1Intra } from '../../src/codecs/av1-intra.ts'
import { av1ObuType } from '../../src/codecs/av1.ts'
import { inspectAvifBitstreams } from '../../src/codecs/avif.ts'
import { MemorySource } from '../../src/source.ts'
import {
  avifHighBitExpandedFixturePath,
  avifHighBitExpandedFixtures,
} from './high-bit-expanded-fixtures.ts'

const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')
const results: Array<{
  readonly bitDepth: number
  readonly chromaSubsampling: string
  readonly codedLossless: boolean
  readonly file: string
  readonly nativeYuvSha256: string
}> = []
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'purejsimage-avif-high-bit-oracles-'))
try {
  for (const fixture of avifHighBitExpandedFixtures) {
    const fixturePath = avifHighBitExpandedFixturePath(fixture)
    const input = new Uint8Array(await readFile(fixturePath))
    if (sha256(input) !== fixture.fileSha256) throw new Error(`${fixture.file} checksum changed`)
    const inspection = await inspectAvifBitstreams(new MemorySource(input))
    const coded = inspection.codedImages.find((image) => image.role === 'color')
    const obu = coded?.obus.find((candidate) => candidate.type === av1ObuType.frame)
    if (!coded || !obu) throw new Error(`${fixture.file} has no color frame OBU`)
    const frame = parseAv1Frame(coded.sequence, obu.payload)
    if (
      coded.sequence.bitDepth !== fixture.bitDepth ||
      coded.sequence.chromaSubsampling !== fixture.chromaSubsampling ||
      frame.header.codedLossless !== fixture.codedLossless ||
      (!fixture.codedLossless &&
        (frame.header.loopFilterLevels.some((level) => level !== 0) ||
          frame.header.cdefYPrimaryStrengths.some((strength) => strength !== 0) ||
          frame.header.restorationTypes.some((type) => type !== 0)))
    ) {
      throw new Error(`${fixture.file} high-bit frame configuration changed`)
    }
    const decoded = decodeRestrictedAv1Intra(coded.sequence, frame)
    const nativeYuv = Buffer.alloc(
      (decoded.width * decoded.height + 2 * decoded.chromaWidth * decoded.chromaHeight) * 2,
    )
    let offset = 0
    for (const [plane, stride, width, height] of [
      [decoded.y, decoded.yStride, decoded.width, decoded.height],
      [decoded.u, decoded.chromaStride, decoded.chromaWidth, decoded.chromaHeight],
      [decoded.v, decoded.chromaStride, decoded.chromaWidth, decoded.chromaHeight],
    ] as const) {
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          nativeYuv.writeUInt16LE(plane[y * stride + x] ?? 0, offset)
          offset += 2
        }
      }
    }
    if (sha256(nativeYuv) !== fixture.nativeYuvSha256) {
      throw new Error(`PureJsImage ${fixture.file} native YUV checksum changed`)
    }
    for (const decoder of ['dav1d', 'aom'] as const) {
      const outputPath = join(temporaryDirectory, `${fixture.file}-${decoder}.y4m`)
      const result = spawnSync(
        'avifdec',
        ['-j', '1', '--codec', decoder, fixturePath, outputPath],
        { encoding: 'utf8' },
      )
      if (result.error) throw result.error
      if (result.status !== 0) throw new Error(`avifdec ${decoder} failed: ${result.stderr}`)
      const output = await readFile(outputPath)
      const payloadStart = output.indexOf(Buffer.from('\nFRAME\n'))
      if (payloadStart < 0) throw new Error(`avifdec ${decoder} output has no Y4M frame header`)
      const checksum = sha256(output.subarray(payloadStart + 7))
      if (checksum !== fixture.nativeYuvSha256) {
        throw new Error(`avifdec ${decoder} ${fixture.file} native YUV checksum was ${checksum}`)
      }
    }
    results.push({
      bitDepth: fixture.bitDepth,
      chromaSubsampling: fixture.chromaSubsampling,
      codedLossless: fixture.codedLossless,
      file: fixture.file,
      nativeYuvSha256: fixture.nativeYuvSha256,
    })
  }
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true })
}
console.log(JSON.stringify({ decoders: ['PureJsImage', 'dav1d', 'libaom'], results }, null, 2))
