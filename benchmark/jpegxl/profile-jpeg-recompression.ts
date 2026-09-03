import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'

import {
  parseJpegCoefficientImage,
  type JpegCoefficientComponent,
} from '../../src/codecs/jpeg-coefficients.ts'
import { parseJpegReconstructionData } from '../../src/codecs/jpegxl-jpeg-data.ts'
import {
  encodeJpegCoefficientImageAsJpegXl,
  type JpegXlJpegEncodeStage,
} from '../../src/codecs/jpegxl-jpeg-encode.ts'
import { reconstructJpegFromCoefficientImage } from '../../src/codecs/jpegxl-jpeg-reconstruct.ts'
import { reconstructJpegFromJpegXl } from '../../src/codecs/jpegxl-jpeg-reconstruct-source.ts'
import { encodeJpegXlJpegReconstruction } from '../../src/codecs/jpegxl-jpeg-reconstruction.ts'
import { resolveJpegXlLimits } from '../../src/codecs/jpegxl-limits.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { MemorySource } from '../../src/source.ts'

const cases = Object.freeze([
  Object.freeze({
    id: 'small-baseline',
    path: 'benchmark/corpus/files/jpeg-reference/generated-sof1-8bit.jpg',
  }),
  Object.freeze({ id: 'baseline-12mp', path: 'benchmark/corpus/files/tundra-4000x3000.jpg' }),
  Object.freeze({
    id: 'progressive-12mp',
    path: 'benchmark/corpus/files/tundra-4000x3000-progressive.jpg',
  }),
])

const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')

const exact = (left: Uint8Array, right: Uint8Array): boolean =>
  left.byteLength === right.byteLength && left.every((value, index) => right[index] === value)

const naturalOrder = (): Uint8Array => {
  const output = new Uint8Array(64)
  let next = 1
  for (let diagonal = 1; diagonal < 15; diagonal += 1) {
    for (let step = 0; step <= diagonal; step += 1) {
      let x = step
      let y = diagonal - step
      if ((diagonal & 1) !== 0) [x, y] = [y, x]
      if (x < 8 && y < 8) output[next++] = (x * 8 + y) & 63
    }
  }
  return output
}

const scanOrder = naturalOrder()

const percentile = (values: readonly number[], fraction: number): number => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)] ?? 0
}

const predictorProfile = (
  component: JpegCoefficientComponent,
): Readonly<Record<string, number>> => {
  const totals = { left: 0, top: 0, average: 0, gradient: 0 }
  for (let y = 0; y < component.blocksPerColumnForMcu; y += 1) {
    for (let x = 0; x < component.blocksPerLineForMcu; x += 1) {
      const index = (y * component.blocksPerLineForMcu + x) * 64
      const sample = component.coefficients[index] ?? 0
      const left =
        x > 0
          ? (component.coefficients[index - 64] ?? 0)
          : y > 0
            ? (component.coefficients[index - component.blocksPerLineForMcu * 64] ?? 0)
            : 0
      const top =
        y > 0 ? (component.coefficients[index - component.blocksPerLineForMcu * 64] ?? 0) : left
      const topLeft =
        x > 0 && y > 0
          ? (component.coefficients[index - component.blocksPerLineForMcu * 64 - 64] ?? 0)
          : left
      const gradient = Math.max(
        Math.min(left, top),
        Math.min(Math.max(left, top), left + top - topLeft),
      )
      totals.left += Math.abs(sample - left)
      totals.top += Math.abs(sample - top)
      totals.average += Math.abs(sample - Math.trunc((left + top) / 2))
      totals.gradient += Math.abs(sample - gradient)
    }
  }
  return Object.freeze(totals)
}

const componentProfile = (
  component: JpegCoefficientComponent,
): Readonly<Record<string, unknown>> => {
  const blocks = component.blocksPerLineForMcu * component.blocksPerColumnForMcu
  const nonzeroByFrequency = new Uint32Array(64)
  const zeroRuns = new Uint32Array(64)
  const eobPositions: number[] = []
  const nonzeroCounts = new Uint8Array(blocks)
  let acCoefficients = 0
  let zeroAcCoefficients = 0
  for (let block = 0; block < blocks; block += 1) {
    const base = block * 64
    let run = 0
    let eob = 0
    let nonzero = 0
    for (let scan = 1; scan < 64; scan += 1) {
      const position = scanOrder[scan] ?? 0
      const coefficient = component.coefficients[base + position] ?? 0
      acCoefficients += 1
      if (coefficient === 0) {
        zeroAcCoefficients += 1
        run += 1
        continue
      }
      nonzeroByFrequency[scan] = (nonzeroByFrequency[scan] ?? 0) + 1
      zeroRuns[Math.min(63, run)] = (zeroRuns[Math.min(63, run)] ?? 0) + 1
      run = 0
      eob = scan
      nonzero += 1
    }
    nonzeroCounts[block] = nonzero
    eobPositions.push(eob)
  }
  let leftDelta = 0
  let topDelta = 0
  let leftPairs = 0
  let topPairs = 0
  let maximumEob = 0
  for (const position of eobPositions) maximumEob = Math.max(maximumEob, position)
  for (let y = 0; y < component.blocksPerColumnForMcu; y += 1) {
    for (let x = 0; x < component.blocksPerLineForMcu; x += 1) {
      const index = y * component.blocksPerLineForMcu + x
      if (x > 0) {
        leftDelta += Math.abs((nonzeroCounts[index] ?? 0) - (nonzeroCounts[index - 1] ?? 0))
        leftPairs += 1
      }
      if (y > 0) {
        topDelta += Math.abs(
          (nonzeroCounts[index] ?? 0) - (nonzeroCounts[index - component.blocksPerLineForMcu] ?? 0),
        )
        topPairs += 1
      }
    }
  }
  return Object.freeze({
    id: component.id,
    sampling: `${component.horizontalSampling}x${component.verticalSampling}`,
    quantizationTable: component.quantizationTable,
    quantization: Array.from(component.quantization),
    blocks,
    acZeroRate: acCoefficients === 0 ? 0 : zeroAcCoefficients / acCoefficients,
    nonzeroByFrequency: Array.from(nonzeroByFrequency),
    zeroRunHistogram: Array.from(zeroRuns),
    eob: Object.freeze({
      median: percentile(eobPositions, 0.5),
      p90: percentile(eobPositions, 0.9),
      maximum: maximumEob,
    }),
    neighboringBlockContext: Object.freeze({
      meanAbsoluteLeftNonzeroDelta: leftPairs === 0 ? 0 : leftDelta / leftPairs,
      meanAbsoluteTopNonzeroDelta: topPairs === 0 ? 0 : topDelta / topPairs,
    }),
    dcPredictorAbsoluteResiduals: predictorProfile(component),
  })
}

const limits = resolveJpegXlLimits()
const results = []
for (const definition of cases) {
  const input = new Uint8Array(await readFile(definition.path))
  let started = performance.now()
  const image = await parseJpegCoefficientImage(
    new MemorySource(input),
    defaultImageLimits,
    defaultImageLimits.maxDecodedBytes,
  )
  const coefficientParseMilliseconds = performance.now() - started
  if (!image) throw new Error(`${definition.id} did not produce JPEG coefficients`)

  started = performance.now()
  const reconstruction = parseJpegReconstructionData(input, image, limits)
  const reconstructionParseMilliseconds = performance.now() - started
  started = performance.now()
  const canonical = reconstructJpegFromCoefficientImage(
    reconstruction.header,
    reconstruction.blobs,
    image,
    {},
    limits.maxReconstructedJpegBytes,
  )
  const sourceExactnessCheckMilliseconds = performance.now() - started
  if (!exact(canonical, input)) throw new Error(`${definition.id} canonical JPEG is not exact`)

  started = performance.now()
  const reconstructionPayload = encodeJpegXlJpegReconstruction(
    reconstruction.header,
    reconstruction.blobs,
    limits,
  )
  const jbrdAssemblyMilliseconds = performance.now() - started
  const stages: { stage: JpegXlJpegEncodeStage; milliseconds: number; bytes: number }[] = []
  const encoded = encodeJpegCoefficientImageAsJpegXl(
    image,
    reconstructionPayload,
    limits,
    undefined,
    { record: (stage, milliseconds, bytes) => stages.push({ stage, milliseconds, bytes }) },
  )
  started = performance.now()
  const rebuilt = await reconstructJpegFromJpegXl(encoded)
  const exactVerificationMilliseconds = performance.now() - started
  if (!exact(rebuilt, input))
    throw new Error(`${definition.id} JPEG XL reconstruction is not exact`)

  results.push(
    Object.freeze({
      id: definition.id,
      path: definition.path,
      width: image.width,
      height: image.height,
      progressive: image.progressive,
      sourceBytes: input.byteLength,
      outputBytes: encoded.byteLength,
      savingsPercentage: ((input.byteLength - encoded.byteLength) / input.byteLength) * 100,
      sourceSha256: sha256(input),
      outputSha256: sha256(encoded),
      reconstructionPayloadBytes: reconstructionPayload.byteLength,
      opaqueReconstructionBytes: reconstruction.blobs.decodedBytes,
      timings: Object.freeze({
        coefficientParseMilliseconds,
        reconstructionParseMilliseconds,
        sourceExactnessCheckMilliseconds,
        jbrdAssemblyMilliseconds,
        exactVerificationMilliseconds,
        encoderStages: Object.freeze(stages),
      }),
      coefficientSparsity: Object.freeze(image.components.map(componentProfile)),
    }),
  )
}

const report = Object.freeze({
  schemaVersion: 1,
  purpose: 'Milestone 1 exact JPEG recompression profile before and after entropy changes',
  results: Object.freeze(results),
})
const outputIndex = process.argv.indexOf('--output')
const output = outputIndex < 0 ? undefined : process.argv[outputIndex + 1]
if (outputIndex >= 0 && !output) throw new Error('--output requires a path')
if (output) await writeFile(output, `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, undefined, 2))
