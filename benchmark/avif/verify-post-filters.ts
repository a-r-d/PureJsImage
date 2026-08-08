import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { parseAv1Frame } from '../../src/codecs/av1-frame.ts'
import { decodeRestrictedAv1Intra, type Av1Yuv420Frame } from '../../src/codecs/av1-intra.ts'
import { av1ObuType } from '../../src/codecs/av1.ts'
import { inspectAvifBitstreams } from '../../src/codecs/avif.ts'
import { MemorySource } from '../../src/source.ts'
import { avifPostFilterFixtureDirectory, avifPostFilterFixtures } from './post-filter-fixtures.ts'

const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')

const packVisibleYuv = (frame: Av1Yuv420Frame): Uint8Array => {
  const output = new Uint8Array(
    frame.width * frame.height + 2 * frame.chromaWidth * frame.chromaHeight,
  )
  let offset = 0
  for (let row = 0; row < frame.height; row += 1) {
    output.set(frame.y.subarray(row * frame.yStride, row * frame.yStride + frame.width), offset)
    offset += frame.width
  }
  for (const plane of [frame.u, frame.v]) {
    for (let row = 0; row < frame.chromaHeight; row += 1) {
      output.set(
        plane.subarray(row * frame.chromaStride, row * frame.chromaStride + frame.chromaWidth),
        offset,
      )
      offset += frame.chromaWidth
    }
  }
  return output
}

const decodePure = async (input: Uint8Array): Promise<Uint8Array> => {
  const inspection = await inspectAvifBitstreams(new MemorySource(input))
  const coded = inspection.codedImages.find((image) => image.role === 'color')
  if (!coded) throw new Error('AVIF post-filter fixture has no color item')
  const obu = coded.obus.find((candidate) => candidate.type === av1ObuType.frame)
  if (!obu) throw new Error('AVIF post-filter fixture has no frame OBU')
  const frame = parseAv1Frame(coded.sequence, obu.payload)
  return packVisibleYuv(decodeRestrictedAv1Intra(coded.sequence, frame))
}

const decodeOracle = (decoder: 'libaom-av1' | 'libdav1d', path: string): Promise<Uint8Array> =>
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
        const length = errors.reduce((total, chunk) => total + chunk.byteLength, 0)
        const message = new Uint8Array(length)
        let offset = 0
        for (const chunk of errors) {
          message.set(chunk, offset)
          offset += chunk.byteLength
        }
        reject(new Error(`ffmpeg ${decoder} failed: ${new TextDecoder().decode(message)}`))
        return
      }
      const length = chunks.reduce((total, chunk) => total + chunk.byteLength, 0)
      const output = new Uint8Array(length)
      let offset = 0
      for (const chunk of chunks) {
        output.set(chunk, offset)
        offset += chunk.byteLength
      }
      resolve(output)
    })
  })

const firstDifference = (left: Uint8Array, right: Uint8Array): number => {
  const length = Math.min(left.byteLength, right.byteLength)
  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) return index
  }
  return left.byteLength === right.byteLength ? -1 : length
}

const results: Array<{
  readonly file: string
  readonly filters: readonly string[]
  readonly pixels: number
  readonly tolerance: number
  readonly yuvSha256: string
}> = []

for (const fixture of avifPostFilterFixtures) {
  const path = join(avifPostFilterFixtureDirectory, fixture.file)
  const input = new Uint8Array(await readFile(path))
  if (sha256(input) !== fixture.fileSha256) throw new Error(`${fixture.file} checksum changed`)
  const [pure, dav1d, libaom] = await Promise.all([
    decodePure(input),
    decodeOracle('libdav1d', path),
    decodeOracle('libaom-av1', path),
  ])
  for (const [name, output] of [
    ['dav1d', dav1d],
    ['libaom', libaom],
  ] as const) {
    const difference = firstDifference(pure, output)
    if (difference !== -1) {
      throw new Error(
        `${fixture.file} differs from ${name} at YUV byte ${difference}: ${pure[difference]} != ${output[difference]}`,
      )
    }
  }
  if (firstDifference(dav1d, libaom) !== -1) {
    throw new Error(`${fixture.file} independent decoders disagree`)
  }
  if (sha256(pure) !== fixture.yuvSha256) throw new Error(`${fixture.file} YUV checksum changed`)
  results.push({
    file: fixture.file,
    filters: fixture.filters,
    pixels: fixture.width * fixture.height,
    tolerance: 0,
    yuvSha256: fixture.yuvSha256,
  })
}

console.log(JSON.stringify({ decoders: ['dav1d', 'libaom'], results }, null, 2))
