import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const record = (value: unknown): Record<string, unknown> => {
  if (!isRecord(value)) throw new Error('Invalid expansion metric cache object')
  return value
}

export async function reuseM7ExpansionMetrics(options: {
  reportPath: string
  protocolPath?: string
  protocol: Readonly<Record<string, unknown>>
  kind: 'hdr' | 'alpha'
  id: string
  sourceSha256: string
  engine: string
  setting: number
  domain: number | string
  decodedSha256: string
}): Promise<
  | {
      ssimulacra2: number
      butteraugli: number
      ssimulacra2Text: string
      butteraugliText: string
      metricReuse: { reportPath: string; reportSha256: string }
    }
  | undefined
> {
  if (!/^[a-f0-9]{64}$/u.test(options.decodedSha256)) throw new Error('Invalid fresh display hash')
  let bytes: Uint8Array
  try {
    bytes = await readFile(options.reportPath)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
    throw error
  }
  const report = record(JSON.parse(new TextDecoder().decode(bytes)))
  const protocol = options.protocolPath
    ? record(JSON.parse(await readFile(options.protocolPath, 'utf8')))
    : record(report.protocol)
  if ((protocol.split ?? 'development') !== (options.protocol.split ?? 'development'))
    throw new Error('Expansion metric cache split mismatch')
  const fields =
    options.kind === 'hdr'
      ? [
          'id',
          'distance',
          'width',
          'height',
          'effort',
          'sourceSha256',
          'inputSha256',
          'referenceSha256',
          'mappingProtocolSha256',
          'oracleFiles',
        ]
      : ['cases', 'mappingProtocolSha256', 'mappingHash', 'oracleFiles', 'sharpVersions']
  for (const field of fields)
    if (
      protocol[field] === undefined ||
      JSON.stringify(protocol[field]) !== JSON.stringify(options.protocol[field])
    )
      throw new Error(`Expansion metric cache protocol mismatch: ${field}`)
  if (options.kind === 'hdr') {
    const mapping = (value: unknown): Record<string, unknown> => {
      if (!Array.isArray(value)) throw new Error('Missing HDR mapping fingerprint')
      const matches = value
        .map(record)
        .filter((file) => file.path === 'benchmark/jpegxl/m7-hdr-mapping.ts')
      if (matches.length !== 1 || typeof matches[0]?.sha256 !== 'string')
        throw new Error('Missing HDR mapping fingerprint')
      return matches[0]
    }
    if (
      JSON.stringify(mapping(protocol.sourceFiles)) !==
      JSON.stringify(mapping(options.protocol.sourceFiles))
    )
      throw new Error('Expansion metric cache mapping mismatch')
  }
  if (
    options.kind === 'hdr'
      ? protocol.id !== options.id ||
        protocol.sourceSha256 !== options.sourceSha256 ||
        protocol.distance !== options.setting
      : report.id !== options.id || report.sourceSha256 !== options.sourceSha256
  )
    throw new Error('Expansion metric cache source mismatch')
  const points = options.kind === 'hdr' ? report.results : report.points
  if (!Array.isArray(points)) throw new Error('Missing cached expansion points')
  const matching = points
    .map(record)
    .filter(
      (point) =>
        point.engine === options.engine &&
        (options.kind === 'hdr' || point.setting === options.setting),
    )
  if (matching.length === 0) return undefined
  if (matching.length !== 1) throw new Error('Duplicate cached expansion coordinate')
  const point = matching[0]
  if (point?.status !== 'measured') return undefined
  const domains = options.kind === 'hdr' ? point.displays : point.composites
  if (!Array.isArray(domains)) throw new Error('Missing cached display domains')
  const matches = domains
    .map(record)
    .filter(
      (domain) => (options.kind === 'hdr' ? domain.headroom : domain.background) === options.domain,
    )
  if (matches.length === 0) return undefined
  if (matches.length !== 1) throw new Error('Duplicate cached display domain')
  const domain = matches[0]
  if (!domain || domain.decodedSha256 !== options.decodedSha256) return undefined
  const { ssimulacra2, butteraugli, ssimulacra2Text, butteraugliText } = domain
  if (
    typeof ssimulacra2 !== 'number' ||
    typeof butteraugli !== 'number' ||
    !Number.isFinite(ssimulacra2) ||
    !Number.isFinite(butteraugli) ||
    butteraugli < 0 ||
    typeof ssimulacra2Text !== 'string' ||
    typeof butteraugliText !== 'string' ||
    Number.parseFloat(ssimulacra2Text) !== ssimulacra2 ||
    Number.parseFloat(butteraugliText) !== butteraugli
  )
    throw new Error('Invalid cached expansion metric')
  return {
    ssimulacra2,
    butteraugli,
    ssimulacra2Text,
    butteraugliText,
    metricReuse: {
      reportPath: options.reportPath,
      reportSha256: createHash('sha256').update(bytes).digest('hex'),
    },
  }
}
