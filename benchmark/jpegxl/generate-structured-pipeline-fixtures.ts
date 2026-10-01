/** Independent libjxl SDR conversion references for existing and native test rasters. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import type { PixelColorSemantics } from '../../src/color.ts'
import { encodeJpegXlNative, inspectJpegXl } from '../../src/jpegxl.ts'
import colorManifest from '../../tests/fixtures/jpegxl/m4-color/manifest.json' with { type: 'json' }

const root = resolve('tests/fixtures/jpegxl/structured-pipeline')
const work = resolve('.tmp/jpegxl-structured-pipeline-fixtures')
await mkdir(root, { recursive: true })
await mkdir(work, { recursive: true })
const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const definitions: { id: string; file: string; sha256: string; alphaDepth?: number }[] =
  colorManifest.cases
    .filter(
      (row) =>
        ['linear', 'gamma', 'p3', 'rec2020', 'gray-linear', 'gray-gamma', 'dci', 'custom'].includes(
          row.id.replace(/-\d+$/, ''),
        ) &&
        (row.bitDepth > 8 || row.id.startsWith('dci-') || row.id.startsWith('custom-')),
    )
    .map((row) => ({ id: row.id, file: `../m4-color/${row.id}.jxl`, sha256: row.sha256 }))
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
}[] = []
for (const definition of [
  { id: 'gray8-linear-alpha8', gray: true, depth: 8, alphaDepth: 8 },
  {
    id: 'gray12-linear-alpha16-associated',
    gray: true,
    depth: 12,
    alphaDepth: 16,
    associated: true,
  },
  {
    id: 'p3-12-alpha8-associated-grouped',
    gray: false,
    depth: 12,
    alphaDepth: 8,
    grouped: true,
    associated: true,
    primaries: 'display-p3',
  },
  {
    id: 'custom-12-alpha16-grouped',
    gray: false,
    depth: 12,
    alphaDepth: 16,
    grouped: true,
    custom: true,
  },
  {
    id: 'gamma12-alpha8-shift1-associated',
    gray: true,
    depth: 12,
    alphaDepth: 8,
    grouped: true,
    shift: 1,
    associated: true,
    gamma: true,
  },
  { id: 'rgb10-bt709', gray: false, depth: 10, alphaDepth: 0, bt709: true },
  { id: 'gray16-bt709', gray: true, depth: 16, alphaDepth: 0, bt709: true },
] as const) {
  const grouped = 'grouped' in definition && definition.grouped
  const associated = 'associated' in definition && definition.associated
  const shift = 'shift' in definition ? definition.shift : 0
  const custom = 'custom' in definition && definition.custom
  const width = grouped ? 1025 : 4
  const height = grouped ? 3 : 1
  const maximum = 2 ** definition.depth - 1
  const alphaMaximum = 2 ** definition.alphaDepth - 1
  const alpha = definition.alphaDepth
    ? Uint16Array.from(
        { length: Math.ceil(width / 2 ** shift) * Math.ceil(height / 2 ** shift) },
        (_, index) => (shift ? 128 : Math.round(([1, 0.5, 0, 1][index % 4] ?? 1) * alphaMaximum)),
      )
    : undefined
  const color = Array.from({ length: definition.gray ? 1 : 3 }, (_, c) => ({
    bitDepth: definition.depth,
    data: Uint16Array.from({ length: width * height }, (_, index) => {
      const coverage = alpha ? (alpha[shift ? 0 : index] ?? 0) / alphaMaximum : 1
      const value = grouped
        ? ((index * (11 + c * 7)) % (maximum + 1)) / maximum
        : ([0, 0.25, 0.5, 1][(index + c) % 4] ?? 0)
      return Math.round(value * (associated ? coverage : 1) * maximum)
    }),
  }))
  const [first, second, third] = color
  if (!first || (!definition.gray && (!second || !third))) throw new Error('Missing native planes')
  const planes = definition.gray
    ? ([first] as const)
    : second && third
      ? ([first, second, third] as const)
      : undefined
  if (!planes) throw new Error('Missing RGB planes')
  const semantics: PixelColorSemantics = {
    family: definition.gray ? 'gray' : 'rgb',
    primaries: custom ? 'unspecified' : 'primaries' in definition ? definition.primaries : 'srgb',
    transfer:
      'gamma' in definition
        ? { kind: 'gamma', exponent: 2.2 }
        : { kind: 'bt709' in definition ? 'bt709' : 'linear' },
    matrix: 'identity',
    range: 'full',
    alpha: alpha ? (associated ? 'premultiplied' : 'straight') : 'none',
    provenance: 'container-signaled',
    renderingIntent: 'relative',
    ...(custom
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
  const encoded = await encodeJpegXlNative({
    width,
    height,
    color: planes,
    colorSemantics: semantics,
    ...(alpha
      ? {
          extraChannels: [
            {
              type: 0,
              bitDepth: definition.alphaDepth,
              data: alpha,
              associatedAlpha: associated,
              dimShift: shift,
            },
          ],
        }
      : {}),
  })
  await writeFile(`${root}/${definition.id}.jxl`, encoded)
  definitions.push({
    id: definition.id,
    file: `${definition.id}.jxl`,
    sha256: digest(encoded),
    alphaDepth: definition.alphaDepth,
  })
}
for (const definition of definitions) {
  const file = resolve(root, definition.file)
  const encoded = new Uint8Array(await readFile(file))
  if (digest(encoded) !== definition.sha256) throw new Error('Pinned structured input differs')
  const metadata = await inspectJpegXl(encoded)
  const channels = metadata.colorChannels
  const alphaDepth = definition.alphaDepth ?? 0
  const high = Math.max(metadata.bitDepth, alphaDepth) > 8
  const nativeDirectory = `${work}/${definition.id}`
  execFileSync(
    'bun',
    ['benchmark/jpegxl/flush-progressive-oracle.ts', file, nativeDirectory, 'normalized-integer'],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  const native: unknown = JSON.parse(await readFile(`${nativeDirectory}/manifest.json`, 'utf8'))
  if (
    !record(native) ||
    native.width !== metadata.width ||
    native.height !== metadata.height ||
    native.bitDepth !== metadata.bitDepth ||
    native.alphaBitDepth !== alphaDepth ||
    native.channels !== channels + (alphaDepth ? 1 : 0) ||
    !Array.isArray(native.stages) ||
    typeof native.sourceProfileSha256 !== 'string'
  )
    throw new Error('Independent native layout differs')
  const final: unknown = native.stages.at(-1)
  if (
    !record(final) ||
    final.kind !== 'final' ||
    typeof final.file !== 'string' ||
    !/^stage-\d+\.bin$/.test(final.file)
  )
    throw new Error('Independent native stage missing')
  const source = new Uint8Array(await readFile(`${nativeDirectory}/${final.file}`))
  if (digest(source) !== final.sha256) throw new Error('Native oracle samples differ')
  const profile = new Uint8Array(await readFile(`${nativeDirectory}/source.icc`))
  if (digest(profile) !== native.sourceProfileSha256)
    throw new Error('Native source profile differs')
  await writeFile(`${root}/${definition.id}.icc`, profile)
  const nativeView = new DataView(source.buffer)
  const nativeChannels = channels + (alphaDepth ? 1 : 0)
  const outputChannels = alphaDepth ? 4 : channels
  const sampleBytes = high ? 2 : 1
  const pixels = metadata.width * metadata.height
  if (source.length !== pixels * nativeChannels * sampleBytes)
    throw new Error('Native sample count differs')
  const readSample = (pixel: number, channel: number): number => {
    const offset = (pixel * nativeChannels + channel) * sampleBytes
    const value = high ? nativeView.getUint16(offset, false) : nativeView.getUint8(offset)
    const maximum = channel === channels ? 2 ** alphaDepth - 1 : 2 ** metadata.bitDepth - 1
    return Math.round((value * maximum) / (high ? 65535 : 255))
  }
  const alphaMaximum = 2 ** alphaDepth - 1
  const colorMaximum = 2 ** metadata.bitDepth - 1
  const associated = metadata.alpha === 'premultiplied'
  const input = Uint16Array.from({ length: pixels * channels }, (_, sample) => {
    const pixel = Math.floor(sample / channels)
    const alpha = alphaDepth ? readSample(pixel, channels) / alphaMaximum : 1
    const color = readSample(pixel, sample % channels) / colorMaximum
    const straight = associated ? (alpha === 0 ? 0 : color / alpha) : color
    return Math.round(Math.max(0, Math.min(1, straight)) * 65535)
  })
  const inputPath = `${nativeDirectory}/colors.input.bin`
  const outputPath = `${nativeDirectory}/colors.output.bin`
  await writeFile(inputPath, new Uint8Array(input.buffer))
  execFileSync(
    'bun',
    [
      'benchmark/jpegxl/littlecms-profile-oracle.ts',
      `${root}/${definition.id}.icc`,
      inputPath,
      outputPath,
      String(channels),
      high ? '16' : '8',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )
  const raw = new Uint8Array(await readFile(outputPath))
  const colors = high ? new Uint16Array(raw.buffer) : raw
  if (colors.length !== pixels * 3) throw new Error('Independent converted color count differs')
  const reference = new Uint8Array(metadata.width * metadata.height * outputChannels * sampleBytes)
  const view = new DataView(reference.buffer)
  const maximum = high ? 65535 : 255
  for (let pixel = 0; pixel < pixels; pixel++)
    for (let c = 0; c < outputChannels; c++) {
      const alpha = alphaDepth ? readSample(pixel, channels) : alphaMaximum
      const value =
        c === 3
          ? Math.round((alpha / alphaMaximum) * maximum)
          : associated && alpha === 0
            ? 0
            : (colors[pixel * 3 + c] ?? 0)
      const offset = (pixel * outputChannels + c) * sampleBytes
      if (high) view.setUint16(offset, value, false)
      else reference[offset] = value
    }
  await writeFile(`${root}/${definition.id}.bin.gz`, gzipSync(reference))
  fixtures.push({
    ...definition,
    width: metadata.width,
    height: metadata.height,
    format: alphaDepth
      ? high
        ? 'rgba16'
        : 'rgba8'
      : channels === 1
        ? high
          ? 'gray16'
          : 'gray8'
        : high
          ? 'rgb16'
          : 'rgb8',
    depth: metadata.bitDepth,
    alphaDepth,
    associated,
    colorTolerance: high ? (channels === 1 ? 8 : 180) : 1,
    referenceSha256: digest(reference),
    sourceProfileSha256: native.sourceProfileSha256,
  })
}
await writeFile(
  `${root}/manifest.json`,
  `${JSON.stringify({ schemaVersion: 1, oracle: 'Pinned libjxl 0.12.0 C API native integer samples and original generated profiles; LittleCMS 2.17 perceptual UInt16 input and floating sRGB output, NOOPTIMIZE; associated samples straightened before one UInt16 rounding', libjxlSha256: '29eea9f83a05f1851e18fc5f414916ca6c28e278f68622969bea68d7516ecdc5', littlecmsSha256: digest(new Uint8Array(await readFile('/usr/lib/x86_64-linux-gnu/liblcms2.so.2'))), fixtures }, null, 2)}\n`,
)
process.stdout.write(`Generated ${fixtures.length} independent structured pipeline references\n`)
