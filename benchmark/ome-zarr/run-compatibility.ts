import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'

import { parseOmeZarrCompatibilityCorpus, runOmeZarrCompatibilitySample } from './compatibility.ts'
import {
  assertOmeZarrCompatibilityReportCurrent,
  OME_ZARR_COMPATIBILITY_MARKDOWN_PATH,
  OME_ZARR_COMPATIBILITY_REPORT_PATH,
  parseOmeZarrCompatibilityReport,
  renderOmeZarrCompatibilityMarkdown,
} from './report.ts'

interface CliOptions {
  readonly mode: 'stdout' | 'write' | 'check'
  readonly manifestPath: string
  readonly reportPath: string
  readonly markdownPath: string
}

const optionValue = (argv: readonly string[], name: string): string | undefined => {
  const index = argv.indexOf(name)
  if (index < 0) return undefined
  const value = argv[index + 1]
  if (value === undefined || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return value
}

const parseCli = (argv: readonly string[]): CliOptions => {
  const write = argv.includes('--write')
  const check = argv.includes('--check')
  if (write && check) throw new Error('Use only one of --write or --check')
  const manifest = optionValue(argv, '--manifest')
  const outputDirectory = optionValue(argv, '--output-dir')
  const consumed = new Set([
    '--write',
    '--check',
    ...(manifest === undefined ? [] : ['--manifest', manifest]),
    ...(outputDirectory === undefined ? [] : ['--output-dir', outputDirectory]),
  ])
  const positional = argv.filter((entry) => !consumed.has(entry))
  if (positional.length > 1) throw new Error(`Unknown argument ${positional[1]}`)
  if (positional[0]?.startsWith('--')) throw new Error(`Unknown argument ${positional[0]}`)
  const manifestPath = resolve(
    process.cwd(),
    manifest ?? positional[0] ?? 'benchmark/ome-zarr/official-corpus.json',
  )
  const reportPath = resolve(
    process.cwd(),
    outputDirectory === undefined
      ? OME_ZARR_COMPATIBILITY_REPORT_PATH
      : join(outputDirectory, basename(OME_ZARR_COMPATIBILITY_REPORT_PATH)),
  )
  const markdownPath = resolve(
    process.cwd(),
    outputDirectory === undefined
      ? OME_ZARR_COMPATIBILITY_MARKDOWN_PATH
      : join(outputDirectory, basename(OME_ZARR_COMPATIBILITY_MARKDOWN_PATH)),
  )
  return Object.freeze({
    mode: write ? 'write' : check ? 'check' : 'stdout',
    manifestPath,
    reportPath,
    markdownPath,
  })
}

const cli = parseCli(process.argv.slice(2))
const corpus = parseOmeZarrCompatibilityCorpus(JSON.parse(await readFile(cli.manifestPath, 'utf8')))
const results = []
for (const [index, sample] of corpus.samples.entries()) {
  process.stderr.write(`[${index + 1}/${corpus.samples.length}] ${sample.id}\n`)
  results.push(
    await runOmeZarrCompatibilitySample(sample, { signal: AbortSignal.timeout(300_000) }),
  )
}
const unexpectedFailures = Object.freeze(
  results.flatMap((result, index) => {
    const expected = corpus.samples[index]?.expectedClassification ?? 'PASS'
    return result.classification === expected
      ? []
      : [Object.freeze({ id: result.id, expected, actual: result.classification })]
  }),
)
const report = Object.freeze({
  schemaVersion: 2,
  reportType: 'public-compatibility',
  corpusPath: relative(process.cwd(), cli.manifestPath),
  generatedAt: new Date().toISOString(),
  nodeVersion: process.version,
  platform: `${process.platform}/${process.arch}`,
  results: Object.freeze(results),
  unexpectedFailures,
})
const parsedReport = parseOmeZarrCompatibilityReport(report)
const serialized = `${JSON.stringify(parsedReport, null, 2)}\n`
const markdown = renderOmeZarrCompatibilityMarkdown(parsedReport)

if (cli.mode === 'write') {
  await mkdir(dirname(cli.reportPath), { recursive: true })
  await mkdir(dirname(cli.markdownPath), { recursive: true })
  await writeFile(cli.reportPath, serialized)
  await writeFile(cli.markdownPath, markdown)
} else if (cli.mode === 'check') {
  const checkedIn = parseOmeZarrCompatibilityReport(
    JSON.parse(await readFile(cli.reportPath, 'utf8')),
  )
  assertOmeZarrCompatibilityReportCurrent(checkedIn, parsedReport)
  const checkedMarkdown = await readFile(cli.markdownPath, 'utf8')
  const stableMarkdown = renderOmeZarrCompatibilityMarkdown(
    Object.freeze({ ...parsedReport, generatedAt: checkedIn.generatedAt }),
  )
  if (checkedMarkdown !== stableMarkdown) {
    throw new Error('Checked-in OME-Zarr compatibility Markdown is stale; run with --write')
  }
}

process.stdout.write(serialized)
if (unexpectedFailures.length > 0) process.exitCode = 1
