import { number, object } from '../comparison/model.ts'

export type Engine = 'purejsimage' | 'jsquash' | 'vips'
export interface CurvePoint {
  readonly setting: number
  readonly bytes: number
  readonly encodeMs: number
  readonly managedPeakBytes: number | null
  readonly processPeakRssBytes: number
  readonly ssimulacra2: number
  readonly butteraugliMax: number
  readonly butteraugliNorm3: number
}
export function parsePoint(value: unknown): CurvePoint {
  const row = object(value)
  return {
    setting: number(row.setting),
    bytes: number(row.bytes),
    encodeMs: number(row.encodeMs),
    managedPeakBytes: row.managedPeakBytes === null ? null : number(row.managedPeakBytes),
    processPeakRssBytes: number(row.processPeakRssBytes),
    ssimulacra2: number(row.ssimulacra2),
    butteraugliMax: number(row.butteraugliMax),
    butteraugliNorm3: number(row.butteraugliNorm3),
  }
}

export function missingSettings(
  settings: readonly number[],
  points: readonly CurvePoint[],
): number[] {
  return settings.filter((setting) => !points.some((point) => point.setting === setting))
}

/** Exploration stays at effort 7. The slow tier has one promotion screen. */
export function parseCampaignEffort(value: string, mode: string, promotion: boolean): 7 | 9 {
  if (value === '7') return 7
  if (value === '9' && mode === 'screen' && promotion) return 9
  throw new Error('Effort 9 requires a promotion screen; lab work uses effort 7')
}
export function curveMatches(
  value: unknown,
  fixtureSha256: string,
  engine: Engine,
  channels: number,
  effort: 7 | 9,
): boolean {
  const row = object(value)
  return (
    row.fixtureSha256 === fixtureSha256 &&
    row.engine === engine &&
    (row.channels ?? 4) === channels &&
    row.effort === effort &&
    Array.isArray(row.points)
  )
}
