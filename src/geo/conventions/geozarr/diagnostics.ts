import { ImageError } from '../../../errors.ts'

export type GeoZarrConventionMode = 'strict' | 'compatibility'

export type GeoZarrDiagnosticSeverity = 'info' | 'warning' | 'error'

export type GeoZarrDiagnosticCode =
  | 'malformed-registration'
  | 'malformed-uuid'
  | 'unknown-convention'
  | 'known-name-unknown-uuid'
  | 'duplicate-registration'
  | 'conflicting-registration'
  | 'registration-schema-mismatch'
  | 'registration-additive-fields'
  | 'older-convention-version'
  | 'newer-convention-version'
  | 'unversioned-convention'
  | 'conflicting-version-evidence'
  | 'invalid-proj-metadata'
  | 'conflicting-crs-representations'
  | 'invalid-spatial-metadata'
  | 'unsupported-spatial-transform'
  | 'non-invertible-spatial-transform'
  | 'spatial-dimension-missing'
  | 'spatial-dimension-duplicate'
  | 'spatial-shape-mismatch'
  | 'spatial-bounds-mismatch'
  | 'invalid-multiscales-metadata'
  | 'duplicate-multiscale-path'
  | 'missing-multiscale-path'
  | 'missing-derived-level'
  | 'ambiguous-inheritance'
  | 'metadata-limit-exceeded'

export interface GeoZarrDiagnostic {
  readonly severity: GeoZarrDiagnosticSeverity
  readonly code: GeoZarrDiagnosticCode
  readonly message: string
  readonly path: string
  readonly conventionUuid?: string
}

export const geoZarrDiagnostic = (
  severity: GeoZarrDiagnosticSeverity,
  code: GeoZarrDiagnosticCode,
  message: string,
  path: string,
  conventionUuid?: string,
): GeoZarrDiagnostic =>
  Object.freeze({
    severity,
    code,
    message,
    path,
    ...(conventionUuid === undefined ? {} : { conventionUuid }),
  })

export class GeoZarrConventionError extends ImageError {
  readonly diagnostics: readonly GeoZarrDiagnostic[]

  constructor(message: string, diagnostics: readonly GeoZarrDiagnostic[]) {
    super('INVALID_INPUT', message)
    this.name = 'GeoZarrConventionError'
    this.diagnostics = Object.freeze([...diagnostics])
  }
}

export const rejectGeoZarrErrors = (
  mode: GeoZarrConventionMode,
  diagnostics: readonly GeoZarrDiagnostic[],
): void => {
  if (mode !== 'strict') return
  const errors = diagnostics.filter((entry) => entry.severity === 'error')
  if (errors.length === 0) return
  throw new GeoZarrConventionError(
    `GeoZarr convention metadata is invalid: ${errors[0]?.message ?? 'unknown error'}`,
    diagnostics,
  )
}
