import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import sharp from 'sharp'

import { avifCorpusDirectory } from './corpus.ts'

export type AvifMemoryScenario =
  | 'alpha'
  | 'cdef'
  | 'deblock'
  | 'downscale'
  | 'filtered-4k-multitile'
  | 'filtered-10bit'
  | 'filtered-10bit-downscale'
  | 'filtered-12bit'
  | 'filtered-12bit-downscale'
  | 'film-grain'
  | 'gain-map-grid'
  | 'grid'
  | 'no-filters'
  | 'restoration'

export interface AvifMemoryCase {
  readonly action: 'decode' | 'downscale'
  readonly expectedHeight: number
  readonly expectedOutputSha256: string
  readonly expectedWidth: number
  readonly fileSha256: string
  readonly path: string
  readonly scenario: AvifMemoryScenario
}

const width = 1_024
const height = 768
const pixels = width * height
const sourceY4mSha256 = '43ab5227ea55dadd05a9d7e52c7d9da648665ae51bfa54c53e21ab17f1c54197'
const sourceAlphaPngSha256 = '59f2f370298e3006feaff1b27a0e35dcc0c54999eb19b52276b0c6a5d5da9776'

const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')

const createSources = async (
  directory: string,
): Promise<{ readonly alphaPath: string; readonly y4mPath: string }> => {
  const y4mHeader = Buffer.from(
    `YUV4MPEG2 W${width} H${height} F1:1 Ip A1:1 C444 XYSCSS=444 XCOLORRANGE=FULL\nFRAME\n`,
  )
  const planes = Buffer.alloc(pixels * 3)
  const rgba = Buffer.alloc(pixels * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x
      const first = (x * 13 + y * 3 + ((x >> 4) ^ (y >> 3)) * 17) & 0xff
      const second = (x * 5 + y * 11 + (x >> 5) * (y >> 5)) & 0xff
      const third = (x * 7 + y * 19 + ((x ^ y) >> 2)) & 0xff
      planes[index] = first
      planes[pixels + index] = second
      planes[2 * pixels + index] = third
      const offset = index * 4
      rgba[offset] = first
      rgba[offset + 1] = second
      rgba[offset + 2] = third
      rgba[offset + 3] = (x * 9 + y * 5) & 0xff
    }
  }

  const y4m = Buffer.concat([y4mHeader, planes])
  if (sha256(y4m) !== sourceY4mSha256) throw new Error('AVIF memory Y4M source changed')
  const y4mPath = join(directory, 'source.y4m')
  await writeFile(y4mPath, y4m)

  const alphaPath = join(directory, 'alpha.png')
  const alphaPng = await sharp(rgba, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer()
  if (sha256(alphaPng) !== sourceAlphaPngSha256) {
    throw new Error('AVIF memory alpha PNG source changed')
  }
  await writeFile(alphaPath, alphaPng)
  return { alphaPath, y4mPath }
}

const encode = (args: readonly string[]): void => {
  const result = spawnSync('avifenc', args, { encoding: 'utf8', maxBuffer: 4 * 1_024 * 1_024 })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(
      `avifenc failed with status ${result.status ?? 'unknown'}: ${result.stderr.trim()}`,
    )
  }
}
const encodeWithFfmpeg = (args: readonly string[]): void => {
  const result = spawnSync('ffmpeg', args, { encoding: 'utf8', maxBuffer: 4 * 1_024 * 1_024 })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(
      `ffmpeg failed with status ${result.status ?? 'unknown'}: ${result.stderr.trim()}`,
    )
  }
}

const verifyFile = async (path: string, expectedSha256: string): Promise<void> => {
  const actual = sha256(await readFile(path))
  if (actual !== expectedSha256) throw new Error(`${path} checksum changed: ${actual}`)
}

export const prepareAvifMemoryCases = async (
  directory: string,
): Promise<readonly AvifMemoryCase[]> => {
  const { alphaPath, y4mPath } = await createSources(directory)
  const noFiltersPath = join(directory, 'no-filters.avif')
  const deblockPath = join(directory, 'deblock.avif')
  const alphaAvifPath = join(directory, 'alpha.avif')
  const gridPath = join(directory, 'grid.avif')

  const filtered10BitPath = join(directory, 'filtered-10bit.avif')
  const filtered12BitPath = join(directory, 'filtered-12bit.avif')
  encode([
    '-j',
    '1',
    '--tilecolslog2',
    '0',
    '--tilerowslog2',
    '0',
    '--lossless',
    '--cicp',
    '1/13/0',
    '-s',
    '6',
    y4mPath,
    noFiltersPath,
  ])
  encode([
    '-j',
    '1',
    '--tilecolslog2',
    '0',
    '--tilerowslog2',
    '0',
    '--cicp',
    '1/13/6',
    '-q',
    '60',
    '-s',
    '6',
    '-a',
    'enable-cdef=0',
    '-a',
    'enable-restoration=0',
    y4mPath,
    deblockPath,
  ])
  encode([
    '-j',
    '1',
    '--tilecolslog2',
    '0',
    '--tilerowslog2',
    '0',
    '--lossless',
    '--yuv',
    '444',
    '--cicp',
    '1/13/0',
    '-s',
    '6',
    alphaPath,
    alphaAvifPath,
  ])
  encode([
    '-j',
    '1',
    '--tilecolslog2',
    '0',
    '--tilerowslog2',
    '0',
    '--lossless',
    '--cicp',
    '1/13/0',
    '-s',
    '6',
    '-g',
    '2x2',
    y4mPath,
    gridPath,
  ])
  const foxPath = join(avifCorpusDirectory, 'fox.profile0.8bpc.yuv420.avif')
  for (const [bitDepth, quantizer, tune, outputPath] of [
    [10, 30, 0, filtered10BitPath],
    [12, 40, 1, filtered12BitPath],
  ] as const) {
    encodeWithFfmpeg([
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      foxPath,
      '-pix_fmt',
      `yuv420p${bitDepth}le`,
      '-c:v',
      'libaom-av1',
      '-still-picture',
      '1',
      '-usage',
      '0',
      '-tune',
      `${tune}`,
      '-cpu-used',
      '0',
      '-crf',
      `${quantizer}`,
      '-b:v',
      '0',
      '-color_primaries',
      'bt709',
      '-color_trc',
      'iec61966-2-1',
      '-colorspace',
      'bt709',
      '-frames:v',
      '1',
      outputPath,
    ])
  }

  const cases = [
    {
      scenario: 'no-filters',
      action: 'decode',
      path: noFiltersPath,
      fileSha256: 'd392ae9ba62e32c71008d50fc2582cabbc9c26254426e1b004ff09691665aa1c',
      expectedWidth: width,
      expectedHeight: height,
      expectedOutputSha256: 'e158dc7c6e2db7e951e0f9de989c9c16dbc852393c5a60068e508476972d2f42',
    },
    {
      scenario: 'deblock',
      action: 'decode',
      path: deblockPath,
      fileSha256: '7e6677f3986e2df05eeaf6573ac26b6b4d14f17adbd339a84d98e34e721b3412',
      expectedWidth: width,
      expectedHeight: height,
      expectedOutputSha256: '1836b434ab554a121af3a3604c01d44184bd8a564fe0e43305bfb5f986cc3a9e',
    },
    {
      scenario: 'cdef',
      action: 'decode',
      path: join(avifCorpusDirectory, 'kodim03_yuv420_8bpc.avif'),
      fileSha256: 'e69c973a3ddf635412c9a0c6cda66798102d0030303614873b337f658983ef5d',
      expectedWidth: 768,
      expectedHeight: 512,
      expectedOutputSha256: '47e9bd0a4f371bc44abd8afeb3d1e271c94b423bd60f3edff7761cfbdcbe2375',
    },
    {
      scenario: 'restoration',
      action: 'decode',
      path: join(avifCorpusDirectory, 'fox.profile0.8bpc.yuv420.avif'),
      fileSha256: 'a0ae1ad1aea81291730f42259593b297a8444699f4553de8dc25da2db56a40d9',
      expectedWidth: 1_204,
      expectedHeight: 800,
      expectedOutputSha256: 'cd94cd9d459af6338f77cf401749656b647f88b9e357c737a0a88c34584a46ec',
    },
    {
      scenario: 'filtered-4k-multitile',
      action: 'decode',
      path: join(avifCorpusDirectory, 'libavif-bounded-filtered-yuv420-3840x2160.avif'),
      fileSha256: 'b5ef6f6154a20dd4e6d4e76c01bd94ff2ab8ba415de0f5cbf00672e16de65258',
      expectedWidth: 3_840,
      expectedHeight: 2_160,
      expectedOutputSha256: 'fa0ee4c2f74aef92f77ce700eb60f001b6502db9c5d540b43bdddb59fdcc3880',
    },
    {
      scenario: 'film-grain',
      action: 'decode',
      path: join(avifCorpusDirectory, 'film-grain-test1-yuv420-64x48.avif'),
      fileSha256: 'd6c1d64166964bf1d2de06c779235e17d4b641d8679eb9d5481708a4e8c5ad1c',
      expectedWidth: 64,
      expectedHeight: 48,
      expectedOutputSha256: 'ceff8604f5dc42f3a16a67dc2b8afc56d3fe8674567353b82c2e8384f10835dd',
    },
    {
      scenario: 'gain-map-grid',
      action: 'decode',
      path: join(avifCorpusDirectory, 'libavif_color_grid_gainmap_different_grid.avif'),
      fileSha256: '73a68c3d6daad7b8298db975a00f02bca46b6c3f292eac09d3c1443d2006fab2',
      expectedWidth: 512,
      expectedHeight: 600,
      expectedOutputSha256: '4091bcc2b181c37e1b03bb6ec2b086b77516318b58cef4c75e8a8b5b0989f81e',
    },
    {
      scenario: 'alpha',
      action: 'decode',
      path: alphaAvifPath,
      fileSha256: '6068e225863992be528370a9a7c4a5cd2c0fc1347503754bba36525a31860a04',
      expectedWidth: width,
      expectedHeight: height,
      expectedOutputSha256: '07c6b21f6098eb19a7bb5cb4be6e42b23e7ea40019912e70f3ff194be23c5420',
    },
    {
      scenario: 'grid',
      action: 'decode',
      path: gridPath,
      fileSha256: 'ceb7fd33f6c4b0dd85c8a3930fd3c1033be8a6380b410bd27e2c6025da580aba',
      expectedWidth: width,
      expectedHeight: height,
      expectedOutputSha256: 'e158dc7c6e2db7e951e0f9de989c9c16dbc852393c5a60068e508476972d2f42',
    },
    {
      scenario: 'filtered-10bit',
      action: 'decode',
      path: filtered10BitPath,
      fileSha256: '65ee551beb70d52e08ca785e664e459bf96750173bf027df54d60b242fb25371',
      expectedWidth: 1_204,
      expectedHeight: 800,
      expectedOutputSha256: '3bbcbbc9ba2fb8de9b2c7d7a68ad8da8b4e044bd97170dd4fee5d5167ce747a0',
    },
    {
      scenario: 'filtered-10bit-downscale',
      action: 'downscale',
      path: filtered10BitPath,
      fileSha256: '65ee551beb70d52e08ca785e664e459bf96750173bf027df54d60b242fb25371',
      expectedWidth: 301,
      expectedHeight: 200,
      expectedOutputSha256: '5ca7ca9c254d6ae6f35456ded28434e077325acfd6356bb8e606e76fec116cdf',
    },
    {
      scenario: 'filtered-12bit',
      action: 'decode',
      path: filtered12BitPath,
      fileSha256: '01030070dd09c56787ffd20465e2677601716c9e94ff41b464ce07d0e0f821c7',
      expectedWidth: 1_204,
      expectedHeight: 800,
      expectedOutputSha256: '00753c1aeebfa86d5fea07031ad2b7635fac4fa36c0078655831dcb6e75791be',
    },
    {
      scenario: 'filtered-12bit-downscale',
      action: 'downscale',
      path: filtered12BitPath,
      fileSha256: '01030070dd09c56787ffd20465e2677601716c9e94ff41b464ce07d0e0f821c7',
      expectedWidth: 301,
      expectedHeight: 200,
      expectedOutputSha256: '49f822385bf70259a2d29dd9965f40413112e3531bd47e6302a6ecefdc67d516',
    },
    {
      scenario: 'downscale',
      action: 'downscale',
      path: join(avifCorpusDirectory, 'fox.profile0.8bpc.yuv420.avif'),
      fileSha256: 'a0ae1ad1aea81291730f42259593b297a8444699f4553de8dc25da2db56a40d9',
      expectedWidth: 256,
      expectedHeight: 170,
      expectedOutputSha256: 'ebf839411a85f21681ae0337788ac597b9ddb19ed799792b689c717c5f0c9ae2',
    },
  ] as const satisfies readonly AvifMemoryCase[]

  for (const fixture of cases) await verifyFile(fixture.path, fixture.fileSha256)
  return cases
}

export const avifMemoryEncoderVersion = (): string => {
  const result = spawnSync('avifenc', ['--version'], { encoding: 'utf8' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error('avifenc --version failed')
  return result.stdout.trim()
}

export const avifMemoryFfmpegVersion = (): string => {
  const result = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error('ffmpeg -version failed')
  return result.stdout.split('\n')[0]?.trim() ?? 'unknown'
}
