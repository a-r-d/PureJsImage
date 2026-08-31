import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { performance } from 'node:perf_hooks'

import { reconstructJpegFromJpegXl } from '../../src/jpegxl.ts'

interface MatrixCase {
  readonly id: string
  readonly source: string
  readonly sourceSha256: string
  readonly profile: string
}

const matrix: readonly MatrixCase[] = Object.freeze([
  Object.freeze({
    id: 'progressive-yuv420-exif',
    source: 'benchmark/corpus/files/wpt-webcodecs-mozjpeg-yuv420.jpg',
    sourceSha256: '226671d7fcd032a237d7e195e936545f0b492628fd96b21e1b062ccbc40e2a6e',
    profile: 'progressive YCbCr 4:2:0 with Exif',
  }),
  Object.freeze({
    id: 'progressive-rgb-exif',
    source: 'benchmark/corpus/files/wpt-webcodecs-mozjpeg-rgb.jpg',
    sourceSha256: 'b941a2bf2aa4d29aeca018f7ac02abb6ef8be5c1a782147a8638355a22826e65',
    profile: 'progressive RGB 4:4:4 with Exif and refinement scans',
  }),
  Object.freeze({
    id: 'baseline-yuv422-camera',
    source: 'benchmark/corpus/files/tundra-4000x3000.jpg',
    sourceSha256: 'af55711534d744a385a805d7c0ff20c7e32c19f9fb886b468b078af24ddb8ab6',
    profile: 'baseline YCbCr 4:2:2 camera JPEG with multiple coefficient groups',
  }),
  Object.freeze({
    id: 'progressive-yuv420-refinement',
    source: 'benchmark/corpus/files/tundra-4000x3000-progressive.jpg',
    sourceSha256: '680f4c1ab6fc7e40f0ddf314ad1c6006fddc8519f19b7a613cbd9d8b948bc03e',
    profile: 'progressive YCbCr 4:2:0 with successive approximation refinement',
  }),
])

const run = async (command: string, arguments_: readonly string[]): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, { stdio: ['ignore', 'ignore', 'inherit'] })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} exited with status ${code ?? 'unknown'}`))
    })
  })

const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')

const binaryDirectory = process.argv[2]
if (!binaryDirectory) {
  throw new Error('Usage: node run-jpeg-reconstruction-matrix.ts <libjxl-tools-directory>')
}

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'purejsimage-jpegxl-reconstruction-'))
const results = []
try {
  for (const definition of matrix) {
    const source = new Uint8Array(await readFile(definition.source))
    if (sha256(source) !== definition.sourceSha256) {
      throw new Error(`${definition.id} source checksum does not match the pinned matrix`)
    }
    const encodedPath = join(temporaryDirectory, `${basename(definition.source)}.jxl`)
    const encodeStart = performance.now()
    await run(join(binaryDirectory, 'cjxl'), [
      definition.source,
      encodedPath,
      '--lossless_jpeg=1',
      '--compress_boxes=0',
      '--effort=1',
    ])
    const encodeMilliseconds = performance.now() - encodeStart
    const encoded = new Uint8Array(await readFile(encodedPath))
    const reconstructStart = performance.now()
    const reconstructed = await reconstructJpegFromJpegXl(encoded, {
      limits: {
        maxInputBytes: 64 * 1_024 * 1_024,
        maxDecodedBytes: 512 * 1_024 * 1_024,
        maxReconstructedJpegBytes: 64 * 1_024 * 1_024,
      },
    })
    const reconstructMilliseconds = performance.now() - reconstructStart
    if (!source.every((value, index) => reconstructed[index] === value)) {
      throw new Error(`${definition.id} reconstruction differs from the source JPEG`)
    }
    if (
      source.byteLength !== reconstructed.byteLength ||
      sha256(reconstructed) !== sha256(source)
    ) {
      throw new Error(`${definition.id} reconstruction checksum or length differs`)
    }
    results.push(
      Object.freeze({
        id: definition.id,
        profile: definition.profile,
        sourceBytes: source.byteLength,
        jxlBytes: encoded.byteLength,
        savingsBytes: source.byteLength - encoded.byteLength,
        sourceSha256: definition.sourceSha256,
        jxlSha256: sha256(encoded),
        exact: true,
        encodeMilliseconds,
        reconstructMilliseconds,
      }),
    )
  }
  console.log(JSON.stringify(Object.freeze({ oracle: 'libjxl-0.12.0', results }), undefined, 2))
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true })
}
