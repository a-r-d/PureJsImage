import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { jpegxlCodec } from '../../src/codecs/jpegxl.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { MemorySource } from '../../src/source.ts'

interface CorpusResult {
  readonly id: string
  readonly megapixels: number
  readonly groupCount: number
  readonly strategyIds: readonly number[]
}

interface CorpusReport {
  readonly results: readonly CorpusResult[]
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const parseCorpusReport = (value: unknown): CorpusReport => {
  if (!isRecord(value) || !Array.isArray(value.results))
    throw new Error('M3 corpus report is invalid')
  return Object.freeze({
    results: Object.freeze(
      value.results.map((candidate): CorpusResult => {
        if (!isRecord(candidate) || typeof candidate.id !== 'string') {
          throw new Error('M3 corpus result is invalid')
        }
        if (
          typeof candidate.megapixels !== 'number' ||
          typeof candidate.groupCount !== 'number' ||
          !Array.isArray(candidate.strategyIds) ||
          !candidate.strategyIds.every((item) => typeof item === 'number')
        ) {
          throw new Error(`M3 corpus result ${candidate.id} is incomplete`)
        }
        return Object.freeze({
          id: candidate.id,
          megapixels: candidate.megapixels,
          groupCount: candidate.groupCount,
          strategyIds: Object.freeze(candidate.strategyIds),
        })
      }),
    ),
  })
}

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

const decode = async (
  data: Uint8Array,
): Promise<Readonly<{ milliseconds: number; bytes: number }>> => {
  const started = performance.now()
  const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(data), defaultImageLimits)
  if (!decoder) throw new Error('PureJsImage JPEG XL decoder is unavailable')
  let bytes = 0
  for await (const block of decoder.decode()) {
    bytes += block.data.length
    block.release?.()
  }
  return Object.freeze({ milliseconds: performance.now() - started, bytes })
}

const argumentsAfter = (flag: string): string | undefined => {
  const index = process.argv.indexOf(flag)
  return index < 0 ? undefined : process.argv[index + 1]
}

const corpusReportPath =
  argumentsAfter('--corpus-report') ??
  'benchmark/jpegxl/production-program/m3-common-static-report.json'
const workDirectory = argumentsAfter('--work') ?? '.tmp/jpegxl-m3-common-static'
const outputPath =
  argumentsAfter('--output') ?? 'benchmark/jpegxl/production-program/m3-performance-report.json'
const corpus = parseCorpusReport(JSON.parse(await readFile(corpusReportPath, 'utf8')))
const dct8 = corpus.results.filter(
  ({ strategyIds }) => strategyIds.length === 1 && strategyIds[0] === 0,
)
const closest = (megapixels: number): CorpusResult => {
  const selected = [...dct8].sort(
    (left, right) =>
      Math.abs(left.megapixels - megapixels) - Math.abs(right.megapixels - megapixels),
  )[0]
  if (!selected) throw new Error(`No DCT8 corpus case is available near ${megapixels} MP`)
  return selected
}

const cases = [closest(12), closest(24)] as const
const measurements = []
for (const selected of cases) {
  const data = new Uint8Array(await readFile(join(workDirectory, `${selected.id}.jxl`)))
  await decode(data)
  const repetitions = []
  let decodedBytes = 0
  for (let repetition = 0; repetition < 3; repetition += 1) {
    const result = await decode(data)
    repetitions.push(result.milliseconds)
    decodedBytes = result.bytes
  }
  const medianMilliseconds = median(repetitions)
  measurements.push(
    Object.freeze({
      id: selected.id,
      megapixels: selected.megapixels,
      groupCount: selected.groupCount,
      decodedBytes,
      repetitions: Object.freeze(repetitions),
      medianMilliseconds,
      millisecondsPerMegapixel: medianMilliseconds / selected.megapixels,
    }),
  )
}
const twelve = measurements[0]!
const twentyFour = measurements[1]!
const normalized = measurements.map(({ millisecondsPerMegapixel }) => millisecondsPerMegapixel)
const groupScalingRatio = Math.max(...normalized) / Math.min(...normalized)
const report = Object.freeze({
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  node: process.version,
  platform: `${process.platform}/${process.arch}`,
  methodology:
    'One warmup and three measured decodes per pinned DCT8 file in one Node process; medians are reported. Group scaling compares 195 groups at 12 MP with 391 groups at 24 MP.',
  acceptance: Object.freeze({
    passed:
      twelve.medianMilliseconds <= 5_000 &&
      twentyFour.medianMilliseconds <= 12_000 &&
      groupScalingRatio <= 2,
    twelveMegapixelMilliseconds: twelve.medianMilliseconds,
    twentyFourMegapixelMilliseconds: twentyFour.medianMilliseconds,
    groupScalingRatio,
    groupScalingLimit: 2,
  }),
  measurements: Object.freeze(measurements),
})
await writeFile(outputPath, `${JSON.stringify(report, undefined, 2)}\n`)
console.log(JSON.stringify(report, undefined, 2))
if (!report.acceptance.passed) throw new Error('M3 repeated performance gate failed')
