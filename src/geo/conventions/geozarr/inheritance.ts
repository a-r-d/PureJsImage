import type { GeoZarrConventionMode, GeoZarrDiagnostic } from './diagnostics.ts'
import { geoZarrDiagnostic } from './diagnostics.ts'
import { geoZarrProjConvention, geoZarrSpatialConvention } from './registry.ts'
import { geoZarrModeSeverity } from './validation.ts'

const projFields = ['proj:code', 'proj:wkt2', 'proj:projjson'] as const
const spatialFields = [
  'spatial:dimensions',
  'spatial:bbox',
  'spatial:transform_type',
  'spatial:transform',
  'spatial:shape',
  'spatial:registration',
] as const

export interface GeoZarrInheritedAttributes {
  readonly proj: Readonly<Record<string, unknown>>
  readonly spatial: Readonly<Record<string, unknown>>
  readonly diagnostics: readonly GeoZarrDiagnostic[]
}

export const isDirectGeoZarrChildPath = (path: string): boolean => !path.includes('/')

const select = (
  source: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): Record<string, unknown> => {
  const output: Record<string, unknown> = {}
  for (const key of keys) {
    if (source[key] !== undefined) output[key] = source[key]
  }
  return output
}

const sameValue = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right)

/** Apply only the direct-child inheritance defined by the v0.1 proj and spatial conventions. */
export const inheritGeoZarrAttributes = (
  groupAttributes: Readonly<Record<string, unknown>>,
  childAttributes: Readonly<Record<string, unknown>>,
  childPath: string,
  mode: GeoZarrConventionMode,
  layoutAttributes: Readonly<Record<string, unknown>> = {},
): GeoZarrInheritedAttributes => {
  const diagnostics: GeoZarrDiagnostic[] = []
  const direct = isDirectGeoZarrChildPath(childPath)
  const groupProj = direct ? select(groupAttributes, projFields) : {}
  const childProj = select(childAttributes, projFields)
  const proj = Object.freeze(Object.keys(childProj).length > 0 ? childProj : groupProj)
  const spatial: Record<string, unknown> = direct ? select(groupAttributes, spatialFields) : {}
  const layoutSpatial = select(layoutAttributes, spatialFields)
  const childSpatial = select(childAttributes, spatialFields)
  for (const [key, value] of Object.entries(layoutSpatial)) spatial[key] = value
  for (const [key, value] of Object.entries(childSpatial)) {
    const layoutValue = layoutSpatial[key]
    if (layoutValue !== undefined && !sameValue(layoutValue, value)) {
      diagnostics.push(
        geoZarrDiagnostic(
          geoZarrModeSeverity(mode),
          'ambiguous-inheritance',
          `Child ${key} conflicts with the multiscale layout override`,
          `${childPath}.${key}`,
          geoZarrSpatialConvention.uuid,
        ),
      )
    }
    spatial[key] = value
  }
  if (Object.keys(childProj).length > 0 && Object.keys(groupProj).length > 0) {
    const childComplete = projFields.some((key) => childProj[key] !== undefined)
    if (!childComplete) {
      diagnostics.push(
        geoZarrDiagnostic(
          geoZarrModeSeverity(mode),
          'ambiguous-inheritance',
          'Child PROJ override is incomplete and cannot be supplemented from its parent',
          childPath,
          geoZarrProjConvention.uuid,
        ),
      )
    }
  }
  return Object.freeze({
    proj,
    spatial: Object.freeze(spatial),
    diagnostics: Object.freeze(diagnostics),
  })
}
