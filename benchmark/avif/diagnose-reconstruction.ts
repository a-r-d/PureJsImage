import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'

import { parseAv1Frame } from '../../src/codecs/av1-frame.ts'
import { decodeRestrictedAv1Intra, type Av1DecodedFrame } from '../../src/codecs/av1-intra.ts'
import { av1ObuType } from '../../src/codecs/av1.ts'
import { inspectAvifBitstreams } from '../../src/codecs/avif.ts'
import { MemorySource } from '../../src/source.ts'

interface PlaneComparison {
  readonly different: number
  readonly first: readonly [number, number] | null
  readonly height: number
  readonly largestBlocks: readonly {
    readonly block: readonly [number, number]
    readonly different: number
    readonly maximum: number
    readonly total: number
  }[]
  readonly maximum: number
  readonly meanAbsoluteError: number
  readonly width: number
}

const packVisibleYuv = (frame: Av1DecodedFrame): Uint8Array => {
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

const decodePure = async (
  input: Uint8Array,
): Promise<{ readonly height: number; readonly width: number; readonly yuv: Uint8Array }> => {
  const inspection = await inspectAvifBitstreams(new MemorySource(input))
  const coded = inspection.codedImages.find((image) => image.role === 'color')
  if (!coded) throw new Error('AVIF fixture has no color item')
  const obu = coded.obus.find((candidate) => candidate.type === av1ObuType.frame)
  if (!obu) throw new Error('AVIF fixture has no frame OBU')
  const frame = parseAv1Frame(coded.sequence, obu.payload)
  const decoded = decodeRestrictedAv1Intra(coded.sequence, frame)
  return { width: decoded.width, height: decoded.height, yuv: packVisibleYuv(decoded) }
}

const decodeOracle = (path: string): Promise<Uint8Array> =>
  new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', [
      '-v',
      'error',
      '-c:v',
      'libdav1d',
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
      const byteLength = chunks.reduce((total, chunk) => total + chunk.byteLength, 0)
      if (code !== 0) {
        const errorLength = errors.reduce((total, chunk) => total + chunk.byteLength, 0)
        const message = new Uint8Array(errorLength)
        let errorOffset = 0
        for (const chunk of errors) {
          message.set(chunk, errorOffset)
          errorOffset += chunk.byteLength
        }
        reject(new Error(`dav1d failed: ${new TextDecoder().decode(message)}`))
        return
      }
      const output = new Uint8Array(byteLength)
      let offset = 0
      for (const chunk of chunks) {
        output.set(chunk, offset)
        offset += chunk.byteLength
      }
      resolve(output)
    })
  })

const comparePlane = (
  actual: Uint8Array,
  expected: Uint8Array,
  offset: number,
  width: number,
  height: number,
): PlaneComparison => {
  const blockWidth = Math.ceil(width / 4)
  const blockDifferent = new Uint16Array(blockWidth * Math.ceil(height / 4))
  const blockMaximum = new Uint8Array(blockDifferent.length)
  const blockTotal = new Uint32Array(blockDifferent.length)
  let different = 0
  let first: readonly [number, number] | null = null
  let maximum = 0
  let total = 0
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const index = offset + row * width + column
      const difference = Math.abs((actual[index] ?? 0) - (expected[index] ?? 0))
      if (difference === 0) continue
      if (first === null) first = [column, row]
      different += 1
      maximum = Math.max(maximum, difference)
      total += difference
      const block = (row >> 2) * blockWidth + (column >> 2)
      blockDifferent[block] = (blockDifferent[block] ?? 0) + 1
      blockMaximum[block] = Math.max(blockMaximum[block] ?? 0, difference)
      blockTotal[block] = (blockTotal[block] ?? 0) + difference
    }
  }
  const largestBlocks = Array.from(blockDifferent, (count, index) => ({
    block: [(index % blockWidth) * 4, Math.floor(index / blockWidth) * 4] as const,
    different: count,
    maximum: blockMaximum[index] ?? 0,
    total: blockTotal[index] ?? 0,
  }))
    .filter((block) => block.different > 0)
    .sort((left, right) => right.total - left.total)
    .slice(0, 12)
  return {
    width,
    height,
    different,
    first,
    maximum,
    meanAbsoluteError: total / (width * height),
    largestBlocks,
  }
}

const path = process.argv[2]
if (!path) throw new Error('Usage: node benchmark/avif/diagnose-reconstruction.ts <file.avif>')
const input = new Uint8Array(await readFile(path))
const [pure, reference] = await Promise.all([decodePure(input), decodeOracle(path)])
if (pure.yuv.byteLength !== reference.byteLength) {
  throw new Error(`YUV byte length differs: ${pure.yuv.byteLength} != ${reference.byteLength}`)
}
const chromaWidth = Math.ceil(pure.width / 2)
const chromaHeight = Math.ceil(pure.height / 2)
const lumaLength = pure.width * pure.height
const chromaLength = chromaWidth * chromaHeight
const probeX = Number.parseInt(process.argv[3] ?? '', 10)
const probeY = Number.parseInt(process.argv[4] ?? '', 10)
const probePlane = process.argv[5] === 'u' || process.argv[5] === 'v' ? process.argv[5] : 'y'
const probeWidth = probePlane === 'y' ? pure.width : chromaWidth
const probeHeight = probePlane === 'y' ? pure.height : chromaHeight
const probeOffset =
  probePlane === 'y' ? 0 : probePlane === 'u' ? lumaLength : lumaLength + chromaLength
const probe =
  Number.isInteger(probeX) && Number.isInteger(probeY)
    ? Array.from({ length: 12 }, (_, rowOffset) => {
        const y = probeY + rowOffset - 2
        return Array.from({ length: 12 }, (_, columnOffset) => {
          const x = probeX + columnOffset - 2
          if (x < 0 || y < 0 || x >= probeWidth || y >= probeHeight) return null
          const index = probeOffset + y * probeWidth + x
          return [pure.yuv[index] ?? 0, reference[index] ?? 0] as const
        })
      })
    : undefined
console.log(
  JSON.stringify(
    {
      file: path,
      probePlane,
      probe,
      planes: {
        y: comparePlane(pure.yuv, reference, 0, pure.width, pure.height),
        u: comparePlane(pure.yuv, reference, lumaLength, chromaWidth, chromaHeight),
        v: comparePlane(pure.yuv, reference, lumaLength + chromaLength, chromaWidth, chromaHeight),
      },
    },
    null,
    2,
  ),
)
