import type {
  GeoCoordinateSystemType,
  GeoCrsAxisDescriptor,
  GeoSpatialReference,
  GeoUnitDescriptor,
} from '../../contracts.ts'
import { normalizeGeoSpatialReference } from '../../contracts.ts'
import { geoCoordinateSystemTypeFromWkt, geoCrsStateFromEvidence } from '../../crs.ts'
import type { GeoZarrConventionMode, GeoZarrDiagnostic } from './diagnostics.ts'
import { geoZarrDiagnostic } from './diagnostics.ts'
import { geoZarrProjConvention } from './registry.ts'
import type { GeoZarrJsonObject, ResolvedGeoZarrConventionLimits } from './validation.ts'
import {
  geoZarrModeSeverity,
  geoZarrString,
  geoZarrUnknownFields,
  isGeoZarrRecord,
  normalizeGeoZarrJsonObject,
} from './validation.ts'

export interface GeoZarrProjMetadata {
  readonly authority?: string
  readonly code?: string
  readonly authorityCode?: string
  readonly wkt2?: string
  readonly projJson?: GeoZarrJsonObject
  readonly name?: string
  readonly coordinateSystemType: GeoCoordinateSystemType
  readonly units: readonly GeoUnitDescriptor[]
  readonly axes: readonly GeoCrsAxisDescriptor[]
  readonly spatialReference?: GeoSpatialReference
  readonly conflicts: readonly GeoZarrDiagnostic[]
  readonly additional: GeoZarrJsonObject
}

export interface GeoZarrProjParseResult {
  readonly value?: GeoZarrProjMetadata
  readonly diagnostics: readonly GeoZarrDiagnostic[]
}

const projKeys = new Set(['proj:code', 'proj:wkt2', 'proj:projjson'])

const projAdditional = (
  attributes: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> =>
  Object.fromEntries(
    Object.entries(attributes).filter(([key]) => key.startsWith('proj:') && !projKeys.has(key)),
  )

const coordinateSystemType = (value: unknown): GeoCoordinateSystemType => {
  if (typeof value !== 'string') return 'unknown'
  const normalized = value.toLowerCase()
  if (normalized.includes('projected')) return 'projected'
  if (normalized.includes('geographic')) return 'geographic'
  if (normalized.includes('geocentric')) return 'geocentric'
  if (normalized.includes('vertical')) return 'vertical'
  if (normalized.includes('compound')) return 'compound'
  if (normalized.includes('engineering')) return 'engineering'
  if (normalized.includes('parametric')) return 'parametric'
  if (normalized.includes('temporal')) return 'temporal'
  return 'unknown'
}

const parseUnit = (value: unknown): GeoUnitDescriptor | undefined => {
  if (typeof value === 'string' && value.length > 0) return Object.freeze({ name: value })
  if (!isGeoZarrRecord(value)) return undefined
  const name = geoZarrString(value.name)
  if (name === undefined) return undefined
  const conversion = value.conversion_factor
  return Object.freeze({
    name,
    ...(typeof conversion === 'number' && Number.isFinite(conversion)
      ? { conversionToSI: conversion }
      : {}),
  })
}

const parseAxes = (projJson: GeoZarrJsonObject | undefined): readonly GeoCrsAxisDescriptor[] => {
  const coordinateSystem = projJson?.coordinate_system
  if (!isGeoZarrRecord(coordinateSystem) || !Array.isArray(coordinateSystem.axis))
    return Object.freeze([])
  const axes: GeoCrsAxisDescriptor[] = []
  for (const value of coordinateSystem.axis) {
    if (!isGeoZarrRecord(value)) continue
    const name = geoZarrString(value.name)
    const direction = geoZarrString(value.direction)
    if (name === undefined || direction === undefined) continue
    const abbreviation = geoZarrString(value.abbreviation)
    const unit = parseUnit(value.unit)
    axes.push(
      Object.freeze({
        name,
        ...(abbreviation === undefined ? {} : { abbreviation }),
        direction,
        ...(unit === undefined ? {} : { unit }),
        order: axes.length,
      }),
    )
  }
  return Object.freeze(axes)
}

const projJsonIdentifier = (
  projJson: GeoZarrJsonObject | undefined,
): readonly [string, string] | undefined => {
  const id = projJson?.id
  if (!isGeoZarrRecord(id)) return undefined
  const authority = geoZarrString(id.authority)
  const code =
    typeof id.code === 'number' && Number.isFinite(id.code)
      ? String(id.code)
      : geoZarrString(id.code)
  return authority === undefined || code === undefined
    ? undefined
    : Object.freeze([authority, code] as const)
}

const wktIdentifier = (value: string | undefined): readonly [string, string] | undefined => {
  if (value === undefined) return undefined
  const matches = [...value.matchAll(/\bID\s*\[\s*"([^"]+)"\s*,\s*"?([^,"\]]+)"?/giu)]
  const match = matches.at(-1)
  return match?.[1] === undefined || match[2] === undefined
    ? undefined
    : Object.freeze([match[1], match[2].trim()] as const)
}

const wktName = (value: string | undefined): string | undefined => {
  if (value === undefined) return undefined
  return /^\s*[A-Z][A-Z0-9_]*CRS\s*\[\s*"([^"]+)"/iu.exec(value)?.[1]
}

const sameIdentifier = (
  left: readonly [string, string],
  right: readonly [string, string],
): boolean =>
  left[0].toUpperCase() === right[0].toUpperCase() &&
  left[1].toUpperCase() === right[1].toUpperCase()

const applicationAxisIndex = (
  axes: readonly GeoCrsAxisDescriptor[],
  role: 'x' | 'y',
): number | undefined => {
  const directions = role === 'x' ? ['east', 'west'] : ['north', 'south']
  const index = axes.findIndex((axis) => directions.includes(axis.direction.toLowerCase()))
  return index < 0 ? undefined : index
}

export const parseGeoZarrProjMetadata = (
  attributes: Readonly<Record<string, unknown>>,
  mode: GeoZarrConventionMode,
  limits: ResolvedGeoZarrConventionLimits,
  path: string,
): GeoZarrProjParseResult => {
  const diagnostics: GeoZarrDiagnostic[] = []
  const hasProjField = [...projKeys].some((key) => attributes[key] !== undefined)
  if (!hasProjField) return Object.freeze({ diagnostics: Object.freeze([]) })
  const authorityCode = geoZarrString(attributes['proj:code'])
  const codeParts = authorityCode?.split(':')
  const codeValid =
    codeParts !== undefined && codeParts.length === 2 && codeParts[0] !== '' && codeParts[1] !== ''
  if (attributes['proj:code'] !== undefined && !codeValid) {
    diagnostics.push(
      geoZarrDiagnostic(
        'error',
        'invalid-proj-metadata',
        'proj:code must contain one non-empty authority:code pair',
        `${path}.proj:code`,
        geoZarrProjConvention.uuid,
      ),
    )
  }
  const wkt2 = geoZarrString(attributes['proj:wkt2'])
  if (attributes['proj:wkt2'] !== undefined && wkt2 === undefined) {
    diagnostics.push(
      geoZarrDiagnostic(
        'error',
        'invalid-proj-metadata',
        'proj:wkt2 must be a non-empty string',
        `${path}.proj:wkt2`,
        geoZarrProjConvention.uuid,
      ),
    )
  }
  let projJson: GeoZarrJsonObject | undefined
  if (attributes['proj:projjson'] !== undefined) {
    try {
      projJson = normalizeGeoZarrJsonObject(
        attributes['proj:projjson'],
        `${path}.proj:projjson`,
        limits,
      )
      if (
        geoZarrString(projJson.type) === undefined ||
        geoZarrString(projJson.name) === undefined
      ) {
        diagnostics.push(
          geoZarrDiagnostic(
            'error',
            'invalid-proj-metadata',
            'proj:projjson must include non-empty type and name fields',
            `${path}.proj:projjson`,
            geoZarrProjConvention.uuid,
          ),
        )
      }
    } catch (error) {
      diagnostics.push(
        geoZarrDiagnostic(
          'error',
          'invalid-proj-metadata',
          error instanceof Error ? error.message : 'proj:projjson must be bounded JSON',
          `${path}.proj:projjson`,
          geoZarrProjConvention.uuid,
        ),
      )
    }
  }
  if (!codeValid && wkt2 === undefined && projJson === undefined) {
    diagnostics.push(
      geoZarrDiagnostic(
        'error',
        'invalid-proj-metadata',
        'The proj convention requires proj:code, proj:wkt2, or proj:projjson',
        path,
        geoZarrProjConvention.uuid,
      ),
    )
  }
  const identifiers: readonly (readonly [string, string])[] = Object.freeze(
    [
      codeValid && codeParts !== undefined
        ? Object.freeze([codeParts[0] ?? '', codeParts[1] ?? ''] as const)
        : undefined,
      projJsonIdentifier(projJson),
      wktIdentifier(wkt2),
    ].filter((entry): entry is readonly [string, string] => entry !== undefined),
  )
  const conflicts: GeoZarrDiagnostic[] = []
  if (identifiers.some((entry) => !sameIdentifier(entry, identifiers[0] ?? entry))) {
    const conflict = geoZarrDiagnostic(
      geoZarrModeSeverity(mode),
      'conflicting-crs-representations',
      'CRS authority identifiers disagree across proj representations',
      path,
      geoZarrProjConvention.uuid,
    )
    conflicts.push(conflict)
    diagnostics.push(conflict)
  }
  const axes = parseAxes(projJson)
  const units = Object.freeze(
    axes
      .flatMap((axis) => (axis.unit === undefined ? [] : [axis.unit]))
      .filter(
        (unit, index, values) => values.findIndex((entry) => entry.name === unit.name) === index,
      ),
  )
  const projType = coordinateSystemType(projJson?.type)
  const wktType = geoCoordinateSystemTypeFromWkt(wkt2)
  const type = projType !== 'unknown' ? projType : wktType
  const name = geoZarrString(projJson?.name) ?? wktName(wkt2)
  let additional: GeoZarrJsonObject
  try {
    additional = geoZarrUnknownFields(
      projAdditional(attributes),
      new Set(),
      `${path}.projAdditional`,
      limits,
    )
  } catch (error) {
    additional = Object.freeze({})
    diagnostics.push(
      geoZarrDiagnostic(
        'error',
        'metadata-limit-exceeded',
        error instanceof Error ? error.message : 'PROJ additive metadata exceeds limits',
        path,
        geoZarrProjConvention.uuid,
      ),
    )
  }
  const authority = codeValid ? codeParts?.[0] : identifiers[0]?.[0]
  const code = codeValid ? codeParts?.[1] : identifiers[0]?.[1]
  const xIndex = applicationAxisIndex(axes, 'x')
  const yIndex = applicationAxisIndex(axes, 'y')
  const hasUsableDefinition = codeValid || wkt2 !== undefined || projJson !== undefined
  const geoDiagnostics =
    type === 'unknown' && !hasUsableDefinition
      ? [
          {
            severity: 'warning' as const,
            code: 'incomplete-crs' as const,
            message:
              'GeoZarr CRS representations do not expose a recognized coordinate-system type.',
            path,
          },
        ]
      : []
  const spatialReference = normalizeGeoSpatialReference({
    schemaVersion: 1,
    coordinateSystemType: type,
    ...(authority === undefined ? {} : { authority }),
    ...(code === undefined ? {} : { code }),
    ...(name === undefined ? {} : { name }),
    ...(wkt2 === undefined ? {} : { wkt2 }),
    ...(projJson === undefined ? {} : { projJson }),
    ...(units[0] === undefined ? {} : { horizontalUnit: units[0] }),
    formalAxes: axes,
    applicationAxes: {
      x: { name: 'X', ...(xIndex === undefined ? {} : { formalAxisIndex: xIndex }) },
      y: { name: 'Y', ...(yIndex === undefined ? {} : { formalAxisIndex: yIndex }) },
    },
    evidence: [
      {
        kind: 'embedded',
        sourceId: 'geozarr-proj',
        locator: path,
        citation: geoZarrProjConvention.specUrl,
      },
    ],
    state: geoCrsStateFromEvidence(hasUsableDefinition, false, conflicts.length > 0),
    confidence: conflicts.length === 0 ? 1 : 0.5,
    diagnostics: geoDiagnostics,
  })
  return Object.freeze({
    value: Object.freeze({
      ...(authority === undefined ? {} : { authority }),
      ...(code === undefined ? {} : { code }),
      ...(authorityCode === undefined ? {} : { authorityCode }),
      ...(wkt2 === undefined ? {} : { wkt2 }),
      ...(projJson === undefined ? {} : { projJson }),
      ...(name === undefined ? {} : { name }),
      coordinateSystemType: type,
      units,
      axes,
      spatialReference,
      conflicts: Object.freeze(conflicts),
      additional,
    }),
    diagnostics: Object.freeze(diagnostics),
  })
}
