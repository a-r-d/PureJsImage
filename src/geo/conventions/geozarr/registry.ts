import type { GeoZarrConventionMode, GeoZarrDiagnostic } from './diagnostics.ts'
import { geoZarrDiagnostic } from './diagnostics.ts'
import type { GeoZarrJsonObject, ResolvedGeoZarrConventionLimits } from './validation.ts'
import {
  geoZarrModeSeverity,
  geoZarrString,
  geoZarrUnknownFields,
  isGeoZarrRecord,
  normalizeGeoZarrJsonObject,
} from './validation.ts'

export type GeoZarrKnownConventionName = 'proj' | 'spatial' | 'multiscales'
export type GeoZarrConventionVersionStatus =
  | 'supported'
  | 'older'
  | 'newer'
  | 'unversioned'
  | 'conflicting'

export interface GeoZarrConventionDefinition {
  readonly uuid: string
  readonly name: GeoZarrKnownConventionName
  readonly description: string
  readonly tag: 'v0.1'
  readonly maturity: 'Pilot'
  readonly schemaUrl: string
  readonly specUrl: string
  readonly repositoryUrl: string
  readonly tagCommit: string
}

const definition = (
  name: GeoZarrKnownConventionName,
  uuid: string,
  description: string,
  tagCommit: string,
): GeoZarrConventionDefinition =>
  Object.freeze({
    uuid,
    name,
    description,
    tag: 'v0.1',
    maturity: 'Pilot',
    schemaUrl: `https://raw.githubusercontent.com/zarr-conventions/${name}/refs/tags/v0.1/schema.json`,
    specUrl: `https://github.com/zarr-conventions/${name}/blob/v0.1/README.md`,
    repositoryUrl: `https://github.com/zarr-conventions/${name}`,
    tagCommit,
  })

export const geoZarrProjConvention = definition(
  'proj',
  'f17cb550-5864-4468-aeb7-f3180cfb622f',
  'Coordinate reference system information for geospatial data',
  '5ca5b2f92e5c7245f957d9128b289ee535f0720d',
)

export const geoZarrSpatialConvention = definition(
  'spatial',
  '689b58e2-cf7b-45e0-9fff-9cfc0883d6b4',
  'Spatial coordinate information',
  '54d81b7ced0376e63ee10f34db31db7d08dcc28d',
)

export const geoZarrMultiscalesConvention = definition(
  'multiscales',
  'd35379db-88df-4056-af3a-620245f8e347',
  'Multiscale layout of zarr datasets',
  '9b78efa75fef0fed302d9cf880037c569354d860',
)

export const geoZarrConventionRegistry: readonly GeoZarrConventionDefinition[] = Object.freeze([
  geoZarrProjConvention,
  geoZarrSpatialConvention,
  geoZarrMultiscalesConvention,
])

const registryByUuid = new Map(geoZarrConventionRegistry.map((entry) => [entry.uuid, entry]))
const registryByName = new Map(geoZarrConventionRegistry.map((entry) => [entry.name, entry]))

const isKnownConventionName = (value: string): value is GeoZarrKnownConventionName =>
  value === 'proj' || value === 'spatial' || value === 'multiscales'

export interface GeoZarrConventionVersionEvidence {
  readonly schemaTag?: string
  readonly specTag?: string
  readonly selectedTag?: string
  readonly supportedTag?: string
  readonly status: GeoZarrConventionVersionStatus
  readonly maturity?: string
}

export interface GeoZarrConventionRegistration {
  readonly index: number
  readonly uuid?: string
  readonly name?: string
  readonly description?: string
  readonly schemaUrl?: string
  readonly specUrl?: string
  readonly known?: GeoZarrConventionDefinition
  readonly version: GeoZarrConventionVersionEvidence
  readonly additional: GeoZarrJsonObject
  readonly source: GeoZarrJsonObject
}

export interface GeoZarrRegistrationParseResult {
  readonly registrations: readonly GeoZarrConventionRegistration[]
  readonly diagnostics: readonly GeoZarrDiagnostic[]
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const knownRegistrationKeys = new Set(['uuid', 'name', 'description', 'schema_url', 'spec_url'])

const tagFromUrl = (value: string | undefined): string | undefined => {
  if (value === undefined) return undefined
  const match = /\/(?:refs\/tags|blob)\/(v[^/]+)\//u.exec(value)
  return match?.[1]
}

const numericVersion = (tag: string): readonly number[] | undefined => {
  const match = /^v(\d+(?:\.\d+)*)$/u.exec(tag)
  return match?.[1]?.split('.').map(Number)
}

const compareTags = (left: string, right: string): number | undefined => {
  const leftParts = numericVersion(left)
  const rightParts = numericVersion(right)
  if (leftParts === undefined || rightParts === undefined) return undefined
  const count = Math.max(leftParts.length, rightParts.length)
  for (let index = 0; index < count; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0)
    if (difference !== 0) return Math.sign(difference)
  }
  return 0
}

const versionEvidence = (
  schemaUrl: string | undefined,
  specUrl: string | undefined,
  known: GeoZarrConventionDefinition | undefined,
): GeoZarrConventionVersionEvidence => {
  const schemaTag = tagFromUrl(schemaUrl)
  const specTag = tagFromUrl(specUrl)
  if (schemaTag !== undefined && specTag !== undefined && schemaTag !== specTag) {
    return Object.freeze({ schemaTag, specTag, status: 'conflicting' })
  }
  const selectedTag = schemaTag ?? specTag
  if (known === undefined) {
    return Object.freeze({
      ...(schemaTag === undefined ? {} : { schemaTag }),
      ...(specTag === undefined ? {} : { specTag }),
      ...(selectedTag === undefined ? {} : { selectedTag }),
      status: selectedTag === undefined ? 'unversioned' : 'supported',
    })
  }
  if (selectedTag === undefined) {
    return Object.freeze({
      status: 'unversioned',
      supportedTag: known.tag,
      maturity: known.maturity,
    })
  }
  const compared = compareTags(selectedTag, known.tag)
  const status: GeoZarrConventionVersionStatus =
    compared === undefined || compared === 0 ? 'supported' : compared < 0 ? 'older' : 'newer'
  return Object.freeze({
    ...(schemaTag === undefined ? {} : { schemaTag }),
    ...(specTag === undefined ? {} : { specTag }),
    selectedTag,
    supportedTag: known.tag,
    status,
    maturity: known.maturity,
  })
}

const registrationIdentity = (entry: GeoZarrConventionRegistration): string =>
  JSON.stringify([entry.uuid, entry.name, entry.schemaUrl, entry.specUrl])

export const parseGeoZarrConventionRegistrations = (
  attributes: Readonly<Record<string, unknown>>,
  mode: GeoZarrConventionMode,
  limits: ResolvedGeoZarrConventionLimits,
  path = 'attributes.zarr_conventions',
): GeoZarrRegistrationParseResult => {
  const diagnostics: GeoZarrDiagnostic[] = []
  const input = attributes.zarr_conventions
  if (input === undefined) {
    return Object.freeze({ registrations: Object.freeze([]), diagnostics: Object.freeze([]) })
  }
  if (!Array.isArray(input)) {
    diagnostics.push(
      geoZarrDiagnostic(
        'error',
        'malformed-registration',
        'zarr_conventions must be an array',
        path,
      ),
    )
    return Object.freeze({
      registrations: Object.freeze([]),
      diagnostics: Object.freeze(diagnostics),
    })
  }
  if (input.length > limits.maxRegistrations) {
    diagnostics.push(
      geoZarrDiagnostic(
        'error',
        'metadata-limit-exceeded',
        'zarr_conventions exceeds maxRegistrations',
        path,
      ),
    )
  }
  const registrations: GeoZarrConventionRegistration[] = []
  for (let index = 0; index < Math.min(input.length, limits.maxRegistrations); index += 1) {
    const value = input[index]
    const entryPath = `${path}[${index}]`
    if (!isGeoZarrRecord(value)) {
      diagnostics.push(
        geoZarrDiagnostic(
          'error',
          'malformed-registration',
          'Convention registration must be an object',
          entryPath,
        ),
      )
      continue
    }
    let source: GeoZarrJsonObject
    let additional: GeoZarrJsonObject
    try {
      source = normalizeGeoZarrJsonObject(value, entryPath, limits)
      additional = geoZarrUnknownFields(
        value,
        knownRegistrationKeys,
        `${entryPath}.additional`,
        limits,
      )
    } catch (error) {
      diagnostics.push(
        geoZarrDiagnostic(
          'error',
          'metadata-limit-exceeded',
          error instanceof Error ? error.message : 'Registration metadata exceeds limits',
          entryPath,
        ),
      )
      continue
    }
    const uuid = geoZarrString(value.uuid)?.toLowerCase()
    const name = geoZarrString(value.name)
    const description = geoZarrString(value.description)
    const schemaUrl = geoZarrString(value.schema_url)
    const specUrl = geoZarrString(value.spec_url)
    if (uuid === undefined && schemaUrl === undefined && specUrl === undefined) {
      diagnostics.push(
        geoZarrDiagnostic(
          'error',
          'malformed-registration',
          'Convention registration needs uuid, schema_url, or spec_url',
          entryPath,
        ),
      )
    }
    if (uuid !== undefined && !uuidPattern.test(uuid)) {
      diagnostics.push(
        geoZarrDiagnostic(
          'error',
          'malformed-uuid',
          'Convention UUID is malformed',
          `${entryPath}.uuid`,
        ),
      )
    }
    const known = uuid === undefined ? undefined : registryByUuid.get(uuid)
    if (known === undefined && uuid !== undefined && uuidPattern.test(uuid)) {
      diagnostics.push(
        geoZarrDiagnostic(
          'warning',
          name !== undefined && isKnownConventionName(name) && registryByName.has(name)
            ? 'known-name-unknown-uuid'
            : 'unknown-convention',
          'Convention UUID is not recognized; its metadata is preserved without interpretation',
          entryPath,
          uuid,
        ),
      )
    }
    const version = versionEvidence(schemaUrl, specUrl, known)
    if (version.status === 'conflicting') {
      diagnostics.push(
        geoZarrDiagnostic(
          'error',
          'conflicting-version-evidence',
          'schema_url and spec_url identify different convention tags',
          entryPath,
          uuid,
        ),
      )
    } else if (version.status === 'older') {
      diagnostics.push(
        geoZarrDiagnostic(
          'warning',
          'older-convention-version',
          `Convention tag ${version.selectedTag ?? 'unknown'} predates supported ${known?.tag ?? 'version'}`,
          entryPath,
          uuid,
        ),
      )
    } else if (version.status === 'newer') {
      diagnostics.push(
        geoZarrDiagnostic(
          geoZarrModeSeverity(mode),
          'newer-convention-version',
          `Convention tag ${version.selectedTag ?? 'unknown'} is newer than supported ${known?.tag ?? 'version'}`,
          entryPath,
          uuid,
        ),
      )
    } else if (version.status === 'unversioned' && known !== undefined) {
      diagnostics.push(
        geoZarrDiagnostic(
          'warning',
          'unversioned-convention',
          'Known convention registration has no tag-bearing schema or specification URL',
          entryPath,
          uuid,
        ),
      )
    }
    if (known !== undefined && version.status === 'supported') {
      const mismatches = [
        name !== undefined && name !== known.name,
        description !== undefined && description !== known.description,
        schemaUrl !== undefined && schemaUrl !== known.schemaUrl,
        specUrl !== undefined && specUrl !== known.specUrl,
      ]
      if (mismatches.some(Boolean)) {
        diagnostics.push(
          geoZarrDiagnostic(
            geoZarrModeSeverity(mode),
            'registration-schema-mismatch',
            'Known v0.1 registration does not match its pinned schema constants',
            entryPath,
            uuid,
          ),
        )
      }
      if (Object.keys(additional).length > 0) {
        diagnostics.push(
          geoZarrDiagnostic(
            geoZarrModeSeverity(mode),
            'registration-additive-fields',
            'Known v0.1 registration contains fields excluded by its pinned schema',
            entryPath,
            uuid,
          ),
        )
      }
    }
    registrations.push(
      Object.freeze({
        index,
        ...(uuid === undefined ? {} : { uuid }),
        ...(name === undefined ? {} : { name }),
        ...(description === undefined ? {} : { description }),
        ...(schemaUrl === undefined ? {} : { schemaUrl }),
        ...(specUrl === undefined ? {} : { specUrl }),
        ...(known === undefined ? {} : { known }),
        version,
        additional,
        source,
      }),
    )
  }
  const seen = new Map<string, GeoZarrConventionRegistration>()
  for (const entry of registrations) {
    if (entry.uuid === undefined) continue
    const prior = seen.get(entry.uuid)
    if (prior === undefined) {
      seen.set(entry.uuid, entry)
      continue
    }
    const duplicate = registrationIdentity(prior) === registrationIdentity(entry)
    diagnostics.push(
      geoZarrDiagnostic(
        duplicate ? 'warning' : 'error',
        duplicate ? 'duplicate-registration' : 'conflicting-registration',
        duplicate
          ? 'Convention is registered more than once'
          : 'Convention UUID has conflicting registrations',
        `${path}[${entry.index}]`,
        entry.uuid,
      ),
    )
  }
  return Object.freeze({
    registrations: Object.freeze(registrations),
    diagnostics: Object.freeze(diagnostics),
  })
}

export const hasKnownGeoZarrConvention = (
  registrations: readonly GeoZarrConventionRegistration[],
  name: GeoZarrKnownConventionName,
): boolean => registrations.some((entry) => entry.known?.name === name)
