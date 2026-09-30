/** First-party native rasters with independent LittleCMS sRGB display references. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { encodeJpegXlNative } from '../../src/jpegxl.ts'
import { rgbLutOnlyProfile } from '../../tests/icc-fixtures.ts'

const root = resolve('tests/fixtures/jpegxl/profile-pipeline')
const work = resolve('.tmp/jpegxl-profile-pipeline-fixtures')
await mkdir(root, { recursive: true })
await mkdir(work, { recursive: true })
const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const grayPath = 'tests/fixtures/jpegxl/m8-native/gray.icc'
const rgbPath = 'tests/fixtures/jpegxl/m4-color/oriented-icc.icc'
const gray = new Uint8Array(await readFile(grayPath))
const rgb = new Uint8Array(await readFile(rgbPath))
const lut = rgbLutOnlyProfile()
await writeFile(`${root}/rgb-mab.icc`, lut)
const fixtures: {
  id: string
  width: number
  height: number
  format: 'gray16' | 'rgb16' | 'rgba16' | 'rgba8'
  depth: number
  alphaDepth: number
  associated: boolean
  profileSha256: string
  sha256: string
  referenceSha256: string
  colorTolerance: number
}[] = []
for (const definition of [
  { id: 'gray8-alpha8', gray: true, depth: 8, alphaDepth: 8 },
  { id: 'gray10-alpha16', gray: true, depth: 10, alphaDepth: 16 },
  { id: 'gray12-alpha12-associated', gray: true, depth: 12, alphaDepth: 12, associated: true },
  { id: 'gray16-adjacent', gray: true, depth: 16, alphaDepth: 0 },
  { id: 'gray8-alpha16', gray: true, depth: 8, alphaDepth: 16 },
  { id: 'rgb16', gray: false, depth: 16, alphaDepth: 0 },
  { id: 'rgb16-alpha8', gray: false, depth: 16, alphaDepth: 8 },
  { id: 'rgb12-alpha16-associated', gray: false, depth: 12, alphaDepth: 16, associated: true },
  { id: 'rgb16-mab', gray: false, depth: 16, alphaDepth: 0, lut: true },
  { id: 'gray10-alpha8-grouped', gray: true, depth: 10, alphaDepth: 8, grouped: true },
  { id: 'rgb12-alpha16-grouped', gray: false, depth: 12, alphaDepth: 16, grouped: true },
  {
    id: 'gray12-alpha8-shift1-associated',
    gray: true,
    depth: 12,
    alphaDepth: 8,
    grouped: true,
    shift: 1,
    associated: true,
  },
] as const) {
  const grouped = 'grouped' in definition && definition.grouped
  const associated = 'associated' in definition && definition.associated
  const shift = 'shift' in definition ? definition.shift : 0
  const isLut = 'lut' in definition && definition.lut
  const width = grouped ? 1025 : 4
  const height = grouped ? 3 : 1
  const pixels = width * height
  const colorChannels = definition.gray ? 1 : 3
  const profile = isLut ? lut : definition.gray ? gray : rgb
  const profilePath = isLut ? `${root}/rgb-mab.icc` : definition.gray ? grayPath : rgbPath
  const maximum = 2 ** definition.depth - 1
  const alphaMaximum = 2 ** definition.alphaDepth - 1
  const color = Array.from({ length: colorChannels }, (_, c) => ({
    bitDepth: definition.depth,
    data: Uint16Array.from({ length: pixels }, (_, index) => {
      if (definition.id === 'gray16-adjacent') return [16400, 16402, 32768, 65535][index] ?? 0
      if (definition.id === 'gray12-alpha12-associated') return [1024, 0, 4095, 512][index] ?? 0
      const value = grouped
        ? ((index * (11 + c * 7)) % (maximum + 1)) / maximum
        : ([
            [0, 0.25, 0.5, 1],
            [1, 0.5, 0.25, 0],
            [0, 0.125, 0.5, 1],
          ][c]?.[index] ?? 0)
      const alpha = shift ? 128 / 255 : ([1, 0.5, 0, 1][index % 4] ?? 1)
      return Math.round(value * (associated ? alpha : 1) * maximum)
    }),
  }))
  const alphaSamples = definition.alphaDepth
    ? Uint16Array.from(
        { length: Math.ceil(width / 2 ** shift) * Math.ceil(height / 2 ** shift) },
        (_, index) =>
          shift
            ? 128
            : definition.id === 'gray12-alpha12-associated'
              ? ([2048, 0, 4095, 2048][index] ?? 0)
              : Math.round(([1, 0.5, 0, 1][index % 4] ?? 1) * alphaMaximum),
      )
    : undefined
  const [first, second, third] = color
  if (!first || (!definition.gray && (!second || !third)))
    throw new Error('Missing generated color planes')
  const colorPlanes = definition.gray
    ? ([first] as const)
    : second && third
      ? ([first, second, third] as const)
      : undefined
  if (!colorPlanes) throw new Error('Missing generated RGB planes')
  const encoded = await encodeJpegXlNative({
    width,
    height,
    color: colorPlanes,
    ...(alphaSamples
      ? {
          extraChannels: [
            {
              type: 0,
              data: alphaSamples,
              bitDepth: definition.alphaDepth,
              dimShift: shift,
              associatedAlpha: associated,
            },
          ],
        }
      : {}),
    iccProfile: profile,
  })
  const high = Math.max(definition.depth, definition.alphaDepth) > 8
  const channels = alphaSamples ? 4 : colorChannels
  const format = alphaSamples ? (high ? 'rgba16' : 'rgba8') : definition.gray ? 'gray16' : 'rgb16'
  const outputMaximum = high ? 65535 : 255
  const input = Uint16Array.from({ length: pixels * colorChannels }, (_, sample) => {
    const index = Math.floor(sample / colorChannels)
    const alpha = alphaSamples ? (alphaSamples[shift ? 0 : index] ?? 0) / alphaMaximum : 1
    const value = color[sample % colorChannels]?.data[index] ?? 0
    return Math.round(
      Math.max(
        0,
        Math.min(1, associated ? (alpha === 0 ? 0 : value / maximum / alpha) : value / maximum),
      ) * 65535,
    )
  })
  const inputPath = `${work}/${definition.id}.input.bin`
  const outputPath = `${work}/${definition.id}.output.bin`
  await writeFile(inputPath, new Uint8Array(input.buffer))
  execFileSync(
    'bun',
    [
      'benchmark/jpegxl/littlecms-profile-oracle.ts',
      profilePath,
      inputPath,
      outputPath,
      String(colorChannels),
      high ? '16' : '8',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )
  const raw = new Uint8Array(await readFile(outputPath))
  const samples = high ? new Uint16Array(raw.buffer) : raw
  if (samples.length !== pixels * 3)
    throw new Error(`Invalid independent color output for ${definition.id}`)
  const reference = new Uint8Array(pixels * channels * (high ? 2 : 1))
  const view = new DataView(reference.buffer)
  for (let index = 0; index < pixels; index++) {
    const alpha = alphaSamples ? (alphaSamples[shift ? 0 : index] ?? 0) / alphaMaximum : 1
    for (let c = 0; c < channels; c++) {
      const sample =
        c === 3
          ? Math.round(alpha * outputMaximum)
          : associated && alpha === 0
            ? 0
            : (samples[index * 3 + (channels === 1 ? 0 : c)] ?? 0)
      const offset = (index * channels + c) * (high ? 2 : 1)
      if (high) view.setUint16(offset, sample, false)
      else reference[offset] = sample
    }
  }
  await writeFile(`${root}/${definition.id}.jxl`, encoded)
  await writeFile(`${root}/${definition.id}.bin.gz`, gzipSync(reference))
  fixtures.push({
    id: definition.id,
    width,
    height,
    format,
    depth: definition.depth,
    alphaDepth: definition.alphaDepth,
    associated,
    profileSha256: digest(profile),
    sha256: digest(encoded),
    referenceSha256: digest(reference),
    // Sampled gray curves round their linear result in LittleCMS. The largest
    // sRGB slope is 12.92, so half a linear UInt16 step plus output rounding
    // needs at most eight output levels. The small gray probes stay within one.
    colorTolerance: isLut ? 1300 : definition.gray ? (grouped ? 8 : 1) : 180,
  })
}
await writeFile(
  `${root}/manifest.json`,
  `${JSON.stringify({ schemaVersion: 1, encoder: 'PureJsImage first-party lossless native writer; analytical inputs', oracle: 'LittleCMS 2.17 C API; perceptual intent, unsigned 16-bit color input and floating sRGB output with final 8/16-bit rounding, NOOPTIMIZE; normalized source and straightened associated values rounded to 16-bit once', librarySha256: digest(await readFile('/usr/lib/x86_64-linux-gnu/liblcms2.so.2')), fixtures }, null, 2)}\n`,
)
console.log(`Generated ${fixtures.length} independent ICC pipeline references`)
