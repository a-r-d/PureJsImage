import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { jpegxlCodec } from '../../src/codecs/jpegxl.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import type { PixelFormat } from '../../src/pixel.ts'
import { Uint8ArraySink } from '../../src/sink.ts'

type ImageClass = 'line-art' | 'gradient' | 'alpha-heavy' | 'photo-like' | 'noise'

interface CorpusEntry {
  readonly id: string
  readonly imageClass: ImageClass
  readonly width: number
  readonly height: number
  readonly channels: 3 | 4
}

const corpus: readonly CorpusEntry[] = Object.freeze([
  { id: 'line-art', imageClass: 'line-art', width: 257, height: 193, channels: 3 },
  { id: 'gradient', imageClass: 'gradient', width: 320, height: 181, channels: 3 },
  { id: 'alpha-heavy', imageClass: 'alpha-heavy', width: 257, height: 257, channels: 4 },
  { id: 'photo-like', imageClass: 'photo-like', width: 640, height: 360, channels: 3 },
  { id: 'noise', imageClass: 'noise', width: 255, height: 255, channels: 3 },
])

const fixture = (entry: CorpusEntry): Uint8Array => {
  const output = new Uint8Array(entry.width * entry.height * entry.channels)
  let state = 0x1234_5678
  for (let y = 0; y < entry.height; y += 1) {
    for (let x = 0; x < entry.width; x += 1) {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
      const offset = (y * entry.width + x) * entry.channels
      if (entry.imageClass === 'line-art') {
        const value = ((x >>> 4) + (y >>> 4)) % 2 === 0 ? 24 : 232
        output[offset] = value
        output[offset + 1] = value
        output[offset + 2] = value
      } else if (entry.imageClass === 'gradient') {
        output[offset] = Math.round((x * 255) / (entry.width - 1))
        output[offset + 1] = Math.round((y * 255) / (entry.height - 1))
        output[offset + 2] = Math.round(((x + y) * 255) / (entry.width + entry.height - 2))
      } else if (entry.imageClass === 'noise') {
        output[offset] = state & 255
        output[offset + 1] = (state >>> 8) & 255
        output[offset + 2] = (state >>> 16) & 255
      } else {
        output[offset] = (x * 3 + y + ((x * y) >>> 5)) & 255
        output[offset + 1] = (x + y * 5 + (x >>> 3) * 19) & 255
        output[offset + 2] = ((x >>> 3) * 23 + (y >>> 3) * 17) & 255
      }
      if (entry.channels === 4) {
        const alpha = (x + y) % 7 === 0 ? 0 : (x * 17 + y * 31) & 255
        output[offset + 3] = alpha
        if (alpha === 0) {
          output[offset] = 0
          output[offset + 1] = 0
          output[offset + 2] = 0
        }
      }
    }
  }
  return output
}

const concatenate = (header: string, pixels: Uint8Array): Uint8Array => {
  const encoded = new TextEncoder().encode(header)
  const output = new Uint8Array(encoded.byteLength + pixels.byteLength)
  output.set(encoded)
  output.set(pixels, encoded.byteLength)
  return output
}

const netpbm = (entry: CorpusEntry, pixels: Uint8Array): Uint8Array =>
  entry.channels === 3
    ? concatenate(`P6\n${entry.width} ${entry.height}\n255\n`, pixels)
    : concatenate(
        `P7\nWIDTH ${entry.width}\nHEIGHT ${entry.height}\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n`,
        pixels,
      )

const netpbmPixels = (input: Uint8Array): Uint8Array => {
  const text = new TextDecoder().decode(input.subarray(0, Math.min(input.byteLength, 1_024)))
  if (text.startsWith('P7\n')) {
    const end = text.indexOf('ENDHDR\n')
    if (end < 0) throw new Error('PAM output has no ENDHDR marker')
    return input.subarray(end + 'ENDHDR\n'.length)
  }
  if (!text.startsWith('P6')) throw new Error('Expected PPM or PAM decoder output')
  let tokens = 0
  let offset = 0
  while (offset < input.byteLength && tokens < 4) {
    while (offset < input.byteLength && (input[offset] ?? 0) <= 32) offset += 1
    if (input[offset] === 35) {
      while (offset < input.byteLength && input[offset] !== 10) offset += 1
      continue
    }
    while (offset < input.byteLength && (input[offset] ?? 0) > 32) offset += 1
    tokens += 1
  }
  if (input[offset] === 13 && input[offset + 1] === 10) offset += 2
  else if ((input[offset] ?? 0) <= 32) offset += 1
  return input.subarray(offset)
}

const exact = (left: Uint8Array, right: Uint8Array): boolean =>
  left.byteLength === right.byteLength && left.every((value, index) => right[index] === value)

const run = (binary: string, arguments_: readonly string[]): number => {
  const started = performance.now()
  const result = spawnSync(binary, arguments_, { encoding: 'utf8', maxBuffer: 8 * 1_024 * 1_024 })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${binary} failed: ${result.stderr.trim()}`)
  }
  return performance.now() - started
}

const encodePureJsImage = async (
  entry: CorpusEntry,
  pixels: Uint8Array,
): Promise<Readonly<{ readonly data: Uint8Array; readonly milliseconds: number }>> => {
  const sink = new Uint8ArraySink()
  const started = performance.now()
  const format: PixelFormat = entry.channels === 4 ? 'rgba8' : 'rgb8'
  const encoder = await jpegxlCodec.createEncoder?.(sink, {
    width: entry.width,
    height: entry.height,
    pixelFormat: format,
    colorSemantics: {
      family: 'rgb',
      primaries: 'srgb',
      transfer: { kind: 'srgb' },
      matrix: 'identity',
      range: 'full',
      alpha: format === 'rgba8' ? 'straight' : 'none',
      provenance: 'assumed-default',
      renderingIntent: 'relative',
    },
    options: { mode: 'lossless', effort: 1, container: true },
    limits: defaultImageLimits,
  })
  if (!encoder) throw new Error('PureJsImage JPEG XL encoder is unavailable')
  await encoder.write({
    x: 0,
    y: 0,
    width: entry.width,
    height: entry.height,
    stride: entry.width * entry.channels,
    format,
    data: pixels,
  })
  await encoder.finish()
  return Object.freeze({ data: sink.toUint8Array(), milliseconds: performance.now() - started })
}

const verifyJxl = async (
  id: string,
  encodedPath: string,
  expected: Uint8Array,
  channels: 3 | 4,
  djxl: string,
  directory: string,
): Promise<void> => {
  const output = join(directory, `${id}.${channels === 4 ? 'pam' : 'ppm'}`)
  run(djxl, [encodedPath, output, '--bits_per_sample=8'])
  const actual = netpbmPixels(new Uint8Array(await readFile(output)))
  if (!exact(actual, expected)) throw new Error(`${id} did not decode to exact native samples`)
}

const percentile = (values: readonly number[], fraction: number): number => {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] ?? 0
}

const libjxlDirectory = process.argv[2]
const simpleBinary = process.argv[3]
const imazenBinary = process.argv[4]
if (!libjxlDirectory || !simpleBinary || !imazenBinary) {
  throw new Error(
    'Usage: run-compression-gate.ts <libjxl-tools-dir> <simple-lossless-bin> <imazen-cjxl-rs-bin> [--output report.json]',
  )
}

const temporary = await mkdtemp(join(tmpdir(), 'purejsimage-jxl-compression-'))
const files: Record<string, unknown>[] = []
try {
  for (const entry of corpus) {
    const pixels = fixture(entry)
    const pnm = netpbm(entry, pixels)
    const pnmPath = join(temporary, `${entry.id}.${entry.channels === 4 ? 'pam' : 'ppm'}`)
    const pngPath = join(temporary, `${entry.id}.png`)
    await writeFile(pnmPath, pnm)

    const pngStarted = performance.now()
    const png = new Uint8Array(
      await sharp(pixels, {
        raw: { width: entry.width, height: entry.height, channels: entry.channels },
      })
        .png({ compressionLevel: 9, adaptiveFiltering: true })
        .toBuffer(),
    )
    const pngMilliseconds = performance.now() - pngStarted
    await writeFile(pngPath, png)

    const encoders: Record<string, unknown> = {
      png: {
        bytes: png.byteLength,
        milliseconds: pngMilliseconds,
        exactNativeSamples: true,
        managedPeakBytes: null,
      },
    }
    if (entry.channels === 3) {
      const webpStarted = performance.now()
      const webp = new Uint8Array(
        await sharp(pixels, {
          raw: { width: entry.width, height: entry.height, channels: entry.channels },
        })
          .webp({ lossless: true, effort: 6 })
          .toBuffer(),
      )
      const webpMilliseconds = performance.now() - webpStarted
      const reopenedWebp = await sharp(webp).raw().toBuffer({ resolveWithObject: true })
      if (!exact(new Uint8Array(reopenedWebp.data), pixels)) {
        throw new Error(`${entry.id} lossless WebP changed native samples`)
      }
      encoders.webpLossless = {
        bytes: webp.byteLength,
        milliseconds: webpMilliseconds,
        exactNativeSamples: true,
        managedPeakBytes: null,
      }
    } else {
      encoders.webpLossless = {
        status: 'not-applicable-hidden-rgb-is-not-native-sample-exact',
        bytes: null,
        milliseconds: null,
        exactNativeSamples: false,
        managedPeakBytes: null,
      }
    }

    const pure = await encodePureJsImage(entry, pixels)
    const purePath = join(temporary, `${entry.id}.purejsimage.jxl`)
    await writeFile(purePath, pure.data)
    await verifyJxl(
      `${entry.id}.purejsimage`,
      purePath,
      pixels,
      entry.channels,
      join(libjxlDirectory, 'djxl'),
      temporary,
    )
    encoders.pureJsImage = {
      bytes: pure.data.byteLength,
      milliseconds: pure.milliseconds,
      exactNativeSamples: true,
      managedPeakBytes: null,
    }

    const commands = [
      {
        id: 'libjxlEffort1',
        binary: join(libjxlDirectory, 'cjxl'),
        arguments: [
          pnmPath,
          join(temporary, `${entry.id}.libjxl-e1.jxl`),
          '--distance=0',
          '--effort=1',
        ],
        output: join(temporary, `${entry.id}.libjxl-e1.jxl`),
      },
      {
        id: 'libjxlEffort7',
        binary: join(libjxlDirectory, 'cjxl'),
        arguments: [
          pnmPath,
          join(temporary, `${entry.id}.libjxl-e7.jxl`),
          '--distance=0',
          '--effort=7',
        ],
        output: join(temporary, `${entry.id}.libjxl-e7.jxl`),
      },
      {
        id: 'simpleLossless',
        binary: simpleBinary,
        arguments: [pnmPath, join(temporary, `${entry.id}.simple.jxl`), '1'],
        output: join(temporary, `${entry.id}.simple.jxl`),
      },
      {
        id: 'imazen',
        binary: imazenBinary,
        arguments: [pngPath, join(temporary, `${entry.id}.imazen.jxl`), '--lossless', '--effort=7'],
        output: join(temporary, `${entry.id}.imazen.jxl`),
      },
    ] as const
    for (const command of commands) {
      const milliseconds = run(command.binary, command.arguments)
      await verifyJxl(
        `${entry.id}.${command.id}`,
        command.output,
        pixels,
        entry.channels,
        join(libjxlDirectory, 'djxl'),
        temporary,
      )
      encoders[command.id] = {
        bytes: (await readFile(command.output)).byteLength,
        milliseconds,
        exactNativeSamples: true,
        managedPeakBytes: null,
      }
    }

    files.push({
      id: entry.id,
      imageClass: entry.imageClass,
      width: entry.width,
      height: entry.height,
      channels: entry.channels,
      nativeBytes: pixels.byteLength,
      encoders,
    })
  }
} finally {
  await rm(temporary, { recursive: true, force: true })
}

const encoderIds = [
  'pureJsImage',
  'libjxlEffort1',
  'libjxlEffort7',
  'simpleLossless',
  'imazen',
  'png',
  'webpLossless',
] as const
const summaries = Object.fromEntries(
  encoderIds.map((encoder) => {
    const ratios = files.flatMap((file) => {
      const encoders = file.encoders as Readonly<Record<string, Readonly<{ bytes: number | null }>>>
      const baseline = encoders.png?.bytes
      const bytes = encoders[encoder]?.bytes
      return typeof baseline === 'number' && typeof bytes === 'number'
        ? [{ imageClass: file.imageClass, ratio: bytes / baseline }]
        : []
    })
    return [
      encoder,
      {
        ratioToPng: {
          median: percentile(
            ratios.map(({ ratio }) => ratio),
            0.5,
          ),
          p90: percentile(
            ratios.map(({ ratio }) => ratio),
            0.9,
          ),
          worst: Math.max(...ratios.map(({ ratio }) => ratio)),
        },
        byClass: Object.fromEntries(ratios.map(({ imageClass, ratio }) => [imageClass, ratio])),
      },
    ]
  }),
)
const report = {
  schemaVersion: 1,
  revision: spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim(),
  status: 'experimental-thresholds-not-promoted',
  managedMemoryNote:
    'The compared CLIs and the current Modular encoder do not expose a common managed-memory ledger. null is reported instead of substituting process RSS.',
  revisions: {
    libjxl: 'a7a9c787341cf703dede03c2009fa460cae5e5df',
    simpleLosslessEncoder: '7b9f14fd0ef1f4cb7e52e58ba5a222570937ddbf',
    imazenJxlEncoder: 'd63e9d1a1aa84b2dbdfc90eeddccc33fef5eb48b',
    imazenResolvedCargoLockSha256:
      '69b6e3c2229f9b6410da8f45fdea6bb8fd8a3a54ad83451219ca670b6790b040',
  },
  files,
  summaries,
}
const outputIndex = process.argv.indexOf('--output')
const output = outputIndex < 0 ? undefined : process.argv[outputIndex + 1]
if (outputIndex >= 0 && !output) throw new Error('--output requires a path')
if (output) await writeFile(output, `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, null, 2))
