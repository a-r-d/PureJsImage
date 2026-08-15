import { readFile } from 'node:fs/promises'

export type CapabilityStatus = 'supported' | 'limited' | 'unsupported' | 'planned'

export interface CapabilityLevel {
  readonly status: CapabilityStatus
  readonly label: string
}

export type LossyPixelValidation =
  | {
      readonly status: 'independent-oracle'
      readonly oracle: string
      readonly tolerance: string
      readonly evidence: readonly string[]
    }
  | {
      readonly status: 'not-applicable'
      readonly rationale: string
    }

export interface CodecCapability {
  readonly id: string
  readonly name: string
  readonly supportFile: string
  readonly packageFormat?: string
  readonly read: CapabilityLevel
  readonly write: CapabilityLevel
  readonly boundary: string
  readonly description: string
  readonly memory: string
  readonly recommendation: string
  readonly evidence: readonly string[]
  readonly lossyPixelValidation: LossyPixelValidation
  readonly document: string
}

export type ScientificResourceModel =
  | 'single'
  | 'companion-pair'
  | 'companion-set'
  | 'directory-like'

export type ScientificDatasetKind =
  | 'image'
  | 'volume'
  | 'spectrum-image'
  | 'spectrum'
  | 'surface'
  | 'pyramid'
  | 'orientation-map'

export interface ScientificReaderCapability {
  readonly id: string
  readonly version: string
  readonly format: string
  readonly packageExport: string
  readonly extensions: readonly string[]
  readonly mediaTypes: readonly string[]
  readonly resourceModel: ScientificResourceModel
  readonly datasetKinds: readonly ScientificDatasetKind[]
  readonly directRangeReads: boolean
  readonly boundary: string
  readonly evidence: readonly string[]
  readonly fixtures: readonly string[]
}

export interface CapabilityManifest {
  readonly schemaVersion: 1
  readonly generatedNotice: string
  readonly codecs: readonly CodecCapability[]
  readonly scientificReaders: readonly ScientificReaderCapability[]
}

export interface CapabilityClaim {
  readonly status: 'supported' | 'planned'
  readonly text: string
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const requiredString = (record: Readonly<Record<string, unknown>>, key: string): string => {
  const value = record[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Capability manifest field ${key} must be a non-empty string`)
  }
  return value
}

const optionalString = (
  record: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined => {
  const value = record[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Capability manifest field ${key} must be a non-empty string when present`)
  }
  return value
}

const stringArray = (record: Readonly<Record<string, unknown>>, key: string): readonly string[] => {
  const value = record[key]
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== 'string' || entry.length === 0)
  ) {
    throw new Error(`Capability manifest field ${key} must be an array of non-empty strings`)
  }
  return value
}

const documentText = (record: Readonly<Record<string, unknown>>): string => {
  const value = record.document
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error('Capability manifest field document must be an array of strings')
  }
  const lines: readonly string[] = value
  if (lines.length === 0) throw new Error('Capability support document cannot be empty')
  return lines.join('\n')
}

const statuses: ReadonlySet<string> = new Set(['supported', 'limited', 'unsupported', 'planned'])

const capabilityLevel = (value: unknown, codecId: string, operation: string): CapabilityLevel => {
  if (!isRecord(value)) throw new Error(`${codecId}.${operation} must be an object`)
  const status = requiredString(value, 'status')
  if (!statuses.has(status)) throw new Error(`${codecId}.${operation} has unknown status ${status}`)
  const label = requiredString(value, 'label')
  if (
    status === 'supported' ||
    status === 'limited' ||
    status === 'unsupported' ||
    status === 'planned'
  ) {
    return { status, label }
  }
  throw new Error(`${codecId}.${operation} has unreachable status ${status}`)
}

const lossyPixelValidation = (value: unknown, codecId: string): LossyPixelValidation => {
  if (!isRecord(value)) throw new Error(`${codecId}.lossyPixelValidation must be an object`)
  const status = requiredString(value, 'status')
  if (status === 'not-applicable') {
    return { status, rationale: requiredString(value, 'rationale') }
  }
  if (status === 'independent-oracle') {
    const evidence = stringArray(value, 'evidence')
    if (evidence.length === 0) {
      throw new Error(`${codecId}.lossyPixelValidation requires oracle test evidence`)
    }
    return {
      status,
      oracle: requiredString(value, 'oracle'),
      tolerance: requiredString(value, 'tolerance'),
      evidence,
    }
  }
  throw new Error(`${codecId}.lossyPixelValidation has unknown status ${status}`)
}

const codecCapability = (value: unknown): CodecCapability => {
  if (!isRecord(value)) throw new Error('Capability manifest codec entries must be objects')
  const id = requiredString(value, 'id')
  const packageFormat = optionalString(value, 'packageFormat')
  return {
    id,
    name: requiredString(value, 'name'),
    supportFile: requiredString(value, 'supportFile'),
    ...(packageFormat ? { packageFormat } : {}),
    read: capabilityLevel(value.read, id, 'read'),
    write: capabilityLevel(value.write, id, 'write'),
    boundary: requiredString(value, 'boundary'),
    description: requiredString(value, 'description'),
    memory: requiredString(value, 'memory'),
    recommendation: requiredString(value, 'recommendation'),
    evidence: stringArray(value, 'evidence'),
    lossyPixelValidation: lossyPixelValidation(value.lossyPixelValidation, id),
    document: documentText(value),
  }
}

const resourceModels: ReadonlySet<string> = new Set([
  'single',
  'companion-pair',
  'companion-set',
  'directory-like',
])
const datasetKinds: ReadonlySet<string> = new Set([
  'image',
  'volume',
  'spectrum-image',
  'spectrum',
  'surface',
  'pyramid',
  'orientation-map',
])
const isScientificResourceModel = (value: string): value is ScientificResourceModel =>
  value === 'single' ||
  value === 'companion-pair' ||
  value === 'companion-set' ||
  value === 'directory-like'
const isScientificDatasetKind = (value: string): value is ScientificDatasetKind =>
  value === 'image' ||
  value === 'volume' ||
  value === 'spectrum-image' ||
  value === 'spectrum' ||
  value === 'surface' ||
  value === 'pyramid' ||
  value === 'orientation-map'

const scientificReaderCapability = (value: unknown): ScientificReaderCapability => {
  if (!isRecord(value)) throw new Error('Scientific reader capability entries must be objects')
  const resourceModel = requiredString(value, 'resourceModel')
  if (!resourceModels.has(resourceModel) || !isScientificResourceModel(resourceModel)) {
    throw new Error(`Scientific reader capability has unknown resource model ${resourceModel}`)
  }
  const kinds = stringArray(value, 'datasetKinds')
  if (
    kinds.length === 0 ||
    kinds.some((kind) => !datasetKinds.has(kind) || !isScientificDatasetKind(kind))
  ) {
    throw new Error('Scientific reader capability has invalid dataset kinds')
  }
  const directRangeReads = value.directRangeReads
  if (typeof directRangeReads !== 'boolean') {
    throw new Error('Scientific reader capability directRangeReads must be boolean')
  }
  const normalizedKinds = kinds.filter(isScientificDatasetKind)
  return {
    id: requiredString(value, 'id'),
    version: requiredString(value, 'version'),
    format: requiredString(value, 'format'),
    packageExport: requiredString(value, 'packageExport'),
    extensions: stringArray(value, 'extensions'),
    mediaTypes: stringArray(value, 'mediaTypes'),
    resourceModel,
    datasetKinds: normalizedKinds,
    directRangeReads,
    boundary: requiredString(value, 'boundary'),
    evidence: stringArray(value, 'evidence'),
    fixtures: stringArray(value, 'fixtures'),
  }
}

export const parseCapabilityManifest = (value: unknown): CapabilityManifest => {
  if (!isRecord(value)) throw new Error('Capability manifest must be an object')
  if (value.schemaVersion !== 1) throw new Error('Capability manifest schemaVersion must be 1')
  if (!Array.isArray(value.codecs)) throw new Error('Capability manifest codecs must be an array')
  if (!Array.isArray(value.scientificReaders)) {
    throw new Error('Capability manifest scientificReaders must be an array')
  }
  const codecs = value.codecs.map(codecCapability)
  const scientificReaders = value.scientificReaders.map(scientificReaderCapability)
  const ids = new Set(codecs.map(({ id }) => id))
  const files = new Set(codecs.map(({ supportFile }) => supportFile))
  if (ids.size !== codecs.length) throw new Error('Capability manifest codec IDs must be unique')
  if (files.size !== codecs.length)
    throw new Error('Capability manifest support files must be unique')
  const readerIds = new Set(scientificReaders.map(({ id }) => id))
  const readerExports = new Set(scientificReaders.map(({ packageExport }) => packageExport))
  if (readerIds.size !== scientificReaders.length) {
    throw new Error('Scientific reader capability IDs must be unique')
  }
  if (readerExports.size !== scientificReaders.length) {
    throw new Error('Scientific reader package exports must be unique')
  }
  for (const reader of scientificReaders) {
    if (reader.evidence.length === 0 || reader.fixtures.length === 0) {
      throw new Error(`${reader.id} publishes support without evidence and fixtures`)
    }
  }
  for (const codec of codecs) {
    if (!codec.document.startsWith(`# ${codec.name.split(' / ')[0]}`)) {
      throw new Error(`${codec.id} support document title does not match its codec name`)
    }
    const isImplemented = codec.read.status === 'supported' || codec.read.status === 'limited'
    if (isImplemented && codec.evidence.length === 0) {
      throw new Error(`${codec.id} publishes decode support without test evidence`)
    }
    if (isImplemented && !codec.document.includes('- [x]')) {
      throw new Error(`${codec.id} publishes support without implemented checklist claims`)
    }
  }
  return {
    schemaVersion: 1,
    generatedNotice: requiredString(value, 'generatedNotice'),
    codecs,
    scientificReaders,
  }
}

export const readCapabilityManifest = async (
  path = 'capabilities/manifest.json',
): Promise<CapabilityManifest> => {
  const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
  return parseCapabilityManifest(parsed)
}

export const capabilityClaims = (document: string): readonly CapabilityClaim[] => {
  const claims: CapabilityClaim[] = []
  const lines = document.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const match = line?.match(/^- \[([ x])\] (.+)$/)
    if (!match) continue
    const checked = match[1]
    let text = match[2] ?? ''
    while ((lines[index + 1] ?? '').startsWith('  ')) {
      index += 1
      text += ` ${(lines[index] ?? '').trim()}`
    }
    claims.push({
      status: checked === 'x' ? 'supported' : 'planned',
      text,
    })
  }
  return claims
}
