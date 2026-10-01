/** Independent libjxl source samples, LittleCMS float ICC and FFmpeg/zimg HDR references. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import type { PixelColorSemantics } from '../../src/color.ts'
import { encodeJpegXlNative, type JpegXlNativePlaneInput } from '../../src/jpegxl.ts'
import { jpegXlHdrFloatOracle } from './hdr-float-oracle.ts'

const root = resolve('tests/fixtures/jpegxl/float-completion')
const work = resolve('.tmp/jpegxl-float-completion-fixtures')
await mkdir(root, { recursive: true })
await mkdir(work, { recursive: true })
const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null
interface Definition {
  readonly id: string
  readonly depth: 16 | 32
  readonly gray?: boolean
  readonly profile?: string
  readonly transfer?: 'pq' | 'hlg' | 'linear'
  readonly primaries?: 'srgb' | 'rec2020' | 'display-p3'
  readonly alpha?: boolean
  readonly associated?: boolean
  readonly grouped?: boolean
}
const definitions: readonly Definition[] = [
  { id: 'gray16-icc', depth: 16, gray: true, profile: 'm8-native/gray.icc' },
  {
    id: 'gray32-icc-alpha',
    depth: 32,
    gray: true,
    profile: 'm8-native/gray.icc',
    alpha: true,
    associated: true,
  },
  { id: 'rgb32-icc', depth: 32, profile: 'm4-color/oriented-icc.icc' },
  { id: 'rgb16-icc-mab', depth: 16, profile: 'profile-pipeline/rgb-mab.icc' },
  {
    id: 'rgb32-icc-associated-grouped',
    depth: 32,
    profile: 'm4-color/oriented-icc.icc',
    alpha: true,
    associated: true,
    grouped: true,
  },
  { id: 'pq32-rec2020', depth: 32, transfer: 'pq', primaries: 'rec2020' },
  {
    id: 'pq16-p3-associated',
    depth: 16,
    transfer: 'pq',
    primaries: 'display-p3',
    alpha: true,
    associated: true,
  },
  { id: 'pq32-gray', depth: 32, transfer: 'pq', gray: true },
  { id: 'hlg32-rec2020', depth: 32, transfer: 'hlg', primaries: 'rec2020' },
  { id: 'hlg16-p3-alpha', depth: 16, transfer: 'hlg', primaries: 'display-p3', alpha: true },
  {
    id: 'hlg32-gray-associated',
    depth: 32,
    transfer: 'hlg',
    gray: true,
    alpha: true,
    associated: true,
  },
  {
    id: 'linear32-rec2020-headroom',
    depth: 32,
    transfer: 'linear',
    primaries: 'rec2020',
    alpha: true,
  },
]
const half = (value: number): number => {
  const sign = value < 0 ? 0x8000 : 0
  const magnitude = Math.abs(value)
  if (magnitude < 2 ** -14) return sign | Math.round(magnitude * 2 ** 24)
  const exponent = Math.floor(Math.log2(magnitude))
  return sign | ((exponent + 15) * 1024 + Math.round((magnitude / 2 ** exponent - 1) * 1024))
}
const plane = (depth: 16 | 32, values: Float32Array): JpegXlNativePlaneInput => ({
  bitDepth: depth,
  sampleFormat: depth === 16 ? 'binary16' : 'binary32',
  data: depth === 16 ? Uint16Array.from(values, half) : new Uint32Array(values.buffer),
})
const fixtures = []
for (const definition of definitions) {
  const width = definition.grouped ? 1025 : 8,
    height = definition.grouped ? 3 : 2
  const count = width * height,
    colorCount = definition.gray ? 1 : 3
  const coverage = (pixel: number): number =>
    definition.alpha ? ([0, 0.25, 0.5, 1][pixel % 4] ?? 1) : 1
  const colors = Array.from({ length: colorCount }, (_, channel) =>
    plane(
      definition.depth,
      Float32Array.from({ length: count }, (_, pixel) => {
        const value =
          definition.transfer === 'linear'
            ? ([0, 0.001, 0.1, 0.5, 1, 2, 4, 8][(pixel + channel * 2) % 8] ?? 0)
            : ([-0.1, 0, 0.00001, 0.01, 0.25, 0.5, 0.75, 1.1][(pixel + channel * 2) % 8] ?? 0)
        return value * (definition.associated ? coverage(pixel) : 1)
      }),
    ),
  )
  const [first, second, third] = colors
  if (!first || (!definition.gray && (!second || !third))) throw new Error('Missing color planes')
  const color = definition.gray
    ? ([first] as const)
    : second && third
      ? ([first, second, third] as const)
      : undefined
  if (!color) throw new Error('Missing RGB planes')
  const semantics: PixelColorSemantics = {
    family: definition.gray ? 'gray' : 'rgb',
    primaries: definition.primaries ?? 'srgb',
    transfer: { kind: definition.transfer ?? 'linear' },
    matrix: 'identity',
    range: 'full',
    alpha: definition.alpha ? (definition.associated ? 'premultiplied' : 'straight') : 'none',
    provenance: 'container-signaled',
    renderingIntent: 'relative',
  }
  const profile = definition.profile
    ? new Uint8Array(await readFile(`tests/fixtures/jpegxl/${definition.profile}`))
    : undefined
  const encoded = await encodeJpegXlNative({
    width,
    height,
    color,
    ...(profile ? { iccProfile: profile } : { colorSemantics: semantics }),
    ...(definition.alpha
      ? {
          extraChannels: [
            {
              ...plane(
                32,
                Float32Array.from({ length: count }, (_, pixel) => coverage(pixel)),
              ),
              type: 0,
              associatedAlpha: !!definition.associated,
            },
          ],
        }
      : {}),
    ...(definition.transfer
      ? {
          toneMapping: {
            intensityTarget: 1000,
            minNits: 0,
            relativeToMaxDisplay: false,
            linearBelow: 0,
          },
        }
      : {}),
  })
  const file = `${definition.id}.jxl`,
    directory = `${work}/${definition.id}`
  await writeFile(`${root}/${file}`, encoded)
  execFileSync(
    'bun',
    [
      'benchmark/jpegxl/flush-progressive-oracle.ts',
      `${root}/${file}`,
      directory,
      'native-float32',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )
  const native: unknown = JSON.parse(await readFile(`${directory}/manifest.json`, 'utf8'))
  if (!record(native) || !Array.isArray(native.stages)) throw new Error('Missing native reference')
  const final: unknown = native.stages.at(-1)
  if (!record(final) || typeof final.file !== 'string' || !/^stage-\d+\.bin$/.test(final.file))
    throw new Error('Missing final native samples')
  const source = new Uint8Array(await readFile(`${directory}/${final.file}`)),
    sourceView = new DataView(source.buffer)
  const sourceChannels = colorCount + (definition.alpha ? 1 : 0)
  const read = (pixel: number, channel: number): number =>
    sourceView.getFloat32((pixel * sourceChannels + channel) * 4, false)
  const input = Float32Array.from({ length: count * colorCount }, (_, sample) => {
    const pixel = Math.floor(sample / colorCount),
      alpha = definition.alpha ? read(pixel, colorCount) : 1
    const value = read(pixel, sample % colorCount),
      straight = definition.associated ? (alpha <= 0 ? 0 : value / alpha) : value
    return definition.transfer === 'linear' ? straight : Math.max(0, Math.min(1, straight))
  })
  let reference: Uint8Array, linearReference: Uint8Array | undefined
  if (profile) {
    await writeFile(`${root}/${definition.id}.icc`, profile)
    await writeFile(`${directory}/input.bin`, new Uint8Array(input.buffer))
    execFileSync(
      'bun',
      [
        'benchmark/jpegxl/littlecms-profile-oracle.ts',
        `${root}/${definition.id}.icc`,
        `${directory}/input.bin`,
        `${directory}/output.bin`,
        String(colorCount),
        '16',
        'float32',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )
    const raw = new Uint8Array(await readFile(`${directory}/output.bin`)),
      result = new Uint16Array(raw.buffer)
    const channels = definition.alpha ? 4 : colorCount
    reference = new Uint8Array(count * channels * 2)
    const view = new DataView(reference.buffer)
    for (let pixel = 0; pixel < count; pixel++)
      for (let channel = 0; channel < channels; channel++) {
        const alpha = definition.alpha ? read(pixel, colorCount) : 1
        const value =
          channel === 3
            ? Math.round(alpha * 65535)
            : definition.associated && alpha <= 0
              ? 0
              : (result[pixel * 3 + channel] ?? 0)
        view.setUint16((pixel * channels + channel) * 2, value, false)
      }
  } else {
    const hdr = await jpegXlHdrFloatOracle(
      directory,
      source,
      width,
      height,
      colorCount,
      !!definition.alpha,
      !!definition.associated,
      definition.primaries ?? 'srgb',
      definition.transfer ?? 'linear',
    )
    reference = hdr.reference
    linearReference = hdr.linearReference
    await writeFile(`${root}/${definition.id}.linear.bin.gz`, gzipSync(linearReference))
  }
  await writeFile(`${root}/${definition.id}.bin.gz`, gzipSync(reference))
  await writeFile(`${root}/${definition.id}.source.bin.gz`, gzipSync(source))
  fixtures.push({
    id: definition.id,
    file,
    width,
    height,
    depth: definition.depth,
    alphaDepth: definition.alpha ? 32 : 0,
    associated: !!definition.associated,
    category: profile ? 'icc' : 'hdr',
    format: profile
      ? definition.alpha
        ? 'rgba16'
        : definition.gray
          ? 'gray16'
          : 'rgb16'
      : definition.alpha
        ? 'rgba8'
        : 'rgb8',
    colorTolerance: profile
      ? definition.gray
        ? 8
        : definition.profile?.includes('mab')
          ? 1300
          : 180
      : 3,
    linearTolerance: 0.0003,
    sha256: hash(encoded),
    referenceSha256: hash(reference),
    sourceSha256: hash(source),
    ...(profile ? { profileSha256: hash(profile) } : {}),
    ...(linearReference ? { linearSha256: hash(linearReference) } : {}),
  })
}
await writeFile(
  `${root}/manifest.json`,
  `${JSON.stringify(
    {
      oracle:
        'libjxl 0.12.0 source Float32, LittleCMS 2.17 Float32 ICC input, FFmpeg/zimg float HDR to linear at 203 nit white and Reinhard source-gamut tone mapping',
      libjxlSha256: hash(
        new Uint8Array(await readFile('.tmp/jpegxl-remediation-oracle/lib/libjxl.so.0.12.0')),
      ),
      littlecmsSha256: hash(
        new Uint8Array(await readFile('/usr/lib/x86_64-linux-gnu/liblcms2.so.2')),
      ),
      ffmpegVersion: execFileSync('ffmpeg', ['-version'], { encoding: 'utf8' }).split('\n')[0],
      ffmpegSha256: hash(new Uint8Array(await readFile('/usr/bin/ffmpeg'))),
      fixtures,
    },
    null,
    2,
  )}\n`,
)
