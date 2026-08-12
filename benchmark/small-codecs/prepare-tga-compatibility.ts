import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { downloadPinnedFile } from '../lib/pinned-download.ts'
import { tgaCodec } from '../../src/codecs/tga.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { MemorySource } from '../../src/source.ts'

interface CompatibilityFile {
  readonly file: string
  readonly sha256: string
  readonly url: string
  readonly width: number
  readonly height: number
  readonly pixelFormat: 'rgb8' | 'rgba8'
  readonly pixelSha256: string
}

const repositoryRoot = resolve(import.meta.dirname, '../..')
const destinationDirectory = join(
  repositoryRoot,
  'benchmark/corpus/files/small-codecs-tga-compatibility',
)
const allowedHosts = new Set(['raw.githubusercontent.com'])
const files: readonly CompatibilityFile[] = [
  {
    file: 'top_left.tga',
    url: 'https://raw.githubusercontent.com/image-rs/image/main/tests/images/tga/testsuite/top_left.tga',
    sha256: '49ff8fac388876b658f77aba4ae3425f57488cab640bd72a5876b4cfcca9d5a2',
    width: 75,
    height: 70,
    pixelFormat: 'rgba8',
    pixelSha256: '47ce4a5f7432000af7b2f3d6c02f422f4477cea377d197157e3702ab5e78acf8',
  },
  {
    file: 'bottom_left.tga',
    url: 'https://raw.githubusercontent.com/image-rs/image/main/tests/images/tga/testsuite/bottom_left.tga',
    sha256: 'aabf1d0dafb537e2f2d75e8a173b9561805a2f3dbaf10ad0eb7b5b81a33a912a',
    width: 75,
    height: 70,
    pixelFormat: 'rgba8',
    pixelSha256: 'fa9ca9cb7153fa855867ba530a5bd8d64f1716f39702d3d2d2a160c92746fc5a',
  },
  {
    file: 'b5-cmap.tga',
    url: 'https://raw.githubusercontent.com/image-rs/image/main/tests/images/tga/testsuite/b5-cmap.tga',
    sha256: '57aa985246d3583f6eb6533fef2bf69e87e306c40b57e38ce7b17ff7aea69e64',
    width: 4,
    height: 4,
    pixelFormat: 'rgb8',
    pixelSha256: '60af35598edf4b83df3b6933a0b6513a044b4d337da10886a6e0375f69f2c4b1',
  },
  {
    file: 'ctc24.tga',
    url: 'https://raw.githubusercontent.com/image-rs/image/main/tests/images/tga/testsuite/ctc24.tga',
    sha256: '09476dca727360d41688664c82f2fabf0e3c8627af4d10c41d019767bf43d386',
    width: 128,
    height: 128,
    pixelFormat: 'rgb8',
    pixelSha256: '4a93f4cb82ea59734e49aabd83ac146c640db852138eb2a1bf484a391c0d71b5',
  },
]

await mkdir(destinationDirectory, { recursive: true })
for (const file of files) {
  await downloadPinnedFile({
    allowedDirectory: destinationDirectory,
    allowedHosts,
    destination: join(destinationDirectory, file.file),
    expectedSha256: file.sha256,
    url: file.url,
  })
  const bytes = await readFile(join(destinationDirectory, file.file))
  if (!tgaCodec.createDecoder) throw new Error('TGA decoder is unavailable')
  const decoder = await tgaCodec.createDecoder(new MemorySource(bytes), defaultImageLimits)
  if (
    decoder.width !== file.width ||
    decoder.height !== file.height ||
    decoder.pixelFormat !== file.pixelFormat
  ) {
    throw new Error(`${file.file} decoded geometry or pixel format changed`)
  }
  const hash = createHash('sha256')
  const rowBytes = file.width * (file.pixelFormat === 'rgba8' ? 4 : 3)
  let rows = 0
  for await (const block of decoder.decode()) {
    for (let row = 0; row < block.height; row += 1) {
      hash.update(block.data.subarray(row * block.stride, row * block.stride + rowBytes))
      rows += 1
    }
  }
  const actualPixelSha256 = hash.digest('hex')
  if (rows !== file.height || actualPixelSha256 !== file.pixelSha256) {
    throw new Error(
      `${file.file} decoded pixels changed: expected ${file.pixelSha256}, got ${actualPixelSha256}`,
    )
  }
  console.log(`ok ${file.file}`)
}
