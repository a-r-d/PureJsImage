import { createHash } from 'node:crypto'
import { opendir, readFile, writeFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

import { avifCodec } from '../../src/codecs/avif.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { MemorySource } from '../../src/source.ts'

interface CorpusSource {
  readonly label: string
  readonly path: string
}

interface SurveySuccess {
  readonly category: string
  readonly file: string
  readonly fileSha256: string
  readonly height: number
  readonly outcome: 'decoded'
  readonly rgbaSha256: string
  readonly source: string
  readonly wallMilliseconds: number
  readonly width: number
}

interface SurveyFailure {
  readonly category: string
  readonly code?: string
  readonly file: string
  readonly fileSha256: string
  readonly message: string
  readonly outcome: 'error'
  readonly source: string
  readonly taxonomy: string
  readonly wallMilliseconds: number
}

type SurveyOutcome = SurveyFailure | SurveySuccess

const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')

const avifFiles = async (directory: string): Promise<string[]> => {
  const output: string[] = []
  const entries = await opendir(directory)
  for await (const entry of entries) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) output.push(...(await avifFiles(path)))
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.avif')) output.push(path)
  }
  return output.sort()
}

const errorCode = (error: unknown): string | undefined => {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  return typeof error.code === 'string' ? error.code : undefined
}

const classify = (message: string, code: string | undefined): string => {
  if (message.includes('Animated AVIF')) return 'animation'
  if (message.includes('frame OBU') || message.includes('tile groups')) return 'frame-layout'
  if (message.includes('alpha')) return 'alpha-auxiliary'
  if (
    message.includes('high-bit-depth') ||
    message.includes('10-bit') ||
    message.includes('12-bit')
  ) {
    return 'high-bit-depth'
  }
  if (message.includes('filter-free frames')) return 'high-bit-post-filters'
  if (
    message.includes('symbol decoder') ||
    message.includes('tile trailing') ||
    message.includes('coefficient') ||
    message.includes('partition')
  ) {
    return 'entropy-or-reconstruction-syntax'
  }
  if (message.includes('intra-block-copy')) return 'intra-block-copy-residual'
  if (message.includes('film grain')) return 'film-grain'
  if (message.includes('working set')) return 'working-set-limit'
  if (message.includes('clean-aperture') || message.includes('mirroring')) {
    return 'presentation-transform'
  }
  if (code === 'LIMIT_EXCEEDED') return 'limit'
  if (code === 'INVALID_INPUT') return 'malformed-or-unsupported-container'
  if (code === 'UNSUPPORTED_OPERATION') return 'unsupported-av1-or-container-feature'
  return 'unexpected-error'
}

const sourceArguments: string[] = []
let outputPath: string | undefined
for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index]
  if (argument === '--source') {
    const value = process.argv[index + 1]
    if (!value) throw new Error('--source requires label=directory')
    sourceArguments.push(value)
    index += 1
  } else if (argument === '--output') {
    outputPath = process.argv[index + 1]
    if (!outputPath) throw new Error('--output requires a path')
    index += 1
  } else {
    throw new Error(`Unknown compatibility-survey argument: ${argument ?? 'missing'}`)
  }
}
if (sourceArguments.length === 0) {
  throw new Error(
    'Usage: run-compatibility-survey.ts --source label=directory [--source ...] [--output report.json]',
  )
}
const sources: CorpusSource[] = sourceArguments.map((argument) => {
  const separator = argument.indexOf('=')
  if (separator < 1 || separator === argument.length - 1) {
    throw new Error(`Invalid corpus source: ${argument}`)
  }
  return { label: argument.slice(0, separator), path: resolve(argument.slice(separator + 1)) }
})

const outcomes: SurveyOutcome[] = []
for (const source of sources) {
  for (const path of await avifFiles(source.path)) {
    const bytes = new Uint8Array(await readFile(path))
    const file = relative(source.path, path)
    const firstSeparator = file.indexOf('/')
    const category = firstSeparator === -1 ? 'generated' : file.slice(0, firstSeparator)
    const startedAt = performance.now()
    try {
      const decoder = await avifCodec.createDecoder?.(new MemorySource(bytes), defaultImageLimits)
      if (!decoder) throw new Error('AVIF decoder is unavailable')
      const hash = createHash('sha256')
      for await (const block of decoder.decode()) {
        hash.update(block.data.subarray(0, block.stride * block.height))
        block.release?.()
      }
      outcomes.push({
        category,
        file,
        fileSha256: sha256(bytes),
        height: decoder.height,
        outcome: 'decoded',
        rgbaSha256: hash.digest('hex'),
        source: source.label,
        wallMilliseconds: Number((performance.now() - startedAt).toFixed(3)),
        width: decoder.width,
      })
    } catch (error) {
      const code = errorCode(error)
      const message = error instanceof Error ? error.message : String(error)
      outcomes.push({
        category,
        ...(code ? { code } : {}),
        file,
        fileSha256: sha256(bytes),
        message,
        outcome: 'error',
        source: source.label,
        taxonomy: classify(message, code),
        wallMilliseconds: Number((performance.now() - startedAt).toFixed(3)),
      })
    }
  }
}

const countBy = (key: (outcome: SurveyOutcome) => string): Readonly<Record<string, number>> => {
  const counts: Record<string, number> = {}
  for (const outcome of outcomes) {
    const value = key(outcome)
    counts[value] = (counts[value] ?? 0) + 1
  }
  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)),
  )
}
const decoded = outcomes.filter((outcome) => outcome.outcome === 'decoded').length
const report = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  platform: `${process.platform}/${process.arch}`,
  sources,
  summary: {
    files: outcomes.length,
    decoded,
    errors: outcomes.length - decoded,
    decodedPercent: Number(((decoded / outcomes.length) * 100).toFixed(1)),
    bySourceAndOutcome: countBy((outcome) => `${outcome.source}:${outcome.outcome}`),
    errorTaxonomy: countBy((outcome) =>
      outcome.outcome === 'error' ? outcome.taxonomy : 'decoded',
    ),
  },
  outcomes,
}
const serialized = `${JSON.stringify(report, undefined, 2)}\n`
if (outputPath) await writeFile(resolve(outputPath), serialized)
console.log(serialized.trim())
