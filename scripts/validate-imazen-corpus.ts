import { execFile, spawn } from 'node:child_process'
import { access, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

import type { ImazenWorkerMessage, ImazenWorkerStage } from './validate-imazen-worker.ts'

export type ImazenFormat = 'jpeg' | 'png'
export type ImazenFormatSelection = ImazenFormat | 'all'
export type ImazenExpectation = 'valid' | 'invalid' | 'flexible'
export type ImazenOutcome =
  | 'pass'
  | 'unsupported'
  | 'decode-failure'
  | 'invalid-output'
  | 'rejected-safely'
  | 'accepted'
  | 'raw-exception'
  | 'timeout'
  | 'process-crash'
  | 'out-of-memory'

export interface ImazenCorpusEntry {
  readonly format: ImazenFormat
  readonly absolutePath: string
  readonly relativeFilename: string
  readonly expectedCategory: 'valid' | 'invalid' | 'non-conformant' | 'crash-reproduction'
  readonly expectation: ImazenExpectation
  readonly corpusCategory: string
  readonly testGroup: string
  readonly features: readonly string[]
  readonly upstreamExpectation: string | null
}

export interface ImazenCommandSettings {
  readonly corpus: string
  readonly format: ImazenFormatSelection
  readonly output: string
  readonly timeoutMs: number
  readonly memoryMb: number
  readonly concurrency: number
  readonly limit: number | null
  readonly filter: string | null
}

export interface ImazenResultRecord {
  readonly format: ImazenFormat
  readonly relativeFilename: string
  readonly expectedCategory: ImazenCorpusEntry['expectedCategory']
  readonly corpusCategory: string
  readonly testGroup: string
  readonly features: readonly string[]
  readonly upstreamExpectation: string | null
  readonly actualOutcome: ImazenOutcome
  readonly lastCompletedStage: ImazenWorkerStage
  readonly structuredErrorCode: string | null
  readonly sanitizedErrorMessage: string | null
  readonly elapsedMs: number
  readonly childExitCode: number | null
  readonly childSignal: string | null
}

export interface ImazenCategoryTotal {
  readonly category: string
  readonly total: number
  readonly outcomes: Readonly<Record<ImazenOutcome, number>>
}

export interface ImazenReport {
  readonly schemaVersion: 1
  readonly generatedAt: string
  readonly pureJsImageVersion: string
  readonly pureJsImageGitCommit: string
  readonly codecCorpusGitCommit: string
  readonly nodeVersion: string
  readonly platform: string
  readonly format: ImazenFormat
  readonly commandSettings: ImazenCommandSettings
  readonly totalsByCorpusCategory: readonly ImazenCategoryTotal[]
  readonly totalsByOutcome: Readonly<Record<ImazenOutcome, number>>
  readonly records: readonly ImazenResultRecord[]
}

export interface ChildObservation {
  readonly timedOut: boolean
  readonly exitCode: number | null
  readonly signal: string | null
  readonly stdout: string
  readonly stderr: string
  readonly lastCompletedStage: ImazenWorkerStage
  readonly elapsedMs: number
}

export interface IsolatedRunOptions {
  readonly timeoutMs: number
  readonly memoryMb: number
  readonly corpusRoot: string
  readonly workerPath?: string
}

interface PngExpectedError {
  readonly corruption: string
  readonly details: string
}

interface ParsedCli {
  readonly corpusDirectory: string
  readonly outputDirectory: string
  readonly settings: ImazenCommandSettings
}

interface ReportEnvironment {
  readonly pureJsImageVersion: string
  readonly pureJsImageGitCommit: string
  readonly codecCorpusGitCommit: string
  readonly nodeVersion: string
  readonly platform: string
  readonly generatedAt: string
}

const execFileAsync = promisify(execFile)
const defaultWorkerPath = fileURLToPath(new URL('./validate-imazen-worker.ts', import.meta.url))
const workerOutputLimit = 65_536
const stagePrefix = 'PUREJSIMAGE_IMAZEN_STAGE '
const imageErrorCodes: Readonly<Record<string, true>> = {
  INVALID_INPUT: true,
  LIMIT_EXCEEDED: true,
  TRUNCATED_INPUT: true,
  UNSUPPORTED_FORMAT: true,
  UNSUPPORTED_OPERATION: true,
}

const positiveInteger = (value: number, name: string): number => {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error(`${name} must be a positive integer`)
  return value
}

const portablePath = (path: string): string => path.split(sep).join('/')

const reportPath = (path: string, placeholder: string): string =>
  isAbsolute(path) ? placeholder : portablePath(path)

const argumentValue = (arguments_: readonly string[], index: number, name: string): string => {
  const value = arguments_[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return value
}

export const parseImazenCli = (arguments_: readonly string[]): ParsedCli => {
  let corpusDirectory: string | undefined
  let outputDirectory = 'benchmark/results'
  let format: ImazenFormatSelection = 'all'
  let timeoutMs = 30_000
  let memoryMb = 512
  let concurrency = 2
  let limit: number | undefined
  let filter: string | undefined

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]
    if (argument === '--corpus') {
      corpusDirectory = argumentValue(arguments_, index, argument)
      index += 1
    } else if (argument === '--format') {
      const value = argumentValue(arguments_, index, argument)
      if (value !== 'jpeg' && value !== 'png' && value !== 'all') {
        throw new Error('--format must be jpeg, png, or all')
      }
      format = value
      index += 1
    } else if (argument === '--output') {
      outputDirectory = argumentValue(arguments_, index, argument)
      index += 1
    } else if (argument === '--timeout-ms') {
      timeoutMs = positiveInteger(Number(argumentValue(arguments_, index, argument)), argument)
      index += 1
    } else if (argument === '--memory-mb') {
      memoryMb = positiveInteger(Number(argumentValue(arguments_, index, argument)), argument)
      index += 1
    } else if (argument === '--concurrency') {
      concurrency = positiveInteger(Number(argumentValue(arguments_, index, argument)), argument)
      index += 1
    } else if (argument === '--limit') {
      limit = positiveInteger(Number(argumentValue(arguments_, index, argument)), argument)
      index += 1
    } else if (argument === '--filter') {
      filter = argumentValue(arguments_, index, argument)
      index += 1
    } else {
      throw new Error(`Unknown option: ${argument ?? '<missing>'}`)
    }
  }

  if (!corpusDirectory) {
    throw new Error(
      'Usage: npm run corpus:imazen -- --corpus <path> --format jpeg|png|all [--output <directory>] [--timeout-ms N] [--memory-mb N] [--concurrency N] [--limit N] [--filter substring]',
    )
  }

  return {
    corpusDirectory,
    outputDirectory,
    settings: {
      corpus: reportPath(corpusDirectory, '<corpus-path>'),
      format,
      output: reportPath(outputDirectory, '<output-path>'),
      timeoutMs,
      memoryMb,
      concurrency,
      limit: limit ?? null,
      filter: filter ?? null,
    },
  }
}

const filesRecursively = async (root: string): Promise<readonly string[]> => {
  const files: string[] = []
  const directories = [root]
  while (directories.length > 0) {
    const directory = directories.pop()
    if (!directory) continue
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) directories.push(path)
      else if (entry.isFile()) files.push(path)
    }
  }
  return files.sort((left, right) => left.localeCompare(right))
}

const jpegEntry = (corpusRoot: string, absolutePath: string): ImazenCorpusEntry => {
  const relativeFilename = portablePath(relative(corpusRoot, absolutePath))
  const parts = relativeFilename.split('/')
  const category = parts[1]
  if (parts[0] !== 'jpeg-conformance' || !category) {
    throw new Error(`Unexpected JPEG corpus path: ${relativeFilename}`)
  }
  if (category === 'valid' || category === 'invalid') {
    return {
      format: 'jpeg',
      absolutePath,
      relativeFilename,
      expectedCategory: category,
      expectation: category,
      corpusCategory: category,
      testGroup: category,
      features: [],
      upstreamExpectation: null,
    }
  }
  const subcategory = parts[2] ?? 'uncategorized'
  if (category === 'non-conformant') {
    return {
      format: 'jpeg',
      absolutePath,
      relativeFilename,
      expectedCategory: 'non-conformant',
      expectation: 'flexible',
      corpusCategory: `${category}/${subcategory}`,
      testGroup: subcategory,
      features: [],
      upstreamExpectation: null,
    }
  }
  if (category === 'crash-repro') {
    return {
      format: 'jpeg',
      absolutePath,
      relativeFilename,
      expectedCategory: 'crash-reproduction',
      expectation: 'flexible',
      corpusCategory: `${category}/${subcategory}`,
      testGroup: subcategory,
      features: [],
      upstreamExpectation: null,
    }
  }
  throw new Error(`Unknown JPEG corpus category: ${relativeFilename}`)
}

export const pngFeatureGroup = (filename: string): string => {
  const name = filename.toLowerCase()
  if (name === 'pngsuite.png') return 'suite-overview'
  if (name.startsWith('x')) return 'corrupted-or-invalid-inputs'
  if (name.startsWith('basi')) return 'interlacing'
  if (name.startsWith('basn')) return 'basic-color-types-and-bit-depths'
  if (/^s\d{2}/u.test(name)) return 'image-dimensions-and-interlacing'
  if (name.startsWith('bg')) return 'background-information'
  if (name.startsWith('t')) return 'transparency'
  if (name.startsWith('f')) return 'filtering'
  if (name.startsWith('p')) return 'palettes'
  if (name.startsWith('g') || name.startsWith('cc') || name.startsWith('cs')) {
    return 'gamma-and-color-information'
  }
  if (name.startsWith('cd')) return 'physical-dimensions'
  if (name.startsWith('oi')) return 'chunk-ordering-and-idat'
  if (name.startsWith('z')) return 'zlib-compression'
  if (name.startsWith('c') || name.startsWith('exif')) return 'ancillary-chunks'
  return 'other-pngsuite'
}

const pngFeatures = (filename: string): readonly string[] => {
  const features: string[] = []
  const match = /([ni])([02346])([gcpaa])(01|02|04|08|16)\.png$/iu.exec(filename)
  if (match?.[1] === 'i') features.push('interlaced')
  else if (match?.[1] === 'n') features.push('non-interlaced')
  if (match?.[2]) features.push(`color-type-${match[2]}`)
  if (match?.[4]) features.push(`bit-depth-${Number(match[4])}`)
  return features
}

const pngErrorExpectations = async (
  corpusRoot: string,
): Promise<ReadonlyMap<string, PngExpectedError>> => {
  const parsed: unknown = JSON.parse(
    await readFile(join(corpusRoot, 'expected_errors.json'), 'utf8'),
  )
  if (typeof parsed !== 'object' || parsed === null || !('pngsuite' in parsed)) {
    throw new Error('codec-corpus expected_errors.json is missing pngsuite')
  }
  const suite = parsed.pngsuite
  if (typeof suite !== 'object' || suite === null || !('error_files' in suite)) {
    throw new Error('codec-corpus expected_errors.json is missing pngsuite.error_files')
  }
  const errorFiles = suite.error_files
  if (typeof errorFiles !== 'object' || errorFiles === null || Array.isArray(errorFiles)) {
    throw new Error('codec-corpus pngsuite.error_files must be an object')
  }
  const errors = new Map<string, PngExpectedError>()
  for (const [filename, value] of Object.entries(errorFiles)) {
    if (
      typeof value !== 'object' ||
      value === null ||
      !('corruption' in value) ||
      typeof value.corruption !== 'string' ||
      !('details' in value) ||
      typeof value.details !== 'string'
    ) {
      throw new Error(`Invalid PNGSuite error expectation for ${filename}`)
    }
    errors.set(filename, { corruption: value.corruption, details: value.details })
  }
  return errors
}

const pngEntry = (
  corpusRoot: string,
  absolutePath: string,
  errors: ReadonlyMap<string, PngExpectedError>,
): ImazenCorpusEntry => {
  const relativeFilename = portablePath(relative(corpusRoot, absolutePath))
  const filename = relativeFilename.split('/').at(-1)
  if (!filename || !relativeFilename.startsWith('pngsuite/')) {
    throw new Error(`Unexpected PNGSuite path: ${relativeFilename}`)
  }
  const expectedError = errors.get(filename)
  const testGroup = pngFeatureGroup(filename)
  return {
    format: 'png',
    absolutePath,
    relativeFilename,
    expectedCategory: expectedError ? 'invalid' : 'valid',
    expectation: expectedError ? 'invalid' : 'valid',
    corpusCategory: expectedError ? `invalid/${expectedError.corruption}` : `valid/${testGroup}`,
    testGroup,
    features: pngFeatures(filename),
    upstreamExpectation: expectedError?.details ?? null,
  }
}

export const discoverImazenCorpus = async (
  corpusDirectory: string,
  selection: ImazenFormatSelection,
  filter: string | null = null,
  limit: number | null = null,
): Promise<readonly ImazenCorpusEntry[]> => {
  const corpusRoot = resolve(corpusDirectory)
  await access(corpusRoot)
  const entries: ImazenCorpusEntry[] = []

  if (selection === 'jpeg' || selection === 'all') {
    const jpegRoot = join(corpusRoot, 'jpeg-conformance')
    for (const path of await filesRecursively(jpegRoot)) {
      if (/\.jpe?g$/iu.test(path)) entries.push(jpegEntry(corpusRoot, path))
    }
  }
  if (selection === 'png' || selection === 'all') {
    const pngRoot = join(corpusRoot, 'pngsuite')
    const expectedErrors = await pngErrorExpectations(corpusRoot)
    for (const path of await filesRecursively(pngRoot)) {
      if (/\.png$/iu.test(path)) entries.push(pngEntry(corpusRoot, path, expectedErrors))
    }
  }

  entries.sort((left, right) => left.relativeFilename.localeCompare(right.relativeFilename))
  const filtered = filter
    ? entries.filter((entry) => entry.relativeFilename.includes(filter))
    : entries
  return limit === null ? filtered : filtered.slice(0, positiveInteger(limit, 'limit'))
}

const appendBounded = (current: string, chunk: Uint8Array): string => {
  if (current.length >= workerOutputLimit) return current
  return (current + Buffer.from(chunk).toString('utf8')).slice(0, workerOutputLimit)
}

const observeChild = async (
  entry: ImazenCorpusEntry,
  options: IsolatedRunOptions,
): Promise<ChildObservation> => {
  const startedAt = performance.now()
  const child = spawn(
    process.execPath,
    [
      `--max-old-space-size=${options.memoryMb}`,
      options.workerPath ?? defaultWorkerPath,
      '--file',
      entry.absolutePath,
      '--format',
      entry.format,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
  )
  let stdout = ''
  let stderr = ''
  let timedOut = false
  child.stdout.on('data', (chunk: Buffer) => {
    stdout = appendBounded(stdout, chunk)
  })
  child.stderr.on('data', (chunk: Buffer) => {
    stderr = appendBounded(stderr, chunk)
  })
  const timer = setTimeout(() => {
    timedOut = true
    child.kill('SIGKILL')
  }, options.timeoutMs)

  const { promise, resolve: resolveObservation } = Promise.withResolvers<ChildObservation>()
  let spawnError: Error | undefined
  child.once('error', (error) => {
    spawnError = error
  })
  child.once('close', (exitCode, signal) => {
    clearTimeout(timer)
    let lastCompletedStage: ImazenWorkerStage = 'start'
    const diagnosticLines: string[] = []
    for (const line of stderr.split(/\r?\n/gu)) {
      if (!line.startsWith(stagePrefix)) {
        if (line.length > 0) diagnosticLines.push(line)
        continue
      }
      const stage = line.slice(stagePrefix.length)
      if (
        stage === 'open' ||
        stage === 'metadata' ||
        stage === 'decode-and-encode-png' ||
        stage === 'reopen-png' ||
        stage === 'output-metadata' ||
        stage === 'verify-output'
      ) {
        lastCompletedStage = stage
      }
    }
    if (spawnError) diagnosticLines.push(spawnError.message)
    resolveObservation({
      timedOut,
      exitCode,
      signal,
      stdout,
      stderr: diagnosticLines.join('\n'),
      lastCompletedStage,
      elapsedMs: Math.max(0, Math.round(performance.now() - startedAt)),
    })
  })
  return promise
}

const sanitize = (message: string, entry: ImazenCorpusEntry, corpusRoot: string): string =>
  message
    .replaceAll(entry.absolutePath, '<corpus-file>')
    .replaceAll(resolve(corpusRoot), '<corpus>')
    .replaceAll(process.cwd(), '<repository>')
    .replace(/[\r\n\t]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 500)

const workerMessage = (stdout: string): ImazenWorkerMessage | undefined => {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout.trim())
  } catch {
    return undefined
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('status' in parsed) ||
    (parsed.status !== 'success' && parsed.status !== 'failure')
  ) {
    return undefined
  }
  if (parsed.status === 'success') {
    if (
      !('lastCompletedStage' in parsed) ||
      parsed.lastCompletedStage !== 'verify-output' ||
      !('width' in parsed) ||
      typeof parsed.width !== 'number' ||
      !('height' in parsed) ||
      typeof parsed.height !== 'number'
    ) {
      return undefined
    }
    return {
      status: 'success',
      lastCompletedStage: 'verify-output',
      width: parsed.width,
      height: parsed.height,
    }
  }
  if (
    !('failureKind' in parsed) ||
    (parsed.failureKind !== 'structured-error' &&
      parsed.failureKind !== 'raw-exception' &&
      parsed.failureKind !== 'invalid-output') ||
    !('lastCompletedStage' in parsed) ||
    typeof parsed.lastCompletedStage !== 'string' ||
    !('errorCode' in parsed) ||
    (parsed.errorCode !== null && typeof parsed.errorCode !== 'string') ||
    !('errorMessage' in parsed) ||
    typeof parsed.errorMessage !== 'string'
  ) {
    return undefined
  }
  if (
    parsed.lastCompletedStage !== 'start' &&
    parsed.lastCompletedStage !== 'open' &&
    parsed.lastCompletedStage !== 'metadata' &&
    parsed.lastCompletedStage !== 'decode-and-encode-png' &&
    parsed.lastCompletedStage !== 'reopen-png' &&
    parsed.lastCompletedStage !== 'output-metadata' &&
    parsed.lastCompletedStage !== 'verify-output'
  ) {
    return undefined
  }
  const lastCompletedStage: ImazenWorkerStage =
    parsed.lastCompletedStage === 'open' ||
    parsed.lastCompletedStage === 'metadata' ||
    parsed.lastCompletedStage === 'decode-and-encode-png' ||
    parsed.lastCompletedStage === 'reopen-png' ||
    parsed.lastCompletedStage === 'output-metadata' ||
    parsed.lastCompletedStage === 'verify-output'
      ? parsed.lastCompletedStage
      : 'start'
  return {
    status: 'failure',
    failureKind: parsed.failureKind,
    lastCompletedStage,
    errorCode: parsed.errorCode,
    errorMessage: parsed.errorMessage,
  }
}

const emptyOutcomeTotals = (): Record<ImazenOutcome, number> => ({
  pass: 0,
  unsupported: 0,
  'decode-failure': 0,
  'invalid-output': 0,
  'rejected-safely': 0,
  accepted: 0,
  'raw-exception': 0,
  timeout: 0,
  'process-crash': 0,
  'out-of-memory': 0,
})

const recordFrom = (
  entry: ImazenCorpusEntry,
  observation: ChildObservation,
  actualOutcome: ImazenOutcome,
  stage: ImazenWorkerStage,
  code: string | null,
  message: string | null,
): ImazenResultRecord => ({
  format: entry.format,
  relativeFilename: entry.relativeFilename,
  expectedCategory: entry.expectedCategory,
  corpusCategory: entry.corpusCategory,
  testGroup: entry.testGroup,
  features: entry.features,
  upstreamExpectation: entry.upstreamExpectation,
  actualOutcome,
  lastCompletedStage: stage,
  structuredErrorCode: code,
  sanitizedErrorMessage: message,
  elapsedMs: observation.elapsedMs,
  childExitCode: observation.exitCode,
  childSignal: observation.signal,
})

export const classifyChildObservation = (
  entry: ImazenCorpusEntry,
  observation: ChildObservation,
  corpusRoot: string,
): ImazenResultRecord => {
  const diagnostic = sanitize(observation.stderr, entry, corpusRoot)
  if (observation.timedOut) {
    return recordFrom(
      entry,
      observation,
      'timeout',
      observation.lastCompletedStage,
      null,
      diagnostic || 'Worker timed out',
    )
  }
  const outOfMemory = /heap out of memory|allocation failed|javascript heap|out of memory/iu.test(
    observation.stderr,
  )
  if (outOfMemory) {
    return recordFrom(
      entry,
      observation,
      'out-of-memory',
      observation.lastCompletedStage,
      null,
      diagnostic || 'Worker exhausted memory',
    )
  }
  if (observation.exitCode !== 0 || observation.signal !== null) {
    return recordFrom(
      entry,
      observation,
      'process-crash',
      observation.lastCompletedStage,
      null,
      diagnostic ||
        `Worker exited abnormally (${observation.exitCode ?? observation.signal ?? 'unknown'})`,
    )
  }

  const message = workerMessage(observation.stdout)
  if (!message) {
    const invalidMessage = sanitize(observation.stdout || observation.stderr, entry, corpusRoot)
    return recordFrom(
      entry,
      observation,
      'process-crash',
      'start',
      null,
      invalidMessage || 'Worker returned no valid result',
    )
  }
  if (message.status === 'success') {
    return recordFrom(
      entry,
      observation,
      entry.expectation === 'valid' ? 'pass' : 'accepted',
      message.lastCompletedStage,
      null,
      null,
    )
  }
  const sanitizedMessage = sanitize(message.errorMessage, entry, corpusRoot)
  if (message.failureKind === 'raw-exception') {
    return recordFrom(
      entry,
      observation,
      'raw-exception',
      message.lastCompletedStage,
      null,
      sanitizedMessage,
    )
  }
  if (message.failureKind === 'invalid-output') {
    return recordFrom(
      entry,
      observation,
      entry.expectation === 'valid' ? 'invalid-output' : 'accepted',
      message.lastCompletedStage,
      message.errorCode,
      sanitizedMessage,
    )
  }
  const structuredCode = message.errorCode
  const recognizable = structuredCode !== null && imageErrorCodes[structuredCode] === true
  if (entry.expectation !== 'valid') {
    return recordFrom(
      entry,
      observation,
      recognizable ? 'rejected-safely' : 'raw-exception',
      message.lastCompletedStage,
      structuredCode,
      sanitizedMessage,
    )
  }
  const outcome: ImazenOutcome =
    structuredCode === 'UNSUPPORTED_OPERATION' ? 'unsupported' : 'decode-failure'
  return recordFrom(
    entry,
    observation,
    outcome,
    message.lastCompletedStage,
    structuredCode,
    sanitizedMessage,
  )
}

export const runIsolatedFile = async (
  entry: ImazenCorpusEntry,
  options: IsolatedRunOptions,
): Promise<ImazenResultRecord> => {
  const observation = await observeChild(entry, options)
  return classifyChildObservation(entry, observation, options.corpusRoot)
}

const processConcurrently = async (
  entries: readonly ImazenCorpusEntry[],
  concurrency: number,
  processEntry: (entry: ImazenCorpusEntry) => Promise<ImazenResultRecord>,
  progress?: (completed: number, total: number) => void,
): Promise<readonly ImazenResultRecord[]> => {
  const results: Array<ImazenResultRecord | undefined> = new Array(entries.length)
  let cursor = 0
  let completed = 0
  const worker = async (): Promise<void> => {
    while (cursor < entries.length) {
      const index = cursor
      cursor += 1
      const entry = entries[index]
      if (!entry) continue
      results[index] = await processEntry(entry)
      completed += 1
      progress?.(completed, entries.length)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, entries.length) }, worker))
  return results.map((result, index) => {
    if (!result) throw new Error(`Missing corpus result at index ${index}`)
    return result
  })
}

export const buildImazenReport = (
  format: ImazenFormat,
  records: readonly ImazenResultRecord[],
  settings: ImazenCommandSettings,
  environment: ReportEnvironment,
): ImazenReport => {
  const selected = records
    .filter((record) => record.format === format)
    .sort((left, right) => left.relativeFilename.localeCompare(right.relativeFilename))
  const totalsByOutcome = emptyOutcomeTotals()
  const categories = new Map<string, ImazenResultRecord[]>()
  for (const record of selected) {
    totalsByOutcome[record.actualOutcome] += 1
    const category = categories.get(record.corpusCategory)
    if (category) category.push(record)
    else categories.set(record.corpusCategory, [record])
  }
  const totalsByCorpusCategory = [...categories]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([category, categoryRecords]) => {
      const outcomes = emptyOutcomeTotals()
      for (const record of categoryRecords) outcomes[record.actualOutcome] += 1
      return { category, total: categoryRecords.length, outcomes }
    })
  return {
    schemaVersion: 1,
    generatedAt: environment.generatedAt,
    pureJsImageVersion: environment.pureJsImageVersion,
    pureJsImageGitCommit: environment.pureJsImageGitCommit,
    codecCorpusGitCommit: environment.codecCorpusGitCommit,
    nodeVersion: environment.nodeVersion,
    platform: environment.platform,
    format,
    commandSettings: settings,
    totalsByCorpusCategory,
    totalsByOutcome,
    records: selected,
  }
}

const nonzeroOutcomes = (totals: Readonly<Record<ImazenOutcome, number>>): string =>
  Object.entries(totals)
    .filter(([, count]) => count > 0)
    .map(([outcome, count]) => `${outcome}: ${count}`)
    .join(', ')

const markdownCell = (value: string): string =>
  value.replaceAll('|', '\\|').replace(/[\r\n]+/gu, ' ')

const groupedRecords = (
  records: readonly ImazenResultRecord[],
  outcome: ImazenOutcome,
  key: (record: ImazenResultRecord) => string,
): readonly { readonly key: string; readonly records: readonly ImazenResultRecord[] }[] => {
  const groups = new Map<string, ImazenResultRecord[]>()
  for (const record of records) {
    if (record.actualOutcome !== outcome) continue
    const groupKey = key(record)
    const group = groups.get(groupKey)
    if (group) group.push(record)
    else groups.set(groupKey, [record])
  }
  return [...groups]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([groupKey, group]) => ({ key: groupKey, records: group }))
}

const likelyRootCause = (record: ImazenResultRecord): string => {
  const message = record.sanitizedErrorMessage ?? 'No diagnostic'
  const normalized = message
    .replace(/0x[\da-f]+/giu, '<hex>')
    .replace(/\b\d+\b/gu, '<n>')
    .slice(0, 180)
  return `${record.structuredErrorCode ?? 'NO_CODE'}: ${normalized}`
}

const reproductionCommand = (report: ImazenReport): string => {
  const settings = report.commandSettings
  const arguments_ = [
    'npm run corpus:imazen --',
    `--corpus ${settings.corpus}`,
    `--format ${report.format}`,
    `--output ${settings.output}`,
    `--timeout-ms ${settings.timeoutMs}`,
    `--memory-mb ${settings.memoryMb}`,
    `--concurrency ${settings.concurrency}`,
  ]
  if (settings.limit !== null) arguments_.push(`--limit ${settings.limit}`)
  if (settings.filter !== null) arguments_.push(`--filter ${JSON.stringify(settings.filter)}`)
  return arguments_.join(' ')
}

const punchList = (report: ImazenReport): readonly string[] => {
  const totals = report.totalsByOutcome
  const items: string[] = []
  const catastrophic = totals.timeout + totals['process-crash'] + totals['out-of-memory']
  if (catastrophic > 0)
    items.push(`Reproduce and isolate ${catastrophic} timeout, crash, or memory failure(s).`)
  const unsafe = totals['raw-exception'] + totals['invalid-output']
  if (unsafe > 0)
    items.push(
      `Replace ${unsafe} raw exception or invalid-output path(s) with safe codec behavior.`,
    )
  if (totals['decode-failure'] > 0) {
    items.push(
      `Triage ${totals['decode-failure']} valid-file decode failure(s) by the grouped root causes above.`,
    )
  }
  if (totals.accepted > 0) {
    items.push(
      `Review ${totals.accepted} accepted invalid or decoder-dependent input(s) without treating acceptance alone as a vulnerability.`,
    )
  }
  if (totals.unsupported > 0) {
    items.push(
      `Confirm the public unsupported boundary for ${totals.unsupported} valid input(s) before considering feature work.`,
    )
  }
  if (items.length === 0)
    items.push('Add independent pixel-oracle comparison before making exact-correctness claims.')
  return items
}

export const renderImazenMarkdown = (report: ImazenReport): string => {
  const title = report.format === 'jpeg' ? 'JPEG' : 'PNG'
  const lines = [
    `# Imazen ${title} conformance baseline`,
    '',
    'This baseline validates complete decode, in-memory PNG encode, PNG reopen, dimensions, and process robustness. It does not claim exact pixel parity or full standards compliance.',
    '',
    '## Summary',
    '',
    '| Outcome | Count |',
    '| --- | ---: |',
  ]
  for (const [outcome, count] of Object.entries(report.totalsByOutcome)) {
    lines.push(`| ${outcome} | ${count} |`)
  }
  lines.push(
    '',
    '## Results by upstream category or feature',
    '',
    '| Category | Total | Outcomes |',
    '| --- | ---: | --- |',
  )
  for (const category of report.totalsByCorpusCategory) {
    lines.push(
      `| ${markdownCell(category.category)} | ${category.total} | ${nonzeroOutcomes(category.outcomes)} |`,
    )
  }

  const critical = report.records.filter((record) =>
    ['process-crash', 'timeout', 'raw-exception', 'invalid-output', 'out-of-memory'].includes(
      record.actualOutcome,
    ),
  )
  lines.push('', '## Crashes, timeouts, raw exceptions, invalid output, and memory failures', '')
  if (critical.length === 0) lines.push('None.')
  else {
    for (const record of critical) {
      lines.push(
        `- \`${record.relativeFilename}\` — ${record.actualOutcome}; stage ${record.lastCompletedStage}; ${record.structuredErrorCode ?? 'no code'}: ${record.sanitizedErrorMessage ?? 'no diagnostic'}`,
      )
    }
  }

  lines.push('', '## Unsupported features by error code', '')
  const unsupported = groupedRecords(
    report.records,
    'unsupported',
    (record) => record.structuredErrorCode ?? 'NO_CODE',
  )
  if (unsupported.length === 0) lines.push('None.')
  else {
    lines.push('| Error code | Count | Files |', '| --- | ---: | --- |')
    for (const group of unsupported) {
      lines.push(
        `| ${group.key} | ${group.records.length} | ${group.records.map((record) => `\`${record.relativeFilename}\``).join('<br>')} |`,
      )
    }
  }

  lines.push('', '## Decode failures by likely root cause', '')
  const failures = groupedRecords(report.records, 'decode-failure', likelyRootCause)
  if (failures.length === 0) lines.push('None.')
  else {
    lines.push('| Likely root cause | Count | Files |', '| --- | ---: | --- |')
    for (const group of failures) {
      lines.push(
        `| ${markdownCell(group.key)} | ${group.records.length} | ${group.records.map((record) => `\`${record.relativeFilename}\``).join('<br>')} |`,
      )
    }
  }

  lines.push(
    '',
    '## Reproduction',
    '',
    `- PureJsImage commit: \`${report.pureJsImageGitCommit}\``,
    `- codec-corpus commit: \`${report.codecCorpusGitCommit}\``,
    `- Node/platform: \`${report.nodeVersion}\` on \`${report.platform}\``,
    `- Command: \`${reproductionCommand(report)}\``,
    '',
    '## Prioritized punch list',
    '',
  )
  for (const [index, item] of punchList(report).entries()) {
    lines.push(`${index + 1}. ${item}`)
  }
  return `${lines.join('\n')}\n`
}

export const serializeImazenJson = (report: ImazenReport): string =>
  `${JSON.stringify(report, undefined, 2)}\n`

const atomicWrite = async (path: string, content: string): Promise<void> => {
  await mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.tmp-${process.pid}`
  try {
    await writeFile(temporaryPath, content)
    await rename(temporaryPath, path)
  } finally {
    await rm(temporaryPath, { force: true })
  }
}

export const writeImazenReports = async (
  outputDirectory: string,
  reports: readonly ImazenReport[],
): Promise<readonly string[]> => {
  const paths: string[] = []
  for (const report of [...reports].sort((left, right) =>
    left.format.localeCompare(right.format),
  )) {
    const base = `imazen-${report.format}-conformance`
    const jsonPath = join(outputDirectory, `${base}.json`)
    const markdownPath = join(outputDirectory, `${base}.md`)
    await atomicWrite(jsonPath, serializeImazenJson(report))
    await atomicWrite(markdownPath, renderImazenMarkdown(report))
    paths.push(jsonPath, markdownPath)
  }
  return paths
}

const gitRevision = async (directory: string): Promise<string> => {
  const result = await execFileAsync('git', ['-C', directory, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  })
  return result.stdout.trim()
}

const packageVersion = async (): Promise<string> => {
  const parsed: unknown = JSON.parse(await readFile('package.json', 'utf8'))
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('version' in parsed) ||
    typeof parsed.version !== 'string'
  ) {
    throw new Error('package.json is missing a string version')
  }
  return parsed.version
}

const runCli = async (): Promise<void> => {
  const parsed = parseImazenCli(process.argv.slice(2))
  const corpusRoot = resolve(parsed.corpusDirectory)
  const entries = await discoverImazenCorpus(
    corpusRoot,
    parsed.settings.format,
    parsed.settings.filter,
    parsed.settings.limit,
  )
  if (entries.length === 0) throw new Error('No matching JPEG or PNG corpus images were discovered')

  let lastPrinted = 0
  const records = await processConcurrently(
    entries,
    parsed.settings.concurrency,
    (entry) =>
      runIsolatedFile(entry, {
        timeoutMs: parsed.settings.timeoutMs,
        memoryMb: parsed.settings.memoryMb,
        corpusRoot,
      }),
    (completed, total) => {
      if (completed === total || completed - lastPrinted >= 10) {
        lastPrinted = completed
        console.error(`Processed ${completed}/${total} corpus images`)
      }
    },
  )

  const environment: ReportEnvironment = {
    pureJsImageVersion: await packageVersion(),
    pureJsImageGitCommit: await gitRevision(process.cwd()),
    codecCorpusGitCommit: await gitRevision(corpusRoot),
    nodeVersion: process.version,
    platform: `${process.platform}-${process.arch}`,
    generatedAt: new Date().toISOString(),
  }
  const formats: readonly ImazenFormat[] =
    parsed.settings.format === 'all' ? ['jpeg', 'png'] : [parsed.settings.format]
  const reports = formats.map((format) =>
    buildImazenReport(format, records, parsed.settings, environment),
  )
  const paths = await writeImazenReports(parsed.outputDirectory, reports)
  console.log(
    JSON.stringify(
      {
        reports: paths.map((path) => portablePath(path)),
        summaries: reports.map((report) => ({
          format: report.format,
          selected: report.records.length,
          outcomes: report.totalsByOutcome,
        })),
      },
      undefined,
      2,
    ),
  )
}

const entrypoint = process.argv[1]
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) await runCli()
