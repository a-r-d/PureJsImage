import { createReadStream } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'

import { allCodecs } from '../src/codec-entries/all.ts'
import { experimentalHeifCodec } from '../src/codec-entries/experimental/heic.ts'
import type { ImageMetadata } from '../src/codec.ts'
import { createNodeImageLibrary, type NodeImage } from '../src/node-image.ts'

const manifestFilename = 'manifest.jsonl'
const defaultOutputPath = 'benchmark/results/artifacts/user-corpus-report.json'
const imageLibrary = createNodeImageLibrary([...allCodecs, experimentalHeifCodec])

export type CorpusStage = 'manifest' | 'open' | 'metadata' | 'transform' | 'verify'

interface CorpusEntry {
  readonly id: string
  readonly format: string
  readonly localPath: string
  readonly sizeBytes: number
}

export interface CorpusFailure {
  readonly id: string
  readonly format: string
  readonly sizeBytes: number
  readonly stage: CorpusStage
  readonly name: string
  readonly code?: string
  readonly message: string
}

export interface CorpusFormatSummary {
  readonly format: string
  selected: number
  succeeded: number
  failed: number
  inputBytes: number
  outputBytes: number
}

export interface CorpusErrorSummary {
  readonly stage: CorpusStage
  readonly name: string
  readonly code?: string
  readonly message: string
  readonly count: number
  readonly uniqueFiles: number
  readonly formats: Readonly<Record<string, number>>
}

export interface CorpusReport {
  readonly generatedAt: string
  readonly durationMs: number
  readonly options: {
    readonly concurrency: number
    readonly formats: readonly string[]
    readonly limit: number | null
    readonly shard: CorpusShard | null
    readonly transform: 'frame-0-auto-orient-resize-inside-256-jpeg'
  }
  readonly summary: {
    readonly recordsSeen: number
    readonly selected: number
    readonly skipped: number
    readonly succeeded: number
    readonly failed: number
    readonly inputBytes: number
    readonly outputBytes: number
  }
  readonly formats: readonly CorpusFormatSummary[]
  readonly errors: readonly CorpusErrorSummary[]
  readonly failures: readonly CorpusFailure[]
}

export interface CorpusProgress {
  readonly completed: number
  readonly selected: number
  readonly succeeded: number
  readonly failed: number
}

export interface CorpusShard {
  readonly index: number
  readonly count: number
}

export interface ExerciseCorpusOptions {
  readonly corpusDirectory: string
  readonly concurrency?: number
  readonly formats?: ReadonlySet<string>
  readonly limit?: number
  readonly shard?: CorpusShard
  readonly onProgress?: (progress: CorpusProgress) => void
}

interface ExerciseResult {
  readonly inputMetadata: ImageMetadata
  readonly outputBytes: number
}

type ExerciseImage = (path: string) => Promise<ExerciseResult>

class StagedError extends Error {
  readonly stage: Exclude<CorpusStage, 'manifest'>
  override readonly cause: unknown

  constructor(stage: Exclude<CorpusStage, 'manifest'>, cause: unknown) {
    super(`Corpus exercise failed during ${stage}`, { cause })
    this.name = 'StagedError'
    this.stage = stage
    this.cause = cause
  }
}

const errorDetails = (
  error: unknown,
  redactions: readonly string[] = [],
): { name: string; code?: string; message: string } => {
  const name = error instanceof Error ? error.name : 'NonErrorThrown'
  let message = error instanceof Error ? error.message : String(error)
  for (const redaction of redactions) message = message.replaceAll(redaction, '<corpus-file>')
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    return { name, code: error.code, message }
  }
  return { name, message }
}

const failureFrom = (entry: CorpusEntry, error: unknown): CorpusFailure => {
  const stage = error instanceof StagedError ? error.stage : 'transform'
  const cause = error instanceof StagedError ? error.cause : error
  return {
    id: entry.id,
    format: entry.format,
    sizeBytes: entry.sizeBytes,
    stage,
    ...errorDetails(cause, [entry.localPath]),
  }
}

const manifestFailure = (lineNumber: number, error: unknown): CorpusFailure => ({
  id: `manifest-line-${lineNumber}`,
  format: 'unknown',
  sizeBytes: 0,
  stage: 'manifest',
  ...errorDetails(error),
})

const resolveCorpusPath = (corpusDirectory: string, localRelativePath: string): string => {
  const root = resolve(corpusDirectory)
  const localPath = resolve(root, localRelativePath)
  const fromRoot = relative(root, localPath)
  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error('Manifest localRelativePath escapes the corpus directory')
  }
  return localPath
}

const parseEntry = (
  line: string,
  lineNumber: number,
  corpusDirectory: string,
):
  | { kind: 'entry'; entry: CorpusEntry }
  | { kind: 'skip' }
  | { kind: 'failure'; failure: CorpusFailure } => {
  try {
    const parsed: unknown = JSON.parse(line)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('Manifest record must be an object')
    }
    if (!('status' in parsed) || parsed.status !== 'downloaded') return { kind: 'skip' }
    if (
      !('detectedFormat' in parsed) ||
      typeof parsed.detectedFormat !== 'string' ||
      parsed.detectedFormat.length === 0
    ) {
      throw new Error('Downloaded manifest record is missing detectedFormat')
    }
    if (
      !('localRelativePath' in parsed) ||
      typeof parsed.localRelativePath !== 'string' ||
      parsed.localRelativePath.length === 0
    ) {
      throw new Error('Downloaded manifest record is missing localRelativePath')
    }
    if (
      !('sha256' in parsed) ||
      typeof parsed.sha256 !== 'string' ||
      !/^[a-f\d]{64}$/u.test(parsed.sha256)
    ) {
      throw new Error('Downloaded manifest record has an invalid sha256')
    }
    if (
      !('sizeBytes' in parsed) ||
      typeof parsed.sizeBytes !== 'number' ||
      !Number.isSafeInteger(parsed.sizeBytes) ||
      parsed.sizeBytes < 0
    ) {
      throw new Error('Downloaded manifest record has an invalid sizeBytes')
    }
    return {
      kind: 'entry',
      entry: {
        id: parsed.sha256,
        format: parsed.detectedFormat,
        localPath: resolveCorpusPath(corpusDirectory, parsed.localRelativePath),
        sizeBytes: parsed.sizeBytes,
      },
    }
  } catch (error) {
    return { kind: 'failure', failure: manifestFailure(lineNumber, error) }
  }
}

const exerciseImage: ExerciseImage = async (path) => {
  let image: NodeImage
  try {
    image = await imageLibrary.open(path, { frame: 0 })
  } catch (error) {
    throw new StagedError('open', error)
  }

  let inputMetadata: ImageMetadata
  try {
    inputMetadata = await image.metadata()
  } catch (error) {
    throw new StagedError('metadata', error)
  }

  let output: Buffer
  try {
    output = await image
      .autoOrient()
      .resize({
        width: 256,
        height: 256,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 80, background: '#ffffff' })
      .toBuffer()
  } catch (error) {
    throw new StagedError('transform', error)
  }

  try {
    const outputMetadata = await (await imageLibrary.open(output)).metadata()
    if (
      outputMetadata.format !== 'jpeg' ||
      outputMetadata.width < 1 ||
      outputMetadata.height < 1 ||
      outputMetadata.width > 256 ||
      outputMetadata.height > 256
    ) {
      throw new Error(
        `Unexpected transformed output: ${outputMetadata.format} ${outputMetadata.width}x${outputMetadata.height}`,
      )
    }
  } catch (error) {
    throw new StagedError('verify', error)
  }

  return { inputMetadata, outputBytes: output.byteLength }
}

const positiveInteger = (value: number, name: string): number => {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error(`${name} must be a positive integer`)
  return value
}

const summarizeErrors = (failures: readonly CorpusFailure[]): readonly CorpusErrorSummary[] => {
  const groups = new Map<
    string,
    { failure: CorpusFailure; count: number; ids: Set<string>; formats: Map<string, number> }
  >()
  for (const failure of failures) {
    const key = JSON.stringify([failure.stage, failure.name, failure.code ?? null, failure.message])
    const current = groups.get(key)
    if (current) {
      current.count += 1
      current.ids.add(failure.id)
      current.formats.set(failure.format, (current.formats.get(failure.format) ?? 0) + 1)
    } else {
      groups.set(key, {
        failure,
        count: 1,
        ids: new Set([failure.id]),
        formats: new Map([[failure.format, 1]]),
      })
    }
  }
  return [...groups.values()]
    .map(({ failure, count, ids, formats }) => ({
      stage: failure.stage,
      name: failure.name,
      ...(failure.code === undefined ? {} : { code: failure.code }),
      message: failure.message,
      count,
      uniqueFiles: ids.size,
      formats: Object.fromEntries(
        [...formats].sort(([left], [right]) => left.localeCompare(right)),
      ),
    }))
    .sort((left, right) => right.count - left.count || left.message.localeCompare(right.message))
}

const processConcurrently = async (
  entries: readonly CorpusEntry[],
  concurrency: number,
  processEntry: (entry: CorpusEntry) => Promise<void>,
): Promise<void> => {
  let cursor = 0
  const worker = async (): Promise<void> => {
    while (cursor < entries.length) {
      const entry = entries[cursor]
      cursor += 1
      if (entry) await processEntry(entry)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, entries.length) }, worker))
}

export const exerciseCorpus = async (
  options: ExerciseCorpusOptions,
  exercise: ExerciseImage = exerciseImage,
): Promise<CorpusReport> => {
  const startedAt = Date.now()
  const concurrency = positiveInteger(options.concurrency ?? 1, 'concurrency')
  const limit = options.limit === undefined ? undefined : positiveInteger(options.limit, 'limit')
  const shard = options.shard
  if (
    shard &&
    (!Number.isSafeInteger(shard.index) ||
      shard.index < 0 ||
      !Number.isSafeInteger(shard.count) ||
      shard.count < 1 ||
      shard.index >= shard.count)
  ) {
    throw new Error('shard must have a non-negative index smaller than its positive count')
  }
  const manifestPath = resolve(options.corpusDirectory, manifestFilename)
  const lines = createInterface({
    input: createReadStream(manifestPath),
    crlfDelay: Number.POSITIVE_INFINITY,
  })
  const entries: CorpusEntry[] = []
  const failures: CorpusFailure[] = []
  let recordsSeen = 0
  let skipped = 0

  for await (const line of lines) {
    recordsSeen += 1
    if (line.length === 0) continue
    const parsed = parseEntry(line, recordsSeen, options.corpusDirectory)
    if (parsed.kind === 'failure') {
      failures.push(parsed.failure)
      continue
    }
    if (parsed.kind === 'skip') {
      skipped += 1
      continue
    }
    if (options.formats && !options.formats.has(parsed.entry.format)) {
      skipped += 1
      continue
    }
    if (shard && Number.parseInt(parsed.entry.id.slice(0, 8), 16) % shard.count !== shard.index) {
      skipped += 1
      continue
    }
    if (limit !== undefined && entries.length >= limit) {
      skipped += 1
      continue
    }
    entries.push(parsed.entry)
  }

  const formatMap = new Map<string, CorpusFormatSummary>()
  for (const entry of entries) {
    const current = formatMap.get(entry.format)
    if (current) {
      current.selected += 1
      current.inputBytes += entry.sizeBytes
    } else {
      formatMap.set(entry.format, {
        format: entry.format,
        selected: 1,
        succeeded: 0,
        failed: 0,
        inputBytes: entry.sizeBytes,
        outputBytes: 0,
      })
    }
  }

  let completed = 0
  let succeeded = 0
  await processConcurrently(entries, concurrency, async (entry) => {
    const format = formatMap.get(entry.format)
    if (!format) throw new Error(`Missing summary for ${entry.format}`)
    try {
      const result = await exercise(entry.localPath)
      if (
        result.inputMetadata.width < 1 ||
        result.inputMetadata.height < 1 ||
        result.inputMetadata.format.length === 0
      ) {
        throw new StagedError(
          'metadata',
          new Error('Input metadata has invalid dimensions or format'),
        )
      }
      format.succeeded += 1
      format.outputBytes += result.outputBytes
      succeeded += 1
    } catch (error) {
      format.failed += 1
      failures.push(failureFrom(entry, error))
    } finally {
      completed += 1
      options.onProgress?.({
        completed,
        selected: entries.length,
        succeeded,
        failed: completed - succeeded,
      })
    }
  })

  failures.sort(
    (left, right) => left.id.localeCompare(right.id) || left.stage.localeCompare(right.stage),
  )
  const formats = [...formatMap.values()].sort((left, right) =>
    left.format.localeCompare(right.format),
  )
  return {
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    options: {
      concurrency,
      formats: options.formats ? [...options.formats].sort() : [],
      limit: limit ?? null,
      transform: 'frame-0-auto-orient-resize-inside-256-jpeg',
      shard: shard ?? null,
    },
    summary: {
      recordsSeen,
      selected: entries.length,
      skipped,
      succeeded,
      failed: failures.length,
      inputBytes: formats.reduce((total, format) => total + format.inputBytes, 0),
      outputBytes: formats.reduce((total, format) => total + format.outputBytes, 0),
    },
    formats,
    errors: summarizeErrors(failures),
    failures,
  }
}

interface CliOptions {
  readonly corpusDirectory: string
  readonly concurrency: number
  readonly formats?: ReadonlySet<string>
  readonly limit?: number
  readonly shard?: CorpusShard
  readonly outputPath: string
}

const argumentValue = (arguments_: readonly string[], index: number, name: string): string => {
  const value = arguments_[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return value
}

const parseCli = (arguments_: readonly string[]): CliOptions => {
  let corpusDirectory = process.env.PUREJSIMAGE_CORPUS_DIR
  let concurrency = 1
  let formats: ReadonlySet<string> | undefined
  let limit: number | undefined
  let outputPath = defaultOutputPath
  let shard: CorpusShard | undefined

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]
    if (!argument) continue
    if (argument === '--concurrency') {
      concurrency = positiveInteger(Number(argumentValue(arguments_, index, argument)), argument)
      index += 1
    } else if (argument === '--format') {
      const values = argumentValue(arguments_, index, argument)
        .split(',')
        .filter((value) => value.length > 0)
      if (values.length === 0) throw new Error('--format requires at least one format')
      formats = new Set(values)
      index += 1
    } else if (argument === '--limit') {
      limit = positiveInteger(Number(argumentValue(arguments_, index, argument)), argument)
      index += 1
    } else if (argument === '--shard') {
      const value = argumentValue(arguments_, index, argument)
      const match = /^(\d+)\/(\d+)$/u.exec(value)
      const shardIndex = Number(match?.[1])
      const shardCount = Number(match?.[2])
      if (
        !match ||
        !Number.isSafeInteger(shardIndex) ||
        shardIndex < 0 ||
        !Number.isSafeInteger(shardCount) ||
        shardCount < 1 ||
        shardIndex >= shardCount
      ) {
        throw new Error('--shard must use INDEX/COUNT with 0 <= INDEX < COUNT')
      }
      shard = { index: shardIndex, count: shardCount }
      index += 1
    } else if (argument === '--output') {
      outputPath = argumentValue(arguments_, index, argument)
      index += 1
    } else if (argument.startsWith('--')) {
      throw new Error(`Unknown option: ${argument}`)
    } else if (corpusDirectory) {
      throw new Error(`Unexpected positional argument: ${argument}`)
    } else {
      corpusDirectory = argument
    }
  }

  if (!corpusDirectory) {
    throw new Error(
      'Usage: npm run corpus:exercise -- <corpus-directory> [--limit N] [--format jpeg,png] [--concurrency N] [--shard INDEX/COUNT] [--output report.json]',
    )
  }
  return {
    corpusDirectory,
    concurrency,
    ...(formats === undefined ? {} : { formats }),
    ...(limit === undefined ? {} : { limit }),
    ...(shard === undefined ? {} : { shard }),
    outputPath,
  }
}

const runCli = async (): Promise<void> => {
  const options = parseCli(process.argv.slice(2))
  let lastPrinted = 0
  const report = await exerciseCorpus({
    corpusDirectory: options.corpusDirectory,
    concurrency: options.concurrency,
    ...(options.formats === undefined ? {} : { formats: options.formats }),
    ...(options.limit === undefined ? {} : { limit: options.limit }),
    ...(options.shard === undefined ? {} : { shard: options.shard }),
    onProgress(progress) {
      if (progress.completed === progress.selected || progress.completed - lastPrinted >= 100) {
        lastPrinted = progress.completed
        console.error(
          `Processed ${progress.completed}/${progress.selected}: ${progress.succeeded} passed, ${progress.failed} failed`,
        )
      }
    },
  })
  await mkdir(dirname(options.outputPath), { recursive: true })
  await writeFile(options.outputPath, `${JSON.stringify(report, undefined, 2)}\n`)
  console.log(
    JSON.stringify(
      {
        report: options.outputPath,
        summary: report.summary,
        formats: report.formats,
        errors: report.errors,
      },
      undefined,
      2,
    ),
  )
  if (report.summary.failed > 0) process.exitCode = 1
}

const entrypoint = process.argv[1]
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) await runCli()
