import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { gunzipSync } from 'node:zlib'
import { encodeJpegXlNative, openJpegXlSequence } from '../../src/jpegxl.ts'
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const binary = '.tmp/jpegxl-oracles/libjxl-v0.12.0/source/build-pinned/tools/djxl'
const oxide = '.tmp/jpegxl-oracles/jxl-oxide-c0cc4c7/target/release/jxl-oxide'
if (
  sha256(await readFile(binary)) !==
  '8da836ae132de221c53532a8296cc5b9e5f4bef16df4fcf4681f8b61ee4f3788'
)
  throw new Error('Pinned libjxl differs')
if (
  sha256(await readFile(oxide)) !==
  '34c23dfc712c42ac56546b41cb6dc89e199315ec7117a82028edc78b18812437'
)
  throw new Error('Pinned jxl-oxide differs')
const fixture = await readFile('tests/fixtures/jpegxl/m10-level10/cmyk-layers.jxl')
const sequence = await openJpegXlSequence(fixture)
let profile: Uint8Array | undefined
try {
  for await (const layer of sequence.layers()) {
    profile = layer.header.iccProfile
    break
  }
} finally {
  await sequence.close()
}
if (!profile) throw new Error('Missing profile')
const width = 1025,
  height = 1027
const gray = Uint8Array.from({ length: width * height }, (_, i) => i & 255)
const alpha = Uint16Array.from(
  { length: Math.ceil(width / 2) * Math.ceil(height / 2) },
  (_, i) => (i * 37) & 1023,
)
const black = Uint8Array.from(
  { length: Math.ceil(width / 4) * Math.ceil(height / 4) },
  (_, i) => (i * 19) & 255,
)
const depth = Uint16Array.from({ length: Math.ceil(width / 8) * Math.ceil(height / 8) }, (_, i) =>
  i % 3 === 0 ? 0x8000 : i % 3 === 1 ? 1 : 0x3c00,
)
const encoded = await encodeJpegXlNative({
  width,
  height,
  color: [
    { data: gray, bitDepth: 8 },
    { data: gray, bitDepth: 8 },
    { data: gray, bitDepth: 8 },
  ],
  iccProfile: profile,
  extraChannels: [
    { type: 0, data: alpha, bitDepth: 10, dimShift: 1, associatedAlpha: true },
    { type: 4, data: black, bitDepth: 8, dimShift: 2 },
    { type: 1, data: depth, bitDepth: 16, sampleFormat: 'binary16', dimShift: 3 },
  ],
})
await mkdir('.tmp/jpegxl-practical', { recursive: true })
await writeFile('.tmp/jpegxl-practical/shifted-native.jxl', encoded)
if (sha256(encoded) !== '79f54be4d42fe153428bfc95645ea5f787c07daf637f4268320f77f285cbf6b6')
  throw new Error('Shifted native encoded bytes changed from the independent oracle input')
const nativeReferences = [
  {
    name: 'alpha',
    source: alpha,
    bits: 10,
    hash: '8134cbd6db6711c8424f9eea87babca13e64714ef565b6621db140cd1fbcfeff',
  },
  {
    name: 'black',
    source: black,
    bits: 8,
    hash: '02e4037e9ab2f17bb6dccd269b5ca175146e58c6e75f8dc1132907f16913dfda',
  },
  {
    name: 'depth',
    source: depth,
    bits: 16,
    hash: '2f0810a233839bb41217a3843f099d27507db7faa89ccc37a378bd719126c608',
  },
] as const
for (const reference of nativeReferences) {
  const raw = gunzipSync(
    await readFile(`tests/fixtures/jpegxl/practical-shifted-native/${reference.name}.i32le.gz`),
  )
  if (sha256(raw) !== reference.hash || raw.byteLength !== reference.source.length * 4)
    throw new Error(`Pinned independent ${reference.name} grid changed`)
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
  const mask = 2 ** reference.bits - 1
  for (let index = 0; index < reference.source.length; index++) {
    if ((view.getInt32(index * 4, true) & mask) !== reference.source[index])
      throw new Error(`Independent ${reference.name} grid differs at native sample ${index}`)
  }
}
const encodePeakRssKb = process.resourceUsage().maxRSS
execFileSync(
  binary,
  [
    '.tmp/jpegxl-practical/shifted-native.jxl',
    '.tmp/jpegxl-practical/shifted-native.pfm',
    '--no_coalescing',
    '--output_frames',
    '--output_extra_channels',
    '--num_threads=1',
  ],
  { stdio: 'inherit', timeout: 120000 },
)

const expected = [
  'bf3f7144ed4a419eb70b1595598d48fa02fb82f39501f5b16de52b4f733d9ff9',
  '5a00bbea575eaeb8a378ecb1233ede2145ec2da8e818a7548e8a9ae53781db6c',
  '3a1e35312af62e531fed4be12b837185fb0685e436faa923a4090215a00b8598',
  '48cfc3a4ce0f32c1bab62223a18be93d1755630144fbadc83a7bf8b17a79e315',
]
const decoded = await Promise.all(
  [
    '.tmp/jpegxl-practical/shifted-native.pfm',
    '.tmp/jpegxl-practical/shifted-native.pfm-ec1.pfm',
    '.tmp/jpegxl-practical/shifted-native.pfm-ec2.pfm',
    '.tmp/jpegxl-practical/shifted-native.pfm-ec3.pfm',
  ].map((path) => readFile(path)),
)
for (let index = 0; index < decoded.length; index++) {
  if (sha256(decoded[index] ?? new Uint8Array()) !== expected[index])
    throw new Error(`Pinned libjxl decoded plane ${index} differs`)
}
const info = execFileSync(oxide, ['info', '.tmp/jpegxl-practical/shifted-native.jxl'], {
  encoding: 'utf8',
  timeout: 120_000,
})
for (const marker of [
  'Image dimension: 1025x1027',
  'Alpha (premultiplied)',
  '2x downsampled',
  '4x downsampled',
  '8x downsampled',
  'floating-point, 10 mantissa bits',
])
  if (!info.includes(marker)) throw new Error(`Pinned jxl-oxide omitted ${marker}`)
process.stdout.write(
  `${JSON.stringify({
    encodedBytes: encoded.byteLength,
    encodedSha256: sha256(encoded),
    libjxlDecodedSha256: expected,
    nativeGridSha256: nativeReferences.map(({ hash }) => hash),
    encodePeakRssKb,
    jxlOxideLayout: '1025x1027; alpha x2, black x4, binary16 depth x8',
  })}\n`,
)
