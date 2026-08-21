import type { GeoCoordinateSystemType, GeoCrsState } from './contracts.ts'

export const geoCoordinateSystemTypeFromWkt = (
  value: string | undefined,
): GeoCoordinateSystemType => {
  if (value === undefined) return 'unknown'
  const root = /^\s*([A-Z][A-Z0-9_]*)\s*\[/iu.exec(value)?.[1]?.toUpperCase()
  if (root === undefined) return 'unknown'
  if (root === 'PROJCRS' || root === 'PROJECTEDCRS' || root === 'PROJCS') return 'projected'
  if (root === 'GEOGCRS' || root === 'GEODCRS' || root === 'GEOGRAPHICCRS' || root === 'GEOGCS')
    return 'geographic'
  if (root === 'GEOCCS' || root === 'GEOCENTRICCRS') return 'geocentric'
  if (root === 'VERTCRS' || root === 'VERTICALCRS' || root === 'VERT_CS') return 'vertical'
  if (root === 'COMPOUNDCRS' || root === 'COMPD_CS') return 'compound'
  if (root === 'ENGCRS' || root === 'ENGINEERINGCRS' || root === 'LOCAL_CS') return 'engineering'
  if (root === 'PARAMETRICCRS') return 'parametric'
  if (root === 'TIMECRS' || root === 'TEMPORALCRS') return 'temporal'
  return 'unknown'
}

export const geoCrsStateFromEvidence = (
  usableDefinition: boolean,
  meaningfulUnresolvedEvidence: boolean,
  conflicting = false,
): GeoCrsState => {
  if (conflicting || (!usableDefinition && meaningfulUnresolvedEvidence)) return 'incomplete'
  return usableDefinition ? 'complete' : 'unknown'
}
