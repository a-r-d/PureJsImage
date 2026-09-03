import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { transcodeJpegToJpegXl } from '../../src/jpegxl.ts'

interface CorpusCase {
  readonly id: string
  readonly sourcePath: string
  readonly sha256: string
  readonly width: number
  readonly height: number
}

const object = (value: unknown, label: string): Readonly<Record<string, unknown>> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Readonly<Record<string, unknown>>
}

const string = (value: unknown, label: string): string => {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`)
  return value
}

const integer = (value: unknown, label: string): number => {
  if (!Number.isSafeInteger(value)) throw new Error(`${label} must be a safe integer`)
  return value as number
}

const parseCase = (value: unknown): CorpusCase => {
  const definition = object(value, 'corpus case')
  return Object.freeze({
    id: string(definition.id, 'corpus case id'),
    sourcePath: string(definition.sourcePath, 'corpus sourcePath'),
    sha256: string(definition.sha256, 'corpus sha256'),
    width: integer(definition.width, 'corpus width'),
    height: integer(definition.height, 'corpus height'),
  })
}

const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')

const percentile = (values: readonly number[], percentileValue: number): number => {
  if (values.length === 0) throw new Error('Cannot calculate a percentile without values')
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.ceil(percentileValue * sorted.length) - 1)] ?? 0
}

const run = async (command: string, arguments_: readonly string[]): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, { stdio: ['ignore', 'pipe', 'pipe'] })
    const standardOutput: Uint8Array[] = []
    const standardError: Uint8Array[] = []
    child.stdout.on('data', (chunk: Uint8Array) => standardOutput.push(chunk))
    child.stderr.on('data', (chunk: Uint8Array) => standardError.push(chunk))
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `${command} exited with status ${code ?? 'unknown'}: ${Buffer.concat(standardError).toString('utf8')}`,
          ),
        )
        return
      }
      resolve(Buffer.concat(standardOutput).toString('utf8'))
    })
  })

const toolsDirectory =
  process.argv[2] ?? '.tmp/jpegxl-oracles/libjxl-v0.12.0/source/build-pinned/tools'
const corpusDirectory = process.argv[3] ?? '.tmp/jpegxl-m1-coco'
const outputPath = process.argv[4] ?? 'benchmark/results/jpegxl-m1-real-corpus-2026-09-03.json'
const manifestPath = 'benchmark/jpegxl/production-program/corpora/jpeg-archive-coco-val2017.json'
const manifest = object(JSON.parse(await readFile(manifestPath, 'utf8')) as unknown, 'manifest')
if (!Array.isArray(manifest.cases)) throw new Error('Corpus manifest cases must be an array')
const cases = manifest.cases.map(parseCase)
if (cases.length !== 250) throw new Error(`Corpus has ${cases.length} cases; expected 250`)

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'purejsimage-jpegxl-m1-real-'))
const results = []
try {
  for (let index = 0; index < cases.length; index += 1) {
    const definition = cases[index]
    if (!definition) throw new Error('Corpus case is missing')
    const source = new Uint8Array(await readFile(join(corpusDirectory, definition.sourcePath)))
    if (sha256(source) !== definition.sha256) {
      throw new Error(`${definition.id} does not match its pinned SHA-256`)
    }
    const encoded = await transcodeJpegToJpegXl(source, { reconstruction: 'required' })
    const sourcePath = join(temporaryDirectory, 'source.jpg')
    const encodedPath = join(temporaryDirectory, 'encoded.jxl')
    const reconstructedPath = join(temporaryDirectory, 'reconstructed.jpg')
    const referencePath = join(temporaryDirectory, 'reference.jxl')
    await writeFile(sourcePath, source)
    await writeFile(encodedPath, encoded.data)
    await run(join(toolsDirectory, 'djxl'), [encodedPath, reconstructedPath])
    const reconstructed = new Uint8Array(await readFile(reconstructedPath))
    if (sha256(reconstructed) !== definition.sha256) {
      throw new Error(`${definition.id} differs after pinned djxl reconstruction`)
    }
    await run(join(toolsDirectory, 'cjxl'), [
      sourcePath,
      referencePath,
      '--lossless_jpeg=1',
      '--compress_boxes=0',
      '--effort=1',
    ])
    const reference = new Uint8Array(await readFile(referencePath))
    if (index === 0) {
      const inspection = await run(join(toolsDirectory, 'jxlinfo'), [encodedPath])
      if (!inspection.toLowerCase().includes('jpeg bitstream reconstruction data')) {
        throw new Error('Pinned jxlinfo did not report JPEG reconstruction data')
      }
      const guarded = await transcodeJpegToJpegXl(source, {
        reconstruction: 'required',
        onlyIfSmaller: true,
      })
      if (guarded.data.byteLength >= source.byteLength) {
        throw new Error('onlyIfSmaller emitted a non-smaller real-corpus output')
      }
    }
    results.push(
      Object.freeze({
        id: definition.id,
        width: definition.width,
        height: definition.height,
        sourceBytes: source.byteLength,
        jxlBytes: encoded.data.byteLength,
        libjxlBytes: reference.byteLength,
        savingsPercentage: encoded.savingsPercentage,
        ratioToLibjxl: encoded.data.byteLength / reference.byteLength,
        elapsedMilliseconds: encoded.elapsedMilliseconds,
        managedPeakBytes: encoded.managedPeakBytes,
        sourceSha256: definition.sha256,
        jxlSha256: sha256(encoded.data),
        reconstructedSha256: sha256(reconstructed),
        exact: true,
      }),
    )
    if ((index + 1) % 25 === 0) console.log(`Completed ${index + 1}/${cases.length}`)
  }

  const savings = results.map(({ savingsPercentage }) => savingsPercentage)
  const ratios = results.map(({ ratioToLibjxl }) => ratioToLibjxl)
  const smallerCases = savings.filter((saving) => saving > 0).length
  const outliers = results
    .filter(({ ratioToLibjxl }) => ratioToLibjxl > 1.35)
    .map(({ id, ratioToLibjxl, sourceBytes }) => Object.freeze({ id, ratioToLibjxl, sourceBytes }))
  const gate = Object.freeze({
    passed:
      results.every(({ exact }) => exact) &&
      smallerCases / results.length >= 0.9 &&
      percentile(savings, 0.5) >= 12 &&
      percentile(savings, 0.1) >= 0 &&
      percentile(ratios, 0.5) <= 1.1 &&
      percentile(ratios, 0.9) <= 1.2 &&
      outliers.length === 0,
    exactCases: results.filter(({ exact }) => exact).length,
    totalCases: results.length,
    smallerRate: smallerCases / results.length,
    medianSavingsPercentage: percentile(savings, 0.5),
    p10SavingsPercentage: percentile(savings, 0.1),
    medianRatioToLibjxl: percentile(ratios, 0.5),
    p90RatioToLibjxl: percentile(ratios, 0.9),
    worstRatioToLibjxl: Math.max(...ratios),
    unexplainedOutliers: Object.freeze(outliers),
  })
  const report = Object.freeze({
    schemaVersion: 1,
    revision: spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim(),
    corpusManifest: manifestPath,
    oracle: 'libjxl a7a9c787341cf703dede03c2009fa460cae5e5df (v0.12.0)',
    exactnessOracle: 'pinned djxl byte-for-byte reconstruction and SHA-256',
    results: Object.freeze(results),
    milestone1CompressionGate: gate,
  })
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(gate, null, 2))
  if (!gate.passed) process.exitCode = 1
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true })
}
