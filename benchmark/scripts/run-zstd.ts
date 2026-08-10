import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { brotliCompressSync, gzipSync } from 'node:zlib'
import { build } from 'esbuild'

import { decodeZstd } from '../../src/compression/zstd/index.ts'

interface Options {
  readonly runs: number
  readonly warmups: number
  readonly output: string
}

const positiveInteger = (value: string | undefined, name: string): number => {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1)
    throw new Error(`${name} must be a positive integer`)
  return parsed
}

const options = (): Options => {
  let runs = 9
  let warmups = 2
  let output = 'benchmark/results/zstd-standalone.json'
  const arguments_ = process.argv.slice(2)
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]
    if (argument === '--runs') {
      runs = positiveInteger(arguments_[index + 1], '--runs')
      index += 1
    } else if (argument === '--warmups') {
      warmups = positiveInteger(arguments_[index + 1], '--warmups')
      index += 1
    } else if (argument === '--output') {
      const value = arguments_[index + 1]
      if (!value) throw new Error('--output requires a path')
      output = value
      index += 1
    } else {
      throw new Error(`Unknown option: ${argument ?? '<missing>'}`)
    }
  }
  return { runs, warmups, output }
}

const percentile = (values: readonly number[], fraction: number): number => {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] ?? 0
}

const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')

const settings = options()
const fixturePath = resolve('tests/fixtures/zstd-entropy-multiblock.zst')
const compressed = new Uint8Array(await readFile(fixturePath))
const expectedOutputBytes = 350_726
const expectedSha256 = '245687da21aee8c6763f98d07c6af824cb355398ff52259869c0c767dcc4e8a7'
const decode = (): Uint8Array =>
  decodeZstd(compressed, {
    expectedOutputBytes,
    maxOutputBytes: expectedOutputBytes,
  })

for (let warmup = 0; warmup < settings.warmups; warmup += 1) {
  const output = decode()
  if (sha256(output) !== expectedSha256) throw new Error('Zstandard warmup output mismatch')
}
globalThis.gc?.()

const baseline = process.memoryUsage()
const samples: number[] = []
let maximumExternalBytes = baseline.external
let maximumArrayBufferBytes = baseline.arrayBuffers
let finalOutput: Uint8Array<ArrayBufferLike> = new Uint8Array()
for (let run = 0; run < settings.runs; run += 1) {
  const started = performance.now()
  finalOutput = decode()
  samples.push(performance.now() - started)
  const memory = process.memoryUsage()
  maximumExternalBytes = Math.max(maximumExternalBytes, memory.external)
  maximumArrayBufferBytes = Math.max(maximumArrayBufferBytes, memory.arrayBuffers)
}
if (sha256(finalOutput) !== expectedSha256) throw new Error('Zstandard benchmark output mismatch')

const medianMilliseconds = percentile(samples, 0.5)
const p95Milliseconds = percentile(samples, 0.95)
const peakRssBytes = process.resourceUsage().maxRSS * 1024
const bundleResult = await build({
  bundle: true,
  entryPoints: ['src/compression/zstd/index.ts'],
  format: 'esm',
  minify: true,
  platform: 'browser',
  target: ['es2022'],
  write: false,
})
const bundle = bundleResult.outputFiles[0]?.contents
if (!bundle) throw new Error('Zstandard bundle measurement produced no output')

const report = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  runtime: {
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
  },
  fixture: {
    path: 'tests/fixtures/zstd-entropy-multiblock.zst',
    compressedBytes: compressed.byteLength,
    decodedBytes: expectedOutputBytes,
    decodedSha256: expectedSha256,
  },
  configuration: {
    runs: settings.runs,
    warmups: settings.warmups,
    maxOutputBytes: expectedOutputBytes,
  },
  timing: {
    samplesMilliseconds: samples,
    medianMilliseconds,
    p95Milliseconds,
    medianMegabytesPerSecond: expectedOutputBytes / 1_000_000 / (medianMilliseconds / 1000),
  },
  memory: {
    peakRssBytes,
    baselineRssBytes: baseline.rss,
    maximumExternalBytes,
    maximumArrayBufferBytes,
  },
  bundle: {
    minifiedBytes: bundle.byteLength,
    gzipBytes: gzipSync(bundle).byteLength,
    brotliBytes: brotliCompressSync(bundle).byteLength,
  },
}

const outputPath = resolve(settings.output)
await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`)
const markdownPath = outputPath.replace(/\.json$/u, '.md')
await writeFile(
  markdownPath,
  `# Standalone Zstandard benchmark\n\n` +
    `Reference-decoder-generated ${compressed.byteLength.toLocaleString()}-byte fixture; exact ` +
    `${expectedOutputBytes.toLocaleString()}-byte output validation.\n\n` +
    `| Runs | Warmups | Median | p95 | Throughput | Peak RSS | External | ArrayBuffer | Minified | gzip | Brotli |\n` +
    `| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n` +
    `| ${settings.runs} | ${settings.warmups} | ${medianMilliseconds.toFixed(2)} ms | ` +
    `${p95Milliseconds.toFixed(2)} ms | ${report.timing.medianMegabytesPerSecond.toFixed(1)} MB/s | ` +
    `${(peakRssBytes / 1_048_576).toFixed(1)} MiB | ` +
    `${(maximumExternalBytes / 1_048_576).toFixed(1)} MiB | ` +
    `${(maximumArrayBufferBytes / 1_048_576).toFixed(1)} MiB | ` +
    `${(bundle.byteLength / 1024).toFixed(1)} KiB | ` +
    `${(report.bundle.gzipBytes / 1024).toFixed(1)} KiB | ` +
    `${(report.bundle.brotliBytes / 1024).toFixed(1)} KiB |\n`,
)

console.log(
  JSON.stringify({ json: outputPath, markdown: markdownPath, timing: report.timing }, null, 2),
)
