import { readFile } from 'node:fs/promises'

export const geoCapabilityIds = [
  'local-open',
  'remote-open',
  'range-access',
  'region-read',
  'multiscale',
  'rotated-affine',
  'pixel-is-area',
  'pixel-is-point',
  'unknown-crs',
  'bands',
  'time-dimension',
  'vertical-dimension',
  'nodata',
  'scale-offset',
  'target-grid-read',
  'reprojection',
  'writer',
] as const

export type GeoCapabilityId = (typeof geoCapabilityIds)[number]

export const geoCapabilityStates = [
  'implemented-tested',
  'implemented-fixture-limited',
  'metadata-only',
  'recognized-unsupported',
  'unavailable',
  'intentionally-out-of-scope',
] as const

export type GeoCapabilityState = (typeof geoCapabilityStates)[number]

export interface GeoCapabilityEvidence {
  readonly id: string
  readonly path: string
  readonly kind: 'test' | 'fixture' | 'oracle' | 'benchmark' | 'policy'
  readonly note: string
}

export interface GeoCapabilityClaim {
  readonly state: GeoCapabilityState
  readonly detail: string
  readonly evidence: readonly string[]
}

export interface GeoFormatCapability {
  readonly id: string
  readonly name: string
  readonly publicEntry: string
  readonly boundary: string
  readonly capabilities: Readonly<Record<GeoCapabilityId, GeoCapabilityClaim>>
}

export interface GeoCapabilityManifest {
  readonly schemaVersion: 1
  readonly generatedNotice: string
  readonly stateDefinitions: Readonly<Record<GeoCapabilityState, string>>
  readonly evidence: readonly GeoCapabilityEvidence[]
  readonly formats: readonly GeoFormatCapability[]
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const requiredString = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 8_192) {
    throw new Error(`Geo capability field ${field} must be a non-empty string`)
  }
  return value
}

const stringArray = (value: unknown, field: string): readonly string[] => {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== 'string' || entry.length === 0)
  ) {
    throw new Error(`Geo capability field ${field} must be an array of non-empty strings`)
  }
  return value
}

const isState = (value: string): value is GeoCapabilityState =>
  geoCapabilityStates.some((state) => state === value)

const isKind = (value: string): value is GeoCapabilityEvidence['kind'] =>
  value === 'test' ||
  value === 'fixture' ||
  value === 'oracle' ||
  value === 'benchmark' ||
  value === 'policy'

const parseEvidence = (value: unknown): GeoCapabilityEvidence => {
  if (!isRecord(value)) throw new Error('Geo capability evidence entries must be objects')
  const kind = requiredString(value.kind, 'evidence.kind')
  if (!isKind(kind)) throw new Error(`Unknown geo evidence kind ${kind}`)
  const path = requiredString(value.path, 'evidence.path')
  if (path.startsWith('/') || path.split('/').includes('..')) {
    throw new Error(`Geo evidence path must stay inside the repository: ${path}`)
  }
  return {
    id: requiredString(value.id, 'evidence.id'),
    path,
    kind,
    note: requiredString(value.note, 'evidence.note'),
  }
}

const parseClaim = (
  value: unknown,
  formatId: string,
  capabilityId: GeoCapabilityId,
): GeoCapabilityClaim => {
  if (!isRecord(value)) throw new Error(`${formatId}.${capabilityId} must be an object`)
  const state = requiredString(value.state, `${formatId}.${capabilityId}.state`)
  if (!isState(state)) throw new Error(`${formatId}.${capabilityId} has unknown state ${state}`)
  const evidence = stringArray(value.evidence, `${formatId}.${capabilityId}.evidence`)
  if (new Set(evidence).size !== evidence.length) {
    throw new Error(`${formatId}.${capabilityId} repeats evidence references`)
  }
  if (
    (state === 'implemented-tested' ||
      state === 'implemented-fixture-limited' ||
      state === 'metadata-only') &&
    evidence.length === 0
  ) {
    throw new Error(`${formatId}.${capabilityId} publishes ${state} without evidence`)
  }
  return {
    state,
    detail: requiredString(value.detail, `${formatId}.${capabilityId}.detail`),
    evidence,
  }
}

const parseFormat = (value: unknown): GeoFormatCapability => {
  if (!isRecord(value)) throw new Error('Geo format capability entries must be objects')
  const id = requiredString(value.id, 'formats.id')
  if (!isRecord(value.capabilities)) throw new Error(`${id}.capabilities must be an object`)
  const rawCapabilities = value.capabilities
  const keys = Object.keys(rawCapabilities)
  const expected = new Set<string>(geoCapabilityIds)
  const unknown = keys.filter((key) => !expected.has(key))
  const missing = geoCapabilityIds.filter((key) => !(key in rawCapabilities))
  if (unknown.length > 0 || missing.length > 0) {
    throw new Error(
      `${id} capability keys differ: missing=${missing.join(',')} unknown=${unknown.join(',')}`,
    )
  }
  const capabilities: Readonly<Record<GeoCapabilityId, GeoCapabilityClaim>> = {
    'local-open': parseClaim(rawCapabilities['local-open'], id, 'local-open'),
    'remote-open': parseClaim(rawCapabilities['remote-open'], id, 'remote-open'),
    'range-access': parseClaim(rawCapabilities['range-access'], id, 'range-access'),
    'region-read': parseClaim(rawCapabilities['region-read'], id, 'region-read'),
    multiscale: parseClaim(rawCapabilities.multiscale, id, 'multiscale'),
    'rotated-affine': parseClaim(rawCapabilities['rotated-affine'], id, 'rotated-affine'),
    'pixel-is-area': parseClaim(rawCapabilities['pixel-is-area'], id, 'pixel-is-area'),
    'pixel-is-point': parseClaim(rawCapabilities['pixel-is-point'], id, 'pixel-is-point'),
    'unknown-crs': parseClaim(rawCapabilities['unknown-crs'], id, 'unknown-crs'),
    bands: parseClaim(rawCapabilities.bands, id, 'bands'),
    'time-dimension': parseClaim(rawCapabilities['time-dimension'], id, 'time-dimension'),
    'vertical-dimension': parseClaim(
      rawCapabilities['vertical-dimension'],
      id,
      'vertical-dimension',
    ),
    nodata: parseClaim(rawCapabilities.nodata, id, 'nodata'),
    'scale-offset': parseClaim(rawCapabilities['scale-offset'], id, 'scale-offset'),
    'target-grid-read': parseClaim(rawCapabilities['target-grid-read'], id, 'target-grid-read'),
    reprojection: parseClaim(rawCapabilities.reprojection, id, 'reprojection'),
    writer: parseClaim(rawCapabilities.writer, id, 'writer'),
  }
  return {
    id,
    name: requiredString(value.name, `${id}.name`),
    publicEntry: requiredString(value.publicEntry, `${id}.publicEntry`),
    boundary: requiredString(value.boundary, `${id}.boundary`),
    capabilities,
  }
}

export const parseGeoCapabilityManifest = (value: unknown): GeoCapabilityManifest => {
  if (!isRecord(value)) throw new Error('Geo capability manifest must be an object')
  if (value.schemaVersion !== 1) throw new Error('Geo capability manifest schemaVersion must be 1')
  if (!isRecord(value.stateDefinitions)) throw new Error('Geo stateDefinitions must be an object')
  const stateKeys = Object.keys(value.stateDefinitions)
  if (
    stateKeys.length !== geoCapabilityStates.length ||
    stateKeys.some((state) => !geoCapabilityStates.some((known) => known === state))
  ) {
    throw new Error('Geo stateDefinitions must contain exactly the known states')
  }
  const stateDefinitions: Readonly<Record<GeoCapabilityState, string>> = {
    'implemented-tested': requiredString(
      value.stateDefinitions['implemented-tested'],
      'stateDefinitions.implemented-tested',
    ),
    'implemented-fixture-limited': requiredString(
      value.stateDefinitions['implemented-fixture-limited'],
      'stateDefinitions.implemented-fixture-limited',
    ),
    'metadata-only': requiredString(
      value.stateDefinitions['metadata-only'],
      'stateDefinitions.metadata-only',
    ),
    'recognized-unsupported': requiredString(
      value.stateDefinitions['recognized-unsupported'],
      'stateDefinitions.recognized-unsupported',
    ),
    unavailable: requiredString(value.stateDefinitions.unavailable, 'stateDefinitions.unavailable'),
    'intentionally-out-of-scope': requiredString(
      value.stateDefinitions['intentionally-out-of-scope'],
      'stateDefinitions.intentionally-out-of-scope',
    ),
  }
  if (!Array.isArray(value.evidence)) throw new Error('Geo capability evidence must be an array')
  if (!Array.isArray(value.formats)) throw new Error('Geo capability formats must be an array')
  const evidence = value.evidence.map(parseEvidence)
  const formats = value.formats.map(parseFormat)
  const evidenceIds = new Set(evidence.map(({ id }) => id))
  if (evidenceIds.size !== evidence.length) throw new Error('Geo evidence IDs must be unique')
  const formatIds = new Set(formats.map(({ id }) => id))
  if (formatIds.size !== formats.length) throw new Error('Geo format IDs must be unique')
  const referencedEvidence = new Set<string>()
  for (const format of formats) {
    for (const capabilityId of geoCapabilityIds) {
      for (const evidenceId of format.capabilities[capabilityId].evidence) {
        if (!evidenceIds.has(evidenceId)) {
          throw new Error(`${format.id}.${capabilityId} references missing evidence ${evidenceId}`)
        }
        referencedEvidence.add(evidenceId)
      }
    }
  }
  const unusedEvidence = evidence.filter(({ id }) => !referencedEvidence.has(id))
  if (unusedEvidence.length > 0) {
    throw new Error(
      `Geo evidence is not referenced: ${unusedEvidence.map(({ id }) => id).join(',')}`,
    )
  }
  return {
    schemaVersion: 1,
    generatedNotice: requiredString(value.generatedNotice, 'generatedNotice'),
    stateDefinitions,
    evidence,
    formats,
  }
}

export const readGeoCapabilityManifest = async (
  path = 'capabilities/geo-manifest.json',
): Promise<GeoCapabilityManifest> => {
  const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
  return parseGeoCapabilityManifest(parsed)
}
