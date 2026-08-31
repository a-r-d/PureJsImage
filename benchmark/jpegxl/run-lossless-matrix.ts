import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { inspectJpegXlStructure, jpegxlCodec } from '../../src/codecs/jpegxl.ts'
import { ImageError } from '../../src/errors.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { MemorySource } from '../../src/source.ts'

interface ManifestFixture {
  readonly id: string
  readonly source: string
  readonly width: number
  readonly height: number
  readonly bitDepth: number
  readonly features: readonly string[]
  readonly options: readonly string[]
  readonly inputSha256: string
  readonly jxlSha256: string
  readonly jxlBytes: number
  readonly djxlOutputSha256: string
}

interface Manifest {
  readonly oracle: string
  readonly revision: string
  readonly fixtures: readonly ManifestFixture[]
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null

const readStringArray = (value: unknown, name: string): readonly string[] => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${name} must be a string array`)
  }
  return Object.freeze(value.map((item) => String(item)))
}

const readFixture = (value: unknown): ManifestFixture => {
  if (!isRecord(value)) throw new Error('JPEG XL matrix fixture must be an object')
  const stringFields = ['id', 'source', 'inputSha256', 'jxlSha256', 'djxlOutputSha256'] as const
  for (const field of stringFields) {
    if (typeof value[field] !== 'string') throw new Error(`JPEG XL fixture ${field} is invalid`)
  }
  const numberFields = ['width', 'height', 'bitDepth', 'jxlBytes'] as const
  for (const field of numberFields) {
    if (!Number.isSafeInteger(value[field]) || Number(value[field]) < 1) {
      throw new Error(`JPEG XL fixture ${field} is invalid`)
    }
  }
  return Object.freeze({
    id: String(value.id),
    source: String(value.source),
    width: Number(value.width),
    height: Number(value.height),
    bitDepth: Number(value.bitDepth),
    features: readStringArray(value.features, 'features'),
    options: readStringArray(value.options, 'options'),
    inputSha256: String(value.inputSha256),
    jxlSha256: String(value.jxlSha256),
    jxlBytes: Number(value.jxlBytes),
    djxlOutputSha256: String(value.djxlOutputSha256),
  })
}

const readManifest = (value: unknown): Manifest => {
  if (
    !isRecord(value) ||
    typeof value.oracle !== 'string' ||
    typeof value.revision !== 'string' ||
    !Array.isArray(value.fixtures)
  ) {
    throw new Error('JPEG XL generated manifest is invalid')
  }
  return Object.freeze({
    oracle: value.oracle,
    revision: value.revision,
    fixtures: Object.freeze(value.fixtures.map(readFixture)),
  })
}

const pnmPayload = (data: Uint8Array): Uint8Array => {
  const marker = new TextEncoder().encode('ENDHDR\n')
  for (let offset = 0; offset <= data.byteLength - marker.byteLength; offset += 1) {
    if (marker.every((value, index) => data[offset + index] === value)) {
      return data.subarray(offset + marker.byteLength)
    }
  }
  let offset = 0
  let tokens = 0
  while (offset < data.byteLength && tokens < 4) {
    while (offset < data.byteLength && (data[offset] ?? 0) <= 0x20) offset += 1
    if (data[offset] === 0x23) {
      while (offset < data.byteLength && data[offset] !== 0x0a) offset += 1
      continue
    }
    while (offset < data.byteLength && (data[offset] ?? 0) > 0x20) offset += 1
    tokens += 1
  }
  if (tokens !== 4 || offset >= data.byteLength) throw new Error('Oracle PNM header is invalid')
  return data.subarray(offset + 1)
}

const digest = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')
const messageFrom = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const directory = join('benchmark', 'fixtures', 'jpegxl', 'generated-lossless-v0.12.0')
const manifest = readManifest(
  JSON.parse(
    await readFile(join('benchmark', 'jpegxl', 'generated-lossless-manifest.json'), 'utf8'),
  ),
)
const rows: {
  id: string
  status: 'exact' | 'mismatch' | 'unsupported' | 'error'
  format?: string
  organization?: string
  pureJsImageSha256?: string
  oracleSamplesSha256?: string
  reason?: string
}[] = []

for (const fixture of manifest.fixtures) {
  const encoded = new Uint8Array(await readFile(join(directory, `${fixture.id}.jxl`)))
  const oracleExtension = fixture.id.startsWith('rgba') ? 'pam' : 'pnm'
  const oracle = new Uint8Array(
    await readFile(join(directory, `${fixture.id}.oracle.${oracleExtension}`)),
  )
  const oracleSamplesSha256 = digest(pnmPayload(oracle))
  try {
    const structure = await inspectJpegXlStructure(encoded)
    const source = new MemorySource(encoded)
    const decoder = await jpegxlCodec.createDecoder?.(source, defaultImageLimits)
    if (!decoder) throw new Error('JPEG XL decoder is unavailable')
    const decoded = createHash('sha256')
    let rowsDecoded = 0
    for await (const block of decoder.decode()) {
      decoded.update(block.data)
      rowsDecoded += block.height
      block.release?.()
    }
    const pureJsImageSha256 = decoded.digest('hex')
    rows.push({
      id: fixture.id,
      status:
        rowsDecoded === fixture.height && pureJsImageSha256 === oracleSamplesSha256
          ? 'exact'
          : 'mismatch',
      format: decoder.pixelFormat,
      organization: structure.organization,
      pureJsImageSha256,
      oracleSamplesSha256,
      ...(rowsDecoded === fixture.height ? {} : { reason: `decoded ${rowsDecoded} rows` }),
    })
  } catch (error) {
    rows.push({
      id: fixture.id,
      status:
        error instanceof ImageError && error.code === 'UNSUPPORTED_OPERATION'
          ? 'unsupported'
          : 'error',
      oracleSamplesSha256,
      reason: error instanceof ImageError ? `${error.code}: ${error.message}` : messageFrom(error),
    })
  }
}

const summary = {
  oracle: manifest.oracle,
  revision: manifest.revision,
  measuredAt: new Date().toISOString(),
  totals: {
    exact: rows.filter((row) => row.status === 'exact').length,
    mismatch: rows.filter((row) => row.status === 'mismatch').length,
    unsupported: rows.filter((row) => row.status === 'unsupported').length,
    error: rows.filter((row) => row.status === 'error').length,
  },
  rows,
}
await writeFile(
  join(directory, 'purejsimage-matrix.json'),
  `${JSON.stringify(summary, undefined, 2)}\n`,
)
for (const row of rows) {
  console.log(`${row.status.padEnd(11)} ${row.id}${row.reason ? `: ${row.reason}` : ''}`)
}
console.log(JSON.stringify(summary.totals))
