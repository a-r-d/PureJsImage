import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { jpegxlCodec } from '../../../src/codecs/jpegxl.ts'
import { ImageError } from '../../../src/errors.ts'
import { defaultImageLimits } from '../../../src/limits.ts'
import { MemorySource } from '../../../src/source.ts'

type Classification =
  | 'pass'
  | 'expected-unsupported'
  | 'malformed-safely-rejected'
  | 'incorrect-output'
  | 'unexpected-failure'

interface ConformanceCase {
  readonly id: string
  readonly sha256: string
  readonly bytes: number
  readonly license: string
  readonly levels: readonly (5 | 10)[]
  readonly baselineClassification: Classification
  readonly outputSha256?: string
  readonly colorOutput?: 'preserve'
  readonly boundary?: string
  readonly expectedErrorCode?: string
}

interface ConformanceManifest {
  readonly revision: string
  readonly archiveSha256: string
  readonly cases: readonly ConformanceCase[]
}

interface ConformanceResult {
  readonly id: string
  readonly levels: readonly (5 | 10)[]
  readonly license: string
  readonly inputBytes: number
  readonly inputSha256: string
  readonly baselineClassification: Classification
  readonly actualClassification: Classification
  readonly matchesBaseline: boolean
  readonly boundary?: string
  readonly outputSha256?: string
  readonly outputFormat?: string
  readonly rows?: number
  readonly errorCode?: string
  readonly errorMessage?: string
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const requiredString = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} must be a string`)
  return value
}

const optionalString = (value: unknown, label: string): string | undefined =>
  value === undefined ? undefined : requiredString(value, label)

const classification = (value: unknown, label: string): Classification => {
  if (
    value === 'pass' ||
    value === 'expected-unsupported' ||
    value === 'malformed-safely-rejected' ||
    value === 'incorrect-output' ||
    value === 'unexpected-failure'
  ) {
    return value
  }
  throw new Error(`${label} is not a known classification`)
}

const parseCase = (value: unknown, index: number): ConformanceCase => {
  if (!isRecord(value)) throw new Error(`Conformance case ${index} must be an object`)
  const levels = value.levels
  if (!Array.isArray(levels) || levels.some((level) => level !== 5 && level !== 10)) {
    throw new Error(`Conformance case ${index} levels must contain only 5 or 10`)
  }
  if (!Number.isSafeInteger(value.bytes) || Number(value.bytes) < 1) {
    throw new Error(`Conformance case ${index} bytes must be a positive integer`)
  }
  if (value.colorOutput !== undefined && value.colorOutput !== 'preserve')
    throw new Error(`Conformance case ${index} has invalid colorOutput`)
  return Object.freeze({
    id: requiredString(value.id, `cases[${index}].id`),
    sha256: requiredString(value.sha256, `cases[${index}].sha256`),
    bytes: Number(value.bytes),
    ...(value.colorOutput === 'preserve' ? { colorOutput: 'preserve' as const } : {}),
    license: requiredString(value.license, `cases[${index}].license`),
    levels: Object.freeze(levels.map((level) => (level === 5 ? 5 : 10))),
    baselineClassification: classification(
      value.baselineClassification,
      `cases[${index}].baselineClassification`,
    ),
    ...(optionalString(value.outputSha256, `cases[${index}].outputSha256`) === undefined
      ? {}
      : { outputSha256: requiredString(value.outputSha256, `cases[${index}].outputSha256`) }),
    ...(optionalString(value.boundary, `cases[${index}].boundary`) === undefined
      ? {}
      : { boundary: requiredString(value.boundary, `cases[${index}].boundary`) }),
    ...(optionalString(value.expectedErrorCode, `cases[${index}].expectedErrorCode`) === undefined
      ? {}
      : {
          expectedErrorCode: requiredString(
            value.expectedErrorCode,
            `cases[${index}].expectedErrorCode`,
          ),
        }),
  })
}

const readManifest = async (): Promise<ConformanceManifest> => {
  const path = join('benchmark', 'jpegxl', 'production-program', 'corpora', 'conformance.json')
  const value: unknown = JSON.parse(await readFile(path, 'utf8'))
  if (!isRecord(value) || !Array.isArray(value.cases)) {
    throw new Error('JPEG XL conformance manifest is invalid')
  }
  const cases = value.cases.map(parseCase)
  if (new Set(cases.map(({ id }) => id)).size !== cases.length) {
    throw new Error('JPEG XL conformance case IDs must be unique')
  }
  return Object.freeze({
    revision: requiredString(value.revision, 'revision'),
    archiveSha256: requiredString(value.archiveSha256, 'archiveSha256'),
    cases: Object.freeze(cases),
  })
}

const argument = (name: string): string | undefined => {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}

const digest = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')

const corpusRoot = argument('--corpus-root')
if (!corpusRoot) {
  throw new Error(
    'Usage: node benchmark/jpegxl/production-program/run-conformance.ts --corpus-root <conformance-root> [--output <report.json>]',
  )
}

const manifest = await readManifest()
const results: ConformanceResult[] = []
for (const definition of manifest.cases) {
  const path = join(corpusRoot, 'testcases', definition.id, 'input.jxl')
  const encoded = new Uint8Array(await readFile(path))
  if (encoded.byteLength !== definition.bytes || digest(encoded) !== definition.sha256) {
    throw new Error(`${definition.id} does not match its pinned byte length and SHA-256`)
  }
  let actualClassification: Classification
  let outputSha256: string | undefined
  let outputFormat: string | undefined
  let rows: number | undefined
  let errorCode: string | undefined
  let errorMessage: string | undefined
  try {
    const decoder = await jpegxlCodec.createDecoder?.(
      new MemorySource(encoded),
      Object.freeze({ ...defaultImageLimits, maxDecodedBytes: 256 * 1_024 * 1_024 }),
      definition.colorOutput === undefined ? {} : { colorOutput: definition.colorOutput },
    )
    if (!decoder) throw new Error('JPEG XL decoder is unavailable')
    const outputDigest = createHash('sha256')
    let decodedRows = 0
    for await (const block of decoder.decode()) {
      outputDigest.update(block.data)
      decodedRows += block.height
      block.release?.()
    }
    outputSha256 = outputDigest.digest('hex')
    outputFormat = decoder.pixelFormat
    rows = decodedRows
    actualClassification =
      definition.outputSha256 !== undefined && outputSha256 === definition.outputSha256
        ? 'pass'
        : 'incorrect-output'
  } catch (error) {
    errorCode = error instanceof ImageError ? error.code : 'UNKNOWN'
    errorMessage = error instanceof Error ? error.message : String(error)
    actualClassification =
      errorCode === 'UNSUPPORTED_OPERATION'
        ? 'expected-unsupported'
        : definition.baselineClassification === 'malformed-safely-rejected' &&
            (errorCode === 'INVALID_INPUT' || errorCode === 'TRUNCATED_INPUT')
          ? 'malformed-safely-rejected'
          : 'unexpected-failure'
  }
  const matchesBaseline =
    actualClassification === definition.baselineClassification &&
    (definition.expectedErrorCode === undefined || definition.expectedErrorCode === errorCode)
  results.push(
    Object.freeze({
      id: definition.id,
      levels: definition.levels,
      license: definition.license,
      inputBytes: definition.bytes,
      inputSha256: definition.sha256,
      baselineClassification: definition.baselineClassification,
      actualClassification,
      matchesBaseline,
      ...(definition.boundary === undefined ? {} : { boundary: definition.boundary }),
      ...(outputSha256 === undefined ? {} : { outputSha256 }),
      ...(outputFormat === undefined ? {} : { outputFormat }),
      ...(rows === undefined ? {} : { rows }),
      ...(errorCode === undefined ? {} : { errorCode }),
      ...(errorMessage === undefined ? {} : { errorMessage }),
    }),
  )
}

const classifications: readonly Classification[] = Object.freeze([
  'pass',
  'expected-unsupported',
  'malformed-safely-rejected',
  'incorrect-output',
  'unexpected-failure',
])
const totals = Object.fromEntries(
  classifications.map((name) => [
    name,
    results.filter(({ actualClassification }) => actualClassification === name).length,
  ]),
)
const mismatches = results.filter(({ matchesBaseline }) => !matchesBaseline)
const report = Object.freeze({
  schemaVersion: 1,
  corpusRevision: manifest.revision,
  archiveSha256: manifest.archiveSha256,
  cases: results.length,
  totals,
  baselineMatched: mismatches.length === 0,
  results: Object.freeze(results),
})
const serialized = `${JSON.stringify(report, null, 2)}\n`
const output = argument('--output')
if (output) await writeFile(output, serialized)
else process.stdout.write(serialized)
if (mismatches.length > 0) {
  throw new Error(
    `JPEG XL conformance classification changed for ${mismatches.map(({ id }) => id).join(', ')}`,
  )
}
