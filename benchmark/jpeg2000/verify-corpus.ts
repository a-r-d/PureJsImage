import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { PNG } from 'pngjs'

import { jpeg2000Codec } from '../../src/codecs/jpeg2000.ts'
import { pngCodec } from '../../src/codecs/png.ts'
import { createNodeImageLibrary } from '../../src/node-image.ts'

interface FixtureExpectation {
  readonly file: string
  readonly sha256: string
  readonly width: number
  readonly height: number
  readonly colorSpace: string
  readonly lossless: boolean
  readonly decodedSha256: string
}

const fixtures: readonly FixtureExpectation[] = [
  {
    file: 'wikimedia-blue-marble-openjpeg-lossless.jp2',
    sha256: 'b17a99f8c9b7ab6488c194ad198bc0adb10b9e2d310eea50c3503e2479439e59',
    width: 1920,
    height: 2172,
    colorSpace: 'sRGB',
    lossless: true,
    decodedSha256: 'd1deb6262448744f261a0af66eace0ab978d42a889ed754cc8413646ce98fba9',
  },
  {
    file: 'loc-court-day-openjpeg-lossless.jp2',
    sha256: '646efb9734b2181ce8737d99950cdf3620eb74c26f2149188955606e3705eafd',
    width: 1024,
    height: 792,
    colorSpace: 'gray',
    lossless: true,
    decodedSha256: '9bf92b6c54737de32ca28d9f2b069aed166f3289fc5ca4090e23206868a41991',
  },
  {
    file: 'openjpeg-lossless-rgb16.jp2',
    sha256: '3830c368b81d0de7a72e7379e139b204b74b5c4226efa6540749fde32d166825',
    width: 17,
    height: 13,
    colorSpace: 'sRGB',
    lossless: true,
    decodedSha256: '4750925af7e10c4b3ec572ee014ddf8a4995d5bea92e06a8d6e7d91ec4568acc',
  },
  {
    file: 'ffmpeg-lossy-rgb8.jp2',
    sha256: '8d3a0b9016d2b84b3777ccdebdc02fe3b42211aabcdd87278c03eddff4e19345',
    width: 32,
    height: 24,
    colorSpace: 'sRGB',
    lossless: false,
    decodedSha256: '7792ee3edf547133b1568d9adb25410723b9e3de0f4576e9d8507114e4868c16',
  },
  {
    file: 'ffmpeg-lossy-rlcp-rgb8.jp2',
    sha256: '441453a2c505f2e4e77783a84616be4b25ea01a1798bee58204919025efdf4e2',
    width: 32,
    height: 24,
    colorSpace: 'sRGB',
    lossless: false,
    decodedSha256: '7792ee3edf547133b1568d9adb25410723b9e3de0f4576e9d8507114e4868c16',
  },
  {
    file: 'ffmpeg-lossy-rpcl-rgb8.jp2',
    sha256: 'a9ee50a00112074e74ea887a0746885de5cd78be7548622c4773e95ccb703f11',
    width: 32,
    height: 24,
    colorSpace: 'sRGB',
    lossless: false,
    decodedSha256: '7792ee3edf547133b1568d9adb25410723b9e3de0f4576e9d8507114e4868c16',
  },
  {
    file: 'ffmpeg-lossy-pcrl-rgb8.jp2',
    sha256: '06db5df3a19389b51d8ec3dd89c970e042607916d03d3f1f2f2a9f48da2bb319',
    width: 32,
    height: 24,
    colorSpace: 'sRGB',
    lossless: false,
    decodedSha256: '7792ee3edf547133b1568d9adb25410723b9e3de0f4576e9d8507114e4868c16',
  },
  {
    file: 'ffmpeg-lossy-cprl-rgb8.jp2',
    sha256: 'b46360e5c4fc3b7f2088ec633f929d8ac6dce578290c625d7fb0d66d7d5e5793',
    width: 32,
    height: 24,
    colorSpace: 'sRGB',
    lossless: false,
    decodedSha256: '7792ee3edf547133b1568d9adb25410723b9e3de0f4576e9d8507114e4868c16',
  },
  {
    file: 'ffmpeg-lossy-tiled-rgb8.jp2',
    sha256: '0719570d2963c25dcf3932d717abcc485bfc39555785fc9b3b68ae9e4eb7711e',
    width: 40,
    height: 30,
    colorSpace: 'sRGB',
    lossless: false,
    decodedSha256: '2e2ffdb4441ece4c1704efed99a0a44a54162314215ef09c216a435019f1cde9',
  },
  {
    file: 'openjpeg-reversible-rgb16.jp2',
    sha256: '21095e4faf1c3ad35594b2a709e4f5f01b2f6981316f96dd4fbbbaae53336a6e',
    width: 19,
    height: 11,
    colorSpace: 'sRGB',
    lossless: true,
    decodedSha256: '1caffb955b68341ee2341acbd77d4c9d20e97f98cfee7f8da4bd37bf74c03637',
  },
  {
    file: 'openjpeg-lossless-gray16.jp2',
    sha256: 'cb104ec9c3ecbcab4e7310c9bb9010fc28fed5a23d4c4dd5bafcf07a9ea46260',
    width: 9,
    height: 7,
    colorSpace: 'gray',
    lossless: true,
    decodedSha256: 'd83f32b2b944fc2e7f897e8f5bbbd364dd38364250311dbaa53ba69f639e9f83',
  },
]

const library = createNodeImageLibrary([jpeg2000Codec, pngCodec])

for (const fixture of fixtures) {
  const path = `benchmark/corpus/files/jp2/${fixture.file}`
  const input = await readFile(path)
  const checksum = createHash('sha256').update(input).digest('hex')
  if (checksum !== fixture.sha256) throw new Error(`${fixture.file}: checksum mismatch`)
  const image = await library.open(input)
  const metadata = await image.metadata()
  if (
    metadata.width !== fixture.width ||
    metadata.height !== fixture.height ||
    metadata.colorSpace !== fixture.colorSpace ||
    (fixture.lossless ? metadata.lossless === false : metadata.lossless !== false)
  ) {
    throw new Error(`${fixture.file}: metadata mismatch`)
  }
  const decoded = PNG.sync.read(await image.png().toBuffer())
  if (decoded.width !== fixture.width || decoded.height !== fixture.height) {
    throw new Error(`${fixture.file}: decoded dimensions mismatch`)
  }
  const decodedChecksum = createHash('sha256').update(decoded.data).digest('hex')
  if (decodedChecksum !== fixture.decodedSha256) {
    throw new Error(`${fixture.file}: decoded pixel checksum mismatch`)
  }
  console.log(
    `${fixture.file}: ${metadata.width}x${metadata.height} ${metadata.colorSpace} ${
      metadata.lossless === false ? 'lossy' : fixture.lossless ? 'reversible' : 'lossy'
    } ok`,
  )
}
