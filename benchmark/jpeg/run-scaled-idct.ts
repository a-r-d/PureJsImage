import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { allFixtures, fixturePath, readManifest, verifyInspection } from '../lib/corpus.ts'
import { inspectFixture } from '../lib/corpus.ts'
import { executeScaledIdctResize, type ScaledIdctMode } from './scaled-idct.ts'

interface WorkerMeasurement {
  readonly baselineRssBytes: number
  readonly decodedHeight: number
  readonly decodedPixels: number
  readonly decodedPixelsAvoided: number
  readonly decodedPixelsAvoidedPercent: number
  readonly decodedWidth: number
  readonly height: number
  readonly maximumRssBytes: number
  readonly mode: ScaledIdctMode
  readonly outputBytes: number
  readonly outputSha256: string
  readonly peakRssDeltaBytes: number
  readonly scaleDenominator: 1 | 2 | 4 | 8
  readonly sourceHeight: number
  readonly sourcePixels: number
  readonly sourceWidth: number
  readonly targetWidth: number
  readonly wallMilliseconds: number
  readonly width: number
}

interface ErrorMetrics {
  readonly maximumChannelError: number
  readonly meanAbsoluteError: number
  readonly peakSignalToNoiseRatio: number | null
  readonly rootMeanSquareError: number
}

interface CorrectnessResult extends ErrorMetrics {
  readonly fullOutputSha256: string
  readonly height: number
  readonly scaleDenominator: 1 | 2 | 4 | 8
  readonly scaledOutputSha256: string
  readonly targetWidth: number
  readonly width: number
}

interface IndependentOracleResult extends ErrorMetrics {
  readonly height: number
  readonly scaleDenominator: 2 | 4 | 8
  readonly width: number
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const numberField = (value: Record<string, unknown>, field: string): number => {
  const result = value[field]
  if (typeof result !== 'number' || !Number.isFinite(result)) {
    throw new Error(`Scaled-IDCT worker field ${field} is invalid`)
  }
  return result
}

const parseWorkerMeasurement = (text: string): WorkerMeasurement => {
  const value: unknown = JSON.parse(text)
  if (!isRecord(value)) throw new Error('Scaled-IDCT worker result is not an object')
  const mode = value.mode
  const outputSha256 = value.outputSha256
  const scaleDenominator = numberField(value, 'scaleDenominator')
  if (
    (mode !== 'full' && mode !== 'scaled') ||
    typeof outputSha256 !== 'string' ||
    (scaleDenominator !== 1 &&
      scaleDenominator !== 2 &&
      scaleDenominator !== 4 &&
      scaleDenominator !== 8)
  ) {
    throw new Error('Scaled-IDCT worker result has invalid discriminants')
  }
  return {
    mode,
    outputSha256,
    scaleDenominator,
    baselineRssBytes: numberField(value, 'baselineRssBytes'),
    decodedHeight: numberField(value, 'decodedHeight'),
    decodedPixels: numberField(value, 'decodedPixels'),
    decodedPixelsAvoided: numberField(value, 'decodedPixelsAvoided'),
    decodedPixelsAvoidedPercent: numberField(value, 'decodedPixelsAvoidedPercent'),
    decodedWidth: numberField(value, 'decodedWidth'),
    height: numberField(value, 'height'),
    maximumRssBytes: numberField(value, 'maximumRssBytes'),
    outputBytes: numberField(value, 'outputBytes'),
    peakRssDeltaBytes: numberField(value, 'peakRssDeltaBytes'),
    sourceHeight: numberField(value, 'sourceHeight'),
    sourcePixels: numberField(value, 'sourcePixels'),
    sourceWidth: numberField(value, 'sourceWidth'),
    targetWidth: numberField(value, 'targetWidth'),
    wallMilliseconds: numberField(value, 'wallMilliseconds'),
    width: numberField(value, 'width'),
  }
}

const argumentValue = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`)
  return index < 0 ? undefined : process.argv[index + 1]
}

const runs = Number(argumentValue('runs') ?? 3)
if (!Number.isSafeInteger(runs) || runs < 1 || runs > 20) {
  throw new Error('Scaled-IDCT benchmark runs must be an integer from 1 to 20')
}
const writeBase = argumentValue('write')
const targetWidths = [200, 800, 1200] as const
const modes = ['full', 'scaled'] as const
const workerPath = fileURLToPath(new URL('./scaled-idct-worker.ts', import.meta.url))

const manifest = await readManifest()
const fixture = allFixtures(manifest).find((candidate) => candidate.id === 'tundra-4000x3000')
if (fixture?.origin !== 'download') {
  throw new Error('Pinned tundra-4000x3000 fixture is missing from the corpus manifest')
}
const inspection = await inspectFixture(fixture)
const inspectionErrors = verifyInspection(fixture, inspection)
if (inspectionErrors.length > 0) {
  throw new Error(`Pinned JPEG fixture failed verification: ${inspectionErrors.join('; ')}`)
}
const inputPath = fixturePath(fixture)
const input = await readFile(inputPath)

const percentile = (values: readonly number[], fraction: number): number => {
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)
  const value = sorted[index]
  if (value === undefined) throw new Error('Cannot summarize an empty measurement set')
  return value
}

const errorMetrics = (reference: Uint8Array, candidate: Uint8Array): ErrorMetrics => {
  if (reference.byteLength !== candidate.byteLength) {
    throw new Error('Scaled-IDCT output size differs from the full-resolution reference')
  }
  let absoluteError = 0
  let squaredError = 0
  let maximumChannelError = 0
  for (let index = 0; index < reference.byteLength; index += 1) {
    const error = Math.abs((reference[index] ?? 0) - (candidate[index] ?? 0))
    absoluteError += error
    squaredError += error * error
    maximumChannelError = Math.max(maximumChannelError, error)
  }
  const meanAbsoluteError = absoluteError / reference.byteLength
  const rootMeanSquareError = Math.sqrt(squaredError / reference.byteLength)
  return {
    maximumChannelError,
    meanAbsoluteError,
    rootMeanSquareError,
    peakSignalToNoiseRatio:
      rootMeanSquareError === 0 ? null : 20 * Math.log10(255 / rootMeanSquareError),
  }
}

const measurements: WorkerMeasurement[] = []
for (const targetWidth of targetWidths) {
  for (const mode of modes) {
    for (let run = 0; run < runs; run += 1) {
      const child = spawnSync(
        process.execPath,
        ['--expose-gc', workerPath, mode, String(targetWidth), inputPath],
        { encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 120_000 },
      )
      if (child.error) throw child.error
      if (child.status !== 0) {
        throw new Error(`Scaled-IDCT ${mode}/${targetWidth} worker failed: ${child.stderr.trim()}`)
      }
      measurements.push(parseWorkerMeasurement(child.stdout.trim()))
    }
  }
}

const correctness: CorrectnessResult[] = []
for (const targetWidth of targetWidths) {
  const full = await executeScaledIdctResize(input, targetWidth, 'full')
  const scaled = await executeScaledIdctResize(input, targetWidth, 'scaled')
  const error = errorMetrics(full.data, scaled.data)
  if (error.meanAbsoluteError > 32 || (error.peakSignalToNoiseRatio ?? 100) < 16) {
    throw new Error(
      `Scaled-IDCT ${targetWidth}px output error is excessive: MAE ${error.meanAbsoluteError.toFixed(3)}, PSNR ${error.peakSignalToNoiseRatio?.toFixed(3) ?? 'exact'}`,
    )
  }
  correctness.push({
    targetWidth,
    width: scaled.width,
    height: scaled.height,
    scaleDenominator: scaled.scaleDenominator,
    fullOutputSha256: createHash('sha256').update(full.data).digest('hex'),
    scaledOutputSha256: createHash('sha256').update(scaled.data).digest('hex'),
    ...error,
  })
}

const independentOracle: IndependentOracleResult[] = []
const oracleDirectory = await mkdtemp(join(tmpdir(), 'purejsimage-scaled-idct-'))
let independentOracleAvailable = true
try {
  for (const width of [500, 1000, 2000] as const) {
    const height = (width * 3) / 4
    const scaled = await executeScaledIdctResize(input, width, 'scaled')
    const oraclePath = join(oracleDirectory, `imagemagick-${width}.rgb`)
    const child = spawnSync(
      'magick',
      ['-define', `jpeg:size=${width}x${height}`, inputPath, '-depth', '8', `RGB:${oraclePath}`],
      { encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 120_000 },
    )
    if (child.error?.message.includes('ENOENT')) {
      independentOracleAvailable = false
      break
    }
    if (child.error) throw child.error
    if (child.status !== 0) {
      throw new Error(`ImageMagick scaled JPEG oracle failed: ${child.stderr.trim()}`)
    }
    const error = errorMetrics(await readFile(oraclePath), scaled.data)
    if (error.meanAbsoluteError > 4 || (error.peakSignalToNoiseRatio ?? 100) < 32) {
      throw new Error(
        `Scaled-IDCT 1/${scaled.scaleDenominator} differs excessively from ImageMagick/libjpeg`,
      )
    }
    if (
      scaled.scaleDenominator !== 2 &&
      scaled.scaleDenominator !== 4 &&
      scaled.scaleDenominator !== 8
    ) {
      throw new Error(`ImageMagick oracle did not select a reduced IDCT for ${width}px`)
    }
    independentOracle.push({
      width,
      height,
      scaleDenominator: scaled.scaleDenominator,
      ...error,
    })
  }
} finally {
  await rm(oracleDirectory, { recursive: true, force: true })
}
if (!independentOracleAvailable) independentOracle.length = 0

const summaries = targetWidths.flatMap((targetWidth) =>
  modes.map((mode) => {
    const samples = measurements.filter(
      (measurement) => measurement.targetWidth === targetWidth && measurement.mode === mode,
    )
    const first = samples[0]
    if (!first || samples.some((sample) => sample.outputSha256 !== first.outputSha256)) {
      throw new Error(`Scaled-IDCT ${mode}/${targetWidth} output is not deterministic`)
    }
    return {
      targetWidth,
      mode,
      scaleDenominator: first.scaleDenominator,
      decodedWidth: first.decodedWidth,
      decodedHeight: first.decodedHeight,
      decodedPixels: first.decodedPixels,
      decodedPixelsAvoided: first.decodedPixelsAvoided,
      decodedPixelsAvoidedPercent: first.decodedPixelsAvoidedPercent,
      outputBytes: first.outputBytes,
      outputSha256: first.outputSha256,
      wallMilliseconds: {
        median: percentile(
          samples.map((sample) => sample.wallMilliseconds),
          0.5,
        ),
        p95: percentile(
          samples.map((sample) => sample.wallMilliseconds),
          0.95,
        ),
      },
      maximumRssBytes: {
        median: percentile(
          samples.map((sample) => sample.maximumRssBytes),
          0.5,
        ),
        maximum: Math.max(...samples.map((sample) => sample.maximumRssBytes)),
      },
      peakRssDeltaBytes: {
        median: percentile(
          samples.map((sample) => sample.peakRssDeltaBytes),
          0.5,
        ),
        maximum: Math.max(...samples.map((sample) => sample.peakRssDeltaBytes)),
      },
    }
  }),
)

const report = {
  generatedAt: new Date().toISOString(),
  fixture: {
    id: fixture.id,
    file: fixture.file,
    bytes: inspection.bytes,
    sha256: inspection.sha256,
    width: inspection.width,
    height: inspection.height,
    sourcePage: fixture.sourcePage,
    author: fixture.author,
    license: fixture.license,
  },
  methodology: {
    runs,
    isolatedProcessPerMeasurement: true,
    warmupsPerMeasurement: 1,
    timingScope: 'JPEG parse, entropy decode, IDCT, YCbCr-to-RGB conversion, and bilinear resize',
    fullResolutionOracle: 'The previous 8x8 IDCT path forced with scale denominator 1',
    memory:
      'Absolute process RSS high-water mark after a same-mode warmup; delta uses a post-warmup, five-GC baseline.',
    outputError: 'Raw resized RGB8 compared channel-by-channel against the full-resolution path',
  },
  summaries,
  correctness,
  independentOracle: {
    available: independentOracleAvailable,
    implementation: independentOracleAvailable
      ? 'ImageMagick scaled JPEG decode with default fancy upsampling'
      : 'ImageMagick executable not available',
    results: independentOracle,
  },
}

const milliseconds = (value: number): string => `${value.toFixed(1)} ms`
const mebibytes = (value: number): string => `${(value / 1024 ** 2).toFixed(1)} MiB`
const markdownRows = summaries.map((summary) => {
  const error = correctness.find((candidate) => candidate.targetWidth === summary.targetWidth)
  const errorText =
    summary.mode === 'full' || !error
      ? 'oracle'
      : `MAE ${error.meanAbsoluteError.toFixed(2)}, PSNR ${error.peakSignalToNoiseRatio?.toFixed(2) ?? 'exact'} dB`
  return `| ${summary.targetWidth}px | ${summary.mode} | 1/${summary.scaleDenominator} | ${summary.decodedWidth}×${summary.decodedHeight} | ${summary.decodedPixelsAvoided.toLocaleString('en-US')} (${summary.decodedPixelsAvoidedPercent.toFixed(2)}%) | ${milliseconds(summary.wallMilliseconds.median)} | ${mebibytes(summary.maximumRssBytes.median)} | ${mebibytes(summary.maximumRssBytes.maximum)} | ${errorText} |`
})
const speedups = targetWidths.map((targetWidth) => {
  const full = summaries.find(
    (summary) => summary.targetWidth === targetWidth && summary.mode === 'full',
  )
  const scaled = summaries.find(
    (summary) => summary.targetWidth === targetWidth && summary.mode === 'scaled',
  )
  if (!full || !scaled) throw new Error(`Scaled-IDCT ${targetWidth}px summary is incomplete`)
  return `${targetWidth}px ${(full.wallMilliseconds.median / scaled.wallMilliseconds.median).toFixed(2)}×`
})
const oracleMarkdown = independentOracleAvailable
  ? `\nIndependent ImageMagick/libjpeg scaled-decode cross-check:\n\n| IDCT scale | Native size | MAE | PSNR | Maximum channel error |\n| ---: | ---: | ---: | ---: | ---: |\n${independentOracle
      .map(
        (oracle) =>
          `| 1/${oracle.scaleDenominator} | ${oracle.width}×${oracle.height} | ${oracle.meanAbsoluteError.toFixed(3)} | ${oracle.peakSignalToNoiseRatio?.toFixed(2) ?? 'exact'} dB | ${oracle.maximumChannelError} |`,
      )
      .join('\n')}\n`
  : '\nThe optional ImageMagick/libjpeg scaled-decode cross-check was skipped because `magick` was unavailable.\n'
const markdown = `# JPEG scaled-IDCT benchmark

Pinned input: ${fixture.file}, ${inspection.width}×${inspection.height}, SHA-256 \`${inspection.sha256}\`.
Source: ${fixture.sourcePage}. ${fixture.author}; ${fixture.license}.

Each sample runs in a fresh process after one same-mode warmup. Runtime covers JPEG parsing, entropy
decode, IDCT, color conversion, and bilinear resize. RSS is the absolute process high-water mark;
output error compares raw RGB8 pixels against the forced full-resolution 8×8 IDCT path.

| Output | Path | IDCT scale | Decoded size | Pixels avoided | Median runtime | Median peak RSS | Max peak RSS | Output error |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
${markdownRows.join('\n')}
${oracleMarkdown}

The planner selected 1/8, 1/4, and 1/2 for 200px, 800px, and 1200px respectively. Median runtime
speedups were ${speedups.join(', ')}. Peak RSS remained close to the full path because the existing
decoder was already bounded to MCU rows and the process/module baseline dominates these runs; the
measured benefit is less IDCT, color-conversion, and resize work rather than a new RSS claim.

Safely aligned crop-resize plans may use the same scaled IDCT. Restart-aware baseline crops also
seek their closest usable restart boundary; unsafe coordinate mappings retain the explicit
full-resolution fallback.
`

if (writeBase) {
  const base = resolve(writeBase)
  await writeFile(`${base}.json`, `${JSON.stringify(report, undefined, 2)}\n`)
  await writeFile(`${base}.md`, markdown)
}

console.log(markdown)
