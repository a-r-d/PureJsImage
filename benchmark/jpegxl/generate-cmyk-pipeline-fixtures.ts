/** First-party native inputs, independently evaluated by pinned LittleCMS. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import {
  encodeJpegXlNative,
  type JpegXlNativeExtraInput,
  openJpegXlSequence,
} from '../../src/jpegxl.ts'

const root = resolve('tests/fixtures/jpegxl/cmyk-pipeline')
const work = resolve('.tmp/jpegxl-cmyk-pipeline-fixtures')
await mkdir(root, { recursive: true })
await mkdir(work, { recursive: true })
const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const sequence = await openJpegXlSequence(
  new Uint8Array(await readFile('tests/fixtures/jpegxl/m10-level10/cmyk-layers.jxl')),
)
let profile: Uint8Array | undefined
try {
  for await (const layer of sequence.layers()) {
    profile = layer.header.iccProfile
    break
  }
} finally {
  await sequence.close()
}
if (
  !profile ||
  hash(profile) !== '4855b8fabb96bdc6495d45d089bb8c8efb1ae18389e0dc9e75a5f701a9c0b662'
)
  throw new Error('Pinned CMYK profile differs')
await writeFile(`${root}/source.icc`, profile)
const fixtures: {
  id: string
  width: number
  height: number
  format: string
  depth: number
  alphaDepth: number
  associated: boolean
  colorTolerance: number
  sha256: string
  referenceSha256: string
}[] = []
for (const definition of [
  { id: 'cmyk8', depth: 8, alpha: false },
  { id: 'cmyk10-alpha8', depth: 10, alpha: true },
  { id: 'cmyk12-associated-alpha32', depth: 12, alpha: true, associated: true, floating: true },
  { id: 'cmyk16-alpha16', depth: 16, alpha: true, highAlpha: true },
  { id: 'cmyk16-shifted-grouped', depth: 16, alpha: true, shifted: true },
] as const) {
  const shifted = 'shifted' in definition
  const associated = 'associated' in definition
  const floating = 'floating' in definition
  const alphaDepth = definition.alpha ? (floating ? 32 : 'highAlpha' in definition ? 16 : 8) : 0
  const width = shifted ? 1025 : 4,
    height = shifted ? 3 : 1,
    pixels = width * height
  const maximum = 2 ** definition.depth - 1
  const coverages = Array.from({ length: pixels }, (_, index) =>
    definition.alpha ? (shifted ? 128 / 255 : ([1, 0.5, 0, 1][index % 4] ?? 1)) : 1,
  )
  const alphaMaximum = 2 ** alphaDepth - 1
  if (!floating && definition.alpha)
    for (let index = 0; index < pixels; index++)
      coverages[index] = Math.round((coverages[index] ?? 0) * alphaMaximum) / alphaMaximum
  const color = Array.from({ length: 3 }, (_, channel) => ({
    bitDepth: definition.depth,
    data: Uint16Array.from({ length: pixels }, (_, index) =>
      Math.round(
        (shifted
          ? ((index * (7 + channel * 13)) % (maximum + 1)) / maximum
          : ([1, 0.5, 0.25, 0][(index + channel) % 4] ?? 0)) *
          (associated ? (coverages[index] ?? 1) : 1) *
          maximum,
      ),
    ),
  }))
  const [first, second, third] = color
  if (!first || !second || !third) throw new Error('Missing CMYK colors')
  const factor = shifted ? 2 : 1
  const blackValues = Uint16Array.from(
    { length: Math.ceil(width / factor) * Math.ceil(height / factor) },
    (_, index) =>
      Math.round(
        (shifted ? 0.5 : ([1, 0.5, 0.25, 0][index % 4] ?? 0)) *
          (associated ? (coverages[index] ?? 1) : 1) *
          maximum,
      ),
  )
  const extras: JpegXlNativeExtraInput[] = [
    { type: 4, bitDepth: definition.depth, data: blackValues, dimShift: shifted ? 1 : 0 },
  ]
  if (definition.alpha) {
    const alphaData = floating
      ? new Uint32Array(Float32Array.from(coverages).buffer)
      : Uint16Array.from(
          { length: Math.ceil(width / factor) * Math.ceil(height / factor) },
          (_, index) => Math.round((coverages[index] ?? 0) * alphaMaximum),
        )
    extras.push({
      type: 0,
      bitDepth: alphaDepth,
      data: alphaData,
      associatedAlpha: associated,
      dimShift: shifted ? 1 : 0,
      ...(floating ? { sampleFormat: 'binary32' } : {}),
    })
  }
  const encoded = await encodeJpegXlNative({
    width,
    height,
    color: [first, second, third],
    extraChannels: extras,
    iccProfile: profile,
  })
  await writeFile(`${root}/${definition.id}.jxl`, encoded)
  const input = Uint16Array.from({ length: pixels * 4 }, (_, sample) => {
    const pixel = Math.floor(sample / 4),
      channel = sample % 4
    const coverage = associated ? (coverages[pixel] ?? 1) : 1
    const value =
      channel === 3 ? (blackValues[shifted ? 0 : pixel] ?? 0) : (color[channel]?.data[pixel] ?? 0)
    return coverage <= 0
      ? 0
      : 65535 - Math.round(Math.max(0, Math.min(1, value / maximum / coverage)) * 65535)
  })
  await writeFile(`${work}/input.bin`, new Uint8Array(input.buffer))
  const high = definition.depth > 8 || alphaDepth > 8
  execFileSync(
    'bun',
    [
      'benchmark/jpegxl/littlecms-profile-oracle.ts',
      `${root}/source.icc`,
      `${work}/input.bin`,
      `${work}/output.bin`,
      '4',
      high ? '16' : '8',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )
  const raw = new Uint8Array(await readFile(`${work}/output.bin`))
  const colors = high ? new Uint16Array(raw.buffer) : raw
  const channels = definition.alpha ? 4 : 3,
    bytes = high ? 2 : 1,
    storageMax = high ? 65535 : 255
  const reference = new Uint8Array(pixels * channels * bytes),
    view = new DataView(reference.buffer)
  for (let pixel = 0; pixel < pixels; pixel++)
    for (let channel = 0; channel < channels; channel++) {
      const value =
        channel === 3
          ? Math.round((coverages[pixel] ?? 1) * storageMax)
          : associated && (coverages[pixel] ?? 1) <= 0
            ? 0
            : (colors[pixel * 3 + channel] ?? 0)
      const offset = (pixel * channels + channel) * bytes
      if (high) view.setUint16(offset, value, false)
      else reference[offset] = value
    }
  await writeFile(`${root}/${definition.id}.bin.gz`, gzipSync(reference))
  fixtures.push({
    id: definition.id,
    width,
    height,
    format: definition.alpha ? (high ? 'rgba16' : 'rgba8') : high ? 'rgb16' : 'rgb8',
    depth: definition.depth,
    alphaDepth,
    associated,
    colorTolerance: high ? 350 : 2,
    sha256: hash(encoded),
    referenceSha256: hash(reference),
  })
}
await writeFile(
  `${root}/manifest.json`,
  `${JSON.stringify({ oracle: 'LittleCMS 2.17 perceptual A2B0 to sRGB; NOOPTIMIZE, UInt16 CMYK input and float output; native complements and associated samples normalized before one UInt16 rounding. Shifted extra channels are constant.', profileSha256: hash(profile), littlecmsSha256: hash(new Uint8Array(await readFile('/usr/lib/x86_64-linux-gnu/liblcms2.so.2'))), fixtures }, null, 2)}\n`,
)
await rm(work, { recursive: true })
