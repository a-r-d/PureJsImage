import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'

import { JpegXlCodestreamSource, inspectJpegXlSource } from '../../src/codecs/jpegxl-container.ts'
import { jpegxlCodec } from '../../src/codecs/jpegxl.ts'
import { readJpegXlSourceFrameStructures } from '../../src/codecs/jpegxl-decode.ts'
import { resolveJpegXlLimits } from '../../src/codecs/jpegxl-limits.ts'
import { inspectJpegXl } from '../../src/jpegxl.ts'
import { ImageError } from '../../src/errors.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { MemorySource } from '../../src/source.ts'
import { inspectJpegXlVarDctStrategyIds } from './inspect-vardct-strategies.ts'

interface CorpusLicense {
  readonly id: number
  readonly name: string
  readonly url: string
}

interface CorpusCase {
  readonly id: string
  readonly sourcePath: string
  readonly cocoUrl: string
  readonly originalUrl: string
  readonly license: CorpusLicense
  readonly width: number
  readonly height: number
}

interface CorpusManifest {
  readonly cases: readonly CorpusCase[]
}

interface EncoderVariant {
  readonly encoder: 'libjxl' | 'imazen'
  readonly distance: 0.5 | 1 | 2 | 4
  readonly effort: 1 | 3 | 5 | 7 | 9
  readonly progressive: boolean
  readonly lfFrame: boolean
}

interface Comparison {
  readonly maximumError: number
  readonly rmse: number
}

interface RunResult extends Comparison {
  readonly id: string
  readonly photoId: string
  readonly encoder: EncoderVariant['encoder']
  readonly encoderRevision: string
  readonly distance: number
  readonly effort: number
  readonly progressive: boolean
  readonly lfFrame: boolean
  readonly width: number
  readonly height: number
  readonly megapixels: number
  readonly encodedBytes: number
  readonly encodedSha256: string
  readonly decodeMilliseconds: number
  readonly djxlMilliseconds: number
  readonly managedPeakBytes: number
  readonly groupCount: number
  readonly lfGroupCount: number
  readonly passCount: number
  readonly internalFrames: number
  readonly strategyIds: readonly number[]
  readonly jxlOxide?: Comparison
}

interface RunFailure {
  readonly id: string
  readonly classification: 'unsupported' | 'incorrect-output' | 'harness'
  readonly code?: string
  readonly message: string
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const object = (value: unknown, label: string): Readonly<Record<string, unknown>> => {
  if (!isRecord(value)) {
    throw new Error(`${label} is not an object`)
  }
  return value
}

const string = (value: unknown, label: string): string => {
  if (typeof value !== 'string') throw new Error(`${label} is not a string`)
  return value
}

const number = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error(`${label} is not a number`)
  return value
}

const parseManifest = (value: unknown): CorpusManifest => {
  const root = object(value, 'COCO manifest')
  if (!Array.isArray(root.cases)) throw new Error('COCO manifest cases are missing')
  return Object.freeze({
    cases: Object.freeze(
      root.cases.map((candidate, index): CorpusCase => {
        const item = object(candidate, `COCO case ${index}`)
        const license = object(item.license, `COCO case ${index} license`)
        return Object.freeze({
          id: string(item.id, 'case id'),
          sourcePath: string(item.sourcePath, 'case sourcePath'),
          cocoUrl: string(item.cocoUrl, 'case cocoUrl'),
          originalUrl: string(item.originalUrl, 'case originalUrl'),
          license: Object.freeze({
            id: number(license.id, 'license id'),
            name: string(license.name, 'license name'),
            url: string(license.url, 'license url'),
          }),
          width: number(item.width, 'case width'),
          height: number(item.height, 'case height'),
        })
      }),
    ),
  })
}

const run = async (command: string, arguments_: readonly string[]): Promise<number> => {
  const started = performance.now()
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, arguments_, { stdio: ['ignore', 'ignore', 'pipe'] })
    let errorOutput = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      if (errorOutput.length < 16_384) errorOutput += chunk
    })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} exited with ${code ?? 'unknown'}: ${errorOutput.trim()}`))
    })
  })
  return performance.now() - started
}

const sha256 = (value: Uint8Array): string => createHash('sha256').update(value).digest('hex')

const pnmPixels = (input: Uint8Array): Uint8Array => {
  let offset = 0
  let tokens = 0
  while (offset < input.length && tokens < 4) {
    while (offset < input.length && (input[offset] ?? 0) <= 32) offset += 1
    if (input[offset] === 35) {
      while (offset < input.length && input[offset] !== 10) offset += 1
      continue
    }
    while (offset < input.length && (input[offset] ?? 0) > 32) offset += 1
    tokens += 1
  }
  if (tokens !== 4 || offset >= input.length) throw new Error('PNM oracle header is invalid')
  return input.subarray(offset + 1)
}

const compare = (actual: Uint8Array, expected: Uint8Array): Comparison => {
  if (actual.length !== expected.length) {
    throw new Error(`Pixel length ${actual.length} does not match oracle length ${expected.length}`)
  }
  let maximumError = 0
  let squaredError = 0
  for (let index = 0; index < actual.length; index += 1) {
    const difference = Math.abs((actual[index] ?? 0) - (expected[index] ?? 0))
    maximumError = Math.max(maximumError, difference)
    squaredError += difference * difference
  }
  return Object.freeze({ maximumError, rmse: Math.sqrt(squaredError / actual.length) })
}

const decodePure = async (
  encoded: Uint8Array,
): Promise<Readonly<{ pixels: Uint8Array; milliseconds: number; managedPeakBytes: number }>> => {
  const started = performance.now()
  const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(encoded), defaultImageLimits)
  if (!decoder) throw new Error('PureJsImage JPEG XL decoder is unavailable')
  const chunks: Uint8Array[] = []
  for await (const block of decoder.decode()) {
    chunks.push(block.data)
    block.release?.()
  }
  const milliseconds = performance.now() - started
  const singleChunk = chunks.length === 1 ? chunks[0] : undefined
  const pixels = singleChunk ?? new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0))
  if (!singleChunk) {
    let offset = 0
    for (const chunk of chunks) {
      pixels.set(chunk, offset)
      offset += chunk.length
    }
  }
  const managedPeakBytes =
    'managedPeakBytes' in decoder && typeof decoder.managedPeakBytes === 'number'
      ? decoder.managedPeakBytes
      : 0
  return Object.freeze({ pixels, milliseconds, managedPeakBytes })
}

const makePpm = async (source: string, width: number, height: number): Promise<Uint8Array> => {
  const pixels = await sharp(source)
    .resize(width, height, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer()
  const header = new TextEncoder().encode(`P6\n${width} ${height}\n255\n`)
  const output = new Uint8Array(header.length + pixels.length)
  output.set(header)
  output.set(pixels, header.length)
  return output
}

const distances = [0.5, 1, 2, 4] as const
const efforts = [1, 3, 5, 7, 9] as const
const variant = (photoIndex: number, variantIndex: number): EncoderVariant =>
  variantIndex < 2
    ? Object.freeze({
        encoder: 'libjxl',
        distance: distances[(photoIndex + variantIndex * 2) % distances.length] ?? 1,
        effort: efforts[(photoIndex + variantIndex * 2) % efforts.length] ?? 5,
        progressive: (photoIndex + variantIndex) % 2 === 0,
        lfFrame: false,
      })
    : Object.freeze({
        encoder: 'imazen',
        distance: distances[(photoIndex + 1) % distances.length] ?? 1,
        effort: efforts[(photoIndex + 3) % efforts.length] ?? 5,
        progressive: photoIndex % 3 === 0,
        lfFrame: photoIndex % 5 === 0,
      })

const argumentsAfter = (flag: string): string | undefined => {
  const index = process.argv.indexOf(flag)
  return index < 0 ? undefined : process.argv[index + 1]
}

const corpusDirectory = argumentsAfter('--corpus') ?? '.tmp/jpegxl-m1-coco'
const outputDirectory = argumentsAfter('--work') ?? '.tmp/jpegxl-m3-common-static'
const libjxlTools = argumentsAfter('--libjxl-tools')
const imazen = argumentsAfter('--imazen')
const jxlOxide = argumentsAfter('--jxl-oxide')
const reportPath =
  argumentsAfter('--output') ?? 'benchmark/jpegxl/production-program/m3-common-static-report.json'
const requestedLimit = Number(argumentsAfter('--limit') ?? '100')
const targetMegapixels = Number(argumentsAfter('--target-megapixels') ?? '0')
if (!libjxlTools || !imazen || !jxlOxide) {
  throw new Error('Required: --libjxl-tools <dir> --imazen <binary> --jxl-oxide <binary>')
}

const manifest = parseManifest(
  JSON.parse(
    await readFile(
      'benchmark/jpegxl/production-program/corpora/jpeg-archive-coco-val2017.json',
      'utf8',
    ),
  ),
)
if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 100) {
  throw new Error('--limit must be an integer from 1 to 100')
}
const photos = manifest.cases.slice(0, requestedLimit)
if (photos.length !== requestedLimit) {
  throw new Error(`Expected ${requestedLimit} real photographs, found ${photos.length}`)
}
await mkdir(outputDirectory, { recursive: true })

const results: RunResult[] = []
const failures: RunFailure[] = []
for (let photoIndex = 0; photoIndex < photos.length; photoIndex += 1) {
  const photo = photos[photoIndex]
  if (!photo) throw new Error('Selected photograph is missing')
  const targetPixels =
    targetMegapixels > 0
      ? targetMegapixels * 1_000_000
      : photoIndex === 0
        ? 24_000_000
        : photoIndex === 1
          ? 12_000_000
          : 1_050_000
  const scale = Math.sqrt(targetPixels / (photo.width * photo.height))
  const width = Math.max(1, Math.round(photo.width * scale)) | 1
  const height = Math.max(1, Math.round(photo.height * scale)) | 1
  const sourcePath = join(corpusDirectory, photo.sourcePath)
  const ppmPath = join(outputDirectory, `${photo.id}-${width}x${height}.ppm`)
  await writeFile(ppmPath, await makePpm(sourcePath, width, height))

  for (let variantIndex = 0; variantIndex < 3; variantIndex += 1) {
    const settings = variant(photoIndex, variantIndex)
    const id = `${photo.id}-${settings.encoder}-${variantIndex}`
    const jxlPath = join(outputDirectory, `${id}.jxl`)
    const oraclePath = join(outputDirectory, `${id}.oracle.ppm`)
    try {
      if (settings.encoder === 'libjxl') {
        const options = [
          ppmPath,
          jxlPath,
          '--modular=0',
          '--num_threads=1',
          `--distance=${settings.distance}`,
          `--effort=${settings.effort}`,
        ]
        if (settings.progressive) options.push('--progressive', '--progressive_dc=0')
        await run(join(libjxlTools, 'cjxl'), options)
      } else {
        const options = [
          ppmPath,
          jxlPath,
          '--distance',
          String(settings.distance),
          '--effort',
          String(settings.effort),
        ]
        if (settings.progressive) options.push('--progressive')
        if (settings.lfFrame) options.push('--lf-frame')
        await run(imazen, options)
      }
      const djxlMilliseconds = await run(join(libjxlTools, 'djxl'), [
        jxlPath,
        oraclePath,
        '--bits_per_sample=8',
        '--num_threads=1',
      ])
      const encoded = new Uint8Array(await readFile(jxlPath))
      const oracle = pnmPixels(new Uint8Array(await readFile(oraclePath)))
      const decoded = await decodePure(encoded)
      const comparison = compare(decoded.pixels, oracle)
      if (comparison.maximumError > 1 || comparison.rmse > 0.55) {
        throw new Error(
          `oracle mismatch: max ${comparison.maximumError}, RMSE ${comparison.rmse.toFixed(6)}`,
        )
      }
      const physical = new MemorySource(encoded)
      const structure = await inspectJpegXlSource(physical, resolveJpegXlLimits())
      const frames = await readJpegXlSourceFrameStructures(
        new JpegXlCodestreamSource(physical, structure),
        defaultImageLimits,
      )
      const frame = frames.at(-1)
      if (!frame) throw new Error('JPEG XL final frame is missing')
      const inspection = await inspectJpegXl(encoded)
      const strategyIds = await inspectJpegXlVarDctStrategyIds(
        new JpegXlCodestreamSource(physical, structure),
        frames,
      )
      let oxideComparison: Comparison | undefined
      if ((photoIndex * 3 + variantIndex) % 25 === 0) {
        const oxidePath = join(outputDirectory, `${id}.oxide.png`)
        await run(jxlOxide, [jxlPath, '--output', oxidePath, '--output-format', 'png8'])
        const oxide = await sharp(oxidePath).removeAlpha().raw().toBuffer()
        oxideComparison = compare(decoded.pixels, oxide)
        if (oxideComparison.maximumError > 1) {
          throw new Error(`jxl-oxide mismatch: max ${oxideComparison.maximumError}`)
        }
      }
      results.push(
        Object.freeze({
          id,
          photoId: photo.id,
          encoder: settings.encoder,
          encoderRevision:
            settings.encoder === 'libjxl' ? 'a7a9c787341cf703dede03c2009fa460cae5e5df' : 'd63e9d1',
          distance: settings.distance,
          effort: settings.effort,
          progressive: settings.progressive,
          lfFrame: settings.lfFrame,
          width,
          height,
          megapixels: (width * height) / 1_000_000,
          encodedBytes: encoded.length,
          encodedSha256: sha256(encoded),
          decodeMilliseconds: decoded.milliseconds,
          djxlMilliseconds,
          managedPeakBytes: decoded.managedPeakBytes,
          groupCount: frame.groupsAcross * frame.groupsDown,
          lfGroupCount: frame.dcGroupCount,
          passCount: inspection.progressivePasses,
          internalFrames: Math.max(0, frames.length - 1),
          strategyIds,
          ...(oxideComparison === undefined ? {} : { jxlOxide: oxideComparison }),
          ...comparison,
        }),
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failures.push(
        Object.freeze({
          id,
          classification:
            error instanceof ImageError && error.code === 'UNSUPPORTED_OPERATION'
              ? 'unsupported'
              : message.startsWith('oracle mismatch:') || message.startsWith('jxl-oxide mismatch:')
                ? 'incorrect-output'
                : 'harness',
          ...(error instanceof ImageError ? { code: error.code } : {}),
          message,
        }),
      )
      console.warn(`M3 corpus ${id} failed: ${message}`)
    }
  }
  console.log(
    `M3 corpus ${photoIndex + 1}/${photos.length}: ${results.length} pass, ${failures.length} fail`,
  )
}

const sortedDecodeTimes = results
  .map(({ decodeMilliseconds }) => decodeMilliseconds)
  .sort((a, b) => a - b)
const sortedRatios = results
  .map(({ decodeMilliseconds, djxlMilliseconds }) => decodeMilliseconds / djxlMilliseconds)
  .sort((a, b) => a - b)
const expectedFiles = photos.length * 3
const realDecodeRate = results.length / expectedFiles
const incorrectOutputs = failures.filter(
  ({ classification }) => classification === 'incorrect-output',
)
const nonExplicitFailures = failures.filter(
  ({ classification }) => classification !== 'unsupported',
)
const report = Object.freeze({
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  node: process.version,
  platform: `${process.platform}/${process.arch}`,
  corpus: Object.freeze({
    dataset: 'COCO 2017 validation images',
    photographs: photos.length,
    files: photos.length * 3,
    dimensions:
      '100 resized real photographs from 1 to 24 MP; source identity and license retained',
    encoders: Object.freeze(['libjxl a7a9c787341cf703dede03c2009fa460cae5e5df', 'Imazen d63e9d1']),
    libjxlDistances: Object.freeze(distances),
    libjxlEfforts: Object.freeze(efforts),
  }),
  acceptance: Object.freeze({
    passed:
      realDecodeRate >= 0.99 && incorrectOutputs.length === 0 && nonExplicitFailures.length === 0,
    decoded: results.length,
    failed: failures.length,
    realDecodeRate,
    incorrectOutputs: incorrectOutputs.length,
    explicitUnsupported: failures.length - nonExplicitFailures.length,
    maximumError: Math.max(0, ...results.map(({ maximumError }) => maximumError)),
    maximumRmse: Math.max(0, ...results.map(({ rmse }) => rmse)),
    rmseThreshold: 0.55,
    rmseThresholdBasis:
      '8-bit XYB conversion rounding; pinned jxl-oxide independently reaches RMSE 0.517758 against djxl on the threshold probe while agreeing within one sample value',
    medianDecodeMilliseconds: sortedDecodeTimes[Math.floor(sortedDecodeTimes.length / 2)] ?? 0,
    medianDjxlRatio: sortedRatios[Math.floor(sortedRatios.length / 2)] ?? 0,
    jxlOxideComparisons: results.filter(({ jxlOxide: value }) => value !== undefined).length,
  }),
  photos: Object.freeze(
    photos.map((photo) =>
      Object.freeze({
        id: photo.id,
        sourcePath: photo.sourcePath,
        cocoUrl: photo.cocoUrl,
        originalUrl: photo.originalUrl,
        license: photo.license,
      }),
    ),
  ),
  failures: Object.freeze(failures),
  results: Object.freeze(results),
})
await writeFile(reportPath, `${JSON.stringify(report, undefined, 2)}\n`)
console.log(JSON.stringify(report.acceptance, undefined, 2))
if (!report.acceptance.passed) throw new Error(`M3 corpus failed ${failures.length} cases`)
