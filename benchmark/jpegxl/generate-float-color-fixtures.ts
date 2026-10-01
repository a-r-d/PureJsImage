/** Development-only source-float and LittleCMS display references, without integer input rounding. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import type { PixelColorSemantics } from '../../src/color.ts'
import { encodeJpegXlNative, type JpegXlNativePlaneInput } from '../../src/jpegxl.ts'

interface Definition {
  readonly id: string
  readonly depth: 16 | 32
  readonly gray?: boolean
  readonly transfer?: 'linear' | 'srgb' | 'bt709' | 'gamma'
  readonly primaries?: 'srgb' | 'display-p3' | 'rec2020'
  readonly alpha?: 'integer8' | 'binary16' | 'binary32'
  readonly associated?: boolean
  readonly grouped?: boolean
  readonly shift?: 0 | 1
  readonly custom?: boolean
}
const definitions: readonly Definition[] = [
  { id: 'gray16-linear', depth: 16, gray: true },
  { id: 'gray32-gamma', depth: 32, gray: true, transfer: 'gamma' },
  { id: 'gray32-bt709', depth: 32, gray: true, transfer: 'bt709' },
  { id: 'rgb16-linear', depth: 16 },
  { id: 'rgb32-linear', depth: 32 },
  { id: 'rgb32-srgb', depth: 32, transfer: 'srgb' },
  { id: 'rgb32-gamma', depth: 32, transfer: 'gamma' },
  { id: 'rgb32-bt709', depth: 32, transfer: 'bt709' },
  { id: 'p3-32-srgb', depth: 32, transfer: 'srgb', primaries: 'display-p3' },
  { id: 'p3-16-linear', depth: 16, primaries: 'display-p3' },
  { id: 'rec2020-32-linear', depth: 32, primaries: 'rec2020' },
  { id: 'custom32-linear-relative', depth: 32, custom: true },
  { id: 'gray16-alpha16-associated', depth: 16, gray: true, alpha: 'binary16', associated: true },
  { id: 'rgb32-alpha8-associated', depth: 32, alpha: 'integer8', associated: true },
  {
    id: 'p3-32-alpha32-associated',
    depth: 32,
    primaries: 'display-p3',
    alpha: 'binary32',
    associated: true,
  },
  { id: 'rgb32-alpha16-straight', depth: 32, alpha: 'binary16' },
  {
    id: 'p3-16-alpha16-associated-grouped',
    depth: 16,
    primaries: 'display-p3',
    alpha: 'binary16',
    associated: true,
    grouped: true,
    shift: 1,
  },
]
const root = resolve('tests/fixtures/jpegxl/float-color')
const work = resolve('.tmp/jpegxl-float-color-fixtures')
await mkdir(root, { recursive: true })
await mkdir(work, { recursive: true })
const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null
// Fixture values are finite and small. libjxl independently decodes the resulting bit patterns.
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
const fixtures: {
  id: string
  file: string
  width: number
  height: number
  format: string
  depth: number
  alphaDepth: number
  associated: boolean
  colorTolerance: number
  sha256: string
  referenceSha256: string
  sourceProfileSha256: string
  sourceFloatSha256: string
}[] = []
for (const definition of definitions) {
  const width = definition.grouped ? 1025 : 8
  const height = definition.grouped ? 3 : 1
  const channels = definition.gray ? 1 : 3
  const alphaDepth =
    definition.alpha === 'integer8'
      ? 8
      : definition.alpha === 'binary16'
        ? 16
        : definition.alpha
          ? 32
          : 0
  const alphaValue = (index: number): number =>
    definition.shift ? 0.5 : ([0, 0.5, 1, 1][index % 4] ?? 1)
  const coverage = (index: number): number =>
    definition.alpha === 'integer8' ? Math.round(alphaValue(index) * 255) / 255 : alphaValue(index)
  const colors = Array.from({ length: channels }, (_, channel) =>
    plane(
      definition.depth,
      Float32Array.from({ length: width * height }, (_, index) => {
        const value = definition.grouped
          ? ((index * (13 + channel * 7)) % 33) / 16 - 0.25
          : ([-0.25, 0, 2 ** -24, 0.00001, 0.125, 0.5, 1, 1.5][(index + channel * 2) % 8] ?? 0)
        return value * (definition.associated ? coverage(index) : 1)
      }),
    ),
  )
  const [first, second, third] = colors
  if (!first) throw new Error('Missing first color plane')
  const color = definition.gray
    ? ([first] as const)
    : second && third
      ? ([first, second, third] as const)
      : undefined
  if (!color) throw new Error('Missing RGB planes')
  const semantics: PixelColorSemantics = {
    family: definition.gray ? 'gray' : 'rgb',
    primaries: definition.custom ? 'unspecified' : (definition.primaries ?? 'srgb'),
    transfer:
      definition.transfer === 'gamma'
        ? { kind: 'gamma', exponent: 2.2 }
        : { kind: definition.transfer ?? 'linear' },
    matrix: 'identity',
    range: 'full',
    alpha: definition.alpha ? (definition.associated ? 'premultiplied' : 'straight') : 'none',
    provenance: 'container-signaled',
    renderingIntent: 'relative',
    ...(definition.custom
      ? {
          chromaticities: {
            whitePoint: { x: 0.34567, y: 0.3585 },
            primaries: [
              { x: 0.63, y: 0.34 },
              { x: 0.29, y: 0.61 },
              { x: 0.15, y: 0.06 },
            ] as const,
          },
        }
      : {}),
  }
  const shift = definition.shift ?? 0
  const alphaValues = Float32Array.from(
    { length: Math.ceil(width / 2 ** shift) * Math.ceil(height / 2 ** shift) },
    (_, index) => coverage(index),
  )
  const alpha =
    definition.alpha === 'integer8'
      ? { bitDepth: 8, data: Uint8Array.from(alphaValues, (value) => Math.round(value * 255)) }
      : plane(alphaDepth === 16 ? 16 : 32, alphaValues)
  const encoded = await encodeJpegXlNative({
    width,
    height,
    color,
    colorSemantics: semantics,
    ...(definition.alpha
      ? {
          extraChannels: [
            { ...alpha, type: 0, dimShift: shift, associatedAlpha: !!definition.associated },
          ],
        }
      : {}),
  })
  const file = `${definition.id}.jxl`
  await writeFile(`${root}/${file}`, encoded)
  const directory = `${work}/${definition.id}`
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
  if (
    !record(native) ||
    native.width !== width ||
    native.height !== height ||
    native.bitDepth !== definition.depth ||
    native.alphaBitDepth !== alphaDepth ||
    native.channels !== channels + (definition.alpha ? 1 : 0) ||
    !Array.isArray(native.stages) ||
    typeof native.sourceProfileSha256 !== 'string'
  )
    throw new Error('Native float layout differs')
  const final: unknown = native.stages.at(-1)
  if (
    !record(final) ||
    final.kind !== 'final' ||
    typeof final.file !== 'string' ||
    !/^stage-\d+\.bin$/.test(final.file)
  )
    throw new Error('Missing native float stage')
  const source = new Uint8Array(await readFile(`${directory}/${final.file}`))
  if (digest(source) !== final.sha256) throw new Error('Native float samples differ')
  const profile = new Uint8Array(await readFile(`${directory}/source.icc`))
  if (digest(profile) !== native.sourceProfileSha256)
    throw new Error('Native float profile differs')
  await writeFile(`${root}/${definition.id}.icc`, profile)
  const view = new DataView(source.buffer)
  const nativeChannels = channels + (definition.alpha ? 1 : 0)
  if (source.length !== width * height * nativeChannels * 4)
    throw new Error('Native float count differs')
  const read = (pixel: number, channel: number): number =>
    view.getFloat32((pixel * nativeChannels + channel) * 4, false)
  const input = Float32Array.from({ length: width * height * channels }, (_, index) => {
    const pixel = Math.floor(index / channels)
    const a = definition.alpha ? read(pixel, channels) : 1
    const value = read(pixel, index % channels)
    return Math.max(0, Math.min(1, definition.associated ? (a <= 0 ? 0 : value / a) : value))
  })
  await writeFile(`${directory}/colors.input.bin`, new Uint8Array(input.buffer))
  execFileSync(
    'bun',
    [
      'benchmark/jpegxl/littlecms-profile-oracle.ts',
      `${root}/${definition.id}.icc`,
      `${directory}/colors.input.bin`,
      `${directory}/colors.output.bin`,
      String(channels),
      '16',
      'float32',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )
  const raw = new Uint8Array(await readFile(`${directory}/colors.output.bin`))
  const converted = new Uint16Array(raw.buffer)
  if (converted.length !== width * height * 3) throw new Error('Display reference count differs')
  const outputChannels = definition.alpha ? 4 : channels
  const reference = new Uint8Array(width * height * outputChannels * 2)
  const output = new DataView(reference.buffer)
  for (let pixel = 0; pixel < width * height; pixel++)
    for (let channel = 0; channel < outputChannels; channel++) {
      const a = definition.alpha ? read(pixel, channels) : 1
      const value =
        channel === 3
          ? Math.round(Math.max(0, Math.min(1, a)) * 65535)
          : definition.associated && a <= 0
            ? 0
            : (converted[pixel * 3 + channel] ?? 0)
      output.setUint16((pixel * outputChannels + channel) * 2, value, false)
    }
  await writeFile(`${root}/${definition.id}.bin.gz`, gzipSync(reference))
  fixtures.push({
    id: definition.id,
    file,
    width,
    height,
    format: definition.alpha ? 'rgba16' : definition.gray ? 'gray16' : 'rgb16',
    depth: definition.depth,
    alphaDepth,
    associated: !!definition.associated,
    colorTolerance: definition.gray ? 8 : 180,
    sha256: digest(encoded),
    referenceSha256: digest(reference),
    sourceProfileSha256: digest(profile),
    sourceFloatSha256: digest(source),
  })
}
await writeFile(
  `${root}/manifest.json`,
  `${JSON.stringify({ schemaVersion: 1, oracle: 'Pinned libjxl 0.12.0 C API source float32 samples and original generated profiles; LittleCMS 2.17 perceptual float32 input and float64 sRGB output, NOOPTIMIZE. Associated source samples straightened before explicit [0,1] SDR clipping; one final UInt16 rounding, no integer input quantization.', libjxlSha256: '29eea9f83a05f1851e18fc5f414916ca6c28e278f68622969bea68d7516ecdc5', littlecmsSha256: digest(new Uint8Array(await readFile('/usr/lib/x86_64-linux-gnu/liblcms2.so.2'))), fixtures }, null, 2)}\n`,
)
process.stdout.write(`Generated ${fixtures.length} independent float SDR references\n`)
