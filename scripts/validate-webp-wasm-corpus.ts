import { spawn } from 'node:child_process'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { discoverImazenCorpus, type ImazenCorpusEntry } from './validate-imazen-corpus.ts'

type WasmVariant = 'scalar' | 'simd'

interface CliOptions {
  readonly concurrency: number
  readonly corpus: string
  readonly filter: string | null
  readonly limit: number | null
  readonly memoryMb: number
  readonly output: string
  readonly timeoutMs: number
  readonly variant: WasmVariant
}

interface RecordResult {
  readonly elapsedMs: number
  readonly filename: string
  readonly message: string | null
  readonly status:
    | 'pass'
    | 'matched-error'
    | 'failure'
    | 'timeout'
    | 'process-crash'
    | 'out-of-memory'
}

interface WorkerResult {
  readonly status: 'pass' | 'matched-error' | 'failure'
  readonly message?: string
}

const workerPath = fileURLToPath(new URL('./validate-webp-wasm-worker.ts', import.meta.url))
const maximumOutputBytes = 65_536

const positiveInteger = (value: string, name: string): number => {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${name} must be positive`)
  return parsed
}

const valueAfter = (arguments_: readonly string[], index: number, name: string): string => {
  const value = arguments_[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return value
}

const parseCli = (arguments_: readonly string[]): CliOptions => {
  let corpus: string | undefined
  let variant: WasmVariant | undefined
  let output = 'benchmark/.tmp/imazen-webp-wasm'
  let timeoutMs = 30_000
  let memoryMb = 512
  let concurrency = 2
  let limit: number | null = null
  let filter: string | null = null
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]
    if (argument === '--corpus') corpus = valueAfter(arguments_, index, argument)
    else if (argument === '--variant') {
      const value = valueAfter(arguments_, index, argument)
      if (value !== 'scalar' && value !== 'simd') throw new Error('variant must be scalar or simd')
      variant = value
    } else if (argument === '--output') output = valueAfter(arguments_, index, argument)
    else if (argument === '--timeout-ms') {
      timeoutMs = positiveInteger(valueAfter(arguments_, index, argument), argument)
    } else if (argument === '--memory-mb') {
      memoryMb = positiveInteger(valueAfter(arguments_, index, argument), argument)
    } else if (argument === '--concurrency') {
      concurrency = positiveInteger(valueAfter(arguments_, index, argument), argument)
    } else if (argument === '--limit') {
      limit = positiveInteger(valueAfter(arguments_, index, argument), argument)
    } else if (argument === '--filter') filter = valueAfter(arguments_, index, argument)
    else throw new Error(`Unknown option: ${argument ?? '<missing>'}`)
    index += 1
  }
  if (!corpus || !variant) {
    throw new Error(
      'Usage: npm run corpus:imazen:webp-wasm -- --corpus <path> --variant scalar|simd [--output <path>] [--timeout-ms N] [--memory-mb N] [--concurrency N] [--limit N] [--filter substring]',
    )
  }
  return { concurrency, corpus, filter, limit, memoryMb, output, timeoutMs, variant }
}

const portable = (path: string): string => path.split(sep).join('/')

const boundedAppend = (current: string, chunk: Uint8Array): string =>
  current.length >= maximumOutputBytes
    ? current
    : (current + Buffer.from(chunk).toString('utf8')).slice(0, maximumOutputBytes)

const sanitize = (message: string, entry: ImazenCorpusEntry, corpusRoot: string): string =>
  message
    .replaceAll(entry.absolutePath, '<corpus-file>')
    .replaceAll(corpusRoot, '<corpus>')
    .replaceAll(process.cwd(), '<repository>')
    .replace(/[\r\n\t]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 500)

const parseWorker = (stdout: string): WorkerResult | undefined => {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout.trim())
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null || !('status' in parsed)) return undefined
  if (parsed.status === 'pass' || parsed.status === 'matched-error')
    return { status: parsed.status }
  if (parsed.status === 'failure' && 'message' in parsed && typeof parsed.message === 'string') {
    return { message: parsed.message, status: 'failure' }
  }
  return undefined
}

const runEntry = async (
  entry: ImazenCorpusEntry,
  options: CliOptions,
  corpusRoot: string,
): Promise<RecordResult> => {
  const startedAt = performance.now()
  const child = spawn(
    process.execPath,
    [
      `--max-old-space-size=${options.memoryMb}`,
      workerPath,
      '--file',
      entry.absolutePath,
      '--variant',
      options.variant,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
  )
  let stdout = ''
  let stderr = ''
  let timedOut = false
  child.stdout.on('data', (chunk: Buffer) => {
    stdout = boundedAppend(stdout, chunk)
  })
  child.stderr.on('data', (chunk: Buffer) => {
    stderr = boundedAppend(stderr, chunk)
  })
  const timer = setTimeout(() => {
    timedOut = true
    child.kill('SIGKILL')
  }, options.timeoutMs)
  const { promise, resolve: resolveResult } = Promise.withResolvers<RecordResult>()
  let spawnError: string | undefined
  child.once('error', (error) => {
    spawnError = error.message
  })
  child.once('close', (exitCode, signal) => {
    clearTimeout(timer)
    const elapsedMs = Math.max(0, Math.round(performance.now() - startedAt))
    const diagnostic = sanitize([stderr, spawnError].filter(Boolean).join(' '), entry, corpusRoot)
    if (timedOut) {
      resolveResult({
        elapsedMs,
        filename: entry.relativeFilename,
        message: diagnostic,
        status: 'timeout',
      })
      return
    }
    if (/heap out of memory|allocation failed|javascript heap|out of memory/iu.test(stderr)) {
      resolveResult({
        elapsedMs,
        filename: entry.relativeFilename,
        message: diagnostic,
        status: 'out-of-memory',
      })
      return
    }
    if (exitCode !== 0 || signal !== null) {
      resolveResult({
        elapsedMs,
        filename: entry.relativeFilename,
        message: diagnostic || `Worker exited with ${exitCode ?? signal ?? 'unknown'}`,
        status: 'process-crash',
      })
      return
    }
    const result = parseWorker(stdout)
    if (!result) {
      resolveResult({
        elapsedMs,
        filename: entry.relativeFilename,
        message: sanitize(stdout || stderr, entry, corpusRoot) || 'Worker returned invalid output',
        status: 'process-crash',
      })
      return
    }
    resolveResult({
      elapsedMs,
      filename: entry.relativeFilename,
      message: result.message ? sanitize(result.message, entry, corpusRoot) : null,
      status: result.status,
    })
  })
  return promise
}

const processConcurrently = async (
  entries: readonly ImazenCorpusEntry[],
  options: CliOptions,
  corpusRoot: string,
): Promise<readonly RecordResult[]> => {
  const results: Array<RecordResult | undefined> = new Array(entries.length)
  let cursor = 0
  let completed = 0
  const worker = async (): Promise<void> => {
    while (cursor < entries.length) {
      const index = cursor
      cursor += 1
      const entry = entries[index]
      if (!entry) continue
      results[index] = await runEntry(entry, options, corpusRoot)
      completed += 1
      if (completed === entries.length || completed % 10 === 0) {
        console.error(`Processed ${completed}/${entries.length} ${options.variant} WebP files`)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(options.concurrency, entries.length) }, worker))
  return results.map((result, index) => {
    if (!result) throw new Error(`Missing result ${index}`)
    return result
  })
}

const atomicWrite = async (path: string, content: string): Promise<void> => {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.tmp-${process.pid}`
  try {
    await writeFile(temporary, content)
    await rename(temporary, path)
  } finally {
    await rm(temporary, { force: true })
  }
}

const runCli = async (): Promise<void> => {
  const options = parseCli(process.argv.slice(2))
  const corpusRoot = resolve(options.corpus)
  const entries = await discoverImazenCorpus(corpusRoot, 'webp', options.filter, options.limit)
  if (entries.length === 0) throw new Error('No WebP corpus files matched')
  const records = await processConcurrently(entries, options, corpusRoot)
  const totals = Object.groupBy(records, ({ status }) => status)
  const summary = Object.fromEntries(
    Object.entries(totals).map(([status, matching]) => [status, matching?.length ?? 0]),
  )
  const report = {
    corpus: portable(relative(process.cwd(), corpusRoot)),
    generatedAt: new Date().toISOString(),
    memoryMb: options.memoryMb,
    records,
    timeoutMs: options.timeoutMs,
    totals: summary,
    variant: options.variant,
  }
  const output = resolve(options.output)
  const jsonPath = join(output, `imazen-webp-wasm-${options.variant}.json`)
  const markdownPath = join(output, `imazen-webp-wasm-${options.variant}.md`)
  const failures = records.filter(({ status }) => status !== 'pass' && status !== 'matched-error')
  const lines = [
    `# Imazen WebP ${options.variant} WASM validation`,
    '',
    `Exact TypeScript parity with forced ${options.variant} WASM kernels across ${records.length} isolated files.`,
    '',
    `- Pass: ${summary.pass ?? 0}`,
    `- Matched structured errors: ${summary['matched-error'] ?? 0}`,
    `- Failures: ${failures.length}`,
    '',
  ]
  for (const failure of failures) {
    lines.push(
      `- \`${failure.filename}\`: ${failure.status}; ${failure.message ?? 'no diagnostic'}`,
    )
  }
  await atomicWrite(jsonPath, `${JSON.stringify(report, undefined, 2)}\n`)
  await atomicWrite(markdownPath, `${lines.join('\n')}\n`)
  console.log(
    JSON.stringify({
      failures: failures.length,
      reports: [portable(jsonPath), portable(markdownPath)],
      totals: summary,
    }),
  )
  if (failures.length > 0) process.exitCode = 1
}

const entrypoint = process.argv[1]
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) await runCli()
