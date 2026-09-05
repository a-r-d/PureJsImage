import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { jpegxlCodec } from '../../src/codecs/jpegxl.ts'
import { pngCodec } from '../../src/codecs/png.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { createNodeRuntime } from '../../src/node-runtime.ts'
import type { PixelFormat } from '../../src/pixel.ts'
import { Uint8ArraySink } from '../../src/sink.ts'

type ImageClass =
  | 'line-art'
  | 'ui-screenshot'
  | 'text'
  | 'icon'
  | 'gradient'
  | 'alpha-graphics'
  | 'flat-illustration'
  | 'photo-like'
  | 'scanned-document'
  | 'noise'
  | 'sixteen-bit'
  | 'low-bit-depth'

interface CorpusEntry {
  readonly id: string
  readonly imageClass: ImageClass
  readonly width: number
  readonly height: number
  readonly channels: 3 | 4
  readonly bitDepth: 8 | 10 | 12 | 16
  readonly variant: number
}

const imageClasses: readonly ImageClass[] = Object.freeze([
  'line-art',
  'ui-screenshot',
  'text',
  'icon',
  'gradient',
  'alpha-graphics',
  'flat-illustration',
  'photo-like',
  'scanned-document',
  'noise',
  'sixteen-bit',
  'low-bit-depth',
])

const corpus: readonly CorpusEntry[] = Object.freeze(
  imageClasses.flatMap((imageClass, classIndex) =>
    Array.from({ length: 13 }, (_, variant): CorpusEntry => {
      const highBit = imageClass === 'sixteen-bit' || imageClass === 'low-bit-depth'
      const photoLike = imageClass === 'photo-like'
      return Object.freeze({
        id: `${imageClass}-${String(variant + 1).padStart(2, '0')}`,
        imageClass,
        width: photoLike ? 640 + variant * 19 : 97 + ((classIndex * 19 + variant * 23) % 97),
        height: photoLike ? 360 + variant * 11 : 73 + ((classIndex * 29 + variant * 17) % 89),
        channels: imageClass === 'alpha-graphics' || imageClass === 'icon' ? 4 : 3,
        bitDepth: highBit ? (imageClass === 'sixteen-bit' ? 16 : variant % 2 === 0 ? 10 : 12) : 8,
        variant,
      })
    }),
  ),
)

const fixture = (entry: CorpusEntry): Uint8Array => {
  const bytesPerSample = entry.bitDepth === 8 ? 1 : 2
  const output = new Uint8Array(entry.width * entry.height * entry.channels * bytesPerSample)
  const maximum = 2 ** entry.bitDepth - 1
  const fromByte = (value: number): number => Math.round(((value & 255) * maximum) / 255)
  let state = (0x1234_5678 ^ Math.imul(entry.variant + 1, 0x9e37_79b1)) >>> 0
  for (let y = 0; y < entry.height; y += 1) {
    for (let x = 0; x < entry.width; x += 1) {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
      const samples: number[] = []
      for (let channel = 0; channel < entry.channels; channel += 1) {
        let sample: number
        if (entry.imageClass === 'line-art') {
          sample = fromByte(((x >>> (2 + (entry.variant % 3))) + (y >>> 3)) % 2 === 0 ? 24 : 232)
        } else if (entry.imageClass === 'ui-screenshot') {
          const panel = ((x >>> 4) + (y >>> 4) + entry.variant) % 6
          sample = fromByte([248, 31, 78, 142, 205, 12][(panel + channel) % 6] ?? 0)
        } else if (entry.imageClass === 'text' || entry.imageClass === 'scanned-document') {
          const ink = y % (6 + (entry.variant % 3)) < 2 && (x + y * 3) % 13 < 9
          const paperNoise = entry.imageClass === 'scanned-document' ? (state >>> 28) - 8 : 0
          sample = fromByte((ink ? 22 + channel * 3 : 242 - channel * 2) + paperNoise)
        } else if (entry.imageClass === 'icon') {
          if (channel === 3) {
            const radius = Math.min(entry.width, entry.height) / 3
            const distance = Math.hypot(x - entry.width / 2, y - entry.height / 2)
            sample = distance < radius ? maximum : distance < radius + 2 ? fromByte(128) : 0
          } else {
            sample = fromByte(43 + channel * 67 + entry.variant * 11)
          }
        } else if (entry.imageClass === 'gradient') {
          const denominator = Math.max(1, entry.width + entry.height - 2)
          sample = Math.round(
            (((x + y + channel * entry.variant) % (denominator + 1)) * maximum) / denominator,
          )
        } else if (entry.imageClass === 'alpha-graphics' && channel === 3) {
          sample = (x + y + entry.variant) % 7 === 0 ? 0 : fromByte(x * 17 + y * 31)
        } else if (entry.imageClass === 'flat-illustration') {
          sample = fromByte((((x >>> 3) * 23 + (y >>> 3) * 41 + channel * 67) % 7) * 36)
        } else if (entry.imageClass === 'noise') {
          sample = state & 255
          state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
        } else if (entry.imageClass === 'sixteen-bit') {
          sample = (x * 257 + y * 911 + channel * 4_099 + ((x * y) >>> 2)) & maximum
        } else if (entry.imageClass === 'low-bit-depth') {
          sample = (x * 17 + y * 29 + channel * 71 + entry.variant * 13) & maximum
        } else if (entry.imageClass === 'photo-like') {
          sample = fromByte(
            channel === 0
              ? x * 3 + y + ((x * y) >>> 5) + entry.variant * 7
              : channel === 1
                ? x + y * 5 + (x >>> 3) * 19 + entry.variant * 11
                : (x >>> 3) * 23 + (y >>> 3) * 17 + entry.variant * 13,
          )
        } else {
          sample = fromByte(
            (x * 3 + y * 5 + channel * 47 + ((x * y) >>> (4 + (entry.variant % 3)))) & 255,
          )
        }
        samples.push(sample)
      }
      const pixelOffset = (y * entry.width + x) * entry.channels * bytesPerSample
      for (let channel = 0; channel < samples.length; channel += 1) {
        const sample = samples[channel] ?? 0
        const offset = pixelOffset + channel * bytesPerSample
        if (bytesPerSample === 2) output[offset] = sample >>> 8
        output[offset + bytesPerSample - 1] = sample
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
    ? concatenate(
        `P6\n${entry.width} ${entry.height}\n${String(2 ** entry.bitDepth - 1)}\n`,
        pixels,
      )
    : concatenate(
        `P7\nWIDTH ${entry.width}\nHEIGHT ${entry.height}\nDEPTH 4\nMAXVAL ${String(2 ** entry.bitDepth - 1)}\nTUPLTYPE RGB_ALPHA\nENDHDR\n`,
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

const encodePng = async (entry: CorpusEntry, pixels: Uint8Array): Promise<Uint8Array> => {
  if (entry.bitDepth === 8) {
    return new Uint8Array(
      await sharp(pixels, {
        raw: { width: entry.width, height: entry.height, channels: entry.channels },
      })
        .png({ compressionLevel: 9, adaptiveFiltering: true })
        .toBuffer(),
    )
  }
  const sink = new Uint8ArraySink()
  const format: PixelFormat = entry.channels === 4 ? 'rgba16' : 'rgb16'
  const encoder = await pngCodec.createEncoder?.(sink, {
    width: entry.width,
    height: entry.height,
    pixelFormat: format,
    options: { compressionLevel: 9 },
    runtime: createNodeRuntime(),
    limits: defaultImageLimits,
  })
  if (!encoder) throw new Error('PNG encoder is unavailable')
  await encoder.write({
    x: 0,
    y: 0,
    width: entry.width,
    height: entry.height,
    stride: entry.width * entry.channels * 2,
    format,
    data: pixels,
  })
  await encoder.finish()
  return sink.toUint8Array()
}

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
  effort: 1 | 3 | 5 | 7,
): Promise<
  Readonly<{
    readonly data: Uint8Array
    readonly milliseconds: number
    readonly managedPeakBytes: number
  }>
> => {
  const sink = new Uint8ArraySink()
  const started = performance.now()
  const format: PixelFormat =
    entry.channels === 4
      ? entry.bitDepth === 8
        ? 'rgba8'
        : 'rgba16'
      : entry.bitDepth === 8
        ? 'rgb8'
        : 'rgb16'
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
    options: {
      mode: 'lossless',
      effort,
      container: true,
      sampleBitDepth: entry.bitDepth,
      ...(entry.channels === 4 ? { alphaBitDepth: entry.bitDepth } : {}),
    },
    limits: defaultImageLimits,
  })
  if (!encoder) throw new Error('PureJsImage JPEG XL encoder is unavailable')
  await encoder.write({
    x: 0,
    y: 0,
    width: entry.width,
    height: entry.height,
    stride: entry.width * entry.channels * (entry.bitDepth === 8 ? 1 : 2),
    format,
    data: pixels,
  })
  await encoder.finish()
  const managedPeakBytes =
    'managedPeakBytes' in encoder && typeof encoder.managedPeakBytes === 'number'
      ? encoder.managedPeakBytes
      : 0
  return Object.freeze({
    data: sink.toUint8Array(),
    milliseconds: performance.now() - started,
    managedPeakBytes,
  })
}

const verifyJxl = async (
  id: string,
  encodedPath: string,
  expected: Uint8Array,
  channels: 3 | 4,
  bitDepth: 8 | 10 | 12 | 16,
  djxl: string,
  directory: string,
): Promise<void> => {
  const output = join(directory, `${id}.${channels === 4 ? 'pam' : 'ppm'}`)
  run(djxl, [encodedPath, output, `--bits_per_sample=${bitDepth === 8 ? '8' : '16'}`])
  const actual = netpbmPixels(new Uint8Array(await readFile(output)))
  if (bitDepth === 8 || bitDepth === 16) {
    if (!exact(actual, expected)) throw new Error(`${id} did not decode to exact native samples`)
    return
  }
  if (exact(actual, expected)) return
  const maximum = 2 ** bitDepth - 1
  if (actual.byteLength !== expected.byteLength) {
    throw new Error(`${id} decoded to ${actual.byteLength} bytes; expected ${expected.byteLength}`)
  }
  for (let offset = 0; offset < expected.byteLength; offset += 2) {
    const expectedSample = (expected[offset] ?? 0) * 256 + (expected[offset + 1] ?? 0)
    const renderedSample = (actual[offset] ?? 0) * 256 + (actual[offset + 1] ?? 0)
    const recoveredSample = Math.round((renderedSample * maximum) / 65_535)
    if (recoveredSample !== expectedSample) {
      throw new Error(`${id} changed declared sample ${String(offset / 2)}`)
    }
  }
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
const effortIndex = process.argv.indexOf('--effort')
const effortValue = effortIndex < 0 ? 1 : Number(process.argv[effortIndex + 1])
if (effortValue !== 1 && effortValue !== 3 && effortValue !== 5 && effortValue !== 7) {
  throw new Error('--effort must be 1, 3, 5, or 7')
}
const effort: 1 | 3 | 5 | 7 = effortValue

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
    const png = await encodePng(entry, pixels)
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
    if (entry.channels === 3 && entry.bitDepth === 8) {
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

    const pure = await encodePureJsImage(entry, pixels, effort).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`${entry.id} PureJsImage encode failed: ${message}`, { cause: error })
    })
    const purePath = join(temporary, `${entry.id}.purejsimage.jxl`)
    await writeFile(purePath, pure.data)
    await verifyJxl(
      `${entry.id}.purejsimage`,
      purePath,
      pixels,
      entry.channels,
      entry.bitDepth,
      join(libjxlDirectory, 'djxl'),
      temporary,
    )
    encoders.pureJsImage = {
      bytes: pure.data.byteLength,
      milliseconds: pure.milliseconds,
      exactNativeSamples: true,
      managedPeakBytes: pure.managedPeakBytes,
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
          '--container=1',
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
          '--container=1',
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
        entry.bitDepth,
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
      bitDepth: entry.bitDepth,
      variant: entry.variant,
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
type MeasurementKey = 'bytes' | 'milliseconds'
const measurementRatio = (
  file: Readonly<Record<string, unknown>>,
  numerator: string,
  denominator: string,
  key: MeasurementKey,
): number | undefined => {
  const encoders = file.encoders as
    | Readonly<Record<string, Readonly<Record<string, unknown>>>>
    | undefined
  const numeratorValue = encoders?.[numerator]?.[key]
  const denominatorValue = encoders?.[denominator]?.[key]
  return typeof numeratorValue === 'number' && typeof denominatorValue === 'number'
    ? numeratorValue / denominatorValue
    : undefined
}

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
    const grouped = Object.fromEntries(
      imageClasses.map((imageClass) => {
        const classRatios = ratios
          .filter((ratio) => ratio.imageClass === imageClass)
          .map((ratio) => ratio.ratio)
        return [imageClass, percentile(classRatios, 0.5)]
      }),
    )
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
        byClassMedian: grouped,
      },
    ]
  }),
)
const libjxlBaseline = effort === 1 ? 'libjxlEffort1' : 'libjxlEffort7'
const ratioToLibjxl = files.flatMap((file) => {
  const ratio = measurementRatio(file, 'pureJsImage', libjxlBaseline, 'bytes')
  return ratio === undefined ? [] : [ratio]
})
const speedRatioToLibjxl = files.flatMap((file) => {
  const ratio = measurementRatio(file, 'pureJsImage', libjxlBaseline, 'milliseconds')
  return ratio === undefined ? [] : [ratio]
})
const ratioToPng = files.flatMap((file) => {
  const ratio = measurementRatio(file, 'pureJsImage', 'png', 'bytes')
  return ratio === undefined ? [] : [ratio]
})
const ratioToPngByClass = Object.fromEntries(
  imageClasses.map((imageClass) => {
    const ratios = files.flatMap((file) => {
      if (file.imageClass !== imageClass) return []
      const ratio = measurementRatio(file, 'pureJsImage', 'png', 'bytes')
      return ratio === undefined ? [] : [ratio]
    })
    return [imageClass, percentile(ratios, 0.5)]
  }),
)
const metrics = Object.freeze({
  corpusCases: files.length,
  ratioToLibjxl: Object.freeze({
    median: percentile(ratioToLibjxl, 0.5),
    p90: percentile(ratioToLibjxl, 0.9),
    worst: Math.max(...ratioToLibjxl),
  }),
  speedRatioToLibjxl: Object.freeze({ median: percentile(speedRatioToLibjxl, 0.5) }),
  ratioToPng: Object.freeze({
    median: percentile(ratioToPng, 0.5),
    noLargerFraction: ratioToPng.filter((ratio) => ratio <= 1).length / ratioToPng.length,
    byClassMedian: ratioToPngByClass,
  }),
})
const gates =
  effort === 1
    ? Object.freeze({
        corpusAtLeast150: files.length >= 150,
        medianSizeVsLibjxl: metrics.ratioToLibjxl.median <= 1.4,
        medianSpeedVsLibjxl: metrics.speedRatioToLibjxl.median <= 5,
      })
    : effort === 7
      ? Object.freeze({
          corpusAtLeast150: files.length >= 150,
          medianSizeVsLibjxl: metrics.ratioToLibjxl.median <= 1.25,
          p90SizeVsLibjxl: metrics.ratioToLibjxl.p90 <= 1.4,
          noUnexplainedOutlier: metrics.ratioToLibjxl.worst <= 1.75,
          medianAtLeast10PercentSmallerThanPng: metrics.ratioToPng.median <= 0.9,
          atLeast75PercentNoLargerThanPng: metrics.ratioToPng.noLargerFraction >= 0.75,
          everyClassMedianVsPng: Object.values(ratioToPngByClass).every((ratio) => ratio <= 1.5),
          medianSpeedVsLibjxl: metrics.speedRatioToLibjxl.median <= 15,
        })
      : Object.freeze({ corpusAtLeast150: files.length >= 150 })
const gatesPassed = Object.values(gates).every(Boolean)
const report = {
  schemaVersion: 1,
  effort,
  revision: spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim(),
  status: gatesPassed ? 'milestone-thresholds-passed' : 'milestone-thresholds-failed',
  managedMemoryNote:
    'PureJsImage reports its encoder-managed peak. CLI comparisons remain null because they do not expose an equivalent ledger.',
  revisions: {
    libjxl: 'a7a9c787341cf703dede03c2009fa460cae5e5df',
    simpleLosslessEncoder: '7b9f14fd0ef1f4cb7e52e58ba5a222570937ddbf',
    imazenJxlEncoder: 'd63e9d1a1aa84b2dbdfc90eeddccc33fef5eb48b',
    imazenResolvedCargoLockSha256:
      '69b6e3c2229f9b6410da8f45fdea6bb8fd8a3a54ad83451219ca670b6790b040',
  },
  files,
  summaries,
  metrics,
  gates,
}
const outputIndex = process.argv.indexOf('--output')
const output = outputIndex < 0 ? undefined : process.argv[outputIndex + 1]
if (outputIndex >= 0 && !output) throw new Error('--output requires a path')
if (output) await writeFile(output, `${JSON.stringify(report, null, 2)}\n`)
console.log(
  JSON.stringify(
    output ? { effort, status: report.status, output, metrics, gates } : report,
    null,
    2,
  ),
)
if (!gatesPassed) throw new Error(`JPEG XL effort-${String(effort)} compression gate failed`)
