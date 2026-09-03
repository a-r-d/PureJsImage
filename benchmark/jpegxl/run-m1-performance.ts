import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { transcodeJpegToJpegXl } from '../../src/jpegxl.ts'

const cases = Object.freeze([
  Object.freeze({
    id: 'baseline-12mp',
    path: 'benchmark/corpus/files/tundra-4000x3000.jpg',
    sha256: 'af55711534d744a385a805d7c0ff20c7e32c19f9fb886b468b078af24ddb8ab6',
  }),
  Object.freeze({
    id: 'progressive-12mp',
    path: 'benchmark/corpus/files/tundra-4000x3000-progressive.jpg',
    sha256: '680f4c1ab6fc7e40f0ddf314ad1c6006fddc8519f19b7a613cbd9d8b948bc03e',
  }),
])

const measuredRuns = 3
const m0FastestLargePhotoMilliseconds = 69_600

const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')

const median = (values: readonly number[]): number => {
  if (values.length === 0) throw new Error('Cannot calculate a median without values')
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  if ((sorted.length & 1) !== 0) return sorted[middle] ?? 0
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
}

const run = async (command: string, arguments_: readonly string[]): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, { stdio: ['ignore', 'ignore', 'pipe'] })
    const standardError: Uint8Array[] = []
    child.stderr.on('data', (chunk: Uint8Array) => standardError.push(chunk))
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(
        new Error(
          `${command} exited with status ${code ?? 'unknown'}: ${Buffer.concat(standardError).toString('utf8')}`,
        ),
      )
    })
  })

const valueAfter = (name: string): string | undefined => {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}

const toolsDirectory =
  valueAfter('--oracle-dir') ?? '.tmp/jpegxl-oracles/libjxl-v0.12.0/source/build-pinned/tools'
const outputPath =
  valueAfter('--output') ?? 'benchmark/results/jpegxl-m1-performance-2026-09-03.json'
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'purejsimage-jpegxl-m1-performance-'))
const results = []

try {
  for (const definition of cases) {
    const source = new Uint8Array(await readFile(definition.path))
    if (sha256(source) !== definition.sha256) {
      throw new Error(`${definition.id} source does not match its pinned SHA-256`)
    }

    const pureJsImageMilliseconds: number[] = []
    const libjxlExactWorkflowMilliseconds: number[] = []
    let outputBytes = 0
    let libjxlBytes = 0
    for (let runIndex = -1; runIndex < measuredRuns; runIndex += 1) {
      const pureJsImageStarted = performance.now()
      const encoded = await transcodeJpegToJpegXl(source, { reconstruction: 'required' })
      const pureJsImageElapsed = performance.now() - pureJsImageStarted
      const pureJsImagePath = join(temporaryDirectory, `${definition.id}-${runIndex}-pure.jxl`)
      const pureJsImageReconstructedPath = join(
        temporaryDirectory,
        `${definition.id}-${runIndex}-pure.jpg`,
      )
      await writeFile(pureJsImagePath, encoded.data)
      await run(join(toolsDirectory, 'djxl'), [pureJsImagePath, pureJsImageReconstructedPath])
      const pureJsImageReconstructed = new Uint8Array(await readFile(pureJsImageReconstructedPath))
      if (sha256(pureJsImageReconstructed) !== definition.sha256) {
        throw new Error(
          `${definition.id} PureJsImage output failed pinned djxl exact reconstruction`,
        )
      }

      const sourcePath = join(temporaryDirectory, `${definition.id}-${runIndex}.jpg`)
      const libjxlPath = join(temporaryDirectory, `${definition.id}-${runIndex}-libjxl.jxl`)
      const libjxlReconstructedPath = join(
        temporaryDirectory,
        `${definition.id}-${runIndex}-libjxl.jpg`,
      )
      await writeFile(sourcePath, source)
      const libjxlStarted = performance.now()
      await run(join(toolsDirectory, 'cjxl'), [
        sourcePath,
        libjxlPath,
        '--lossless_jpeg=1',
        '--compress_boxes=0',
        '--effort=1',
      ])
      await run(join(toolsDirectory, 'djxl'), [libjxlPath, libjxlReconstructedPath])
      const libjxlReconstructed = new Uint8Array(await readFile(libjxlReconstructedPath))
      const libjxlElapsed = performance.now() - libjxlStarted
      if (sha256(libjxlReconstructed) !== definition.sha256) {
        throw new Error(`${definition.id} pinned libjxl workflow failed exact reconstruction`)
      }

      outputBytes = encoded.data.byteLength
      libjxlBytes = (await readFile(libjxlPath)).byteLength
      if (runIndex >= 0) {
        pureJsImageMilliseconds.push(pureJsImageElapsed)
        libjxlExactWorkflowMilliseconds.push(libjxlElapsed)
      }
    }

    results.push(
      Object.freeze({
        id: definition.id,
        sourceBytes: source.byteLength,
        outputBytes,
        libjxlBytes,
        exact: true,
        pureJsImageMilliseconds: Object.freeze(pureJsImageMilliseconds),
        pureJsImageMedianMilliseconds: median(pureJsImageMilliseconds),
        libjxlExactWorkflowMilliseconds: Object.freeze(libjxlExactWorkflowMilliseconds),
        libjxlExactWorkflowMedianMilliseconds: median(libjxlExactWorkflowMilliseconds),
      }),
    )
  }

  const pureJsImageMeasurements = results.flatMap(({ pureJsImageMilliseconds }) =>
    Array.from(pureJsImageMilliseconds),
  )
  const libjxlMeasurements = results.flatMap(({ libjxlExactWorkflowMilliseconds }) =>
    Array.from(libjxlExactWorkflowMilliseconds),
  )
  const slowestLargePhotoMedianMilliseconds = Math.max(
    ...results.map(({ pureJsImageMedianMilliseconds }) => pureJsImageMedianMilliseconds),
  )
  const pureJsImageMedianMilliseconds = median(pureJsImageMeasurements)
  const libjxlExactWorkflowMedianMilliseconds = median(libjxlMeasurements)
  const gate = Object.freeze({
    passed:
      results.every(({ exact }) => exact) &&
      slowestLargePhotoMedianMilliseconds <= 15_000 &&
      m0FastestLargePhotoMilliseconds / slowestLargePhotoMedianMilliseconds >= 5 &&
      pureJsImageMedianMilliseconds / libjxlExactWorkflowMedianMilliseconds <= 8,
    exactCases: results.filter(({ exact }) => exact).length,
    totalCases: results.length,
    slowestLargePhotoMedianMilliseconds,
    maximumLargePhotoMilliseconds: Math.max(...pureJsImageMeasurements),
    speedupFromM0FastestLargePhoto:
      m0FastestLargePhotoMilliseconds / slowestLargePhotoMedianMilliseconds,
    pureJsImageMedianMilliseconds,
    libjxlExactWorkflowMedianMilliseconds,
    medianRatioToLibjxlExactWorkflow:
      pureJsImageMedianMilliseconds / libjxlExactWorkflowMedianMilliseconds,
  })
  const report = Object.freeze({
    schemaVersion: 1,
    purpose: 'JPEG XL Milestone 1 measured 12 MP exact-transcode performance gate',
    oracle: 'libjxl a7a9c787341cf703dede03c2009fa460cae5e5df (v0.12.0)',
    timingPolicy:
      'PureJsImage includes its in-process exactness check. The libjxl reference includes cjxl encoding, djxl JPEG reconstruction, and reading the reconstructed bytes.',
    warmupRunsPerCase: 1,
    measuredRunsPerCase: measuredRuns,
    m0FastestLargePhotoMilliseconds,
    results: Object.freeze(results),
    milestone1PerformanceGate: gate,
  })
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(gate, null, 2))
  if (!gate.passed) process.exitCode = 1
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true })
}
