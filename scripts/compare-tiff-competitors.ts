import { spawn } from 'node:child_process'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  type TiffComparisonMode,
  type TiffCompetitorEngine,
  type TiffCompetitorWorkerResult,
  tiffCompetitorEngines,
} from './compare-tiff-worker.ts'

type RecordedStatus = TiffCompetitorWorkerResult['status'] | 'timeout' | 'process-crash'
type VersionedTiffCompetitorEngine = Exclude<TiffCompetitorEngine, 'purejsimage'>

export const defaultTiffCompetitorCorpora = [
  '../codec-corpus/tiff-conformance/valid',
  '../codec-corpus/tiff-conformance/edge-cases',
  '../codec-corpus/tiff-conformance/robustness',
] as const

interface Settings {
  readonly corpusDirectories: readonly string[]
  readonly outputDirectory: string
  readonly timeoutMs: number
  readonly memoryMb: number
  readonly concurrency: number
  readonly limit: number | null
  readonly filter: string | null
}

interface CorpusFile {
  readonly absolutePath: string
  readonly displayPath: string
}

interface RecordResult {
  readonly engine: TiffCompetitorEngine
  readonly file: string
  readonly status: RecordedStatus
  readonly comparisonMode: TiffComparisonMode | null
  readonly exact: boolean | null
  readonly width: number | null
  readonly height: number | null
  readonly mismatchedPixels: number | null
  readonly maximumChannelDelta: number | null
  readonly rootMeanSquareError: number | null
  readonly decodeMilliseconds: number | null
  readonly errorCode: string | null
  readonly errorMessage: string | null
}

interface EngineTotals {
  readonly engine: TiffCompetitorEngine
  readonly corpusFiles: number
  readonly attempted: number
  readonly rgbaCompared: number
  readonly decoded: number
  readonly exact: number
  readonly mismatch: number
  readonly unsupported: number
  readonly error: number
  readonly oracleFailure: number
  readonly timeout: number
  readonly processCrash: number
  readonly notComparable: number
  readonly malformedRejected: number
  readonly malformedAccepted: number
  readonly malformedTimeout: number
  readonly malformedCrash: number
}
interface PureJsImageSnapshot {
  readonly packageVersion: string
  readonly gitCommit: string
  readonly dirty: boolean
}

interface TiffCompetitorReport {
  readonly schemaVersion: 3
  readonly generatedAt: string
  readonly nodeVersion: string
  readonly platform: string
  readonly architecture: string
  readonly oracle: 'sharp with ImageMagick fallback'
  readonly corpus: {
    readonly name: 'codec-corpus TIFF conformance'
    readonly source: string
    readonly directories: readonly string[]
  }
  readonly purejsimage: PureJsImageSnapshot
  readonly versions: Readonly<Record<VersionedTiffCompetitorEngine, string>>
  readonly settings: Omit<Settings, 'corpusDirectories' | 'outputDirectory'>
  readonly totals: readonly EngineTotals[]
  readonly records: readonly RecordResult[]
}

const workerPath = fileURLToPath(new URL('./compare-tiff-worker.ts', import.meta.url))
const positiveInteger = (value: string, option: string): number => {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${option} must be positive`)
  return parsed
}

const optionValue = (arguments_: readonly string[], index: number): string => {
  const value = arguments_[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${arguments_[index]} requires a value`)
  return value
}

export const parseTiffCompetitorCli = (arguments_: readonly string[]): Settings => {
  const corpusDirectories: string[] = []
  let outputDirectory = 'benchmark/results'
  let timeoutMs = 30_000
  let memoryMb = 512
  let concurrency = 2
  let limit: number | null = null
  let filter: string | null = null
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]
    if (argument === '--corpus') {
      corpusDirectories.push(optionValue(arguments_, index))
      index += 1
    } else if (argument === '--output') {
      outputDirectory = optionValue(arguments_, index)
      index += 1
    } else if (argument === '--timeout-ms') {
      timeoutMs = positiveInteger(optionValue(arguments_, index), argument)
      index += 1
    } else if (argument === '--memory-mb') {
      memoryMb = positiveInteger(optionValue(arguments_, index), argument)
      index += 1
    } else if (argument === '--concurrency') {
      concurrency = positiveInteger(optionValue(arguments_, index), argument)
      index += 1
    } else if (argument === '--limit') {
      limit = positiveInteger(optionValue(arguments_, index), argument)
      index += 1
    } else if (argument === '--filter') {
      filter = optionValue(arguments_, index)
      index += 1
    } else {
      throw new Error(`Unknown option: ${argument ?? '<missing>'}`)
    }
  }
  return {
    corpusDirectories:
      corpusDirectories.length > 0 ? corpusDirectories : defaultTiffCompetitorCorpora,
    outputDirectory,
    timeoutMs,
    memoryMb,
    concurrency,
    limit,
    filter,
  }
}

const portable = (path: string): string => path.split(sep).join('/')

const collectTiffs = async (settings: Settings): Promise<readonly CorpusFile[]> => {
  const files: CorpusFile[] = []
  for (const corpus of settings.corpusDirectories) {
    const root = resolve(corpus)
    const pending = [root]
    while (pending.length > 0) {
      const directory = pending.pop()
      if (!directory) continue
      const entries = await readdir(directory, { withFileTypes: true })
      entries.sort((left, right) => left.name.localeCompare(right.name))
      for (const entry of entries) {
        const path = join(directory, entry.name)
        if (entry.isDirectory()) pending.push(path)
        else if (entry.isFile() && ['.tif', '.tiff'].includes(extname(entry.name).toLowerCase())) {
          const displayPath = `${basename(root)}/${portable(relative(root, path))}`
          if (!settings.filter || displayPath.includes(settings.filter)) {
            files.push({ absolutePath: path, displayPath })
          }
        }
      }
    }
  }
  files.sort((left, right) => left.displayPath.localeCompare(right.displayPath))
  return settings.limit === null ? files : files.slice(0, settings.limit)
}

const sanitizeReportMessage = (message: string): string =>
  message
    .replace(/[\r\n\t]+/gu, ' ')
    .trim()
    .slice(0, 500)

const failedRecord = (
  engine: TiffCompetitorEngine,
  file: string,
  status: 'timeout' | 'process-crash',
  message: string,
): RecordResult => ({
  engine,
  file,
  status,
  comparisonMode: file.startsWith('robustness/') ? 'robustness' : null,
  exact: null,
  width: null,
  height: null,
  mismatchedPixels: null,
  maximumChannelDelta: null,
  rootMeanSquareError: null,
  decodeMilliseconds: null,
  errorCode: null,
  errorMessage: sanitizeReportMessage(message),
})

const workerRecord = (
  engine: TiffCompetitorEngine,
  file: string,
  result: TiffCompetitorWorkerResult,
): RecordResult => {
  if (result.status === 'success') {
    return {
      engine,
      file,
      status: result.status,
      comparisonMode: result.comparisonMode,
      exact: result.exact,
      width: result.width,
      height: result.height,
      mismatchedPixels: result.mismatchedPixels,
      maximumChannelDelta: result.maximumChannelDelta,
      rootMeanSquareError: result.rootMeanSquareError,
      decodeMilliseconds: result.decodeMilliseconds,
      errorCode: null,
      errorMessage: null,
    }
  }
  if (result.status === 'not-comparable') {
    return {
      engine,
      file,
      status: result.status,
      comparisonMode: result.comparisonMode,
      exact: null,
      width: null,
      height: null,
      mismatchedPixels: null,
      maximumChannelDelta: null,
      rootMeanSquareError: null,
      decodeMilliseconds: null,
      errorCode: null,
      errorMessage: result.reason,
    }
  }
  if (result.status === 'malformed-accepted' || result.status === 'malformed-rejected') {
    return {
      engine,
      file,
      status: result.status,
      comparisonMode: result.comparisonMode,
      exact: null,
      width: null,
      height: null,
      mismatchedPixels: null,
      maximumChannelDelta: null,
      rootMeanSquareError: null,
      decodeMilliseconds: null,
      errorCode: null,
      errorMessage: result.errorMessage,
    }
  }
  return {
    engine,
    file,
    status: result.status,
    comparisonMode: result.comparisonMode,
    exact: null,
    width: null,
    height: null,
    mismatchedPixels: null,
    maximumChannelDelta: null,
    rootMeanSquareError: null,
    decodeMilliseconds: null,
    errorCode: 'errorCode' in result ? result.errorCode : null,
    errorMessage: result.errorMessage,
  }
}

const runWorker = (
  engine: TiffCompetitorEngine,
  file: CorpusFile,
  settings: Settings,
): Promise<RecordResult> =>
  new Promise((resolveResult) => {
    const child = spawn(
      process.execPath,
      [
        `--max-old-space-size=${settings.memoryMb}`,
        workerPath,
        '--engine',
        engine,
        '--file',
        file.absolutePath,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let stdout = ''
    let stderr = ''
    let timedOut = false
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout = `${stdout}${chunk}`.slice(-65_536)
    })
    child.stderr.on('data', (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-65_536)
    })
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, settings.timeoutMs)
    child.once('close', (code, signal) => {
      clearTimeout(timer)
      if (timedOut) {
        resolveResult(failedRecord(engine, file.displayPath, 'timeout', 'worker timed out'))
        return
      }
      if (code !== 0) {
        resolveResult(
          failedRecord(
            engine,
            file.displayPath,
            'process-crash',
            (stderr || `worker exited ${String(code)} ${signal ?? ''}`).trim().slice(0, 500),
          ),
        )
        return
      }
      try {
        const jsonLine = stdout
          .trim()
          .split(/\r?\n/u)
          .findLast((line) => line.trimStart().startsWith('{'))
        if (!jsonLine) throw new Error('worker returned no JSON record')
        const result: unknown = JSON.parse(jsonLine)
        if (!result || typeof result !== 'object' || !('status' in result)) {
          throw new Error('worker returned an invalid record')
        }
        resolveResult(workerRecord(engine, file.displayPath, result as TiffCompetitorWorkerResult))
      } catch (error) {
        resolveResult(
          failedRecord(
            engine,
            file.displayPath,
            'process-crash',
            error instanceof Error ? error.message : String(error),
          ),
        )
      }
    })
  })

const totalsFor = (
  engine: TiffCompetitorEngine,
  records: readonly RecordResult[],
): EngineTotals => {
  const selected = records.filter((record) => record.engine === engine)
  const notComparable = selected.filter((record) => record.status === 'not-comparable').length
  const malformedRejected = selected.filter(
    (record) => record.status === 'malformed-rejected',
  ).length
  const malformedAccepted = selected.filter(
    (record) => record.status === 'malformed-accepted',
  ).length
  const exact = selected.filter((record) => record.exact === true).length
  const mismatch = selected.filter(
    (record) => record.status === 'success' && record.exact === false,
  ).length
  const robustness = selected.filter((record) => record.comparisonMode === 'robustness').length
  const rgbaCompared = selected.length - notComparable - robustness
  return {
    engine,
    corpusFiles: selected.length,
    attempted: selected.length,
    rgbaCompared,
    decoded: exact + mismatch,
    exact,
    mismatch,
    unsupported: selected.filter((record) => record.status === 'unsupported').length,
    error: selected.filter((record) => record.status === 'error').length,
    oracleFailure: selected.filter((record) => record.status === 'oracle-failure').length,
    timeout: selected.filter((record) => record.status === 'timeout').length,
    processCrash: selected.filter((record) => record.status === 'process-crash').length,
    notComparable,
    malformedRejected,
    malformedAccepted,
    malformedTimeout: selected.filter(
      (record) => record.comparisonMode === 'robustness' && record.status === 'timeout',
    ).length,
    malformedCrash: selected.filter(
      (record) => record.comparisonMode === 'robustness' && record.status === 'process-crash',
    ).length,
  }
}

const markdown = (report: TiffCompetitorReport): string => {
  const lines = [
    '# TIFF competitor conformance',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    `Corpus: ${report.corpus.name}; ${report.corpus.source}`,
    '',
    `Oracle: ${report.oracle} raw RGBA8. Exact means every independently decoded channel matched. Color-converted and lossy cases remain visible but a mismatch is not automatically a decoder defect.`,
    '',
    'Signed, floating-point, wider-than-16-bit, and arbitrary-channel rasters are classified as native scientific data and are not forced through RGBA.',
    '',
    `PureJsImage: package metadata ${report.purejsimage.packageVersion}; main snapshot ${report.purejsimage.gitCommit}; working tree ${report.purejsimage.dirty ? 'dirty' : 'clean'}.`,
    '',
    '| Engine | Version | Files attempted | RGBA-compared | Decoded | Exact | Pixel mismatch | Unsupported | Error | Oracle failure | Timeout | Crash | Native raster, not compared | Malformed rejected | Malformed accepted | Malformed timeout | Malformed crash |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ]
  for (const total of report.totals) {
    const version =
      total.engine === 'purejsimage'
        ? `main snapshot (unreleased · ${report.purejsimage.gitCommit.slice(0, 7)}${report.purejsimage.dirty ? ' · dirty' : ''})`
        : report.versions[total.engine]
    lines.push(
      `| ${total.engine} | ${version} | ${total.attempted} | ${total.rgbaCompared} | ${total.decoded} | ${total.exact} | ${total.mismatch} | ${total.unsupported} | ${total.error} | ${total.oracleFailure} | ${total.timeout} | ${total.processCrash} | ${total.notComparable} | ${total.malformedRejected} | ${total.malformedAccepted} | ${total.malformedTimeout} | ${total.malformedCrash} |`,
    )
  }
  lines.push(
    '',
    '## Non-exact, failed, and malformed-accepted cases',
    '',
    '| Engine | File | Comparison | Outcome | Differing pixels | Max delta | RMSE | Detail |',
    '| --- | --- | --- | --- | ---: | ---: | ---: | --- |',
  )
  for (const record of report.records) {
    if (
      record.exact === true ||
      record.status === 'not-comparable' ||
      record.status === 'malformed-rejected'
    ) {
      continue
    }
    const detail = sanitizeReportMessage(record.errorMessage ?? '').replaceAll('|', '\\|')
    lines.push(
      `| ${record.engine} | ${record.file} | ${record.comparisonMode ?? '-'} | ${record.status} | ${record.mismatchedPixels ?? '-'} | ${record.maximumChannelDelta ?? '-'} | ${record.rootMeanSquareError?.toFixed(4) ?? '-'} | ${detail} |`,
    )
  }
  lines.push('')
  return lines.join('\n')
}

const concurrentMap = async <Input, Output>(
  inputs: readonly Input[],
  concurrency: number,
  operation: (input: Input) => Promise<Output>,
): Promise<readonly Output[]> => {
  const outputs: Output[] = new Array<Output>(inputs.length)
  let next = 0
  const workers = Array.from({ length: Math.min(concurrency, inputs.length) }, async () => {
    while (next < inputs.length) {
      const index = next
      next += 1
      const input = inputs[index]
      if (input !== undefined) outputs[index] = await operation(input)
    }
  })
  await Promise.all(workers)
  return outputs
}

const objectRecord = (value: unknown, label: string): Readonly<Record<string, unknown>> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Readonly<Record<string, unknown>>
}

export const readTiffCompetitorVersions = async (): Promise<
  Readonly<Record<TiffCompetitorEngine, string>>
> => {
  const packageJson = objectRecord(
    JSON.parse(await readFile('package.json', 'utf8')),
    'package.json',
  )
  const lock = objectRecord(
    JSON.parse(await readFile('package-lock.json', 'utf8')),
    'package-lock.json',
  )
  const packages = objectRecord(lock.packages, 'package-lock packages')
  const versionFor = (packageName: string): string => {
    const entry = objectRecord(packages[`node_modules/${packageName}`], `${packageName} lock entry`)
    if (typeof entry.version !== 'string') throw new Error(`${packageName} has no locked version`)
    return entry.version
  }
  if (typeof packageJson.version !== 'string') throw new Error('package.json has no version')
  return Object.freeze({
    purejsimage: packageJson.version,
    geotiff: versionFor('geotiff'),
    utif2: versionFor('utif2'),
    tiff: versionFor('tiff'),
    'image-js': versionFor('image-js'),
    jimp: versionFor('jimp'),
  })
}
const gitOutput = (arguments_: readonly string[]): Promise<string> =>
  new Promise((resolveOutput, reject) => {
    const child = spawn('git', arguments_, {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.once('error', reject)
    child.once('close', (code) => {
      if (code === 0) {
        resolveOutput(stdout.trim())
        return
      }
      reject(new Error(`git ${arguments_.join(' ')} exited with ${code ?? 'unknown'}: ${stderr}`))
    })
  })

const readPureJsImageSnapshot = async (packageVersion: string): Promise<PureJsImageSnapshot> => {
  const [gitCommit, status] = await Promise.all([
    gitOutput(['rev-parse', 'HEAD']),
    gitOutput(['status', '--porcelain']),
  ])
  if (!/^[a-f0-9]{40}$/u.test(gitCommit)) throw new Error('Git returned an invalid commit')
  return Object.freeze({ packageVersion, gitCommit, dirty: status.length > 0 })
}

export const runTiffCompetitorComparison = async (
  settings: Settings,
): Promise<TiffCompetitorReport> => {
  const allVersions = await readTiffCompetitorVersions()
  const purejsimage = await readPureJsImageSnapshot(allVersions.purejsimage)
  const files = await collectTiffs(settings)
  if (files.length === 0) throw new Error('No TIFF files matched the selected corpus')
  const jobs = files.flatMap((file) => tiffCompetitorEngines.map((engine) => ({ engine, file })))
  const records = await concurrentMap(jobs, settings.concurrency, ({ engine, file }) =>
    runWorker(engine, file, settings),
  )
  return {
    schemaVersion: 3,
    generatedAt: new Date().toISOString(),
    nodeVersion: process.version,
    platform: process.platform,
    architecture: process.arch,
    oracle: 'sharp with ImageMagick fallback',
    corpus: {
      name: 'codec-corpus TIFF conformance',
      source: 'https://github.com/a-r-d/codec-corpus/tree/main/tiff-conformance',
      directories: settings.corpusDirectories.map(portable),
    },
    purejsimage,
    versions: {
      geotiff: allVersions.geotiff,
      utif2: allVersions.utif2,
      tiff: allVersions.tiff,
      'image-js': allVersions['image-js'],
      jimp: allVersions.jimp,
    },
    settings: {
      timeoutMs: settings.timeoutMs,
      memoryMb: settings.memoryMb,
      concurrency: settings.concurrency,
      limit: settings.limit,
      filter: settings.filter,
    },
    totals: tiffCompetitorEngines.map((engine) => totalsFor(engine, records)),
    records,
  }
}

const run = async (): Promise<void> => {
  const settings = parseTiffCompetitorCli(process.argv.slice(2))
  const report = await runTiffCompetitorComparison(settings)
  await mkdir(settings.outputDirectory, { recursive: true })
  const jsonPath = join(settings.outputDirectory, 'tiff-competitor-conformance.json')
  const markdownPath = join(settings.outputDirectory, 'tiff-competitor-conformance.md')
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`)
  await writeFile(markdownPath, markdown(report))
  process.stdout.write(markdown(report))
}

const entrypoint = process.argv[1]
if (entrypoint && import.meta.url === new URL(`file://${resolve(entrypoint)}`).href) await run()
