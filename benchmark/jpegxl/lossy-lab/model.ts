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
