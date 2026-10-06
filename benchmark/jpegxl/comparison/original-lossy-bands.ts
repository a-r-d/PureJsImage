import { interpolateM7Quality } from '../m7-quality-curves.ts'
import { recoveryBracket } from '../m7-recovery-curves.ts'
import { number, object, string } from './model.ts'

export type OriginalLossyMetric = 'ssimulacra2' | 'butteraugli'
export interface OriginalLossyPoint {
  readonly setting: number
  readonly bytes: number
  readonly score: number
  readonly butteraugli: number
  readonly artifact: string
  readonly artifactSha256: string
  readonly decodedSha256: string
}

export const originalLossyPoint = (input: unknown): OriginalLossyPoint => {
  const point = object(input)
  const setting = number(point.setting),
    bytes = number(point.bytes),
    score = number(point.score),
    butteraugli = number(point.butteraugli)
  if (
    !Number.isFinite(setting) ||
    setting <= 0 ||
    !Number.isSafeInteger(bytes) ||
    bytes < 1 ||
    !Number.isFinite(score) ||
    !Number.isFinite(butteraugli) ||
    butteraugli < 0
  )
    throw new Error('Invalid original lossy point')
  return {
    setting,
    bytes,
    score,
    butteraugli,
    artifact: string(point.artifact),
    artifactSha256: string(point.artifactSha256),
    decodedSha256: string(point.decodedSha256),
  }
}

export const originalLossyBands = (
  points: readonly OriginalLossyPoint[],
  metric: OriginalLossyMetric,
) => {
  const curve = points.map((point) => ({
    setting: point.setting,
    bytes: point.bytes,
    score: metric === 'ssimulacra2' ? point.score : -point.butteraugli,
  }))
  const targets = metric === 'ssimulacra2' ? [70, 80, 90] : [0.5, 1, 2, 3]
  return targets.map((target) => {
    const signedTarget = metric === 'ssimulacra2' ? target : -target
    const bracket = recoveryBracket(curve, signedTarget)
    const endpoint = (setting: number) => {
      const point = points.find((point) => point.setting === setting)
      if (!point) throw new Error('Original endpoint missing')
      return point
    }
    return {
      metric,
      target,
      status: !bracket
        ? 'missing bracket'
        : bracket.width > 0.25
          ? 'wide bracket'
          : 'adequate bracket',
      bracket: bracket
        ? {
            lower: endpoint(bracket.lower.setting),
            upper: endpoint(bracket.upper.setting),
            width: bracket.width,
          }
        : null,
      width: bracket?.width ?? null,
      interpolatedBytes:
        bracket && bracket.width <= 0.25
          ? (interpolateM7Quality(curve, signedTarget) ?? null)
          : null,
    }
  })
}

export const originalLossySelected = (points: readonly OriginalLossyPoint[]) => {
  const settings = new Set<number>()
  for (const metric of ['ssimulacra2', 'butteraugli'] as const) {
    for (const band of originalLossyBands(points, metric)) {
      if (band.status === 'adequate bracket' && band.bracket) {
        settings.add(band.bracket.lower.setting)
        settings.add(band.bracket.upper.setting)
      }
    }
  }
  return points.filter((point) => settings.has(point.setting))
}
