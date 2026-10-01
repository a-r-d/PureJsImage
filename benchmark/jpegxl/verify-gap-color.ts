import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createImageLibrary } from '../../src/browser.ts'
import { jpegxlCodec } from '../../src/codecs/jpegxl.ts'
import type { PixelColorSemantics } from '../../src/color.ts'
import { encodeJpegXlNative, inspectJpegXl } from '../../src/jpegxl.ts'
import { Uint8ArraySink } from '../../src/sink.ts'
import {
  encodeGapAnimation,
  gapDecoder,
  gapSemantics,
} from '../../tests/helpers/jpegxl-gap-completion.ts'
import { collectJpegXlProfileRows } from '../../tests/helpers/jpegxl-profile-pipeline.ts'
import { rgbLegacyLutProfile } from '../../tests/icc-fixtures.ts'

const root = '.tmp/jpegxl-gap-color-oracle'
await mkdir(root, { recursive: true })
const hash = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null
const results: {
  id: string
  inputSha256: string
  maximumError: number
  tolerance: number
  oracle: string
}[] = []
const independent = async (
  id: string,
  input: Uint8Array,
  mode: 'linear-float32' | 'native-planes-float32',
): Promise<Uint8Array> => {
  const directory = `${root}/${id}`
  await mkdir(directory, { recursive: true })
  await writeFile(`${directory}/input.jxl`, input)
  execFileSync(
    'bun',
    ['benchmark/jpegxl/flush-progressive-oracle.ts', `${directory}/input.jxl`, directory, mode],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )
  const metadata: unknown = JSON.parse(await readFile(`${directory}/manifest.json`, 'utf8'))
  if (!record(metadata) || !Array.isArray(metadata.stages)) throw new Error('Invalid oracle stages')
  const last: unknown = metadata.stages.at(-1)
  if (!record(last) || typeof last.file !== 'string') throw new Error('Invalid oracle frame')
  return new Uint8Array(await readFile(`${directory}/${last.file}`))
}
const compare = (
  id: string,
  input: Uint8Array,
  own: Uint8Array,
  expected: Uint8Array,
  tolerance: number,
  scale = 1,
): void => {
  if (own.length !== expected.length)
    throw new Error(`${id}: size differs ${own.length}/${expected.length}`)
  const a = new DataView(own.buffer),
    b = new DataView(expected.buffer)
  let maximumError = 0
  for (let offset = 0; offset < own.length; offset += 4)
    maximumError = Math.max(
      maximumError,
      Math.abs(a.getFloat32(offset, false) / scale - b.getFloat32(offset, false)),
    )
  if (!Number.isFinite(maximumError) || maximumError > tolerance)
    throw new Error(`${id}: independent difference ${maximumError}`)
  results.push({
    id,
    inputSha256: hash(input),
    maximumError,
    tolerance,
    oracle: 'Pinned libjxl 0.12.0',
  })
}
for (const [bits, exponent, one, sign] of [
  [24, 8, 0x3f8000, 0x800000],
  [16, 4, 0x3800, 0x8000],
] as const) {
  const input = await encodeJpegXlNative({
    width: 4,
    height: 1,
    color: [
      {
        data: Uint32Array.of(sign, 1, one, sign + one),
        bitDepth: bits,
        exponentBits: exponent,
        sampleFormat: 'floating-point',
      },
    ],
  })
  compare(
    `custom-float-${bits}-${exponent}`,
    input,
    await collectJpegXlProfileRows(await gapDecoder(input)),
    await independent(`custom-float-${bits}-${exponent}`, input, 'native-planes-float32'),
    0,
  )
}
for (const precision of [1, 2] as const) {
  const id = `icc-lut${precision * 8}`,
    directory = `${root}/${id}`
  await mkdir(directory, { recursive: true })
  const profile = rgbLegacyLutProfile(precision),
    values = Float32Array.of(0, 0.1, 0.7, 0.25, 0.8, 0.5, 0.9, 0.05, 0.4, 1, 1, 1)
  const source = new Uint8Array(values.buffer)
  await writeFile(`${directory}/source.icc`, profile)
  await writeFile(`${directory}/source.bin`, source)
  execFileSync(
    'bun',
    [
      'benchmark/jpegxl/littlecms-profile-oracle.ts',
      `${directory}/source.icc`,
      `${directory}/source.bin`,
      `${directory}/expected.bin`,
      '3',
      '16',
      'float32',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )
  const planes = Array.from({ length: 3 }, (_, channel) => ({
    data: new Uint32Array(
      Float32Array.from({ length: 4 }, (_, pixel) => values[pixel * 3 + channel] ?? 0).buffer,
    ),
    bitDepth: 32,
    sampleFormat: 'binary32' as const,
  }))
  const a = planes[0],
    b = planes[1],
    c = planes[2]
  if (!a || !b || !c) throw new Error('Missing source planes')
  const input = await encodeJpegXlNative({
    width: 4,
    height: 1,
    color: [a, b, c],
    iccProfile: profile,
  })
  const actual = new DataView(
    (await collectJpegXlProfileRows(await gapDecoder(input, { colorOutput: 'srgb' }))).buffer,
  )
  const expected = new DataView(new Uint8Array(await readFile(`${directory}/expected.bin`)).buffer)
  let maximumError = 0
  for (let offset = 0; offset < actual.byteLength; offset += 2)
    maximumError = Math.max(
      maximumError,
      Math.abs(actual.getUint16(offset, false) - expected.getUint16(offset, true)),
    )
  if (maximumError > 16) throw new Error(`${id}: LittleCMS difference ${maximumError}`)
  results.push({
    id,
    inputSha256: hash(input),
    maximumError,
    tolerance: 16,
    oracle: 'LittleCMS 2.17 float source and float64 output',
  })
}
for (const depth of [24, 31, 32] as const) {
  const id = `cmyk-${depth}-float-black`,
    directory = `${root}/${id}`
  await mkdir(directory, { recursive: true })
  const profile = new Uint8Array(await readFile('tests/fixtures/jpegxl/cmyk-pipeline/source.icc'))
  const maximum = 2 ** depth - 1
  const values = [
    Float32Array.of(0, 0.1, 0.2, 0.5),
    Float32Array.of(0.5, 0.4, 0.1, 0),
    Float32Array.of(0.1, 0.2, 0.3, 0.4),
  ]
  const planes = values.map((samples) => ({
    data:
      depth === 32
        ? new Uint32Array(samples.buffer)
        : Uint32Array.from(samples, (v) => Math.round(v * maximum)),
    bitDepth: depth,
    ...(depth === 32 ? { sampleFormat: 'binary32' as const } : {}),
  }))
  const c = planes[0],
    m = planes[1],
    y = planes[2]
  if (!c || !m || !y) throw new Error('Missing CMYK planes')
  const black = Float32Array.of(0.2, 0.3, 0.1, 0.4),
    alpha = Float32Array.of(0.5, 0.5, 0.5, 0.5)
  const input = await encodeJpegXlNative({
    width: 4,
    height: 1,
    color: [c, m, y],
    iccProfile: profile,
    extraChannels: [
      { type: 4, data: new Uint32Array(black.buffer), bitDepth: 32, sampleFormat: 'binary32' },
      {
        type: 0,
        data: new Uint32Array(alpha.buffer),
        bitDepth: 32,
        sampleFormat: 'binary32',
        associatedAlpha: true,
      },
    ],
  })
  const ink = new Uint16Array(16)
  for (let pixel = 0; pixel < 4; pixel++)
    for (let channel = 0; channel < 4; channel++) {
      const sample =
        channel === 3
          ? (black[pixel] ?? 0)
          : depth === 32
            ? (values[channel]?.[pixel] ?? 0)
            : (planes[channel]?.data[pixel] ?? 0) / maximum
      ink[pixel * 4 + channel] =
        65535 - Math.round(Math.max(0, Math.min(1, sample / (alpha[pixel] ?? 1))) * 65535)
    }
  await writeFile(`${directory}/source.icc`, profile)
  await writeFile(`${directory}/source.bin`, new Uint8Array(ink.buffer))
  execFileSync(
    'bun',
    [
      'benchmark/jpegxl/littlecms-profile-oracle.ts',
      `${directory}/source.icc`,
      `${directory}/source.bin`,
      `${directory}/expected.bin`,
      '4',
      '16',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )
  const actual = new DataView((await collectJpegXlProfileRows(await gapDecoder(input))).buffer)
  const expected = new DataView(new Uint8Array(await readFile(`${directory}/expected.bin`)).buffer)
  let maximumError = 0
  for (let pixel = 0; pixel < 4; pixel++) {
    for (let channel = 0; channel < 3; channel++)
      maximumError = Math.max(
        maximumError,
        Math.abs(
          actual.getUint16(pixel * 8 + channel * 2, false) -
            expected.getUint16(pixel * 6 + channel * 2, true),
        ),
      )
    if (actual.getUint16(pixel * 8 + 6, false) !== 32768) throw new Error('CMYK alpha changed')
  }
  if (maximumError > 350) throw new Error(`${id}: LittleCMS error ${maximumError}`)
  results.push({
    id,
    inputSha256: hash(input),
    maximumError,
    tolerance: 350,
    oracle: 'LittleCMS 2.17 unsigned16 CMYK input after source-domain straightening',
  })
}
for (const transfer of ['hlg', 'srgb', 'pq'] as const)
  for (const associated of [false, true]) {
    const id = `lossy-${transfer}-${associated ? 'associated' : 'straight'}`
    const color: PixelColorSemantics = {
      ...gapSemantics,
      primaries: 'unspecified',
      transfer: { kind: transfer },
      alpha: associated ? 'premultiplied' : 'straight',
      chromaticities: {
        whitePoint: { x: 0.3127, y: 0.329 },
        primaries: [
          { x: 0.64, y: 0.33 },
          { x: 0.3, y: 0.6 },
          { x: 0.15, y: 0.06 },
        ],
      },
    }
    const pixels = new Uint8Array(8 * 8 * 8),
      view = new DataView(pixels.buffer)
    for (let pixel = 0; pixel < 64; pixel++) {
      const alpha = 0.25 + (pixel % 4) * 0.25
      for (let channel = 0; channel < 3; channel++)
        view.setUint16(
          pixel * 8 + channel * 2,
          Math.round((0.1 + ((pixel + channel) % 8) * 0.08) * (associated ? alpha : 1) * 65535),
          false,
        )
      view.setUint16(pixel * 8 + 6, Math.round(alpha * 65535), false)
    }
    const sink = new Uint8ArraySink()
    const encoder = await jpegxlCodec.createEncoder?.(sink, {
      width: 8,
      height: 8,
      pixelFormat: 'rgba16',
      colorSemantics: color,
      options: {
        mode: 'lossy',
        distance: 1,
        effort: 1,
        toneMapping: {
          intensityTarget: transfer === 'hlg' ? 1500 : transfer === 'pq' ? 4000 : 300,
          minNits: 0,
          relativeToMaxDisplay: false,
          linearBelow: 0,
        },
      },
    })
    if (!encoder) throw new Error('Missing forward encoder')
    await encoder.write({
      x: 0,
      y: 0,
      width: 8,
      height: 8,
      stride: 64,
      format: 'rgba16',
      data: pixels,
    })
    await encoder.finish()
    const input = sink.toUint8Array(),
      native = await independent(id, input, 'linear-float32')
    const actual = await collectJpegXlProfileRows(await gapDecoder(input))
    const metadata = await inspectJpegXl(input)
    const a = new DataView(actual.buffer),
      b = new DataView(native.buffer)
    const scale =
      transfer === 'hlg' || transfer === 'pq'
        ? metadata.toneMapping.intensityTarget / 203
        : metadata.toneMapping.intensityTarget / 255
    let maximumError = 0
    for (let pixel = 0; pixel < 64; pixel++)
      for (let channel = 0; channel < 4; channel++)
        maximumError = Math.max(
          maximumError,
          Math.abs(
            a.getFloat32((pixel * 4 + channel) * 4, false) / (channel === 3 ? 1 : scale) -
              b.getFloat32((pixel * 4 + channel) * 4, false),
          ),
        )
    if (maximumError > 1 / 255)
      throw new Error(`${id}: independent forward difference ${maximumError}`)
    results.push({
      id,
      inputSha256: hash(input),
      maximumError,
      tolerance: 1 / 255,
      oracle:
        'Pinned libjxl linear-sRGB output; linear output normalized by source intensity target',
    })
  }
const floats = new Uint8Array(8 * 8 * 12),
  view = new DataView(floats.buffer)
for (let index = 0; index < floats.length / 4; index++)
  view.setFloat32(index * 4, ((index % 31) - 8) / 7, false)
const animation = await encodeGapAnimation(floats, 'rgbf32', {
  ...gapSemantics,
  transfer: { kind: 'linear' },
})
compare(
  'float-animation',
  animation,
  await collectJpegXlProfileRows(await gapDecoder(animation, { frame: 1 })),
  await independent('float-animation', animation, 'native-planes-float32'),
  0,
)
for (const kind of ['pq', 'hlg'] as const) {
  const pixels = new Uint8Array(8 * 8 * 6),
    view = new DataView(pixels.buffer)
  for (let index = 0; index < pixels.length / 2; index++)
    view.setUint16(index * 2, 12000 + index * 100, false)
  const input = await encodeGapAnimation(
    pixels,
    'rgb16',
    { ...gapSemantics, primaries: 'rec2020', transfer: { kind } },
    true,
  )
  const own = await collectJpegXlProfileRows(
    await gapDecoder(input, { frame: 1, hdrOutput: 'linear-float' }),
  )
  const metadata = await inspectJpegXl(input)
  compare(
    `${kind}-animation`,
    input,
    own,
    await independent(`${kind}-animation`, input, 'linear-float32'),
    1 / 255,
    metadata.toneMapping.intensityTarget / 203,
  )
}
const Image = createImageLibrary({ codecs: [jpegxlCodec] })
const plane = {
  data: new Uint32Array(Float32Array.of(-0, -1.234567, 0.000000001, 4.87654).buffer),
  bitDepth: 32,
  sampleFormat: 'binary32' as const,
}
const lossless = await encodeJpegXlNative({ width: 4, height: 1, color: [plane] })
const lossy = await (await Image.open(lossless))
  .jpegxl({ mode: 'lossy', distance: 1 })
  .toUint8Array()
compare(
  'float-lossy-modular',
  lossy,
  await collectJpegXlProfileRows(await gapDecoder(lossy)),
  await independent('float-lossy-modular', lossy, 'native-planes-float32'),
  0,
)
await mkdir('benchmark/jpegxl/gap-completion', { recursive: true })
await writeFile(
  'benchmark/jpegxl/gap-completion/color.json',
  `${JSON.stringify({ cases: results }, null, 2)}\n`,
)
console.log(`Verified ${results.length} new color and float encoding cases`)
