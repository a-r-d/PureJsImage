import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import { parseAv1FrameObus } from '../../src/codecs/av1-frame.ts'
import {
  decodeRestrictedAv1Intra,
  estimateRestrictedAv1WorkingBytes,
  type Av1DecodedFrame,
} from '../../src/codecs/av1-intra.ts'
import { av1ObuType } from '../../src/codecs/av1.ts'
import { inspectAvifBitstreams } from '../../src/codecs/avif.ts'
import { MemorySource } from '../../src/source.ts'
import { avifLossyMultitileFixtures } from './lossy-multitile-fixture.ts'

const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')

const packVisibleYuv = (frame: Av1DecodedFrame): Uint8Array => {
  const output = new Uint8Array(
    frame.width * frame.height + 2 * frame.chromaWidth * frame.chromaHeight,
  )
  let offset = 0
  for (const [plane, stride, width, height] of [
    [frame.y, frame.yStride, frame.width, frame.height],
    [frame.u, frame.chromaStride, frame.chromaWidth, frame.chromaHeight],
    [frame.v, frame.chromaStride, frame.chromaWidth, frame.chromaHeight],
  ] as const) {
    for (let row = 0; row < height; row += 1) {
      output.set(plane.subarray(row * stride, row * stride + width), offset)
      offset += width
    }
  }
  return output
}

const decodeOracle = (path: string, decoder: 'libaom-av1' | 'libdav1d'): Promise<Uint8Array> =>
  new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', [
      '-v',
      'error',
      '-c:v',
      decoder,
      '-i',
      path,
      '-frames:v',
      '1',
      '-pix_fmt',
      'yuv420p',
      '-f',
      'rawvideo',
      'pipe:1',
    ])
    const chunks: Uint8Array[] = []
    const errors: Uint8Array[] = []
    child.stdout.on('data', (chunk: Uint8Array) => chunks.push(chunk))
    child.stderr.on('data', (chunk: Uint8Array) => errors.push(chunk))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg ${decoder} failed: ${Buffer.concat(errors).toString()}`))
        return
      }
      resolve(Buffer.concat(chunks))
    })
  })

const results: Array<{
  readonly estimatedWorkingBytes: number
  readonly differences: number
  readonly file: string
  readonly maximumDifference: number
  readonly tileGroups: number
  readonly tiles: string
}> = []
for (const { fixture, path } of avifLossyMultitileFixtures) {
  const input = new Uint8Array(await readFile(path))
  if (sha256(input) !== fixture.fileSha256) throw new Error(`${fixture.file} checksum changed`)
  const inspection = await inspectAvifBitstreams(new MemorySource(input))
  const coded = inspection.codedImages.find((image) => image.role === 'color')
  if (!coded) throw new Error(`${fixture.file} has no color coded image`)
  const parsed = parseAv1FrameObus(coded.sequence, coded.obus)
  const tileGroups = coded.obus.filter(
    (candidate) => candidate.type === av1ObuType.tileGroup,
  ).length
  const hasLoopFilter = parsed.header.loopFilterLevels.some((level) => level !== 0)
  const hasCdef = parsed.header.cdefYPrimaryStrengths.some((strength) => strength !== 0)
  const hasRestoration = parsed.header.restorationTypes.some((type) => type !== 0)
  const filtersMatch =
    fixture.filters === 'full'
      ? hasLoopFilter && hasCdef && hasRestoration
      : fixture.filters === 'deblock-cdef'
        ? hasLoopFilter && hasCdef && !hasRestoration
        : !hasCdef && !hasRestoration
  if (
    parsed.tiles.length !== fixture.columns * fixture.rows ||
    parsed.header.allLossless ||
    coded.sequence.reducedStillPictureHeader !== fixture.reducedStillPictureHeader ||
    tileGroups !== fixture.tileGroups ||
    !filtersMatch
  ) {
    throw new Error(`${fixture.file} lossy multi-tile syntax changed`)
  }
  const estimatedWorkingBytes = estimateRestrictedAv1WorkingBytes(coded.sequence, parsed)
  if (estimatedWorkingBytes > 64 * 1_024 * 1_024) {
    throw new Error(`${fixture.file} exceeds the default AVIF working-memory limit`)
  }
  const pure = packVisibleYuv(decodeRestrictedAv1Intra(coded.sequence, parsed))
  if (sha256(pure) !== fixture.pureYuvSha256) {
    throw new Error(`PureJsImage ${fixture.file} YUV checksum changed`)
  }
  const [dav1d, libaom] = await Promise.all([
    decodeOracle(path, 'libdav1d'),
    decodeOracle(path, 'libaom-av1'),
  ])
  for (const [name, output] of [
    ['dav1d', dav1d],
    ['libaom', libaom],
  ] as const) {
    if (sha256(output) !== fixture.oracleYuvSha256) {
      throw new Error(`${name} ${fixture.file} YUV checksum changed`)
    }
  }
  let differences = 0
  let maximumDifference = 0
  for (let index = 0; index < pure.length; index += 1) {
    const difference = Math.abs((pure[index] ?? 0) - (dav1d[index] ?? 0))
    if (difference !== 0) differences += 1
    maximumDifference = Math.max(maximumDifference, difference)
  }
  if (
    differences !== fixture.nativeYuvDifferenceCount ||
    maximumDifference !== fixture.maximumNativeYuvDifference
  ) {
    throw new Error(
      `${fixture.file} native YUV tolerance changed: ${differences} differences, maximum ${maximumDifference}`,
    )
  }
  results.push({
    differences,
    file: fixture.file,
    estimatedWorkingBytes,
    maximumDifference,
    tileGroups,
    tiles: `${fixture.columns}x${fixture.rows}`,
  })
}
console.log(JSON.stringify({ decoders: ['PureJsImage', 'dav1d', 'libaom'], results }, null, 2))
